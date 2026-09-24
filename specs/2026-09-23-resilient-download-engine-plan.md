# Resilient Download Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-stream downloader with a Tauri-free Rust engine that does segmented, resumable, persisted, globally-scheduled downloads with retry, link refresh, and pause/resume.

**Architecture:** A new `src-tauri/src/engine/` module. One actor task owns all job state and talks to the outside through three traits (`EventSink`, `LinkRefresher`, `RemoteRunner`). Transfers run `Range` segment workers into a `{dest}.part` file with durable checkpoints persisted in `{app_data_dir}/downloads.json`. A thin Tauri host layer (`engine_host.rs` + `commands/downloads.rs`) adapts it to IPC.

**Tech Stack:** Rust (Tokio, reqwest 0.12, Axum 0.8 for the test mock server, serde, tokio-util `CancellationToken`, `fs4` for free-space), React 19 + TS.

**Spec:** `specs/2026-09-23-resilient-download-engine-design.md` — read it before starting any task.

## Global Constraints

- The engine module (`src-tauri/src/engine/**`) must not `use tauri`. Only `engine_host.rs`, `commands/**`, and `lib.rs` touch Tauri.
- `JobState` serializes exactly like today's `DownloadStatus`: `#[serde(rename_all = "PascalCase")]`, unit variants as strings, `Failed(String)` as `{"Failed": "..."}`.
- Event name `download-progress` is unchanged; its payload keeps `id, filename, downloaded_bytes, total_bytes, speed, status, remote` and only adds fields. New event: `downloads-changed`.
- Adding a backend command = edit three places: the `.rs` command, `generate_handler!` in `lib.rs`, the `src/api/downloads.ts` wrapper.
- New `AppSettings` fields must have `#[serde(default...)]`.
- TS types in `src/types/index.ts` mirror Rust structs by hand — update them whenever a serialized struct changes.
- Never hold the provider `RwLock` guard across `.await` — use `state.get_provider().await` and clone the `Arc`.
- New UI code uses theme variables (`var(--theme-*)`, `var(--accent*)`), not new hardcoded colors.
- Defaults (verbatim from spec): `segments_per_file` 4 (clamp 1–16); min segment 8 MiB; tail-split threshold 16 MiB; connect timeout 15 s; idle read timeout 30 s; checkpoint every 8 MiB or 2 s; segment retries 5 at 1/2/4/8/16 s; job backoff 5 s × 3^(attempt−1) capped 5 min; max 8 job attempts; offline probe every 30 s; save at most every 2 s; history cap 500; shutdown grace 2 s; progress events ≤ 10/s per job.
- Commits: conventional style, small, each ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run all Rust commands from the repo root with `--manifest-path src-tauri/Cargo.toml`.

### Deviations from the spec (deliberate, keep them)

1. Backoff is represented as `state = Pending` with `retry_at` set (not `Downloading`) — the permit is released during the wait, which is what the scheduler needs. The UI shows "Retrying in Ns".
2. Media-server scans are triggered by the host on `EngineEvent::BatchFinished` (keeps `trigger_scans`, which needs an `AppHandle`, out of the engine). `PostConfig` therefore has no media-server credentials.
3. Extra engine files `refresh.rs` (LinkRefresher) and `remote.rs` (RemoteRunner); extra `JobKind::Symlink`; extra fields `Job.size_resets` and `JobView.waiting_for_network`.
4. "Offline" is detected as: a job fails with connect errors **and** no other running job has received bytes within the idle timeout.
5. "Cancel All" cancels every unfinished job instead of wiping the list (use "Clear Inactive" to wipe).
6. Tests live in `src-tauri/src/engine/tests/` as a `#[cfg(test)]` module, because the crate's modules are private to integration tests.

## Review Focus

1. **The same file queued twice** (user clicks Download twice) — two transfers must not write one `.part`; the second enqueue returns the existing job id. Test: Task 9, `duplicate_destination_is_deduped`.
2. **A zero-byte file** — a `Range: bytes=0-0` probe gets `416`; the engine must produce an empty file, not fail. Test: Task 6, `zero_byte_file_completes`.
3. **A server with no `Content-Length` and no range support** — must stream to EOF and complete. Test: Task 6, `unknown_size_streams_to_eof`.
4. **The `.part` file deleted while the job is paused** (user cleaned up the folder) — resume restarts from 0 instead of writing into a missing file. Test: Task 6, `part_deleted_while_paused_restarts`.
5. **Non-ASCII filenames** (`Ünïcødé Movie (2024) [1080p].mkv`) — must download and rename correctly. Test: Task 6, `unicode_filename_downloads`.

---

## File Structure

**Create**
- `src-tauri/src/engine/mod.rs` — module root, `Engine` handle, `EngineDeps`, `Timing`, re-exports.
- `src-tauri/src/engine/types.rs` — `Job`, `NewJob`, `JobKind`, `JobState`, `SegmentState`, `PostStage`, `EngineConfig`, `PostConfig`, `now_ms`.
- `src-tauri/src/engine/events.rs` — `JobView`, `EngineEvent`, `EventSink`.
- `src-tauri/src/engine/refresh.rs` — `LinkRefresher`, `RefreshedLink`, `RefreshError`.
- `src-tauri/src/engine/remote.rs` — `RemoteRunner`, `RemoteOutcome`.
- `src-tauri/src/engine/limiter.rs` — global token bucket.
- `src-tauri/src/engine/store.rs` — `downloads.json` load/save, `prune_history`, `recover`.
- `src-tauri/src/engine/segment.rs` — one `Range` worker + HTTP header helpers.
- `src-tauri/src/engine/transfer.rs` — probe/plan/run/split/finalize for one job.
- `src-tauri/src/engine/pipeline.rs` — extract → organize.
- `src-tauri/src/engine/actor.rs` — the actor: queue, scheduler, controls, persistence, events.
- `src-tauri/src/engine/tests/{mod.rs, mock_server.rs, support.rs, *_tests.rs}` — test harness.
- `src-tauri/src/engine_host.rs` — Tauri adapters: `TauriSink`, `ProviderRefresher`, `TauriRemoteRunner`.
- `.github/workflows/test.yml` — `cargo test` + `tsc` on push/PR.

**Modify**
- `src-tauri/Cargo.toml` — `fs4` dep; `tokio` `test-util` dev feature.
- `src-tauri/src/providers/types.rs` — `LinkSource`; `DownloadLink.source`.
- `src-tauri/src/providers/mod.rs` — `refresh_link` trait method.
- `src-tauri/src/providers/{real_debrid,torbox,premiumize}/client.rs` — populate `source`, implement `refresh_link`.
- `src-tauri/src/state.rs` — `DownloadStatus` becomes an alias of `JobState`; `AppState.engine`; drop `active_downloads`/`cancel_tokens`; `AppSettings.segments_per_file` + `engine_config()`.
- `src-tauri/src/rclone.rs` — owns `DownloadProgress` + `emit_progress` (moved from `downloader.rs`).
- `src-tauri/src/commands/downloads.rs` — thin wrappers over `Engine`.
- `src-tauri/src/commands/settings.rs`, `src-tauri/src/commands/backup.rs` — push config to the engine.
- `src-tauri/src/lib.rs` — modules, engine start, new commands, graceful shutdown on `RunEvent::Exit`.
- `src/types/index.ts`, `src/api/downloads.ts`, `src/hooks/useDownloadTasks.tsx`, `src/pages/DownloadsPage.tsx`, `src/pages/SettingsPage.tsx`.
- `AGENTS.md`, `README.md`.

**Delete**
- `src-tauri/src/downloader.rs`.

---

### Task 0: Toolchain and baseline

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [x] **Step 1: Make sure Rust is installed**

Run: `cargo --version`
If it is missing (it was missing on the M4 Mac Mini on 2026-09-23), install rustup — **ask the human first**, it modifies the shell profile:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```
Expected: `cargo 1.8x.x` or newer.

- [x] **Step 2: Add dependencies**

In `src-tauri/Cargo.toml`, under `[dependencies]` add:
```toml
fs4 = "0.13"
```
Replace the `[dev-dependencies]` section with:
```toml
[dev-dependencies]
tempfile = "3"
tokio = { version = "1", features = ["full", "test-util"] }
```

- [x] **Step 3: Verify the baseline builds and the (empty) test suite runs**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: compiles; `test result: ok. 0 passed` (or whatever tests already exist in `extractor.rs`, all passing). If it fails to compile *before* any change, stop and report — do not start Task 1 on a broken baseline.

- [x] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: add fs4 and tokio test-util for download engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Engine types, `LinkSource`, and the `JobState` move

**Files:**
- Create: `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/types.rs`, `src-tauri/src/engine/events.rs`, `src-tauri/src/engine/refresh.rs`, `src-tauri/src/engine/remote.rs`, `src-tauri/src/engine/tests/mod.rs`, `src-tauri/src/engine/tests/types_tests.rs`
- Modify: `src-tauri/src/providers/types.rs:121-127`, `src-tauri/src/state.rs:103-112`, `src-tauri/src/lib.rs:1-13`

**Interfaces:**
- Produces: `engine::types::{Job, NewJob, JobKind, JobState, SegmentState, PostStage, EngineConfig, PostConfig, now_ms}`, `providers::types::LinkSource` (re-exported as `engine::types::LinkSource`), `engine::events::{JobView, EngineEvent, EventSink}`, `engine::refresh::{LinkRefresher, RefreshedLink, RefreshError}`, `engine::remote::{RemoteRunner, RemoteOutcome, NoRemote}`. `state::DownloadStatus` becomes `pub use crate::engine::types::JobState as DownloadStatus`.

- [x] **Step 1: Add `LinkSource` to provider types**

In `src-tauri/src/providers/types.rs`, directly above `pub struct DownloadLink`, add:
```rust
/// How to obtain a fresh URL for a file when its debrid link expires.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "type")]
pub enum LinkSource {
    RealDebrid { hoster_link: String },
    TorBox { torrent_id: String, file_id: u64 },
    Premiumize { transfer_id: String, filename: String },
    #[default]
    Direct,
}

impl LinkSource {
    /// Provider id (matches `ProviderInfo.id`) that can refresh this source.
    pub fn provider_id(&self) -> Option<&'static str> {
        match self {
            LinkSource::RealDebrid { .. } => Some("real-debrid"),
            LinkSource::TorBox { .. } => Some("torbox"),
            LinkSource::Premiumize { .. } => Some("premiumize"),
            LinkSource::Direct => None,
        }
    }
}
```
And add the field to `DownloadLink`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub filename: String,
    pub filesize: i64,
    pub download: String,
    pub streamable: Option<bool>,
    #[serde(default)]
    pub source: LinkSource,
}
```
Then fix the four construction sites so the crate compiles (real values come in Task 9): add `source: shared::LinkSource::Direct,` to the struct literals in `src-tauri/src/providers/real_debrid/client.rs:360`, `src-tauri/src/providers/torbox/client.rs:343`, and both literals in `src-tauri/src/providers/premiumize/client.rs:333` and `:346`.

- [x] **Step 2: Write `engine/types.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub use crate::providers::types::LinkSource;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum JobState {
    Pending,
    Downloading,
    Paused,
    Extracting,
    Completed,
    Failed(String),
    Cancelled,
}

impl JobState {
    pub fn is_terminal(&self) -> bool {
        matches!(self, JobState::Completed | JobState::Failed(_) | JobState::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum JobKind {
    Http,
    Remote { rclone_dest: String },
    Symlink,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PostStage {
    None,
    Extract,
    Organize,
    Done,
}

/// Inclusive byte range `[start, end]`; `done` = bytes durable on disk from `start`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct SegmentState {
    pub start: u64,
    pub end: u64,
    pub done: u64,
}

impl SegmentState {
    pub fn len(&self) -> u64 {
        self.end + 1 - self.start
    }
    pub fn pos(&self) -> u64 {
        self.start + self.done
    }
    pub fn remaining(&self) -> u64 {
        self.len().saturating_sub(self.done)
    }
    pub fn is_done(&self) -> bool {
        self.done >= self.len()
    }
}

fn yes() -> bool {
    true
}
fn default_max_segments() -> u32 {
    16
}
fn post_none() -> PostStage {
    PostStage::None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Job {
    pub id: String,
    pub kind: JobKind,
    pub filename: String,
    /// Final path. The work file is `{destination}.part`.
    pub destination: String,
    #[serde(default)]
    pub source: LinkSource,
    /// Last resolved URL (may be expired).
    pub url: String,
    pub total_bytes: i64,
    #[serde(default)]
    pub segments: Vec<SegmentState>,
    #[serde(default = "yes")]
    pub resumable: bool,
    #[serde(default = "default_max_segments")]
    pub max_segments: u32,
    pub state: JobState,
    #[serde(default)]
    pub attempt: u32,
    #[serde(default)]
    pub retry_at: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default = "post_none")]
    pub post: PostStage,
    #[serde(default)]
    pub size_resets: u32,
    #[serde(default)]
    pub batch_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Job {
    pub fn from_new(n: NewJob, id: String, now: i64) -> Job {
        Job {
            id,
            kind: n.kind,
            filename: n.filename,
            destination: n.destination,
            source: n.source,
            url: n.url,
            total_bytes: n.total_bytes,
            segments: Vec::new(),
            resumable: true,
            max_segments: default_max_segments(),
            state: JobState::Pending,
            attempt: 0,
            retry_at: None,
            error: None,
            post: PostStage::None,
            size_resets: 0,
            batch_id: n.batch_id,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn part_path(&self) -> PathBuf {
        PathBuf::from(format!("{}.part", self.destination))
    }

    /// Durable bytes on disk (sum of segment progress).
    pub fn downloaded(&self) -> u64 {
        self.segments.iter().map(|s| s.done.min(s.len())).sum()
    }

    pub fn remote_dest(&self) -> Option<&str> {
        match &self.kind {
            JobKind::Remote { rclone_dest } => Some(rclone_dest),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewJob {
    pub kind: JobKind,
    pub filename: String,
    pub destination: String,
    pub source: LinkSource,
    pub url: String,
    pub total_bytes: i64,
    pub batch_id: String,
}

#[derive(Debug, Clone)]
pub struct PostConfig {
    pub auto_extract: bool,
    pub delete_after_extract: bool,
    pub auto_organize: bool,
    pub movies_folder: Option<String>,
    pub tv_folder: Option<String>,
    pub tmdb_api_key: Option<String>,
    pub rar_tool: crate::extractor::RarTool,
}

impl Default for PostConfig {
    fn default() -> Self {
        Self {
            auto_extract: false,
            delete_after_extract: false,
            auto_organize: false,
            movies_folder: None,
            tv_folder: None,
            tmdb_api_key: None,
            rar_tool: crate::extractor::RarTool::None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub max_concurrent: u32,
    pub segments_per_file: u32,
    pub speed_limit_bytes: Option<u64>,
    pub post: PostConfig,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self { max_concurrent: 3, segments_per_file: 4, speed_limit_bytes: None, post: PostConfig::default() }
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
```

- [x] **Step 3: Write `engine/events.rs`, `engine/refresh.rs`, `engine/remote.rs`**

`events.rs`:
```rust
use super::types::JobState;
use serde::Serialize;

/// One row of the downloads list; also the `download-progress` event payload.
/// Field names are a superset of the old `DownloadProgress` / `DownloadTask`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct JobView {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub destination: String,
    pub total_bytes: i64,
    pub downloaded_bytes: i64,
    pub speed: f64,
    pub status: JobState,
    pub remote: Option<String>,
    pub attempt: u32,
    pub retry_at: Option<i64>,
    pub segments_active: u32,
    pub resumable: bool,
    pub error: Option<String>,
    pub waiting_for_network: bool,
}

#[derive(Debug, Clone)]
pub enum EngineEvent {
    Progress(JobView),
    /// A job was added or removed; the UI should refetch the list.
    ListChanged,
    /// Every job in the batch is terminal and at least one completed.
    BatchFinished { batch_id: String },
}

pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
}
```

`refresh.rs`:
```rust
use super::types::LinkSource;

#[derive(Debug, Clone)]
pub struct RefreshedLink {
    pub url: String,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum RefreshError {
    #[error("Switch back to {0} to resume")]
    ProviderMismatch(String),
    #[error("this link can't be refreshed")]
    NotRefreshable,
    #[error("{0}")]
    Failed(String),
}

#[async_trait::async_trait]
pub trait LinkRefresher: Send + Sync + 'static {
    async fn refresh(&self, source: &LinkSource) -> Result<RefreshedLink, RefreshError>;
}
```

`remote.rs`:
```rust
use super::types::Job;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteOutcome {
    Completed,
    Cancelled,
}

/// Runs a `JobKind::Remote` job (rclone). The runner emits its own progress.
#[async_trait::async_trait]
pub trait RemoteRunner: Send + Sync + 'static {
    async fn run(&self, job: Job, cancel: CancellationToken, speed_limit: Option<u64>) -> Result<RemoteOutcome, String>;
}

/// Used by tests and any host without rclone.
pub struct NoRemote;

#[async_trait::async_trait]
impl RemoteRunner for NoRemote {
    async fn run(&self, _job: Job, _cancel: CancellationToken, _speed_limit: Option<u64>) -> Result<RemoteOutcome, String> {
        Err("rclone destinations are not supported here".to_string())
    }
}
```

- [x] **Step 4: Write `engine/mod.rs` and the test module root**

`engine/mod.rs`:
```rust
//! Download engine. Must stay free of Tauri types (see specs/2026-09-23-resilient-download-engine-design.md).
#![allow(dead_code)] // removed in Task 10 once the host uses everything

pub mod events;
pub mod refresh;
pub mod remote;
pub mod types;

#[cfg(test)]
mod tests;

pub use events::{EngineEvent, EventSink, JobView};
pub use refresh::{LinkRefresher, RefreshError, RefreshedLink};
pub use remote::{NoRemote, RemoteOutcome, RemoteRunner};
pub use types::*;
```

`engine/tests/mod.rs`:
```rust
mod types_tests;
```

In `src-tauri/src/lib.rs` add `mod engine;` to the module list (keep alphabetical-ish: after `mod downloader;`).

- [x] **Step 5: Move `DownloadStatus` onto `JobState`**

In `src-tauri/src/state.rs`, delete the `DownloadStatus` enum (lines ~103-112, the `#[derive(...)] #[serde(rename_all = "PascalCase")] pub enum DownloadStatus { ... }` block) and put at the top of the file, after the `use` lines:
```rust
pub use crate::engine::types::JobState as DownloadStatus;
```

- [x] **Step 6: Write the failing tests**

`engine/tests/types_tests.rs`:
```rust
use crate::engine::types::*;
use crate::providers::types::DownloadLink;

#[test]
fn job_state_serializes_like_old_download_status() {
    assert_eq!(serde_json::to_string(&JobState::Pending).unwrap(), "\"Pending\"");
    assert_eq!(serde_json::to_string(&JobState::Downloading).unwrap(), "\"Downloading\"");
    assert_eq!(
        serde_json::to_string(&JobState::Failed("boom".into())).unwrap(),
        "{\"Failed\":\"boom\"}"
    );
    let back: JobState = serde_json::from_str("{\"Failed\":\"x\"}").unwrap();
    assert_eq!(back, JobState::Failed("x".into()));
}

#[test]
fn link_source_is_tagged_and_defaults_to_direct() {
    let s = LinkSource::RealDebrid { hoster_link: "https://h/x".into() };
    assert_eq!(
        serde_json::to_string(&s).unwrap(),
        "{\"type\":\"RealDebrid\",\"hoster_link\":\"https://h/x\"}"
    );
    let link: DownloadLink =
        serde_json::from_str("{\"filename\":\"a\",\"filesize\":1,\"download\":\"u\",\"streamable\":null}").unwrap();
    assert_eq!(link.source, LinkSource::Direct);
    assert_eq!(LinkSource::Direct.provider_id(), None);
    assert_eq!(s.provider_id(), Some("real-debrid"));
}

#[test]
fn job_deserializes_with_only_required_fields() {
    let json = r#"{"id":"1","kind":{"type":"Http"},"filename":"f","destination":"/tmp/f",
        "url":"u","total_bytes":10,"state":"Pending","created_at":0,"updated_at":0}"#;
    let job: Job = serde_json::from_str(json).unwrap();
    assert!(job.resumable);
    assert_eq!(job.max_segments, 16);
    assert_eq!(job.post, PostStage::None);
    assert_eq!(job.source, LinkSource::Direct);
    assert_eq!(job.part_path().to_string_lossy(), "/tmp/f.part");
}

#[test]
fn segment_math() {
    let s = SegmentState { start: 100, end: 199, done: 30 };
    assert_eq!(s.len(), 100);
    assert_eq!(s.pos(), 130);
    assert_eq!(s.remaining(), 70);
    assert!(!s.is_done());
    assert!(SegmentState { start: 0, end: 9, done: 10 }.is_done());
}
```

- [x] **Step 7: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::types_tests`
Expected: 4 passed. (They compile only once Steps 1–5 are done; if you wrote them first, the expected failure is "unresolved import `crate::engine`".)

- [x] **Step 8: Commit**

```bash
git add src-tauri/src/engine src-tauri/src/providers src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(engine): add engine types, LinkSource, and seams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Global speed limiter

**Files:**
- Create: `src-tauri/src/engine/limiter.rs`, `src-tauri/src/engine/tests/limiter_tests.rs`
- Modify: `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Produces: `engine::limiter::Limiter { fn new(rate: Option<u64>) -> Self; async fn set_rate(&self, rate: Option<u64>); async fn acquire(&self, n: usize) }`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/limiter_tests.rs`:
```rust
use crate::engine::limiter::Limiter;
use std::sync::Arc;
use tokio::time::{Duration, Instant};

#[tokio::test(start_paused = true)]
async fn unlimited_never_waits() {
    let l = Limiter::new(None);
    let t = Instant::now();
    for _ in 0..1000 {
        l.acquire(1_000_000).await;
    }
    assert_eq!(t.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn holds_rate_within_15_percent() {
    let l = Limiter::new(Some(1000)); // 1000 B/s
    let t = Instant::now();
    for _ in 0..30 {
        l.acquire(100).await; // 3000 bytes total
    }
    let secs = t.elapsed().as_secs_f64();
    assert!((2.55..=3.45).contains(&secs), "took {secs}s");
}

#[tokio::test(start_paused = true)]
async fn rate_is_shared_across_tasks() {
    let l = Arc::new(Limiter::new(Some(1000)));
    let t = Instant::now();
    let mut hs = Vec::new();
    for _ in 0..3 {
        let l = l.clone();
        hs.push(tokio::spawn(async move {
            for _ in 0..10 {
                l.acquire(100).await;
            }
        }));
    }
    for h in hs {
        h.await.unwrap();
    }
    let secs = t.elapsed().as_secs_f64();
    assert!((2.55..=3.45).contains(&secs), "took {secs}s");
}

#[tokio::test(start_paused = true)]
async fn set_rate_applies_live() {
    let l = Limiter::new(Some(100));
    l.set_rate(None).await;
    let t = Instant::now();
    l.acquire(1_000_000).await;
    assert_eq!(t.elapsed(), Duration::ZERO);
}
```
Add `mod limiter_tests;` to `engine/tests/mod.rs` and `pub mod limiter;` to `engine/mod.rs`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::limiter_tests`
Expected: FAIL — "file not found for module `limiter`".

- [ ] **Step 3: Implement `engine/limiter.rs`**

```rust
//! Global token bucket shared by every segment of every job.
//! Debt model: callers always take their bytes, then sleep off any deficit.
//! Burst capacity is one second of rate.
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration, Instant};

pub struct Limiter {
    bucket: Mutex<Bucket>,
}

struct Bucket {
    rate: Option<u64>,
    tokens: f64,
    last: Instant,
}

impl Limiter {
    pub fn new(rate: Option<u64>) -> Self {
        Self { bucket: Mutex::new(Bucket { rate, tokens: 0.0, last: Instant::now() }) }
    }

    pub async fn set_rate(&self, rate: Option<u64>) {
        let mut b = self.bucket.lock().await;
        b.rate = rate;
        b.tokens = 0.0;
        b.last = Instant::now();
    }

    pub async fn acquire(&self, n: usize) {
        let wait = {
            let mut b = self.bucket.lock().await;
            let Some(rate) = b.rate else { return };
            let rate = rate.max(1) as f64;
            let now = Instant::now();
            b.tokens = (b.tokens + now.duration_since(b.last).as_secs_f64() * rate).min(rate);
            b.last = now;
            b.tokens -= n as f64;
            if b.tokens >= 0.0 {
                return;
            }
            Duration::from_secs_f64(-b.tokens / rate)
        };
        sleep(wait).await;
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::limiter_tests`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine
git commit -m "feat(engine): add global token-bucket speed limiter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Persistence store and startup recovery

**Files:**
- Create: `src-tauri/src/engine/store.rs`, `src-tauri/src/engine/tests/store_tests.rs`
- Modify: `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Consumes: `Job`, `JobState`, `JobKind`, `PostStage`, `now_ms` (Task 1).
- Produces: `engine::store::{Store, HISTORY_CAP, prune_history, recover}`:
  - `Store::new(data_dir: &Path) -> Store`, `Store::path(&self) -> &Path`, `Store::load(&self) -> Vec<Job>`, `Store::save(&self, jobs: &[Job]) -> std::io::Result<()>`
  - `prune_history(jobs: &mut Vec<Job>)`
  - `recover(jobs: &mut [Job]) -> Vec<String>` (ids whose post-processing must re-run)

- [ ] **Step 1: Write the failing tests**

`engine/tests/store_tests.rs`:
```rust
use crate::engine::store::*;
use crate::engine::types::*;
use std::io::Write;

pub fn job(id: &str, state: JobState, dest: &str) -> Job {
    let mut j = Job::from_new(
        NewJob {
            kind: JobKind::Http,
            filename: id.into(),
            destination: dest.into(),
            source: LinkSource::Direct,
            url: "http://x".into(),
            total_bytes: 100,
            batch_id: "b".into(),
        },
        id.into(),
        0,
    );
    j.state = state;
    j
}

#[test]
fn missing_file_loads_empty() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Store::new(dir.path()).load().is_empty());
}

#[test]
fn save_then_load_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path());
    let jobs = vec![job("a", JobState::Pending, "/x/a"), job("b", JobState::Completed, "/x/b")];
    store.save(&jobs).unwrap();
    assert_eq!(store.load(), jobs);
}

#[test]
fn interrupted_save_leaves_previous_file_readable() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path());
    let jobs = vec![job("a", JobState::Pending, "/x/a")];
    store.save(&jobs).unwrap();
    // Simulate a crash after writing a temp file but before the rename.
    let mut f = std::fs::File::create(dir.path().join("downloads.json.deadbeef.tmp")).unwrap();
    f.write_all(b"{ garbage").unwrap();
    assert_eq!(store.load(), jobs);
}

#[test]
fn corrupt_file_is_quarantined() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("downloads.json"), b"not json").unwrap();
    let store = Store::new(dir.path());
    assert!(store.load().is_empty());
    assert!(!dir.path().join("downloads.json").exists());
    let quarantined = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|e| e.file_name().to_string_lossy().starts_with("downloads.json.corrupt-"));
    assert!(quarantined);
}

#[test]
fn unknown_version_is_quarantined() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("downloads.json"), br#"{"version":2,"jobs":[]}"#).unwrap();
    assert!(Store::new(dir.path()).load().is_empty());
    assert!(!dir.path().join("downloads.json").exists());
}

#[test]
fn prune_keeps_active_and_newest_history() {
    let mut jobs = Vec::new();
    for i in 0..(HISTORY_CAP + 10) {
        let mut j = job(&format!("done{i}"), JobState::Completed, "/x");
        j.updated_at = i as i64;
        jobs.push(j);
    }
    jobs.push(job("active", JobState::Downloading, "/x"));
    prune_history(&mut jobs);
    assert_eq!(jobs.len(), HISTORY_CAP + 1);
    assert!(jobs.iter().any(|j| j.id == "active"));
    assert!(!jobs.iter().any(|j| j.id == "done0")); // oldest dropped
    assert!(jobs.iter().any(|j| j.id == format!("done{}", HISTORY_CAP + 9)));
}

#[test]
fn recover_resets_states_and_validates_part_files() {
    let dir = tempfile::tempdir().unwrap();
    let dest_ok = dir.path().join("ok.bin").to_string_lossy().to_string();
    let dest_missing = dir.path().join("missing.bin").to_string_lossy().to_string();
    std::fs::write(format!("{dest_ok}.part"), vec![0u8; 100]).unwrap();

    let mut a = job("a", JobState::Downloading, &dest_ok);
    a.segments = vec![SegmentState { start: 0, end: 99, done: 40 }];
    a.retry_at = Some(5);
    let mut b = job("b", JobState::Paused, &dest_missing);
    b.segments = vec![SegmentState { start: 0, end: 99, done: 40 }];
    let mut c = job("c", JobState::Completed, &dest_ok);
    c.post = PostStage::Extract;
    let d = job("d", JobState::Failed("x".into()), &dest_ok);

    let mut jobs = vec![a, b, c, d];
    let rerun = recover(&mut jobs);

    assert_eq!(jobs[0].state, JobState::Pending);
    assert_eq!(jobs[0].retry_at, None);
    assert_eq!(jobs[0].segments.len(), 1, "part file intact → keep progress");
    assert_eq!(jobs[1].state, JobState::Paused);
    assert!(jobs[1].segments.is_empty(), "part missing → restart from 0");
    assert_eq!(rerun, vec!["c".to_string()]);
    assert_eq!(jobs[3].state, JobState::Failed("x".into()));
}
```
Add `pub mod store_tests;` to `engine/tests/mod.rs` (pub so later test modules can reuse `job()`), and `pub mod store;` to `engine/mod.rs`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::store_tests`
Expected: FAIL — module `store` not found.

- [ ] **Step 3: Implement `engine/store.rs`**

```rust
//! `downloads.json` persistence. Atomic writes: unique temp file → fsync → rename.
use super::types::{now_ms, Job, JobKind, JobState, PostStage};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const HISTORY_CAP: usize = 500;
const FILE_NAME: &str = "downloads.json";
const VERSION: u32 = 1;

#[derive(Deserialize)]
struct StoreFile {
    version: u32,
    jobs: Vec<Job>,
}

#[derive(Serialize)]
struct StoreFileRef<'a> {
    version: u32,
    jobs: &'a [Job],
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join(FILE_NAME) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Vec<Job> {
        let bytes = match std::fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(e) => {
                log::warn!("Failed to read {}: {}", self.path.display(), e);
                return Vec::new();
            }
        };
        match serde_json::from_slice::<StoreFile>(&bytes) {
            Ok(f) if f.version == VERSION => f.jobs,
            Ok(f) => {
                self.quarantine(&format!("unsupported version {}", f.version));
                Vec::new()
            }
            Err(e) => {
                self.quarantine(&e.to_string());
                Vec::new()
            }
        }
    }

    fn quarantine(&self, why: &str) {
        let dest = self.path.with_file_name(format!("{}.corrupt-{}", FILE_NAME, now_ms()));
        log::warn!("{} is unreadable ({}); moving it to {}", self.path.display(), why, dest.display());
        let _ = std::fs::rename(&self.path, dest);
    }

    pub fn save(&self, jobs: &[Job]) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_vec_pretty(&StoreFileRef { version: VERSION, jobs })
            .map_err(std::io::Error::other)?;
        let tmp = self.path.with_file_name(format!("{}.{}.tmp", FILE_NAME, uuid::Uuid::new_v4().simple()));
        {
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(&data)?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &self.path)
    }
}

/// Keep every unfinished job plus the newest `HISTORY_CAP` finished ones. Preserves order.
pub fn prune_history(jobs: &mut Vec<Job>) {
    let mut terminal: Vec<(i64, String)> = jobs
        .iter()
        .filter(|j| j.state.is_terminal())
        .map(|j| (j.updated_at, j.id.clone()))
        .collect();
    if terminal.len() <= HISTORY_CAP {
        return;
    }
    terminal.sort_by(|a, b| b.0.cmp(&a.0));
    let keep: std::collections::HashSet<String> = terminal.into_iter().take(HISTORY_CAP).map(|(_, id)| id).collect();
    jobs.retain(|j| !j.state.is_terminal() || keep.contains(&j.id));
}

/// Startup recovery (spec §4.4). Returns ids whose post-processing must re-run.
pub fn recover(jobs: &mut [Job]) -> Vec<String> {
    let mut rerun = Vec::new();
    for job in jobs.iter_mut() {
        if job.state == JobState::Downloading {
            job.state = JobState::Pending;
        }
        if job.state == JobState::Pending {
            job.retry_at = None;
        }
        if matches!(job.state, JobState::Pending | JobState::Paused)
            && job.kind == JobKind::Http
            && !job.segments.is_empty()
        {
            let part_len = std::fs::metadata(job.part_path()).map(|m| m.len()).ok();
            if part_len != Some(job.total_bytes.max(0) as u64) {
                job.segments.clear();
            }
        }
        if matches!(job.state, JobState::Completed | JobState::Extracting)
            && matches!(job.post, PostStage::Extract | PostStage::Organize)
        {
            rerun.push(job.id.clone());
        }
    }
    rerun
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::store_tests`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine
git commit -m "feat(engine): add atomic downloads.json store and startup recovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mock CDN and test support

**Files:**
- Create: `src-tauri/src/engine/tests/mock_server.rs`, `src-tauri/src/engine/tests/support.rs`
- Modify: `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Produces (test-only):
  - `mock_server::{MockServer, MockOpts, pattern}`; `MockServer::start(opts).await`, `MockServer::start_on(port, opts).await`, `.url()`, `.rotate() -> String`, `.data() -> Vec<u8>`, `.update(|&mut MockOpts|)`, `.set_data(Vec<u8>)`, `.requests()`, `.max_active()`, `.ranges() -> Vec<(u64, u64)>`; `free_port() -> u16`.
  - `support::{RecordingSink, FakeRefresher, NoRefresh, fast_transfer_cfg, read}`.

- [ ] **Step 1: Write `tests/mock_server.rs`**

```rust
//! Minimal range-capable HTTP file server with fault injection.
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use axum::body::Bytes;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const CHUNK: usize = 16 * 1024;

pub fn pattern(size: usize) -> Vec<u8> {
    (0..size).map(|i| ((i * 31 + 7) % 251) as u8).collect()
}

#[derive(Clone, Default)]
pub struct MockOpts {
    pub size: usize,
    /// Honor `Range` headers.
    pub ranges: bool,
    /// Honor `Range` only for the `bytes=0-0` probe (server "lies" afterwards).
    pub ranges_probe_only: bool,
    /// Omit Content-Length (chunked transfer).
    pub no_length: bool,
    /// Abort the body after this many bytes, for the first `drop_times` requests.
    pub drop_after: Option<usize>,
    pub drop_times: usize,
    /// Stop sending (hang) after this many bytes, for the first `stall_times` requests.
    pub stall_after: Option<usize>,
    pub stall_times: usize,
    /// Reply 429 when this many bodies are already streaming.
    pub conn_limit: Option<usize>,
    /// Reply with an HTML page instead of the file.
    pub html: bool,
    /// Sleep between 16 KiB chunks.
    pub chunk_delay: Option<Duration>,
    /// Serve these bytes instead of `pattern(size)`.
    pub data: Option<Vec<u8>>,
}

struct Inner {
    opts: MockOpts,
    data: Vec<u8>,
    token: String,
    requests: usize,
    active: usize,
    max_active: usize,
    ranges: Vec<(u64, u64)>,
    drops_done: usize,
    stalls_done: usize,
}

type Shared = Arc<Mutex<Inner>>;

struct ShutdownOnDrop(Mutex<Option<tokio::sync::oneshot::Sender<()>>>);
impl Drop for ShutdownOnDrop {
    fn drop(&mut self) {
        if let Some(tx) = self.0.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }
}

#[derive(Clone)]
pub struct MockServer {
    pub addr: SocketAddr,
    inner: Shared,
    _shutdown: Arc<ShutdownOnDrop>,
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

impl MockServer {
    pub async fn start(opts: MockOpts) -> Self {
        Self::start_on(0, opts).await
    }

    pub async fn start_on(port: u16, opts: MockOpts) -> Self {
        let data = opts.data.clone().unwrap_or_else(|| pattern(opts.size));
        let inner = Arc::new(Mutex::new(Inner {
            opts,
            data,
            token: "t0".into(),
            requests: 0,
            active: 0,
            max_active: 0,
            ranges: Vec::new(),
            drops_done: 0,
            stalls_done: 0,
        }));
        let app = Router::new().route("/file/{token}", get(handler)).with_state(inner.clone());
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = rx.await;
                })
                .await;
        });
        Self { addr, inner, _shutdown: Arc::new(ShutdownOnDrop(Mutex::new(Some(tx)))) }
    }

    pub fn url(&self) -> String {
        format!("http://{}/file/{}", self.addr, self.inner.lock().unwrap().token)
    }

    /// Expire every URL handed out so far; returns the new valid URL.
    pub fn rotate(&self) -> String {
        {
            let mut g = self.inner.lock().unwrap();
            let n = g.token.trim_start_matches('t').parse::<u32>().unwrap_or(0) + 1;
            g.token = format!("t{n}");
        }
        self.url()
    }

    pub fn data(&self) -> Vec<u8> {
        self.inner.lock().unwrap().data.clone()
    }
    pub fn set_data(&self, data: Vec<u8>) {
        self.inner.lock().unwrap().data = data;
    }
    pub fn update(&self, f: impl FnOnce(&mut MockOpts)) {
        f(&mut self.inner.lock().unwrap().opts);
    }
    pub fn requests(&self) -> usize {
        self.inner.lock().unwrap().requests
    }
    pub fn max_active(&self) -> usize {
        self.inner.lock().unwrap().max_active
    }
    pub fn ranges(&self) -> Vec<(u64, u64)> {
        self.inner.lock().unwrap().ranges.clone()
    }
}

struct ActiveGuard(Shared);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.lock().unwrap().active -= 1;
    }
}

fn parse_range(headers: &HeaderMap, total: usize) -> Option<(usize, usize)> {
    let v = headers.get(header::RANGE)?.to_str().ok()?;
    let spec = v.strip_prefix("bytes=")?;
    let (s, e) = spec.split_once('-')?;
    let start: usize = s.parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if e.is_empty() { total - 1 } else { e.parse::<usize>().ok()?.min(total - 1) };
    Some((start, end))
}

async fn handler(State(inner): State<Shared>, Path(token): Path<String>, headers: HeaderMap) -> Response {
    let mut g = inner.lock().unwrap();
    g.requests += 1;
    if token != g.token {
        return (StatusCode::FORBIDDEN, "expired").into_response();
    }
    if g.opts.html {
        return ([(header::CONTENT_TYPE, "text/html")], "<html>please log in</html>").into_response();
    }
    if let Some(limit) = g.opts.conn_limit {
        if g.active >= limit {
            return (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, "0")], "").into_response();
        }
    }
    let total = g.data.len();
    let wants_range = headers.contains_key(header::RANGE);
    let is_probe = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) == Some("bytes=0-0");
    let honor = g.opts.ranges || (g.opts.ranges_probe_only && is_probe);
    if honor && wants_range && total == 0 {
        return (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, "bytes */0")], "").into_response();
    }
    let range = if honor { parse_range(&headers, total) } else { None };
    let (start, end, status) = match range {
        Some((s, e)) => (s, e, StatusCode::PARTIAL_CONTENT),
        None => (0, total.saturating_sub(1), StatusCode::OK),
    };
    let body: Vec<u8> = if total == 0 { Vec::new() } else { g.data[start..=end].to_vec() };
    if status == StatusCode::PARTIAL_CONTENT {
        g.ranges.push((start as u64, end as u64));
    }
    let drop_after = if g.drops_done < g.opts.drop_times {
        g.drops_done += 1;
        g.opts.drop_after
    } else {
        None
    };
    let stall_after = if g.stalls_done < g.opts.stall_times {
        g.stalls_done += 1;
        g.opts.stall_after
    } else {
        None
    };
    let delay = g.opts.chunk_delay;
    let no_length = g.opts.no_length;
    let accept = if g.opts.ranges { "bytes" } else { "none" };
    g.active += 1;
    g.max_active = g.max_active.max(g.active);
    drop(g);

    let len = body.len();
    let guard = ActiveGuard(inner.clone());
    let stream = futures::stream::unfold(
        (body, 0usize, false, guard),
        move |(body, pos, finished, guard)| async move {
            if finished || pos >= body.len() {
                return None;
            }
            if let Some(d) = drop_after {
                if pos >= d {
                    return Some((Err(std::io::Error::other("dropped")), (body, pos, true, guard)));
                }
            }
            if let Some(s) = stall_after {
                if pos >= s {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                }
            }
            if let Some(d) = delay {
                tokio::time::sleep(d).await;
            }
            let mut end = (pos + CHUNK).min(body.len());
            for limit in [drop_after, stall_after].into_iter().flatten() {
                if pos < limit {
                    end = end.min(limit);
                }
            }
            let chunk = Bytes::copy_from_slice(&body[pos..end]);
            Some((Ok::<Bytes, std::io::Error>(chunk), (body, end, false, guard)))
        },
    );

    let mut resp = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ACCEPT_RANGES, accept);
    if !no_length {
        resp = resp.header(header::CONTENT_LENGTH, len);
    }
    if status == StatusCode::PARTIAL_CONTENT {
        resp = resp.header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, total));
    }
    resp.body(Body::from_stream(stream)).unwrap()
}
```

- [ ] **Step 2: Write `tests/support.rs`**

```rust
use crate::engine::events::{EngineEvent, EventSink};
use crate::engine::refresh::{LinkRefresher, RefreshError, RefreshedLink};
use crate::engine::transfer::TransferConfig;
use crate::engine::types::LinkSource;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct RecordingSink {
    pub events: Mutex<Vec<EngineEvent>>,
}
impl EventSink for RecordingSink {
    fn emit(&self, event: EngineEvent) {
        self.events.lock().unwrap().push(event);
    }
}
impl RecordingSink {
    pub fn batch_finished(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                EngineEvent::BatchFinished { batch_id } => Some(batch_id.clone()),
                _ => None,
            })
            .collect()
    }
    pub fn list_changed(&self) -> usize {
        self.events.lock().unwrap().iter().filter(|e| matches!(e, EngineEvent::ListChanged)).count()
    }
}

pub struct FakeRefresher {
    pub calls: AtomicUsize,
    f: Box<dyn Fn() -> Result<String, RefreshError> + Send + Sync>,
}
impl FakeRefresher {
    pub fn new(f: impl Fn() -> Result<String, RefreshError> + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { calls: AtomicUsize::new(0), f: Box::new(f) })
    }
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}
#[async_trait::async_trait]
impl LinkRefresher for FakeRefresher {
    async fn refresh(&self, _source: &LinkSource) -> Result<RefreshedLink, RefreshError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        (self.f)().map(|url| RefreshedLink { url })
    }
}

pub fn no_refresh() -> Arc<FakeRefresher> {
    FakeRefresher::new(|| Err(RefreshError::NotRefreshable))
}

/// Small sizes and short timeouts so tests run in milliseconds.
pub fn fast_transfer_cfg() -> TransferConfig {
    TransferConfig {
        segments_per_file: 4,
        min_segment: 64 * 1024,
        split_threshold: 128 * 1024,
        connect_timeout: Duration::from_secs(2),
        idle_timeout: Duration::from_millis(300),
        segment_retries: 5,
        retry_base: Duration::from_millis(10),
        checkpoint_bytes: 64 * 1024,
        checkpoint_interval: Duration::from_millis(50),
        progress_interval: Duration::from_millis(20),
    }
}

pub fn read(path: impl AsRef<std::path::Path>) -> Vec<u8> {
    std::fs::read(path).unwrap()
}
```
`support.rs` references `TransferConfig`, which Task 6 creates. To keep Task 4 compiling on its own, add a minimal `src-tauri/src/engine/transfer.rs` now containing only the struct and its `Default` (Task 6 appends the rest), and `pub mod transfer;` in `engine/mod.rs`:
```rust
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct TransferConfig {
    pub segments_per_file: u32,
    pub min_segment: u64,
    pub split_threshold: u64,
    pub connect_timeout: Duration,
    pub idle_timeout: Duration,
    pub segment_retries: u32,
    pub retry_base: Duration,
    pub checkpoint_bytes: u64,
    pub checkpoint_interval: Duration,
    pub progress_interval: Duration,
}

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            segments_per_file: 4,
            min_segment: 8 * 1024 * 1024,
            split_threshold: 16 * 1024 * 1024,
            connect_timeout: Duration::from_secs(15),
            idle_timeout: Duration::from_secs(30),
            segment_retries: 5,
            retry_base: Duration::from_secs(1),
            checkpoint_bytes: 8 * 1024 * 1024,
            checkpoint_interval: Duration::from_secs(2),
            progress_interval: Duration::from_millis(250),
        }
    }
}
```

- [ ] **Step 3: Write a sanity test for the mock itself**

Append to `engine/tests/mod.rs`:
```rust
pub mod mock_server;
pub mod support;
mod mock_tests;
```
Create `engine/tests/mock_tests.rs`:
```rust
use super::mock_server::*;

#[tokio::test]
async fn serves_ranges_and_expires_tokens() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let c = reqwest::Client::new();
    let r = c.get(s.url()).header("Range", "bytes=10-19").send().await.unwrap();
    assert_eq!(r.status(), 206);
    assert_eq!(r.headers()["content-range"], "bytes 10-19/100000");
    assert_eq!(r.bytes().await.unwrap().to_vec(), pattern(100_000)[10..20].to_vec());

    let old = s.url();
    let new = s.rotate();
    assert_eq!(c.get(old).send().await.unwrap().status(), 403);
    assert_eq!(c.get(new).send().await.unwrap().status(), 200);
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::mock_tests`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine
git commit -m "test(engine): add fault-injecting mock CDN and test support

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Segment worker

**Files:**
- Create: `src-tauri/src/engine/segment.rs`, `src-tauri/src/engine/tests/segment_tests.rs`
- Modify: `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Consumes: `Limiter` (Task 2).
- Produces:
  - `SegmentCtx { client: reqwest::Client, url: String, path: PathBuf, limiter: Arc<Limiter>, cancel: CancellationToken, use_range: bool, until_eof: bool, idle_timeout: Duration, checkpoint_bytes: u64, checkpoint_interval: Duration }`
  - `enum SegmentMsg { Bytes { index: usize, n: u64 }, Checkpoint { index: usize, done: u64 } }`
  - `enum SegmentError { Transient(String), Connect(String), DeadLink(String), ConnLimit { retry_after: Option<Duration> }, RangeIgnored, Disk(String), Cancelled }`
  - `async fn run_segment(ctx: &SegmentCtx, index: usize, start: u64, done: u64, end: Arc<AtomicU64>, tx: &mpsc::UnboundedSender<SegmentMsg>) -> Result<u64, SegmentError>` — returns final `done`.
  - helpers: `classify_reqwest(reqwest::Error) -> SegmentError`, `parse_retry_after(&HeaderMap) -> Option<Duration>`, `is_html(&HeaderMap) -> bool`, `content_range_start(&HeaderMap) -> Option<u64>`, `content_range_total(&HeaderMap) -> Option<u64>`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/segment_tests.rs`:
```rust
use super::mock_server::*;
use crate::engine::limiter::Limiter;
use crate::engine::segment::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn ctx(url: String, path: std::path::PathBuf) -> SegmentCtx {
    SegmentCtx {
        client: reqwest::Client::new(),
        url,
        path,
        limiter: Arc::new(Limiter::new(None)),
        cancel: CancellationToken::new(),
        use_range: true,
        until_eof: false,
        idle_timeout: Duration::from_millis(300),
        checkpoint_bytes: 64 * 1024,
        checkpoint_interval: Duration::from_millis(50),
    }
}

fn prealloc(dir: &tempfile::TempDir, size: u64) -> std::path::PathBuf {
    let p = dir.path().join("f.part");
    std::fs::File::create(&p).unwrap().set_len(size).unwrap();
    p
}

#[tokio::test]
async fn downloads_its_range() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 300_000);
    let (tx, _rx) = mpsc::unbounded_channel();
    let end = Arc::new(AtomicU64::new(199_999));
    let done = run_segment(&ctx(s.url(), p.clone()), 0, 100_000, 0, end, &tx).await.unwrap();
    assert_eq!(done, 100_000);
    assert_eq!(std::fs::read(&p).unwrap()[100_000..200_000], pattern(300_000)[100_000..200_000]);
}

#[tokio::test]
async fn resumes_from_done_offset() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 100_000);
    let (tx, _rx) = mpsc::unbounded_channel();
    let done = run_segment(&ctx(s.url(), p), 0, 0, 40_000, Arc::new(AtomicU64::new(99_999)), &tx).await.unwrap();
    assert_eq!(done, 100_000);
    assert_eq!(s.ranges(), vec![(40_000, 99_999)]);
}

#[tokio::test]
async fn stops_at_shrunk_end() {
    let s = MockServer::start(MockOpts {
        size: 1_000_000,
        ranges: true,
        chunk_delay: Some(Duration::from_millis(5)),
        ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 1_000_000);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let end = Arc::new(AtomicU64::new(999_999));
    let c = ctx(s.url(), p);
    let end2 = end.clone();
    let h = tokio::spawn(async move { run_segment(&c, 0, 0, 0, end2, &tx).await });
    rx.recv().await.unwrap(); // first bytes arrived
    end.store(99_999, Ordering::SeqCst);
    assert_eq!(h.await.unwrap().unwrap(), 100_000);
}

#[tokio::test]
async fn stall_is_transient() {
    let s = MockServer::start(MockOpts {
        size: 200_000, ranges: true, stall_after: Some(50_000), stall_times: 1, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 200_000);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), p), 0, 0, 0, Arc::new(AtomicU64::new(199_999)), &tx).await.unwrap_err();
    assert_eq!(err, SegmentError::Transient("connection stalled".into()));
    // The last message is a durable checkpoint of what was written.
    let mut last = None;
    while let Ok(m) = rx.try_recv() {
        last = Some(m);
    }
    assert!(matches!(last, Some(SegmentMsg::Checkpoint { done: 50_000, .. })));
}

#[tokio::test]
async fn expired_token_is_dead_link() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let old = s.url();
    s.rotate();
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(old, prealloc(&dir, 1000)), 0, 0, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert!(matches!(err, SegmentError::DeadLink(_)));
}

#[tokio::test]
async fn html_is_dead_link() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, html: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), prealloc(&dir, 1000)), 0, 0, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert!(matches!(err, SegmentError::DeadLink(_)));
}

#[tokio::test]
async fn too_many_connections_is_conn_limit() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, conn_limit: Some(0), ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), prealloc(&dir, 1000)), 0, 0, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert_eq!(err, SegmentError::ConnLimit { retry_after: Some(Duration::ZERO) });
}

#[tokio::test]
async fn ignored_range_is_detected() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: false, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    let err = run_segment(&ctx(s.url(), prealloc(&dir, 1000)), 0, 500, 0, Arc::new(AtomicU64::new(999)), &tx).await.unwrap_err();
    assert_eq!(err, SegmentError::RangeIgnored);
}

#[tokio::test]
async fn cancel_checkpoints_and_returns_cancelled() {
    let s = MockServer::start(MockOpts {
        size: 2_000_000, ranges: true, chunk_delay: Some(Duration::from_millis(5)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let p = prealloc(&dir, 2_000_000);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let c = ctx(s.url(), p.clone());
    let cancel = c.cancel.clone();
    let h = tokio::spawn(async move { run_segment(&c, 0, 0, 0, Arc::new(AtomicU64::new(1_999_999)), &tx).await });
    rx.recv().await.unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    cancel.cancel();
    assert_eq!(h.await.unwrap().unwrap_err(), SegmentError::Cancelled);
    let mut done = 0;
    while let Ok(m) = rx.try_recv() {
        if let SegmentMsg::Checkpoint { done: d, .. } = m {
            done = d;
        }
    }
    assert!(done > 0);
    let on_disk = std::fs::read(&p).unwrap();
    assert_eq!(on_disk[..done as usize], pattern(2_000_000)[..done as usize]);
}
```
Add `mod segment_tests;` to `engine/tests/mod.rs` and `pub mod segment;` to `engine/mod.rs`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::segment_tests`
Expected: FAIL — module `segment` not found.

- [ ] **Step 3: Implement `engine/segment.rs`**

```rust
//! One Range worker: stream → limiter → sequential writes at an offset → durable checkpoints.
use super::limiter::Limiter;
use futures::StreamExt;
use reqwest::header::{HeaderMap, CONTENT_RANGE, CONTENT_TYPE, RANGE, RETRY_AFTER};
use std::io::SeekFrom;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub struct SegmentCtx {
    pub client: reqwest::Client,
    pub url: String,
    pub path: PathBuf,
    pub limiter: Arc<Limiter>,
    pub cancel: CancellationToken,
    /// Send `Range` and require 206. False for servers without range support.
    pub use_range: bool,
    /// Size unknown: EOF means done instead of "closed early".
    pub until_eof: bool,
    pub idle_timeout: Duration,
    pub checkpoint_bytes: u64,
    pub checkpoint_interval: Duration,
}

#[derive(Debug)]
pub enum SegmentMsg {
    /// Bytes written (not yet durable). Used for live progress and speed.
    Bytes { index: usize, n: u64 },
    /// `done` bytes from the segment start are durable on disk.
    Checkpoint { index: usize, done: u64 },
}

#[derive(Debug, Clone, PartialEq)]
pub enum SegmentError {
    Transient(String),
    Connect(String),
    DeadLink(String),
    ConnLimit { retry_after: Option<Duration> },
    RangeIgnored,
    Disk(String),
    Cancelled,
}

fn disk(e: std::io::Error) -> SegmentError {
    SegmentError::Disk(e.to_string())
}

pub fn classify_reqwest(e: reqwest::Error) -> SegmentError {
    if e.is_connect() {
        SegmentError::Connect(e.to_string())
    } else {
        SegmentError::Transient(e.to_string())
    }
}

pub fn parse_retry_after(h: &HeaderMap) -> Option<Duration> {
    h.get(RETRY_AFTER)?.to_str().ok()?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

pub fn is_html(h: &HeaderMap) -> bool {
    h.get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start().to_ascii_lowercase().starts_with("text/html"))
        .unwrap_or(false)
}

/// `bytes 100-199/1000` → Some(100)
pub fn content_range_start(h: &HeaderMap) -> Option<u64> {
    let v = h.get(CONTENT_RANGE)?.to_str().ok()?;
    let rest = v.strip_prefix("bytes ")?;
    let (range, _) = rest.split_once('/')?;
    range.split_once('-')?.0.trim().parse().ok()
}

/// `bytes 0-0/1000` → Some(1000); `bytes */0` → Some(0); `bytes 0-0/*` → None
pub fn content_range_total(h: &HeaderMap) -> Option<u64> {
    let v = h.get(CONTENT_RANGE)?.to_str().ok()?;
    v.rsplit_once('/')?.1.trim().parse().ok()
}

/// Map a response status to an error class. Shared with `transfer::probe`.
pub fn status_error(status: u16, headers: &HeaderMap) -> Option<SegmentError> {
    match status {
        401 | 403 | 404 | 410 => Some(SegmentError::DeadLink(format!("HTTP {status}"))),
        429 | 503 => Some(SegmentError::ConnLimit { retry_after: parse_retry_after(headers) }),
        500..=599 => Some(SegmentError::Transient(format!("HTTP {status}"))),
        _ => None,
    }
}

fn check_response(resp: &reqwest::Response, use_range: bool, pos: u64) -> Result<(), SegmentError> {
    let status = resp.status().as_u16();
    if let Some(e) = status_error(status, resp.headers()) {
        return Err(e);
    }
    if is_html(resp.headers()) {
        return Err(SegmentError::DeadLink("server returned a web page instead of the file".into()));
    }
    if use_range {
        if status != 206 {
            return Err(SegmentError::RangeIgnored);
        }
        match content_range_start(resp.headers()) {
            Some(s) if s == pos => Ok(()),
            _ => Err(SegmentError::RangeIgnored),
        }
    } else if status == 200 {
        Ok(())
    } else {
        Err(SegmentError::Transient(format!("unexpected HTTP {status}")))
    }
}

async fn checkpoint(
    file: &mut File,
    index: usize,
    start: u64,
    pos: u64,
    tx: &mpsc::UnboundedSender<SegmentMsg>,
) -> Result<(), SegmentError> {
    file.flush().await.map_err(disk)?;
    file.sync_data().await.map_err(disk)?;
    let _ = tx.send(SegmentMsg::Checkpoint { index, done: pos - start });
    Ok(())
}

pub async fn run_segment(
    ctx: &SegmentCtx,
    index: usize,
    start: u64,
    done: u64,
    end: Arc<AtomicU64>,
    tx: &mpsc::UnboundedSender<SegmentMsg>,
) -> Result<u64, SegmentError> {
    let mut pos = start + done;
    let end_now = end.load(Ordering::SeqCst);
    if pos > end_now {
        return Ok(done);
    }

    let mut req = ctx.client.get(&ctx.url);
    if ctx.use_range {
        req = req.header(RANGE, format!("bytes={}-{}", pos, end_now));
    }
    let resp = tokio::select! {
        _ = ctx.cancel.cancelled() => return Err(SegmentError::Cancelled),
        r = tokio::time::timeout(ctx.idle_timeout, req.send()) => match r {
            Err(_) => return Err(SegmentError::Transient("request timed out".into())),
            Ok(r) => r.map_err(classify_reqwest)?,
        },
    };
    check_response(&resp, ctx.use_range, pos)?;

    let mut file = OpenOptions::new().write(true).open(&ctx.path).await.map_err(disk)?;
    file.seek(SeekFrom::Start(pos)).await.map_err(disk)?;

    let mut stream = resp.bytes_stream();
    let mut unsynced: u64 = 0;
    let mut last_sync = Instant::now();

    loop {
        let next = tokio::select! {
            _ = ctx.cancel.cancelled() => {
                checkpoint(&mut file, index, start, pos, tx).await?;
                return Err(SegmentError::Cancelled);
            }
            r = tokio::time::timeout(ctx.idle_timeout, stream.next()) => r,
        };
        let chunk = match next {
            Err(_) => {
                checkpoint(&mut file, index, start, pos, tx).await?;
                return Err(SegmentError::Transient("connection stalled".into()));
            }
            Ok(None) => break,
            Ok(Some(Err(e))) => {
                checkpoint(&mut file, index, start, pos, tx).await?;
                return Err(classify_reqwest(e));
            }
            Ok(Some(Ok(b))) => b,
        };

        let end_now = end.load(Ordering::SeqCst);
        if pos > end_now {
            break;
        }
        let take = ((end_now - pos + 1).min(chunk.len() as u64)) as usize;
        ctx.limiter.acquire(take).await;
        file.write_all(&chunk[..take]).await.map_err(disk)?;
        pos += take as u64;
        unsynced += take as u64;
        let _ = tx.send(SegmentMsg::Bytes { index, n: take as u64 });

        if unsynced >= ctx.checkpoint_bytes || last_sync.elapsed() >= ctx.checkpoint_interval {
            checkpoint(&mut file, index, start, pos, tx).await?;
            unsynced = 0;
            last_sync = Instant::now();
        }
        if pos > end.load(Ordering::SeqCst) {
            break;
        }
    }

    checkpoint(&mut file, index, start, pos, tx).await?;
    if !ctx.until_eof && pos <= end.load(Ordering::SeqCst) {
        return Err(SegmentError::Transient("connection closed early".into()));
    }
    Ok(pos - start)
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::segment_tests`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine
git commit -m "feat(engine): add range segment worker with durable checkpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Transfer — probe, plan, run, finalize

**Files:**
- Modify: `src-tauri/src/engine/transfer.rs` (append to the struct from Task 4)
- Create: `src-tauri/src/engine/tests/transfer_tests.rs`
- Modify: `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Consumes: `SegmentCtx`, `run_segment`, `SegmentMsg`, `SegmentError`, header helpers (Task 5); `Limiter` (Task 2); `LinkRefresher`, `RefreshError` (Task 1); `Job`, `SegmentState` (Task 1).
- Produces:
  - `TransferDeps { client: reqwest::Client, limiter: Arc<Limiter>, refresher: Arc<dyn LinkRefresher>, cfg: TransferConfig }` (Clone)
  - `enum TransferUpdate { Progress { downloaded: u64, speed: f64, segments_active: u32 }, Checkpoint { segments: Vec<SegmentState> }, Probed { total_bytes: i64, resumable: bool, segments: Vec<SegmentState>, size_resets: u32 }, Url(String), MaxSegments(u32) }`
  - `enum TransferOutcome { Finished, Stopped }`, `enum TransferError { Transient(String), Offline(String), Fatal(String) }`
  - `async fn run_transfer(job: Job, deps: TransferDeps, cancel: CancellationToken, tx: mpsc::UnboundedSender<TransferUpdate>) -> Result<TransferOutcome, TransferError>`
  - `fn plan_segments(total: u64, max: u32, min_segment: u64) -> Vec<SegmentState>`
  - `fn build_client(cfg: &TransferConfig) -> reqwest::Client`

- [ ] **Step 1: Write the failing tests (happy path + Review Focus 2–5)**

`engine/tests/transfer_tests.rs`:
```rust
use super::mock_server::*;
use super::store_tests::job;
use super::support::*;
use crate::engine::limiter::Limiter;
use crate::engine::transfer::*;
use crate::engine::types::*;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub fn deps(refresher: Arc<FakeRefresher>) -> TransferDeps {
    let cfg = fast_transfer_cfg();
    TransferDeps { client: build_client(&cfg), limiter: Arc::new(Limiter::new(None)), refresher, cfg }
}

pub fn http_job(dir: &tempfile::TempDir, name: &str, url: String, size: i64) -> Job {
    let mut j = job(name, JobState::Downloading, &dir.path().join(name).to_string_lossy());
    j.url = url;
    j.total_bytes = size;
    j
}

async fn run(job: Job, d: TransferDeps) -> (Result<TransferOutcome, TransferError>, Vec<TransferUpdate>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let r = run_transfer(job, d, CancellationToken::new(), tx).await;
    let mut ups = Vec::new();
    while let Ok(u) = rx.try_recv() {
        ups.push(u);
    }
    (r, ups)
}

#[test]
fn plan_respects_min_segment_and_max() {
    assert_eq!(plan_segments(100, 4, 1000), vec![SegmentState { start: 0, end: 99, done: 0 }]);
    let p = plan_segments(1000, 4, 100);
    assert_eq!(p.len(), 4);
    assert_eq!(p[0], SegmentState { start: 0, end: 249, done: 0 });
    assert_eq!(p[3].end, 999);
    let p = plan_segments(1001, 3, 100);
    assert_eq!(p.iter().map(|s| s.len()).sum::<u64>(), 1001);
}

#[tokio::test]
async fn segmented_download_matches_source() {
    let s = MockServer::start(MockOpts { size: 1_000_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 1_000_000);
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
    assert!(!j.part_path().exists());
    assert!(s.ranges().len() >= 4, "expected parallel ranges, got {:?}", s.ranges());
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { resumable: true, .. })));
}

#[tokio::test]
async fn no_range_server_downloads_single_stream() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: false, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 300_000);
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { resumable: false, .. })));
}

#[tokio::test]
async fn zero_byte_file_completes() {
    let s = MockServer::start(MockOpts { size: 0, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "empty.bin", s.url(), 0);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination).len(), 0);
}

#[tokio::test]
async fn unknown_size_streams_to_eof() {
    let s = MockServer::start(MockOpts { size: 200_000, ranges: false, no_length: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 0); // provider didn't know either
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn unicode_filename_downloads() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "Ünïcødé Movie (2024) [1080p].mkv", s.url(), 100_000);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

/// Run until the first checkpoint, stop, and return the job with persisted segments.
async fn run_then_stop(mut j: Job, d: TransferDeps) -> Job {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    let h = tokio::spawn(run_transfer(j.clone(), d, c2, tx));
    let mut last_segments = Vec::new();
    loop {
        match rx.recv().await {
            Some(TransferUpdate::Checkpoint { segments }) if segments.iter().any(|s| s.done > 0) => {
                last_segments = segments;
                cancel.cancel();
                break;
            }
            Some(TransferUpdate::Probed { total_bytes, resumable, .. }) => {
                j.total_bytes = total_bytes;
                j.resumable = resumable;
            }
            Some(_) => {}
            None => break,
        }
    }
    assert_eq!(h.await.unwrap(), Ok(TransferOutcome::Stopped));
    while let Ok(u) = rx.try_recv() {
        if let TransferUpdate::Checkpoint { segments } = u {
            last_segments = segments;
        }
    }
    j.segments = last_segments;
    j
}

#[tokio::test]
async fn resume_after_stop_does_not_refetch_prefix() {
    let s = MockServer::start(MockOpts {
        size: 2_000_000, ranges: true, chunk_delay: Some(Duration::from_millis(2)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = run_then_stop(http_job(&dir, "a.bin", s.url(), 2_000_000), deps(no_refresh())).await;
    assert!(j.part_path().exists(), "pause keeps the .part file");
    let resumed_from: Vec<u64> = j.segments.iter().filter(|s| !s.is_done()).map(|s| s.pos()).collect();
    s.update(|o| o.chunk_delay = None);
    let before = s.ranges().len();
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
    let second_run: Vec<u64> = s.ranges()[before..].iter().map(|r| r.0).collect();
    for pos in resumed_from {
        assert!(second_run.contains(&pos), "expected a request starting at {pos}, got {second_run:?}");
    }
}

#[tokio::test]
async fn part_deleted_while_paused_restarts() {
    let s = MockServer::start(MockOpts {
        size: 1_000_000, ranges: true, chunk_delay: Some(Duration::from_millis(2)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = run_then_stop(http_job(&dir, "a.bin", s.url(), 1_000_000), deps(no_refresh())).await;
    std::fs::remove_file(j.part_path()).unwrap();
    s.update(|o| o.chunk_delay = None);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn complete_part_finalizes_without_network() {
    let dir = tempfile::tempdir().unwrap();
    let mut j = http_job(&dir, "a.bin", "http://127.0.0.1:9/unreachable".into(), 1000);
    std::fs::write(j.part_path(), pattern(1000)).unwrap();
    j.segments = vec![SegmentState { start: 0, end: 999, done: 1000 }];
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), pattern(1000));
}
```
Add `pub mod transfer_tests;` to `engine/tests/mod.rs`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::transfer_tests`
Expected: FAIL — `run_transfer`, `TransferDeps`, `plan_segments`, `build_client` not found.

- [ ] **Step 3: Implement the transfer**

Append to `src-tauri/src/engine/transfer.rs` (keep the existing `TransferConfig` + `Default` at the top; add these `use` lines above it):
```rust
use super::limiter::Limiter;
use super::refresh::{LinkRefresher, RefreshError};
use super::segment::{
    classify_reqwest, content_range_total, is_html, run_segment, status_error, SegmentCtx, SegmentError, SegmentMsg,
};
use super::types::{Job, SegmentState};
use reqwest::header::RANGE;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
```
Then:
```rust
#[derive(Clone)]
pub struct TransferDeps {
    pub client: reqwest::Client,
    pub limiter: Arc<Limiter>,
    pub refresher: Arc<dyn LinkRefresher>,
    pub cfg: TransferConfig,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransferUpdate {
    Progress { downloaded: u64, speed: f64, segments_active: u32 },
    Checkpoint { segments: Vec<SegmentState> },
    Probed { total_bytes: i64, resumable: bool, segments: Vec<SegmentState>, size_resets: u32 },
    Url(String),
    MaxSegments(u32),
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransferOutcome {
    Finished,
    Stopped,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransferError {
    Transient(String),
    Offline(String),
    Fatal(String),
}

pub type UpdateTx = mpsc::UnboundedSender<TransferUpdate>;

pub fn build_client(cfg: &TransferConfig) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(cfg.connect_timeout)
        .build()
        .expect("reqwest client")
}

pub fn plan_segments(total: u64, max: u32, min_segment: u64) -> Vec<SegmentState> {
    if total == 0 {
        return Vec::new();
    }
    let by_size = total.div_ceil(min_segment.max(1));
    let n = (max.max(1) as u64).min(by_size).max(1);
    let base = total / n;
    let mut out = Vec::with_capacity(n as usize);
    let mut start = 0;
    for i in 0..n {
        let end = if i == n - 1 { total - 1 } else { start + base - 1 };
        out.push(SegmentState { start, end, done: 0 });
        start = end + 1;
    }
    out
}

pub struct Probe {
    pub total: Option<u64>,
    pub ranges: bool,
}

pub async fn probe(client: &reqwest::Client, url: &str, timeout: std::time::Duration) -> Result<Probe, SegmentError> {
    let resp = tokio::time::timeout(timeout, client.get(url).header(RANGE, "bytes=0-0").send())
        .await
        .map_err(|_| SegmentError::Transient("probe timed out".into()))?
        .map_err(classify_reqwest)?;
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    if let Some(e) = status_error(status, &headers) {
        return Err(e);
    }
    if is_html(&headers) {
        return Err(SegmentError::DeadLink("server returned a web page instead of the file".into()));
    }
    match status {
        206 => {
            let total = content_range_total(&headers);
            Ok(Probe { total, ranges: total.is_some() })
        }
        416 => Ok(Probe { total: Some(content_range_total(&headers).unwrap_or(0)), ranges: true }),
        200 => Ok(Probe { total: resp.content_length(), ranges: false }),
        other => Err(SegmentError::Transient(format!("unexpected HTTP {other}"))),
    }
}

fn map_probe_err(e: SegmentError) -> TransferError {
    match e {
        SegmentError::Connect(m) => TransferError::Offline(m),
        SegmentError::Disk(m) => TransferError::Fatal(format!("Disk error: {m}")),
        SegmentError::ConnLimit { .. } => TransferError::Transient("server is rate limiting".into()),
        SegmentError::Transient(m) => TransferError::Transient(m),
        other => TransferError::Transient(format!("{other:?}")),
    }
}

async fn part_len(path: &Path) -> Option<u64> {
    tokio::fs::metadata(path).await.ok().map(|m| m.len())
}

fn human(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB { format!("{:.1} GB", b / GB) } else { format!("{:.0} MB", b / MB) }
}

fn ensure_space(dest: &str, needed: u64) -> Result<(), TransferError> {
    let mut dir = Path::new(dest).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    while !dir.exists() {
        match dir.parent() {
            Some(p) => dir = p.to_path_buf(),
            None => return Ok(()),
        }
    }
    match fs4::available_space(&dir) {
        Ok(free) if free < needed => Err(TransferError::Fatal(format!(
            "Not enough disk space: needs {}, {} free",
            human(needed),
            human(free)
        ))),
        _ => Ok(()),
    }
}

async fn prepare_part(part: &Path, total: Option<u64>) -> Result<(), TransferError> {
    let fatal = |e: std::io::Error| TransferError::Fatal(format!("Disk error: {e}"));
    if let Some(parent) = part.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(fatal)?;
    }
    let f = tokio::fs::File::create(part).await.map_err(fatal)?;
    if let Some(t) = total {
        f.set_len(t).await.map_err(fatal)?;
    }
    Ok(())
}

async fn finalize(job: &Job) -> Result<(), TransferError> {
    let fatal = |e: std::io::Error| TransferError::Fatal(format!("Disk error: {e}"));
    let part = job.part_path();
    let dest = PathBuf::from(&job.destination);
    let f = tokio::fs::OpenOptions::new().write(true).open(&part).await.map_err(fatal)?;
    let len = f.metadata().await.map_err(fatal)?.len();
    if len != job.total_bytes.max(0) as u64 {
        return Err(TransferError::Transient(format!("size mismatch: {} of {} bytes", len, job.total_bytes)));
    }
    f.sync_all().await.map_err(fatal)?;
    drop(f);
    #[cfg(windows)]
    if dest.exists() {
        let _ = tokio::fs::remove_file(&dest).await;
    }
    tokio::fs::rename(&part, &dest).await.map_err(fatal)
}

async fn refresh_or_fail(job: &mut Job, deps: &TransferDeps, tx: &UpdateTx, refreshed: &mut bool, why: &str) -> Result<(), TransferError> {
    if *refreshed {
        return Err(TransferError::Fatal(format!("Link expired and couldn't be refreshed: {why}")));
    }
    *refreshed = true;
    match deps.refresher.refresh(&job.source).await {
        Ok(l) => {
            log::info!("Refreshed link for {} ({})", job.filename, job.id);
            job.url = l.url.clone();
            let _ = tx.send(TransferUpdate::Url(l.url));
            Ok(())
        }
        Err(RefreshError::ProviderMismatch(p)) => Err(TransferError::Fatal(format!("Switch back to {p} to resume"))),
        Err(e) => Err(TransferError::Fatal(format!("Link expired and couldn't be refreshed: {e}"))),
    }
}

pub async fn run_transfer(mut job: Job, deps: TransferDeps, cancel: CancellationToken, tx: UpdateTx) -> Result<TransferOutcome, TransferError> {
    let part = job.part_path();
    let mut refreshed = false;
    let mut range_fallback = false;
    loop {
        // Crash between the last write and the rename: just finalize.
        if !job.segments.is_empty()
            && job.segments.iter().all(|s| s.is_done())
            && part_len(&part).await == Some(job.total_bytes.max(0) as u64)
        {
            finalize(&job).await?;
            return Ok(TransferOutcome::Finished);
        }

        let p = match probe(&deps.client, &job.url, deps.cfg.idle_timeout).await {
            Ok(p) => p,
            Err(SegmentError::DeadLink(why)) => {
                refresh_or_fail(&mut job, &deps, &tx, &mut refreshed, &why).await?;
                continue;
            }
            Err(e) => {
                log::warn!("Probe failed for {} ({}): {:?}", job.filename, job.id, e);
                return Err(map_probe_err(e));
            }
        };
        if cancel.is_cancelled() {
            return Ok(TransferOutcome::Stopped);
        }

        let ranges = p.ranges && job.resumable;
        if let Some(t) = p.total {
            if !job.segments.is_empty() && job.total_bytes != t as i64 {
                if job.size_resets >= 1 {
                    return Err(TransferError::Fatal("The file changed on the server while downloading".into()));
                }
                log::warn!("{} changed size upstream ({} → {}), restarting", job.filename, job.total_bytes, t);
                job.size_resets += 1;
                job.segments.clear();
            }
            job.total_bytes = t as i64;
        }
        if !job.segments.is_empty() && part_len(&part).await != Some(job.total_bytes.max(0) as u64) {
            job.segments.clear(); // .part missing or truncated → start over
        }
        if !ranges {
            job.resumable = false;
            job.segments.clear(); // no Range support → always from 0
        }

        if job.segments.is_empty() {
            if p.total == Some(0) {
                prepare_part(&part, Some(0)).await?;
                job.total_bytes = 0;
                finalize(&job).await?;
                return Ok(TransferOutcome::Finished);
            }
            job.segments = match p.total {
                Some(t) if ranges => plan_segments(t, job.max_segments.min(deps.cfg.segments_per_file), deps.cfg.min_segment),
                Some(t) => vec![SegmentState { start: 0, end: t - 1, done: 0 }],
                None => vec![SegmentState { start: 0, end: u64::MAX - 1, done: 0 }],
            };
            if let Some(t) = p.total {
                ensure_space(&job.destination, t)?;
            }
            prepare_part(&part, p.total).await?;
        }
        let _ = tx.send(TransferUpdate::Probed {
            total_bytes: job.total_bytes,
            resumable: job.resumable,
            segments: job.segments.clone(),
            size_resets: job.size_resets,
        });

        match run_segments(&mut job, &deps, &cancel, &tx, ranges, p.total.is_none()).await {
            Ok(()) => {
                if p.total.is_none() {
                    job.total_bytes = job.downloaded() as i64;
                }
                finalize(&job).await?;
                return Ok(TransferOutcome::Finished);
            }
            Err(RunError::Stopped) => return Ok(TransferOutcome::Stopped),
            Err(RunError::DeadLink(why)) => {
                refresh_or_fail(&mut job, &deps, &tx, &mut refreshed, &why).await?;
            }
            Err(RunError::RangeIgnored) => {
                if range_fallback {
                    return Err(TransferError::Fatal("Server returned inconsistent byte ranges".into()));
                }
                log::warn!("{} ignored Range mid-download; falling back to a single stream", job.filename);
                range_fallback = true;
                job.resumable = false;
                job.segments.clear();
            }
            Err(RunError::Transient(m)) => return Err(TransferError::Transient(m)),
            Err(RunError::Offline(m)) => return Err(TransferError::Offline(m)),
            Err(RunError::Disk(m)) => return Err(TransferError::Fatal(format!("Disk error: {m}"))),
        }
    }
}

enum RunError {
    Stopped,
    DeadLink(String),
    RangeIgnored,
    Transient(String),
    Offline(String),
    Disk(String),
}

pub struct SpeedMeter {
    window: std::time::Duration,
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedMeter {
    pub fn new(window: std::time::Duration) -> Self {
        Self { window, samples: VecDeque::new() }
    }
    pub fn add(&mut self, n: u64) {
        self.samples.push_back((Instant::now(), n));
        self.trim();
    }
    fn trim(&mut self) {
        let Some(cutoff) = Instant::now().checked_sub(self.window) else { return };
        while matches!(self.samples.front(), Some((t, _)) if *t < cutoff) {
            self.samples.pop_front();
        }
    }
    pub fn rate(&mut self) -> f64 {
        self.trim();
        self.samples.iter().map(|(_, n)| *n).sum::<u64>() as f64 / self.window.as_secs_f64()
    }
}

type Workers = JoinSet<(usize, Result<u64, SegmentError>)>;

fn spawn_worker(
    set: &mut Workers,
    ctx: Arc<SegmentCtx>,
    i: usize,
    seg: SegmentState,
    end: Arc<AtomicU64>,
    tx: mpsc::UnboundedSender<SegmentMsg>,
    delay: Option<std::time::Duration>,
) {
    set.spawn(async move {
        if let Some(d) = delay {
            tokio::select! {
                _ = ctx.cancel.cancelled() => return (i, Err(SegmentError::Cancelled)),
                _ = tokio::time::sleep(d) => {}
            }
        }
        (i, run_segment(&ctx, i, seg.start, seg.done, end, &tx).await)
    });
}

/// Stop every worker, fold in their final durable progress.
async fn stop_workers(
    run_cancel: &CancellationToken,
    set: &mut Workers,
    seg_rx: &mut mpsc::UnboundedReceiver<SegmentMsg>,
    job: &mut Job,
    ends: &[Arc<AtomicU64>],
    tx: &UpdateTx,
) {
    run_cancel.cancel();
    while let Some(res) = set.join_next().await {
        if let Ok((i, Ok(done))) = res {
            job.segments[i].done = job.segments[i].done.max(done);
        }
    }
    while let Ok(msg) = seg_rx.try_recv() {
        if let SegmentMsg::Checkpoint { index, done } = msg {
            job.segments[index].done = job.segments[index].done.max(done);
        }
    }
    for (i, e) in ends.iter().enumerate() {
        job.segments[i].end = e.load(Ordering::SeqCst);
    }
    let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
}

async fn run_segments(
    job: &mut Job,
    deps: &TransferDeps,
    cancel: &CancellationToken,
    tx: &UpdateTx,
    use_range: bool,
    until_eof: bool,
) -> Result<(), RunError> {
    let cfg = &deps.cfg;
    let run_cancel = cancel.child_token();
    let ctx = Arc::new(SegmentCtx {
        client: deps.client.clone(),
        url: job.url.clone(),
        path: job.part_path(),
        limiter: deps.limiter.clone(),
        cancel: run_cancel.clone(),
        use_range,
        until_eof,
        idle_timeout: cfg.idle_timeout,
        checkpoint_bytes: cfg.checkpoint_bytes,
        checkpoint_interval: cfg.checkpoint_interval,
    });
    let (seg_tx, mut seg_rx) = mpsc::unbounded_channel::<SegmentMsg>();
    let mut ends: Vec<Arc<AtomicU64>> = job.segments.iter().map(|s| Arc::new(AtomicU64::new(s.end))).collect();
    let mut live: Vec<u64> = job.segments.iter().map(|s| s.done).collect();
    let mut pending: VecDeque<usize> = (0..job.segments.len()).filter(|&i| !job.segments[i].is_done()).collect();
    let mut delays: HashMap<usize, std::time::Duration> = HashMap::new();
    let mut retries: HashMap<usize, u32> = HashMap::new();
    let mut active: Vec<usize> = Vec::new();
    let mut cap = if use_range { job.max_segments.min(cfg.segments_per_file).max(1) as usize } else { 1 };
    let mut set: Workers = JoinSet::new();
    let mut speed = SpeedMeter::new(std::time::Duration::from_secs(3));
    let mut tick = tokio::time::interval(cfg.progress_interval);
    let mut not_before: Option<Instant> = None;

    loop {
        if not_before.is_some_and(|t| Instant::now() >= t) {
            not_before = None;
        }
        while active.len() < cap && not_before.is_none() {
            let Some(i) = pending.pop_front() else { break };
            if !use_range {
                job.segments[i].done = 0; // can't resume without Range
            }
            live[i] = job.segments[i].done;
            spawn_worker(&mut set, ctx.clone(), i, job.segments[i], ends[i].clone(), seg_tx.clone(), delays.remove(&i));
            active.push(i);
        }
        if active.is_empty() && pending.is_empty() {
            let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
            return Ok(());
        }

        let wake = not_before.unwrap_or_else(|| Instant::now() + std::time::Duration::from_secs(3600));
        tokio::select! {
            _ = cancel.cancelled() => {
                stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                return Err(RunError::Stopped);
            }
            Some(msg) = seg_rx.recv() => match msg {
                SegmentMsg::Bytes { index, n } => {
                    live[index] += n;
                    speed.add(n);
                }
                SegmentMsg::Checkpoint { index, done } => {
                    job.segments[index].done = job.segments[index].done.max(done);
                    job.segments[index].end = ends[index].load(Ordering::SeqCst);
                    let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
                }
            },
            Some(res) = set.join_next(), if !set.is_empty() => {
                let (i, r) = res.expect("segment task panicked");
                active.retain(|&a| a != i);
                match r {
                    Ok(done) => {
                        job.segments[i].done = done;
                        job.segments[i].end = ends[i].load(Ordering::SeqCst);
                        live[i] = done;
                        if use_range && pending.is_empty() {
                            try_split(job, &mut ends, &mut live, &mut pending, &active, cfg.split_threshold, tx);
                        }
                    }
                    Err(SegmentError::Cancelled) => {}
                    Err(e @ (SegmentError::Transient(_) | SegmentError::Connect(_))) => {
                        let n = retries.entry(i).or_insert(0);
                        *n += 1;
                        log::warn!("Segment {} of {} failed (attempt {}): {:?}", i, job.id, n, e);
                        if *n > cfg.segment_retries {
                            stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                            return Err(match e {
                                SegmentError::Connect(m) => RunError::Offline(m),
                                SegmentError::Transient(m) => RunError::Transient(m),
                                _ => unreachable!(),
                            });
                        }
                        delays.insert(i, cfg.retry_base * 2u32.pow(*n - 1));
                        pending.push_front(i);
                    }
                    Err(SegmentError::ConnLimit { retry_after }) => {
                        if cap > 1 {
                            cap = (cap / 2).max(1);
                            job.max_segments = cap as u32;
                            let _ = tx.send(TransferUpdate::MaxSegments(cap as u32));
                            log::warn!("{} is limiting connections; using {} segments", job.id, cap);
                        } else {
                            let n = retries.entry(i).or_insert(0);
                            *n += 1;
                            if *n > cfg.segment_retries {
                                stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                                return Err(RunError::Transient("server is rate limiting".into()));
                            }
                        }
                        not_before = Some(Instant::now() + retry_after.unwrap_or(std::time::Duration::from_secs(1)));
                        pending.push_front(i);
                    }
                    Err(SegmentError::DeadLink(w)) => {
                        stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                        return Err(RunError::DeadLink(w));
                    }
                    Err(SegmentError::RangeIgnored) => {
                        stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                        return Err(RunError::RangeIgnored);
                    }
                    Err(SegmentError::Disk(m)) => {
                        stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                        return Err(RunError::Disk(m));
                    }
                }
            }
            _ = tick.tick() => {
                let _ = tx.send(TransferUpdate::Progress {
                    downloaded: live.iter().sum(),
                    speed: speed.rate(),
                    segments_active: active.len() as u32,
                });
            }
            _ = tokio::time::sleep_until(wake), if not_before.is_some() => {}
        }
    }
}

/// Split the active segment with the most bytes left, so no connection idles at the tail.
fn try_split(
    job: &mut Job,
    ends: &mut Vec<Arc<AtomicU64>>,
    live: &mut Vec<u64>,
    pending: &mut VecDeque<usize>,
    active: &[usize],
    threshold: u64,
    tx: &UpdateTx,
) {
    let best = active
        .iter()
        .map(|&j| {
            let pos = job.segments[j].start + live[j];
            let end = ends[j].load(Ordering::SeqCst);
            (j, pos, end, (end + 1).saturating_sub(pos))
        })
        .filter(|&(_, _, _, rem)| rem > threshold)
        .max_by_key(|&(_, _, _, rem)| rem);
    let Some((j, pos, end, rem)) = best else { return };
    let mid = pos + rem / 2;
    ends[j].store(mid - 1, Ordering::SeqCst);
    job.segments[j].end = mid - 1;
    job.segments.push(SegmentState { start: mid, end, done: 0 });
    ends.push(Arc::new(AtomicU64::new(end)));
    live.push(0);
    pending.push_back(job.segments.len() - 1);
    let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
}
```
If `fs4::available_space` doesn't resolve for the pinned version, check the crate docs (context7 `fs4`) for the free-space function name — only that one call changes.

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::transfer_tests`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine
git commit -m "feat(engine): add segmented resumable transfer with probe and finalize

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Transfer resilience — retry, refresh, connection limit, range lies, size change, tail split

**Files:**
- Create: `src-tauri/src/engine/tests/transfer_resilience_tests.rs`
- Modify: `src-tauri/src/engine/tests/mod.rs` (and `transfer.rs` only if a test exposes a bug)

**Interfaces:**
- Consumes: everything from Task 6. This task adds no new API — it pins the error table (spec §6) with tests and fixes whatever they expose.

- [ ] **Step 1: Write the tests**

`engine/tests/transfer_resilience_tests.rs`:
```rust
use super::mock_server::*;
use super::support::*;
use super::transfer_tests::{deps, http_job};
use crate::engine::refresh::RefreshError;
use crate::engine::transfer::*;
use crate::engine::types::*;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

async fn run(job: Job, d: TransferDeps) -> (Result<TransferOutcome, TransferError>, Vec<TransferUpdate>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let r = run_transfer(job, d, CancellationToken::new(), tx).await;
    let mut ups = Vec::new();
    while let Ok(u) = rx.try_recv() {
        ups.push(u);
    }
    (r, ups)
}

#[tokio::test]
async fn stall_is_retried() {
    let s = MockServer::start(MockOpts {
        size: 500_000, ranges: true, stall_after: Some(20_000), stall_times: 1, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 500_000);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn dropped_connections_are_retried() {
    let s = MockServer::start(MockOpts {
        size: 500_000, ranges: true, drop_after: Some(30_000), drop_times: 3, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 500_000);
    let (r, _) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn exhausted_retries_are_transient() {
    let s = MockServer::start(MockOpts {
        size: 500_000, ranges: true, drop_after: Some(10), drop_times: 10_000, ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut d = deps(no_refresh());
    d.cfg.segment_retries = 2;
    let (r, _) = run(http_job(&dir, "a.bin", s.url(), 500_000), d).await;
    assert!(matches!(r, Err(TransferError::Transient(_))), "{r:?}");
}

#[tokio::test]
async fn expired_link_is_refreshed_once() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;
    let expired = s.url();
    s.rotate();
    let s2 = s.clone();
    let refresher = FakeRefresher::new(move || Ok(s2.url()));
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", expired, 300_000);
    let (r, ups) = run(j.clone(), deps(refresher.clone())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(refresher.calls(), 1);
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Url(_))));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn failed_refresh_is_fatal() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let expired = s.url();
    s.rotate();
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(http_job(&dir, "a.bin", expired, 1000), deps(no_refresh())).await;
    match r {
        Err(TransferError::Fatal(m)) => assert!(m.contains("couldn't be refreshed"), "{m}"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn provider_mismatch_message() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let expired = s.url();
    s.rotate();
    let refresher = FakeRefresher::new(|| Err(RefreshError::ProviderMismatch("Real-Debrid".into())));
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(http_job(&dir, "a.bin", expired, 1000), deps(refresher)).await;
    assert_eq!(r, Err(TransferError::Fatal("Switch back to Real-Debrid to resume".into())));
}

#[tokio::test]
async fn html_body_triggers_refresh() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, html: true, ..Default::default() }).await;
    let s2 = s.clone();
    let refresher = FakeRefresher::new(move || {
        s2.update(|o| o.html = false);
        Ok(s2.url())
    });
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(http_job(&dir, "a.bin", s.url(), 1000), deps(refresher.clone())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(refresher.calls(), 1);
}

#[tokio::test]
async fn connection_limit_halves_segments() {
    let s = MockServer::start(MockOpts {
        size: 1_000_000, ranges: true, conn_limit: Some(2), chunk_delay: Some(Duration::from_millis(1)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut d = deps(no_refresh());
    d.cfg.segments_per_file = 8;
    let j = http_job(&dir, "a.bin", s.url(), 1_000_000);
    let (r, ups) = run(j.clone(), d).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::MaxSegments(n) if *n <= 4)));
    assert!(s.max_active() <= 2);
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn ignored_range_mid_download_falls_back_to_single_stream() {
    let s = MockServer::start(MockOpts { size: 500_000, ranges_probe_only: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", s.url(), 500_000);
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { resumable: false, .. })));
    assert_eq!(read(&j.destination), s.data());
}

#[tokio::test]
async fn size_change_resets_once_then_fails() {
    let s = MockServer::start(MockOpts { size: 400_000, ranges: true, ..Default::default() }).await;
    let dir = tempfile::tempdir().unwrap();
    let mut j = http_job(&dir, "a.bin", s.url(), 300_000);
    std::fs::File::create(j.part_path()).unwrap().set_len(300_000).unwrap();
    j.segments = vec![SegmentState { start: 0, end: 299_999, done: 1000 }];
    let (r, ups) = run(j.clone(), deps(no_refresh())).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert!(ups.iter().any(|u| matches!(u, TransferUpdate::Probed { size_resets: 1, .. })));
    assert_eq!(read(&j.destination), s.data());

    let mut j2 = http_job(&dir, "b.bin", s.url(), 300_000);
    std::fs::File::create(j2.part_path()).unwrap().set_len(300_000).unwrap();
    j2.segments = vec![SegmentState { start: 0, end: 299_999, done: 1000 }];
    j2.size_resets = 1;
    let (r, _) = run(j2, deps(no_refresh())).await;
    assert!(matches!(r, Err(TransferError::Fatal(m)) if m.contains("changed")));
}

#[tokio::test]
async fn unreachable_host_is_offline() {
    let port = free_port();
    let dir = tempfile::tempdir().unwrap();
    let j = http_job(&dir, "a.bin", format!("http://127.0.0.1:{port}/file/t0"), 1000);
    let (r, _) = run(j, deps(no_refresh())).await;
    assert!(matches!(r, Err(TransferError::Offline(_))), "{r:?}");
}

#[tokio::test]
async fn tail_is_split_across_free_workers() {
    let size = 2_000_000usize;
    let s = MockServer::start(MockOpts {
        size, ranges: true, chunk_delay: Some(Duration::from_millis(2)), ..Default::default()
    })
    .await;
    let dir = tempfile::tempdir().unwrap();
    let mut j = http_job(&dir, "a.bin", s.url(), size as i64);
    std::fs::File::create(j.part_path()).unwrap().set_len(size as u64).unwrap();
    // One tiny segment and one huge one: the tiny one finishes first and should take half the tail.
    j.segments = vec![
        SegmentState { start: 0, end: 65_535, done: 0 },
        SegmentState { start: 65_536, end: size as u64 - 1, done: 0 },
    ];
    let mut d = deps(no_refresh());
    d.cfg.segments_per_file = 2;
    let (r, ups) = run(j.clone(), d).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    let max_segments = ups
        .iter()
        .filter_map(|u| match u {
            TransferUpdate::Checkpoint { segments } => Some(segments.len()),
            _ => None,
        })
        .max()
        .unwrap();
    assert!(max_segments > 2, "expected a split, max segments seen = {max_segments}");
    assert_eq!(read(&j.destination), s.data());
}
```
Add `mod transfer_resilience_tests;` to `engine/tests/mod.rs`.

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::transfer_resilience_tests`
Expected: all 12 pass. For any failure, use superpowers:systematic-debugging, fix `transfer.rs`/`segment.rs` (not the test's expectation — the tests encode spec §6), and re-run until green.

- [ ] **Step 3: Run the whole engine suite 5 times to flush out flakiness**

Run: `for i in 1 2 3 4 5; do cargo test --manifest-path src-tauri/Cargo.toml engine:: || break; done`
Expected: 5 clean runs. A test that fails intermittently is a race in the engine or an over-tight timing in the test — fix the race; only widen a timeout if the logic is proven correct.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/engine
git commit -m "test(engine): pin retry, refresh, connection-limit, and tail-split behavior

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Post-download pipeline

**Files:**
- Create: `src-tauri/src/engine/pipeline.rs`, `src-tauri/src/engine/tests/pipeline_tests.rs`
- Modify: `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Consumes: `Job`, `PostStage`, `PostConfig` (Task 1); `crate::extractor::{classify, archive_basename, extract, count_videos}`; `crate::organizer::{organize_path, move_file}`.
- Produces: `enum PipelineEvent { Extracting, Stage(PostStage) }`, `struct PostResult { destination: String, error: Option<String> }`, `async fn run_post(job: &Job, cfg: &PostConfig, events: &mpsc::UnboundedSender<PipelineEvent>) -> PostResult`, `async fn list_siblings(dir: &Path) -> Vec<PathBuf>`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/pipeline_tests.rs`:
```rust
use super::store_tests::job;
use crate::engine::pipeline::*;
use crate::engine::types::*;
use std::io::Write;
use tokio::sync::mpsc;

pub fn make_zip(path: &std::path::Path) {
    let f = std::fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    z.start_file("inner.txt", zip::write::SimpleFileOptions::default()).unwrap();
    z.write_all(b"hello").unwrap();
    z.finish().unwrap();
}

#[tokio::test]
async fn siblings_exclude_part_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.r00"), b"x").unwrap();
    std::fs::write(dir.path().join("a.r01.part"), b"x").unwrap();
    let names: Vec<String> = list_siblings(dir.path())
        .await
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
        .collect();
    assert_eq!(names, vec!["a.r00".to_string()]);
}

#[tokio::test]
async fn extracts_then_marks_done() {
    let dir = tempfile::tempdir().unwrap();
    let zip_path = dir.path().join("archive.zip");
    make_zip(&zip_path);
    let mut j = job("a", JobState::Completed, &zip_path.to_string_lossy());
    j.post = PostStage::Extract;
    let cfg = PostConfig { auto_extract: true, ..Default::default() };
    let (tx, mut rx) = mpsc::unbounded_channel();
    let res = run_post(&j, &cfg, &tx).await;
    assert_eq!(res.error, None);
    assert_eq!(std::fs::read(dir.path().join("archive").join("inner.txt")).unwrap(), b"hello");
    let mut evs = Vec::new();
    while let Ok(e) = rx.try_recv() {
        evs.push(e);
    }
    assert!(matches!(evs.first(), Some(PipelineEvent::Extracting)));
    assert!(matches!(evs.last(), Some(PipelineEvent::Stage(PostStage::Done))));
}

#[tokio::test]
async fn disabled_steps_just_finish() {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("movie.mkv");
    std::fs::write(&f, b"x").unwrap();
    let mut j = job("a", JobState::Completed, &f.to_string_lossy());
    j.post = PostStage::Extract;
    let (tx, _rx) = mpsc::unbounded_channel();
    let res = run_post(&j, &PostConfig::default(), &tx).await;
    assert_eq!(res.destination, j.destination);
    assert_eq!(res.error, None);
}
```
Add `pub mod pipeline_tests;` to `engine/tests/mod.rs` and `pub mod pipeline;` to `engine/mod.rs`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::pipeline_tests`
Expected: FAIL — module `pipeline` not found.

- [ ] **Step 3: Implement `engine/pipeline.rs`** (behavior ported from `commands/downloads.rs:292-402`)

```rust
//! Post-download steps: extract → organize. Media-server scans are the host's job (BatchFinished).
use super::types::{Job, PostConfig, PostStage};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;

#[derive(Debug, Clone, PartialEq)]
pub enum PipelineEvent {
    Extracting,
    Stage(PostStage),
}

#[derive(Debug, Clone, PartialEq)]
pub struct PostResult {
    pub destination: String,
    pub error: Option<String>,
}

const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "avi", "mov", "m4v", "webm"];

/// Files next to a download, excluding in-progress `.part` files.
pub async fn list_siblings(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = entries.next_entry().await {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("part") {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

pub async fn run_post(job: &Job, cfg: &PostConfig, events: &mpsc::UnboundedSender<PipelineEvent>) -> PostResult {
    let mut destination = job.destination.clone();
    let mut extracted: Option<PathBuf> = None;
    let mut stage = job.post;

    if stage == PostStage::Extract || stage == PostStage::None {
        if cfg.auto_extract {
            match extract_step(&job.destination, cfg, events).await {
                Ok(dir) => extracted = dir,
                Err(e) => return PostResult { destination, error: Some(e) },
            }
        }
        stage = PostStage::Organize;
        let _ = events.send(PipelineEvent::Stage(PostStage::Organize));
    }
    if stage == PostStage::Organize {
        if cfg.auto_organize {
            if let Some(d) = organize_step(&destination, extracted.as_deref(), &job.filename, cfg).await {
                destination = d;
            }
        }
        let _ = events.send(PipelineEvent::Stage(PostStage::Done));
    }
    PostResult { destination, error: None }
}

async fn extract_step(path: &str, cfg: &PostConfig, events: &mpsc::UnboundedSender<PipelineEvent>) -> Result<Option<PathBuf>, String> {
    let archive = PathBuf::from(path);
    let Some(parent) = archive.parent() else { return Ok(None) };
    let siblings = list_siblings(parent).await;
    let refs: Vec<&Path> = siblings.iter().map(|p| p.as_path()).collect();
    let Some(group) = crate::extractor::classify(&archive, &refs) else { return Ok(None) };
    let _ = events.send(PipelineEvent::Extracting);
    let dest = parent.join(crate::extractor::archive_basename(&group.primary));
    crate::extractor::extract(&group, &dest, cfg.rar_tool).await.map_err(|e| e.to_string())?;
    if cfg.delete_after_extract {
        for part in &group.all_parts {
            if let Err(e) = tokio::fs::remove_file(part).await {
                log::warn!("Failed to delete archive part {:?}: {}", part, e);
            }
        }
    }
    log::info!("Extracted: {:?} → {:?}", group.primary, dest);
    Ok(Some(dest))
}

async fn organize_step(destination: &str, extracted: Option<&Path>, filename: &str, cfg: &PostConfig) -> Option<String> {
    let (Some(mf), Some(tf)) = (&cfg.movies_folder, &cfg.tv_folder) else { return None };
    let src = match extracted {
        Some(dir) => {
            let n = crate::extractor::count_videos(dir);
            if n != 1 {
                log::info!("Extracted dir has {} videos — skipping organize", n);
                return None;
            }
            find_single_video(dir)?
        }
        None => PathBuf::from(destination),
    };
    let fname = src.file_name().and_then(|n| n.to_str()).unwrap_or(filename).to_string();
    let result = crate::organizer::organize_path(&fname, mf, tf, cfg.tmdb_api_key.as_deref()).await;
    match crate::organizer::move_file(&src, &result.dest_path).await {
        Ok(()) => {
            let d = result.dest_path.to_string_lossy().to_string();
            log::info!("Organized: {} → {}", filename, d);
            Some(d)
        }
        Err(e) => {
            log::warn!("Failed to organize {}: {}", filename, e);
            None
        }
    }
}

fn find_single_video(dir: &Path) -> Option<PathBuf> {
    let mut found: Option<PathBuf> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
                    if found.is_some() {
                        return None;
                    }
                    found = Some(path);
                }
            }
        }
    }
    found
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::pipeline_tests`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/engine
git commit -m "feat(engine): move extract/organize into engine pipeline, skip .part siblings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Actor, scheduler, and `Engine` handle

**Files:**
- Create: `src-tauri/src/engine/actor.rs`, `src-tauri/src/engine/tests/engine_tests.rs`
- Modify: `src-tauri/src/engine/mod.rs`, `src-tauri/src/engine/tests/mod.rs`

**Interfaces:**
- Consumes: all earlier engine modules.
- Produces (in `engine/mod.rs`):
  - `struct Timing { backoff_base, backoff_cap, max_attempts: u32, offline_retry, save_interval, emit_interval, shutdown_grace, tick }` with `Default` = 5 s, 300 s, 8, 30 s, 2 s, 100 ms, 2 s, 250 ms.
  - `struct EngineDeps { data_dir: PathBuf, config: EngineConfig, sink: Arc<dyn EventSink>, refresher: Arc<dyn LinkRefresher>, remote: Arc<dyn RemoteRunner>, transfer: TransferConfig, timing: Timing }` + `EngineDeps::new(data_dir, config, sink, refresher, remote)` (defaults for `transfer`/`timing`).
  - `#[derive(Clone)] struct Engine` with: `fn start(deps: EngineDeps) -> Engine` (call inside a Tokio runtime); `async fn enqueue(&self, jobs: Vec<NewJob>) -> Vec<String>`; `async fn add_completed(&self, job: NewJob) -> String`; `async fn list(&self) -> Vec<JobView>`; `fn pause(&self, id: &str)`, `fn resume`, `fn cancel`, `fn retry`, `fn remove`; `fn pause_all(&self)`, `fn resume_all`, `fn retry_failed`, `fn cancel_all`, `fn clear_inactive`; `fn set_config(&self, cfg: EngineConfig)`; `async fn shutdown(&self)`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/engine_tests.rs`:
```rust
use super::mock_server::*;
use super::pipeline_tests::make_zip;
use super::support::*;
use crate::engine::*;
use std::sync::Arc;
use std::time::Duration;

fn fast_timing() -> Timing {
    Timing {
        backoff_base: Duration::from_millis(20),
        backoff_cap: Duration::from_millis(100),
        max_attempts: 3,
        offline_retry: Duration::from_millis(100),
        save_interval: Duration::from_millis(50),
        emit_interval: Duration::from_millis(10),
        shutdown_grace: Duration::from_secs(1),
        tick: Duration::from_millis(20),
    }
}

struct Harness {
    engine: Engine,
    sink: Arc<RecordingSink>,
    data: tempfile::TempDir,
    out: tempfile::TempDir,
}

fn start(data: tempfile::TempDir, out: tempfile::TempDir, config: EngineConfig) -> Harness {
    let sink = Arc::new(RecordingSink::default());
    let engine = Engine::start(EngineDeps {
        data_dir: data.path().to_path_buf(),
        config,
        sink: sink.clone(),
        refresher: no_refresh(),
        remote: Arc::new(NoRemote),
        transfer: fast_transfer_cfg(),
        timing: fast_timing(),
    });
    Harness { engine, sink, data, out }
}

fn harness(config: EngineConfig) -> Harness {
    start(tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), config)
}

impl Harness {
    fn new_job(&self, name: &str, url: String, size: i64, batch: &str) -> NewJob {
        NewJob {
            kind: JobKind::Http,
            filename: name.into(),
            destination: self.out.path().join(name).to_string_lossy().to_string(),
            source: LinkSource::Direct,
            url,
            total_bytes: size,
            batch_id: batch.into(),
        }
    }

    async fn wait_until(&self, what: &str, f: impl Fn(&[JobView]) -> bool) -> Vec<JobView> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let list = self.engine.list().await;
            if f(&list) {
                return list;
            }
            if tokio::time::Instant::now() > deadline {
                panic!("timed out waiting for {what}: {list:#?}");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

fn all(state: JobState) -> impl Fn(&[JobView]) -> bool {
    move |l: &[JobView]| !l.is_empty() && l.iter().all(|j| j.status == state)
}

fn slow(size: usize) -> MockOpts {
    MockOpts { size, ranges: true, chunk_delay: Some(Duration::from_millis(3)), ..Default::default() }
}

#[tokio::test]
async fn enqueue_downloads_and_finishes_batch() {
    let s = MockServer::start(MockOpts { size: 300_000, ranges: true, ..Default::default() }).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 300_000, "b1"), h.new_job("b.bin", s.url(), 300_000, "b1")]).await;
    assert_eq!(ids.len(), 2);
    let list = h.wait_until("both complete", all(JobState::Completed)).await;
    for j in &list {
        assert_eq!(read(&j.destination), s.data());
        assert_eq!(j.downloaded_bytes, 300_000);
    }
    assert_eq!(h.sink.batch_finished(), vec!["b1".to_string()]);
    assert!(h.sink.list_changed() >= 1);
}

#[tokio::test]
async fn duplicate_destination_is_deduped() {
    let s = MockServer::start(slow(500_000)).await;
    let h = harness(EngineConfig::default());
    let a = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 500_000, "b1")]).await;
    let b = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 500_000, "b2")]).await;
    assert_eq!(a, b);
    assert_eq!(h.engine.list().await.len(), 1);
}

#[tokio::test]
async fn concurrency_limit_is_global_across_batches() {
    let s = MockServer::start(slow(300_000)).await;
    let h = harness(EngineConfig { max_concurrent: 2, ..Default::default() });
    h.engine.enqueue((0..3).map(|i| h.new_job(&format!("a{i}"), s.url(), 300_000, "A")).collect()).await;
    h.engine.enqueue((0..3).map(|i| h.new_job(&format!("b{i}"), s.url(), 300_000, "B")).collect()).await;
    let mut max_running = 0;
    loop {
        let list = h.engine.list().await;
        max_running = max_running.max(list.iter().filter(|j| j.status == JobState::Downloading).count());
        if list.iter().all(|j| j.status == JobState::Completed) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(max_running <= 2, "saw {max_running} concurrent downloads");
}

#[tokio::test]
async fn restart_resumes_from_checkpoint() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig::default());
    h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 2_000_000, "b1")]).await;
    h.wait_until("some progress", |l| l.iter().any(|j| j.downloaded_bytes > 200_000)).await;
    h.engine.shutdown().await;

    let saved = std::fs::read_to_string(h.data.path().join("downloads.json")).unwrap();
    assert!(saved.contains("\"Downloading\""), "job persisted as in-flight");

    s.update(|o| o.chunk_delay = None);
    let before = s.ranges().len();
    let h2 = start(h.data, h.out, EngineConfig::default());
    let list = h2.wait_until("resumed and completed", all(JobState::Completed)).await;
    assert_eq!(read(&list[0].destination), s.data());
    assert!(s.ranges()[before..].iter().any(|r| r.0 > 0), "second run resumed mid-file");
}

#[tokio::test]
async fn pause_resume_and_cancel() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 2_000_000, "b1"), h.new_job("c.bin", s.url(), 2_000_000, "b1")]).await;
    h.wait_until("downloading", |l| l.iter().all(|j| j.downloaded_bytes > 0)).await;

    h.engine.pause(&ids[0]);
    h.engine.cancel(&ids[1]);
    let list = h.wait_until("paused + cancelled", |l| {
        l.iter().any(|j| j.id == ids[0] && j.status == JobState::Paused)
            && l.iter().any(|j| j.id == ids[1] && j.status == JobState::Cancelled)
    })
    .await;
    let paused = list.iter().find(|j| j.id == ids[0]).unwrap();
    let cancelled = list.iter().find(|j| j.id == ids[1]).unwrap();
    assert!(std::path::Path::new(&format!("{}.part", paused.destination)).exists());
    assert!(!std::path::Path::new(&format!("{}.part", cancelled.destination)).exists());

    s.update(|o| o.chunk_delay = None);
    h.engine.resume(&ids[0]);
    let list = h.wait_until("resumed", |l| l.iter().any(|j| j.id == ids[0] && j.status == JobState::Completed)).await;
    assert_eq!(read(&list.iter().find(|j| j.id == ids[0]).unwrap().destination), s.data());
}

#[tokio::test]
async fn transient_failures_back_off_then_fail_then_retry_succeeds() {
    let s = MockServer::start(MockOpts {
        size: 200_000, ranges: true, drop_after: Some(10), drop_times: 100_000, ..Default::default()
    })
    .await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 200_000, "b1")]).await;
    let list = h.wait_until("failed", |l| matches!(l[0].status, JobState::Failed(_))).await;
    assert_eq!(list[0].attempt, 3);

    s.update(|o| o.drop_times = 0);
    h.engine.retry(&ids[0]);
    h.wait_until("completed after retry", all(JobState::Completed)).await;
}

#[tokio::test]
async fn offline_does_not_consume_attempts() {
    let port = free_port();
    let h = harness(EngineConfig::default());
    h.engine.enqueue(vec![h.new_job("a.bin", format!("http://127.0.0.1:{port}/file/t0"), 100_000, "b1")]).await;
    h.wait_until("waiting for network", |l| l[0].waiting_for_network).await;
    tokio::time::sleep(Duration::from_millis(400)).await; // several offline retries
    assert_eq!(h.engine.list().await[0].attempt, 0);

    let s = MockServer::start_on(port, MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let list = h.wait_until("completed once online", all(JobState::Completed)).await;
    assert_eq!(read(&list[0].destination), s.data());
}

#[tokio::test]
async fn raising_concurrency_applies_live() {
    let s = MockServer::start(slow(2_000_000)).await;
    let h = harness(EngineConfig { max_concurrent: 1, ..Default::default() });
    h.engine.enqueue((0..3).map(|i| h.new_job(&format!("a{i}"), s.url(), 2_000_000, "A")).collect()).await;
    h.wait_until("one running", |l| l.iter().filter(|j| j.status == JobState::Downloading).count() == 1).await;
    h.engine.set_config(EngineConfig { max_concurrent: 3, ..Default::default() });
    h.wait_until("three running", |l| l.iter().filter(|j| j.status == JobState::Downloading).count() == 3).await;
}

#[tokio::test]
async fn completed_downloads_are_extracted() {
    let zip_dir = tempfile::tempdir().unwrap();
    let zip_path = zip_dir.path().join("pack.zip");
    make_zip(&zip_path);
    let bytes = std::fs::read(&zip_path).unwrap();
    let s = MockServer::start(MockOpts { size: bytes.len(), ranges: true, data: Some(bytes.clone()), ..Default::default() }).await;
    let mut cfg = EngineConfig::default();
    cfg.post.auto_extract = true;
    let h = harness(cfg);
    h.engine.enqueue(vec![h.new_job("pack.zip", s.url(), bytes.len() as i64, "b1")]).await;
    h.wait_until("completed", all(JobState::Completed)).await;
    assert!(h.out.path().join("pack").join("inner.txt").exists());
}

#[tokio::test]
async fn remove_completed_keeps_the_file() {
    let s = MockServer::start(MockOpts { size: 1000, ranges: true, ..Default::default() }).await;
    let h = harness(EngineConfig::default());
    let ids = h.engine.enqueue(vec![h.new_job("a.bin", s.url(), 1000, "b1")]).await;
    let list = h.wait_until("completed", all(JobState::Completed)).await;
    h.engine.remove(&ids[0]);
    h.wait_until("removed", |l| l.is_empty()).await;
    assert!(std::path::Path::new(&list[0].destination).exists());
}
```
Add `mod engine_tests;` to `engine/tests/mod.rs`.

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::engine_tests`
Expected: FAIL — `Engine`, `EngineDeps`, `Timing` not found.

- [ ] **Step 3: Add `Engine`, `EngineDeps`, `Timing` to `engine/mod.rs`**

Add `pub mod actor;` to the module list, then append:
```rust
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

pub use transfer::TransferConfig;

#[derive(Debug, Clone)]
pub struct Timing {
    pub backoff_base: Duration,
    pub backoff_cap: Duration,
    pub max_attempts: u32,
    pub offline_retry: Duration,
    pub save_interval: Duration,
    pub emit_interval: Duration,
    pub shutdown_grace: Duration,
    pub tick: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            backoff_base: Duration::from_secs(5),
            backoff_cap: Duration::from_secs(300),
            max_attempts: 8,
            offline_retry: Duration::from_secs(30),
            save_interval: Duration::from_secs(2),
            emit_interval: Duration::from_millis(100),
            shutdown_grace: Duration::from_secs(2),
            tick: Duration::from_millis(250),
        }
    }
}

pub struct EngineDeps {
    pub data_dir: PathBuf,
    pub config: EngineConfig,
    pub sink: Arc<dyn EventSink>,
    pub refresher: Arc<dyn LinkRefresher>,
    pub remote: Arc<dyn RemoteRunner>,
    pub transfer: TransferConfig,
    pub timing: Timing,
}

impl EngineDeps {
    pub fn new(
        data_dir: PathBuf,
        config: EngineConfig,
        sink: Arc<dyn EventSink>,
        refresher: Arc<dyn LinkRefresher>,
        remote: Arc<dyn RemoteRunner>,
    ) -> Self {
        Self { data_dir, config, sink, refresher, remote, transfer: TransferConfig::default(), timing: Timing::default() }
    }
}

#[derive(Clone)]
pub struct Engine {
    tx: mpsc::UnboundedSender<actor::EngineMsg>,
}

impl Engine {
    /// Must be called from inside a Tokio runtime.
    pub fn start(deps: EngineDeps) -> Engine {
        let (tx, rx) = mpsc::unbounded_channel();
        actor::Actor::spawn(deps, tx.clone(), rx);
        Engine { tx }
    }

    pub async fn enqueue(&self, jobs: Vec<NewJob>) -> Vec<String> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(actor::EngineMsg::Enqueue { jobs, reply });
        rx.await.unwrap_or_default()
    }

    pub async fn add_completed(&self, job: NewJob) -> String {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(actor::EngineMsg::AddCompleted { job, reply });
        rx.await.unwrap_or_default()
    }

    pub async fn list(&self) -> Vec<JobView> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(actor::EngineMsg::List(reply));
        rx.await.unwrap_or_default()
    }

    fn control(&self, c: actor::Control) {
        let _ = self.tx.send(actor::EngineMsg::Control(c));
    }
    pub fn pause(&self, id: &str) { self.control(actor::Control::Pause(id.to_string())) }
    pub fn resume(&self, id: &str) { self.control(actor::Control::Resume(id.to_string())) }
    pub fn cancel(&self, id: &str) { self.control(actor::Control::Cancel(id.to_string())) }
    pub fn retry(&self, id: &str) { self.control(actor::Control::Retry(id.to_string())) }
    pub fn remove(&self, id: &str) { self.control(actor::Control::Remove(id.to_string())) }
    pub fn pause_all(&self) { self.control(actor::Control::PauseAll) }
    pub fn resume_all(&self) { self.control(actor::Control::ResumeAll) }
    pub fn retry_failed(&self) { self.control(actor::Control::RetryFailed) }
    pub fn cancel_all(&self) { self.control(actor::Control::CancelAll) }
    pub fn clear_inactive(&self) { self.control(actor::Control::ClearInactive) }

    pub fn set_config(&self, cfg: EngineConfig) {
        let _ = self.tx.send(actor::EngineMsg::SetConfig(cfg));
    }

    /// Checkpoint every running job and persist, waiting at most `Timing::shutdown_grace`.
    pub async fn shutdown(&self) {
        let (reply, rx) = oneshot::channel();
        if self.tx.send(actor::EngineMsg::Shutdown(reply)).is_ok() {
            let _ = rx.await;
        }
    }
}
```

- [ ] **Step 4: Implement `engine/actor.rs`**

```rust
//! The single owner of job state. Everything else talks to it through `EngineMsg`.
use super::events::{EngineEvent, EventSink, JobView};
use super::limiter::Limiter;
use super::pipeline::{run_post, PipelineEvent, PostResult};
use super::refresh::LinkRefresher;
use super::remote::{RemoteOutcome, RemoteRunner};
use super::store::{prune_history, recover, Store};
use super::transfer::{build_client, run_transfer, TransferConfig, TransferDeps, TransferError, TransferOutcome, TransferUpdate};
use super::types::*;
use super::{EngineDeps, Timing};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub enum Control {
    Pause(String),
    Resume(String),
    Cancel(String),
    Retry(String),
    Remove(String),
    PauseAll,
    ResumeAll,
    RetryFailed,
    CancelAll,
    ClearInactive,
}

pub enum EngineMsg {
    Enqueue { jobs: Vec<NewJob>, reply: oneshot::Sender<Vec<String>> },
    AddCompleted { job: NewJob, reply: oneshot::Sender<String> },
    List(oneshot::Sender<Vec<JobView>>),
    Control(Control),
    SetConfig(EngineConfig),
    Shutdown(oneshot::Sender<()>),
    ShutdownDeadline,
    Update { id: String, update: TransferUpdate },
    TransferDone { id: String, result: Result<TransferOutcome, TransferError> },
    RemoteDone { id: String, result: Result<RemoteOutcome, String> },
    Pipeline { id: String, event: PipelineEvent },
    PipelineDone { id: String, result: PostResult },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum StopReason {
    Pause,
    Cancel,
    Remove,
    Shutdown,
}

struct Running {
    cancel: CancellationToken,
    stop: Option<StopReason>,
    downloaded: u64,
    speed: f64,
    segments_active: u32,
    last_bytes_at: Instant,
}

struct SaveReq {
    jobs: Vec<Job>,
    ack: Option<oneshot::Sender<()>>,
}

pub struct Actor {
    jobs: Vec<Job>,
    running: HashMap<String, Running>,
    pipelines: HashSet<String>,
    offline: HashSet<String>,
    notified_batches: HashSet<String>,
    last_emit: HashMap<String, Instant>,
    config: EngineConfig,
    transfer_cfg: TransferConfig,
    timing: Timing,
    sink: Arc<dyn EventSink>,
    refresher: Arc<dyn LinkRefresher>,
    remote: Arc<dyn RemoteRunner>,
    client: reqwest::Client,
    limiter: Arc<Limiter>,
    tx: mpsc::UnboundedSender<EngineMsg>,
    saver: mpsc::UnboundedSender<SaveReq>,
    dirty: bool,
    last_save: Instant,
    shutting_down: Option<oneshot::Sender<()>>,
}

impl Actor {
    pub fn spawn(deps: EngineDeps, tx: mpsc::UnboundedSender<EngineMsg>, rx: mpsc::UnboundedReceiver<EngineMsg>) {
        let store = Arc::new(Store::new(&deps.data_dir));
        let jobs = store.load();
        let saver = spawn_saver(store);
        let mut transfer_cfg = deps.transfer;
        transfer_cfg.segments_per_file = deps.config.segments_per_file.clamp(1, 16);
        let actor = Actor {
            jobs,
            running: HashMap::new(),
            pipelines: HashSet::new(),
            offline: HashSet::new(),
            notified_batches: HashSet::new(),
            last_emit: HashMap::new(),
            limiter: Arc::new(Limiter::new(deps.config.speed_limit_bytes)),
            client: build_client(&transfer_cfg),
            config: deps.config,
            transfer_cfg,
            timing: deps.timing,
            sink: deps.sink,
            refresher: deps.refresher,
            remote: deps.remote,
            tx,
            saver,
            dirty: false,
            last_save: Instant::now(),
            shutting_down: None,
        };
        tokio::spawn(actor.run(rx));
    }

    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<EngineMsg>) {
        for id in recover(&mut self.jobs) {
            self.start_pipeline(&id);
        }
        self.dirty = true;
        self.schedule();
        let mut tick = tokio::time::interval(self.timing.tick);
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    let Some(msg) = msg else { break };
                    if self.handle(msg) {
                        break;
                    }
                }
                _ = tick.tick() => {
                    self.schedule();
                    self.save(false, None);
                }
            }
        }
    }

    /// Returns true when the actor should exit.
    fn handle(&mut self, msg: EngineMsg) -> bool {
        match msg {
            EngineMsg::Enqueue { jobs, reply } => {
                let ids = jobs.into_iter().map(|n| self.enqueue(n)).collect();
                let _ = reply.send(ids);
                self.sink.emit(EngineEvent::ListChanged);
                self.save(true, None);
                self.schedule();
            }
            EngineMsg::AddCompleted { job, reply } => {
                let now = now_ms();
                let mut j = Job::from_new(job, uuid::Uuid::new_v4().to_string(), now);
                j.state = JobState::Completed;
                j.post = PostStage::Done;
                let _ = reply.send(j.id.clone());
                self.jobs.push(j);
                self.sink.emit(EngineEvent::ListChanged);
                self.save(true, None);
            }
            EngineMsg::List(reply) => {
                let _ = reply.send(self.jobs.iter().map(|j| self.view(j)).collect());
            }
            EngineMsg::Control(c) => self.control(c),
            EngineMsg::SetConfig(cfg) => {
                let limiter = self.limiter.clone();
                let rate = cfg.speed_limit_bytes;
                tokio::spawn(async move { limiter.set_rate(rate).await });
                self.transfer_cfg.segments_per_file = cfg.segments_per_file.clamp(1, 16);
                self.config = cfg;
                self.schedule();
            }
            EngineMsg::Shutdown(reply) => {
                self.shutting_down = Some(reply);
                for r in self.running.values_mut() {
                    r.stop = Some(StopReason::Shutdown);
                    r.cancel.cancel();
                }
                if self.running.is_empty() {
                    return self.finish_shutdown();
                }
                let tx = self.tx.clone();
                let grace = self.timing.shutdown_grace;
                tokio::spawn(async move {
                    tokio::time::sleep(grace).await;
                    let _ = tx.send(EngineMsg::ShutdownDeadline);
                });
            }
            EngineMsg::ShutdownDeadline => return self.finish_shutdown(),
            EngineMsg::Update { id, update } => self.on_update(&id, update),
            EngineMsg::TransferDone { id, result } => {
                self.on_transfer_done(&id, result);
                if self.shutting_down.is_some() && self.running.is_empty() {
                    return self.finish_shutdown();
                }
            }
            EngineMsg::RemoteDone { id, result } => {
                self.on_remote_done(&id, result);
                if self.shutting_down.is_some() && self.running.is_empty() {
                    return self.finish_shutdown();
                }
            }
            EngineMsg::Pipeline { id, event } => {
                if let Some(job) = self.job_mut(&id) {
                    match event {
                        PipelineEvent::Extracting => job.state = JobState::Extracting,
                        PipelineEvent::Stage(s) => job.post = s,
                    }
                    job.updated_at = now_ms();
                    self.dirty = true;
                    self.emit(&id, true);
                }
            }
            EngineMsg::PipelineDone { id, result } => {
                self.pipelines.remove(&id);
                if let Some(job) = self.job_mut(&id) {
                    job.destination = result.destination;
                    job.post = PostStage::Done;
                    match result.error {
                        Some(e) => {
                            job.state = JobState::Failed(e.clone());
                            job.error = Some(e);
                        }
                        None => job.state = JobState::Completed,
                    }
                    job.updated_at = now_ms();
                    let batch = job.batch_id.clone();
                    self.emit(&id, true);
                    self.check_batch(&batch);
                    self.save(true, None);
                }
            }
        }
        false
    }

    fn finish_shutdown(&mut self) -> bool {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.save(true, Some(ack_tx));
        if let Some(reply) = self.shutting_down.take() {
            tokio::spawn(async move {
                let _ = ack_rx.await;
                let _ = reply.send(());
            });
        }
        true
    }

    fn job_mut(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    fn enqueue(&mut self, n: NewJob) -> String {
        if let Some(existing) = self.jobs.iter().find(|j| j.destination == n.destination && !j.state.is_terminal()) {
            return existing.id.clone();
        }
        let job = Job::from_new(n, uuid::Uuid::new_v4().to_string(), now_ms());
        let id = job.id.clone();
        self.jobs.push(job);
        id
    }

    fn view(&self, j: &Job) -> JobView {
        let r = self.running.get(&j.id);
        let downloaded = match (&j.state, r) {
            (_, Some(r)) => r.downloaded,
            (JobState::Completed | JobState::Extracting, None) => j.total_bytes.max(0) as u64,
            _ => j.downloaded(),
        };
        JobView {
            id: j.id.clone(),
            filename: j.filename.clone(),
            url: j.url.clone(),
            destination: j.destination.clone(),
            total_bytes: j.total_bytes,
            downloaded_bytes: downloaded as i64,
            speed: r.map(|r| r.speed).unwrap_or(0.0),
            status: j.state.clone(),
            remote: match &j.kind {
                JobKind::Remote { rclone_dest } => Some(rclone_dest.clone()),
                JobKind::Symlink => Some("symlink".into()),
                JobKind::Http => None,
            },
            attempt: j.attempt,
            retry_at: j.retry_at,
            segments_active: r.map(|r| r.segments_active).unwrap_or(0),
            resumable: j.resumable,
            error: j.error.clone(),
            waiting_for_network: self.offline.contains(&j.id),
        }
    }

    fn emit(&mut self, id: &str, force: bool) {
        let now = Instant::now();
        if !force {
            if let Some(t) = self.last_emit.get(id) {
                if now.duration_since(*t) < self.timing.emit_interval {
                    return;
                }
            }
        }
        if let Some(job) = self.jobs.iter().find(|j| j.id == id) {
            let v = self.view(job);
            self.last_emit.insert(id.to_string(), now);
            self.sink.emit(EngineEvent::Progress(v));
        }
    }

    fn save(&mut self, force: bool, ack: Option<oneshot::Sender<()>>) {
        if ack.is_none() && (!self.dirty || (!force && self.last_save.elapsed() < self.timing.save_interval)) {
            return;
        }
        prune_history(&mut self.jobs);
        let _ = self.saver.send(SaveReq { jobs: self.jobs.clone(), ack });
        self.dirty = false;
        self.last_save = Instant::now();
    }

    fn schedule(&mut self) {
        if self.shutting_down.is_some() {
            return;
        }
        let max = self.config.max_concurrent.max(1) as usize;
        let now = now_ms();
        while self.running.len() < max {
            let Some(idx) = self.jobs.iter().position(|j| {
                j.state == JobState::Pending && !self.running.contains_key(&j.id) && j.retry_at.is_none_or(|t| t <= now)
            }) else {
                break;
            };
            self.start_job(idx);
        }
    }

    fn start_job(&mut self, idx: usize) {
        let job = &mut self.jobs[idx];
        job.state = JobState::Downloading;
        job.retry_at = None;
        job.updated_at = now_ms();
        let id = job.id.clone();
        let emit_id = id.clone();
        let snapshot = job.clone();
        let kind = snapshot.kind.clone();
        let cancel = CancellationToken::new();
        self.running.insert(
            id.clone(),
            Running {
                cancel: cancel.clone(),
                stop: None,
                downloaded: snapshot.downloaded(),
                speed: 0.0,
                segments_active: 0,
                last_bytes_at: Instant::now(),
            },
        );
        let tx = self.tx.clone();
        match kind {
            JobKind::Http => {
                let deps = TransferDeps {
                    client: self.client.clone(),
                    limiter: self.limiter.clone(),
                    refresher: self.refresher.clone(),
                    cfg: self.transfer_cfg.clone(),
                };
                tokio::spawn(async move {
                    let (utx, mut urx) = mpsc::unbounded_channel();
                    let fut = run_transfer(snapshot, deps, cancel, utx);
                    tokio::pin!(fut);
                    let result = loop {
                        tokio::select! {
                            biased;
                            Some(update) = urx.recv() => { let _ = tx.send(EngineMsg::Update { id: id.clone(), update }); }
                            r = &mut fut => break r,
                        }
                    };
                    while let Ok(update) = urx.try_recv() {
                        let _ = tx.send(EngineMsg::Update { id: id.clone(), update });
                    }
                    let _ = tx.send(EngineMsg::TransferDone { id, result });
                });
            }
            JobKind::Remote { .. } => {
                let remote = self.remote.clone();
                let limit = self.config.speed_limit_bytes;
                tokio::spawn(async move {
                    let result = remote.run(snapshot, cancel, limit).await;
                    let _ = tx.send(EngineMsg::RemoteDone { id, result });
                });
            }
            JobKind::Symlink => {
                self.running.remove(&id);
                self.jobs[idx].state = JobState::Completed;
            }
        }
        self.dirty = true;
        self.emit(&emit_id, true);
    }

    fn on_update(&mut self, id: &str, update: TransferUpdate) {
        let mut force = false;
        match update {
            TransferUpdate::Progress { downloaded, speed, segments_active } => {
                if let Some(r) = self.running.get_mut(id) {
                    if downloaded > r.downloaded {
                        r.last_bytes_at = Instant::now();
                        self.offline.remove(id);
                    }
                    r.downloaded = downloaded;
                    r.speed = speed;
                    r.segments_active = segments_active;
                }
            }
            TransferUpdate::Checkpoint { segments } => {
                if let Some(j) = self.job_mut(id) {
                    j.segments = segments;
                }
                self.dirty = true;
            }
            TransferUpdate::Probed { total_bytes, resumable, segments, size_resets } => {
                if let Some(j) = self.job_mut(id) {
                    j.total_bytes = total_bytes;
                    j.resumable = resumable;
                    j.segments = segments;
                    j.size_resets = size_resets;
                }
                self.dirty = true;
                force = true;
            }
            TransferUpdate::Url(u) => {
                if let Some(j) = self.job_mut(id) {
                    j.url = u;
                }
                self.dirty = true;
            }
            TransferUpdate::MaxSegments(n) => {
                if let Some(j) = self.job_mut(id) {
                    j.max_segments = n;
                }
                self.dirty = true;
            }
        }
        self.emit(id, force);
    }

    fn delete_part(job: &Job) {
        let part = job.part_path();
        tokio::spawn(async move {
            let _ = tokio::fs::remove_file(part).await;
        });
    }

    fn backoff(&mut self, idx: usize, msg: String) {
        let t = self.timing.clone();
        let job = &mut self.jobs[idx];
        job.attempt += 1;
        log::warn!("Download {} failed (attempt {}/{}): {}", job.id, job.attempt, t.max_attempts, msg);
        if job.attempt >= t.max_attempts {
            job.state = JobState::Failed(msg.clone());
            job.error = Some(msg);
            return;
        }
        let delay = t.backoff_base.saturating_mul(3u32.saturating_pow(job.attempt - 1)).min(t.backoff_cap);
        job.state = JobState::Pending;
        job.retry_at = Some(now_ms() + delay.as_millis() as i64);
        job.error = Some(msg);
    }

    fn on_transfer_done(&mut self, id: &str, result: Result<TransferOutcome, TransferError>) {
        let stop = self.running.remove(id).and_then(|r| r.stop);
        let Some(idx) = self.jobs.iter().position(|j| j.id == id) else {
            self.schedule();
            return;
        };
        match (stop, result) {
            (Some(StopReason::Shutdown), _) => {} // stays Downloading → resumes next launch
            (Some(StopReason::Pause), _) => self.jobs[idx].state = JobState::Paused,
            (Some(StopReason::Cancel), _) => {
                Self::delete_part(&self.jobs[idx]);
                self.jobs[idx].segments.clear();
                self.jobs[idx].state = JobState::Cancelled;
            }
            (Some(StopReason::Remove), _) => {
                Self::delete_part(&self.jobs[idx]);
                self.jobs.remove(idx);
                self.offline.remove(id);
                self.sink.emit(EngineEvent::ListChanged);
                self.dirty = true;
                self.save(true, None);
                self.schedule();
                return;
            }
            (None, Ok(TransferOutcome::Finished)) => {
                self.offline.remove(id);
                let job = &mut self.jobs[idx];
                job.state = JobState::Completed;
                job.attempt = 0;
                job.error = None;
                job.post = PostStage::Extract;
                self.start_pipeline(id);
            }
            (None, Ok(TransferOutcome::Stopped)) => self.jobs[idx].state = JobState::Paused,
            (None, Err(TransferError::Fatal(m))) => {
                log::warn!("Download {} failed permanently: {}", id, m);
                self.jobs[idx].state = JobState::Failed(m.clone());
                self.jobs[idx].error = Some(m);
            }
            (None, Err(TransferError::Transient(m))) => self.backoff(idx, m),
            (None, Err(TransferError::Offline(m))) => {
                let idle = self.transfer_cfg.idle_timeout;
                let nobody_else_moving = self.running.values().all(|r| r.last_bytes_at.elapsed() > idle);
                if nobody_else_moving {
                    log::info!("Download {} waiting for network: {}", id, m);
                    self.offline.insert(id.to_string());
                    let job = &mut self.jobs[idx];
                    job.state = JobState::Pending;
                    job.retry_at = Some(now_ms() + self.timing.offline_retry.as_millis() as i64);
                    job.error = Some("Waiting for network".into());
                } else {
                    self.backoff(idx, m);
                }
            }
        }
        self.jobs[idx].updated_at = now_ms();
        let batch = self.jobs[idx].batch_id.clone();
        self.dirty = true;
        self.emit(id, true);
        self.check_batch(&batch);
        self.save(true, None);
        self.schedule();
    }

    fn on_remote_done(&mut self, id: &str, result: Result<RemoteOutcome, String>) {
        let stop = self.running.remove(id).and_then(|r| r.stop);
        let Some(idx) = self.jobs.iter().position(|j| j.id == id) else { return };
        match (stop, result) {
            (Some(StopReason::Shutdown), _) => {}
            (Some(StopReason::Remove), _) => {
                self.jobs.remove(idx);
                self.sink.emit(EngineEvent::ListChanged);
                self.save(true, None);
                self.schedule();
                return;
            }
            (Some(StopReason::Pause), _) => self.jobs[idx].state = JobState::Paused,
            (_, Ok(RemoteOutcome::Cancelled)) | (Some(StopReason::Cancel), _) => self.jobs[idx].state = JobState::Cancelled,
            (None, Ok(RemoteOutcome::Completed)) => {
                self.jobs[idx].state = JobState::Completed;
                self.jobs[idx].post = PostStage::Done;
            }
            (None, Err(m)) => {
                self.jobs[idx].state = JobState::Failed(m.clone());
                self.jobs[idx].error = Some(m);
            }
        }
        self.jobs[idx].updated_at = now_ms();
        let batch = self.jobs[idx].batch_id.clone();
        self.dirty = true;
        self.emit(id, true);
        self.check_batch(&batch);
        self.save(true, None);
        self.schedule();
    }

    fn start_pipeline(&mut self, id: &str) {
        let Some(job) = self.jobs.iter().find(|j| j.id == id).cloned() else { return };
        self.pipelines.insert(id.to_string());
        let cfg = self.config.post.clone();
        let tx = self.tx.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            let (etx, mut erx) = mpsc::unbounded_channel();
            let fut = run_post(&job, &cfg, &etx);
            tokio::pin!(fut);
            let result = loop {
                tokio::select! {
                    biased;
                    Some(event) = erx.recv() => { let _ = tx.send(EngineMsg::Pipeline { id: id.clone(), event }); }
                    r = &mut fut => break r,
                }
            };
            while let Ok(event) = erx.try_recv() {
                let _ = tx.send(EngineMsg::Pipeline { id: id.clone(), event });
            }
            let _ = tx.send(EngineMsg::PipelineDone { id, result });
        });
    }

    fn check_batch(&mut self, batch: &str) {
        if batch.is_empty() || self.notified_batches.contains(batch) {
            return;
        }
        let in_batch: Vec<&Job> = self.jobs.iter().filter(|j| j.batch_id == batch).collect();
        let settled = in_batch.iter().all(|j| {
            j.state.is_terminal() && !self.pipelines.contains(&j.id) && (j.state != JobState::Completed || j.post == PostStage::Done)
        });
        if !settled {
            return;
        }
        self.notified_batches.insert(batch.to_string());
        if in_batch.iter().any(|j| j.state == JobState::Completed) {
            self.sink.emit(EngineEvent::BatchFinished { batch_id: batch.to_string() });
        }
    }

    fn control(&mut self, c: Control) {
        match c {
            Control::Pause(id) => self.pause(&id),
            Control::Resume(id) => self.resume(&id),
            Control::Cancel(id) => self.cancel(&id),
            Control::Retry(id) => self.retry(&id),
            Control::Remove(id) => self.remove(&id),
            Control::PauseAll => {
                for id in self.ids_where(|j| matches!(j.state, JobState::Pending | JobState::Downloading)) {
                    self.pause(&id);
                }
            }
            Control::ResumeAll => {
                for id in self.ids_where(|j| j.state == JobState::Paused) {
                    self.resume(&id);
                }
            }
            Control::RetryFailed => {
                for id in self.ids_where(|j| matches!(j.state, JobState::Failed(_))) {
                    self.retry(&id);
                }
            }
            Control::CancelAll => {
                for id in self.ids_where(|j| matches!(j.state, JobState::Pending | JobState::Downloading | JobState::Paused)) {
                    self.cancel(&id);
                }
            }
            Control::ClearInactive => {
                for j in self.jobs.iter().filter(|j| matches!(j.state, JobState::Failed(_))) {
                    Self::delete_part(j);
                }
                self.jobs.retain(|j| {
                    matches!(j.state, JobState::Pending | JobState::Downloading | JobState::Paused | JobState::Extracting)
                });
                self.sink.emit(EngineEvent::ListChanged);
            }
        }
        self.dirty = true;
        self.save(true, None);
        self.schedule();
    }

    fn ids_where(&self, f: impl Fn(&Job) -> bool) -> Vec<String> {
        self.jobs.iter().filter(|j| f(j)).map(|j| j.id.clone()).collect()
    }

    fn stop_running(&mut self, id: &str, reason: StopReason) -> bool {
        if let Some(r) = self.running.get_mut(id) {
            r.stop = Some(reason);
            r.cancel.cancel();
            return true;
        }
        false
    }

    fn pause(&mut self, id: &str) {
        if self.stop_running(id, StopReason::Pause) {
            return;
        }
        if let Some(j) = self.job_mut(id) {
            if j.state == JobState::Pending {
                j.state = JobState::Paused;
                j.retry_at = None;
            }
        }
        self.offline.remove(id);
        self.emit(id, true);
    }

    fn resume(&mut self, id: &str) {
        if let Some(j) = self.job_mut(id) {
            if j.state == JobState::Paused {
                j.state = JobState::Pending;
                j.retry_at = None;
            }
        }
        self.emit(id, true);
    }

    fn cancel(&mut self, id: &str) {
        if self.stop_running(id, StopReason::Cancel) {
            return;
        }
        if let Some(j) = self.job_mut(id) {
            if matches!(j.state, JobState::Pending | JobState::Paused) {
                j.state = JobState::Cancelled;
                j.segments.clear();
                let snapshot = j.clone();
                Self::delete_part(&snapshot);
            }
        }
        self.offline.remove(id);
        self.emit(id, true);
    }

    fn retry(&mut self, id: &str) {
        if let Some(j) = self.job_mut(id) {
            if matches!(j.state, JobState::Failed(_) | JobState::Cancelled) || (j.state == JobState::Pending && j.retry_at.is_some()) {
                j.state = JobState::Pending;
                j.attempt = 0;
                j.error = None;
                j.retry_at = None;
                j.size_resets = 0;
            }
        }
        self.emit(id, true);
    }

    fn remove(&mut self, id: &str) {
        if self.stop_running(id, StopReason::Remove) {
            return;
        }
        if let Some(idx) = self.jobs.iter().position(|j| j.id == id) {
            let job = self.jobs.remove(idx);
            if job.state != JobState::Completed {
                Self::delete_part(&job); // never touch the finished file
            }
            self.offline.remove(id);
            self.sink.emit(EngineEvent::ListChanged);
        }
    }
}

/// Serializes saves so an older snapshot can never overwrite a newer one.
fn spawn_saver(store: Arc<Store>) -> mpsc::UnboundedSender<SaveReq> {
    let (tx, mut rx) = mpsc::unbounded_channel::<SaveReq>();
    tokio::spawn(async move {
        while let Some(mut req) = rx.recv().await {
            let mut acks = Vec::new();
            if let Some(a) = req.ack.take() {
                acks.push(a);
            }
            while let Ok(mut newer) = rx.try_recv() {
                if let Some(a) = newer.ack.take() {
                    acks.push(a);
                }
                req = newer;
            }
            let store = store.clone();
            let jobs = req.jobs;
            let res = tokio::task::spawn_blocking(move || store.save(&jobs)).await;
            if let Ok(Err(e)) = res {
                log::warn!("Failed to save downloads.json: {}", e);
            }
            for a in acks {
                let _ = a.send(());
            }
        }
    });
    tx
}
```
Note: `Option::is_none_or` needs Rust 1.82+; if the toolchain is older use `j.retry_at.map_or(true, |t| t <= now)`.

- [ ] **Step 5: Run the engine tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml engine::tests::engine_tests`
Expected: 10 passed. Then the full engine suite 5× as in Task 7 Step 3; all clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/engine
git commit -m "feat(engine): add actor with global scheduler, controls, backoff, and persistence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Providers fill `LinkSource` and implement `refresh_link`

**Files:**
- Modify: `src-tauri/src/providers/mod.rs:29-35`, `src-tauri/src/providers/real_debrid/client.rs:359-366,450-481`, `src-tauri/src/providers/torbox/client.rs:305-349`, `src-tauri/src/providers/premiumize/client.rs:317-370`
- Test: `src-tauri/src/engine/tests/types_tests.rs` (provider-id mapping already covered); new `src-tauri/src/providers/types.rs` unit test

**Interfaces:**
- Produces: `DebridProvider::refresh_link(&self, source: &LinkSource) -> Result<DownloadLink, ProviderError>`; every `DownloadLink` from `get_download_links` / `get_download_link_for_file` carries a non-`Direct` `source`.

- [ ] **Step 1: Add the trait method**

In `src-tauri/src/providers/mod.rs`, after `get_download_link_for_file`:
```rust
    /// Get a fresh direct URL for a file whose link expired.
    async fn refresh_link(&self, source: &LinkSource) -> Result<DownloadLink, ProviderError>;
```

- [ ] **Step 2: Real-Debrid**

Change `map_download_link` to carry the hoster link:
```rust
fn map_download_link(link: RdUnrestrictedLink, hoster_link: &str) -> shared::DownloadLink {
    shared::DownloadLink {
        filename: link.filename,
        filesize: link.filesize,
        download: link.download,
        streamable: link.streamable.map(|s| s == 1),
        source: shared::LinkSource::RealDebrid { hoster_link: hoster_link.to_string() },
    }
}
```
Update its two callers: `map_download_link(unrestricted, link)` in `get_download_links`, and `map_download_link(unrestricted, link)` in `get_download_link_for_file`. Add to the `impl DebridProvider for RdClient` block:
```rust
    async fn refresh_link(&self, source: &shared::LinkSource) -> Result<shared::DownloadLink, shared::ProviderError> {
        match source {
            shared::LinkSource::RealDebrid { hoster_link } => {
                let unrestricted = self.rd_unrestrict_link(hoster_link).await?;
                Ok(map_download_link(unrestricted, hoster_link))
            }
            _ => Err(shared::ProviderError::Other("Link belongs to a different provider".into())),
        }
    }
```

- [ ] **Step 3: TorBox**

In `get_download_link_for_file`, set `source: shared::LinkSource::TorBox { torrent_id: torrent_id.to_string(), file_id },` in the returned `DownloadLink` (replacing the `Direct` placeholder). Add:
```rust
    async fn refresh_link(&self, source: &shared::LinkSource) -> Result<shared::DownloadLink, shared::ProviderError> {
        match source {
            shared::LinkSource::TorBox { torrent_id, file_id } => self.get_download_link_for_file(torrent_id, *file_id).await,
            _ => Err(shared::ProviderError::Other("Link belongs to a different provider".into())),
        }
    }
```

- [ ] **Step 4: Premiumize**

In both `DownloadLink` literals inside `get_download_links`, set `source: shared::LinkSource::Premiumize { transfer_id: id.to_string(), filename: item.name.clone() },`. Add:
```rust
    async fn refresh_link(&self, source: &shared::LinkSource) -> Result<shared::DownloadLink, shared::ProviderError> {
        match source {
            shared::LinkSource::Premiumize { transfer_id, filename } => self
                .get_download_links(transfer_id)
                .await?
                .into_iter()
                .find(|l| &l.filename == filename)
                .ok_or_else(|| shared::ProviderError::Other("File is no longer in this transfer".into())),
            _ => Err(shared::ProviderError::Other("Link belongs to a different provider".into())),
        }
    }
```

- [ ] **Step 5: Build and run all tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: compiles; all tests pass. (Provider HTTP calls can't be unit-tested without live accounts; they are covered by the manual check in Task 13.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers
git commit -m "feat(providers): attach LinkSource to links and implement refresh_link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Tauri host — wire the engine into the app

**Files:**
- Create: `src-tauri/src/engine_host.rs`
- Modify: `src-tauri/src/state.rs`, `src-tauri/src/rclone.rs:1-2,84-242`, `src-tauri/src/commands/downloads.rs` (rewrite), `src-tauri/src/commands/settings.rs:22-30`, `src-tauri/src/commands/backup.rs:85-88`, `src-tauri/src/lib.rs`, `src-tauri/src/engine/mod.rs` (remove `#![allow(dead_code)]`)
- Delete: `src-tauri/src/downloader.rs`

**Interfaces:**
- Consumes: `Engine`, `EngineDeps`, `EngineConfig`, `PostConfig`, `NewJob`, `JobKind`, `JobView`, `EventSink`, `LinkRefresher`, `RemoteRunner` (Tasks 1–9); `DebridProvider::refresh_link` (Task 10).
- Produces: IPC commands `pause_download`, `resume_download`, `retry_download`, `pause_all_downloads`, `resume_all_downloads`, `retry_failed_downloads`; `get_download_tasks` now returns `Vec<JobView>`; events `download-progress` (JobView) and `downloads-changed`; `AppSettings.segments_per_file`.

- [ ] **Step 1: Write the failing unit tests for the pure host helpers**

At the bottom of `src-tauri/src/engine_host.rs` (created in Step 3) and of `commands/downloads.rs` (Step 5) there are `#[cfg(test)]` modules. Write them first:

`engine_host.rs` tests:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{LinkSource, RefreshError};

    #[test]
    fn provider_check() {
        let rd = LinkSource::RealDebrid { hoster_link: "x".into() };
        assert!(check_provider(&rd, "real-debrid").is_ok());
        assert!(matches!(check_provider(&rd, "torbox"), Err(RefreshError::ProviderMismatch(p)) if p == "Real-Debrid"));
        assert!(matches!(check_provider(&LinkSource::Direct, "torbox"), Err(RefreshError::NotRefreshable)));
    }
}
```
`commands/downloads.rs` tests:
```rust
#[cfg(test)]
mod tests {
    use super::build_destination;

    #[test]
    fn destinations() {
        assert_eq!(build_destination("/dl", false, true, Some("Show S01"), "e1.mkv"), std::path::PathBuf::from("/dl").join("Show S01").join("e1.mkv").to_string_lossy());
        assert_eq!(build_destination("/dl", false, false, Some("Show"), "a:b.mkv"), std::path::PathBuf::from("/dl").join("a_b.mkv").to_string_lossy());
        assert_eq!(build_destination("gdrive:Media/", true, true, Some("T"), "f.mkv"), "gdrive:Media/T/f.mkv");
        assert_eq!(build_destination("gdrive:Media", true, false, None, "f.mkv"), "gdrive:Media/f.mkv");
    }
}
```

- [ ] **Step 2: State and settings changes**

In `src-tauri/src/state.rs`:
1. Add to `AppSettings` (after `torbox_search_enabled`):
```rust
    #[serde(default = "default_segments")]
    pub segments_per_file: u32,
```
plus `fn default_segments() -> u32 { 4 }` next to `default_provider`, and `segments_per_file: default_segments(),` in `impl Default for AppSettings`.
2. Add:
```rust
impl AppSettings {
    pub fn engine_config(&self, rar_tool: crate::extractor::RarTool) -> crate::engine::EngineConfig {
        crate::engine::EngineConfig {
            max_concurrent: self.max_concurrent_downloads.max(1),
            segments_per_file: self.segments_per_file.clamp(1, 16),
            speed_limit_bytes: self.speed_limit_bytes,
            post: crate::engine::PostConfig {
                auto_extract: self.auto_extract_archives,
                delete_after_extract: self.delete_archives_after_extract,
                auto_organize: self.auto_organize,
                movies_folder: self.movies_folder.clone(),
                tv_folder: self.tv_folder.clone(),
                tmdb_api_key: self.tmdb_api_key.clone(),
                rar_tool,
            },
        }
    }
}
```
3. In `AppState`, remove `active_downloads` and `cancel_tokens` (fields and their initializers), add `pub engine: std::sync::OnceLock<crate::engine::Engine>,` initialized as `engine: std::sync::OnceLock::new(),`, and add to `impl AppState`:
```rust
    pub fn engine(&self) -> Result<crate::engine::Engine, String> {
        self.engine.get().cloned().ok_or_else(|| "Download engine is not running".to_string())
    }
```
Keep `DownloadTask` (rclone still uses it).

- [ ] **Step 3: Write `src-tauri/src/engine_host.rs`**

```rust
//! Tauri adapters for the engine's seams.
use crate::engine::{
    EngineEvent, EventSink, Job, LinkRefresher, LinkSource, RefreshError, RefreshedLink, RemoteOutcome, RemoteRunner,
};
use crate::state::{AppState, DownloadStatus, DownloadTask};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

pub struct TauriSink {
    app: AppHandle,
}
impl TauriSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriSink {
    fn emit(&self, event: EngineEvent) {
        match event {
            EngineEvent::Progress(view) => {
                let _ = self.app.emit("download-progress", &view);
            }
            EngineEvent::ListChanged => {
                let _ = self.app.emit("downloads-changed", ());
            }
            EngineEvent::BatchFinished { .. } => {
                let app = self.app.clone();
                tauri::async_runtime::spawn(async move {
                    let s = app.state::<AppState>().settings.read().await.clone();
                    crate::media_servers::trigger_scans(
                        &app,
                        s.plex_url.as_deref(),
                        s.plex_token.as_deref(),
                        s.jellyfin_url.as_deref(),
                        s.jellyfin_api_key.as_deref(),
                        s.emby_url.as_deref(),
                        s.emby_api_key.as_deref(),
                    )
                    .await;
                });
            }
        }
    }
}

fn provider_display_name(id: &str) -> String {
    match id {
        "real-debrid" => "Real-Debrid",
        "torbox" => "TorBox",
        "premiumize" => "Premiumize",
        other => other,
    }
    .to_string()
}

pub fn check_provider(source: &LinkSource, active: &str) -> Result<(), RefreshError> {
    match source.provider_id() {
        None => Err(RefreshError::NotRefreshable),
        Some(p) if p != active => Err(RefreshError::ProviderMismatch(provider_display_name(p))),
        Some(_) => Ok(()),
    }
}

pub struct ProviderRefresher {
    app: AppHandle,
}
impl ProviderRefresher {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl LinkRefresher for ProviderRefresher {
    async fn refresh(&self, source: &LinkSource) -> Result<RefreshedLink, RefreshError> {
        let state = self.app.state::<AppState>();
        let active = state.provider_id.read().await.clone();
        check_provider(source, &active)?;
        let provider = state.get_provider().await; // clones the Arc; no lock held across .await
        provider
            .refresh_link(source)
            .await
            .map(|l| RefreshedLink { url: l.download })
            .map_err(|e| RefreshError::Failed(e.to_string()))
    }
}

pub struct TauriRemoteRunner {
    app: AppHandle,
}
impl TauriRemoteRunner {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl RemoteRunner for TauriRemoteRunner {
    async fn run(&self, job: Job, cancel: CancellationToken, speed_limit: Option<u64>) -> Result<RemoteOutcome, String> {
        let (wtx, mut wrx) = tokio::sync::watch::channel(false);
        let bridge = tokio::spawn(async move {
            cancel.cancelled().await;
            let _ = wtx.send(true);
            // keep the sender alive until aborted so rclone's `changed()` doesn't spin
            std::future::pending::<()>().await;
        });
        let mut task = DownloadTask {
            id: job.id.clone(),
            filename: job.filename.clone(),
            url: job.url.clone(),
            destination: job.destination.clone(),
            total_bytes: job.total_bytes,
            downloaded_bytes: 0,
            speed: 0.0,
            status: DownloadStatus::Pending,
            remote: job.remote_dest().map(str::to_string),
        };
        let result = crate::rclone::download_to_rclone(self.app.clone(), &mut task, &mut wrx, speed_limit).await;
        bridge.abort();
        match result {
            Ok(()) if task.status == DownloadStatus::Cancelled => Ok(RemoteOutcome::Cancelled),
            Ok(()) => Ok(RemoteOutcome::Completed),
            Err(e) => Err(e),
        }
    }
}
```
(Append the test module from Step 1.)

- [ ] **Step 4: Move `emit_progress` into `rclone.rs` and delete `downloader.rs`**

In `src-tauri/src/rclone.rs`, replace `use crate::downloader::emit_progress;` with the struct and function copied verbatim from `downloader.rs:8-17` and `downloader.rs:124-135` (`DownloadProgress` and `emit_progress`), adding `use serde::Serialize;` and `use tauri::Emitter;` if missing. Then:
```bash
git rm src-tauri/src/downloader.rs
```
and remove `mod downloader;` from `lib.rs`.

- [ ] **Step 5: Rewrite `src-tauri/src/commands/downloads.rs`**

```rust
use crate::engine::{JobKind, JobView, NewJob};
use crate::providers::types::{DownloadItem, DownloadLink};
use crate::rclone;
use crate::state::{AppSettings, AppState};
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Get download links for a torrent
#[tauri::command]
pub async fn unrestrict_torrent_links(state: State<'_, AppState>, torrent_id: String) -> Result<Vec<DownloadLink>, String> {
    let provider = state.get_provider().await;
    provider.get_download_links(&torrent_id).await.map_err(|e| format!("{}", e))
}

/// Queue files for download
#[tauri::command]
pub async fn start_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    links: Vec<DownloadLink>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<Vec<String>, String> {
    let settings = state.settings.read().await.clone();
    let engine = state.engine()?;
    if settings.symlink_mode {
        return symlink_downloads(&app, &engine, &settings, &links, torrent_name.as_deref()).await;
    }
    let is_remote = rclone::is_rclone_path(&destination_folder);
    let batch_id = uuid::Uuid::new_v4().to_string();
    let jobs = links
        .iter()
        .map(|link| NewJob {
            kind: if is_remote { JobKind::Remote { rclone_dest: destination_folder.clone() } } else { JobKind::Http },
            filename: link.filename.clone(),
            destination: build_destination(
                &destination_folder,
                is_remote,
                settings.create_torrent_subfolders,
                torrent_name.as_deref(),
                &link.filename,
            ),
            source: link.source.clone(),
            url: link.download.clone(),
            total_bytes: link.filesize,
            batch_id: batch_id.clone(),
        })
        .collect();
    Ok(engine.enqueue(jobs).await)
}

pub(crate) fn build_destination(folder: &str, is_remote: bool, subfolders: bool, torrent_name: Option<&str>, filename: &str) -> String {
    let file = sanitize_filename(filename);
    if is_remote {
        // rclone paths: string concatenation, NOT PathBuf
        let base = folder.trim_end_matches('/');
        match (subfolders, torrent_name) {
            (true, Some(name)) => format!("{}/{}/{}", base, sanitize_filename(name), file),
            _ => format!("{}/{}", base, file),
        }
    } else {
        let mut p = PathBuf::from(folder);
        if let (true, Some(name)) = (subfolders, torrent_name) {
            p = p.join(sanitize_filename(name));
        }
        p.join(file).to_string_lossy().to_string()
    }
}
```
Then move the existing symlink block (old `downloads.rs` lines ~51-176) into:
```rust
async fn symlink_downloads(
    app: &AppHandle,
    engine: &crate::engine::Engine,
    settings: &AppSettings,
    links: &[DownloadLink],
    torrent_name: Option<&str>,
) -> Result<Vec<String>, String> {
```
keeping its logic unchanged except: (a) read `symlink_mount_path`, `symlink_library_path`, `auto_organize`, `movies_folder`, `tv_folder`, `tmdb_api_key`, `create_torrent_subfolders` and the media-server fields from `settings`; (b) replace the `DownloadTask` construction + `active_downloads` insert + `download-progress` emit with:
```rust
            let id = engine
                .add_completed(NewJob {
                    kind: JobKind::Symlink,
                    filename: link.filename.clone(),
                    destination: dest.to_string_lossy().to_string(),
                    source: link.source.clone(),
                    url: link.download.clone(),
                    total_bytes: link.filesize,
                    batch_id: String::new(),
                })
                .await;
            task_ids.push(id);
```
(c) keep the `trigger_scans` spawn at the end, using `app.clone()`.

Replace the remaining commands with:
```rust
#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.cancel(&id);
    Ok(())
}

#[tauri::command]
pub async fn cancel_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.cancel_all();
    Ok(())
}

#[tauri::command]
pub async fn get_download_tasks(state: State<'_, AppState>) -> Result<Vec<JobView>, String> {
    Ok(state.engine()?.list().await)
}

#[tauri::command]
pub async fn remove_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn clear_completed_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.clear_inactive();
    Ok(())
}

#[tauri::command]
pub async fn pause_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.pause(&id);
    Ok(())
}

#[tauri::command]
pub async fn resume_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.resume(&id);
    Ok(())
}

#[tauri::command]
pub async fn retry_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.retry(&id);
    Ok(())
}

#[tauri::command]
pub async fn pause_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.pause_all();
    Ok(())
}

#[tauri::command]
pub async fn resume_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.resume_all();
    Ok(())
}

#[tauri::command]
pub async fn retry_failed_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.retry_failed();
    Ok(())
}

#[tauri::command]
pub async fn get_download_history(state: State<'_, AppState>, page: Option<u32>, limit: Option<u32>) -> Result<Vec<DownloadItem>, String> {
    let provider = state.get_provider().await;
    provider.download_history(page.unwrap_or(1), limit.unwrap_or(100)).await.map_err(|e| format!("{}", e))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}
```
(Append the test module from Step 1. `find_single_video` now lives in `engine/pipeline.rs` — delete it here.)

- [ ] **Step 6: Push config changes to the engine**

In `commands/settings.rs` `update_settings`, replace the body with:
```rust
    save_app_settings(&app, &settings)?;
    let config = settings.engine_config(state.rar_tool);
    *state.settings.write().await = settings;
    if let Ok(engine) = state.engine() {
        engine.set_config(config);
    }
    Ok(())
```
In `commands/backup.rs` `import_settings`, inside the `if let Ok(settings) = ...` block, after `*state.settings.write().await = settings;` — first compute `let config = settings.engine_config(state.rar_tool);` *before* the move, then after the write add:
```rust
        if let Ok(engine) = state.engine() {
            engine.set_config(config);
        }
```

- [ ] **Step 7: Wire `lib.rs`**

1. Modules: remove `mod downloader;`, add `mod engine_host;` (after `mod engine;`).
2. At the end of `setup`, just before `Ok(())`, start the engine (the settings have been loaded above):
```rust
            // Start the download engine (after settings are loaded)
            {
                let state: tauri::State<'_, AppState> = app.state();
                let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
                let config = state.settings.blocking_read().engine_config(state.rar_tool);
                let handle = app.handle().clone();
                let engine = tauri::async_runtime::block_on(async move {
                    engine::Engine::start(engine::EngineDeps::new(
                        data_dir,
                        config,
                        std::sync::Arc::new(engine_host::TauriSink::new(handle.clone())),
                        std::sync::Arc::new(engine_host::ProviderRefresher::new(handle.clone())),
                        std::sync::Arc::new(engine_host::TauriRemoteRunner::new(handle)),
                    ))
                });
                let _ = state.engine.set(engine);
            }
```
3. Register the new commands in `generate_handler!` under `// Downloads`:
```rust
            commands::downloads::pause_download,
            commands::downloads::resume_download,
            commands::downloads::retry_download,
            commands::downloads::pause_all_downloads,
            commands::downloads::resume_all_downloads,
            commands::downloads::retry_failed_downloads,
```
4. Replace the final
```rust
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```
with
```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Tray "Quit" and OS shutdown both end here: checkpoint downloads so they resume next launch.
            if let tauri::RunEvent::Exit = event {
                if let Some(engine) = app.state::<AppState>().engine.get().cloned() {
                    tauri::async_runtime::block_on(engine.shutdown());
                }
            }
        });
```
5. Remove `#![allow(dead_code)]` from `engine/mod.rs`. Fix any genuine dead-code warnings it reveals (delete the unused item) rather than re-adding the allow.

- [ ] **Step 8: Build, lint, and test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: everything compiles; all tests pass (including the two new host tests).
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` (install with `rustup component add clippy` if missing)
Expected: no warnings in `engine/`, `engine_host.rs`, `commands/downloads.rs`. Pre-existing warnings elsewhere may be left alone — note them in the task report.

- [ ] **Step 9: Commit**

```bash
git add -A src-tauri
git commit -m "feat: route downloads through the new engine; add pause/resume/retry commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Frontend — types, API, hook, Downloads page, Settings

**Files:**
- Modify: `src/types/index.ts:84-119`, `src/api/downloads.ts`, `src/hooks/useDownloadTasks.tsx`, `src/pages/DownloadsPage.tsx`, `src/pages/SettingsPage.tsx:468-494`

**Interfaces:**
- Consumes: IPC commands and events from Task 11.
- Produces: `pauseDownload`, `resumeDownload`, `retryDownload`, `pauseAllDownloads`, `resumeAllDownloads`, `retryFailedDownloads` in `src/api/downloads.ts`.

- [ ] **Step 1: Types**

In `src/types/index.ts`, add above `DownloadLink`:
```ts
export type LinkSource =
  | { type: "RealDebrid"; hoster_link: string }
  | { type: "TorBox"; torrent_id: string; file_id: number }
  | { type: "Premiumize"; transfer_id: string; filename: string }
  | { type: "Direct" };
```
Add `source?: LinkSource;` to `DownloadLink`. Add these optional fields to **both** `DownloadTask` and `DownloadProgress`:
```ts
  attempt?: number;
  retry_at?: number | null;
  segments_active?: number;
  resumable?: boolean;
  error?: string | null;
  waiting_for_network?: boolean;
```
Add `segments_per_file?: number;` to `AppSettings`.

- [ ] **Step 2: API wrappers**

Append to `src/api/downloads.ts`:
```ts
export async function pauseDownload(id: string): Promise<void> {
  return invoke("pause_download", { id });
}

export async function resumeDownload(id: string): Promise<void> {
  return invoke("resume_download", { id });
}

export async function retryDownload(id: string): Promise<void> {
  return invoke("retry_download", { id });
}

export async function pauseAllDownloads(): Promise<void> {
  return invoke("pause_all_downloads");
}

export async function resumeAllDownloads(): Promise<void> {
  return invoke("resume_all_downloads");
}

export async function retryFailedDownloads(): Promise<void> {
  return invoke("retry_failed_downloads");
}
```

- [ ] **Step 3: Event-driven hook**

In `src/hooks/useDownloadTasks.tsx`, replace the "Poll for task list every 3 seconds" effect with:
```tsx
  // Fetch once, then refetch whenever the engine adds/removes jobs
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        setTasks(await downloadsApi.getDownloadTasks());
      } catch {
        // ignore
      }
    };
    fetchTasks();
    const unlisten = listen("downloads-changed", fetchTasks);
    return () => { unlisten.then((fn) => fn()); };
  }, []);
```
and replace the merge block with:
```tsx
  // Merge real-time progress into tasks (progress events carry the newest state)
  const mergedTasks = tasks.map((task) => {
    const p = progress.get(task.id);
    return p ? { ...task, ...p } : task;
  });
```

- [ ] **Step 4: Downloads page**

In `src/pages/DownloadsPage.tsx`:

1. Change the first import line to `import { useEffect, useState, useMemo, type ReactNode } from "react";`, then below `statusBadgeClass`, add:
```tsx
const MAX_ATTEMPTS = 8; // engine Timing::default().max_attempts

function isFailedStatus(status: DownloadTask["status"]): boolean {
  return typeof status === "object" && "Failed" in status;
}

function statusDetail(t: DownloadTask, now: number): string | null {
  if (t.waiting_for_network) return "Waiting for network";
  if (t.status === "Pending" && t.retry_at) {
    const s = Math.max(0, Math.ceil((t.retry_at - now) / 1000));
    return `Retrying in ${s}s · attempt ${t.attempt ?? 0}/${MAX_ATTEMPTS}`;
  }
  if (t.status === "Downloading" && t.resumable === false) return "Server doesn't support resume";
  if (t.status === "Downloading" && (t.segments_active ?? 0) > 1) return `${t.segments_active} connections`;
  return null;
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] cursor-pointer transition-colors"
      style={{ background: "var(--theme-selected)" }}
    >
      {children}
    </button>
  );
}

const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
);
const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
);
const RetryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
);
```
2. Inside the component, add a 1-second clock for the countdown:
```tsx
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
```
and handlers next to the existing ones:
```tsx
  const handlePause = (id: string) => downloadsApi.pauseDownload(id).catch(() => {});
  const handleResume = (id: string) => downloadsApi.resumeDownload(id).catch(() => {});
  const handleRetry = (id: string) => downloadsApi.retryDownload(id).catch(() => {});
```
3. In the `filename` column render, directly after the closing `</div>` of the `flex items-center gap-1.5` row, add:
```tsx
            {statusDetail(t, now) && (
              <div className="mt-1 text-[12px] text-[var(--theme-text-muted)]">{statusDetail(t, now)}</div>
            )}
```
4. Change the `actions` column to `width: "110px"` and its render to:
```tsx
      render: (t) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {(t.status === "Downloading" || t.status === "Pending") && (
            <IconButton title="Pause" onClick={() => handlePause(t.id)}><PauseIcon /></IconButton>
          )}
          {t.status === "Paused" && (
            <IconButton title="Resume" onClick={() => handleResume(t.id)}><PlayIcon /></IconButton>
          )}
          {(isFailedStatus(t.status) || t.status === "Cancelled") && (
            <IconButton title="Retry" onClick={() => handleRetry(t.id)}><RetryIcon /></IconButton>
          )}
          {isActive(t.status) || t.status === "Paused" ? (
            <button
              onClick={() => handleCancel(t.id)}
              className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#ef4444] cursor-pointer"
              style={{ background: "rgba(239,68,68,0.08)" }}
              title="Cancel"
            >
              ×
            </button>
          ) : (
            <button
              onClick={() => handleRemove(t.id)}
              className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#ef4444] cursor-pointer"
              style={{ background: "rgba(239,68,68,0.08)" }}
              title="Remove"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          )}
        </div>
      ),
```
(The two red buttons are the existing ones, unchanged; their hardcoded colors are left for the UI-redesign sub-project.)
5. In the toolbar `actions`, before "Clear Inactive", add:
```tsx
              {activeTasks.some((t) => t.status === "Downloading" || t.status === "Pending") && (
                <button onClick={() => downloadsApi.pauseAllDownloads().catch(() => {})}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
                  style={{ background: "var(--theme-selected)" }}>Pause All</button>
              )}
              {activeTasks.some((t) => t.status === "Paused") && (
                <button onClick={() => downloadsApi.resumeAllDownloads().catch(() => {})}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
                  style={{ background: "var(--theme-selected)" }}>Resume All</button>
              )}
              {activeTasks.some((t) => isFailedStatus(t.status)) && (
                <button onClick={() => downloadsApi.retryFailedDownloads().catch(() => {})}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
                  style={{ background: "var(--theme-selected)" }}>Retry Failed</button>
              )}
```
6. In the slide-over footer, before the existing Cancel button, add:
```tsx
                {(task.status === "Downloading" || task.status === "Pending") && (
                  <button onClick={() => handlePause(task.id)} className="py-3 px-5 rounded-[10px] text-[var(--theme-text-primary)] text-[14px] transition-colors" style={{ background: "var(--theme-selected)" }}>Pause</button>
                )}
                {task.status === "Paused" && (
                  <button onClick={() => handleResume(task.id)} className="py-3 px-5 rounded-[10px] text-[var(--theme-text-primary)] text-[14px] transition-colors" style={{ background: "var(--theme-selected)" }}>Resume</button>
                )}
                {(isFailed || isCancelled) && (
                  <button onClick={() => handleRetry(task.id)} className="py-3 px-5 rounded-[10px] text-[var(--theme-text-primary)] text-[14px] transition-colors" style={{ background: "var(--theme-selected)" }}>Retry</button>
                )}
```
and change the footer's Cancel condition from `{active && (` to `{(active || task.status === "Paused") && (`.

- [ ] **Step 5: Settings field**

In `src/pages/SettingsPage.tsx`, after the Speed Limit block (`</div>` closing the `mb-12` div around line 494), add:
```tsx
              {/* Connections per file */}
              <div className="mb-12">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] text-[var(--theme-text-primary)]">Connections per File</span>
                  {savedField === "segments_per_file" && (
                    <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                  )}
                </div>
                <select
                  value={settings.segments_per_file ?? 4}
                  onChange={async (e) => {
                    await applyChange({ segments_per_file: Number(e.target.value) });
                    markSaved("segments_per_file");
                  }}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] focus:outline-none transition-colors"
                >
                  {[1, 2, 4, 8, 16].map((n) => (
                    <option key={n} value={n}>
                      {n} connection{n !== 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[13px] text-[var(--theme-text-muted)] mt-2">
                  Parallel connections per file. Lower this if your provider limits connections.
                </p>
              </div>
```
If `markSaved`'s parameter is typed as a union of field names, add `"segments_per_file"` to that union.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Visual verification in the running app**

Run: `npm run tauri dev`. With a logged-in provider account, start a download of a multi-GB file and verify, with a screenshot of each state:
- the row shows "4 connections" while downloading;
- Pause → row shows the Resume (▶) button, speed `--`, status "Paused"; Resume continues from the same percentage;
- Pause All / Resume All buttons appear and work;
- Settings → Downloads shows "Connections per File"; changing it saves.
If you can't log in to a provider, say so explicitly in the report — don't claim the UI is verified.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(ui): add pause/resume/retry controls and connection setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: CI, docs, and end-to-end verification

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `AGENTS.md`, `README.md`

- [ ] **Step 1: Add a test workflow that runs on every push and PR**

`.github/workflows/test.yml`:
```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Linux dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: npm ci
      - name: TypeScript check
        run: npx tsc --noEmit
      - name: Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Update `AGENTS.md`**

- In the Commands table add a row: `| Rust tests (download engine) | cargo test --manifest-path src-tauri/Cargo.toml |`.
- Replace the paragraph starting "There is no test runner configured…" with: "Rust tests live in `src-tauri/src/engine/tests/` (mock CDN in `mock_server.rs`) and run in CI via `.github/workflows/test.yml`. There is no frontend test runner — verify UI changes manually in `npm run tauri dev`."
- Replace the `### Downloads` section body with: "`engine/` is the download engine (Tauri-free; see `specs/2026-09-23-resilient-download-engine-design.md`). One actor (`engine/actor.rs`) owns all jobs, persisted to `{app_data_dir}/downloads.json`. Transfers write `{dest}.part` with segmented `Range` requests and durable checkpoints, then rename. `engine_host.rs` adapts it to Tauri (events, provider link refresh, rclone). `commands/downloads.rs` is a thin IPC layer. Post-download extract/organize runs in `engine/pipeline.rs`; media-server scans fire on `BatchFinished`."

- [ ] **Step 3: Update `README.md`**

In the Features table, replace the `📥 Download Engine` row with:
```markdown
| 📥 | **Download Engine** | Segmented, resumable downloads that survive dropped connections, expired links, and restarts — with pause/resume and a global speed limit |
```

- [ ] **Step 4: Full verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npx tsc --noEmit && npm run build`
Expected: all pass.

Then the manual checklist from spec §10.2 in `npm run tauri dev`, recording the result of each:
1. Turn Wi-Fi off for 2 min mid-download → row shows "Waiting for network" → turn it on → resumes without user action.
2. Tray → Quit mid-download → relaunch → download resumes from its previous percentage.
3. Pause/resume a single download and all downloads; quit while paused → relaunch → still paused.
4. Queue two torrents with Max Concurrent = 3 → never more than 3 downloading.
5. Same 5 GB+ file, same provider: time it on v1.6.4 (installed release) vs this build. Record both numbers.
6. Enable auto-extract; download a multi-part RAR set → extracts once, after the last part, with no errors.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/test.yml AGENTS.md README.md
git commit -m "ci: run Rust engine tests on push/PR; document the new engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
