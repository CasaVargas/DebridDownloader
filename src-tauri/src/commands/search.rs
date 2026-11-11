//! Tauri wrappers; the bodies live in `crate::service::search`.
use crate::persistence::Persistence;
use crate::scrapers::{SearchParams, SearchResponse, TrackerConfig};
use crate::service::search as svc;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn search_torrents(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    query: String,
    category: Option<String>,
    sort_by: Option<String>,
    page: Option<u32>,
) -> Result<SearchResponse, String> {
    let params = SearchParams { query, category, sort_by, page };
    Ok(svc::search_torrents(&state, &persistence, params).await)
}

#[tauri::command]
pub async fn get_tracker_configs(persistence: State<'_, Persistence>) -> Result<Vec<TrackerConfig>, String> {
    Ok(svc::get_tracker_configs(&persistence))
}

#[tauri::command]
pub async fn save_tracker_configs(persistence: State<'_, Persistence>, configs: Vec<TrackerConfig>) -> Result<(), String> {
    svc::save_tracker_configs(&persistence, &configs)
}

#[tauri::command]
pub async fn test_tracker(tracker_type: String, url: String, api_key: Option<String>) -> Result<String, String> {
    svc::test_tracker(&tracker_type, &url, api_key.as_deref()).await
}

#[tauri::command]
pub async fn check_cache_availability(state: State<'_, AppState>, hashes: Vec<String>) -> Result<Vec<String>, String> {
    svc::check_cache_availability(&state, &hashes).await
}
