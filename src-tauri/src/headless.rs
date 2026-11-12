//! Headless host: builds `AppState` and the download engine without a Tauri runtime and serves
//! [`crate::server`] over HTTP. The `debriddownloader-headless` binary (`--features headless`) is a
//! thin `main` over [`main`].
//!
//! Configuration (flags win over env vars, env vars over defaults):
//!
//! | Flag          | Env var                       | Default                                  |
//! |---------------|-------------------------------|------------------------------------------|
//! | `--bind IP`   | `DEBRIDDOWNLOADER_BIND`       | `127.0.0.1`                              |
//! | `--port N`    | `DEBRIDDOWNLOADER_PORT`       | `8777`                                   |
//! | `--data-dir P`| `DEBRIDDOWNLOADER_DATA_DIR`   | `$XDG_DATA_HOME/debriddownloader`, else `~/.local/share/debriddownloader`, else `./data` |
//! | `--web-dir P` | `DEBRIDDOWNLOADER_WEB_DIR`    | none (API only)                          |
//!
//! `--web-dir` points at the browser UI bundle (`npm run build:web`, which writes `dist-web/`). It
//! is served at `/`, with `index.html` for client routes such as `/downloads`; `/api/*` always wins.
//! The data dir holds `settings.json` (same shape as the desktop store), `secrets.json` (provider
//! tokens and the server token, `0600`) and `downloads.json`.
//!
//! App events (download progress, list changes, watchlist matches) go out over SSE on
//! `GET /api/events` through a [`BroadcastEvents`] sink.

use crate::engine::{self, EngineDeps};
use crate::engine_host::{BroadcastEvents, HostSink, ProviderRefresher, RcloneRunner};
use crate::events::AppEvents;
use crate::persistence::{
    JsonFileStore, Persistence, SETTINGS_KEY, WATCH_MATCHES_KEY, WATCH_RULES_KEY, WATCH_SEEN_KEY,
};
use crate::secrets::{FileStore, Secrets};
use crate::server::{self, ServerState};
use crate::state::{AppSettings, AppState};
use crate::watchlist::{WatchMatch, WatchRule};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const ENV_BIND: &str = "DEBRIDDOWNLOADER_BIND";
pub const ENV_PORT: &str = "DEBRIDDOWNLOADER_PORT";
pub const ENV_DATA_DIR: &str = "DEBRIDDOWNLOADER_DATA_DIR";
pub const ENV_WEB_DIR: &str = "DEBRIDDOWNLOADER_WEB_DIR";
pub const DEFAULT_BIND: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
pub const DEFAULT_PORT: u16 = 8777;

const USAGE: &str = "\
Usage: debriddownloader-headless [--bind IP] [--port N] [--data-dir PATH] [--web-dir PATH]

  --bind IP        Address to listen on (env DEBRIDDOWNLOADER_BIND, default 127.0.0.1)
  --port N         Port to listen on; 0 picks a free one (env DEBRIDDOWNLOADER_PORT, default 8777)
  --data-dir PATH  Settings, secrets and download state (env DEBRIDDOWNLOADER_DATA_DIR)
  --web-dir PATH   Browser UI bundle to serve at / (`npm run build:web` output, dist-web/;
                   env DEBRIDDOWNLOADER_WEB_DIR, default: API only)
  -h, --help       Show this help

The API token is read from secrets.json (key server.auth_token) or the env var
DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN; one is generated on first start if neither is set.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadlessConfig {
    pub addr: SocketAddr,
    pub data_dir: PathBuf,
    /// The browser UI bundle served at `/`; `None` serves the API only.
    pub web_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cli {
    Run(HeadlessConfig),
    Help,
}

/// Parse command-line `args` (without the program name) over the environment `env`.
pub fn parse_cli<I, S>(args: I, env: impl Fn(&str) -> Option<String>) -> Result<Cli, String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let env = |key: &str| env(key).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let mut bind = None;
    let mut port = None;
    let mut data_dir = None;
    let mut web_dir = None;

    let mut args = args.into_iter().map(Into::into);
    while let Some(arg) = args.next() {
        let (name, inline) = match arg.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n.to_string(), Some(v.to_string())),
            _ => (arg.clone(), None),
        };
        let slot = match name.as_str() {
            "-h" | "--help" => return Ok(Cli::Help),
            "--bind" => &mut bind,
            "--port" => &mut port,
            "--data-dir" => &mut data_dir,
            "--web-dir" => &mut web_dir,
            _ => return Err(format!("Unknown argument '{}'\n\n{}", arg, USAGE)),
        };
        let value = match inline {
            Some(v) => v,
            None => args.next().ok_or_else(|| format!("{} needs a value", name))?,
        };
        *slot = Some(value);
    }

    let bind = match bind.or_else(|| env(ENV_BIND)) {
        Some(b) => parse_bind(&b)?,
        None => DEFAULT_BIND,
    };
    let port = match port.or_else(|| env(ENV_PORT)) {
        Some(p) => p.trim().parse::<u16>().map_err(|_| format!("Invalid port '{}': expected 0-65535", p))?,
        None => DEFAULT_PORT,
    };
    let data_dir = match data_dir.or_else(|| env(ENV_DATA_DIR)) {
        Some(d) => PathBuf::from(d),
        None => default_data_dir(&env),
    };
    let web_dir = web_dir.or_else(|| env(ENV_WEB_DIR)).map(PathBuf::from);
    Ok(Cli::Run(HeadlessConfig { addr: SocketAddr::new(bind, port), data_dir, web_dir }))
}

fn parse_bind(value: &str) -> Result<IpAddr, String> {
    let v = value.trim();
    if v.eq_ignore_ascii_case("localhost") {
        return Ok(DEFAULT_BIND);
    }
    // Accept a bracketed IPv6 address too (`[::]`).
    let bare = v.strip_prefix('[').and_then(|s| s.strip_suffix(']')).unwrap_or(v);
    bare.parse::<IpAddr>().map_err(|_| format!("Invalid bind address '{}': expected an IP address", value))
}

fn default_data_dir(env: &impl Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(xdg) = env("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("debriddownloader");
    }
    if let Some(home) = env("HOME") {
        return PathBuf::from(home).join(".local/share/debriddownloader");
    }
    PathBuf::from("data")
}

// ── Bootstrap ───────────────────────────────────────────────────────

/// A running headless core: shared state, the engine and the watch loop.
pub struct Headless {
    pub(crate) server: ServerState,
}

impl Headless {
    /// Build `AppState` from `data_dir`, start the engine and the watch loop. Must run inside Tokio.
    pub async fn start(data_dir: &Path) -> Result<Headless, String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|e| format!("Failed to create data dir {}: {}", data_dir.display(), e))?;
        let persistence = Persistence(Arc::new(JsonFileStore::in_dir(data_dir)));
        let secret_file = FileStore::in_dir(data_dir);
        let secret_path = secret_file.path().to_path_buf();
        let env_var = secret_file.env_var_name(server::AUTH_TOKEN_KEY);
        let secrets = Secrets(Arc::new(secret_file));

        let state = Arc::new(AppState::new());
        load_persisted(&state, &persistence).await?;

        // Every event fans out to the `/api/events` subscribers.
        let broadcast = Arc::new(BroadcastEvents::default());
        let events: Arc<dyn AppEvents> = broadcast.clone();
        let config = state.settings.read().await.engine_config(state.rar_tool);
        let engine = engine::Engine::start(EngineDeps::new(
            data_dir.to_path_buf(),
            config,
            Arc::new(HostSink::new(state.clone(), events.clone())),
            Arc::new(ProviderRefresher::new(state.clone())),
            Arc::new(RcloneRunner::new(events.clone())),
        ));
        let _ = state.engine.set(engine);

        if let Ok(true) = crate::service::auth::load_saved_token(&state, &*secrets).await {
            log::info!("Loaded the saved {} token", state.provider_id.read().await);
        }

        let (token, generated) = server::ensure_auth_token(&*secrets)?;
        if generated {
            log::warn!(
                "Generated an API token and saved it to {} (key '{}'); set {} to choose your own",
                secret_path.display(),
                server::AUTH_TOKEN_KEY,
                env_var
            );
        }

        tokio::spawn(crate::watchlist::start_watch_loop(
            state.clone(),
            persistence.clone(),
            events.clone(),
            state.watch_cancel.clone(),
        ));

        Ok(Headless { server: ServerState::new(state, persistence, secrets, broadcast, token) })
    }

    pub fn router(&self) -> axum::Router {
        server::router(self.server.clone())
    }

    /// Stop the watch loop and checkpoint downloads so they resume on the next start.
    pub async fn shutdown(&self) {
        self.server.shutdown.cancel();
        self.server.state.watch_cancel.cancel();
        if let Some(engine) = self.server.state.engine.get().cloned() {
            engine.shutdown().await;
        }
    }
}

/// Load the persisted `AppSettings` and watchlist into `state`, as the desktop app does at launch.
/// An unreadable `settings.json` is an error, so it is never overwritten.
async fn load_persisted(state: &AppState, persistence: &Persistence) -> Result<(), String> {
    if let Some(val) = persistence.get(SETTINGS_KEY)? {
        match serde_json::from_value::<AppSettings>(val) {
            Ok(loaded) => {
                *state.provider_id.write().await = loaded.provider.clone();
                match crate::service::auth::create_provider(&loaded.provider) {
                    Ok(p) => *state.provider.write().await = p,
                    Err(e) => log::warn!("Persisted provider '{}' invalid, keeping default: {}", loaded.provider, e),
                }
                *state.settings.write().await = loaded;
            }
            Err(e) => log::warn!("Failed to deserialize persisted AppSettings, using defaults: {}", e),
        }
    }
    if let Some(val) = persistence.get(WATCH_RULES_KEY)? {
        if let Ok(rules) = serde_json::from_value::<Vec<WatchRule>>(val) {
            *state.watch_rules.write().await = rules;
        }
    }
    if let Some(val) = persistence.get(WATCH_MATCHES_KEY)? {
        if let Ok(matches) = serde_json::from_value::<Vec<WatchMatch>>(val) {
            *state.watch_matches.write().await = matches;
        }
    }
    if let Some(val) = persistence.get(WATCH_SEEN_KEY)? {
        if let Ok(seen) = serde_json::from_value::<HashMap<String, HashSet<String>>>(val) {
            *state.watch_seen.write().await = seen;
        }
    }
    Ok(())
}

/// Start the core, serve HTTP on `config.addr` until `shutdown` resolves, then checkpoint.
/// `on_bound` gets the bound address (useful with port 0).
pub async fn serve(
    config: HeadlessConfig,
    on_bound: impl FnOnce(SocketAddr),
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
    let core = Headless::start(&config.data_dir).await?;
    let listener = tokio::net::TcpListener::bind(config.addr)
        .await
        .map_err(|e| format!("Failed to listen on {}: {}", config.addr, e))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    log::info!("DebridDownloader headless listening on http://{} (data dir {})", addr, config.data_dir.display());
    match &config.web_dir {
        Some(dir) if dir.join("index.html").is_file() => log::info!("Serving the web UI from {}", dir.display()),
        Some(dir) => log::warn!("No index.html in {}; build it with `npm run build:web`", dir.display()),
        None => log::info!("No --web-dir: serving the API only"),
    }
    on_bound(addr);
    // Graceful shutdown waits for open connections; end the SSE streams so it doesn't wait forever.
    let streams = core.server.shutdown.clone();
    let shutdown = async move {
        shutdown.await;
        streams.cancel();
    };
    let router = server::router(core.server.clone().with_web_dir(config.web_dir.clone()));
    let served = axum::serve(listener, router).with_graceful_shutdown(shutdown).await;
    core.shutdown().await;
    served.map_err(|e| format!("Server error: {}", e))
}

/// Resolves on Ctrl-C, or SIGTERM on Unix (`docker stop`).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = term => {}
    }
    log::info!("Shutting down");
}

/// Entry point of the `debriddownloader-headless` binary.
pub fn main() -> std::process::ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let config = match parse_cli(std::env::args().skip(1), |k| std::env::var(k).ok()) {
        Ok(Cli::Run(config)) => config,
        Ok(Cli::Help) => {
            println!("{}", USAGE);
            return std::process::ExitCode::SUCCESS;
        }
        Err(e) => {
            eprintln!("{}", e);
            return std::process::ExitCode::from(2);
        }
    };
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("Failed to start the async runtime: {}", e);
            return std::process::ExitCode::FAILURE;
        }
    };
    match runtime.block_on(serve(config, |_| {}, shutdown_signal())) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            log::error!("{}", e);
            eprintln!("{}", e);
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k: &str| map.get(k).cloned()
    }

    fn run(args: &[&str], env: &[(&str, &str)]) -> HeadlessConfig {
        match parse_cli(args.iter().copied(), env_of(env)).unwrap() {
            Cli::Run(c) => c,
            Cli::Help => panic!("unexpected help"),
        }
    }

    #[test]
    fn defaults_are_loopback_8777_and_xdg_data_dir() {
        let c = run(&[], &[("HOME", "/home/u")]);
        assert_eq!(c.addr, "127.0.0.1:8777".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("/home/u/.local/share/debriddownloader"));
        let c = run(&[], &[("HOME", "/home/u"), ("XDG_DATA_HOME", "/xdg")]);
        assert_eq!(c.data_dir, PathBuf::from("/xdg/debriddownloader"));
        assert_eq!(run(&[], &[]).data_dir, PathBuf::from("data"));
    }

    #[test]
    fn env_vars_set_bind_port_and_data_dir() {
        let c = run(&[], &[(ENV_BIND, "0.0.0.0"), (ENV_PORT, "9000"), (ENV_DATA_DIR, "/data")]);
        assert_eq!(c.addr, "0.0.0.0:9000".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("/data"));
        // Blank env vars count as unset.
        let c = run(&[], &[(ENV_BIND, " "), (ENV_PORT, ""), ("HOME", "/h")]);
        assert_eq!(c.addr, "127.0.0.1:8777".parse().unwrap());
    }

    #[test]
    fn flags_override_env() {
        let env = [(ENV_BIND, "0.0.0.0"), (ENV_PORT, "9000"), (ENV_DATA_DIR, "/data")];
        let c = run(&["--bind", "10.0.0.5", "--port", "1234", "--data-dir", "/srv/dd"], &env);
        assert_eq!(c.addr, "10.0.0.5:1234".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("/srv/dd"));
        let c = run(&["--port=0", "--bind=[::]"], &env);
        assert_eq!(c.addr, "[::]:0".parse().unwrap());
        assert_eq!(c.data_dir, PathBuf::from("/data"));
        assert_eq!(run(&["--bind", "localhost"], &[]).addr.ip(), DEFAULT_BIND);
        assert_eq!(run(&["--bind", "::1"], &[]).addr, "[::1]:8777".parse().unwrap());
    }

    #[test]
    fn web_dir_comes_from_flag_or_env() {
        assert_eq!(run(&[], &[]).web_dir, None);
        assert_eq!(run(&[], &[(ENV_WEB_DIR, "/env-web")]).web_dir, Some(PathBuf::from("/env-web")));
        assert_eq!(run(&[], &[(ENV_WEB_DIR, " ")]).web_dir, None);
        let c = run(&["--web-dir", "/srv/web"], &[(ENV_WEB_DIR, "/env-web")]);
        assert_eq!(c.web_dir, Some(PathBuf::from("/srv/web")));
        assert_eq!(run(&["--web-dir=dist-web"], &[]).web_dir, Some(PathBuf::from("dist-web")));
    }

    #[test]
    fn bad_input_is_an_error() {
        let parse = |args: &[&str], env: &[(&str, &str)]| parse_cli(args.iter().copied(), env_of(env));
        assert!(parse(&["--port", "70000"], &[]).unwrap_err().contains("Invalid port"));
        assert!(parse(&[], &[(ENV_PORT, "http")]).unwrap_err().contains("Invalid port"));
        assert!(parse(&["--bind", "example.com"], &[]).unwrap_err().contains("Invalid bind address"));
        assert!(parse(&["--port"], &[]).unwrap_err().contains("needs a value"));
        assert!(parse(&["--verbose"], &[]).unwrap_err().contains("Unknown argument"));
        assert_eq!(parse(&["--port", "1", "--help"], &[]).unwrap(), Cli::Help);
        assert_eq!(parse(&["-h"], &[]).unwrap(), Cli::Help);
    }

    /// Starts the whole headless host on a configured port, without Tauri or a display, and
    /// gets 200 from `/health` over real TCP.
    #[tokio::test]
    async fn serve_answers_health_on_the_configured_port() {
        let dir = tempfile::tempdir().unwrap();
        let port = crate::engine::tests::mock_server::free_port();
        let config = match parse_cli(
            ["--port".to_string(), port.to_string(), "--data-dir".into(), dir.path().to_string_lossy().into()],
            |_| None,
        )
        .unwrap()
        {
            Cli::Run(c) => c,
            Cli::Help => unreachable!(),
        };
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        let (bound_tx, bound_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(serve(
            config,
            move |addr| {
                let _ = bound_tx.send(addr);
            },
            async move {
                let _ = stop_rx.await;
            },
        ));
        let addr = tokio::time::timeout(std::time::Duration::from_secs(20), bound_rx).await.unwrap().unwrap();
        assert_eq!(addr, SocketAddr::new(DEFAULT_BIND, port));

        let resp = reqwest::get(format!("http://{}/health", addr)).await.unwrap();
        assert_eq!(resp.status(), 200);
        // Everything else needs the token.
        let resp = reqwest::get(format!("http://{}/api/downloads", addr)).await.unwrap();
        assert_eq!(resp.status(), 401);

        // The generated token landed in the data dir, and the engine state is there too.
        let secrets: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("secrets.json")).unwrap()).unwrap();
        let token = secrets[server::AUTH_TOKEN_KEY].as_str().unwrap();
        assert!(token.len() >= 32);

        // The SSE route is served, and an open stream doesn't keep the server from shutting down.
        let client = reqwest::Client::new();
        let resp = client.get(format!("http://{}/api/events", addr)).send().await.unwrap();
        assert_eq!(resp.status(), 401);
        let events = client.get(format!("http://{}/api/events", addr)).bearer_auth(token).send().await.unwrap();
        assert_eq!(events.status(), 200);
        assert_eq!(events.headers()["content-type"], "text/event-stream");

        stop_tx.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(20), server).await.unwrap().unwrap().unwrap();
        drop(events);
    }

    /// With `--web-dir`, the binary serves the UI bundle at `/` and the index for a client route,
    /// over real TCP, while `/api/*` keeps answering as the API.
    #[tokio::test]
    async fn serve_serves_the_web_ui_with_spa_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let web = tempfile::tempdir().unwrap();
        std::fs::write(web.path().join("index.html"), "<!doctype html><div id=\"root\"></div>").unwrap();
        std::fs::create_dir(web.path().join("assets")).unwrap();
        std::fs::write(web.path().join("assets/index-abc.js"), "console.log(1)").unwrap();
        let port = crate::engine::tests::mock_server::free_port();
        let args = [
            "--port".to_string(),
            port.to_string(),
            "--data-dir".into(),
            dir.path().to_string_lossy().into(),
            "--web-dir".into(),
            web.path().to_string_lossy().into(),
        ];
        let Cli::Run(config) = parse_cli(args, |_| None).unwrap() else { unreachable!() };
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        let (bound_tx, bound_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(serve(
            config,
            move |addr| {
                let _ = bound_tx.send(addr);
            },
            async move {
                let _ = stop_rx.await;
            },
        ));
        let addr = tokio::time::timeout(std::time::Duration::from_secs(20), bound_rx).await.unwrap().unwrap();
        let get = |path: &str| reqwest::get(format!("http://{}{}", addr, path));

        for path in ["/", "/downloads", "/settings/general"] {
            let resp = get(path).await.unwrap();
            assert_eq!(resp.status(), 200, "{}", path);
            assert_eq!(resp.headers()["content-type"], "text/html; charset=utf-8", "{}", path);
            assert!(resp.text().await.unwrap().contains("<div id=\"root\">"), "{}", path);
        }
        let resp = get("/assets/index-abc.js").await.unwrap();
        assert_eq!(resp.status(), 200);
        assert!(resp.headers()["content-type"].to_str().unwrap().starts_with("text/javascript"));
        assert_eq!(resp.text().await.unwrap(), "console.log(1)");
        assert_eq!(get("/api/downloads").await.unwrap().status(), 401);
        assert_eq!(get("/api/nope").await.unwrap().status(), 404);

        stop_tx.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(20), server).await.unwrap().unwrap().unwrap();
    }

    /// The headless host's app events (engine, watchlist, routes) reach `/api/events` subscribers.
    #[tokio::test]
    async fn start_wires_events_to_the_sse_broadcast() {
        let dir = tempfile::tempdir().unwrap();
        let core = Headless::start(dir.path()).await.unwrap();
        let mut rx = core.server.broadcast.subscribe();
        core.server.events.emit("watchlist-match", &serde_json::json!({ "rule_id": "r1" }));
        let ev = rx.recv().await.unwrap();
        assert_eq!((ev.name.as_str(), ev.payload["rule_id"].as_str()), ("watchlist-match", Some("r1")));
        // The engine's sink is the same broadcast: a change to the job list is announced.
        let job = engine::NewJob {
            kind: engine::JobKind::Symlink,
            filename: "a.mkv".into(),
            destination: dir.path().join("a.mkv").to_string_lossy().into(),
            source: engine::LinkSource::Direct,
            url: "http://x".into(),
            total_bytes: 1,
            batch_id: String::new(),
            batch_name: String::new(),
        };
        core.server.state.engine().unwrap().add_completed(job).await;
        let ev = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(ev.name, "downloads-changed");
        core.shutdown().await;
    }

    #[tokio::test]
    async fn start_loads_persisted_settings_and_watchlist() {
        let dir = tempfile::tempdir().unwrap();
        let store = Persistence(Arc::new(JsonFileStore::in_dir(dir.path())));
        let mut settings = AppSettings::default();
        settings.provider = "torbox".into();
        settings.download_folder = Some("/downloads".into());
        store.set_json(SETTINGS_KEY, &settings).unwrap();
        store.set(WATCH_RULES_KEY, serde_json::json!([])).unwrap();

        let core = Headless::start(dir.path()).await.unwrap();
        let state = &core.server.state;
        assert_eq!(*state.provider_id.read().await, "torbox");
        assert_eq!(state.get_provider().await.info().id, "torbox");
        assert_eq!(state.settings.read().await.download_folder.as_deref(), Some("/downloads"));
        assert!(state.engine().is_ok());
        core.shutdown().await;
    }

    #[tokio::test]
    async fn start_refuses_an_unreadable_settings_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), "{broken").unwrap();
        assert!(Headless::start(dir.path()).await.is_err());
        assert_eq!(std::fs::read_to_string(dir.path().join("settings.json")).unwrap(), "{broken");
    }
}
