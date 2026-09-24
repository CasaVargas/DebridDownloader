# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|------|---------|
| Run app (Vite dev + Tauri window, hot reload) | `npm run tauri dev` |
| Production bundle for current platform | `npm run tauri build` |
| Type-check only (no emit) | `npx tsc --noEmit` |
| Frontend-only build (tsc + Vite, no native bundle) | `npm run build` |
| Frontend tests (Vitest: tokens/contrast, shortcuts, primitives, settings routes, style-literal guard) | `npm test` |
| Rust tests (download engine) | `cargo test --manifest-path src-tauri/Cargo.toml` |

Rust tests live in `src-tauri/src/engine/tests/` (mock CDN in `mock_server.rs`); frontend tests live in `src/test/` (Vitest + jsdom). Both run in CI via `.github/workflows/test.yml`. Tests don't cover rendering in the Tauri WebView — still verify UI changes visually in `npm run tauri dev`.

Native bundles land in `src-tauri/target/release/bundle/`. Vite dev URL is `http://localhost:1420` (hardcoded in `tauri.conf.json` — don't change without updating both sides).

## Architecture

Tauri v2 two-process app. Frontend is React 19 + TS + Tailwind v4 + React Router 7 in `src/`. Backend is Rust (Tokio + Reqwest + Axum) in `src-tauri/src/`. They talk over Tauri IPC: TS calls `invoke("cmd_name", args)` → Rust `#[command] async fn cmd_name(...)`.

### IPC layering convention

Every backend feature has a parallel pair of files — keep them in sync:

```
src/api/<domain>.ts         ←→  src-tauri/src/commands/<domain>.rs
```

The TS file is a thin `invoke()` wrapper, one function per command. The Rust file holds `#[tauri::command]` handlers, all of which must also be registered in `tauri::generate_handler![...]` inside `src-tauri/src/lib.rs`. **Adding a backend command means editing three places: the `.rs` command file, the `generate_handler!` macro, and the `src/api/<domain>.ts` wrapper.**

TS types in `src/types/` mirror Rust structs by hand (no codegen) — when you change a `Serialize` struct, update the matching TS interface. Rust enums use `#[serde(rename_all = "PascalCase")]` (see `DownloadStatus`).

### Provider abstraction (Real-Debrid / TorBox / Premiumize)

`src-tauri/src/providers/mod.rs` defines a `#[async_trait] DebridProvider` trait. Three impls live under `providers/{real_debrid,torbox,premiumize}/` and each follows the same `client.rs` / `types.rs` / `mod.rs` shape. Provider-specific response shapes get translated into the shared types in `providers/types.rs` inside each `client.rs`.

The active provider is held in `AppState.provider: Arc<RwLock<Arc<dyn DebridProvider>>>` and swapped at runtime by `commands::auth::switch_provider`. **Always read it via `state.get_provider().await` and clone the `Arc` — don't hold the `RwLock` guard across `.await`** (see the helper at `state.rs:153`). Real-Debrid uses OAuth device flow; the others use API keys. The trait exposes `as_any()` so the OAuth commands can downcast to `RdClient`.

To add a fourth provider: implement the trait, add a module under `providers/`, register it in `available_providers()` in `providers/mod.rs`, and extend `commands::auth::create_provider`.

### State & persistence

`AppState` (`state.rs`) is the single managed state — everything is `Arc<RwLock<...>>`. There are **two stores** managed by `tauri-plugin-store`, and they're not interchangeable:

- `commands::settings::SETTINGS_STORE` / `SETTINGS_KEY` — `AppSettings` blob (download folder, theme, provider id, media-server creds, extraction prefs, etc.). Loaded in `lib.rs` `setup` and written back via `commands::settings::update_settings`.
- `settings.json` — used only by the watchlist (`watch_rules`, `watch_matches`, `watch_seen_hashes`). Loaded in the same `setup` block.

Settings persistence was added in 1.6.1 (commit `35295e9`); if you add a new field to `AppSettings`, give it `#[serde(default)]` so older persisted blobs still deserialize.

Secrets (API tokens, OAuth client id/secret, refresh tokens) live in the OS keyring under service `com.jonathan.debriddownloader`, keyed as `<provider-id>.<name>` (e.g. `real-debrid.api_token`). A one-shot migration in `lib.rs` (gated by the `migration_v2_done` keyring entry) renames pre-1.x unprefixed keys — leave it alone.

### Background subsystems started in `lib.rs::run` setup

1. **Streaming proxy** — `streaming::start_streaming_server` spawns an Axum server on a random port, stored in `state.streaming_port`. Frontend gets per-session URLs via `commands::streaming::get_stream_url` for in-app preview / casting. Sessions are tracked in `state.stream_sessions` and must be cleaned up.
2. **Watchlist loop** — `watchlist::start_watch_loop` polls user-defined search rules across configured trackers and emits matches; cancellable via `state.watch_cancel`.
3. **Tray icon** — built inline; "Show Window" / "Quit" plus left-click-to-show. Closing the main window does not quit (the tray keeps the process alive).
4. **Magnet deep-link handler** — `magnet:` scheme is registered (`tauri.conf.json`). Three entry points feed the same `magnet-link-received` event: the deep-link plugin callback, `tauri-plugin-single-instance` (for already-running app on Win/Linux), and a CLI-args scan in `setup` (cold start). Cold-start URIs land in `PendingMagnetUri` until the frontend asks for them via `commands::magnet::get_pending_magnet_uri`. **Validate every magnet URI through `commands::magnet::validate_magnet_uri` before trusting it** — the deep-link plugin will hand you arbitrary URLs.

### Downloads

`engine/` is the download engine (Tauri-free; see `specs/2026-09-23-resilient-download-engine-design.md`). One actor (`engine/actor.rs`) owns all jobs, persisted to `{app_data_dir}/downloads.json`. Transfers write `{dest}.part` with segmented `Range` requests and durable checkpoints, then rename. `engine_host.rs` adapts it to Tauri (events, provider link refresh, rclone). `commands/downloads.rs` is a thin IPC layer. Post-download extract/organize runs in `engine/pipeline.rs`; media-server scans fire on `BatchFinished`.

### Frontend conventions

- Each route is a single file in `src/pages/`; Settings is split into `src/pages/settings/` sections (`SettingsLayout` + one file per section, shared state in `useSettings`).
- `Layout.tsx` wraps authenticated routes; `App.tsx` flips between `<AuthPage/>` and the layout based on `isAuthenticated`.
- All visual values live in `src/styles/tokens.css`; build UI from `src/components/ui/` primitives. `npm test` fails on raw hex/rgb/px literals in `src/pages` and `src/components`. Theme (System/Light/Dark) and accent are applied by `src/hooks/useAppearance.ts`; accent-colored text uses `text-accent-text`, never `text-accent`.
- Mini player + toast live at the App root via two contexts (`MiniPlayerProvider`, `AuthContext`) so they survive route changes.

## Releases

Version is bumped in **three** places that must agree: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. The updater pulls `latest.json` from the GitHub releases of `CasaVargas/DebridDownloader`; the signing pubkey is embedded in `tauri.conf.json`. CI (`.github/workflows/build.yml`) handles signed/notarized macOS (Apple Silicon only — Intel was dropped in `f611106`), Windows x64 + ARM64, and Linux `.deb` / `.AppImage`.
