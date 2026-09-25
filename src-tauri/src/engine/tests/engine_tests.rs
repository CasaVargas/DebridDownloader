use super::mock_server::*;
use super::pipeline_tests::make_zip;
use super::support::*;
use crate::engine::*;
use std::sync::Arc;
use std::time::Duration;

fn fast_timing() -> Timing {
    Timing {
        backoff_base: Duration::from_millis(20),
        backoff_cap: Duration::from_millis(100),
        max_attempts: 3,
        offline_retry: Duration::from_millis(100),
        save_interval: Duration::from_millis(50),
        emit_interval: Duration::from_millis(10),
        shutdown_grace: Duration::from_secs(1),
        tick: Duration::from_millis(20),
    }
}

struct Harness {
    engine: Engine,
    sink: Arc<RecordingSink>,
    data: tempfile::TempDir,
    out: tempfile::TempDir,
}

fn start(data: tempfile::TempDir, out: tempfile::TempDir, config: EngineConfig) -> Harness {
    let sink = Arc::new(RecordingSink::default());
    let engine = Engine::start(EngineDeps {
        data_dir: data.path().to_path_buf(),
        config,
        sink: sink.clone(),
        refresher: no_refresh(),
        remote: Arc::new(NoRemote),
        transfer: fast_transfer_cfg(),
        timing: fast_timing(),
    });
    Harness { engine, sink, data, out }
}

fn harness(config: EngineConfig) -> Harness {
    start(tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), config)
}

impl Harness {
    fn new_job(&self, name: &str, url: String, size: i64, batch: &str) -> NewJob {
        NewJob {
            kind: JobKind::Http,
            filename: name.into(),
            destination: self.out.path().join(name).to_string_lossy().to_string(),
            source: LinkSource::Direct,
            url,
            total_bytes: size,
            batch_id: batch.into(),
        }
    }

    async fn wait_until(&self, what: &str, f: impl Fn(&[JobView]) -> bool) -> Vec<JobView> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let list = self.engine.list().await;
            if f(&list) {
                return list;
            }
            if tokio::time::Instant::now() > deadline {
                panic!("timed out waiting for {what}: {list:#?}");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

fn all(state: JobState) -> impl Fn(&[JobView]) -> bool {
    move |l: &[JobView]| !l.is_empty() && l.iter().all(|j| j.status == state)
}

fn slow(size: usize) -> MockOpts {
    MockOpts { size, ranges: true, chunk_delay: Some(Duration::from_millis(3)), ..Default::default() }
}

#[tokio::test]
async fn enqueue_downloads_and_finishes_batch() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 300_000, "b1"), h.new_job("b.bin", s.url(), 300_000, "b1")]).await;
    assert_eq!(ids.len(), 2);
    let list = h.wait_until("both complete", all(JobState::Completed)).await;
    for j in &list {
        assert_eq!(read(&j.destination), s.data());
        assert_eq!(j.downloaded_bytes, 300_000);
    }
    assert_eq!(h.sink.batch_finished(), vec!["b1".to_string()]);
    assert!(h.sink.list_changed() >= 1);
}

#[tokio::test]
async fn duplicate_destination_is_deduped() {
    let s = MockServer::start(slow(500_000)).await;
    let h = harness(EngineConfig::default());
    let a = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 500_000, "b1")]).await;
    let b = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 500_000, "b2")]).await;
    assert_eq!(a, b);
    assert_eq!(h.engine.list().await.len(), 1);
}

#[tokio::test]
async fn concurrency_limit_is_global_across_batches() {
    let s = MockServer::start(slow(300_000)).await;
    let h = harness(EngineConfig { max_concurrent: 2, ..Default::default() });
    h.engine.enqueue((0..3).map(|i| h.new_job(&format!("a{i}"), s.url(), 300_000, "A")).collect()).await;
    h.engine.enqueue((0..3).map(|i| h.new_job(&format!("b{i}"), s.url(), 300_000, "B")).collect()).await;
    let mut max_running = 0;
    loop {
        let list = h.engine.list().await;
        max_running = max_running.max(list.iter().filter(|j| j.status == JobState::Downloading).count());
        if list.iter().all(|j| j.status == JobState::Completed) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(max_running <= 2, "saw {max_running} concurrent downloads");
}

#[tokio::test]
async fn restart_resumes_from_checkpoint() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig::default());
    h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 2_000_000, "b1")]).await;
    h.wait_until("some progress", |l| l.iter().any(|j| j.downloaded_bytes > 200_000)).await;
    h.engine.shutdown().await;

    let saved = std::fs::read_to_string(h.data.path().join("downloads.json")).unwrap();
    assert!(saved.contains("\"Downloading\""), "job persisted as in-flight");

    s.update(|o| o.chunk_delay = None);
    let before = s.ranges().len();
    let h2 = start(h.data, h.out, EngineConfig::default());
    let list = h2.wait_until("resumed and completed", all(JobState::Completed)).await;
    assert_eq!(read(&list[0].destination), s.data());
    assert!(s.ranges()[before..].iter().any(|r| r.0 > 0), "second run resumed mid-file");
}

#[tokio::test]
async fn pause_resume_and_cancel() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 2_000_000, "b1"), h.new_job("c.bin", s.url(), 2_000_000, "b1")]).await;
    h.wait_until("downloading", |l| l.iter().all(|j| j.downloaded_bytes > 0)).await;

    h.engine.pause(&ids[0]);
    h.engine.cancel(&ids[1]);
    let list = h.wait_until("paused + cancelled", |l| {
        l.iter().any(|j| j.id == ids[0] && j.status == JobState::Paused)
            && l.iter().any(|j| j.id == ids[1] && j.status == JobState::Cancelled)
    })
    .await;
    let paused = list.iter().find(|j| j.id == ids[0]).unwrap();
    let cancelled = list.iter().find(|j| j.id == ids[1]).unwrap();
    assert!(std::path::Path::new(&format!("{}.part", paused.destination)).exists());
    assert!(!std::path::Path::new(&format!("{}.part", cancelled.destination)).exists());

    s.update(|o| o.chunk_delay = None);
    h.engine.resume(&ids[0]);
    let list = h.wait_until("resumed", |l| l.iter().any(|j| j.id == ids[0] && j.status == JobState::Completed)).await;
    assert_eq!(read(&list.iter().find(|j| j.id == ids[0]).unwrap().destination), s.data());
}

#[tokio::test]
async fn transient_failures_back_off_then_fail_then_retry_succeeds() {
    let s = MockServer::start(MockOpts {
        size: 200_000, ranges: true, drop_after: Some(10), drop_times: 100_000, ..Default::default()
    })
    .await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 200_000, "b1")]).await;
    let list = h.wait_until("failed", |l| matches!(l[0].status, JobState::Failed(_))).await;
    assert_eq!(list[0].attempt, 3);

    s.update(|o| o.drop_times = 0);
    h.engine.retry(&ids[0]);
    h.wait_until("completed after retry", all(JobState::Completed)).await;
}

#[tokio::test]
async fn offline_does_not_consume_attempts() {
    let port = free_port();
    let h = harness(EngineConfig::default());
    h.engine.enqueue(vec![h.new_job("a.bin", format!("http://127.0.0.1:{port}/file/t0"), 100_000, "b1")]).await;
    h.wait_until("waiting for network", |l| l[0].waiting_for_network).await;
    tokio::time::sleep(Duration::from_millis(400)).await; // several offline retries
    assert_eq!(h.engine.list().await[0].attempt, 0);

    let s = MockServer::start_on(port, MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let list = h.wait_until("completed once online", all(JobState::Completed)).await;
    assert_eq!(read(&list[0].destination), s.data());
}

#[tokio::test]
async fn raising_concurrency_applies_live() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig { max_concurrent: 1, ..Default::default() });
    h.engine.enqueue((0..3).map(|i| h.new_job(&format!("a{i}"), s.url(), 2_000_000, "A")).collect()).await;
    h.wait_until("one running", |l| l.iter().filter(|j| j.status == JobState::Downloading).count() == 1).await;
    h.engine.set_config(EngineConfig { max_concurrent: 3, ..Default::default() });
    h.wait_until("three running", |l| l.iter().filter(|j| j.status == JobState::Downloading).count() == 3).await;
}

#[tokio::test]
async fn completed_downloads_are_extracted() {
    let zip_dir = tempfile::tempdir().unwrap();
    let zip_path = zip_dir.path().join("pack.zip");
    make_zip(&zip_path);
    let bytes = std::fs::read(&zip_path).unwrap();
    let s = MockServer::start(MockOpts { size: bytes.len(), ranges: true, data: Some(bytes.clone()), ..Default::default() }).await;
    let mut cfg = EngineConfig::default();
    cfg.post.auto_extract = true;
    let h = harness(cfg);
    h.engine.enqueue(vec![h.new_job("pack.zip", s.url(), bytes.len() as i64, "b1")]).await;
    h.wait_until("completed", all(JobState::Completed)).await;
    assert!(h.out.path().join("pack").join("inner.txt").exists());
}

#[tokio::test]
async fn remove_completed_keeps_the_file() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 1000, "b1")]).await;
    let list = h.wait_until("completed", all(JobState::Completed)).await;
    h.engine.remove(&ids[0]);
    h.wait_until("removed", |l| l.is_empty()).await;
    assert!(std::path::Path::new(&list[0].destination).exists());
}

// ── Final-review fixes ──

#[tokio::test]
async fn requeue_of_failed_destination_reuses_the_job() {
    let s = MockServer::start(MockOpts {
        size: 200_000, ranges: true, drop_after: Some(10), drop_times: 100_000, ..Default::default()
    })
    .await;
    let h = harness(EngineConfig::default());
    let a = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 200_000, "b1")]).await;
    h.wait_until("failed", |l| matches!(l[0].status, JobState::Failed(_))).await;
    s.update(|o| o.drop_times = 0);
    let b = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 200_000, "b2")]).await;
    assert_eq!(a, b, "re-adding a failed file must reuse its job, not create a second writer of the same .part");
    let list = h.wait_until("completed", all(JobState::Completed)).await;
    assert_eq!(list.len(), 1);
    assert_eq!(read(&list[0].destination), s.data());
}

#[tokio::test]
async fn clear_keeps_part_of_live_job_with_same_destination() {
    use super::store_tests::job;
    use crate::engine::store::Store;
    let data = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let dest = out.path().join("a.bin").to_string_lossy().to_string();
    std::fs::write(format!("{dest}.part"), vec![0u8; 100]).unwrap();
    let failed = job("old", JobState::Failed("x".into()), &dest);
    let paused = job("live", JobState::Paused, &dest);
    Store::new(data.path()).save(&[failed, paused]).unwrap();
    let h = start(data, out, EngineConfig::default());
    h.wait_until("loaded", |l| l.len() == 2).await;
    h.engine.clear_inactive();
    h.wait_until("failed job cleared", |l| l.len() == 1 && l[0].id == "live").await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(std::path::Path::new(&format!("{dest}.part")).exists(), "the paused job's .part must survive Clear");
}

#[tokio::test]
async fn offline_with_a_queue_does_not_consume_attempts() {
    let port = free_port();
    let h = harness(EngineConfig { max_concurrent: 2, ..Default::default() });
    h.engine
        .enqueue((0..5).map(|i| h.new_job(&format!("a{i}"), format!("http://127.0.0.1:{port}/file/t0"), 100_000, "A")).collect())
        .await;
    h.wait_until("several waiting for network", |l| l.iter().filter(|j| j.waiting_for_network).count() >= 3).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    let list = h.engine.list().await;
    assert!(list.iter().all(|j| j.attempt == 0), "attempts consumed while offline: {list:#?}");
}

#[tokio::test]
async fn remove_then_pause_still_removes() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 2_000_000, "b1")]).await;
    h.wait_until("downloading", |l| l[0].downloaded_bytes > 0).await;
    h.engine.remove(&ids[0]);
    h.engine.pause(&ids[0]);
    h.wait_until("removed", |l| l.is_empty()).await;
}

#[test]
fn finished_transfer_wins_over_pending_stop() {
    use crate::engine::actor::{effective_stop, StopReason};
    use crate::engine::transfer::{TransferError, TransferOutcome};
    let fin: Result<TransferOutcome, TransferError> = Ok(TransferOutcome::Finished);
    let stopped: Result<TransferOutcome, TransferError> = Ok(TransferOutcome::Stopped);
    assert_eq!(effective_stop(Some(StopReason::Pause), &fin), None);
    assert_eq!(effective_stop(Some(StopReason::Cancel), &fin), None);
    assert_eq!(effective_stop(Some(StopReason::Shutdown), &fin), None);
    assert_eq!(effective_stop(Some(StopReason::Remove), &fin), Some(StopReason::Remove));
    assert_eq!(effective_stop(Some(StopReason::Pause), &stopped), Some(StopReason::Pause));
    assert_eq!(effective_stop(None, &stopped), None);
}

fn progress_statuses(sink: &RecordingSink) -> Vec<JobState> {
    sink.events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            EngineEvent::Progress(v) => Some(v.status.clone()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn completed_is_reported_only_after_post_processing() {
    let zip_dir = tempfile::tempdir().unwrap();
    let zip_path = zip_dir.path().join("pack.zip");
    make_zip(&zip_path);
    let bytes = std::fs::read(&zip_path).unwrap();
    let s = MockServer::start(MockOpts { size: bytes.len(), ranges: true, data: Some(bytes.clone()), ..Default::default() }).await;
    let mut cfg = EngineConfig::default();
    cfg.post.auto_extract = true;
    let h = harness(cfg);
    h.engine.enqueue(vec![h.new_job("pack.zip", s.url(), bytes.len() as i64, "b1")]).await;
    h.wait_until("completed", all(JobState::Completed)).await;
    assert!(h.out.path().join("pack").join("inner.txt").exists(), "Completed must mean post-processing is done");
    let statuses = progress_statuses(&h.sink);
    let first_completed = statuses.iter().position(|s| *s == JobState::Completed).expect("a Completed event");
    assert!(
        !statuses[first_completed..].contains(&JobState::Extracting),
        "went Completed → Extracting: {statuses:?}"
    );
}

#[tokio::test]
async fn without_post_processing_goes_straight_to_completed() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let h = harness(EngineConfig::default()); // auto_extract and auto_organize off
    h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 100_000, "b1")]).await;
    h.wait_until("completed", all(JobState::Completed)).await;
    assert!(!progress_statuses(&h.sink).contains(&JobState::Extracting));
}
