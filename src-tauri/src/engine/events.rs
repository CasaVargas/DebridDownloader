use super::types::JobState;
use serde::Serialize;

/// One row of the downloads list; also the `download-progress` event payload.
/// Field names are a superset of the old `DownloadProgress` / `DownloadTask`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct JobView {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub destination: String,
    pub total_bytes: i64,
    pub downloaded_bytes: i64,
    pub speed: f64,
    pub status: JobState,
    pub remote: Option<String>,
    pub attempt: u32,
    pub retry_at: Option<i64>,
    pub segments_active: u32,
    pub resumable: bool,
    pub error: Option<String>,
    pub waiting_for_network: bool,
}

#[derive(Debug, Clone)]
pub enum EngineEvent {
    Progress(JobView),
    /// A job was added or removed; the UI should refetch the list.
    ListChanged,
    /// Every job in the batch is terminal and at least one completed.
    BatchFinished { batch_id: String },
}

pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
}
