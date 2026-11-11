//! The command bodies run against an `AppState` built without Tauri: a JSON-file store, a file
//! secret store, a fake provider, a real engine, and local HTTP servers for the network.

use super::{auth, downloads, search, settings, torrents, watchlist as watch};
use crate::engine::{self, EngineEvent, EventSink, JobState, LinkRefresher, LinkSource, RefreshError, RefreshedLink};
use crate::events::RecordingEvents;
use crate::persistence::{JsonFileStore, Persistence, SETTINGS_KEY, WATCH_MATCHES_KEY, WATCH_RULES_KEY, WATCH_SEEN_KEY};
use crate::providers::real_debrid::client::RdClient;
use crate::providers::types::*;
use crate::providers::DebridProvider;
use crate::scrapers::TrackerConfig;
use crate::secrets::{FileStore, SecretStore};
use crate::state::{AppSettings, AppState};
use crate::watchlist::{MatchStatus, RuleType, WatchAction, WatchMatch, WatchRule};
use serde_json::json;
use std::any::Any;
use std::sync::{Arc, Mutex};
use std::time::Duration;

// ── Harness ─────────────────────────────────────────────────────────

struct Env {
    state: AppState,
    persistence: Persistence,
    secrets: FileStore,
    dir: tempfile::TempDir,
}

fn env() -> Env {
    let dir = tempfile::tempdir().unwrap();
    let persistence = Persistence(Arc::new(JsonFileStore::in_dir(dir.path())));
    // A prefix no real environment sets, so only the file backs the store.
    let secrets = FileStore::with_env_prefix(dir.path().join("secrets.json"), "DD_SERVICE_TEST_NO_ENV_");
    Env { state: AppState::new(), persistence, secrets, dir }
}

impl Env {
    async fn with_provider(self, id: &str, provider: Arc<FakeProvider>) -> Self {
        *self.state.provider.write().await = provider;
        *self.state.provider_id.write().await = id.to_string();
        self
    }

    fn stored(&self, key: &str) -> Option<serde_json::Value> {
        self.persistence.get(key).unwrap()
    }
}

/// Records what the command bodies asked of it; `good_token` is the only token it accepts.
#[derive(Default)]
struct FakeProvider {
    calls: Mutex<Vec<String>>,
    good_token: String,
    selected: Mutex<Option<(String, Vec<u64>)>>,
}

impl FakeProvider {
    fn new(good_token: &str) -> Arc<Self> {
        Arc::new(Self { good_token: good_token.into(), ..Default::default() })
    }
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
            ProviderAuth::Token(t) if *t == self.good_token => {
                self.log(format!("authenticate:{}", t));
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
        Err(ProviderError::Other(format!("no info for {}", id)))
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

/// Serve `router` on a random local port; returns its base URL.
async fn serve(router: axum::Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    format!("http://{}", addr)
}

// ── Settings ────────────────────────────────────────────────────────

#[tokio::test]
async fn update_settings_persists_blob_and_updates_state() {
    let env = env();
    assert_eq!(settings::get_settings(&env.state).await.max_concurrent_downloads, 3);

    let mut s = AppSettings::default();
    s.download_folder = Some("/downloads".into());
    s.max_concurrent_downloads = 5;
    settings::update_settings(&env.state, &env.persistence, s).await.unwrap();

    let current = settings::get_settings(&env.state).await;
    assert_eq!(current.download_folder.as_deref(), Some("/downloads"));
    assert_eq!(current.max_concurrent_downloads, 5);
    let stored: AppSettings = serde_json::from_value(env.stored(SETTINGS_KEY).unwrap()).unwrap();
    assert_eq!(stored.max_concurrent_downloads, 5);
    // The file the headless host would reuse holds it too.
    let on_disk: serde_json::Value =
        serde_json::from_slice(&std::fs::read(env.dir.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(on_disk[SETTINGS_KEY]["download_folder"], "/downloads");
}

#[tokio::test]
async fn update_settings_does_not_apply_when_persisting_fails() {
    let env = env();
    std::fs::write(env.dir.path().join("settings.json"), "not json").unwrap();
    let mut s = AppSettings::default();
    s.theme = "light".into();
    assert!(settings::update_settings(&env.state, &env.persistence, s).await.is_err());
    assert_eq!(settings::get_settings(&env.state).await.theme, "dark");
}

// ── Auth ────────────────────────────────────────────────────────────

#[tokio::test]
async fn set_api_token_saves_only_a_validated_token_under_the_provider_key() {
    let env = env().with_provider("torbox", FakeProvider::new("good")).await;

    let err = auth::set_api_token(&env.state, &env.secrets, "bad".into()).await.unwrap_err();
    assert_eq!(err, "Bad token");
    assert_eq!(env.secrets.get("torbox.api_token").unwrap(), None);
    assert!(!auth::load_saved_token(&env.state, &env.secrets).await.unwrap());
    assert_eq!(auth::get_user(&env.state, &env.secrets).await.unwrap_err(), "No saved token");

    auth::set_api_token(&env.state, &env.secrets, "good".into()).await.unwrap();
    assert_eq!(env.secrets.get("torbox.api_token").unwrap().as_deref(), Some("good"));
    assert!(auth::load_saved_token(&env.state, &env.secrets).await.unwrap());
    assert_eq!(auth::get_user(&env.state, &env.secrets).await.unwrap().username, "u");
    assert!(auth::is_authenticated(&env.state).await);
    assert_eq!(auth::get_auth_method(&env.state).await, AuthMethod::ApiKey);
}

#[tokio::test]
async fn logout_clears_every_credential_and_resets_the_provider() {
    let env = env().with_provider("real-debrid", FakeProvider::new("good")).await;
    for key in ["api_token", "refresh_token", "oauth_client_id", "oauth_client_secret"] {
        env.secrets.set(&format!("real-debrid.{}", key), "v").unwrap();
    }
    env.secrets.set("torbox.api_token", "keep").unwrap();

    auth::logout(&env.state, &env.secrets).await.unwrap();

    for key in ["api_token", "refresh_token", "oauth_client_id", "oauth_client_secret"] {
        assert_eq!(env.secrets.get(&format!("real-debrid.{}", key)).unwrap(), None, "{}", key);
    }
    assert_eq!(env.secrets.get("torbox.api_token").unwrap().as_deref(), Some("keep"));
    assert!(env.state.get_provider().await.as_any().is::<RdClient>());
}

#[tokio::test]
async fn switch_provider_persists_the_choice() {
    let env = env();
    assert_eq!(auth::get_active_provider(&env.state).await, "real-debrid");

    // No saved token, so nothing is authenticated (and no network is touched).
    assert!(!auth::switch_provider(&env.state, &env.persistence, &env.secrets, "premiumize").await.unwrap());
    assert_eq!(auth::get_active_provider(&env.state).await, "premiumize");
    assert_eq!(env.state.get_provider().await.info().id, "premiumize");
    assert_eq!(settings::get_settings(&env.state).await.provider, "premiumize");
    assert_eq!(env.stored(SETTINGS_KEY).unwrap()["provider"], "premiumize");

    assert!(auth::switch_provider(&env.state, &env.persistence, &env.secrets, "nope").await.is_err());
    assert_eq!(auth::get_active_provider(&env.state).await, "premiumize");
    assert_eq!(auth::get_available_providers().len(), 4);
}

#[tokio::test]
async fn oauth_needs_real_debrid() {
    let env = env().with_provider("torbox", FakeProvider::new("good")).await;
    assert_eq!(auth::oauth_start(&env.state).await.unwrap_err(), "OAuth is only supported for Real-Debrid");
    assert!(auth::oauth_poll_credentials(&env.state, &env.secrets, "code").await.is_err());
    assert!(auth::oauth_get_token(&env.state, &env.secrets, "id", "secret", "code").await.is_err());
}

// ── Torrents ────────────────────────────────────────────────────────

#[tokio::test]
async fn torrent_commands_go_to_the_active_provider() {
    let fake = FakeProvider::new("good");
    let env = env().with_provider("torbox", fake.clone()).await;

    assert_eq!(torrents::list_torrents(&env.state, None, None).await.unwrap()[0].id, "t1");
    torrents::list_torrents(&env.state, Some(2), Some(50)).await.unwrap();
    assert_eq!(torrents::add_magnet(&env.state, "magnet:?xt=urn:btih:abc").await.unwrap().id, "new");
    assert_eq!(torrents::add_torrent_file(&env.state, &[1, 2, 3]).await.unwrap().id, "file");
    torrents::delete_torrent(&env.state, "t1").await.unwrap();
    assert_eq!(torrents::get_torrent_info(&env.state, "zz").await.unwrap_err(), "no info for zz");

    torrents::select_torrent_files(&env.state, "t1", "3, 1,bad").await.unwrap();
    assert_eq!(fake.selected.lock().unwrap().clone(), Some(("t1".to_string(), vec![3, 1])));
    torrents::select_torrent_files(&env.state, "t2", "all").await.unwrap();
    assert_eq!(fake.selected.lock().unwrap().clone(), Some(("t2".to_string(), vec![])));

    assert_eq!(
        fake.calls(),
        vec!["list:1:100", "list:2:50", "magnet:magnet:?xt=urn:btih:abc", "file:3", "delete:t1"]
    );
}

#[tokio::test]
async fn links_history_and_cache_go_to_the_active_provider() {
    let fake = FakeProvider::new("good");
    let env = env().with_provider("torbox", fake.clone()).await;

    downloads::unrestrict_torrent_links(&env.state, "t1", None).await.unwrap();
    let links = downloads::unrestrict_torrent_links(&env.state, "t1", Some(vec![4, 5])).await.unwrap();
    assert_eq!(links.iter().map(|l| l.filename.as_str()).collect::<Vec<_>>(), ["f4", "f5"]);
    downloads::get_download_history(&env.state, None, Some(10)).await.unwrap();
    assert_eq!(fake.calls(), vec!["links:t1", "link:t1:4", "link:t1:5", "history:1:10"]);

    let cached = search::check_cache_availability(&env.state, &["c1".into(), "x2".into()]).await.unwrap();
    assert_eq!(cached, vec!["c1".to_string()]);
}

// ── Downloads ───────────────────────────────────────────────────────

struct NoSink;
impl EventSink for NoSink {
    fn emit(&self, _event: EngineEvent) {}
}

struct NoRefresh;
#[async_trait::async_trait]
impl LinkRefresher for NoRefresh {
    async fn refresh(&self, _source: &LinkSource) -> Result<RefreshedLink, RefreshError> {
        Err(RefreshError::NotRefreshable)
    }
}

fn start_engine(env: &Env) {
    let engine = engine::Engine::start(engine::EngineDeps::new(
        env.dir.path().join("engine"),
        AppSettings::default().engine_config(env.state.rar_tool),
        Arc::new(NoSink),
        Arc::new(NoRefresh),
        Arc::new(engine::NoRemote),
    ));
    assert!(env.state.engine.set(engine).is_ok());
}

#[tokio::test]
async fn download_commands_need_a_running_engine() {
    let env = env();
    assert_eq!(downloads::get_download_tasks(&env.state).await.unwrap_err(), "Download engine is not running");
    assert!(downloads::pause_all_downloads(&env.state).await.is_err());
    let start = downloads::start_downloads(&env.state, Arc::new(RecordingEvents::default()), vec![], "/tmp".into(), None);
    assert!(start.await.is_err());
}

#[tokio::test]
async fn start_downloads_queues_jobs_that_download_into_the_torrent_folder() {
    let body: Vec<u8> = (0..50_000u32).map(|i| (i % 251) as u8).collect();
    let served = body.clone();
    let base = serve(axum::Router::new().route("/f", axum::routing::get(move || async move { served.clone() }))).await;

    let env = env();
    start_engine(&env);
    let out = env.dir.path().join("out");
    let link = DownloadLink {
        filename: "ep:1.mkv".into(),
        filesize: body.len() as i64,
        download: format!("{}/f", base),
        streamable: None,
        source: LinkSource::Direct,
    };

    let ids = downloads::start_downloads(
        &env.state,
        Arc::new(RecordingEvents::default()),
        vec![link],
        out.to_string_lossy().to_string(),
        Some("My Show".into()),
    )
    .await
    .unwrap();
    assert_eq!(ids.len(), 1);

    let mut done = None;
    for _ in 0..200 {
        let jobs = downloads::get_download_tasks(&env.state).await.unwrap();
        if let Some(job) = jobs.iter().find(|j| j.id == ids[0] && j.status == JobState::Completed) {
            done = Some(job.clone());
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let job = done.expect("download did not complete");
    assert_eq!(job.batch_name, "My Show");
    let dest = out.join("My Show").join("ep_1.mkv");
    assert_eq!(job.destination, dest.to_string_lossy());
    assert_eq!(std::fs::read(&dest).unwrap(), body);

    downloads::clear_completed_downloads(&env.state).await.unwrap();
    for _ in 0..100 {
        if downloads::get_download_tasks(&env.state).await.unwrap().is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("completed job was not cleared");
}

#[tokio::test]
async fn symlink_mode_without_a_mount_path_is_an_error() {
    let env = env();
    start_engine(&env);
    env.state.settings.write().await.symlink_mode = true;
    let link = DownloadLink {
        filename: "a.mkv".into(),
        filesize: 1,
        download: "http://x".into(),
        streamable: None,
        source: LinkSource::Direct,
    };
    let err = downloads::start_downloads(&env.state, Arc::new(RecordingEvents::default()), vec![link], "/x".into(), None)
        .await
        .unwrap_err();
    assert_eq!(err, "Symlink mode is on but no mount path configured");
}

/// Symlink mode triggers media-server scans; their toasts go through the event seam.
#[cfg(unix)]
#[tokio::test]
async fn symlink_downloads_emit_scan_toasts_through_the_event_seam() {
    let plex = serve(axum::Router::new().route(
        "/library/sections/all/refresh",
        axum::routing::get(|| async { "ok" }),
    ))
    .await;
    let jellyfin = serve(axum::Router::new().route(
        "/Library/Refresh",
        axum::routing::post(|| async { axum::http::StatusCode::INTERNAL_SERVER_ERROR }),
    ))
    .await;

    let env = env();
    start_engine(&env);
    let mount = env.dir.path().join("mount");
    let library = env.dir.path().join("library");
    std::fs::create_dir_all(mount.join("Pack")).unwrap();
    std::fs::write(mount.join("Pack").join("a.mkv"), b"x").unwrap();
    {
        let mut s = env.state.settings.write().await;
        s.symlink_mode = true;
        s.symlink_mount_path = Some(mount.to_string_lossy().to_string());
        s.symlink_library_path = Some(library.to_string_lossy().to_string());
        s.plex_url = Some(plex);
        s.plex_token = Some("tok".into());
        s.jellyfin_url = Some(jellyfin);
        s.jellyfin_api_key = Some("key".into());
    }
    let link = DownloadLink {
        filename: "a.mkv".into(),
        filesize: 1,
        download: "http://x".into(),
        streamable: None,
        source: LinkSource::Direct,
    };
    let events = Arc::new(RecordingEvents::default());
    let ids = downloads::start_downloads(&env.state, events.clone(), vec![link], String::new(), Some("Pack".into()))
        .await
        .unwrap();
    assert_eq!(ids.len(), 1);
    let linked = library.join("Pack").join("a.mkv");
    assert_eq!(std::fs::read_link(&linked).unwrap(), mount.join("Pack").join("a.mkv"));

    for _ in 0..200 {
        if !events.named("toast").is_empty() && !events.named("toast-error").is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(events.named("toast"), vec![json!("Plex library scan triggered")]);
    assert_eq!(events.named("toast-error"), vec![json!("Jellyfin scan failed: HTTP 500 Internal Server Error")]);
}

// ── Search ──────────────────────────────────────────────────────────

fn tracker(url: &str) -> TrackerConfig {
    serde_json::from_value(json!({
        "id": "pb", "name": "PB", "url": url, "tracker_type": "piratebay_api", "enabled": true
    }))
    .unwrap()
}

/// A Pirate Bay-style API that returns one result for every query.
async fn tracker_server() -> String {
    serve(axum::Router::new().route(
        "/q.php",
        axum::routing::get(|| async {
            axum::Json(json!([{
                "name": "Show S01E03 1080p",
                "info_hash": "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
                "seeders": "10", "leechers": "1", "size": "1000", "added": "0", "category": "205"
            }]))
        }),
    ))
    .await
}

#[tokio::test]
async fn tracker_configs_round_trip_and_feed_search() {
    let env = env();
    assert!(search::get_tracker_configs(&env.persistence).is_empty());
    let params = || crate::scrapers::SearchParams { query: "show".into(), category: None, sort_by: None, page: None };
    let empty = search::search_torrents(&env.state, &env.persistence, params()).await;
    assert!(empty.results.is_empty());
    assert_eq!(empty.tracker_status[0].name, "No trackers");

    let base = tracker_server().await;
    search::save_tracker_configs(&env.persistence, &[tracker(&base)]).unwrap();
    assert_eq!(search::get_tracker_configs(&env.persistence)[0].url, base);

    let found = search::search_torrents(&env.state, &env.persistence, params()).await;
    assert_eq!(found.results.len(), 1);
    assert_eq!(found.results[0].info_hash, "abcdef0123456789abcdef0123456789abcdef01");
}

#[tokio::test]
async fn test_tracker_reports_connected_and_unknown_types() {
    let base = tracker_server().await;
    assert_eq!(search::test_tracker("piratebay_api", &base, None).await.unwrap(), "Connected");
    assert_eq!(search::test_tracker("gopher", &base, None).await.unwrap_err(), "Unknown tracker type: gopher");
}

// ── Watchlist ───────────────────────────────────────────────────────

fn rule(id: &str, regex: Option<&str>) -> WatchRule {
    WatchRule {
        id: id.into(),
        name: id.into(),
        rule_type: RuleType::TvShow { last_season: None, last_episode: None },
        query: "show".into(),
        category: None,
        regex_filter: regex.map(str::to_string),
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

fn a_match(rule_id: &str, hash: &str) -> WatchMatch {
    WatchMatch {
        rule_id: rule_id.into(),
        info_hash: hash.into(),
        magnet: String::new(),
        title: String::new(),
        size_bytes: 0,
        matched_at: String::new(),
        action_taken: WatchAction::Notify,
        status: MatchStatus::Notified,
        season: None,
        episode: None,
    }
}

#[tokio::test]
async fn watch_rules_are_validated_and_persisted() {
    let env = env();
    let err = watch::add_watch_rule(&env.state, &env.persistence, rule("bad", Some("("))).await.unwrap_err();
    assert!(err.starts_with("Invalid regex"), "{}", err);
    assert!(watch::get_watch_rules(&env.state).await.is_empty());
    assert_eq!(env.stored(WATCH_RULES_KEY), None);

    watch::add_watch_rule(&env.state, &env.persistence, rule("r1", Some(""))).await.unwrap();
    let mut changed = rule("r1", None);
    changed.query = "other".into();
    watch::update_watch_rule(&env.state, &env.persistence, changed).await.unwrap();
    assert_eq!(watch::get_watch_rules(&env.state).await[0].query, "other");
    assert_eq!(env.stored(WATCH_RULES_KEY).unwrap()[0]["query"], "other");

    assert_eq!(
        watch::update_watch_rule(&env.state, &env.persistence, rule("missing", None)).await.unwrap_err(),
        "Rule not found"
    );
    assert!(watch::update_watch_rule(&env.state, &env.persistence, rule("r1", Some("[")))
        .await
        .unwrap_err()
        .starts_with("Invalid regex"));
}

#[tokio::test]
async fn deleting_a_rule_drops_its_matches_and_seen_hashes() {
    let env = env();
    watch::add_watch_rule(&env.state, &env.persistence, rule("r1", None)).await.unwrap();
    watch::add_watch_rule(&env.state, &env.persistence, rule("r2", None)).await.unwrap();
    *env.state.watch_matches.write().await = vec![a_match("r1", "a"), a_match("r2", "b"), a_match("r2", "c")];
    env.state.watch_seen.write().await.insert("r1".into(), ["a".to_string()].into());

    assert_eq!(watch::get_watch_matches(&env.state, Some("r2")).await.len(), 2);
    assert_eq!(watch::get_watch_matches(&env.state, None).await.len(), 3);

    watch::delete_watch_rule(&env.state, &env.persistence, "r1").await.unwrap();
    assert_eq!(watch::get_watch_rules(&env.state).await.len(), 1);
    assert_eq!(watch::get_watch_matches(&env.state, None).await.len(), 2);
    assert!(env.state.watch_seen.read().await.get("r1").is_none());
    assert_eq!(env.stored(WATCH_RULES_KEY).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(env.stored(WATCH_MATCHES_KEY).unwrap().as_array().unwrap().len(), 2);
    assert_eq!(env.stored(WATCH_SEEN_KEY).unwrap(), json!({}));

    watch::clear_watch_matches(&env.state, &env.persistence, Some("r2")).await.unwrap();
    assert!(watch::get_watch_matches(&env.state, None).await.is_empty());
    assert_eq!(env.stored(WATCH_MATCHES_KEY).unwrap(), json!([]));
}

#[tokio::test]
async fn run_watch_rule_now_needs_the_rule_and_trackers() {
    let env = env();
    let events = RecordingEvents::default();
    assert_eq!(
        watch::run_watch_rule_now(&env.state, &env.persistence, &events, "nope").await.unwrap_err(),
        "Rule not found"
    );
    watch::add_watch_rule(&env.state, &env.persistence, rule("r1", None)).await.unwrap();
    assert_eq!(
        watch::run_watch_rule_now(&env.state, &env.persistence, &events, "r1").await.unwrap_err(),
        "No trackers configured"
    );
    let cancel = tokio_util::sync::CancellationToken::new();
    assert!(!crate::watchlist::run_due_rules(&env.state, &env.persistence, &events, &cancel).await);
}

#[tokio::test]
async fn run_watch_rule_now_records_matches_and_emits_them() {
    let env = env();
    search::save_tracker_configs(&env.persistence, &[tracker(&tracker_server().await)]).unwrap();
    watch::add_watch_rule(&env.state, &env.persistence, rule("r1", None)).await.unwrap();
    let events = RecordingEvents::default();

    let found = watch::run_watch_rule_now(&env.state, &env.persistence, &events, "r1").await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!((found[0].season, found[0].episode), (Some(1), Some(3)));
    let emitted = events.named("watchlist-match");
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0]["info_hash"], "abcdef0123456789abcdef0123456789abcdef01");

    let rules = watch::get_watch_rules(&env.state).await;
    assert_eq!(rules[0].rule_type, RuleType::TvShow { last_season: Some(1), last_episode: Some(3) });
    assert!(rules[0].last_checked.is_some());
    assert_eq!(env.stored(WATCH_MATCHES_KEY).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(env.stored(WATCH_SEEN_KEY).unwrap()["r1"], json!(["abcdef0123456789abcdef0123456789abcdef01"]));

    // Already seen: a second run finds nothing new and emits nothing.
    assert!(watch::run_watch_rule_now(&env.state, &env.persistence, &events, "r1").await.unwrap().is_empty());
    assert_eq!(events.named("watchlist-match").len(), 1);
}

#[tokio::test]
async fn watch_loop_tick_runs_due_rules_without_tauri() {
    let env = env();
    search::save_tracker_configs(&env.persistence, &[tracker(&tracker_server().await)]).unwrap();
    watch::add_watch_rule(&env.state, &env.persistence, rule("due", None)).await.unwrap();
    let mut off = rule("off", None);
    off.enabled = false;
    watch::add_watch_rule(&env.state, &env.persistence, off).await.unwrap();
    let events = RecordingEvents::default();
    let cancel = tokio_util::sync::CancellationToken::new();

    assert!(crate::watchlist::run_due_rules(&env.state, &env.persistence, &events, &cancel).await);
    let emitted = events.named("watchlist-match");
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0]["rule_id"], "due");
    let rules = watch::get_watch_rules(&env.state).await;
    assert!(rules.iter().find(|r| r.id == "due").unwrap().last_checked.is_some());
    assert!(rules.iter().find(|r| r.id == "off").unwrap().last_checked.is_none());
}

// ── Shape ───────────────────────────────────────────────────────────

/// The command bodies must stay callable without a Tauri runtime.
#[test]
fn service_and_event_seam_are_tauri_free() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files: Vec<_> = std::fs::read_dir(src.join("service"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().is_some_and(|n| n != "tests.rs"))
        .collect();
    files.push(src.join("events.rs"));
    for path in files {
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("tauri::") && !text.contains("use tauri"), "{} uses tauri", path.display());
    }
}

/// Every Tauri command in the moved domains is a thin wrapper over its `service` function.
#[test]
fn moved_commands_delegate_to_the_service() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
    for domain in ["auth", "backup", "downloads", "search", "settings", "torrents", "watchlist"] {
        let text = std::fs::read_to_string(dir.join(format!("{}.rs", domain))).unwrap();
        let commands: Vec<&str> = text.split("#[tauri::command]").skip(1).collect();
        assert!(!commands.is_empty(), "{}", domain);
        for cmd in commands {
            let name = cmd.split("fn ").nth(1).and_then(|s| s.split('(').next()).unwrap_or("?");
            let body = &cmd[cmd.find('{').unwrap()..];
            assert!(body.contains(&format!("svc::{}(", name)), "commands::{}::{} does not call svc::{}", domain, name, name);
            assert!(body.lines().filter(|l| !l.trim().is_empty()).count() <= 4, "commands::{}::{} is not thin", domain, name);
        }
    }
}
