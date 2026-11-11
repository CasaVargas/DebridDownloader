//! Tauri wrappers; the bodies live in `crate::service::auth`.
use crate::persistence::Persistence;
use crate::providers::types::{AuthMethod, DeviceCode, DeviceCredentials, OAuthToken, ProviderInfo, User};
use crate::secrets::Secrets;
use crate::service::auth as svc;
use crate::state::AppState;
use tauri::State;

pub use crate::service::auth::create_provider;

/// Save API token and set on provider (validate first, then persist)
#[tauri::command]
pub async fn set_api_token(state: State<'_, AppState>, secrets: State<'_, Secrets>, token: String) -> Result<(), String> {
    svc::set_api_token(&state, &**secrets, token).await
}

/// Load token from the secret store and set on provider
#[tauri::command]
pub async fn load_saved_token(state: State<'_, AppState>, secrets: State<'_, Secrets>) -> Result<bool, String> {
    svc::load_saved_token(&state, &**secrets).await
}

/// Clear stored token
#[tauri::command]
pub async fn logout(state: State<'_, AppState>, secrets: State<'_, Secrets>) -> Result<(), String> {
    svc::logout(&state, &**secrets).await
}

/// Check if we're authenticated
#[tauri::command]
pub async fn is_authenticated(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(svc::is_authenticated(&state).await)
}

/// Get current user info
#[tauri::command]
pub async fn get_user(state: State<'_, AppState>, secrets: State<'_, Secrets>) -> Result<User, String> {
    svc::get_user(&state, &**secrets).await
}

// ── OAuth2 Device Flow (Real-Debrid specific) ──

#[tauri::command]
pub async fn oauth_start(state: State<'_, AppState>) -> Result<DeviceCode, String> {
    svc::oauth_start(&state).await
}

#[tauri::command]
pub async fn oauth_poll_credentials(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    device_code: String,
) -> Result<Option<DeviceCredentials>, String> {
    svc::oauth_poll_credentials(&state, &**secrets, &device_code).await
}

#[tauri::command]
pub async fn oauth_get_token(
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    client_id: String,
    client_secret: String,
    device_code: String,
) -> Result<OAuthToken, String> {
    svc::oauth_get_token(&state, &**secrets, &client_id, &client_secret, &device_code).await
}

// ── Provider management ──

#[tauri::command]
pub async fn get_available_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(svc::get_available_providers())
}

#[tauri::command]
pub async fn get_auth_method(state: State<'_, AppState>) -> Result<AuthMethod, String> {
    Ok(svc::get_auth_method(&state).await)
}

#[tauri::command]
pub async fn switch_provider(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    secrets: State<'_, Secrets>,
    provider_id: String,
) -> Result<bool, String> {
    svc::switch_provider(&state, &persistence, &**secrets, &provider_id).await
}

#[tauri::command]
pub async fn get_active_provider(state: State<'_, AppState>) -> Result<String, String> {
    Ok(svc::get_active_provider(&state).await)
}
