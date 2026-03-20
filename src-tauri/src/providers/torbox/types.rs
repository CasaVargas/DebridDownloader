use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct TbApiResponse<T> {
    pub success: bool,
    pub detail: Option<String>,
    pub data: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TbUser {
    pub id: u64,
    pub email: String,
    pub plan: u64,
    pub total_downloaded: Option<u64>,
    pub customer: Option<String>,
    pub is_subscribed: bool,
    pub premium_expires_at: Option<String>,
    pub cooldown_until: Option<String>,
    pub auth_id: String,
    #[serde(default)]
    pub user_referral: Option<String>,
    pub base_email: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TbTorrent {
    pub id: u64,
    pub hash: String,
    pub name: String,
    pub size: i64,
    pub active: bool,
    pub download_state: String,
    pub seeds: Option<i64>,
    pub peers: Option<i64>,
    pub ratio: Option<f64>,
    pub progress: f64,
    pub download_speed: Option<i64>,
    pub upload_speed: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub eta: Option<i64>,
    #[serde(default)]
    pub files: Vec<TbTorrentFile>,
    #[serde(default)]
    pub download_finished: bool,
    #[serde(default)]
    pub inactive_check: Option<u64>,
    #[serde(default)]
    pub availability: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TbTorrentFile {
    pub id: u64,
    #[serde(default)]
    pub md5: Option<String>,
    #[serde(default)]
    pub s3_path: Option<String>,
    pub name: String,
    pub size: i64,
    #[serde(default)]
    pub mimetype: Option<String>,
    #[serde(default)]
    pub short_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TbCreateTorrent {
    pub torrent_id: u64,
    pub name: String,
    pub hash: String,
}
