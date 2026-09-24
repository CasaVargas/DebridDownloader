use super::store_tests::job;
use crate::engine::pipeline::*;
use crate::engine::types::*;
use std::io::Write;
use tokio::sync::mpsc;

pub fn make_zip(path: &std::path::Path) {
    let f = std::fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    z.start_file("inner.txt", zip::write::SimpleFileOptions::default()).unwrap();
    z.write_all(b"hello").unwrap();
    z.finish().unwrap();
}

#[tokio::test]
async fn siblings_exclude_part_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.r00"), b"x").unwrap();
    std::fs::write(dir.path().join("a.r01.part"), b"x").unwrap();
    let names: Vec<String> = list_siblings(dir.path())
        .await
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect();
    assert_eq!(names, vec!["a.r00".to_string()]);
}

#[tokio::test]
async fn extracts_then_marks_done() {
    let dir = tempfile::tempdir().unwrap();
    let zip_path = dir.path().join("archive.zip");
    make_zip(&zip_path);
    let mut j = job("a", JobState::Completed, &zip_path.to_string_lossy());
    j.post = PostStage::Extract;
    let cfg = PostConfig { auto_extract: true, ..Default::default() };
    let (tx, mut rx) = mpsc::unbounded_channel();
    let res = run_post(&j, &cfg, &tx).await;
    assert_eq!(res.error, None);
    assert_eq!(std::fs::read(dir.path().join("archive").join("inner.txt")).unwrap(), b"hello");
    let mut evs = Vec::new();
    while let Ok(e) = rx.try_recv() {
        evs.push(e);
    }
    assert!(matches!(evs.first(), Some(PipelineEvent::Extracting)));
    assert!(matches!(evs.last(), Some(PipelineEvent::Stage(PostStage::Done))));
}

#[tokio::test]
async fn disabled_steps_just_finish() {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("movie.mkv");
    std::fs::write(&f, b"x").unwrap();
    let mut j = job("a", JobState::Completed, &f.to_string_lossy());
    j.post = PostStage::Extract;
    let (tx, _rx) = mpsc::unbounded_channel();
    let res = run_post(&j, &PostConfig::default(), &tx).await;
    assert_eq!(res.destination, j.destination);
    assert_eq!(res.error, None);
}
