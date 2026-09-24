use super::mock_server::*;
use crate::engine::limiter::Limiter;
use crate::engine::segment::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn ctx(url: String, path: std::path::PathBuf) -> SegmentCtx {
    SegmentCtx {
        client: reqwest::Client::new(),
        url,
        path,
        limiter: Arc::new(Limiter::new(None)),
        cancel: CancellationToken::new(),
        use_range: true,
        until_eof: false,
        idle_timeout: Duration::from_millis(300),
        checkpoint_bytes: 64 * 1024,
        checkpoint_interval: Duration::from_millis(50),
    }
}

fn prealloc(dir: &tempfile::TempDir, size: u64) -> std::path::PathBuf {
    let p = dir.path().join("f.part");
    std::fs::File::create(&p).unwrap().set_len(size).unwrap();
    p
}

#[tokio::test]
async fn downloads_its_range() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 300_000);
    let (tx, _rx) = mpsc::unbounded_channel();
    let end = Arc::new(AtomicU64::new(199_999));
    let done = run_segment(&ctx(s.url(), p.clone()), 0, 100_000, 0, end, &tx).await.unwrap();
    assert_eq!(done, 100_000);
    assert_eq!(std::fs::read(&p).unwrap()[100_000..200_000], pattern(300_000)[100_000..200_000]);
}

#[tokio::test]
async fn resumes_from_done_offset() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 100_000);
    let (tx, _rx) = mpsc::unbounded_channel();
    let done = run_segment(&ctx(s.url(), p), 0, 0, 40_000, Arc::new(AtomicU64::new(99_999)), &tx).await.unwrap();
    assert_eq!(done, 100_000);
    assert_eq!(s.ranges(), vec![(40_000, 99_999)]);
}

#[tokio::test]
async fn stops_at_shrunk_end() {
    let s = MockServer::start(MockOpts {
        size: 1_000_000,
        ranges: true,
        chunk_delay: Some(Duration::from_millis(5)),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 1_000_000);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let end = Arc::new(AtomicU64::new(999_999));
    let c = ctx(s.url(), p);
    let end2 = end.clone();
    let h = tokio::spawn(async move { run_segment(&c, 0, 0, 0, end2, &tx).await });
    rx.recv().await.unwrap(); // first bytes arrived
    end.store(99_999, Ordering::SeqCst);
    assert_eq!(h.await.unwrap().unwrap(), 100_000);
}

#[tokio::test]
async fn stall_is_transient() {
    let s = MockServer::start(MockOpts {
        size: 200_000, ranges: true, stall_after: Some(50_000), stall_times: 1, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 200_000);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), p), 0, 0, 0, Arc::new(AtomicU64::new(199_999)), &tx).await.unwrap_err();
    assert_eq!(err, SegmentError::Transient("connection stalled".into()));
    // The last message is a durable checkpoint of what was written.
    let mut last = None;
    while let Ok(m) = rx.try_recv() {
        last = Some(m);
    }
    assert!(matches!(last, Some(SegmentMsg::Checkpoint { done: 50_000, .. })));
}

#[tokio::test]
async fn expired_token_is_dead_link() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let old = s.url();
    s.rotate();
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(old, prealloc(&dir, 1000)), 0, 0, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert!(matches!(err, SegmentError::DeadLink(_)));
}

#[tokio::test]
async fn html_is_dead_link() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, html: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), prealloc(&dir, 1000)), 0, 0, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert!(matches!(err, SegmentError::DeadLink(_)));
}

#[tokio::test]
async fn too_many_connections_is_conn_limit() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, conn_limit: Some(0), ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), prealloc(&dir, 1000)), 0, 0, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert_eq!(err, SegmentError::ConnLimit { retry_after: Some(Duration::ZERO) });
}

#[tokio::test]
async fn ignored_range_is_detected() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: false, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), prealloc(&dir, 1000)), 0, 500, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert_eq!(err, SegmentError::RangeIgnored);
}

#[tokio::test]
async fn cancel_checkpoints_and_returns_cancelled() {
    let s = MockServer::start(MockOpts {
        size: 2_000_000, ranges: true, chunk_delay: Some(Duration::from_millis(5)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 2_000_000);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let c = ctx(s.url(), p.clone());
    let cancel = c.cancel.clone();
    let h = tokio::spawn(async move { run_segment(&c, 0, 0, 0, Arc::new(AtomicU64::new(1_999_999)), &tx).await });
    rx.recv().await.unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    cancel.cancel();
    assert_eq!(h.await.unwrap().unwrap_err(), SegmentError::Cancelled);
    let mut done = 0;
    while let Ok(m) = rx.try_recv() {
        if let SegmentMsg::Checkpoint { done: d, .. } = m {
            done = d;
        }
    }
    assert!(done > 0);
    let on_disk = std::fs::read(&p).unwrap();
    assert_eq!(on_disk[..done as usize], pattern(2_000_000)[..done as usize]);
}
