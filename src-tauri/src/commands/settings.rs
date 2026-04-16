use crate::state::{AppSettings, AppState};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

pub const SETTINGS_STORE: &str = "settings.json";
pub const SETTINGS_KEY: &str = "app_settings";

pub fn save_app_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    let json = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    store.set(SETTINGS_KEY, json);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    save_app_settings(&app, &settings)?;
    *state.settings.write().await = settings;
    Ok(())
}
