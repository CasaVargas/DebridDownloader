use super::mock_server::*;
use super::store_tests::job;
use super::support::*;
use crate::engine::limiter::Limiter;
use crate::engine::transfer::*;
use crate::engine::types::*;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub fn deps(refresher: Arc<FakeRefresher>) -> TransferDeps {
    let cfg = fast_transfer_cfg();
    TransferDeps { client: build_client(&cfg), limiter: Arc::new(Limiter::new(None)), refresher, cfg }
}

pub fn http_job(dir: &tempfile::TempDir, name: &str, url: String, size: i64) -> Job {
    let mut j = job(name, JobState::Downloading, &dir.path().join(name).to_string_lossy());
    j.url = url;
    j.total_bytes = size;
    j
}

async fn run(job: Job, d: TransferDeps) -> (Result<TransferOutcome, TransferError>, Vec<TransferUpdate>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let r = run_transfer(job, d, CancellationToken::new(), tx).await;
    let mut ups = Vec::new();
    while let Ok(u) = rx.try_recv() {
        ups.push(u);
    }
    (r, ups)
}

#[test]
fn plan_respects_min_segment_and_max() {
    assert_eq!(plan_segments(100, 4, 1000), vec![SegmentState { start: 0, end: 99, done: 0 }]);
    let p = plan_segments(1000, 4, 100);
    assert_eq!(p.len(), 4);
    assert_eq!(p[0], SegmentState { start: 0, end: 249, done: 0 });
    assert_eq!(p[3].end, 999);
    let p = plan_segments(1001, 3, 100);
    assert_eq!(p.iter().map(|s| s.len()).sum::<u64>(), 1001);
}

#[tokio::test]
async fn segmented_download_matches_source() {
    let s = MockServer::start(MockOpts { size: 1_000_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 1_000_000);
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
    assert!(!j.part_path().exists());
    assert!(s.ranges().len() >= 4, "expected parallel ranges, got {:?}", s.ranges());
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { resumable: true, .. })));
}

#[tokio::test]
async fn no_range_server_downloads_single_stream() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: false, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 300_000);
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { resumable: false, .. })));
}

#[tokio::test]
async fn zero_byte_file_completes() {
    let s = MockServer::start(MockOpts { size: 0, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "empty.bin", s.url(), 0);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination).len(), 0);
}

#[tokio::test]
async fn unknown_size_streams_to_eof() {
    let s = MockServer::start(MockOpts { size: 200_000, ranges: false, no_length: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 0); // provider didn't know either
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn unicode_filename_downloads() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "Ünïcødé Movie (2024) [1080p].mkv", s.url(), 100_000);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

/// Run until the first checkpoint, stop, and return the job with persisted segments.
async fn run_then_stop(mut j: Job, d: TransferDeps) -> Job {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    let h = tokio::spawn(run_transfer(j.clone(), d, c2, tx));
    let mut last_segments = Vec::new();
    loop {
        match rx.recv().await {
            Some(TransferUpdate::Checkpoint { segments }) if segments.iter().any(|s| s.done > 0) => {
                last_segments = segments;
                cancel.cancel();
                break;
            }
            Some(TransferUpdate::Probed { total_bytes, resumable, .. }) => {
                j.total_bytes = total_bytes;
                j.resumable = resumable;
            }
            Some(_) => {}
            None => break,
        }
    }
    assert_eq!(h.await.unwrap(), Ok(TransferOutcome::Stopped));
    while let Ok(u) = rx.try_recv() {
        if let TransferUpdate::Checkpoint { segments } = u {
            last_segments = segments;
        }
    }
    j.segments = last_segments;
    j
}

#[tokio::test]
async fn resume_after_stop_does_not_refetch_prefix() {
    let s = MockServer::start(MockOpts {
        size: 2_000_000, ranges: true, chunk_delay: Some(Duration::from_millis(2)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = run_then_stop(http_job(&dir, "a.bin", s.url(), 2_000_000), deps(no_refresh())).await;
    assert!(j.part_path().exists(), "pause keeps the .part file");
    let resumed_from: Vec<u64> = j.segments.iter().filter(|s| !s.is_done()).map(|s| s.pos()).collect();
    s.update(|o| o.chunk_delay = None);
    let before = s.ranges().len();
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
    let second_run: Vec<u64> = s.ranges()[before..].iter().map(|r| r.0).collect();
    for pos in resumed_from {
        assert!(second_run.contains(&pos), "expected a request starting at {pos}, got {second_run:?}");
    }
}

#[tokio::test]
async fn part_deleted_while_paused_restarts() {
    let s = MockServer::start(MockOpts {
        size: 1_000_000, ranges: true, chunk_delay: Some(Duration::from_millis(2)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = run_then_stop(http_job(&dir, "a.bin", s.url(), 1_000_000), deps(no_refresh())).await;
    std::fs::remove_file(j.part_path()).unwrap();
    s.update(|o| o.chunk_delay = None);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn complete_part_finalizes_without_network() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = http_job(&dir, "a.bin", "http://127.0.0.1:9/unreachable".into(), 1000);
    std::fs::write(j.part_path(), pattern(1000)).unwrap();
    j.segments = vec![SegmentState { start: 0, end: 999, done: 1000 }];
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), pattern(1000));
}
