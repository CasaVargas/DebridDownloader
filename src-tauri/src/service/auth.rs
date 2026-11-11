use crate::persistence::Persistence;
use crate::providers::real_debrid::client::RdClient;
use crate::providers::types::{
    AuthMethod, DeviceCode, DeviceCredentials, OAuthToken, ProviderAuth, ProviderInfo, User,
};
use crate::providers::DebridProvider;
use crate::secrets::SecretStore;
use crate::state::AppState;
use std::sync::Arc;

fn map_keyring_save_error(context: &str, msg: String) -> String {
    if msg.contains("Windows error code 8") {
        format!(
            "Failed to save {}: Windows Credential Manager is full. \
             Open Credential Manager (Win+R \u{2192} control /name Microsoft.CredentialManager) \
             and remove unused credentials under \"Windows Credentials\", then try again.",
            context
        )
    } else {
        format!("Failed to save {}: {}", context, msg)
    }
}

pub fn prefixed_key(provider_id: &str, key: &str) -> String {
    format!("{}.{}", provider_id, key)
}

/// Save API token and set on provider (validate first, then persist)
pub async fn set_api_token(state: &AppState, secrets: &dyn SecretStore, token: String) -> Result<(), String> {
    let provider = state.get_provider().await;
    // Validate token before persisting
    provider
        .authenticate(&ProviderAuth::Token(token.clone()))
        .await
        .map_err(|e| format!("{}", e))?;

    // Only save the secret after validation succeeds
    let provider_id = state.provider_id.read().await.clone();
    secrets
        .set(&prefixed_key(&provider_id, "api_token"), &token)
        .map_err(|e| map_keyring_save_error("token", e))?;
    Ok(())
}

/// Load token from the secret store and set on provider
pub async fn load_saved_token(state: &AppState, secrets: &dyn SecretStore) -> Result<bool, String> {
    let provider_id = state.provider_id.read().await.clone();
    match secrets.get(&prefixed_key(&provider_id, "api_token")) {
        Ok(Some(token)) => {
            let provider = state.get_provider().await;
            let _ = provider.authenticate(&ProviderAuth::Token(token)).await;
            Ok(true)
        }
        Ok(None) | Err(_) => Ok(false),
    }
}

/// Clear stored credentials and reset the provider.
pub async fn logout(state: &AppState, secrets: &dyn SecretStore) -> Result<(), String> {
    let provider_id = state.provider_id.read().await.clone();

    // Clear all possible credential keys for this provider
    for key in &["api_token", "refresh_token", "oauth_client_id", "oauth_client_secret"] {
        let _ = secrets.delete(&prefixed_key(&provider_id, key));
    }

    // Reset provider to a fresh instance
    let new_provider = create_provider(&provider_id)?;
    *state.provider.write().await = new_provider;

    Ok(())
}

pub async fn is_authenticated(state: &AppState) -> bool {
    let provider = state.get_provider().await;
    provider.is_authenticated().await
}

/// Get current user info
pub async fn get_user(state: &AppState, secrets: &dyn SecretStore) -> Result<User, String> {
    let provider = state.get_provider().await;
    let provider_id = state.provider_id.read().await.clone();
    let token = secrets
        .get(&prefixed_key(&provider_id, "api_token"))
        .ok()
        .flatten()
        .ok_or_else(|| "No saved token".to_string())?;
    provider
        .authenticate(&ProviderAuth::Token(token))
        .await
        .map_err(|e| format!("{}", e))
}

// ── OAuth2 Device Flow (Real-Debrid specific) ──

fn get_rd_client(provider: &Arc<dyn DebridProvider>) -> Result<&RdClient, String> {
    provider
        .as_any()
        .downcast_ref::<RdClient>()
        .ok_or_else(|| "OAuth is only supported for Real-Debrid".to_string())
}

pub async fn oauth_start(state: &AppState) -> Result<DeviceCode, String> {
    let provider = state.get_provider().await;
    let rd = get_rd_client(&provider)?;
    rd.oauth_device_code().await.map_err(|e| format!("{}", e))
}

pub async fn oauth_poll_credentials(
    state: &AppState,
    secrets: &dyn SecretStore,
    device_code: &str,
) -> Result<Option<DeviceCredentials>, String> {
    let provider = state.get_provider().await;
    let rd = get_rd_client(&provider)?;
    let provider_id = state.provider_id.read().await.clone();

    match rd.oauth_device_credentials::<DeviceCredentials>(device_code).await {
        Ok(creds) => {
            secrets
                .set(&prefixed_key(&provider_id, "oauth_client_id"), &creds.client_id)
                .map_err(|e| map_keyring_save_error("client_id", e))?;
            secrets
                .set(&prefixed_key(&provider_id, "oauth_client_secret"), &creds.client_secret)
                .map_err(|e| map_keyring_save_error("client_secret", e))?;
            Ok(Some(creds))
        }
        Err(_) => Ok(None),
    }
}

pub async fn oauth_get_token(
    state: &AppState,
    secrets: &dyn SecretStore,
    client_id: &str,
    client_secret: &str,
    device_code: &str,
) -> Result<OAuthToken, String> {
    let provider = state.get_provider().await;
    let rd = get_rd_client(&provider)?;
    let provider_id = state.provider_id.read().await.clone();

    let token: OAuthToken = rd
        .oauth_token(client_id, client_secret, device_code)
        .await
        .map_err(|e| format!("{}", e))?;

    secrets
        .set(&prefixed_key(&provider_id, "api_token"), &token.access_token)
        .map_err(|e| map_keyring_save_error("access token", e))?;
    secrets
        .set(&prefixed_key(&provider_id, "refresh_token"), &token.refresh_token)
        .map_err(|e| map_keyring_save_error("refresh token", e))?;

    rd.set_token(token.access_token.clone()).await;

    Ok(token)
}

// ── Provider management ──

/// Factory function to create a provider by ID.
pub fn create_provider(provider_id: &str) -> Result<Arc<dyn DebridProvider>, String> {
    match provider_id {
        "real-debrid" => Ok(Arc::new(RdClient::new())),
        "torbox" => Ok(Arc::new(crate::providers::torbox::client::TorBoxClient::new())),
        "premiumize" => Ok(Arc::new(crate::providers::premiumize::client::PremiumizeClient::new())),
        "alldebrid" => Ok(Arc::new(crate::providers::alldebrid::client::AllDebridClient::new())),
        _ => Err(format!("Unknown provider: {}", provider_id)),
    }
}

pub fn get_available_providers() -> Vec<ProviderInfo> {
    crate::providers::available_providers()
}

pub async fn get_auth_method(state: &AppState) -> AuthMethod {
    let provider = state.get_provider().await;
    provider.info().auth_method
}

/// Make `provider_id` the active provider, persist it in the settings blob, and try its saved
/// token. Returns whether that token authenticated.
pub async fn switch_provider(
    state: &AppState,
    persistence: &Persistence,
    secrets: &dyn SecretStore,
    provider_id: &str,
) -> Result<bool, String> {
    let new_provider = create_provider(provider_id)?;

    *state.provider.write().await = new_provider;
    *state.provider_id.write().await = provider_id.to_string();

    // Update + persist settings
    let mut settings = state.settings.write().await;
    settings.provider = provider_id.to_string();
    crate::service::settings::save_app_settings(persistence, &settings)?;
    drop(settings);

    // Try to load saved credentials
    if let Ok(Some(token)) = secrets.get(&prefixed_key(provider_id, "api_token")) {
        let provider = state.get_provider().await;
        match provider.authenticate(&ProviderAuth::Token(token)).await {
            Ok(_) => return Ok(true),
            Err(_) => return Ok(false),
        }
    }

    Ok(false)
}

pub async fn get_active_provider(state: &AppState) -> String {
    state.provider_id.read().await.clone()
}

#[cfg(test)]
mod tests {
    use super::create_provider;

    #[test]
    fn every_available_provider_can_be_created() {
        for info in crate::providers::available_providers() {
            let provider = create_provider(&info.id).unwrap_or_else(|e| panic!("{}: {}", info.id, e));
            assert_eq!(provider.info().id, info.id);
        }
        assert_eq!(create_provider("alldebrid").unwrap().info().name, "AllDebrid");
        assert!(create_provider("nope").is_err());
    }
}
