use super::types::Job;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteOutcome {
    Completed,
    Cancelled,
}

/// Runs a `JobKind::Remote` job (rclone). The runner emits its own progress.
#[async_trait::async_trait]
pub trait RemoteRunner: Send + Sync + 'static {
    async fn run(&self, job: Job, cancel: CancellationToken, speed_limit: Option<u64>) -> Result<RemoteOutcome, String>;
}

/// Used by tests and any host without rclone.
pub struct NoRemote;

#[async_trait::async_trait]
impl RemoteRunner for NoRemote {
    async fn run(&self, _job: Job, _cancel: CancellationToken, _speed_limit: Option<u64>) -> Result<RemoteOutcome, String> {
        Err("rclone destinations are not supported here".to_string())
    }
}
