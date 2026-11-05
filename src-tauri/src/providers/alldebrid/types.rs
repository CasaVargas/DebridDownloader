//! AllDebrid API v4 / v4.1 response shapes (https://docs.alldebrid.com).
//!
//! Every response is wrapped in `{"status": "success", "data": {...}}` or
//! `{"status": "error", "error": {"code": "...", "message": "..."}}`. Fields are kept optional
//! wherever the docs are vague so a shape drift doesn't turn into an opaque decode error.
use serde::{Deserialize, Deserializer};

#[derive(Debug, Clone, Deserialize)]
pub struct AdResponse<T> {
    pub status: String,
    pub data: Option<T>,
    pub error: Option<AdError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdError {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub message: String,
}

/// AllDebrid ids are numbers in some endpoints and strings in others.
pub fn de_id<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    match serde_json::Value::deserialize(d)? {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        other => Err(serde::de::Error::custom(format!("unexpected id: {}", other))),
    }
}

// ── /v4/user ──

#[derive(Debug, Clone, Deserialize)]
pub struct AdUserData {
    pub user: AdUser,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdUser {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub is_premium: bool,
    /// Unix seconds; 0 when the account has no premium.
    #[serde(default)]
    pub premium_until: i64,
}

// ── /v4/magnet/upload and /v4/magnet/upload/file ──

#[derive(Debug, Clone, Deserialize)]
pub struct AdMagnetUploadData {
    #[serde(default)]
    pub magnets: Vec<AdUploaded>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdFileUploadData {
    #[serde(default)]
    pub files: Vec<AdUploaded>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdUploaded {
    #[serde(default, deserialize_with = "de_opt_id")]
    pub id: Option<String>,
    #[serde(default)]
    pub error: Option<AdError>,
}

fn de_opt_id<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    match Option::<serde_json::Value>::deserialize(d)? {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(serde_json::Value::Number(n)) => Ok(Some(n.to_string())),
        Some(other) => Err(serde::de::Error::custom(format!("unexpected id: {}", other))),
    }
}

// ── /v4.1/magnet/status ──

#[derive(Debug, Clone, Deserialize)]
pub struct AdStatusData {
    pub magnets: AdMagnets,
}

/// `magnets` is an array for the full list and a single object when `id` is given.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum AdMagnets {
    Many(Vec<AdMagnet>),
    One(Box<AdMagnet>),
}

impl AdMagnets {
    pub fn into_vec(self) -> Vec<AdMagnet> {
        match self {
            AdMagnets::Many(v) => v,
            AdMagnets::One(m) => vec![*m],
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdMagnet {
    #[serde(deserialize_with = "de_id")]
    pub id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub size: i64,
    /// 0 queued, 1 downloading, 2 compressing/moving, 3 uploading, 4 ready, 5+ errors.
    #[serde(default)]
    pub status_code: i64,
    #[serde(default)]
    pub downloaded: i64,
    #[serde(default)]
    pub download_speed: Option<i64>,
    #[serde(default)]
    pub seeders: Option<i64>,
    #[serde(default)]
    pub upload_date: Option<i64>,
    #[serde(default)]
    pub completion_date: Option<i64>,
}

// ── /v4/magnet/files ──

#[derive(Debug, Clone, Deserialize)]
pub struct AdFilesData {
    #[serde(default)]
    pub magnets: Vec<AdMagnetFiles>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AdMagnetFiles {
    #[serde(deserialize_with = "de_id")]
    pub id: String,
    #[serde(default)]
    pub files: Vec<AdFileNode>,
    #[serde(default)]
    pub error: Option<AdError>,
}

/// A node of the file tree: a file has `l` (link) and `s` (size); a folder has `e` (entries).
#[derive(Debug, Clone, Deserialize)]
pub struct AdFileNode {
    #[serde(rename = "n", default)]
    pub name: String,
    #[serde(rename = "s", default)]
    pub size: i64,
    #[serde(rename = "l", default)]
    pub link: Option<String>,
    #[serde(rename = "e", default)]
    pub entries: Option<Vec<AdFileNode>>,
}

// ── /v4/link/unlock ──

#[derive(Debug, Clone, Deserialize)]
pub struct AdUnlock {
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub filesize: i64,
    #[serde(default)]
    pub streams: Vec<serde_json::Value>,
    /// Set when the link is generated asynchronously (`/link/delayed`); `link` is empty then.
    #[serde(default)]
    pub delayed: Option<serde_json::Value>,
}

/// Body of endpoints that only confirm (`/magnet/delete`); the content is not used.
pub type AdMessage = serde_json::Value;
