//! Tauri wrappers; the bodies live in `crate::service::downloads`.
use crate::engine::JobView;
use crate::engine_host::TauriEvents;
use crate::providers::types::{DownloadItem, DownloadLink};
use crate::service::downloads as svc;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Get download links for a torrent: every file, or only `file_ids` when given.
#[tauri::command]
pub async fn unrestrict_torrent_links(
    state: State<'_, AppState>,
    torrent_id: String,
    file_ids: Option<Vec<u64>>,
) -> Result<Vec<DownloadLink>, String> {
    svc::unrestrict_torrent_links(&state, &torrent_id, file_ids).await
}

/// Queue files for download
#[tauri::command]
pub async fn start_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    links: Vec<DownloadLink>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<Vec<String>, String> {
    svc::start_downloads(&state, Arc::new(TauriEvents::new(app)), links, destination_folder, torrent_name).await
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::cancel_download(&state, &id).await
}

#[tauri::command]
pub async fn cancel_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    svc::cancel_all_downloads(&state).await
}

#[tauri::command]
pub async fn get_download_tasks(state: State<'_, AppState>) -> Result<Vec<JobView>, String> {
    svc::get_download_tasks(&state).await
}

#[tauri::command]
pub async fn remove_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::remove_download(&state, &id).await
}

#[tauri::command]
pub async fn clear_completed_downloads(state: State<'_, AppState>) -> Result<(), String> {
    svc::clear_completed_downloads(&state).await
}

#[tauri::command]
pub async fn pause_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::pause_download(&state, &id).await
}

#[tauri::command]
pub async fn resume_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::resume_download(&state, &id).await
}

#[tauri::command]
pub async fn retry_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    svc::retry_download(&state, &id).await
}

/// Pause every unfinished download of one batch (a torrent or an archive's contents).
#[tauri::command]
pub async fn pause_batch(state: State<'_, AppState>, batch_id: String) -> Result<(), String> {
    svc::pause_batch(&state, &batch_id).await
}

#[tauri::command]
pub async fn resume_batch(state: State<'_, AppState>, batch_id: String) -> Result<(), String> {
    svc::resume_batch(&state, &batch_id).await
}

#[tauri::command]
pub async fn retry_batch(state: State<'_, AppState>, batch_id: String) -> Result<(), String> {
    svc::retry_batch(&state, &batch_id).await
}

#[tauri::command]
pub async fn cancel_batch(state: State<'_, AppState>, batch_id: String) -> Result<(), String> {
    svc::cancel_batch(&state, &batch_id).await
}

#[tauri::command]
pub async fn pause_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    svc::pause_all_downloads(&state).await
}

#[tauri::command]
pub async fn resume_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    svc::resume_all_downloads(&state).await
}

#[tauri::command]
pub async fn retry_failed_downloads(state: State<'_, AppState>) -> Result<(), String> {
    svc::retry_failed_downloads(&state).await
}

#[tauri::command]
pub async fn get_download_history(state: State<'_, AppState>, page: Option<u32>, limit: Option<u32>) -> Result<Vec<DownloadItem>, String> {
    svc::get_download_history(&state, page, limit).await
}
