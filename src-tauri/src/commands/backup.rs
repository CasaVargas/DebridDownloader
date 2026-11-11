//! Tauri wrappers; the bodies live in `crate::service::backup`.
use crate::persistence::Persistence;
use crate::service::backup as svc;
use crate::state::AppState;
use tauri::State;

pub use crate::service::backup::ImportResult;

#[tauri::command]
pub async fn export_settings(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    include_credentials: bool,
    frontend_settings_json: String,
) -> Result<String, String> {
    svc::export_settings(&state, &persistence, include_credentials, &frontend_settings_json).await
}

#[tauri::command]
pub async fn import_settings(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    json: String,
) -> Result<ImportResult, String> {
    svc::import_settings(&state, &persistence, &json).await
}
