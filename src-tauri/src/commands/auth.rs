use crate::providers::real_debrid::client::RdClient;
use crate::providers::types::{
    DeviceCode, DeviceCredentials, OAuthToken, ProviderAuth, User,
};
use crate::state::AppState;
use keyring::Entry;
use std::sync::Arc;
use tauri::State;

const KEYRING_SERVICE: &str = "com.jonathan.debriddownloader";

fn get_entry(key: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("Keyring error: {}", e))
}

fn prefixed_key(provider_id: &str, key: &str) -> String {
    format!("{}.{}", provider_id, key)
}

/// Save API token and set on provider (validate first, then persist)
#[tauri::command]
pub async fn set_api_token(state: State<'_, AppState>, token: String) -> Result<(), String> {
    let provider = state.get_provider().await;
    // Validate token before persisting
    provider
        .authenticate(&ProviderAuth::Token(token.clone()))
        .await
        .map_err(|e| format!("{}", e))?;

    // Only save to keyring after validation succeeds
    let provider_id = state.provider_id.read().await.clone();
    let entry = get_entry(&prefixed_key(&provider_id, "api_token"))?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to save token: {}", e))?;
    Ok(())
}

/// Load token from keyring and set on provider
#[tauri::command]
pub async fn load_saved_token(state: State<'_, AppState>) -> Result<bool, String> {
    let provider_id = state.provider_id.read().await.clone();
    let entry = get_entry(&prefixed_key(&provider_id, "api_token"))?;
    match entry.get_password() {
        Ok(token) => {
            let provider = state.get_provider().await;
            let _ = provider.authenticate(&ProviderAuth::Token(token)).await;
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

/// Clear stored token
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    let provider_id = state.provider_id.read().await.clone();

    // Clear all possible credential keys for this provider
    for key in &["api_token", "refresh_token", "oauth_client_id", "oauth_client_secret"] {
        let _ = get_entry(&prefixed_key(&provider_id, key))
            .and_then(|e| e.delete_credential().map_err(|e| format!("{}", e)));
    }

    // Reset provider to a fresh instance
    let new_provider = create_provider(&provider_id)?;
    *state.provider.write().await = new_provider;

    Ok(())
}

/// Check if we're authenticated
#[tauri::command]
pub async fn is_authenticated(state: State<'_, AppState>) -> Result<bool, String> {
    let provider = state.get_provider().await;
    Ok(provider.is_authenticated().await)
}

/// Get current user info
#[tauri::command]
pub async fn get_user(state: State<'_, AppState>) -> Result<User, String> {
    let provider = state.get_provider().await;
    let provider_id = state.provider_id.read().await.clone();
    let entry = get_entry(&prefixed_key(&provider_id, "api_token"))
        .map_err(|e| format!("{}", e))?;
    let token = entry
        .get_password()
        .map_err(|_| "No saved token".to_string())?;
    provider
        .authenticate(&ProviderAuth::Token(token))
        .await
        .map_err(|e| format!("{}", e))
}

// ── OAuth2 Device Flow (Real-Debrid specific) ──

fn get_rd_client(provider: &Arc<dyn crate::providers::DebridProvider>) -> Result<&RdClient, String> {
    provider
        .as_any()
        .downcast_ref::<RdClient>()
        .ok_or_else(|| "OAuth is only supported for Real-Debrid".to_string())
}

#[tauri::command]
pub async fn oauth_start(state: State<'_, AppState>) -> Result<DeviceCode, String> {
    let provider = state.get_provider().await;
    let rd = get_rd_client(&provider)?;
    rd.oauth_device_code().await.map_err(|e| format!("{}", e))
}

#[tauri::command]
pub async fn oauth_poll_credentials(
    state: State<'_, AppState>,
    device_code: String,
) -> Result<Option<DeviceCredentials>, String> {
    let provider = state.get_provider().await;
    let rd = get_rd_client(&provider)?;
    let provider_id = state.provider_id.read().await.clone();

    match rd
        .oauth_device_credentials::<DeviceCredentials>(&device_code)
        .await
    {
        Ok(creds) => {
            let _ = get_entry(&prefixed_key(&provider_id, "oauth_client_id"))
                .and_then(|e| e.set_password(&creds.client_id).map_err(|e| format!("{}", e)));
            let _ = get_entry(&prefixed_key(&provider_id, "oauth_client_secret"))
                .and_then(|e| e.set_password(&creds.client_secret).map_err(|e| format!("{}", e)));
            Ok(Some(creds))
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn oauth_get_token(
    state: State<'_, AppState>,
    client_id: String,
    client_secret: String,
    device_code: String,
) -> Result<OAuthToken, String> {
    let provider = state.get_provider().await;
    let rd = get_rd_client(&provider)?;
    let provider_id = state.provider_id.read().await.clone();

    let token: OAuthToken = rd
        .oauth_token(&client_id, &client_secret, &device_code)
        .await
        .map_err(|e| format!("{}", e))?;

    let _ = get_entry(&prefixed_key(&provider_id, "api_token"))
        .and_then(|e| e.set_password(&token.access_token).map_err(|e| format!("{}", e)));
    let _ = get_entry(&prefixed_key(&provider_id, "refresh_token"))
        .and_then(|e| e.set_password(&token.refresh_token).map_err(|e| format!("{}", e)));

    rd.set_token(token.access_token.clone()).await;

    Ok(token)
}

// ── Provider management ──

use crate::providers::types::ProviderInfo;

/// Factory function to create a provider by ID.
pub fn create_provider(provider_id: &str) -> Result<Arc<dyn crate::providers::DebridProvider>, String> {
    match provider_id {
        "real-debrid" => Ok(Arc::new(RdClient::new())),
        "torbox" => Ok(Arc::new(crate::providers::torbox::client::TorBoxClient::new())),
        _ => Err(format!("Unknown provider: {}", provider_id)),
    }
}

#[tauri::command]
pub async fn get_available_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(crate::providers::available_providers())
}

#[tauri::command]
pub async fn get_auth_method(
    state: State<'_, AppState>,
) -> Result<crate::providers::types::AuthMethod, String> {
    let provider = state.get_provider().await;
    Ok(provider.info().auth_method)
}

#[tauri::command]
pub async fn switch_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<bool, String> {
    let new_provider = create_provider(&provider_id)?;

    *state.provider.write().await = new_provider;
    *state.provider_id.write().await = provider_id.clone();

    // Update settings
    let mut settings = state.settings.write().await;
    settings.provider = provider_id.clone();
    drop(settings);

    // Try to load saved credentials
    let entry = get_entry(&prefixed_key(&provider_id, "api_token"));
    if let Ok(entry) = entry {
        if let Ok(token) = entry.get_password() {
            let provider = state.get_provider().await;
            match provider.authenticate(&ProviderAuth::Token(token)).await {
                Ok(_) => return Ok(true),
                Err(_) => return Ok(false),
            }
        }
    }

    Ok(false)
}

#[tauri::command]
pub async fn get_active_provider(
    state: State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.provider_id.read().await.clone())
}
