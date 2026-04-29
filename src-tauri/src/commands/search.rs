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

#[tauri::command]
pub async fn test_tracker(
    tracker_type: String,
    url: String,
    api_key: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("DebridDownloader/1.6.3")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("{}", e))?;

    match tracker_type.as_str() {
        "piratebay_api" => {
            let base = url.trim_end_matches('/');
            let test_url = format!("{}/q.php?q=test&cat=0", base);
            let resp = client.get(&test_url).send().await.map_err(|e| format!("{}", e))?;
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("HTTP {}", status.as_u16()));
            }
            let text = resp.text().await.map_err(|e| format!("{}", e))?;
            if text.contains("<!DOCTYPE") || text.contains("<html") {
                return Err("Blocked — returned HTML instead of JSON".into());
            }
            let _: serde_json::Value = serde_json::from_str(&text)
                .map_err(|_| "Invalid JSON response — check URL".to_string())?;
            Ok("Connected".into())
        }
        "torznab" => {
            let key = api_key.as_deref().unwrap_or("");
            let test_url = format!("{}?t=caps&apikey={}", url.trim_end_matches('/'), key);
            let resp = client.get(&test_url).send().await.map_err(|e| format!("{}", e))?;
            let status = resp.status();
            if !status.is_success() {
                return Err(format!("HTTP {} — check URL and API key", status.as_u16()));
            }
            let text = resp.text().await.map_err(|e| format!("{}", e))?;
            let trimmed = text.trim_start();
            if trimmed.contains("<!DOCTYPE html") || trimmed.contains("<html") {
                return Err("Returned HTML — check URL and API key".into());
            }
            if !trimmed.starts_with("<?xml") && !trimmed.starts_with('<') {
                return Err("Non-XML response — check URL and API key".into());
            }
            if trimmed.contains("<error") {
                if let Some(desc_start) = trimmed.find("description=\"") {
                    let rest = &trimmed[desc_start + 13..];
                    if let Some(end) = rest.find('"') {
                        return Err(rest[..end].to_string());
                    }
                }
                return Err("API error — check API key".into());
            }
            Ok("Connected".into())
        }
        "prowlarr" => {
            let key = api_key.as_deref().unwrap_or("");
            let test_url = format!("{}/api/v1/health", url.trim_end_matches('/'));
            let resp = client.get(&test_url)
                .header("X-Api-Key", key)
                .send()
                .await
                .map_err(|e| format!("{}", e))?;
            let status = resp.status();
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err("Authentication failed — check API key".into());
            }
            if !status.is_success() {
                return Err(format!("HTTP {}", status.as_u16()));
            }
            Ok("Connected".into())
        }
        _ => Err(format!("Unknown tracker type: {}", tracker_type)),
    }
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
