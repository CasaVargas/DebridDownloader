use async_trait::async_trait;
use reqwest::Client;
use std::any::Any;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::types::*;
use crate::providers::types as shared;
use crate::providers::DebridProvider;

const BASE_URL: &str = "https://www.premiumize.me/api";

#[derive(Clone)]
pub struct PremiumizeClient {
    http: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl PremiumizeClient {
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

    async fn get<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<T, shared::ProviderError> {
        let key = self.get_key().await?;
        let separator = if path.contains('?') { '&' } else { '?' };
        let url = format!("{}{}{}apikey={}", BASE_URL, path, separator, key);
        let resp = self.http.get(&url).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(shared::ProviderError::Other(format!(
                "HTTP {}: {}",
                status, text
            )));
        }
        Ok(resp.json().await?)
    }

    async fn post_form<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, shared::ProviderError> {
        let key = self.get_key().await?;
        let url = format!("{}{}", BASE_URL, path);
        let mut form_params: Vec<(&str, String)> = params
            .iter()
            .map(|(k, v)| (*k, v.to_string()))
            .collect();
        form_params.push(("apikey", key));

        let resp = self
            .http
            .post(&url)
            .form(&form_params)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(shared::ProviderError::Other(format!(
                "HTTP {}: {}",
                status, text
            )));
        }
        Ok(resp.json().await?)
    }

    async fn find_transfer(&self, id: &str) -> Result<PmTransfer, shared::ProviderError> {
        let resp: PmTransferList = self.get("/transfer/list").await?;
        resp.transfers
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| shared::ProviderError::Other(format!("Transfer {} not found", id)))
    }
}

fn map_status(status: &str) -> String {
    match status {
        "running" | "seeding" => "downloading".to_string(),
        "finished" => "downloaded".to_string(),
        "waiting" | "queued" => "queued".to_string(),
        "error" | "timeout" | "banned" => "error".to_string(),
        _ => status.to_string(),
    }
}

fn map_torrent(t: &PmTransfer) -> shared::Torrent {
    let status = map_status(t.status.as_deref().unwrap_or("unknown"));
    shared::Torrent {
        id: t.id.clone(),
        filename: t.name.clone().unwrap_or_default(),
        hash: String::new(),
        bytes: 0,
        progress: t.progress.unwrap_or(0.0),
        status,
        added: String::new(),
        links: vec![],
        ended: None,
        speed: None,
        seeders: None,
    }
}

#[async_trait]
impl DebridProvider for PremiumizeClient {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn info(&self) -> shared::ProviderInfo {
        shared::ProviderInfo {
            id: "premiumize".to_string(),
            name: "Premiumize".to_string(),
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

        let resp: PmAccountInfo = self.get("/account/info").await?;
        if resp.status != "success" {
            return Err(shared::ProviderError::Api {
                message: "Authentication failed".to_string(),
                code: None,
            });
        }

        let premium_until = resp.premium_until.unwrap_or(0);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let expiration = if premium_until > 0 {
            chrono::DateTime::from_timestamp(premium_until as i64, 0)
                .map(|dt| dt.to_rfc3339())
        } else {
            None
        };

        Ok(shared::User {
            username: resp
                .customer_id
                .map(|id| id.to_string())
                .unwrap_or_else(|| "Premiumize User".to_string()),
            email: String::new(),
            premium: premium_until > now,
            expiration,
        })
    }

    async fn is_authenticated(&self) -> bool {
        self.api_key.read().await.is_some()
    }

    async fn list_torrents(
        &self,
        page: u32,
        limit: u32,
    ) -> Result<Vec<shared::Torrent>, shared::ProviderError> {
        let resp: PmTransferList = self.get("/transfer/list").await?;
        let start = (page.saturating_sub(1) * limit) as usize;
        Ok(resp
            .transfers
            .iter()
            .filter(|t| t.status.as_deref() != Some("deleted"))
            .map(map_torrent)
            .skip(start)
            .take(limit as usize)
            .collect())
    }

    async fn torrent_info(&self, id: &str) -> Result<shared::TorrentInfo, shared::ProviderError> {
        let transfer = self.find_transfer(id).await?;
        let status = map_status(transfer.status.as_deref().unwrap_or("unknown"));

        let files = if let Some(ref folder_id) = transfer.folder_id {
            let folder: PmFolderList = self
                .get(&format!("/folder/list?id={}", folder_id))
                .await?;
            folder
                .content
                .unwrap_or_default()
                .iter()
                .filter(|item| item.item_type.as_deref() == Some("file"))
                .enumerate()
                .map(|(i, item)| shared::TorrentFile {
                    id: i as u64,
                    path: item.name.clone(),
                    bytes: item.size.unwrap_or(0) as i64,
                    selected: true,
                })
                .collect()
        } else if let Some(ref file_id) = transfer.file_id {
            match self
                .get::<PmItem>(&format!("/item/details?id={}", file_id))
                .await
            {
                Ok(item) => vec![shared::TorrentFile {
                    id: 0,
                    path: item.name.clone(),
                    bytes: item.size.unwrap_or(0) as i64,
                    selected: true,
                }],
                Err(_) => vec![],
            }
        } else {
            vec![]
        };

        Ok(shared::TorrentInfo {
            id: transfer.id,
            filename: transfer.name.unwrap_or_default(),
            hash: String::new(),
            bytes: 0,
            progress: transfer.progress.unwrap_or(0.0),
            status,
            added: String::new(),
            files,
            links: vec![],
            ended: None,
            speed: None,
            seeders: None,
        })
    }

    async fn add_magnet(
        &self,
        magnet: &str,
    ) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let resp: PmCreateResponse = self
            .post_form("/transfer/create", &[("src", magnet)])
            .await?;
        if resp.status != "success" {
            return Err(shared::ProviderError::Api {
                message: "Failed to add magnet".to_string(),
                code: None,
            });
        }
        Ok(shared::AddTorrentResponse {
            id: resp.id.unwrap_or_default(),
        })
    }

    async fn add_torrent_file(
        &self,
        bytes: &[u8],
    ) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let key = self.get_key().await?;
        let url = format!("{}/transfer/create", BASE_URL);
        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name("torrent.torrent")
            .mime_str("application/x-bittorrent")
            .map_err(|e| shared::ProviderError::Other(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("apikey", key);

        let resp = self.http.post(&url).multipart(form).send().await?;
        let api_resp: PmCreateResponse = resp.json().await?;
        if api_resp.status != "success" {
            return Err(shared::ProviderError::Api {
                message: "Failed to add torrent file".to_string(),
                code: None,
            });
        }
        Ok(shared::AddTorrentResponse {
            id: api_resp.id.unwrap_or_default(),
        })
    }

    async fn select_files(
        &self,
        _id: &str,
        _file_ids: &[u64],
    ) -> Result<(), shared::ProviderError> {
        // Premiumize downloads all files — no file selection supported
        Ok(())
    }

    async fn delete_torrent(&self, id: &str) -> Result<(), shared::ProviderError> {
        let _: PmStatusResponse = self
            .post_form("/transfer/delete", &[("id", id)])
            .await?;
        Ok(())
    }

    async fn get_download_links(
        &self,
        id: &str,
    ) -> Result<Vec<shared::DownloadLink>, shared::ProviderError> {
        let transfer = self.find_transfer(id).await?;

        if let Some(ref folder_id) = transfer.folder_id {
            let folder: PmFolderList = self
                .get(&format!("/folder/list?id={}", folder_id))
                .await?;
            Ok(folder
                .content
                .unwrap_or_default()
                .iter()
                .filter(|item| item.item_type.as_deref() == Some("file"))
                .filter_map(|item| {
                    item.link.as_ref().map(|link| shared::DownloadLink {
                        filename: item.name.clone(),
                        filesize: item.size.unwrap_or(0) as i64,
                        download: link.clone(),
                        streamable: item.stream_link.is_some().then_some(true),
                    })
                })
                .collect())
        } else if let Some(ref file_id) = transfer.file_id {
            let item: PmItem = self
                .get(&format!("/item/details?id={}", file_id))
                .await?;
            if let Some(link) = &item.link {
                Ok(vec![shared::DownloadLink {
                    filename: item.name.clone(),
                    filesize: item.size.unwrap_or(0) as i64,
                    download: link.clone(),
                    streamable: item.stream_link.is_some().then_some(true),
                }])
            } else {
                Err(shared::ProviderError::Other(
                    "No download link available".to_string(),
                ))
            }
        } else {
            Err(shared::ProviderError::Other(
                "Transfer has no folder or file ID".to_string(),
            ))
        }
    }

    async fn get_download_link_for_file(
        &self,
        torrent_id: &str,
        file_id: u64,
    ) -> Result<shared::DownloadLink, shared::ProviderError> {
        let links = self.get_download_links(torrent_id).await?;
        links
            .into_iter()
            .nth(file_id as usize)
            .ok_or_else(|| shared::ProviderError::Other("File not found".to_string()))
    }

    async fn download_history(
        &self,
        page: u32,
        limit: u32,
    ) -> Result<Vec<shared::DownloadItem>, shared::ProviderError> {
        let resp: PmTransferList = self.get("/transfer/list").await?;
        let start = (page.saturating_sub(1) * limit) as usize;
        Ok(resp
            .transfers
            .iter()
            .filter(|t| t.status.as_deref() == Some("finished"))
            .skip(start)
            .take(limit as usize)
            .map(|t| shared::DownloadItem {
                id: t.id.clone(),
                filename: t.name.clone().unwrap_or_default(),
                filesize: 0,
                download: String::new(),
                generated: String::new(),
            })
            .collect())
    }
}
