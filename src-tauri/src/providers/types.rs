use serde::{Deserialize, Serialize};

// ── Provider metadata ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub auth_method: AuthMethod,
    pub supports_streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    ApiKey,
    OAuthDevice,
}

#[derive(Debug, Clone)]
pub enum ProviderAuth {
    Token(String),
    OAuth {
        access_token: String,
        refresh_token: String,
        client_id: String,
        client_secret: String,
    },
}

// ── Shared error type ──

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("not authenticated")]
    NotAuthenticated,
    #[error("rate limited")]
    RateLimited,
    #[error("API error: {message}")]
    Api { message: String, code: Option<i64> },
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for ProviderError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ── Shared domain types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub username: String,
    pub email: String,
    pub premium: bool,
    pub expiration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Torrent {
    pub id: String,
    pub filename: String,
    #[serde(default)]
    pub hash: String,
    pub bytes: i64,
    pub progress: f64,
    pub status: String,
    pub added: String,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub ended: Option<String>,
    #[serde(default)]
    pub speed: Option<i64>,
    #[serde(default)]
    pub seeders: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFile {
    pub id: u64,
    pub path: String,
    pub bytes: i64,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentInfo {
    pub id: String,
    pub filename: String,
    pub hash: String,
    pub bytes: i64,
    pub progress: f64,
    pub status: String,
    pub added: String,
    #[serde(default)]
    pub files: Vec<TorrentFile>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub ended: Option<String>,
    #[serde(default)]
    pub speed: Option<i64>,
    #[serde(default)]
    pub seeders: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTorrentResponse {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub filename: String,
    pub filesize: i64,
    pub download: String,
    pub streamable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: String,
    pub filename: String,
    pub filesize: i64,
    pub download: String,
    pub generated: String,
}

// ── OAuth types (used by providers that support OAuth) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub interval: u64,
    pub expires_in: u64,
    pub verification_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCredentials {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub expires_in: u64,
    pub token_type: String,
    pub refresh_token: String,
}
