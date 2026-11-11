use crate::providers::types::{AddTorrentResponse, Torrent, TorrentInfo};
use crate::state::AppState;

pub async fn list_torrents(state: &AppState, page: Option<u32>, limit: Option<u32>) -> Result<Vec<Torrent>, String> {
    let provider = state.get_provider().await;
    provider
        .list_torrents(page.unwrap_or(1), limit.unwrap_or(100))
        .await
        .map_err(|e| format!("{}", e))
}

pub async fn get_torrent_info(state: &AppState, id: &str) -> Result<TorrentInfo, String> {
    let provider = state.get_provider().await;
    provider.torrent_info(id).await.map_err(|e| format!("{}", e))
}

pub async fn add_magnet(state: &AppState, magnet: &str) -> Result<AddTorrentResponse, String> {
    let provider = state.get_provider().await;
    provider.add_magnet(magnet).await.map_err(|e| format!("{}", e))
}

pub async fn add_torrent_file(state: &AppState, file_bytes: &[u8]) -> Result<AddTorrentResponse, String> {
    let provider = state.get_provider().await;
    provider.add_torrent_file(file_bytes).await.map_err(|e| format!("{}", e))
}

/// `file_ids` is `"all"` or a comma-separated id list; unparsable ids are skipped.
pub fn parse_file_ids(file_ids: &str) -> Vec<u64> {
    if file_ids == "all" {
        vec![]
    } else {
        file_ids.split(',').filter_map(|s| s.trim().parse().ok()).collect()
    }
}

pub async fn select_torrent_files(state: &AppState, id: &str, file_ids: &str) -> Result<(), String> {
    let ids = parse_file_ids(file_ids);
    let provider = state.get_provider().await;
    provider.select_files(id, &ids).await.map_err(|e| format!("{}", e))
}

pub async fn delete_torrent(state: &AppState, id: &str) -> Result<(), String> {
    let provider = state.get_provider().await;
    provider.delete_torrent(id).await.map_err(|e| format!("{}", e))
}
