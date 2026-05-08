use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::types::*;
use crate::providers::types::ProviderError;

const BASE_URL: &str = "https://api.real-debrid.com/rest/1.0";
const OAUTH_URL: &str = "https://api.real-debrid.com/oauth/v2";
pub const OPEN_SOURCE_CLIENT_ID: &str = "X245A4XAIBGVM";

#[derive(Clone)]
pub struct RdClient {
    http: Client,
    token: Arc<RwLock<Option<String>>>,
}

impl RdClient {
    pub fn new() -> Self {
        Self {
            http: Client::builder()
                .user_agent("DebridDownloader/1.0.0")
                .build()
                .expect("Failed to create HTTP client"),
            token: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_token(&self, token: String) {
        *self.token.write().await = Some(token);
    }

    pub async fn clear_token(&self) {
        *self.token.write().await = None;
    }

    pub async fn has_token(&self) -> bool {
        self.token.read().await.is_some()
    }

    async fn get_token(&self) -> Result<String, ProviderError> {
        self.token
            .read()
            .await
            .clone()
            .ok_or(ProviderError::NotAuthenticated)
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ProviderError> {
        let token = self.get_token().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn get_with_params<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, ProviderError> {
        let token = self.get_token().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .query(params)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<T, ProviderError> {
        let token = self.get_token().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .form(form)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub async fn post_no_body(&self, path: &str, form: &[(&str, &str)]) -> Result<(), ProviderError> {
        let token = self.get_token().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .form(form)
            .send()
            .await?;
        self.handle_empty_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> Result<(), ProviderError> {
        let token = self.get_token().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;
        self.handle_empty_response(resp).await
    }

    pub async fn put_bytes<T: DeserializeOwned>(
        &self,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<T, ProviderError> {
        let token = self.get_token().await?;
        let url = format!("{}{}", BASE_URL, path);
        let resp = self
            .http
            .put(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/octet-stream")
            .body(bytes)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    // ── OAuth endpoints (no auth required) ──

    pub async fn oauth_device_code<T: DeserializeOwned>(&self) -> Result<T, ProviderError> {
        let url = format!(
            "{}/device/code?client_id={}&new_credentials=yes",
            OAUTH_URL, OPEN_SOURCE_CLIENT_ID
        );
        let resp = self.http.get(&url).send().await?;
        self.handle_response(resp).await
    }

    pub async fn oauth_device_credentials<T: DeserializeOwned>(
        &self,
        device_code: &str,
    ) -> Result<T, ProviderError> {
        let url = format!(
            "{}/device/credentials?client_id={}&code={}",
            OAUTH_URL, OPEN_SOURCE_CLIENT_ID, device_code
        );
        let resp = self.http.get(&url).send().await?;
        self.handle_response(resp).await
    }

    pub async fn oauth_token<T: DeserializeOwned>(
        &self,
        client_id: &str,
        client_secret: &str,
        device_code: &str,
    ) -> Result<T, ProviderError> {
        let url = format!("{}/token", OAUTH_URL);
        let resp = self
            .http
            .post(&url)
            .form(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("code", device_code),
                ("grant_type", "http://oauth.net/grant_type/device/1.0"),
            ])
            .send()
            .await?;
        self.handle_response(resp).await
    }

    /// Plain HTTP GET for downloading — no provider auth needed
    pub async fn download_stream(&self, url: &str) -> Result<Response, ProviderError> {
        let resp = self.http.get(url).send().await?;
        if !resp.status().is_success() {
            return Err(ProviderError::Other(format!(
                "Download failed with status {}",
                resp.status()
            )));
        }
        Ok(resp)
    }

    // ── Response handlers ──

    async fn handle_response<T: DeserializeOwned>(
        &self,
        resp: Response,
    ) -> Result<T, ProviderError> {
        let status = resp.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(ProviderError::RateLimited);
        }
        if status.is_success() {
            return Ok(resp.json::<T>().await?);
        }
        if let Ok(api_err) = resp.json::<ApiError>().await {
            return Err(ProviderError::Api {
                message: api_err.error,
                code: api_err.error_code,
            });
        }
        Err(ProviderError::Other(format!("Unexpected status: {}", status)))
    }

    async fn handle_empty_response(&self, resp: Response) -> Result<(), ProviderError> {
        let status = resp.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(ProviderError::RateLimited);
        }
        if status.is_success() {
            return Ok(());
        }
        if let Ok(api_err) = resp.json::<ApiError>().await {
            return Err(ProviderError::Api {
                message: api_err.error,
                code: api_err.error_code,
            });
        }
        Err(ProviderError::Other(format!("Unexpected status: {}", status)))
    }
}

// ── RD-specific API methods ──

impl RdClient {
    pub async fn rd_list_torrents(
        &self,
        page: Option<u32>,
        limit: Option<u32>,
    ) -> Result<Vec<RdTorrent>, ProviderError> {
        let page_str = page.unwrap_or(1).to_string();
        let limit_str = limit.unwrap_or(100).to_string();
        self.get_with_params(
            "/torrents",
            &[("page", page_str.as_str()), ("limit", limit_str.as_str())],
        )
        .await
    }

    pub async fn rd_torrent_info(&self, id: &str) -> Result<RdTorrentInfo, ProviderError> {
        self.get(&format!("/torrents/info/{}", id)).await
    }

    pub async fn rd_add_magnet(&self, magnet: &str) -> Result<RdAddTorrentResponse, ProviderError> {
        self.post("/torrents/addMagnet", &[("magnet", magnet)]).await
    }

    pub async fn rd_add_torrent_file(&self, bytes: Vec<u8>) -> Result<RdAddTorrentResponse, ProviderError> {
        self.put_bytes("/torrents/addTorrent", bytes).await
    }

    pub async fn rd_select_files(&self, id: &str, file_ids: &str) -> Result<(), ProviderError> {
        self.post_no_body(
            &format!("/torrents/selectFiles/{}", id),
            &[("files", file_ids)],
        )
        .await
    }

    pub async fn rd_delete_torrent(&self, id: &str) -> Result<(), ProviderError> {
        self.delete(&format!("/torrents/delete/{}", id)).await
    }

    pub async fn rd_unrestrict_link(&self, link: &str) -> Result<RdUnrestrictedLink, ProviderError> {
        self.post("/unrestrict/link", &[("link", link)]).await
    }

    pub async fn rd_list_downloads(
        &self,
        page: Option<u32>,
        limit: Option<u32>,
    ) -> Result<Vec<RdDownloadItem>, ProviderError> {
        let page_str = page.unwrap_or(1).to_string();
        let limit_str = limit.unwrap_or(100).to_string();
        self.get_with_params(
            "/downloads",
            &[("page", page_str.as_str()), ("limit", limit_str.as_str())],
        )
        .await
    }

    pub async fn rd_get_user(&self) -> Result<RdUser, ProviderError> {
        self.get("/user").await
    }

    pub async fn rd_instant_availability(
        &self,
        hashes: &[String],
    ) -> Result<HashMap<String, serde_json::Value>, ProviderError> {
        if hashes.is_empty() {
            return Ok(HashMap::new());
        }
        let path = format!("/torrents/instantAvailability/{}", hashes.join("/"));
        self.get(&path).await
    }
}

// ── Mapping functions ──

use async_trait::async_trait;
use crate::providers::types as shared;
use crate::providers::DebridProvider;

fn map_torrent(t: RdTorrent) -> shared::Torrent {
    shared::Torrent {
        id: t.id,
        filename: t.filename,
        hash: t.hash,
        bytes: t.bytes,
        progress: t.progress,
        status: t.status,
        added: t.added,
        links: t.links,
        ended: t.ended,
        speed: t.speed,
        seeders: t.seeders,
    }
}

fn map_torrent_info(info: RdTorrentInfo) -> shared::TorrentInfo {
    shared::TorrentInfo {
        id: info.id,
        filename: info.filename,
        hash: info.hash,
        bytes: info.bytes,
        progress: info.progress,
        status: info.status,
        added: info.added,
        files: info
            .files
            .into_iter()
            .map(|f| shared::TorrentFile {
                id: f.id,
                path: f.path,
                bytes: f.bytes,
                selected: f.selected == 1,
            })
            .collect(),
        links: info.links,
        ended: info.ended,
        speed: info.speed,
        seeders: info.seeders,
    }
}

fn map_download_link(link: RdUnrestrictedLink) -> shared::DownloadLink {
    shared::DownloadLink {
        filename: link.filename,
        filesize: link.filesize,
        download: link.download,
        streamable: link.streamable.map(|s| s == 1),
    }
}

fn map_download_item(item: RdDownloadItem) -> shared::DownloadItem {
    shared::DownloadItem {
        id: item.id,
        filename: item.filename,
        filesize: item.filesize,
        download: item.download,
        generated: item.generated,
    }
}

// ── DebridProvider implementation ──

#[async_trait]
impl DebridProvider for RdClient {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn info(&self) -> shared::ProviderInfo {
        shared::ProviderInfo {
            id: "real-debrid".to_string(),
            name: "Real-Debrid".to_string(),
            auth_method: shared::AuthMethod::OAuthDevice,
            supports_streaming: true,
        }
    }

    async fn authenticate(&self, auth: &shared::ProviderAuth) -> Result<shared::User, shared::ProviderError> {
        match auth {
            shared::ProviderAuth::Token(token) => {
                self.set_token(token.clone()).await;
            }
            shared::ProviderAuth::OAuth { access_token, .. } => {
                self.set_token(access_token.clone()).await;
            }
        }
        let rd_user = self.rd_get_user().await?;
        Ok(shared::User {
            username: rd_user.username,
            email: rd_user.email,
            premium: rd_user.premium > 0,
            expiration: Some(rd_user.expiration),
        })
    }

    async fn is_authenticated(&self) -> bool {
        self.has_token().await
    }

    async fn list_torrents(&self, page: u32, limit: u32) -> Result<Vec<shared::Torrent>, shared::ProviderError> {
        let torrents = self.rd_list_torrents(Some(page), Some(limit)).await?;
        Ok(torrents.into_iter().map(map_torrent).collect())
    }

    async fn torrent_info(&self, id: &str) -> Result<shared::TorrentInfo, shared::ProviderError> {
        let info = self.rd_torrent_info(id).await?;
        Ok(map_torrent_info(info))
    }

    async fn add_magnet(&self, magnet: &str) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let resp = self.rd_add_magnet(magnet).await?;
        Ok(shared::AddTorrentResponse { id: resp.id })
    }

    async fn add_torrent_file(&self, bytes: &[u8]) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let resp = self.rd_add_torrent_file(bytes.to_vec()).await?;
        Ok(shared::AddTorrentResponse { id: resp.id })
    }

    async fn select_files(&self, id: &str, file_ids: &[u64]) -> Result<(), shared::ProviderError> {
        let ids_str = if file_ids.is_empty() {
            "all".to_string()
        } else {
            file_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",")
        };
        self.rd_select_files(id, &ids_str).await
    }

    async fn delete_torrent(&self, id: &str) -> Result<(), shared::ProviderError> {
        self.rd_delete_torrent(id).await
    }

    async fn get_download_links(&self, id: &str) -> Result<Vec<shared::DownloadLink>, shared::ProviderError> {
        let info = self.rd_torrent_info(id).await?;
        let mut results = Vec::new();
        for link in &info.links {
            match self.rd_unrestrict_link(link).await {
                Ok(unrestricted) => results.push(map_download_link(unrestricted)),
                Err(e) => {
                    log::warn!("Failed to unrestrict link {}: {}", link, e);
                }
            }
        }
        Ok(results)
    }

    async fn get_download_link_for_file(
        &self,
        torrent_id: &str,
        file_id: u64,
    ) -> Result<shared::DownloadLink, shared::ProviderError> {
        let info = self.rd_torrent_info(torrent_id).await?;
        let selected_files: Vec<_> = info.files.iter().filter(|f| f.selected == 1).collect();
        let link_index = selected_files
            .iter()
            .position(|f| f.id == file_id)
            .ok_or_else(|| shared::ProviderError::Other("File not found in torrent".to_string()))?;
        let link = info
            .links
            .get(link_index)
            .ok_or_else(|| shared::ProviderError::Other("No link available for this file".to_string()))?;
        let unrestricted = self.rd_unrestrict_link(link).await?;
        Ok(map_download_link(unrestricted))
    }

    async fn download_history(
        &self,
        page: u32,
        limit: u32,
    ) -> Result<Vec<shared::DownloadItem>, shared::ProviderError> {
        let items = self.rd_list_downloads(Some(page), Some(limit)).await?;
        Ok(items.into_iter().map(map_download_item).collect())
    }

    async fn check_availability(&self, hashes: &[String]) -> Result<Vec<String>, shared::ProviderError> {
        let resp = self.rd_instant_availability(hashes).await?;
        Ok(resp
            .into_iter()
            .filter(|(_, v)| v.as_object().map_or(false, |obj| !obj.is_empty()))
            .map(|(hash, _)| hash.to_lowercase())
            .collect())
    }
}
