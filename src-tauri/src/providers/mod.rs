pub mod premiumize;
pub mod real_debrid;
pub mod torbox;
pub mod types;

use async_trait::async_trait;
use std::any::Any;
use types::*;

#[async_trait]
pub trait DebridProvider: Send + Sync {
    /// For downcasting to concrete provider types (e.g., RdClient for OAuth flows)
    fn as_any(&self) -> &dyn Any;

    fn info(&self) -> ProviderInfo;

    // Auth: set and validate credentials (not the full OAuth flow)
    async fn authenticate(&self, auth: &ProviderAuth) -> Result<User, ProviderError>;
    async fn is_authenticated(&self) -> bool;

    // Torrents
    async fn list_torrents(&self, page: u32, limit: u32) -> Result<Vec<Torrent>, ProviderError>;
    async fn torrent_info(&self, id: &str) -> Result<TorrentInfo, ProviderError>;
    async fn add_magnet(&self, magnet: &str) -> Result<AddTorrentResponse, ProviderError>;
    async fn add_torrent_file(&self, bytes: &[u8]) -> Result<AddTorrentResponse, ProviderError>;
    async fn select_files(&self, id: &str, file_ids: &[u64]) -> Result<(), ProviderError>;
    async fn delete_torrent(&self, id: &str) -> Result<(), ProviderError>;

    // Links & Downloads
    async fn get_download_links(&self, id: &str) -> Result<Vec<DownloadLink>, ProviderError>;
    async fn get_download_link_for_file(
        &self,
        torrent_id: &str,
        file_id: u64,
    ) -> Result<DownloadLink, ProviderError>;

    /// Links for only these files (ids from `TorrentInfo.files`). Like `get_download_links`, a file
    /// that fails is logged and skipped; it errors only when none of the files resolve.
    async fn get_download_links_for_files(
        &self,
        torrent_id: &str,
        file_ids: &[u64],
    ) -> Result<Vec<DownloadLink>, ProviderError> {
        let mut links = Vec::new();
        let mut first_err = None;
        for &file_id in file_ids {
            match self.get_download_link_for_file(torrent_id, file_id).await {
                Ok(link) => links.push(link),
                Err(e) => {
                    log::warn!("Failed to get link for file {}: {}", file_id, e);
                    first_err.get_or_insert(e);
                }
            }
        }
        match first_err {
            Some(e) if links.is_empty() => Err(e),
            _ => Ok(links),
        }
    }

    /// Get a fresh direct URL for a file whose link expired.
    async fn refresh_link(&self, source: &LinkSource) -> Result<DownloadLink, ProviderError>;

    // History
    async fn download_history(
        &self,
        page: u32,
        limit: u32,
    ) -> Result<Vec<DownloadItem>, ProviderError>;

    // Cache availability — returns lowercase hashes that are instantly available
    async fn check_availability(&self, hashes: &[String]) -> Result<Vec<String>, ProviderError>;
}

/// List of all available provider IDs
pub fn available_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo {
            id: "real-debrid".to_string(),
            name: "Real-Debrid".to_string(),
            auth_method: AuthMethod::OAuthDevice,
            supports_streaming: true,
        },
        ProviderInfo {
            id: "torbox".to_string(),
            name: "TorBox".to_string(),
            auth_method: AuthMethod::ApiKey,
            supports_streaming: true,
        },
        ProviderInfo {
            id: "premiumize".to_string(),
            name: "Premiumize".to_string(),
            auth_method: AuthMethod::ApiKey,
            supports_streaming: true,
        },
    ]
}
