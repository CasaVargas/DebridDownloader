use async_trait::async_trait;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::any::Any;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::types::*;
use crate::providers::types as shared;
use crate::providers::DebridProvider;

const BASE_URL: &str = "https://api.alldebrid.com";
/// AllDebrid requires every request to name the calling app.
const AGENT: &str = "DebridDownloader";

#[derive(Clone)]
pub struct AllDebridClient {
    http: Client,
    base_url: String,
    api_key: Arc<RwLock<Option<String>>>,
}

impl Default for AllDebridClient {
    fn default() -> Self {
        Self::new()
    }
}

impl AllDebridClient {
    pub fn new() -> Self {
        Self::with_base_url(BASE_URL)
    }

    /// Points the client at another host (tests use a local mock server).
    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self {
            http: Client::builder()
                .user_agent("DebridDownloader/1.0.0")
                .build()
                .expect("Failed to create HTTP client"),
            base_url: base_url.into().trim_end_matches('/').to_string(),
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

    fn url(&self, path: &str) -> String {
        format!("{}{}?agent={}", self.base_url, path, AGENT)
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, shared::ProviderError> {
        let key = self.get_key().await?;
        let resp = self.http.get(self.url(path)).bearer_auth(key).send().await?;
        Self::decode(resp).await
    }

    async fn post_form<T: DeserializeOwned>(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<T, shared::ProviderError> {
        let key = self.get_key().await?;
        let resp = self
            .http
            .post(self.url(path))
            .bearer_auth(key)
            .form(form)
            .send()
            .await?;
        Self::decode(resp).await
    }

    /// Decodes the `{status, data | error}` envelope from text, so a shape mismatch reports
    /// the body instead of reqwest's opaque "error decoding response body".
    async fn decode<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, shared::ProviderError> {
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(shared::ProviderError::RateLimited);
        }
        let text = resp.text().await?;
        // AllDebrid sends its error envelope with 4xx codes too, so try it before the status.
        match serde_json::from_str::<AdResponse<T>>(&text) {
            Ok(env) => Self::unwrap_envelope(env),
            Err(_) if !status.is_success() => {
                Err(shared::ProviderError::Other(format!("HTTP {}: {}", status, text)))
            }
            Err(e) => {
                let snippet: String = text.chars().take(200).collect();
                Err(shared::ProviderError::Other(format!(
                    "Unexpected AllDebrid response ({}): {}",
                    e, snippet
                )))
            }
        }
    }

    fn unwrap_envelope<T>(env: AdResponse<T>) -> Result<T, shared::ProviderError> {
        if env.status == "success" {
            if let Some(data) = env.data {
                return Ok(data);
            }
            return Err(shared::ProviderError::Other("No data in AllDebrid response".to_string()));
        }
        Err(api_error(env.error.as_ref(), "AllDebrid returned an error"))
    }

    async fn magnet(&self, id: &str) -> Result<AdMagnet, shared::ProviderError> {
        let data: AdStatusData = self.post_form("/v4.1/magnet/status", &[("id", id)]).await?;
        data.magnets
            .into_vec()
            .into_iter()
            .next()
            .ok_or_else(|| shared::ProviderError::Other(format!("Magnet {} not found", id)))
    }

    async fn all_magnets(&self) -> Result<Vec<AdMagnet>, shared::ProviderError> {
        let data: AdStatusData = self.post_form("/v4.1/magnet/status", &[]).await?;
        Ok(data.magnets.into_vec())
    }

    /// Files of a magnet, flattened in tree order. A file's index is its id.
    async fn files(&self, id: &str) -> Result<Vec<FlatFile>, shared::ProviderError> {
        let data: AdFilesData = self.post_form("/v4/magnet/files", &[("id[]", id)]).await?;
        let entry = data
            .magnets
            .into_iter()
            .find(|m| m.id == id)
            .ok_or_else(|| shared::ProviderError::Other(format!("Magnet {} not found", id)))?;
        if let Some(err) = entry.error.as_ref() {
            return Err(api_error(Some(err), "AllDebrid couldn't list this magnet's files"));
        }
        Ok(flatten_files(&entry.files))
    }

    /// Turns a hoster link from `/magnet/files` into a direct download URL.
    async fn unlock(&self, hoster_link: &str, fallback: &FlatFile) -> Result<shared::DownloadLink, shared::ProviderError> {
        let data: AdUnlock = self.post_form("/v4/link/unlock", &[("link", hoster_link)]).await?;
        if data.link.is_empty() {
            let message = if data.delayed.is_some() {
                "AllDebrid is still preparing this file. Try again in a minute."
            } else {
                "AllDebrid returned no download link"
            };
            return Err(shared::ProviderError::Api { message: message.to_string(), code: None });
        }
        Ok(shared::DownloadLink {
            filename: if data.filename.is_empty() { fallback.name.clone() } else { data.filename },
            filesize: if data.filesize > 0 { data.filesize } else { fallback.size },
            download: data.link,
            streamable: (!data.streams.is_empty()).then_some(true),
            source: shared::LinkSource::AllDebrid { hoster_link: hoster_link.to_string() },
        })
    }

    fn uploaded_id(item: Option<AdUploaded>, what: &str) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let item = item.ok_or_else(|| shared::ProviderError::Other("AllDebrid returned no upload result".to_string()))?;
        if let Some(err) = item.error.as_ref() {
            return Err(api_error(Some(err), &format!("AllDebrid couldn't add this {}", what)));
        }
        item.id
            .map(|id| shared::AddTorrentResponse { id })
            .ok_or_else(|| shared::ProviderError::Other("AllDebrid returned no magnet id".to_string()))
    }
}

fn api_error(err: Option<&AdError>, fallback: &str) -> shared::ProviderError {
    let message = err
        .map(|e| if e.message.trim().is_empty() { shared::humanize_api_message(&e.code) } else { e.message.trim().to_string() })
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| fallback.to_string());
    shared::ProviderError::Api { message, code: None }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FlatFile {
    pub path: String,
    pub name: String,
    pub size: i64,
    pub link: Option<String>,
}

/// Flattens AllDebrid's nested `{n, s, l, e}` tree into files with `folder/name` paths.
pub(crate) fn flatten_files(nodes: &[AdFileNode]) -> Vec<FlatFile> {
    fn walk(nodes: &[AdFileNode], prefix: &str, out: &mut Vec<FlatFile>) {
        for node in nodes {
            let path = if prefix.is_empty() { node.name.clone() } else { format!("{}/{}", prefix, node.name) };
            match &node.entries {
                Some(children) => walk(children, &path, out),
                None => out.push(FlatFile { path, name: node.name.clone(), size: node.size, link: node.link.clone() }),
            }
        }
    }
    let mut out = Vec::new();
    walk(nodes, "", &mut out);
    out
}

pub(crate) fn map_status(status_code: i64) -> String {
    match status_code {
        0 => "queued",
        1 => "downloading",
        2 => "compressing",
        3 => "uploading",
        4 => "downloaded",
        _ => "error",
    }
    .to_string()
}

fn progress(m: &AdMagnet) -> f64 {
    if m.status_code == 4 {
        100.0
    } else if m.size > 0 {
        (m.downloaded as f64 / m.size as f64 * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    }
}

fn timestamp(secs: Option<i64>) -> Option<String> {
    secs.filter(|s| *s > 0)
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|dt| dt.to_rfc3339())
}

fn map_torrent(m: &AdMagnet) -> shared::Torrent {
    shared::Torrent {
        id: m.id.clone(),
        filename: m.filename.clone(),
        hash: m.hash.to_lowercase(),
        bytes: m.size,
        progress: progress(m),
        status: map_status(m.status_code),
        added: timestamp(m.upload_date).unwrap_or_default(),
        links: vec![],
        ended: timestamp(m.completion_date),
        speed: m.download_speed,
        seeders: m.seeders,
    }
}

#[async_trait]
impl DebridProvider for AllDebridClient {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn info(&self) -> shared::ProviderInfo {
        shared::ProviderInfo {
            id: "alldebrid".to_string(),
            name: "AllDebrid".to_string(),
            auth_method: shared::AuthMethod::ApiKey,
            supports_streaming: true,
        }
    }

    async fn authenticate(&self, auth: &shared::ProviderAuth) -> Result<shared::User, shared::ProviderError> {
        let token = match auth {
            shared::ProviderAuth::Token(t) => t.clone(),
            shared::ProviderAuth::OAuth { access_token, .. } => access_token.clone(),
        };
        *self.api_key.write().await = Some(token);

        let data: AdUserData = match self.get("/v4/user").await {
            Ok(d) => d,
            Err(e) => {
                *self.api_key.write().await = None;
                return Err(e);
            }
        };
        let user = data.user;
        Ok(shared::User {
            username: if user.username.is_empty() { "AllDebrid User".to_string() } else { user.username },
            email: user.email,
            premium: user.is_premium,
            expiration: timestamp(Some(user.premium_until)),
        })
    }

    async fn is_authenticated(&self) -> bool {
        self.api_key.read().await.is_some()
    }

    async fn list_torrents(&self, page: u32, limit: u32) -> Result<Vec<shared::Torrent>, shared::ProviderError> {
        let start = (page.saturating_sub(1) * limit) as usize;
        Ok(self
            .all_magnets()
            .await?
            .iter()
            .skip(start)
            .take(limit as usize)
            .map(map_torrent)
            .collect())
    }

    async fn torrent_info(&self, id: &str) -> Result<shared::TorrentInfo, shared::ProviderError> {
        let m = self.magnet(id).await?;
        // Files only exist once AllDebrid has the whole torrent.
        let files = if m.status_code == 4 {
            self.files(id)
                .await?
                .into_iter()
                .enumerate()
                .map(|(i, f)| shared::TorrentFile { id: i as u64, path: f.path, bytes: f.size, selected: true })
                .collect()
        } else {
            vec![]
        };
        let t = map_torrent(&m);
        Ok(shared::TorrentInfo {
            id: t.id,
            filename: t.filename,
            hash: t.hash,
            bytes: t.bytes,
            progress: t.progress,
            status: t.status,
            added: t.added,
            files,
            links: vec![],
            ended: t.ended,
            speed: t.speed,
            seeders: t.seeders,
        })
    }

    async fn add_magnet(&self, magnet: &str) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let data: AdMagnetUploadData = self.post_form("/v4/magnet/upload", &[("magnets[]", magnet)]).await?;
        Self::uploaded_id(data.magnets.into_iter().next(), "magnet")
    }

    async fn add_torrent_file(&self, bytes: &[u8]) -> Result<shared::AddTorrentResponse, shared::ProviderError> {
        let key = self.get_key().await?;
        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name("torrent.torrent")
            .mime_str("application/x-bittorrent")
            .map_err(|e| shared::ProviderError::Other(e.to_string()))?;
        let form = reqwest::multipart::Form::new().part("files[0]", part);
        let resp = self
            .http
            .post(self.url("/v4/magnet/upload/file"))
            .bearer_auth(key)
            .multipart(form)
            .send()
            .await?;
        let data: AdFileUploadData = Self::decode(resp).await?;
        Self::uploaded_id(data.files.into_iter().next(), "torrent file")
    }

    async fn select_files(&self, _id: &str, _file_ids: &[u64]) -> Result<(), shared::ProviderError> {
        // AllDebrid downloads every file of a magnet; there is no file selection.
        Ok(())
    }

    async fn delete_torrent(&self, id: &str) -> Result<(), shared::ProviderError> {
        let _: AdMessage = self.post_form("/v4/magnet/delete", &[("id", id)]).await?;
        Ok(())
    }

    async fn get_download_links(&self, id: &str) -> Result<Vec<shared::DownloadLink>, shared::ProviderError> {
        let mut links = Vec::new();
        for file in self.files(id).await? {
            if let Some(hoster) = file.link.clone() {
                links.push(self.unlock(&hoster, &file).await?);
            }
        }
        Ok(links)
    }

    async fn get_download_link_for_file(
        &self,
        torrent_id: &str,
        file_id: u64,
    ) -> Result<shared::DownloadLink, shared::ProviderError> {
        let file = self
            .files(torrent_id)
            .await?
            .into_iter()
            .nth(file_id as usize)
            .ok_or_else(|| shared::ProviderError::Other("File not found".to_string()))?;
        let hoster = file
            .link
            .clone()
            .ok_or_else(|| shared::ProviderError::Other("No download link available".to_string()))?;
        self.unlock(&hoster, &file).await
    }

    async fn refresh_link(&self, source: &shared::LinkSource) -> Result<shared::DownloadLink, shared::ProviderError> {
        match source {
            shared::LinkSource::AllDebrid { hoster_link } => {
                let fallback = FlatFile { path: String::new(), name: String::new(), size: 0, link: None };
                self.unlock(hoster_link, &fallback).await
            }
            _ => Err(shared::ProviderError::Other("Link belongs to a different provider".into())),
        }
    }

    async fn download_history(&self, page: u32, limit: u32) -> Result<Vec<shared::DownloadItem>, shared::ProviderError> {
        let start = (page.saturating_sub(1) * limit) as usize;
        Ok(self
            .all_magnets()
            .await?
            .iter()
            .filter(|m| m.status_code == 4)
            .skip(start)
            .take(limit as usize)
            .map(|m| shared::DownloadItem {
                id: m.id.clone(),
                filename: m.filename.clone(),
                filesize: m.size,
                download: String::new(),
                generated: timestamp(m.completion_date).unwrap_or_default(),
            })
            .collect())
    }

    async fn check_availability(&self, _hashes: &[String]) -> Result<Vec<String>, shared::ProviderError> {
        // AllDebrid retired its instant-availability endpoint (`/magnet/instant`), so there is
        // no way to tell what is cached before adding it.
        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{HeaderMap, StatusCode, Uri};
    use axum::response::{IntoResponse, Response};
    use axum::routing::any;
    use axum::Router;
    use std::sync::Mutex;

    #[derive(Debug, Clone)]
    struct Seen {
        path: String,
        query: String,
        auth: String,
        body: String,
    }

    #[derive(Clone)]
    struct Mock {
        seen: Arc<Mutex<Vec<Seen>>>,
        routes: Arc<Vec<(&'static str, StatusCode, String)>>,
    }

    async fn handle(State(m): State<Mock>, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
        let path = uri.path().to_string();
        m.seen.lock().unwrap().push(Seen {
            path: path.clone(),
            query: uri.query().unwrap_or_default().to_string(),
            auth: headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string(),
            body: String::from_utf8_lossy(&body).to_string(),
        });
        match m.routes.iter().find(|(p, _, _)| *p == path) {
            Some((_, code, json)) => (*code, [("content-type", "application/json")], json.clone()).into_response(),
            None => (StatusCode::NOT_FOUND, "no route").into_response(),
        }
    }

    /// Serves canned JSON per path on a random local port and records every request.
    async fn mock(routes: Vec<(&'static str, StatusCode, &str)>) -> (AllDebridClient, Arc<Mutex<Vec<Seen>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let state = Mock {
            seen: seen.clone(),
            routes: Arc::new(routes.into_iter().map(|(p, c, j)| (p, c, j.to_string())).collect()),
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().fallback(any(handle)).with_state(state);
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (AllDebridClient::with_base_url(format!("http://{}", addr)), seen)
    }

    async fn authed(routes: Vec<(&'static str, StatusCode, &str)>) -> (AllDebridClient, Arc<Mutex<Vec<Seen>>>) {
        let (c, seen) = mock(routes).await;
        *c.api_key.write().await = Some("KEY".to_string());
        (c, seen)
    }

    const OK: StatusCode = StatusCode::OK;

    const FILES: &str = r#"{"status":"success","data":{"magnets":[{"id":"42","files":[
        {"n":"Show","e":[
            {"n":"S01E01.mkv","s":1000,"l":"https://alldebrid.com/f/aaa"},
            {"n":"Subs","e":[{"n":"en.srt","s":10,"l":"https://alldebrid.com/f/bbb"}]}
        ]},
        {"n":"readme.txt","s":5,"l":"https://alldebrid.com/f/ccc"}
    ]}]}}"#;

    #[tokio::test]
    async fn authenticate_sends_key_and_agent_and_maps_user() {
        let (c, seen) = mock(vec![(
            "/v4/user",
            OK,
            r#"{"status":"success","data":{"user":{"username":"neo","email":"n@x.io","isPremium":true,"premiumUntil":1893456000,"extra":1}}}"#,
        )])
        .await;
        let user = c.authenticate(&shared::ProviderAuth::Token("KEY".into())).await.unwrap();
        assert_eq!(user.username, "neo");
        assert_eq!(user.email, "n@x.io");
        assert!(user.premium);
        assert_eq!(user.expiration.as_deref(), Some("2030-01-01T00:00:00+00:00"));
        assert!(c.is_authenticated().await);
        let s = seen.lock().unwrap()[0].clone();
        assert_eq!(s.auth, "Bearer KEY");
        assert_eq!(s.query, "agent=DebridDownloader");
    }

    #[tokio::test]
    async fn authenticate_reports_bad_key_and_forgets_it() {
        let (c, _) = mock(vec![(
            "/v4/user",
            StatusCode::UNAUTHORIZED,
            r#"{"status":"error","error":{"code":"AUTH_BAD_APIKEY","message":"The auth apikey is invalid"}}"#,
        )])
        .await;
        let err = c.authenticate(&shared::ProviderAuth::Token("bad".into())).await.unwrap_err();
        assert_eq!(err.to_string(), "The auth apikey is invalid");
        assert!(!c.is_authenticated().await);
    }

    #[tokio::test]
    async fn requests_without_a_key_fail_without_network() {
        let c = AllDebridClient::with_base_url("http://127.0.0.1:1");
        assert!(matches!(c.list_torrents(1, 10).await, Err(shared::ProviderError::NotAuthenticated)));
    }

    #[tokio::test]
    async fn rate_limit_maps_to_rate_limited() {
        let (c, _) = authed(vec![("/v4.1/magnet/status", StatusCode::TOO_MANY_REQUESTS, "{}")]).await;
        assert!(matches!(c.list_torrents(1, 10).await, Err(shared::ProviderError::RateLimited)));
    }

    #[tokio::test]
    async fn add_magnet_returns_id_and_surfaces_item_errors() {
        let (c, seen) = authed(vec![(
            "/v4/magnet/upload",
            OK,
            r#"{"status":"success","data":{"magnets":[{"magnet":"magnet:?xt=urn:btih:abc","hash":"abc","name":"X","size":1,"ready":false,"id":77}]}}"#,
        )])
        .await;
        assert_eq!(c.add_magnet("magnet:?xt=urn:btih:abc").await.unwrap().id, "77");
        let body = seen.lock().unwrap()[0].body.clone();
        assert!(body.starts_with("magnets%5B%5D=magnet%3A%3Fxt"), "{}", body);

        let (c, _) = authed(vec![(
            "/v4/magnet/upload",
            OK,
            r#"{"status":"success","data":{"magnets":[{"magnet":"m","error":{"code":"MAGNET_INVALID_URI","message":""}}]}}"#,
        )])
        .await;
        assert_eq!(c.add_magnet("m").await.unwrap_err().to_string(), "Magnet invalid uri");
    }

    #[tokio::test]
    async fn add_torrent_file_uploads_multipart() {
        let (c, seen) = authed(vec![(
            "/v4/magnet/upload/file",
            OK,
            r#"{"status":"success","data":{"files":[{"file":"torrent.torrent","name":"X","hash":"h","ready":true,"id":"9"}]}}"#,
        )])
        .await;
        assert_eq!(c.add_torrent_file(b"d8:announce").await.unwrap().id, "9");
        let s = seen.lock().unwrap()[0].clone();
        assert!(s.body.contains("name=\"files[0]\""), "{}", s.body);
        assert!(s.body.contains("d8:announce"));
        assert_eq!(s.auth, "Bearer KEY");
    }

    #[tokio::test]
    async fn list_torrents_maps_status_progress_and_pages() {
        let (c, _) = authed(vec![(
            "/v4.1/magnet/status",
            OK,
            r#"{"status":"success","data":{"magnets":[
                {"id":1,"filename":"A","hash":"ABC","size":200,"status":"Downloading","statusCode":1,"downloaded":50,"downloadSpeed":7,"seeders":3,"uploadDate":1700000000},
                {"id":2,"filename":"B","hash":"def","size":10,"status":"Ready","statusCode":4,"downloaded":10,"completionDate":1700000100},
                {"id":3,"filename":"C","size":0,"status":"Error","statusCode":7}
            ]}}"#,
        )])
        .await;
        let all = c.list_torrents(1, 10).await.unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!((all[0].id.as_str(), all[0].status.as_str(), all[0].progress), ("1", "downloading", 25.0));
        assert_eq!(all[0].hash, "abc");
        assert_eq!((all[0].speed, all[0].seeders), (Some(7), Some(3)));
        assert_eq!(all[0].added, "2023-11-14T22:13:20+00:00");
        assert_eq!((all[1].status.as_str(), all[1].progress), ("downloaded", 100.0));
        assert!(all[1].ended.is_some());
        assert_eq!(all[2].status, "error");
        let page2 = c.list_torrents(2, 2).await.unwrap();
        assert_eq!(page2.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["3"]);

        let history = c.download_history(1, 10).await.unwrap();
        assert_eq!(history.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), vec!["2"]);
    }

    #[tokio::test]
    async fn torrent_info_flattens_the_file_tree() {
        let (c, seen) = authed(vec![
            (
                "/v4.1/magnet/status",
                OK,
                r#"{"status":"success","data":{"magnets":{"id":42,"filename":"Show","hash":"h","size":1015,"statusCode":4}}}"#,
            ),
            ("/v4/magnet/files", OK, FILES),
        ])
        .await;
        let info = c.torrent_info("42").await.unwrap();
        assert_eq!(info.status, "downloaded");
        let files: Vec<_> = info.files.iter().map(|f| (f.id, f.path.as_str(), f.bytes, f.selected)).collect();
        assert_eq!(
            files,
            vec![(0, "Show/S01E01.mkv", 1000, true), (1, "Show/Subs/en.srt", 10, true), (2, "readme.txt", 5, true)]
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].body, "id=42");
        assert_eq!(seen[1].body, "id%5B%5D=42");
    }

    #[tokio::test]
    async fn download_links_unlock_each_file_and_refresh_by_hoster_link() {
        let (c, seen) = authed(vec![
            ("/v4/magnet/files", OK, FILES),
            (
                "/v4/link/unlock",
                OK,
                r#"{"status":"success","data":{"link":"https://cdn.alldebrid.com/dl/x","filename":"S01E01.mkv","filesize":1000,"streams":[{"id":"s"}]}}"#,
            ),
        ])
        .await;
        let links = c.get_download_links("42").await.unwrap();
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].download, "https://cdn.alldebrid.com/dl/x");
        assert_eq!(links[0].streamable, Some(true));
        assert_eq!(links[0].source, shared::LinkSource::AllDebrid { hoster_link: "https://alldebrid.com/f/aaa".into() });
        assert_eq!(links[2].source, shared::LinkSource::AllDebrid { hoster_link: "https://alldebrid.com/f/ccc".into() });

        let one = c.get_download_link_for_file("42", 1).await.unwrap();
        assert_eq!(one.source, shared::LinkSource::AllDebrid { hoster_link: "https://alldebrid.com/f/bbb".into() });
        assert!(c.get_download_link_for_file("42", 9).await.is_err());

        seen.lock().unwrap().clear();
        let fresh = c
            .refresh_link(&shared::LinkSource::AllDebrid { hoster_link: "https://alldebrid.com/f/ccc".into() })
            .await
            .unwrap();
        assert_eq!(fresh.download, "https://cdn.alldebrid.com/dl/x");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].path, "/v4/link/unlock");
        assert_eq!(seen[0].body, "link=https%3A%2F%2Falldebrid.com%2Ff%2Fccc");
    }

    #[tokio::test]
    async fn delayed_unlock_is_a_readable_error() {
        let (c, _) = authed(vec![(
            "/v4/link/unlock",
            OK,
            r#"{"status":"success","data":{"link":"","delayed":123}}"#,
        )])
        .await;
        let err = c
            .refresh_link(&shared::LinkSource::AllDebrid { hoster_link: "h".into() })
            .await
            .unwrap_err();
        assert!(err.to_string().contains("still preparing"), "{}", err);
    }

    #[tokio::test]
    async fn delete_posts_the_id() {
        let (c, seen) = authed(vec![(
            "/v4/magnet/delete",
            OK,
            r#"{"status":"success","data":{"message":"Magnet was successfully deleted"}}"#,
        )])
        .await;
        c.delete_torrent("42").await.unwrap();
        let s = seen.lock().unwrap()[0].clone();
        assert_eq!((s.path.as_str(), s.body.as_str()), ("/v4/magnet/delete", "id=42"));
    }

    #[tokio::test]
    async fn unexpected_shape_reports_the_body() {
        let (c, _) = authed(vec![("/v4.1/magnet/status", OK, r#"{"status":"success","data":{"magnets":"nope"}}"#)]).await;
        let err = c.list_torrents(1, 10).await.unwrap_err().to_string();
        assert!(err.starts_with("Unexpected AllDebrid response"), "{}", err);
        assert!(err.contains("nope"), "{}", err);
    }

    #[tokio::test]
    async fn select_files_and_availability_need_no_network() {
        let c = AllDebridClient::with_base_url("http://127.0.0.1:1");
        *c.api_key.write().await = Some("KEY".into());
        assert!(c.select_files("1", &[0]).await.is_ok());
        assert!(c.check_availability(&["abc".into()]).await.unwrap().is_empty());
    }

    #[test]
    fn status_codes_map_to_shared_statuses() {
        let got: Vec<String> = (0..=6).map(map_status).collect();
        assert_eq!(got, vec!["queued", "downloading", "compressing", "uploading", "downloaded", "error", "error"]);
    }
}
