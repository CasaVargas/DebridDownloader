use super::mock_server::*;
use super::support::*;
use super::transfer_tests::{deps, http_job};
use crate::engine::refresh::RefreshError;
use crate::engine::transfer::*;
use crate::engine::types::*;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

async fn run(job: Job, d: TransferDeps) -> (Result<TransferOutcome, TransferError>, Vec<TransferUpdate>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let r = run_transfer(job, d, CancellationToken::new(), tx).await;
    let mut ups = Vec::new();
    while let Ok(u) = rx.try_recv() {
        ups.push(u);
    }
    (r, ups)
}

#[tokio::test]
async fn stall_is_retried() {
    let s = MockServer::start(MockOpts {
        size: 500_000, ranges: true, stall_after: Some(20_000), stall_times: 1, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 500_000);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn dropped_connections_are_retried() {
    let s = MockServer::start(MockOpts {
        size: 500_000, ranges: true, drop_after: Some(30_000), drop_times: 3, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 500_000);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn exhausted_retries_are_transient() {
    let s = MockServer::start(MockOpts {
        size: 500_000, ranges: true, drop_after: Some(10), drop_times: 10_000, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut d = deps(no_refresh());
    d.cfg.segment_retries = 2;
    let (r, _) = run(http_job(&dir, "a.bin", s.url(), 500_000), d).await;
    assert!(matches!(r, Err(TransferError::Transient(_))), "{r:?}");
}

#[tokio::test]
async fn expired_link_is_refreshed_once() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;
    let expired = s.url();
    s.rotate();
    let s2 = s.clone();
    let refresher = FakeRefresher::new(move || Ok(s2.url()));
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", expired, 300_000);
    let (r, ups) = run(j.clone(), deps(refresher.clone())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(refresher.calls(), 1);
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Url(_))));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn failed_refresh_is_fatal() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let expired = s.url();
    s.rotate();
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(http_job(&dir, "a.bin", expired, 1000), deps(no_refresh())).await;
    match r {
        Err(TransferError::Fatal(m)) => assert!(m.contains("couldn't be refreshed"), "{m}"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn provider_mismatch_message() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let expired = s.url();
    s.rotate();
    let refresher = FakeRefresher::new(|| Err(RefreshError::ProviderMismatch("Real-Debrid".into())));
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(http_job(&dir, "a.bin", expired, 1000), deps(refresher)).await;
    assert_eq!(r, Err(TransferError::Fatal("Switch back to Real-Debrid to resume".into())));
}

#[tokio::test]
async fn html_body_triggers_refresh() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, html: true, ..Default::default() }).await;
    let s2 = s.clone();
    let refresher = FakeRefresher::new(move || {
        s2.update(|o| o.html = false);
        Ok(s2.url())
    });
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(http_job(&dir, "a.bin", s.url(), 1000), deps(refresher.clone())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(refresher.calls(), 1);
}

#[tokio::test]
async fn connection_limit_halves_segments() {
    let s = MockServer::start(MockOpts {
        size: 1_000_000, ranges: true, conn_limit: Some(2), chunk_delay: Some(Duration::from_millis(1)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut d = deps(no_refresh());
    d.cfg.segments_per_file = 8;
    let j = http_job(&dir, "a.bin", s.url(), 1_000_000);
    let (r, ups) = run(j.clone(), d).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::MaxSegments(n) if *n <= 4)));
    assert!(s.max_active() <= 2);
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn ignored_range_mid_download_falls_back_to_single_stream() {
    let s = MockServer::start(MockOpts { size: 500_000, ranges_probe_only: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 500_000);
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { resumable: false, .. })));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn size_change_resets_once_then_fails() {
    let s = MockServer::start(MockOpts { size: 400_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut j = http_job(&dir, "a.bin", s.url(), 300_000);
    std::fs::File::create(j.part_path()).unwrap().set_len(300_000).unwrap();
    j.segments = vec![SegmentState { start: 0, end: 299_999, done: 1000 }];
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { size_resets: 1, .. })));
    assert_eq!(read(&j.destination), s.data());

    let mut j2 = http_job(&dir, "b.bin", s.url(), 300_000);
    std::fs::File::create(j2.part_path()).unwrap().set_len(300_000).unwrap();
    j2.segments = vec![SegmentState { start: 0, end: 299_999, done: 1000 }];
    j2.size_resets = 1;
    let (r, _) = run(j2, deps(no_refresh())).await;
    assert!(matches!(r, Err(TransferError::Fatal(m)) if m.contains("changed")));
}

#[tokio::test]
async fn unreachable_host_is_offline() {
    let port = free_port();
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", format!("http://127.0.0.1:{port}/file/t0"), 1000);
    let (r, _) = run(j, deps(no_refresh())).await;
    assert!(matches!(r, Err(TransferError::Offline(_))), "{r:?}");
}

#[tokio::test]
async fn tail_is_split_across_free_workers() {
    let size = 2_000_000usize;
    let s = MockServer::start(MockOpts {
        size, ranges: true, chunk_delay: Some(Duration::from_millis(2)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut j = http_job(&dir, "a.bin", s.url(), size as i64);
    std::fs::File::create(j.part_path()).unwrap().set_len(size as u64).unwrap();
    // One tiny segment and one huge one: the tiny one finishes first and should take half the tail.
    j.segments = vec![
        SegmentState { start: 0, end: 65_535, done: 0 },
        SegmentState { start: 65_536, end: size as u64 - 1, done: 0 },
    ];
    let mut d = deps(no_refresh());
    d.cfg.segments_per_file = 2;
    let (r, ups) = run(j.clone(), d).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    let max_segments = ups
        .iter()
        .filter_map(|u| match u {
            TransferUpdate::Checkpoint { segments } => Some(segments.len()),
            _ => None,
        })
        .max()
        .unwrap();
    assert!(max_segments > 2, "expected a split, max segments seen = {max_segments}");
    assert_eq!(read(&j.destination), s.data());
}
