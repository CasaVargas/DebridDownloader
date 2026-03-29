use crate::providers::DebridProvider;
use crate::watchlist::{WatchMatch, WatchRule};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub download_folder: Option<String>,
    pub max_concurrent_downloads: u32,
    pub create_torrent_subfolders: bool,
    pub theme: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub symlink_mode: bool,
    #[serde(default)]
    pub symlink_mount_path: Option<String>,
    #[serde(default)]
    pub symlink_library_path: Option<String>,
    #[serde(default)]
    pub auto_organize: bool,
    #[serde(default)]
    pub movies_folder: Option<String>,
    #[serde(default)]
    pub tv_folder: Option<String>,
    #[serde(default)]
    pub tmdb_api_key: Option<String>,
    #[serde(default)]
    pub plex_url: Option<String>,
    #[serde(default)]
    pub plex_token: Option<String>,
    #[serde(default)]
    pub jellyfin_url: Option<String>,
    #[serde(default)]
    pub jellyfin_api_key: Option<String>,
    #[serde(default)]
    pub emby_url: Option<String>,
    #[serde(default)]
    pub emby_api_key: Option<String>,
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
            symlink_mode: false,
            symlink_mount_path: None,
            symlink_library_path: None,
            auto_organize: false,
            movies_folder: None,
            tv_folder: None,
            tmdb_api_key: None,
            plex_url: None,
            plex_token: None,
            jellyfin_url: None,
            jellyfin_api_key: None,
            emby_url: None,
            emby_api_key: None,
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
    pub watch_rules: Arc<RwLock<Vec<WatchRule>>>,
    pub watch_matches: Arc<RwLock<Vec<WatchMatch>>>,
    pub watch_seen: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    pub watch_cancel: CancellationToken,
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
            watch_rules: Arc::new(RwLock::new(Vec::new())),
            watch_matches: Arc::new(RwLock::new(Vec::new())),
            watch_seen: Arc::new(RwLock::new(HashMap::new())),
            watch_cancel: CancellationToken::new(),
        }
    }

    /// Get a cloneable reference to the current provider.
    /// Use this instead of holding the RwLock across async operations.
    pub async fn get_provider(&self) -> Arc<dyn DebridProvider> {
        self.provider.read().await.clone()
    }
}
