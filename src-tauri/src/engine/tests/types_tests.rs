use crate::engine::types::*;
use crate::providers::types::DownloadLink;

#[test]
fn job_state_serializes_like_old_download_status() {
    assert_eq!(serde_json::to_string(&JobState::Pending).unwrap(), "\"Pending\"");
    assert_eq!(serde_json::to_string(&JobState::Downloading).unwrap(), "\"Downloading\"");
    assert_eq!(
        serde_json::to_string(&JobState::Failed("boom".into())).unwrap(),
        "{\"Failed\":\"boom\"}"
    );
    let back: JobState = serde_json::from_str("{\"Failed\":\"x\"}").unwrap();
    assert_eq!(back, JobState::Failed("x".into()));
}

#[test]
fn link_source_is_tagged_and_defaults_to_direct() {
    let s = LinkSource::RealDebrid { hoster_link: "https://h/x".into() };
    assert_eq!(
        serde_json::to_string(&s).unwrap(),
        "{\"type\":\"RealDebrid\",\"hoster_link\":\"https://h/x\"}"
    );
    let link: DownloadLink =
        serde_json::from_str("{\"filename\":\"a\",\"filesize\":1,\"download\":\"u\",\"streamable\":null}").unwrap();
    assert_eq!(link.source, LinkSource::Direct);
    assert_eq!(LinkSource::Direct.provider_id(), None);
    assert_eq!(s.provider_id(), Some("real-debrid"));
}

#[test]
fn job_deserializes_with_only_required_fields() {
    let json = r#"{"id":"1","kind":{"type":"Http"},"filename":"f","destination":"/tmp/f",
        "url":"u","total_bytes":10,"state":"Pending","created_at":0,"updated_at":0}"#;
    let job: Job = serde_json::from_str(json).unwrap();
    assert!(job.resumable);
    assert_eq!(job.max_segments, 16);
    assert_eq!(job.post, PostStage::None);
    assert_eq!(job.source, LinkSource::Direct);
    assert_eq!(job.part_path().to_string_lossy(), "/tmp/f.part");
}

#[test]
fn segment_math() {
    let s = SegmentState { start: 100, end: 199, done: 30 };
    assert_eq!(s.len(), 100);
    assert_eq!(s.pos(), 130);
    assert_eq!(s.remaining(), 70);
    assert!(!s.is_done());
    assert!(SegmentState { start: 0, end: 9, done: 10 }.is_done());
}
