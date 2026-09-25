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
    #[serde(rename = "oauth_device")]
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
    /// `message` is user-facing: providers translate or tidy it before building this.
    #[error("{message}")]
    Api { message: String, code: Option<i64> },
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Other(String),
}

/// Turns machine-style provider text ("infringing_file", "DOWNLOAD_NOT_CACHED") into a sentence
/// ("Infringing file"). Text that already reads like a sentence is only trimmed.
pub fn humanize_api_message(raw: &str) -> String {
    let t = raw.trim();
    let machine = !t.contains(' ') || t.contains('_');
    if !machine {
        return t.to_string();
    }
    let words = t.replace('_', " ").to_lowercase();
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
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

/// How to obtain a fresh URL for a file when its debrid link expires.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "type")]
pub enum LinkSource {
    RealDebrid { hoster_link: String },
    TorBox { torrent_id: String, file_id: u64 },
    Premiumize { transfer_id: String, filename: String },
    #[default]
    Direct,
}

impl LinkSource {
    /// Provider id (matches `ProviderInfo.id`) that can refresh this source.
    pub fn provider_id(&self) -> Option<&'static str> {
        match self {
            LinkSource::RealDebrid { .. } => Some("real-debrid"),
            LinkSource::TorBox { .. } => Some("torbox"),
            LinkSource::Premiumize { .. } => Some("premiumize"),
            LinkSource::Direct => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub filename: String,
    pub filesize: i64,
    pub download: String,
    pub streamable: Option<bool>,
    #[serde(default)]
    pub source: LinkSource,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::premiumize::client::PremiumizeClient;
    use crate::providers::real_debrid::client::RdClient;
    use crate::providers::torbox::client::TorBoxClient;
    use crate::providers::DebridProvider;

    #[test]
    fn humanize_tidies_machine_text() {
        assert_eq!(humanize_api_message("infringing_file"), "Infringing file");
        assert_eq!(humanize_api_message("  Download not cached  "), "Download not cached");
        assert_eq!(humanize_api_message("DOWNLOAD_NOT_CACHED"), "Download not cached");
        assert_eq!(humanize_api_message("File is too big."), "File is too big.");
        assert_eq!(humanize_api_message(""), "");
    }

    /// Spec §8: each provider rejects sources that belong to another provider, without network I/O.
    #[tokio::test]
    async fn refresh_link_rejects_foreign_sources() {
        let rd = LinkSource::RealDebrid { hoster_link: "https://h/x".into() };
        let tb = LinkSource::TorBox { torrent_id: "1".into(), file_id: 2 };
        let pm = LinkSource::Premiumize { transfer_id: "t".into(), filename: "f".into() };
        assert!(RdClient::new().refresh_link(&tb).await.is_err());
        assert!(RdClient::new().refresh_link(&LinkSource::Direct).await.is_err());
        assert!(TorBoxClient::new().refresh_link(&pm).await.is_err());
        assert!(PremiumizeClient::new().refresh_link(&rd).await.is_err());
    }
}
