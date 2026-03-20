use async_trait::async_trait;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::any::Any;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::types::*;
use crate::providers::types as shared;
use crate::providers::DebridProvider;

const BASE_URL: &str = "https://api.torbox.app/v1/api";

#[derive(Clone)]
pub struct TorBoxClient {
    http: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl TorBoxClient {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .user_agent("DebridDownloader/1.0.0")
                .build()
                .expect("Failed to create HTTP client"),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    async fn get_key(&self) -> Result<String, shared::ProviderError> {
        self.api_key
            .read()
            .await
            .clone()
            .ok_or(shared::ProviderError::NotAuthenticated)
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<TbApiResponse<T>, shared::ProviderError> {
        let key = self.get_key().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(shared::ProviderError::RateLimited);
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(shared::ProviderError::Other(format!(
                "HTTP {}: {}", status, text
            )));
        }
        Ok(resp.json().await?)
    }

    async fn post_form<T: DeserializeOwned>(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<TbApiResponse<T>, shared::ProviderError> {
        let key = self.get_key().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .form(form)
            .send()
            .await?;

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(shared::ProviderError::RateLimited);
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(shared::ProviderError::Other(format!(
                "HTTP {}: {}", status, text
            )));
        }
        Ok(resp.json().await?)
    }

    fn unwrap_response<T>(&self, resp: TbApiResponse<T>) -> Result<T, shared::ProviderError> {
        if resp.success {
            resp.data.ok_or_else(|| {
                shared::ProviderError::Other("No data in response".to_string())
            })
        } else {
            Err(shared::ProviderError::Api {
                message: resp.error.or(resp.detail).unwrap_or_else(|| "Unknown error".to_string()),
                code: None,
            })
        }
    }
}

// ── Type mapping ──

fn map_status(state: &str, download_finished: bool) -> String {
    match state {
        "downloading" => "downloading".to_string(),
        "uploading" | "stalled (no seeds)" | "paused" if download_finished => "downloaded".to_string(),
        "uploading" | "stalled (no seeds)" | "paused" => "downloading".to_string(),
        "completed" => "downloaded".to_string(),
        "cached" => "downloaded".to_string(),
        "metaDL" | "checkingDL" => "magnet_conversion".to_string(),
        "error" | "stalledDL" => "error".to_string(),
        _ => state.to_string(),
    }
}

fn map_torrent(t: TbTorrent) -> shared::Torrent {
    let status = map_status(&t.download_state, t.download_finished);
    shared::Torrent {
        id: t.id.to_string(),
        filename: t.name,
        hash: t.hash,
        bytes: t.size,
        progress: t.progress / 100.0,
        status,
        added: t.created_at,
        links: vec![],
        ended: None,
        speed: t.download_speed,
        seeders: t.seeds,
    }
}

fn map_torrent_detail(t: TbTorrent) -> shared::TorrentInfo {
    let status = map_status(&t.download_state, t.download_finished);
    shared::TorrentInfo {
        id: t.id.to_string(),
        filename: t.name,
        hash: t.hash,
        bytes: t.size,
        progress: t.progress / 100.0,
        status,
        added: t.created_at,
        files: t
            .files
            .into_iter()
            .map(|f| shared::TorrentFile {
                id: f.id,
                path: f.name,
                bytes: f.size,
                selected: true,
            })
            .collect(),
        links: vec![],
        ended: None,
        speed: t.download_speed,
        seeders: t.seeds,
    }
}

// ── DebridProvider implementation ──

#[async_trait]
impl DebridProvider for TorBoxClient {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn info(&self) -> shared::ProviderInfo {
        shared::ProviderInfo {
            id: "torbox".to_string(),
            name: "TorBox".to_string(),
            auth_method: shared::AuthMethod::ApiKey,
            supports_streaming: true,
        }
    }

    async fn authenticate(
        &self,
        auth: &shared::ProviderAuth,
    ) -> Result<shared::User, shared::ProviderError> {
        let token = match auth {
            shared::ProviderAuth::Token(t) => t.clone(),
            shared::ProviderAuth::OAuth { access_token, .. } => access_token.clone(),
        };
        *self.api_key.write().await = Some(token);

        let resp: TbApiResponse<TbUser> = self.get("/user/me").await?;
        let user = self.unwrap_response(resp)?;

        Ok(shared::User {
            username: user.email.split('@').next().unwrap_or(&user.email).to_string(),
            email: user.email,
            premium: user.is_subscribed,
            expiration: user.premium_expires_at,
        })
    }

    async fn is_authenticated(&self) -> bool {
        self.api_key.read().await.is_some()
    }

    async fn list_torrents(
        &self,
        _page: u32,
        _limit: u32,
    ) -> Result<Vec<shared::Torrent>, shared::ProviderError> {
        let resp: TbApiResponse<Vec<TbTorrent>> = self.get("/torrents/mylist").await?;
        let torrents = self.unwrap_response(resp)?;
        Ok(torrents.into_iter().map(map_torrent).collect())
    }

    async fn torrent_info(&self, id: &str) -> Result<shared::TorrentInfo, shared::ProviderError> {
        let resp: TbApiResponse<TbTorrent> = self
            .get(&format!("/torrents/mylist?id={}", id))
            .await?;
        let torrent = self.unwrap_response(resp)?;
        Ok(map_torrent_detail(torrent))
    }

    async fn add_magnet(&self, magnet: &str) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let resp: TbApiResponse<TbCreateTorrent> = self
            .post_form("/torrents/createtorrent", &[("magnet", magnet)])
            .await?;
        let data = self.unwrap_response(resp)?;
        Ok(shared::AddTorrentResponse {
            id: data.torrent_id.to_string(),
        })
    }

    async fn add_torrent_file(
        &self,
        bytes: &[u8],
    ) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let key = self.get_key().await?;
        let url = format!("{}/torrents/createtorrent", BASE_URL);
        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name("torrent.torrent")
            .mime_str("application/x-bittorrent")
            .map_err(|e| shared::ProviderError::Other(e.to_string()))?;
        let form = reqwest::multipart::Form::new().part("file", part);

        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .multipart(form)
            .send()
            .await?;

        let api_resp: TbApiResponse<TbCreateTorrent> = resp.json().await?;
        let data = self.unwrap_response(api_resp)?;
        Ok(shared::AddTorrentResponse {
            id: data.torrent_id.to_string(),
        })
    }

    async fn select_files(
        &self,
        id: &str,
        file_ids: &[u64],
    ) -> Result<(), shared::ProviderError> {
        let ids_str = if file_ids.is_empty() {
            "all".to_string()
        } else {
            file_ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")
        };
        let _: TbApiResponse<serde_json::Value> = self
            .post_form(
                "/torrents/controltorrent",
                &[
                    ("torrent_id", id),
                    ("operation", "set_files"),
                    ("file_ids", &ids_str),
                ],
            )
            .await?;
        Ok(())
    }

    async fn delete_torrent(&self, id: &str) -> Result<(), shared::ProviderError> {
        let key = self.get_key().await?;
        let url = format!("{}/torrents/controltorrent", BASE_URL);
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", key))
            .form(&[("torrent_id", id), ("operation", "delete")])
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(shared::ProviderError::Other(text));
        }
        Ok(())
    }

    async fn get_download_links(
        &self,
        id: &str,
    ) -> Result<Vec<shared::DownloadLink>, shared::ProviderError> {
        let info = self.torrent_info(id).await?;
        let mut links = Vec::new();

        for file in &info.files {
            match self.get_download_link_for_file(id, file.id).await {
                Ok(link) => links.push(link),
                Err(e) => log::warn!("Failed to get link for file {}: {}", file.id, e),
            }
        }

        Ok(links)
    }

    async fn get_download_link_for_file(
        &self,
        torrent_id: &str,
        file_id: u64,
    ) -> Result<shared::DownloadLink, shared::ProviderError> {
        let key = self.get_key().await?;
        let resp: TbApiResponse<String> = self
            .get(&format!(
                "/torrents/requestdl?token={}&torrent_id={}&file_id={}&zip_link=false",
                key, torrent_id, file_id
            ))
            .await?;
        let download_url = self.unwrap_response(resp)?;

        let info = self.torrent_info(torrent_id).await?;
        let file = info
            .files
            .iter()
            .find(|f| f.id == file_id)
            .ok_or_else(|| shared::ProviderError::Other("File not found".to_string()))?;

        Ok(shared::DownloadLink {
            filename: file.path.clone(),
            filesize: file.bytes,
            download: download_url,
            streamable: Some(true),
        })
    }

    async fn download_history(
        &self,
        _page: u32,
        _limit: u32,
    ) -> Result<Vec<shared::DownloadItem>, shared::ProviderError> {
        Ok(vec![])
    }
}
