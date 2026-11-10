use crate::persistence::Persistence;
use crate::state::{AppSettings, AppState};
use tauri::State;

pub use crate::persistence::{SETTINGS_KEY, SETTINGS_STORE};

pub fn save_app_settings(persistence: &Persistence, settings: &AppSettings) -> Result<(), String> {
    persistence.set_json(SETTINGS_KEY, settings)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.read().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn update_settings(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    save_app_settings(&persistence, &settings)?;
    let config = settings.engine_config(state.rar_tool);
    *state.settings.write().await = settings;
    if let Ok(engine) = state.engine() {
        engine.set_config(config);
    }
    Ok(())
}
