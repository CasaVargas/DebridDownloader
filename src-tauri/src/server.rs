//! HTTP API of the headless server (axum).
//!
//! Every route except `GET /health` and `POST /login` needs the server token, sent either as
//! `Authorization: Bearer <token>` or as the `dd_token` cookie that `/login` sets for a browser.
//! The token lives in the [`SecretStore`] under [`AUTH_TOKEN_KEY`]. Routes call the same
//! `crate::service` functions as the Tauri commands; request bodies use the commands' argument
//! names (camelCase, as `invoke()` sends them).
//!
//! `GET /api/events` is a Server-Sent Events stream of the app events the desktop emits through
//! Tauri (`download-progress`, `downloads-changed`, `watchlist-match`, ...): each SSE `event:` is
//! the desktop event name and its `data:` the same JSON payload. It takes the cookie too, since a
//! browser `EventSource` can't set an `Authorization` header.

use crate::engine_host::{BroadcastEvent, BroadcastEvents};
use crate::events::AppEvents;
use crate::persistence::Persistence;
use crate::providers::types::{
    AddTorrentResponse, AuthMethod, DeviceCode, DeviceCredentials, DownloadItem, DownloadLink, OAuthToken, Torrent,
    TorrentInfo, User,
};
use crate::rclone;
use crate::scrapers::{SearchParams, SearchResponse, TrackerConfig};
use crate::secrets::{SecretStore, Secrets};
use crate::service;
use crate::service::backup::ImportResult;
use crate::state::{AppSettings, AppState};
use crate::watchlist::{WatchMatch, WatchRule};
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Path, Query, Request, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use futures::{Stream, StreamExt};
use serde_json::json;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::broadcast::{self, error::RecvError};
use tokio_util::sync::CancellationToken;

/// Secret-store key of the server token (env override `DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN`).
pub const AUTH_TOKEN_KEY: &str = "server.auth_token";
/// Cookie `/login` sets so a browser can call the API without an `Authorization` header.
pub const AUTH_COOKIE: &str = "dd_token";

/// The saved server token, or a new random one saved to `secrets` (`true` when generated).
pub fn ensure_auth_token(secrets: &dyn SecretStore) -> Result<(String, bool), String> {
    match secrets.get(AUTH_TOKEN_KEY)? {
        Some(token) if !token.trim().is_empty() => Ok((token.trim().to_string(), false)),
        _ => {
            let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
            secrets.set(AUTH_TOKEN_KEY, &token)?;
            Ok((token, true))
        }
    }
}

/// Everything a route handler needs; cheap to clone.
#[derive(Clone)]
pub struct ServerState {
    pub(crate) state: Arc<AppState>,
    pub(crate) persistence: Persistence,
    pub(crate) secrets: Secrets,
    pub(crate) events: Arc<dyn AppEvents>,
    /// The same sink as `events`; `/api/events` subscribes to it.
    pub(crate) broadcast: Arc<BroadcastEvents>,
    /// Cancelled when the server shuts down; ends open `/api/events` streams, which would
    /// otherwise hold a graceful shutdown open forever.
    pub(crate) shutdown: CancellationToken,
    token: Arc<str>,
    /// The web UI bundle (`npm run build:web`) served at `/`, if any.
    web_dir: Option<Arc<std::path::Path>>,
}

impl ServerState {
    pub(crate) fn new(
        state: Arc<AppState>,
        persistence: Persistence,
        secrets: Secrets,
        events: Arc<BroadcastEvents>,
        token: String,
    ) -> Self {
        Self {
            state,
            persistence,
            secrets,
            events: events.clone(),
            broadcast: events,
            shutdown: CancellationToken::new(),
            token: token.into(),
            web_dir: None,
        }
    }

    /// Serve the web UI bundle in `dir` at `/` (see [`web_fallback`]).
    pub(crate) fn with_web_dir(mut self, dir: Option<std::path::PathBuf>) -> Self {
        self.web_dir = dir.map(Into::into);
        self
    }
}

pub fn router(s: ServerState) -> Router {
    let api = Router::new()
        // Downloads
        .route("/api/downloads", get(list_downloads))
        .route("/api/downloads", post(add_downloads))
        .route("/api/downloads/history", get(download_history))
        .route("/api/downloads/cancel-all", post(cancel_all_downloads))
        .route("/api/downloads/pause-all", post(pause_all_downloads))
        .route("/api/downloads/resume-all", post(resume_all_downloads))
        .route("/api/downloads/retry-failed", post(retry_failed_downloads))
        .route("/api/downloads/clear-completed", post(clear_completed_downloads))
        .route("/api/downloads/{id}", delete(remove_download))
        .route("/api/downloads/{id}/cancel", post(cancel_download))
        .route("/api/downloads/{id}/pause", post(pause_download))
        .route("/api/downloads/{id}/resume", post(resume_download))
        .route("/api/downloads/{id}/retry", post(retry_download))
        .route("/api/batches/{batch_id}/cancel", post(cancel_batch))
        .route("/api/batches/{batch_id}/pause", post(pause_batch))
        .route("/api/batches/{batch_id}/resume", post(resume_batch))
        .route("/api/batches/{batch_id}/retry", post(retry_batch))
        // Torrents
        .route("/api/torrents", get(list_torrents))
        .route("/api/torrents/magnet", post(add_magnet))
        .route("/api/torrents/file", post(add_torrent_file))
        .route("/api/torrents/{id}", get(get_torrent_info))
        .route("/api/torrents/{id}", delete(delete_torrent))
        .route("/api/torrents/{id}/select", post(select_torrent_files))
        .route("/api/torrents/{id}/links", post(unrestrict_torrent_links))
        // Auth and providers
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/token", post(set_api_token))
        .route("/api/auth/load-saved-token", post(load_saved_token))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/user", get(get_user))
        .route("/api/auth/method", get(get_auth_method))
        .route("/api/auth/provider", post(switch_provider))
        .route("/api/auth/oauth/start", post(oauth_start))
        .route("/api/auth/oauth/credentials", post(oauth_poll_credentials))
        .route("/api/auth/oauth/token", post(oauth_get_token))
        .route("/api/providers", get(list_providers))
        // Search and trackers
        .route("/api/search", get(search_torrents))
        .route("/api/trackers", get(get_tracker_configs))
        .route("/api/trackers", put(save_tracker_configs))
        .route("/api/trackers/test", post(test_tracker))
        .route("/api/cache/check", post(check_cache_availability))
        // Settings and backup
        .route("/api/settings", get(get_settings))
        .route("/api/settings", put(update_settings))
        .route("/api/settings/export", post(export_settings))
        .route("/api/settings/import", post(import_settings))
        // Watchlist
        .route("/api/watch/rules", get(get_watch_rules))
        .route("/api/watch/rules", post(add_watch_rule))
        .route("/api/watch/rules", put(update_watch_rule))
        .route("/api/watch/rules/{id}", delete(delete_watch_rule))
        .route("/api/watch/rules/{id}/run", post(run_watch_rule_now))
        .route("/api/watch/matches", get(get_watch_matches))
        .route("/api/watch/matches", delete(clear_watch_matches))
        // Tools
        .route("/api/rclone", get(check_rclone))
        .route("/api/rclone/remotes", get(list_rclone_remotes))
        .route("/api/rclone/remotes/validate", post(validate_rclone_remote))
        .route("/api/extractor/rar-tool", get(detect_rar_tool))
        .route("/api/media-servers/test", post(test_media_server))
        // Events (SSE)
        .route("/api/events", get(event_stream))
        .route_layer(middleware::from_fn_with_state(s.clone(), require_token));
    Router::new()
        .route("/health", get(health))
        .route("/login", post(login))
        .merge(api)
        .fallback(web_fallback)
        .with_state(s)
}

// ── Web UI ──────────────────────────────────────────────────────────

/// Everything no route matched. `/api/*` stays a JSON 404, so a mistyped API path never gets the
/// UI. With a web dir, `GET`/`HEAD` serve the file at that path, or `index.html` for a client
/// route (no file extension) so a reload on `/downloads` works. The bundle is public: the login
/// screen is part of it, and every API route still needs the token.
async fn web_fallback(State(s): State<ServerState>, req: Request) -> Response {
    let path = req.uri().path();
    let not_found = || (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))).into_response();
    if path == "/api" || path.starts_with("/api/") {
        return not_found();
    }
    let Some(root) = s.web_dir.as_deref() else {
        return not_found();
    };
    if req.method() != axum::http::Method::GET && req.method() != axum::http::Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let Some(segments) = web_path_segments(path) else {
        return not_found();
    };
    if let Some(last) = segments.last() {
        let file = segments.iter().fold(root.to_path_buf(), |p, seg| p.join(seg));
        if let Ok(bytes) = tokio::fs::read(&file).await {
            return web_file(&file, bytes, req.method());
        }
        // A missing asset is a 404, not the index (which would fail as a script or a stylesheet).
        if last.contains('.') {
            return not_found();
        }
    }
    let index = root.join("index.html");
    match tokio::fs::read(&index).await {
        Ok(bytes) => web_file(&index, bytes, req.method()),
        Err(_) => not_found(),
    }
}

/// The decoded segments of a request path, or `None` if one could leave the web dir
/// (`..`, a drive or a backslash).
fn web_path_segments(path: &str) -> Option<Vec<String>> {
    let decoded = urlencoding::decode(path).ok()?;
    let mut out = Vec::new();
    for seg in decoded.split('/') {
        match seg {
            "" | "." => continue,
            ".." => return None,
            s if s.contains('\\') || s.contains(':') || s.contains('\0') => return None,
            s => out.push(s.to_string()),
        }
    }
    Some(out)
}

fn web_file(path: &std::path::Path, bytes: Vec<u8>, method: &axum::http::Method) -> Response {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    // Vite fingerprints everything under `assets/`; the index must be re-fetched to pick up a new build.
    let cache = if ext == "html" { "no-cache" } else { "public, max-age=3600" };
    let len = bytes.len();
    let body = if method == axum::http::Method::HEAD { axum::body::Body::empty() } else { axum::body::Body::from(bytes) };
    let mut resp = Response::new(body);
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    resp
}

// ── Auth ────────────────────────────────────────────────────────────

/// Byte-wise comparison that doesn't stop at the first mismatch.
fn token_matches(given: &str, expected: &str) -> bool {
    let (a, b) = (given.as_bytes(), expected.as_bytes());
    if b.is_empty() || a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The token a request carries: a bearer `Authorization` header, else the [`AUTH_COOKIE`].
fn request_token(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let mut parts = auth.trim().splitn(2, ' ');
        if let (Some(scheme), Some(token)) = (parts.next(), parts.next()) {
            if scheme.eq_ignore_ascii_case("bearer") {
                return Some(token.trim().to_string());
            }
        }
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == AUTH_COOKIE)
        .and_then(|(_, value)| urlencoding::decode(value).ok().map(|v| v.into_owned()))
}

fn unauthorized() -> Response {
    let mut resp = (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Unauthorized" }))).into_response();
    resp.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    resp
}

async fn require_token(State(s): State<ServerState>, req: Request, next: Next) -> Response {
    match request_token(req.headers()) {
        Some(token) if token_matches(&token, &s.token) => next.run(req).await,
        _ => unauthorized(),
    }
}

#[derive(Deserialize)]
struct LoginRequest {
    token: String,
}

/// Exchange the token for an `HttpOnly` cookie, for the browser UI.
async fn login(State(s): State<ServerState>, Body(body): Body<LoginRequest>) -> Response {
    if !token_matches(body.token.trim(), &s.token) {
        return unauthorized();
    }
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Strict",
        AUTH_COOKIE,
        urlencoding::encode(&s.token)
    );
    let mut resp = Json(json!({ "ok": true })).into_response();
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().insert(header::SET_COOKIE, v);
    }
    resp
}

// ── Events (SSE) ────────────────────────────────────────────────────

/// `GET /api/events`: every app event from now on, as SSE, until the client goes away or the
/// server shuts down.
async fn event_stream(State(s): State<ServerState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Subscribe here, not lazily in the stream, so nothing emitted after the response is lost.
    let rx = s.broadcast.subscribe();
    let stop = s.shutdown.clone();
    let stream = sse_events(rx).take_until(async move { stop.cancelled().await });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// The SSE stream of a broadcast subscription. A subscriber that lagged behind and lost events
/// gets a `downloads-changed` in their place, so the UI refetches the list instead of showing
/// stale progress; the stream ends when the channel closes.
fn sse_events(rx: broadcast::Receiver<BroadcastEvent>) -> impl Stream<Item = Result<Event, Infallible>> {
    futures::stream::unfold(rx, |mut rx| async move {
        let event = match rx.recv().await {
            Ok(ev) => sse_event(&ev.name, &ev.payload),
            Err(RecvError::Lagged(missed)) => {
                log::warn!("An /api/events subscriber fell behind and missed {} events", missed);
                sse_event("downloads-changed", &serde_json::Value::Null)
            }
            Err(RecvError::Closed) => return None,
        };
        Some((Ok(event), rx))
    })
}

fn sse_event(name: &str, payload: &serde_json::Value) -> Event {
    Event::default().event(name).data(payload.to_string())
}

// ── Routes ──────────────────────────────────────────────────────────

/// An error as a JSON body: `{ "error": "..." }`. Service errors are 500; a request the server
/// can't read (bad JSON, wrong field types, bad query string) keeps the 4xx status axum gives it.
struct ApiError {
    status: StatusCode,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message }
    }
}

impl From<JsonRejection> for ApiError {
    fn from(r: JsonRejection) -> Self {
        Self { status: r.status(), message: r.body_text() }
    }
}

impl From<QueryRejection> for ApiError {
    fn from(r: QueryRejection) -> Self {
        Self { status: r.status(), message: r.body_text() }
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

/// A JSON request body whose rejection is an [`ApiError`].
struct Body<T>(T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for Body<T> {
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Body(Json::<T>::from_request(req, state).await?.0))
    }
}

/// A query string whose rejection is an [`ApiError`].
struct Params<T>(T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for Params<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Params(Query::<T>::from_request_parts(parts, state).await?.0))
    }
}

/// Run a service call that returns nothing; answers `null`.
async fn done(r: impl std::future::Future<Output = Result<(), String>>) -> ApiResult<()> {
    r.await?;
    Ok(Json(()))
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageQuery {
    page: Option<u32>,
    limit: Option<u32>,
}

// Downloads

async fn list_downloads(State(s): State<ServerState>) -> ApiResult<Vec<crate::engine::JobView>> {
    Ok(Json(service::downloads::get_download_tasks(&s.state).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDownloadsRequest {
    links: Vec<DownloadLink>,
    destination_folder: String,
    #[serde(default)]
    torrent_name: Option<String>,
}

/// `start_downloads`: queue `links` into `destinationFolder`; returns the new job ids.
async fn add_downloads(State(s): State<ServerState>, Body(body): Body<StartDownloadsRequest>) -> ApiResult<Vec<String>> {
    let ids = service::downloads::start_downloads(
        &s.state,
        s.events.clone(),
        body.links,
        body.destination_folder,
        body.torrent_name,
    )
    .await?;
    Ok(Json(ids))
}

async fn download_history(State(s): State<ServerState>, Params(q): Params<PageQuery>) -> ApiResult<Vec<DownloadItem>> {
    Ok(Json(service::downloads::get_download_history(&s.state, q.page, q.limit).await?))
}

async fn cancel_all_downloads(State(s): State<ServerState>) -> ApiResult<()> {
    done(service::downloads::cancel_all_downloads(&s.state)).await
}

async fn pause_all_downloads(State(s): State<ServerState>) -> ApiResult<()> {
    done(service::downloads::pause_all_downloads(&s.state)).await
}

async fn resume_all_downloads(State(s): State<ServerState>) -> ApiResult<()> {
    done(service::downloads::resume_all_downloads(&s.state)).await
}

async fn retry_failed_downloads(State(s): State<ServerState>) -> ApiResult<()> {
    done(service::downloads::retry_failed_downloads(&s.state)).await
}

async fn clear_completed_downloads(State(s): State<ServerState>) -> ApiResult<()> {
    done(service::downloads::clear_completed_downloads(&s.state)).await
}

async fn remove_download(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::downloads::remove_download(&s.state, &id)).await
}

async fn cancel_download(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::downloads::cancel_download(&s.state, &id)).await
}

async fn pause_download(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::downloads::pause_download(&s.state, &id)).await
}

async fn resume_download(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::downloads::resume_download(&s.state, &id)).await
}

async fn retry_download(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::downloads::retry_download(&s.state, &id)).await
}

async fn cancel_batch(State(s): State<ServerState>, Path(batch_id): Path<String>) -> ApiResult<()> {
    done(service::downloads::cancel_batch(&s.state, &batch_id)).await
}

async fn pause_batch(State(s): State<ServerState>, Path(batch_id): Path<String>) -> ApiResult<()> {
    done(service::downloads::pause_batch(&s.state, &batch_id)).await
}

async fn resume_batch(State(s): State<ServerState>, Path(batch_id): Path<String>) -> ApiResult<()> {
    done(service::downloads::resume_batch(&s.state, &batch_id)).await
}

async fn retry_batch(State(s): State<ServerState>, Path(batch_id): Path<String>) -> ApiResult<()> {
    done(service::downloads::retry_batch(&s.state, &batch_id)).await
}

// Torrents

async fn list_torrents(State(s): State<ServerState>, Params(q): Params<PageQuery>) -> ApiResult<Vec<Torrent>> {
    Ok(Json(service::torrents::list_torrents(&s.state, q.page, q.limit).await?))
}

async fn get_torrent_info(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<TorrentInfo> {
    Ok(Json(service::torrents::get_torrent_info(&s.state, &id).await?))
}

#[derive(Deserialize)]
struct MagnetRequest {
    magnet: String,
}

async fn add_magnet(State(s): State<ServerState>, Body(body): Body<MagnetRequest>) -> ApiResult<AddTorrentResponse> {
    Ok(Json(service::torrents::add_magnet(&s.state, &body.magnet).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TorrentFileRequest {
    file_bytes: Vec<u8>,
}

async fn add_torrent_file(State(s): State<ServerState>, Body(body): Body<TorrentFileRequest>) -> ApiResult<AddTorrentResponse> {
    Ok(Json(service::torrents::add_torrent_file(&s.state, &body.file_bytes).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectFilesRequest {
    /// `"all"` or a comma-separated id list.
    file_ids: String,
}

async fn select_torrent_files(
    State(s): State<ServerState>,
    Path(id): Path<String>,
    Body(body): Body<SelectFilesRequest>,
) -> ApiResult<()> {
    done(service::torrents::select_torrent_files(&s.state, &id, &body.file_ids)).await
}

async fn delete_torrent(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::torrents::delete_torrent(&s.state, &id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnrestrictRequest {
    #[serde(default)]
    file_ids: Option<Vec<u64>>,
}

/// `unrestrict_torrent_links`: download links for torrent `id` (only `fileIds` when given).
async fn unrestrict_torrent_links(
    State(s): State<ServerState>,
    Path(id): Path<String>,
    Body(body): Body<UnrestrictRequest>,
) -> ApiResult<Vec<DownloadLink>> {
    Ok(Json(service::downloads::unrestrict_torrent_links(&s.state, &id, body.file_ids).await?))
}

// Auth and providers

async fn auth_status(State(s): State<ServerState>) -> ApiResult<serde_json::Value> {
    Ok(Json(json!({
        "authenticated": service::auth::is_authenticated(&s.state).await,
        "provider": service::auth::get_active_provider(&s.state).await,
    })))
}

#[derive(Deserialize)]
struct TokenRequest {
    token: String,
}

async fn set_api_token(State(s): State<ServerState>, Body(body): Body<TokenRequest>) -> ApiResult<()> {
    done(service::auth::set_api_token(&s.state, &*s.secrets, body.token)).await
}

async fn load_saved_token(State(s): State<ServerState>) -> ApiResult<bool> {
    Ok(Json(service::auth::load_saved_token(&s.state, &*s.secrets).await?))
}

async fn logout(State(s): State<ServerState>) -> ApiResult<()> {
    done(service::auth::logout(&s.state, &*s.secrets)).await
}

async fn get_user(State(s): State<ServerState>) -> ApiResult<User> {
    Ok(Json(service::auth::get_user(&s.state, &*s.secrets).await?))
}

async fn get_auth_method(State(s): State<ServerState>) -> ApiResult<AuthMethod> {
    Ok(Json(service::auth::get_auth_method(&s.state).await))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchProviderRequest {
    provider_id: String,
}

/// `switch_provider`: returns whether the provider's saved token authenticated.
async fn switch_provider(State(s): State<ServerState>, Body(body): Body<SwitchProviderRequest>) -> ApiResult<bool> {
    Ok(Json(service::auth::switch_provider(&s.state, &s.persistence, &*s.secrets, &body.provider_id).await?))
}

async fn oauth_start(State(s): State<ServerState>) -> ApiResult<DeviceCode> {
    Ok(Json(service::auth::oauth_start(&s.state).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceCodeRequest {
    device_code: String,
}

async fn oauth_poll_credentials(
    State(s): State<ServerState>,
    Body(body): Body<DeviceCodeRequest>,
) -> ApiResult<Option<DeviceCredentials>> {
    Ok(Json(service::auth::oauth_poll_credentials(&s.state, &*s.secrets, &body.device_code).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthTokenRequest {
    client_id: String,
    client_secret: String,
    device_code: String,
}

async fn oauth_get_token(State(s): State<ServerState>, Body(body): Body<OAuthTokenRequest>) -> ApiResult<OAuthToken> {
    let token = service::auth::oauth_get_token(
        &s.state,
        &*s.secrets,
        &body.client_id,
        &body.client_secret,
        &body.device_code,
    )
    .await?;
    Ok(Json(token))
}

async fn list_providers() -> ApiResult<Vec<crate::providers::types::ProviderInfo>> {
    Ok(Json(service::auth::get_available_providers()))
}

// Search and trackers

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchQuery {
    query: String,
    category: Option<String>,
    sort_by: Option<String>,
    page: Option<u32>,
}

async fn search_torrents(State(s): State<ServerState>, Params(q): Params<SearchQuery>) -> ApiResult<SearchResponse> {
    let params = SearchParams { query: q.query, category: q.category, sort_by: q.sort_by, page: q.page };
    Ok(Json(service::search::search_torrents(&s.state, &s.persistence, params).await))
}

async fn get_tracker_configs(State(s): State<ServerState>) -> ApiResult<Vec<TrackerConfig>> {
    Ok(Json(service::search::get_tracker_configs(&s.persistence)))
}

#[derive(Deserialize)]
struct TrackerConfigsRequest {
    configs: Vec<TrackerConfig>,
}

async fn save_tracker_configs(State(s): State<ServerState>, Body(body): Body<TrackerConfigsRequest>) -> ApiResult<()> {
    service::search::save_tracker_configs(&s.persistence, &body.configs)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestTrackerRequest {
    tracker_type: String,
    url: String,
    #[serde(default)]
    api_key: Option<String>,
}

async fn test_tracker(Body(body): Body<TestTrackerRequest>) -> ApiResult<String> {
    Ok(Json(service::search::test_tracker(&body.tracker_type, &body.url, body.api_key.as_deref()).await?))
}

#[derive(Deserialize)]
struct HashesRequest {
    hashes: Vec<String>,
}

async fn check_cache_availability(State(s): State<ServerState>, Body(body): Body<HashesRequest>) -> ApiResult<Vec<String>> {
    Ok(Json(service::search::check_cache_availability(&s.state, &body.hashes).await?))
}

// Settings and backup

async fn get_settings(State(s): State<ServerState>) -> ApiResult<AppSettings> {
    Ok(Json(service::settings::get_settings(&s.state).await))
}

#[derive(Deserialize)]
struct SettingsRequest {
    settings: AppSettings,
}

async fn update_settings(State(s): State<ServerState>, Body(body): Body<SettingsRequest>) -> ApiResult<()> {
    done(service::settings::update_settings(&s.state, &s.persistence, body.settings)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    include_credentials: bool,
    #[serde(default)]
    frontend_settings_json: String,
}

/// `export_settings`: the backup document, as a JSON string (what the desktop saves to a file).
async fn export_settings(State(s): State<ServerState>, Body(body): Body<ExportRequest>) -> ApiResult<String> {
    let doc = service::backup::export_settings(
        &s.state,
        &s.persistence,
        body.include_credentials,
        &body.frontend_settings_json,
    )
    .await?;
    Ok(Json(doc))
}

#[derive(Deserialize)]
struct ImportRequest {
    json: String,
}

async fn import_settings(State(s): State<ServerState>, Body(body): Body<ImportRequest>) -> ApiResult<ImportResult> {
    Ok(Json(service::backup::import_settings(&s.state, &s.persistence, &body.json).await?))
}

// Watchlist

async fn get_watch_rules(State(s): State<ServerState>) -> ApiResult<Vec<WatchRule>> {
    Ok(Json(service::watchlist::get_watch_rules(&s.state).await))
}

#[derive(Deserialize)]
struct RuleRequest {
    rule: WatchRule,
}

async fn add_watch_rule(State(s): State<ServerState>, Body(body): Body<RuleRequest>) -> ApiResult<WatchRule> {
    Ok(Json(service::watchlist::add_watch_rule(&s.state, &s.persistence, body.rule).await?))
}

async fn update_watch_rule(State(s): State<ServerState>, Body(body): Body<RuleRequest>) -> ApiResult<WatchRule> {
    Ok(Json(service::watchlist::update_watch_rule(&s.state, &s.persistence, body.rule).await?))
}

async fn delete_watch_rule(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<()> {
    done(service::watchlist::delete_watch_rule(&s.state, &s.persistence, &id)).await
}

async fn run_watch_rule_now(State(s): State<ServerState>, Path(id): Path<String>) -> ApiResult<Vec<WatchMatch>> {
    Ok(Json(service::watchlist::run_watch_rule_now(&s.state, &s.persistence, s.events.as_ref(), &id).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleIdQuery {
    rule_id: Option<String>,
}

async fn get_watch_matches(State(s): State<ServerState>, Params(q): Params<RuleIdQuery>) -> ApiResult<Vec<WatchMatch>> {
    Ok(Json(service::watchlist::get_watch_matches(&s.state, q.rule_id.as_deref()).await))
}

async fn clear_watch_matches(State(s): State<ServerState>, Params(q): Params<RuleIdQuery>) -> ApiResult<()> {
    done(service::watchlist::clear_watch_matches(&s.state, &s.persistence, q.rule_id.as_deref())).await
}

// Tools

async fn check_rclone() -> ApiResult<Option<rclone::RcloneInfo>> {
    Ok(Json(rclone::check_rclone().await))
}

async fn list_rclone_remotes() -> ApiResult<Vec<String>> {
    Ok(Json(rclone::list_remotes().await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRequest {
    remote_name: String,
}

/// `validate_rclone_remote`: whether `remoteName` (with or without the trailing `:`) is configured.
async fn validate_rclone_remote(Body(body): Body<RemoteRequest>) -> ApiResult<bool> {
    let remotes = rclone::list_remotes().await?;
    let name = body.remote_name;
    let normalized = if name.ends_with(':') { name } else { format!("{}:", name) };
    Ok(Json(remotes.iter().any(|r| r == &normalized)))
}

/// `detect_rar_tool`: re-scan PATH for a RAR tool; its name or `null`.
async fn detect_rar_tool() -> ApiResult<Option<String>> {
    Ok(Json(crate::extractor::detect_rar_tool().name().map(|s| s.to_string())))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaServerRequest {
    server_type: String,
    url: String,
    credential: String,
}

async fn test_media_server(Body(body): Body<MediaServerRequest>) -> ApiResult<String> {
    Ok(Json(crate::media_servers::test_connection(&body.server_type, &body.url, &body.credential).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::mock_server::{pattern, MockOpts, MockServer};
    use crate::engine::{self, JobState, LinkSource};
    use crate::persistence::{JsonFileStore, SETTINGS_KEY, WATCH_RULES_KEY};
    use crate::providers::types::{ProviderAuth, ProviderError, ProviderInfo};
    use crate::providers::DebridProvider;
    use crate::secrets::FileStore;
    use crate::watchlist::{RuleType, WatchAction};
    use axum::body::Body;
    use axum::http::{Method, Request};
    use std::any::Any;
    use std::sync::Mutex;
    use std::time::Duration;
    use tower::ServiceExt;

    const TOKEN: &str = "test-token-0123456789";
    /// The provider token [`FakeProvider`] accepts.
    const GOOD: &str = "good-provider-token";

    /// A provider that records what the routes asked of it (modelled on `service/tests.rs`).
    #[derive(Default)]
    struct FakeProvider {
        calls: Mutex<Vec<String>>,
        selected: Mutex<Option<(String, Vec<u64>)>>,
    }

    impl FakeProvider {
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
        fn log(&self, call: String) {
            self.calls.lock().unwrap().push(call);
        }
    }

    fn torrent(id: &str) -> Torrent {
        Torrent {
            id: id.into(),
            filename: "Show".into(),
            hash: "h".into(),
            bytes: 1,
            progress: 100.0,
            status: "downloaded".into(),
            added: String::new(),
            links: vec![],
            ended: None,
            speed: None,
            seeders: None,
        }
    }

    #[async_trait::async_trait]
    impl DebridProvider for FakeProvider {
        fn as_any(&self) -> &dyn Any {
            self
        }
        fn info(&self) -> ProviderInfo {
            ProviderInfo { id: "fake".into(), name: "Fake".into(), auth_method: AuthMethod::ApiKey, supports_streaming: false }
        }
        async fn authenticate(&self, auth: &ProviderAuth) -> Result<User, ProviderError> {
            match auth {
                ProviderAuth::Token(t) if t == GOOD => {
                    Ok(User { username: "u".into(), email: "e".into(), premium: true, expiration: None })
                }
                _ => Err(ProviderError::Api { message: "Bad token".into(), code: None }),
            }
        }
        async fn is_authenticated(&self) -> bool {
            true
        }
        async fn list_torrents(&self, page: u32, limit: u32) -> Result<Vec<Torrent>, ProviderError> {
            self.log(format!("list:{}:{}", page, limit));
            Ok(vec![torrent("t1")])
        }
        async fn torrent_info(&self, id: &str) -> Result<TorrentInfo, ProviderError> {
            if id != "t1" {
                return Err(ProviderError::Other(format!("no info for {}", id)));
            }
            let t = torrent(id);
            Ok(TorrentInfo {
                id: t.id,
                filename: t.filename,
                hash: t.hash,
                bytes: t.bytes,
                progress: t.progress,
                status: t.status,
                added: t.added,
                files: vec![],
                links: vec![],
                ended: None,
                speed: None,
                seeders: None,
            })
        }
        async fn add_magnet(&self, magnet: &str) -> Result<AddTorrentResponse, ProviderError> {
            self.log(format!("magnet:{}", magnet));
            Ok(AddTorrentResponse { id: "new".into() })
        }
        async fn add_torrent_file(&self, bytes: &[u8]) -> Result<AddTorrentResponse, ProviderError> {
            self.log(format!("file:{}", bytes.len()));
            Ok(AddTorrentResponse { id: "file".into() })
        }
        async fn select_files(&self, id: &str, file_ids: &[u64]) -> Result<(), ProviderError> {
            *self.selected.lock().unwrap() = Some((id.into(), file_ids.to_vec()));
            Ok(())
        }
        async fn delete_torrent(&self, id: &str) -> Result<(), ProviderError> {
            self.log(format!("delete:{}", id));
            Ok(())
        }
        async fn get_download_links(&self, id: &str) -> Result<Vec<DownloadLink>, ProviderError> {
            self.log(format!("links:{}", id));
            Ok(vec![])
        }
        async fn get_download_link_for_file(&self, torrent_id: &str, file_id: u64) -> Result<DownloadLink, ProviderError> {
            self.log(format!("link:{}:{}", torrent_id, file_id));
            Ok(DownloadLink {
                filename: format!("f{}", file_id),
                filesize: 1,
                download: "http://x".into(),
                streamable: None,
                source: LinkSource::Direct,
            })
        }
        async fn refresh_link(&self, _source: &LinkSource) -> Result<DownloadLink, ProviderError> {
            Err(ProviderError::Other("no refresh".into()))
        }
        async fn download_history(&self, page: u32, limit: u32) -> Result<Vec<DownloadItem>, ProviderError> {
            self.log(format!("history:{}:{}", page, limit));
            Ok(vec![])
        }
        async fn check_availability(&self, hashes: &[String]) -> Result<Vec<String>, ProviderError> {
            Ok(hashes.iter().filter(|h| h.starts_with('c')).cloned().collect())
        }
    }

    /// A local stand-in for trackers and media servers: a Pirate Bay-style `/q.php` with one
    /// result, and `200 {}` for anything else (Plex `/identity`, ...). Returns its base URL.
    async fn stub_server() -> String {
        let router = Router::new()
            .route(
                "/q.php",
                get(|| async {
                    Json(json!([{
                        "name": "Show S01E03 1080p",
                        "info_hash": "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
                        "seeders": "10", "leechers": "1", "size": "1000", "added": "0", "category": "205"
                    }]))
                }),
            )
            .fallback(|| async { Json(json!({})) });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{}", addr)
    }

    /// Put an `rclone` stub that knows one remote (`gdrive:`) first on `PATH`, so the rclone
    /// routes succeed on a machine without rclone.
    #[cfg(unix)]
    fn fake_rclone_on_path() {
        use std::os::unix::fs::PermissionsExt;
        static DONE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
        DONE.get_or_init(|| {
            let dir = std::env::temp_dir().join(format!("dd-server-test-rclone-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let bin = dir.join("rclone");
            std::fs::write(
                &bin,
                "#!/bin/sh\ncase \"$1\" in\n  version) echo 'rclone v1.0.0-test' ;;\n  listremotes) echo 'gdrive:' ;;\n  *) exit 1 ;;\nesac\n",
            )
            .unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            let old = std::env::var_os("PATH").unwrap_or_default();
            let paths = std::iter::once(dir).chain(std::env::split_paths(&old));
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
        });
    }

    #[cfg(not(unix))]
    fn fake_rclone_on_path() {}

    fn rule(id: &str) -> WatchRule {
        WatchRule {
            id: id.into(),
            name: id.into(),
            rule_type: RuleType::TvShow { last_season: None, last_episode: None },
            query: "show".into(),
            category: None,
            regex_filter: None,
            min_seeders: None,
            min_size_bytes: None,
            max_size_bytes: None,
            action: WatchAction::Notify,
            interval_minutes: 60,
            enabled: true,
            created_at: String::new(),
            last_checked: None,
        }
    }

    fn tracker(url: &str) -> serde_json::Value {
        json!({ "id": "pb", "name": "PB", "url": url, "tracker_type": "piratebay_api", "enabled": true })
    }

    struct Harness {
        router: Router,
        state: Arc<AppState>,
        persistence: Persistence,
        secrets: Secrets,
        events: Arc<BroadcastEvents>,
        fake: Arc<FakeProvider>,
        /// Base URL of [`stub_server`].
        stub: String,
        dir: tempfile::TempDir,
    }

    impl Harness {
        /// Put back what routes change: the fake provider active as `torbox` with its token
        /// saved, one watch rule `r1`, and one tracker on the stub server.
        async fn prime(&self) {
            *self.state.provider.write().await = self.fake.clone();
            *self.state.provider_id.write().await = "torbox".into();
            self.secrets.set("torbox.api_token", GOOD).unwrap();
            *self.state.watch_rules.write().await = vec![rule("r1")];
            self.persistence.set_json(crate::persistence::TRACKER_CONFIGS_KEY, &[tracker(&self.stub)]).unwrap();
        }
    }

    /// A server over a fresh data dir with a running engine and a fake provider (no Tauri anywhere).
    async fn harness() -> Harness {
        harness_with_capacity(BroadcastEvents::DEFAULT_CAPACITY).await
    }

    /// [`harness`] whose `/api/events` subscribers may fall `capacity` events behind.
    async fn harness_with_capacity(capacity: usize) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(AppState::new());
        let broadcast = Arc::new(BroadcastEvents::new(capacity));
        let events: Arc<dyn AppEvents> = broadcast.clone();
        let engine = engine::Engine::start(engine::EngineDeps::new(
            dir.path().join("engine"),
            crate::state::AppSettings::default().engine_config(state.rar_tool),
            Arc::new(crate::engine_host::HostSink::new(state.clone(), events.clone())),
            Arc::new(crate::engine_host::ProviderRefresher::new(state.clone())),
            Arc::new(crate::engine_host::RcloneRunner::new(events.clone())),
        ));
        assert!(state.engine.set(engine).is_ok());
        let persistence = Persistence(Arc::new(JsonFileStore::in_dir(dir.path())));
        let secrets = Secrets(Arc::new(FileStore::with_env_prefix(dir.path().join("secrets.json"), "DD_SERVER_TEST_NO_ENV_")));
        let router = router(ServerState::new(state.clone(), persistence.clone(), secrets.clone(), broadcast.clone(), TOKEN.into()));
        let h = Harness {
            router,
            state,
            persistence,
            secrets,
            events: broadcast,
            fake: Arc::new(FakeProvider::default()),
            stub: stub_server().await,
            dir,
        };
        h.prime().await;
        h
    }

    enum Auth<'a> {
        None,
        Bearer(&'a str),
        Cookie(&'a str),
    }

    async fn call(router: &Router, method: Method, path: &str, body: Option<serde_json::Value>, auth: Auth<'_>) -> (StatusCode, HeaderMap, serde_json::Value) {
        let mut req = Request::builder().method(method).uri(path);
        req = match auth {
            Auth::None => req,
            Auth::Bearer(t) => req.header(header::AUTHORIZATION, format!("Bearer {}", t)),
            Auth::Cookie(t) => req.header(header::COOKIE, format!("theme=dark; {}={}", AUTH_COOKIE, t)),
        };
        let req = match body {
            Some(b) => req.header(header::CONTENT_TYPE, "application/json").body(Body::from(b.to_string())),
            None => req.body(Body::empty()),
        }
        .unwrap();
        let resp = router.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let headers = resp.headers().clone();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, headers, json)
    }

    /// A raw GET against `router`: status, headers and body text.
    async fn get_raw(router: &Router, path: &str) -> (StatusCode, HeaderMap, String) {
        let req = Request::builder().method(Method::GET).uri(path).body(Body::empty()).unwrap();
        let resp = router.clone().oneshot(req).await.unwrap();
        let (status, headers) = (resp.status(), resp.headers().clone());
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, headers, String::from_utf8_lossy(&bytes).into_owned())
    }

    /// A web dir like `npm run build:web` writes, plus a secret next to it that must not leak.
    fn web_bundle() -> (tempfile::TempDir, std::path::PathBuf) {
        let parent = tempfile::tempdir().unwrap();
        let web = parent.path().join("dist-web");
        std::fs::create_dir_all(web.join("assets")).unwrap();
        std::fs::write(web.join("index.html"), "<!doctype html><title>DD</title><div id=\"root\"></div>").unwrap();
        std::fs::write(web.join("assets/index-abc.js"), "export const x = 1;").unwrap();
        std::fs::write(web.join("assets/index-abc.css"), "body{}").unwrap();
        std::fs::write(web.join("app-icon.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(parent.path().join("secrets.json"), "{\"server.auth_token\":\"x\"}").unwrap();
        (parent, web)
    }

    #[tokio::test]
    async fn web_ui_is_served_at_root_with_spa_fallback() {
        let h = harness().await;
        let (_parent, web) = web_bundle();
        let s = ServerState::new(h.state.clone(), h.persistence.clone(), h.secrets.clone(), h.events.clone(), TOKEN.into());
        let app = router(s.with_web_dir(Some(web)));

        // The index at `/` and for every client route, without a token.
        for path in ["/", "/downloads", "/torrents", "/settings/general", "/auth"] {
            let (status, headers, body) = get_raw(&app, path).await;
            assert_eq!(status, StatusCode::OK, "{}", path);
            assert_eq!(headers[header::CONTENT_TYPE], "text/html; charset=utf-8", "{}", path);
            assert_eq!(headers[header::CACHE_CONTROL], "no-cache", "{}", path);
            assert!(body.contains("<div id=\"root\">"), "{}: {}", path, body);
        }
        // Assets with their content type.
        let (status, headers, body) = get_raw(&app, "/assets/index-abc.js").await;
        assert_eq!((status, body.as_str()), (StatusCode::OK, "export const x = 1;"));
        assert_eq!(headers[header::CONTENT_TYPE], "text/javascript; charset=utf-8");
        assert_eq!(get_raw(&app, "/assets/index-abc.css").await.1[header::CONTENT_TYPE], "text/css; charset=utf-8");
        assert_eq!(get_raw(&app, "/app-icon.png").await.1[header::CONTENT_TYPE], "image/png");
        // A missing asset is a 404, not the index.
        assert_eq!(get_raw(&app, "/assets/missing.js").await.0, StatusCode::NOT_FOUND);

        // `/api/*` takes precedence: real routes still need the token, unknown ones are JSON 404s.
        let (status, _, body) = get_raw(&app, "/api/downloads").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(!body.contains("root"));
        assert_eq!(ok(&h, Method::GET, "/api/downloads", None).await, json!([]));
        let (status, _, body) = get_raw(&app, "/api/no-such-route").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap(), json!({ "error": "Not found" }));
        assert_eq!(get_raw(&app, "/health").await.0, StatusCode::OK);

        // Nothing outside the web dir.
        for path in ["/../secrets.json", "/assets/../../secrets.json", "/%2e%2e/secrets.json", "/..%2fsecrets.json", "/..%5csecrets.json"] {
            let (status, _, body) = get_raw(&app, path).await;
            assert!(!body.contains("server.auth_token"), "{} leaked: {}", path, body);
            assert_ne!(status, StatusCode::OK, "{}", path);
        }
        // Only reads.
        let (status, _, _) = call(&app, Method::POST, "/downloads", None, Auth::None).await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn without_a_web_dir_only_the_api_is_served() {
        let h = harness().await;
        assert_eq!(get_raw(&h.router, "/").await.0, StatusCode::NOT_FOUND);
        assert_eq!(get_raw(&h.router, "/downloads").await.0, StatusCode::NOT_FOUND);
        assert_eq!(get_raw(&h.router, "/api/downloads").await.0, StatusCode::UNAUTHORIZED);
    }

    /// An authorized call; panics unless it answers 200.
    async fn ok(h: &Harness, method: Method, path: &str, body: Option<serde_json::Value>) -> serde_json::Value {
        let (status, _, json) = call(&h.router, method.clone(), path, body, Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::OK, "{} {}: {}", method, path, json);
        json
    }

    /// Every protected route, with a request that succeeds once authorized.
    fn protected_routes(h: &Harness) -> Vec<(Method, &'static str, Option<serde_json::Value>)> {
        let out = h.dir.path().join("out").to_string_lossy().to_string();
        let settings = serde_json::to_value(AppSettings::default()).unwrap();
        let backup = json!({ "version": "1.0", "app_settings": settings.clone() }).to_string();
        let rule = serde_json::to_value(rule("r1")).unwrap();
        let get = Method::GET;
        let post = Method::POST;
        let put = Method::PUT;
        let delete = Method::DELETE;
        vec![
            // Downloads
            (get.clone(), "/api/downloads", None),
            (post.clone(), "/api/downloads", Some(json!({ "links": [], "destinationFolder": out }))),
            (get.clone(), "/api/downloads/history?page=2&limit=10", None),
            (post.clone(), "/api/downloads/cancel-all", None),
            (post.clone(), "/api/downloads/pause-all", None),
            (post.clone(), "/api/downloads/resume-all", None),
            (post.clone(), "/api/downloads/retry-failed", None),
            (post.clone(), "/api/downloads/clear-completed", None),
            (delete.clone(), "/api/downloads/{id}", None),
            (post.clone(), "/api/downloads/{id}/cancel", None),
            (post.clone(), "/api/downloads/{id}/pause", None),
            (post.clone(), "/api/downloads/{id}/resume", None),
            (post.clone(), "/api/downloads/{id}/retry", None),
            (post.clone(), "/api/batches/{batch_id}/cancel", None),
            (post.clone(), "/api/batches/{batch_id}/pause", None),
            (post.clone(), "/api/batches/{batch_id}/resume", None),
            (post.clone(), "/api/batches/{batch_id}/retry", None),
            // Torrents
            (get.clone(), "/api/torrents?page=1&limit=5", None),
            (post.clone(), "/api/torrents/magnet", Some(json!({ "magnet": "magnet:?xt=urn:btih:abc" }))),
            (post.clone(), "/api/torrents/file", Some(json!({ "fileBytes": [1, 2, 3] }))),
            (get.clone(), "/api/torrents/{id}", None),
            (delete.clone(), "/api/torrents/{id}", None),
            (post.clone(), "/api/torrents/{id}/select", Some(json!({ "fileIds": "all" }))),
            (post.clone(), "/api/torrents/{id}/links", Some(json!({ "fileIds": [1] }))),
            // Auth and providers
            (get.clone(), "/api/auth/status", None),
            (post.clone(), "/api/auth/token", Some(json!({ "token": GOOD }))),
            (post.clone(), "/api/auth/load-saved-token", None),
            (post.clone(), "/api/auth/logout", None),
            (get.clone(), "/api/auth/user", None),
            (get.clone(), "/api/auth/method", None),
            (post.clone(), "/api/auth/provider", Some(json!({ "providerId": "premiumize" }))),
            (post.clone(), "/api/auth/oauth/start", None),
            (post.clone(), "/api/auth/oauth/credentials", Some(json!({ "deviceCode": "dc" }))),
            (post.clone(), "/api/auth/oauth/token", Some(json!({ "clientId": "id", "clientSecret": "s", "deviceCode": "dc" }))),
            (get.clone(), "/api/providers", None),
            // Search and trackers
            (get.clone(), "/api/search?query=show&sortBy=seeders", None),
            (get.clone(), "/api/trackers", None),
            (put.clone(), "/api/trackers", Some(json!({ "configs": [tracker(&h.stub)] }))),
            (post.clone(), "/api/trackers/test", Some(json!({ "trackerType": "piratebay_api", "url": h.stub }))),
            (post.clone(), "/api/cache/check", Some(json!({ "hashes": ["c1", "x2"] }))),
            // Settings and backup
            (get.clone(), "/api/settings", None),
            (put.clone(), "/api/settings", Some(json!({ "settings": settings }))),
            (post.clone(), "/api/settings/export", Some(json!({ "includeCredentials": false, "frontendSettingsJson": "{}" }))),
            (post.clone(), "/api/settings/import", Some(json!({ "json": backup }))),
            // Watchlist
            (get.clone(), "/api/watch/rules", None),
            (post.clone(), "/api/watch/rules", Some(json!({ "rule": rule.clone() }))),
            (put.clone(), "/api/watch/rules", Some(json!({ "rule": rule }))),
            (delete.clone(), "/api/watch/rules/{id}", None),
            (post.clone(), "/api/watch/rules/{id}/run", None),
            (get.clone(), "/api/watch/matches?ruleId=r1", None),
            (delete.clone(), "/api/watch/matches", None),
            // Tools
            (get.clone(), "/api/rclone", None),
            (get.clone(), "/api/rclone/remotes", None),
            (post.clone(), "/api/rclone/remotes/validate", Some(json!({ "remoteName": "gdrive" }))),
            (get.clone(), "/api/extractor/rar-tool", None),
            (post.clone(), "/api/media-servers/test", Some(json!({ "serverType": "plex", "url": h.stub, "credential": "x" }))),
        ]
    }

    /// The concrete URL for a route-table path: `{id}` / `{batch_id}` filled in.
    fn concrete(path: &str) -> String {
        path.replace("/api/watch/rules/{id}", "/api/watch/rules/r1")
            .replace("/api/torrents/{id}", "/api/torrents/t1")
            .replace("{id}", "job-1")
            .replace("{batch_id}", "batch-1")
    }

    /// Routes that can't answer 200 in a test: the Real-Debrid OAuth device flow is hard-wired to
    /// api.real-debrid.com, so with any other provider active the handler answers this error.
    fn expected_failure(path: &str) -> Option<&'static str> {
        path.starts_with("/api/auth/oauth/").then_some("OAuth is only supported for Real-Debrid")
    }

    /// `(METHOD, path)` of every `.route(...)` registered in this file's `router`.
    fn registered_routes() -> Vec<(String, String)> {
        let src = include_str!("server.rs");
        let body = &src[src.find("pub fn router(").unwrap()..src.find("// ── Auth").unwrap()];
        let re = regex::Regex::new(r#"\.route\("([^"]+)",\s*(get|post|put|patch|delete)\("#).unwrap();
        re.captures_iter(body).map(|c| (c[2].to_uppercase(), c[1].to_string())).collect()
    }

    #[tokio::test]
    async fn the_route_table_in_these_tests_covers_every_route() {
        let h = harness().await;
        let mut tested: Vec<(String, String)> = protected_routes(&h)
            .into_iter()
            .map(|(m, p, _)| (m.to_string(), p.split('?').next().unwrap().to_string()))
            .chain([("GET".into(), "/health".into()), ("POST".into(), "/login".into())])
            // An endless SSE body; covered by the `/api/events` tests below.
            .chain([("GET".into(), "/api/events".into())])
            .collect();
        let mut registered = registered_routes();
        tested.sort();
        registered.sort();
        assert_eq!(tested, registered);
        assert!(registered.len() > 50, "{}", registered.len());
    }

    #[tokio::test]
    async fn every_route_but_health_and_login_needs_the_token() {
        fake_rclone_on_path();
        let h = harness().await;
        for (method, path, body) in protected_routes(&h) {
            let url = concrete(path);
            let url = url.as_str();
            for bad in [Auth::None, Auth::Bearer("wrong"), Auth::Bearer(""), Auth::Cookie("wrong")] {
                let (status, headers, json) = call(&h.router, method.clone(), url, body.clone(), bad).await;
                assert_eq!(status, StatusCode::UNAUTHORIZED, "{} {}", method, url);
                assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
                assert_eq!(json["error"], "Unauthorized");
            }
            // A token that's only a prefix of the real one is still wrong.
            let (status, _, _) = call(&h.router, method.clone(), url, body.clone(), Auth::Bearer(&TOKEN[..10])).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{} {}", method, url);

            for good in [Auth::Bearer(TOKEN), Auth::Cookie(TOKEN)] {
                h.prime().await;
                let (status, _, json) = call(&h.router, method.clone(), url, body.clone(), good).await;
                match expected_failure(path) {
                    None => assert_eq!(status, StatusCode::OK, "{} {}: {}", method, url, json),
                    // Authorized: the handler ran and answered its own error.
                    Some(error) => {
                        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{} {}", method, url);
                        assert_eq!(json["error"], error, "{} {}", method, url);
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn health_and_login_are_open() {
        let h = harness().await;
        let (status, _, json) = call(&h.router, Method::GET, "/health", None, Auth::None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["status"], "ok");

        let (status, _, _) = call(&h.router, Method::POST, "/login", Some(json!({ "token": "nope" })), Auth::None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (status, headers, _) = call(&h.router, Method::POST, "/login", Some(json!({ "token": TOKEN })), Auth::None).await;
        assert_eq!(status, StatusCode::OK);
        let cookie = headers[header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.starts_with(&format!("{}={};", AUTH_COOKIE, TOKEN)), "{}", cookie);
        assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"));

        // The cookie the browser got back opens the API.
        let value = cookie.split(';').next().unwrap().split_once('=').unwrap().1;
        let (status, _, _) = call(&h.router, Method::GET, "/api/settings", None, Auth::Cookie(value)).await;
        assert_eq!(status, StatusCode::OK);
    }

    /// Read route and write route over HTTP: add a download served by the mock CDN, then see the
    /// job in the list and the file on disk.
    #[tokio::test]
    async fn add_download_against_the_mock_cdn_then_list_it() {
        let h = harness().await;
        let cdn = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;

        let (status, _, list) = call(&h.router, Method::GET, "/api/downloads", None, Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(list, json!([]));

        let out = h.dir.path().join("out");
        let body = json!({
            "links": [{
                "filename": "episode.mkv",
                "filesize": 300_000,
                "download": cdn.url(),
                "streamable": null,
                "source": serde_json::to_value(LinkSource::Direct).unwrap(),
            }],
            "destinationFolder": out.to_string_lossy(),
            "torrentName": "My Show",
        });
        let (status, _, ids) = call(&h.router, Method::POST, "/api/downloads", Some(body), Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::OK, "{}", ids);
        let id = ids[0].as_str().unwrap().to_string();

        let (status, _, list) = call(&h.router, Method::GET, "/api/downloads", None, Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);
        let job = list.as_array().unwrap().iter().find(|j| j["id"] == id.as_str()).expect("job not listed");
        assert_eq!(job["filename"], "episode.mkv");
        assert_eq!(job["batch_name"], "My Show");

        let completed = serde_json::to_value(JobState::Completed).unwrap();
        let mut done = false;
        for _ in 0..200 {
            let (_, _, list) = call(&h.router, Method::GET, "/api/downloads", None, Auth::Bearer(TOKEN)).await;
            if list.as_array().unwrap().iter().any(|j| j["id"] == id.as_str() && j["status"] == completed) {
                done = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(done, "download did not complete");
        assert_eq!(std::fs::read(out.join("My Show").join("episode.mkv")).unwrap(), pattern(300_000));
        assert!(cdn.requests() > 0);
        assert_eq!(h.state.engine().unwrap().list().await.len(), 1);
    }

    #[tokio::test]
    async fn service_errors_are_json() {
        let h = harness().await;
        h.state.settings.write().await.symlink_mode = true;
        let body = json!({ "links": [{ "filename": "a", "filesize": 1, "download": "http://x", "streamable": null,
            "source": serde_json::to_value(LinkSource::Direct).unwrap() }], "destinationFolder": "/x" });
        let (status, _, json) = call(&h.router, Method::POST, "/api/downloads", Some(body), Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(json["error"].as_str().unwrap().contains("mount path"));
    }

    // ── /api/events ──

    /// Open `/api/events` with `auth`; the status, headers and (unread) body.
    async fn open_events(router: &Router, auth: Auth<'_>) -> (StatusCode, HeaderMap, Body) {
        let mut req = Request::builder().method(Method::GET).uri("/api/events");
        req = match auth {
            Auth::None => req,
            Auth::Bearer(t) => req.header(header::AUTHORIZATION, format!("Bearer {}", t)),
            Auth::Cookie(t) => req.header(header::COOKIE, format!("theme=dark; {}={}", AUTH_COOKIE, t)),
        };
        let resp = router.clone().oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
        let (parts, body) = resp.into_parts();
        (parts.status, parts.headers, body)
    }

    /// Reads SSE frames off a response body as `(event, data)`, skipping keep-alive comments.
    struct SseReader {
        body: axum::body::BodyDataStream,
        buf: String,
    }

    impl SseReader {
        fn new(body: Body) -> Self {
            Self { body: body.into_data_stream(), buf: String::new() }
        }

        /// The next event, or `None` when the stream ends or nothing comes within 10 s.
        async fn next(&mut self) -> Option<(String, serde_json::Value)> {
            loop {
                while let Some(end) = self.buf.find("\n\n") {
                    let frame: String = self.buf.drain(..end + 2).collect();
                    let (mut name, mut data) = (None, String::new());
                    for line in frame.lines() {
                        if let Some(v) = line.strip_prefix("event:") {
                            name = Some(v.trim().to_string());
                        } else if let Some(v) = line.strip_prefix("data:") {
                            data.push_str(v.trim_start());
                        }
                    }
                    if let Some(name) = name {
                        return Some((name, serde_json::from_str(&data).expect("SSE data is JSON")));
                    }
                }
                match tokio::time::timeout(Duration::from_secs(10), self.body.next()).await {
                    Ok(Some(Ok(bytes))) => self.buf.push_str(std::str::from_utf8(&bytes).unwrap()),
                    _ => return None,
                }
            }
        }

        /// Read until the `download-progress` event that shows job `id` completed; every event
        /// read on the way, that one included.
        async fn until_completed(&mut self, id: &str) -> Vec<(String, serde_json::Value)> {
            let completed = serde_json::to_value(JobState::Completed).unwrap();
            let mut seen = vec![];
            while let Some((name, data)) = self.next().await {
                let done = name == "download-progress" && data["id"] == id && data["status"] == completed;
                seen.push((name, data));
                if done {
                    return seen;
                }
            }
            panic!("no completion event for {}; got {:?}", id, seen);
        }
    }

    /// Queue a 300 kB download of `episode.mkv` from `cdn` over HTTP; its job id.
    async fn add_episode(h: &Harness, cdn: &MockServer) -> String {
        let body = json!({
            "links": [{ "filename": "episode.mkv", "filesize": 300_000, "download": cdn.url(), "streamable": null,
                "source": serde_json::to_value(LinkSource::Direct).unwrap() }],
            "destinationFolder": h.dir.path().join("out").to_string_lossy(),
        });
        ok(h, Method::POST, "/api/downloads", Some(body)).await[0].as_str().unwrap().to_string()
    }

    /// Subscribe to `/api/events`, add a download served by the mock CDN, and get its progress and
    /// completion as SSE, under the desktop's event names and payloads.
    #[tokio::test]
    async fn events_stream_download_progress_and_completion() {
        let h = harness().await;
        let cdn = MockServer::start(MockOpts {
            size: 300_000,
            ranges: true,
            chunk_delay: Some(Duration::from_millis(5)),
            ..Default::default()
        })
        .await;
        let (status, headers, body) = open_events(&h.router, Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::CONTENT_TYPE], "text/event-stream");
        let mut sse = SseReader::new(body);

        let id = add_episode(&h, &cdn).await;
        let seen = sse.until_completed(&id).await;

        // The list changed when the job was added.
        assert!(seen.iter().any(|(name, data)| name == "downloads-changed" && data.is_null()), "{:?}", seen);
        // Progress came before completion, as `JobView` payloads.
        let progress: Vec<&serde_json::Value> =
            seen.iter().filter(|(name, data)| name == "download-progress" && data["id"] == id.as_str()).map(|(_, d)| d).collect();
        // `until_completed` stops at the first completed one, so the others were in flight.
        assert!(progress.len() >= 2, "{:?}", seen);
        let last = progress.last().unwrap();
        assert_eq!(last["filename"], "episode.mkv");
        assert_eq!(last["downloaded_bytes"], 300_000);
        assert_eq!(std::fs::read(h.dir.path().join("out").join("episode.mkv")).unwrap(), pattern(300_000));

        // Watchlist matches and other app events go out the same way.
        h.events.emit_json("watchlist-match", json!({ "rule_id": "r1" }));
        assert_eq!(sse.next().await, Some(("watchlist-match".to_string(), json!({ "rule_id": "r1" }))));
    }

    #[tokio::test]
    async fn events_need_the_token_or_the_cookie() {
        let h = harness().await;
        for bad in [Auth::None, Auth::Bearer("wrong"), Auth::Bearer(&TOKEN[..10]), Auth::Cookie("wrong")] {
            let (status, headers, body) = open_events(&h.router, bad).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
            assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
            let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
            assert_eq!(serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["error"], "Unauthorized");
        }
        // `EventSource` can't set headers, so the `/login` cookie works as well as the bearer token.
        for good in [Auth::Bearer(TOKEN), Auth::Cookie(TOKEN)] {
            let (status, headers, body) = open_events(&h.router, good).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(headers[header::CONTENT_TYPE], "text/event-stream");
            let mut sse = SseReader::new(body);
            h.events.emit_json("downloads-changed", serde_json::Value::Null);
            assert_eq!(sse.next().await, Some(("downloads-changed".to_string(), serde_json::Value::Null)));
        }
    }

    /// A subscriber that doesn't read doesn't hold the engine up: the download completes while its
    /// stream lags, and when it reads again it's told to refetch, then gets the newest events.
    #[tokio::test]
    async fn a_lagging_events_subscriber_does_not_block_the_engine() {
        let h = harness_with_capacity(4).await;
        let cdn = MockServer::start(MockOpts {
            size: 300_000,
            ranges: true,
            chunk_delay: Some(Duration::from_millis(5)),
            ..Default::default()
        })
        .await;
        let (status, _, body) = open_events(&h.router, Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);

        let id = add_episode(&h, &cdn).await;
        // Nobody reads the stream while the job runs to completion.
        wait_for_job(&h, &id, "Completed", |j| j["status"] == serde_json::to_value(JobState::Completed).unwrap()).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        // More events than the subscriber can hold.
        for i in 0..10 {
            h.events.emit_json("watchlist-match", json!({ "n": i }));
        }

        let mut sse = SseReader::new(body);
        assert_eq!(sse.next().await, Some(("downloads-changed".to_string(), serde_json::Value::Null)));
        for i in 6..10 {
            assert_eq!(sse.next().await, Some(("watchlist-match".to_string(), json!({ "n": i }))));
        }
        // Still subscribed after lagging.
        h.events.emit_json("downloads-changed", serde_json::Value::Null);
        assert_eq!(sse.next().await, Some(("downloads-changed".to_string(), serde_json::Value::Null)));
    }

    /// Server shutdown ends open streams, so a graceful shutdown doesn't wait on them.
    #[tokio::test]
    async fn events_stream_ends_on_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let broadcast = Arc::new(BroadcastEvents::default());
        let persistence = Persistence(Arc::new(JsonFileStore::in_dir(dir.path())));
        let secrets = Secrets(Arc::new(FileStore::with_env_prefix(dir.path().join("secrets.json"), "DD_SERVER_TEST_NO_ENV_")));
        let s = ServerState::new(Arc::new(AppState::new()), persistence, secrets, broadcast, TOKEN.into());
        let (_, _, body) = open_events(&router(s.clone()), Auth::Bearer(TOKEN)).await;
        let mut sse = SseReader::new(body);
        s.shutdown.cancel();
        assert_eq!(tokio::time::timeout(Duration::from_secs(5), sse.next()).await.unwrap(), None);
    }

    /// The job `id` in the downloads list, polled until `pred` holds (or a timeout).
    async fn wait_for_job(h: &Harness, id: &str, what: &str, pred: impl Fn(&serde_json::Value) -> bool) -> serde_json::Value {
        for _ in 0..200 {
            let list = ok(h, Method::GET, "/api/downloads", None).await;
            if let Some(job) = list.as_array().unwrap().iter().find(|j| j["id"] == id) {
                if pred(job) {
                    return job.clone();
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("job {} never became {}", id, what);
    }

    /// Download control over HTTP: pause, resume and cancel a job the mock CDN is serving slowly,
    /// and see each state in the list.
    #[tokio::test]
    async fn download_control_routes_pause_resume_and_cancel_a_job() {
        let h = harness().await;
        let cdn = MockServer::start(MockOpts {
            size: 2_000_000,
            ranges: true,
            chunk_delay: Some(Duration::from_millis(30)),
            ..Default::default()
        })
        .await;
        let out = h.dir.path().join("out");
        let body = json!({
            "links": [{ "filename": "slow.mkv", "filesize": 2_000_000, "download": cdn.url(), "streamable": null,
                "source": serde_json::to_value(LinkSource::Direct).unwrap() }],
            "destinationFolder": out.to_string_lossy(),
        });
        let ids = ok(&h, Method::POST, "/api/downloads", Some(body)).await;
        let id = ids[0].as_str().unwrap().to_string();
        let status = |s: JobState| serde_json::to_value(s).unwrap();

        wait_for_job(&h, &id, "Downloading", |j| j["status"] == status(JobState::Downloading)).await;

        assert_eq!(ok(&h, Method::POST, &format!("/api/downloads/{}/pause", id), None).await, serde_json::Value::Null);
        wait_for_job(&h, &id, "Paused", |j| j["status"] == status(JobState::Paused)).await;

        ok(&h, Method::POST, &format!("/api/downloads/{}/resume", id), None).await;
        wait_for_job(&h, &id, "resumed", |j| j["status"] != status(JobState::Paused)).await;

        ok(&h, Method::POST, &format!("/api/downloads/{}/cancel", id), None).await;
        let job = wait_for_job(&h, &id, "Cancelled", |j| j["status"] == status(JobState::Cancelled)).await;
        assert!(job["downloaded_bytes"].as_i64().unwrap() < 2_000_000);

        // A cancelled job can be retried, then removed from the list.
        ok(&h, Method::POST, &format!("/api/downloads/{}/retry", id), None).await;
        wait_for_job(&h, &id, "retried", |j| j["status"] != status(JobState::Cancelled)).await;
        ok(&h, Method::POST, "/api/downloads/cancel-all", None).await;
        wait_for_job(&h, &id, "Cancelled again", |j| j["status"] == status(JobState::Cancelled)).await;
        ok(&h, Method::DELETE, &format!("/api/downloads/{}", id), None).await;
        let mut gone = false;
        for _ in 0..100 {
            if ok(&h, Method::GET, "/api/downloads", None).await == json!([]) {
                gone = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(gone, "removed job still listed");
    }

    /// Torrent routes reach the active (fake) provider with the right arguments.
    #[tokio::test]
    async fn torrent_routes_reach_the_active_provider() {
        let h = harness().await;

        let list = ok(&h, Method::GET, "/api/torrents?page=2&limit=5", None).await;
        assert_eq!(list[0]["id"], "t1");
        ok(&h, Method::GET, "/api/torrents", None).await;
        assert_eq!(ok(&h, Method::GET, "/api/torrents/t1", None).await["id"], "t1");

        let added = ok(&h, Method::POST, "/api/torrents/magnet", Some(json!({ "magnet": "magnet:?xt=urn:btih:abc" }))).await;
        assert_eq!(added["id"], "new");
        assert_eq!(ok(&h, Method::POST, "/api/torrents/file", Some(json!({ "fileBytes": [1, 2, 3, 4] }))).await["id"], "file");

        ok(&h, Method::POST, "/api/torrents/t9/select", Some(json!({ "fileIds": "3, 1,bad" }))).await;
        assert_eq!(h.fake.selected.lock().unwrap().clone(), Some(("t9".to_string(), vec![3, 1])));

        let links = ok(&h, Method::POST, "/api/torrents/t9/links", Some(json!({ "fileIds": [4, 5] }))).await;
        assert_eq!(links.as_array().unwrap().iter().map(|l| l["filename"].clone()).collect::<Vec<_>>(), [json!("f4"), json!("f5")]);
        ok(&h, Method::POST, "/api/torrents/t9/links", Some(json!({}))).await;

        ok(&h, Method::DELETE, "/api/torrents/t9", None).await;
        ok(&h, Method::GET, "/api/downloads/history?limit=7", None).await;
        assert_eq!(ok(&h, Method::POST, "/api/cache/check", Some(json!({ "hashes": ["c1", "x2"] }))).await, json!(["c1"]));

        assert_eq!(
            h.fake.calls(),
            vec![
                "list:2:5",
                "list:1:100",
                "magnet:magnet:?xt=urn:btih:abc",
                "file:4",
                "link:t9:4",
                "link:t9:5",
                "links:t9",
                "delete:t9",
                "history:1:7",
            ]
        );

        // A provider error is a JSON error body.
        let (status, _, json) = call(&h.router, Method::GET, "/api/torrents/zz", None, Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json["error"], "no info for zz");
    }

    /// Requests the server can't read are 4xx (not 500), with a JSON error body.
    #[tokio::test]
    async fn unreadable_requests_are_client_errors_with_json_bodies() {
        let h = harness().await;
        let bad: Vec<(Method, &str, Option<serde_json::Value>, StatusCode)> = vec![
            // Wrong field type.
            (Method::POST, "/api/downloads", Some(json!({ "links": "nope", "destinationFolder": "/x" })), StatusCode::UNPROCESSABLE_ENTITY),
            // Missing field.
            (Method::POST, "/api/torrents/magnet", Some(json!({})), StatusCode::UNPROCESSABLE_ENTITY),
            (Method::PUT, "/api/settings", Some(json!({ "settings": 5 })), StatusCode::UNPROCESSABLE_ENTITY),
            // No JSON body at all.
            (Method::POST, "/api/auth/token", None, StatusCode::UNSUPPORTED_MEDIA_TYPE),
            // Bad query string.
            (Method::GET, "/api/torrents?page=abc", None, StatusCode::BAD_REQUEST),
            (Method::GET, "/api/search", None, StatusCode::BAD_REQUEST),
        ];
        for (method, path, body, want) in bad {
            let (status, _, json) = call(&h.router, method.clone(), path, body, Auth::Bearer(TOKEN)).await;
            assert_eq!(status, want, "{} {}: {}", method, path, json);
            assert!(!json["error"].as_str().unwrap_or_default().is_empty(), "{} {}: {}", method, path, json);
        }

        // Malformed JSON.
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/watch/rules")
            .header(header::AUTHORIZATION, format!("Bearer {}", TOKEN))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{not json"))
            .unwrap();
        let resp = h.router.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(json["error"].is_string());

        // `/login` reads its body the same way.
        let (status, _, json) = call(&h.router, Method::POST, "/login", Some(json!({})), Auth::None).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(json["error"].is_string());
    }

    #[tokio::test]
    async fn auth_routes_save_the_token_and_switch_provider() {
        let h = harness().await;
        h.secrets.delete("torbox.api_token").unwrap();

        let (status, _, json) = call(&h.router, Method::POST, "/api/auth/token", Some(json!({ "token": "bad" })), Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(json["error"].as_str().unwrap().contains("Bad token"), "{}", json);
        assert_eq!(h.secrets.get("torbox.api_token").unwrap(), None);

        ok(&h, Method::POST, "/api/auth/token", Some(json!({ "token": GOOD }))).await;
        assert_eq!(h.secrets.get("torbox.api_token").unwrap().as_deref(), Some(GOOD));
        assert_eq!(ok(&h, Method::GET, "/api/auth/user", None).await["username"], "u");
        assert_eq!(ok(&h, Method::POST, "/api/auth/load-saved-token", None).await, json!(true));
        assert_eq!(ok(&h, Method::GET, "/api/auth/method", None).await, serde_json::to_value(AuthMethod::ApiKey).unwrap());

        ok(&h, Method::POST, "/api/auth/logout", None).await;
        assert_eq!(h.secrets.get("torbox.api_token").unwrap(), None);

        assert_eq!(ok(&h, Method::POST, "/api/auth/provider", Some(json!({ "providerId": "premiumize" }))).await, json!(false));
        assert_eq!(ok(&h, Method::GET, "/api/auth/status", None).await["provider"], "premiumize");
        assert_eq!(h.persistence.get(SETTINGS_KEY).unwrap().unwrap()["provider"], "premiumize");
        let (status, _, json) = call(&h.router, Method::POST, "/api/auth/provider", Some(json!({ "providerId": "nope" })), Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json["error"], "Unknown provider: nope");
    }

    #[tokio::test]
    async fn settings_backup_and_watchlist_routes_persist() {
        let h = harness().await;

        let mut settings = AppSettings::default();
        settings.max_concurrent_downloads = 7;
        settings.plex_token = Some("secret-plex".into());
        ok(&h, Method::PUT, "/api/settings", Some(json!({ "settings": settings }))).await;
        assert_eq!(ok(&h, Method::GET, "/api/settings", None).await["max_concurrent_downloads"], 7);
        assert_eq!(h.persistence.get(SETTINGS_KEY).unwrap().unwrap()["max_concurrent_downloads"], 7);

        // Export leaves credentials out unless asked; import applies the document.
        let body = json!({ "includeCredentials": false, "frontendSettingsJson": "{\"a\":1}" });
        let doc: serde_json::Value = serde_json::from_str(ok(&h, Method::POST, "/api/settings/export", Some(body)).await.as_str().unwrap()).unwrap();
        assert!(doc["app_settings"].get("plex_token").is_none());
        assert_eq!(doc["tracker_configs"][0]["url"], h.stub.as_str());
        let body = json!({ "includeCredentials": true, "frontendSettingsJson": "" });
        let full: serde_json::Value = serde_json::from_str(ok(&h, Method::POST, "/api/settings/export", Some(body)).await.as_str().unwrap()).unwrap();
        assert_eq!(full["app_settings"]["plex_token"], "secret-plex");

        let mut doc = doc;
        doc["app_settings"]["max_concurrent_downloads"] = json!(2);
        let result = ok(&h, Method::POST, "/api/settings/import", Some(json!({ "json": doc.to_string() }))).await;
        assert_eq!(result["imported_sections"], json!(["app_settings", "tracker_configs", "frontend_settings"]));
        assert_eq!(result["frontend_settings"], "{\"a\":1}");
        assert_eq!(h.state.settings.read().await.max_concurrent_downloads, 2);
        let (status, _, json) = call(&h.router, Method::POST, "/api/settings/import", Some(json!({ "json": "nope" })), Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(json["error"].as_str().unwrap().starts_with("Invalid settings file"));

        // Watchlist: add, run against the stub tracker, read matches, clear, delete.
        ok(&h, Method::POST, "/api/watch/rules", Some(json!({ "rule": rule("r2") }))).await;
        assert_eq!(h.persistence.get(WATCH_RULES_KEY).unwrap().unwrap().as_array().unwrap().len(), 2);
        let mut events = h.events.subscribe();
        let found = ok(&h, Method::POST, "/api/watch/rules/r2/run", None).await;
        assert_eq!(found[0]["info_hash"], "abcdef0123456789abcdef0123456789abcdef01");
        let mut matches = vec![];
        while let Ok(ev) = events.try_recv() {
            if ev.name == "watchlist-match" {
                matches.push(ev.payload);
            }
        }
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["rule_id"], "r2");
        assert_eq!(ok(&h, Method::GET, "/api/watch/matches?ruleId=r2", None).await.as_array().unwrap().len(), 1);
        assert_eq!(ok(&h, Method::GET, "/api/watch/matches?ruleId=r1", None).await, json!([]));
        ok(&h, Method::DELETE, "/api/watch/matches?ruleId=r2", None).await;
        assert_eq!(ok(&h, Method::GET, "/api/watch/matches", None).await, json!([]));
        ok(&h, Method::DELETE, "/api/watch/rules/r2", None).await;
        let rules = ok(&h, Method::GET, "/api/watch/rules", None).await;
        assert_eq!(rules.as_array().unwrap().iter().map(|r| r["id"].clone()).collect::<Vec<_>>(), [json!("r1")]);

        // Trackers and search.
        assert_eq!(ok(&h, Method::GET, "/api/trackers", None).await[0]["id"], "pb");
        let found = ok(&h, Method::GET, "/api/search?query=show", None).await;
        assert_eq!(found["results"].as_array().unwrap().len(), 1);
        ok(&h, Method::PUT, "/api/trackers", Some(json!({ "configs": [] }))).await;
        assert_eq!(ok(&h, Method::GET, "/api/trackers", None).await, json!([]));
        let body = json!({ "trackerType": "piratebay_api", "url": h.stub });
        assert_eq!(ok(&h, Method::POST, "/api/trackers/test", Some(body)).await, "Connected");
    }

    #[tokio::test]
    async fn tool_routes_answer() {
        fake_rclone_on_path();
        let h = harness().await;
        let body = json!({ "serverType": "plex", "url": h.stub, "credential": "x" });
        assert_eq!(ok(&h, Method::POST, "/api/media-servers/test", Some(body)).await, "Plex Server");
        let rar = ok(&h, Method::GET, "/api/extractor/rar-tool", None).await;
        assert!(rar.is_null() || rar.is_string());
        if cfg!(unix) {
            assert_eq!(ok(&h, Method::GET, "/api/rclone", None).await["version"], "rclone v1.0.0-test");
            assert_eq!(ok(&h, Method::GET, "/api/rclone/remotes", None).await, json!(["gdrive:"]));
            for (name, known) in [("gdrive", true), ("gdrive:", true), ("other", false)] {
                let body = json!({ "remoteName": name });
                assert_eq!(ok(&h, Method::POST, "/api/rclone/remotes/validate", Some(body)).await, json!(known), "{}", name);
            }
        }
    }

    #[test]
    fn ensure_auth_token_generates_once_then_reuses() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = FileStore::with_env_prefix(dir.path().join("secrets.json"), "DD_SERVER_TOKEN_TEST_");
        let (first, generated) = ensure_auth_token(&secrets).unwrap();
        assert!(generated);
        assert_eq!(first.len(), 64);
        let (again, generated) = ensure_auth_token(&secrets).unwrap();
        assert!(!generated);
        assert_eq!(again, first);

        // An env var overrides the file.
        let var = secrets.env_var_name(AUTH_TOKEN_KEY);
        assert_eq!(var, "DD_SERVER_TOKEN_TEST_SERVER_AUTH_TOKEN");
        std::env::set_var(&var, "from-env");
        let from_env = ensure_auth_token(&secrets).unwrap();
        std::env::remove_var(&var);
        assert_eq!(from_env, ("from-env".to_string(), false));
    }

    #[test]
    fn token_parsing_and_comparison() {
        let mut h = HeaderMap::new();
        assert_eq!(request_token(&h), None);
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("bearer  abc "));
        assert_eq!(request_token(&h).as_deref(), Some("abc"));
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic abc"));
        h.insert(header::COOKIE, HeaderValue::from_static("a=1; dd_token=x%3By"));
        assert_eq!(request_token(&h).as_deref(), Some("x;y"));
        assert!(token_matches("abc", "abc"));
        assert!(!token_matches("abd", "abc"));
        assert!(!token_matches("ab", "abc"));
        assert!(!token_matches("", ""));
    }

    /// The server and headless host must build without Tauri.
    #[test]
    fn server_and_headless_are_tauri_free() {
        for src in [include_str!("server.rs"), include_str!("headless.rs"), include_str!("bin/headless.rs")] {
            assert!(!src.contains(&["tauri", "::"].concat()) && !src.contains(&["use ", "tauri"].concat()));
        }
    }
}
