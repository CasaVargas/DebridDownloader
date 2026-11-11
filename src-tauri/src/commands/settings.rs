//! Tauri wrappers; the bodies live in `crate::service::settings`.
use crate::persistence::Persistence;
use crate::service::settings as svc;
use crate::state::{AppSettings, AppState};
use tauri::State;

pub use crate::persistence::{SETTINGS_KEY, SETTINGS_STORE};

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    Ok(svc::get_settings(&state).await)
}

#[tauri::command]
pub async fn update_settings(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    svc::update_settings(&state, &persistence, settings).await
}
