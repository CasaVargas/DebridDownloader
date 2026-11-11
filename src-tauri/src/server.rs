//! HTTP API of the headless server (axum).
//!
//! Every route except `GET /health` and `POST /login` needs the server token, sent either as
//! `Authorization: Bearer <token>` or as the `dd_token` cookie that `/login` sets for a browser.
//! The token lives in the [`SecretStore`] under [`AUTH_TOKEN_KEY`]. Routes call the same
//! `crate::service` functions as the Tauri commands; request bodies use the commands' argument
//! names (camelCase, as `invoke()` sends them).

use crate::events::AppEvents;
use crate::persistence::Persistence;
use crate::providers::types::DownloadLink;
use crate::secrets::{SecretStore, Secrets};
use crate::service;
use crate::state::AppState;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

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
    // Settings, watchlist and auth routes need these; they arrive with the remaining commands (#65).
    #[allow(dead_code)]
    pub(crate) persistence: Persistence,
    #[allow(dead_code)]
    pub(crate) secrets: Secrets,
    pub(crate) events: Arc<dyn AppEvents>,
    token: Arc<str>,
}

impl ServerState {
    pub(crate) fn new(
        state: Arc<AppState>,
        persistence: Persistence,
        secrets: Secrets,
        events: Arc<dyn AppEvents>,
        token: String,
    ) -> Self {
        Self { state, persistence, secrets, events, token: token.into() }
    }
}

pub fn router(s: ServerState) -> Router {
    let api = Router::new()
        .route("/api/downloads", get(list_downloads))
        .route("/api/downloads", post(add_downloads))
        .route("/api/settings", get(get_settings))
        .route("/api/auth/status", get(auth_status))
        .route("/api/providers", get(list_providers))
        .route_layer(middleware::from_fn_with_state(s.clone(), require_token));
    Router::new()
        .route("/health", get(health))
        .route("/login", post(login))
        .merge(api)
        .with_state(s)
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
async fn login(State(s): State<ServerState>, Json(body): Json<LoginRequest>) -> Response {
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

// ── Routes ──────────────────────────────────────────────────────────

/// A service error as a JSON body.
struct ApiError(String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": self.0 }))).into_response()
    }
}

impl From<String> for ApiError {
    fn from(e: String) -> Self {
        Self(e)
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

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
async fn add_downloads(State(s): State<ServerState>, Json(body): Json<StartDownloadsRequest>) -> ApiResult<Vec<String>> {
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

async fn get_settings(State(s): State<ServerState>) -> ApiResult<crate::state::AppSettings> {
    Ok(Json(service::settings::get_settings(&s.state).await))
}

async fn auth_status(State(s): State<ServerState>) -> ApiResult<serde_json::Value> {
    Ok(Json(json!({
        "authenticated": service::auth::is_authenticated(&s.state).await,
        "provider": service::auth::get_active_provider(&s.state).await,
    })))
}

async fn list_providers() -> ApiResult<Vec<crate::providers::types::ProviderInfo>> {
    Ok(Json(service::auth::get_available_providers()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::mock_server::{pattern, MockOpts, MockServer};
    use crate::engine::{self, JobState, LinkSource};
    use crate::persistence::JsonFileStore;
    use crate::secrets::FileStore;
    use axum::body::Body;
    use axum::http::{Method, Request};
    use std::time::Duration;
    use tower::ServiceExt;

    const TOKEN: &str = "test-token-0123456789";

    struct Harness {
        router: Router,
        state: Arc<AppState>,
        dir: tempfile::TempDir,
    }

    /// A server over a fresh data dir with a running engine (no Tauri anywhere).
    fn harness() -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(AppState::new());
        let events: Arc<dyn AppEvents> = Arc::new(crate::events::RecordingEvents::default());
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
        let router = router(ServerState::new(state.clone(), persistence, secrets, events, TOKEN.into()));
        Harness { router, state, dir }
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

    /// Every protected route, with a request that succeeds once authorized.
    fn protected_routes(h: &Harness) -> Vec<(Method, &'static str, Option<serde_json::Value>)> {
        let out = h.dir.path().join("out").to_string_lossy().to_string();
        vec![
            (Method::GET, "/api/downloads", None),
            (Method::POST, "/api/downloads", Some(json!({ "links": [], "destinationFolder": out }))),
            (Method::GET, "/api/settings", None),
            (Method::GET, "/api/auth/status", None),
            (Method::GET, "/api/providers", None),
        ]
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
        let h = harness();
        let mut tested: Vec<(String, String)> = protected_routes(&h)
            .into_iter()
            .map(|(m, p, _)| (m.to_string(), p.to_string()))
            .chain([("GET".into(), "/health".into()), ("POST".into(), "/login".into())])
            .collect();
        let mut registered = registered_routes();
        tested.sort();
        registered.sort();
        assert_eq!(tested, registered);
    }

    #[tokio::test]
    async fn every_route_but_health_and_login_needs_the_token() {
        let h = harness();
        for (method, path, body) in protected_routes(&h) {
            for bad in [Auth::None, Auth::Bearer("wrong"), Auth::Bearer(""), Auth::Cookie("wrong")] {
                let (status, headers, json) = call(&h.router, method.clone(), path, body.clone(), bad).await;
                assert_eq!(status, StatusCode::UNAUTHORIZED, "{} {}", method, path);
                assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
                assert_eq!(json["error"], "Unauthorized");
            }
            // A token that's only a prefix of the real one is still wrong.
            let (status, _, _) = call(&h.router, method.clone(), path, body.clone(), Auth::Bearer(&TOKEN[..10])).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{} {}", method, path);

            let (status, _, json) = call(&h.router, method.clone(), path, body.clone(), Auth::Bearer(TOKEN)).await;
            assert_eq!(status, StatusCode::OK, "{} {}: {}", method, path, json);
            let (status, _, _) = call(&h.router, method.clone(), path, body.clone(), Auth::Cookie(TOKEN)).await;
            assert_eq!(status, StatusCode::OK, "{} {} via cookie", method, path);
        }
    }

    #[tokio::test]
    async fn health_and_login_are_open() {
        let h = harness();
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
        let h = harness();
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
        let h = harness();
        h.state.settings.write().await.symlink_mode = true;
        let body = json!({ "links": [{ "filename": "a", "filesize": 1, "download": "http://x", "streamable": null,
            "source": serde_json::to_value(LinkSource::Direct).unwrap() }], "destinationFolder": "/x" });
        let (status, _, json) = call(&h.router, Method::POST, "/api/downloads", Some(body), Auth::Bearer(TOKEN)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(json["error"].as_str().unwrap().contains("mount path"));
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
