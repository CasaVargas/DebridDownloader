use crate::engine::store::*;
use crate::engine::types::*;
use std::io::Write;

pub fn job(id: &str, state: JobState, dest: &str) -> Job {
    let mut j = Job::from_new(
        NewJob {
            kind: JobKind::Http,
            filename: id.into(),
            destination: dest.into(),
            source: LinkSource::Direct,
            url: "http://x".into(),
            total_bytes: 100,
            batch_id: "b".into(),
        },
        id.into(),
        0,
    );
    j.state = state;
    j
}

#[test]
fn missing_file_loads_empty() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Store::new(dir.path()).load().is_empty());
}

#[test]
fn save_then_load_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path());
    let jobs = vec![job("a", JobState::Pending, "/x/a"), job("b", JobState::Completed, "/x/b")];
    store.save(&jobs).unwrap();
    assert_eq!(store.load(), jobs);
}

#[test]
fn interrupted_save_leaves_previous_file_readable() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path());
    let jobs = vec![job("a", JobState::Pending, "/x/a")];
    store.save(&jobs).unwrap();
    // Simulate a crash after writing a temp file but before the rename.
    let mut f = std::fs::File::create(dir.path().join("downloads.json.deadbeef.tmp")).unwrap();
    f.write_all(b"{ garbage").unwrap();
    assert_eq!(store.load(), jobs);
}

#[test]
fn corrupt_file_is_quarantined() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("downloads.json"), b"not json").unwrap();
    let store = Store::new(dir.path());
    assert!(store.load().is_empty());
    assert!(!dir.path().join("downloads.json").exists());
    let quarantined = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|e| e.file_name().to_string_lossy().starts_with("downloads.json.corrupt-"));
    assert!(quarantined);
}

#[test]
fn unknown_version_is_quarantined() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("downloads.json"), br#"{"version":2,"jobs":[]}"#).unwrap();
    assert!(Store::new(dir.path()).load().is_empty());
    assert!(!dir.path().join("downloads.json").exists());
}

#[test]
fn prune_keeps_active_and_newest_history() {
    let mut jobs = Vec::new();
    for i in 0..(HISTORY_CAP + 10) {
        let mut j = job(&format!("done{i}"), JobState::Completed, "/x");
        j.updated_at = i as i64;
        jobs.push(j);
    }
    jobs.push(job("active", JobState::Downloading, "/x"));
    prune_history(&mut jobs);
    assert_eq!(jobs.len(), HISTORY_CAP + 1);
    assert!(jobs.iter().any(|j| j.id == "active"));
    assert!(!jobs.iter().any(|j| j.id == "done0")); // oldest dropped
    assert!(jobs.iter().any(|j| j.id == format!("done{}", HISTORY_CAP + 9)));
}

#[test]
fn recover_resets_states_and_validates_part_files() {
    let dir = tempfile::tempdir().unwrap();
    let dest_ok = dir.path().join("ok.bin").to_string_lossy().to_string();
    let dest_missing = dir.path().join("missing.bin").to_string_lossy().to_string();
    std::fs::write(format!("{dest_ok}.part"), vec![0u8; 100]).unwrap();

    let mut a = job("a", JobState::Downloading, &dest_ok);
    a.segments = vec![SegmentState { start: 0, end: 99, done: 40 }];
    a.retry_at = Some(5);
    let mut b = job("b", JobState::Paused, &dest_missing);
    b.segments = vec![SegmentState { start: 0, end: 99, done: 40 }];
    let mut c = job("c", JobState::Completed, &dest_ok);
    c.post = PostStage::Extract;
    let d = job("d", JobState::Failed("x".into()), &dest_ok);

    let mut jobs = vec![a, b, c, d];
    let rerun = recover(&mut jobs);

    assert_eq!(jobs[0].state, JobState::Pending);
    assert_eq!(jobs[0].retry_at, None);
    assert_eq!(jobs[0].segments.len(), 1, "part file intact → keep progress");
    assert_eq!(jobs[1].state, JobState::Paused);
    assert!(jobs[1].segments.is_empty(), "part missing → restart from 0");
    assert_eq!(rerun, vec!["c".to_string()]);
    assert_eq!(jobs[3].state, JobState::Failed("x".into()));
}

#[cfg(unix)]
#[test]
fn unreadable_file_is_never_overwritten() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("downloads.json");
    let original: &[u8] = br#"{"version":1,"jobs":[]} "#;
    std::fs::write(&path, original).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();

    let store = Store::new(dir.path());
    let loaded = store.load();
    assert!(loaded.is_empty());
    assert!(!store.is_writable(), "a store whose file couldn't be read must refuse to write");
    store.save(&[job("a", JobState::Pending, "/x/a")]).unwrap();

    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original, "the unreadable file was overwritten");
}

#[test]
fn readable_store_is_writable() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path());
    store.load();
    assert!(store.is_writable());
}
