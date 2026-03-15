use crate::scrapers::{self, SearchResponse, TrackerConfig};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub async fn search_torrents(
    app: tauri::AppHandle,
    query: String,
    category: Option<String>,
    sort_by: Option<String>,
    page: Option<u32>,
) -> Result<SearchResponse, String> {
    let params = scrapers::SearchParams {
        query,
        category,
        sort_by,
        page,
    };

    let configs = load_tracker_configs(&app);
    Ok(scrapers::search_all(&params, &configs).await)
}

#[tauri::command]
pub async fn get_tracker_configs(app: tauri::AppHandle) -> Result<Vec<TrackerConfig>, String> {
    Ok(load_tracker_configs(&app))
}

#[tauri::command]
pub async fn save_tracker_configs(
    app: tauri::AppHandle,
    configs: Vec<TrackerConfig>,
) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let json = serde_json::to_value(&configs).map_err(|e| e.to_string())?;
    store.set("tracker_configs", json);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_tracker_configs(app: &tauri::AppHandle) -> Vec<TrackerConfig> {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    match store.get("tracker_configs") {
        Some(val) => serde_json::from_value(val.clone()).unwrap_or_default(),
        None => vec![],
    }
}
