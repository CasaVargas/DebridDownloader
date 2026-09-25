//! Download engine. Must stay free of Tauri types (see specs/2026-09-23-resilient-download-engine-design.md).

pub mod actor;
pub mod events;
pub mod limiter;
pub mod pipeline;
pub mod refresh;
pub mod remote;
pub mod segment;
pub mod store;
pub mod transfer;
pub mod types;

#[cfg(test)]
mod tests;

pub use events::{EngineEvent, EventSink, JobView};
pub use refresh::{LinkRefresher, RefreshError, RefreshedLink};
#[cfg(test)]
pub use remote::NoRemote;
pub use remote::{RemoteOutcome, RemoteRunner};
pub use types::*;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

pub use transfer::TransferConfig;

#[derive(Debug, Clone)]
pub struct Timing {
    pub backoff_base: Duration,
    pub backoff_cap: Duration,
    pub max_attempts: u32,
    pub offline_retry: Duration,
    pub save_interval: Duration,
    pub emit_interval: Duration,
    pub shutdown_grace: Duration,
    pub tick: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            backoff_base: Duration::from_secs(5),
            backoff_cap: Duration::from_secs(300),
            max_attempts: 8,
            offline_retry: Duration::from_secs(30),
            save_interval: Duration::from_secs(2),
            emit_interval: Duration::from_millis(100),
            shutdown_grace: Duration::from_secs(2),
            tick: Duration::from_millis(250),
        }
    }
}

pub struct EngineDeps {
    pub data_dir: PathBuf,
    pub config: EngineConfig,
    pub sink: Arc<dyn EventSink>,
    pub refresher: Arc<dyn LinkRefresher>,
    pub remote: Arc<dyn RemoteRunner>,
    pub transfer: TransferConfig,
    pub timing: Timing,
}

impl EngineDeps {
    pub fn new(
        data_dir: PathBuf,
        config: EngineConfig,
        sink: Arc<dyn EventSink>,
        refresher: Arc<dyn LinkRefresher>,
        remote: Arc<dyn RemoteRunner>,
    ) -> Self {
        Self { data_dir, config, sink, refresher, remote, transfer: TransferConfig::default(), timing: Timing::default() }
    }
}

#[derive(Clone)]
pub struct Engine {
    tx: mpsc::UnboundedSender<actor::EngineMsg>,
}

impl Engine {
    /// Must be called from inside a Tokio runtime.
    pub fn start(deps: EngineDeps) -> Engine {
        let (tx, rx) = mpsc::unbounded_channel();
        actor::Actor::spawn(deps, tx.clone(), rx);
        Engine { tx }
    }

    pub async fn enqueue(&self, jobs: Vec<NewJob>) -> Vec<String> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(actor::EngineMsg::Enqueue { jobs, reply });
        rx.await.unwrap_or_default()
    }

    pub async fn add_completed(&self, job: NewJob) -> String {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(actor::EngineMsg::AddCompleted { job, reply });
        rx.await.unwrap_or_default()
    }

    pub async fn list(&self) -> Vec<JobView> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(actor::EngineMsg::List(reply));
        rx.await.unwrap_or_default()
    }

    fn control(&self, c: actor::Control) {
        let _ = self.tx.send(actor::EngineMsg::Control(c));
    }
    pub fn pause(&self, id: &str) { self.control(actor::Control::Pause(id.to_string())) }
    pub fn resume(&self, id: &str) { self.control(actor::Control::Resume(id.to_string())) }
    pub fn cancel(&self, id: &str) { self.control(actor::Control::Cancel(id.to_string())) }
    pub fn retry(&self, id: &str) { self.control(actor::Control::Retry(id.to_string())) }
    pub fn remove(&self, id: &str) { self.control(actor::Control::Remove(id.to_string())) }
    pub fn pause_all(&self) { self.control(actor::Control::PauseAll) }
    pub fn resume_all(&self) { self.control(actor::Control::ResumeAll) }
    pub fn retry_failed(&self) { self.control(actor::Control::RetryFailed) }
    pub fn cancel_all(&self) { self.control(actor::Control::CancelAll) }
    pub fn clear_inactive(&self) { self.control(actor::Control::ClearInactive) }

    pub fn set_config(&self, cfg: EngineConfig) {
        let _ = self.tx.send(actor::EngineMsg::SetConfig(cfg));
    }

    /// Checkpoint every running job and persist, waiting at most `Timing::shutdown_grace`.
    pub async fn shutdown(&self) {
        let (reply, rx) = oneshot::channel();
        if self.tx.send(actor::EngineMsg::Shutdown(reply)).is_ok() {
            let _ = rx.await;
        }
    }
}
