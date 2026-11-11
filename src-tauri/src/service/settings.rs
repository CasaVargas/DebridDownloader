use crate::persistence::{Persistence, SETTINGS_KEY};
use crate::state::{AppSettings, AppState};

pub fn save_app_settings(persistence: &Persistence, settings: &AppSettings) -> Result<(), String> {
    persistence.set_json(SETTINGS_KEY, settings)
}

pub async fn get_settings(state: &AppState) -> AppSettings {
    state.settings.read().await.clone()
}

/// Persist `settings`, make them current, and push the engine-relevant ones to the engine.
pub async fn update_settings(
    state: &AppState,
    persistence: &Persistence,
    settings: AppSettings,
) -> Result<(), String> {
    save_app_settings(persistence, &settings)?;
    let config = settings.engine_config(state.rar_tool);
    *state.settings.write().await = settings;
    if let Ok(engine) = state.engine() {
        engine.set_config(config);
    }
    Ok(())
}
