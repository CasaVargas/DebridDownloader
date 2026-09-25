use crate::engine::events::{EngineEvent, EventSink};
use crate::engine::refresh::{LinkRefresher, RefreshError, RefreshedLink};
use crate::engine::transfer::TransferConfig;
use crate::engine::types::LinkSource;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct RecordingSink {
    pub events: Mutex<Vec<EngineEvent>>,
}
impl EventSink for RecordingSink {
    fn emit(&self, event: EngineEvent) {
        self.events.lock().unwrap().push(event);
    }
}
impl RecordingSink {
    pub fn batch_finished(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                EngineEvent::BatchFinished { batch_id } => Some(batch_id.clone()),
                _ => None,
            })
            .collect()
    }
    pub fn list_changed(&self) -> usize {
        self.events.lock().unwrap().iter().filter(|e| matches!(e, EngineEvent::ListChanged)).count()
    }
}

pub struct FakeRefresher {
    pub calls: AtomicUsize,
    f: Box<dyn Fn() -> Result<String, RefreshError> + Send + Sync>,
}
impl FakeRefresher {
    pub fn new(f: impl Fn() -> Result<String, RefreshError> + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { calls: AtomicUsize::new(0), f: Box::new(f) })
    }
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}
#[async_trait::async_trait]
impl LinkRefresher for FakeRefresher {
    async fn refresh(&self, _source: &LinkSource) -> Result<RefreshedLink, RefreshError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        (self.f)().map(|url| RefreshedLink { url })
    }
}

pub fn no_refresh() -> Arc<FakeRefresher> {
    FakeRefresher::new(|| Err(RefreshError::NotRefreshable))
}

/// Small sizes and short timeouts so tests run in milliseconds.
pub fn fast_transfer_cfg() -> TransferConfig {
    TransferConfig {
        segments_per_file: 4,
        min_segment: 64 * 1024,
        split_threshold: 128 * 1024,
        connect_timeout: Duration::from_secs(2),
        idle_timeout: Duration::from_millis(300),
        segment_retries: 5,
        retry_base: Duration::from_millis(10),
        checkpoint_bytes: 64 * 1024,
        checkpoint_interval: Duration::from_millis(50),
        progress_interval: Duration::from_millis(20),
    }
}

pub fn read(path: impl AsRef<std::path::Path>) -> Vec<u8> {
    std::fs::read(path).unwrap()
}
