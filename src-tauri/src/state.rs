use crate::providers::DebridProvider;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub download_folder: Option<String>,
    pub max_concurrent_downloads: u32,
    pub create_torrent_subfolders: bool,
    pub theme: String,
    #[serde(default = "default_provider")]
    pub provider: String,
}

fn default_provider() -> String {
    "real-debrid".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_folder: None,
            max_concurrent_downloads: 3,
            create_torrent_subfolders: true,
            theme: "dark".to_string(),
            provider: default_provider(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub destination: String,
    pub total_bytes: i64,
    pub downloaded_bytes: i64,
    pub speed: f64,
    pub status: DownloadStatus,
    #[serde(default)]
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Paused,
    Completed,
    Failed(String),
    Cancelled,
}

pub struct StreamSession {
    pub url: String,
    pub created_at: Instant,
}

pub struct AppState {
    pub provider: Arc<RwLock<Arc<dyn DebridProvider>>>,
    pub provider_id: Arc<RwLock<String>>,
    pub settings: Arc<RwLock<AppSettings>>,
    pub active_downloads: Arc<RwLock<HashMap<String, DownloadTask>>>,
    pub cancel_tokens: Arc<RwLock<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
    pub streaming_port: Arc<RwLock<Option<u16>>>,
    pub stream_sessions: Arc<RwLock<HashMap<String, StreamSession>>>,
}

impl AppState {
    pub fn new() -> Self {
        use crate::providers::real_debrid::client::RdClient;
        let provider: Arc<dyn DebridProvider> = Arc::new(RdClient::new());
        Self {
            provider: Arc::new(RwLock::new(provider)),
            provider_id: Arc::new(RwLock::new("real-debrid".to_string())),
            settings: Arc::new(RwLock::new(AppSettings::default())),
            active_downloads: Arc::new(RwLock::new(HashMap::new())),
            cancel_tokens: Arc::new(RwLock::new(HashMap::new())),
            streaming_port: Arc::new(RwLock::new(None)),
            stream_sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get a cloneable reference to the current provider.
    /// Use this instead of holding the RwLock across async operations.
    pub async fn get_provider(&self) -> Arc<dyn DebridProvider> {
        self.provider.read().await.clone()
    }
}
