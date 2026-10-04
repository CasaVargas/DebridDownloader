use serde::{Deserialize, Deserializer};

/// `#[serde(default)]` only covers a missing key; TorBox also sends explicit
/// `null` (e.g. `"files": null` on a torrent still fetching metadata), which
/// fails the whole `mylist` decode. Treat `null` as the type's default.
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

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
    #[serde(default, deserialize_with = "null_as_default")]
    pub files: Vec<TbTorrentFile>,
    #[serde(default, deserialize_with = "null_as_default")]
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
    #[serde(default)]
    pub torrent_id: Option<u64>,
    /// Sent instead of `torrent_id` when TorBox queues the torrent.
    #[serde(default)]
    pub queued_id: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn torrent_json(extra: &str) -> String {
        format!(
            r#"{{"id":1,"hash":"abc","name":"t","size":10,"active":true,
               "download_state":"metaDL","seeds":null,"peers":null,"ratio":null,
               "progress":0.0,"download_speed":null,"upload_speed":null,
               "created_at":"2026-10-04T00:00:00Z","updated_at":"2026-10-04T00:00:00Z",
               "eta":null{extra}}}"#
        )
    }

    #[test]
    fn mylist_with_null_files_decodes() {
        let body = format!(
            r#"{{"success":true,"detail":"ok","error":null,"data":[{}]}}"#,
            torrent_json(r#","files":null,"download_finished":null"#)
        );
        let resp: TbApiResponse<Vec<TbTorrent>> = serde_json::from_str(&body).unwrap();
        let t = &resp.data.unwrap()[0];
        assert!(t.files.is_empty());
        assert!(!t.download_finished);
    }

    #[test]
    fn missing_files_still_defaults() {
        let t: TbTorrent = serde_json::from_str(&torrent_json("")).unwrap();
        assert!(t.files.is_empty());
        assert!(!t.download_finished);
    }

    #[test]
    fn present_files_still_decode() {
        let t: TbTorrent = serde_json::from_str(&torrent_json(
            r#","files":[{"id":0,"name":"a.mkv","size":5}],"download_finished":true"#,
        ))
        .unwrap();
        assert_eq!(t.files.len(), 1);
        assert_eq!(t.files[0].name, "a.mkv");
        assert!(t.download_finished);
    }
}
