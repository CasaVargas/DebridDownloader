use tauri::{AppHandle, Emitter};

/// Trigger library scan on all configured media servers.
/// Fire-and-forget: errors are logged and emitted as toasts, never block the caller.
pub async fn trigger_scans(
    app: &AppHandle,
    plex_url: Option<&str>,
    plex_token: Option<&str>,
    jellyfin_url: Option<&str>,
    jellyfin_api_key: Option<&str>,
    emby_url: Option<&str>,
    emby_api_key: Option<&str>,
) {
    let client = reqwest::Client::new();

    // Plex
    if let (Some(url), Some(token)) = (plex_url, plex_token) {
        if !url.is_empty() && !token.is_empty() {
            let scan_url = format!("{}/library/sections/all/refresh?X-Plex-Token={}", url.trim_end_matches('/'), token);
            match client.get(&scan_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    log::info!("Plex library scan triggered");
                    let _ = app.emit("toast", "Plex library scan triggered");
                }
                Ok(resp) => {
                    let msg = format!("Plex scan failed: HTTP {}", resp.status());
                    log::warn!("{}", msg);
                    let _ = app.emit("toast-error", &msg);
                }
                Err(e) => {
                    let msg = format!("Plex scan failed: {}", e);
                    log::warn!("{}", msg);
                    let _ = app.emit("toast-error", &msg);
                }
            }
        }
    }

    // Jellyfin
    if let (Some(url), Some(key)) = (jellyfin_url, jellyfin_api_key) {
        if !url.is_empty() && !key.is_empty() {
            let scan_url = format!("{}/Library/Refresh", url.trim_end_matches('/'));
            match client
                .post(&scan_url)
                .header("X-MediaBrowser-Token", key)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    log::info!("Jellyfin library scan triggered");
                    let _ = app.emit("toast", "Jellyfin library scan triggered");
                }
                Ok(resp) => {
                    let msg = format!("Jellyfin scan failed: HTTP {}", resp.status());
                    log::warn!("{}", msg);
                    let _ = app.emit("toast-error", &msg);
                }
                Err(e) => {
                    let msg = format!("Jellyfin scan failed: {}", e);
                    log::warn!("{}", msg);
                    let _ = app.emit("toast-error", &msg);
                }
            }
        }
    }

    // Emby
    if let (Some(url), Some(key)) = (emby_url, emby_api_key) {
        if !url.is_empty() && !key.is_empty() {
            let scan_url = format!("{}/Library/Refresh?api_key={}", url.trim_end_matches('/'), key);
            match client.post(&scan_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    log::info!("Emby library scan triggered");
                    let _ = app.emit("toast", "Emby library scan triggered");
                }
                Ok(resp) => {
                    let msg = format!("Emby scan failed: HTTP {}", resp.status());
                    log::warn!("{}", msg);
                    let _ = app.emit("toast-error", &msg);
                }
                Err(e) => {
                    let msg = format!("Emby scan failed: {}", e);
                    log::warn!("{}", msg);
                    let _ = app.emit("toast-error", &msg);
                }
            }
        }
    }
}

/// Test connection to a media server. Returns the server name on success.
pub async fn test_connection(server_type: &str, url: &str, credential: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let base = url.trim_end_matches('/');

    match server_type {
        "plex" => {
            let test_url = format!("{}/identity?X-Plex-Token={}", base, credential);
            let resp = client.get(&test_url).send().await
                .map_err(|e| format!("Connection failed: {}", e))?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}: Check your URL and token", resp.status()));
            }
            let body = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
            let name = body
                .split("friendlyName=\"")
                .nth(1)
                .and_then(|s| s.split('"').next())
                .unwrap_or("Plex Server")
                .to_string();
            Ok(name)
        }
        "jellyfin" | "emby" => {
            let test_url = if server_type == "jellyfin" {
                format!("{}/System/Info", base)
            } else {
                format!("{}/System/Info?api_key={}", base, credential)
            };

            let mut req = client.get(&test_url);
            if server_type == "jellyfin" {
                req = req.header("X-MediaBrowser-Token", credential);
            }

            let resp = req.send().await
                .map_err(|e| format!("Connection failed: {}", e))?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}: Check your URL and API key", resp.status()));
            }

            #[derive(serde::Deserialize)]
            struct SystemInfo {
                #[serde(alias = "ServerName")]
                server_name: Option<String>,
            }

            let info: SystemInfo = resp.json().await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            Ok(info.server_name.unwrap_or_else(|| format!("{} Server", if server_type == "jellyfin" { "Jellyfin" } else { "Emby" })))
        }
        _ => Err(format!("Unknown server type: {}", server_type)),
    }
}
