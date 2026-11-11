//! Tauri wrappers; the bodies live in `crate::service::torrents`.
use crate::providers::types::{AddTorrentResponse, Torrent, TorrentInfo};
use crate::service::torrents as svc;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_torrents(
    state: State<'_, AppState>,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<Torrent>, String> {
    svc::list_torrents(&state, page, limit).await
}

#[tauri::command]
pub async fn get_torrent_info(state: State<'_, AppState>, id: String) -> Result<TorrentInfo, String> {
    svc::get_torrent_info(&state, &id).await
}

#[tauri::command]
pub async fn add_magnet(state: State<'_, AppState>, magnet: String) -> Result<AddTorrentResponse, String> {
    svc::add_magnet(&state, &magnet).await
}

#[tauri::command]
pub async fn add_torrent_file(state: State<'_, AppState>, file_bytes: Vec<u8>) -> Result<AddTorrentResponse, String> {
    svc::add_torrent_file(&state, &file_bytes).await
}

#[tauri::command]
pub async fn select_torrent_files(state: State<'_, AppState>, id: String, file_ids: String) -> Result<(), String> {
    svc::select_torrent_files(&state, &id, &file_ids).await
}

#[tauri::command]
pub async fn delete_torrent(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::delete_torrent(&state, &id).await
}
