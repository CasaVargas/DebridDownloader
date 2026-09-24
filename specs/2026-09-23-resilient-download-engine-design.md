# Resilient Download Engine — Design

- **Status:** Draft for review
- **Date:** 2026-09-23
- **Scope:** Sub-project 1 of the "supercharge" roadmap (1. engine → 2. headless mode + qBittorrent-compatible API → optional extras). The UI redesign is a separate sub-project that follows this one.

## 1. Goal

Replace the thin single-stream downloader with an engine that survives dropped connections, stalls, expired debrid links, and app restarts — and is faster on large files — while staying free of Tauri types so a future headless build can reuse it unchanged.

### Success criteria

1. Killing the network mid-download for several minutes, then restoring it, resumes every job at (approximately) the same byte without user action and without consuming retry attempts.
2. Quitting the app mid-download (tray → Quit) and relaunching resumes every in-flight job from its checkpoint.
3. Pause/Resume works per job and globally; paused jobs survive restart as paused.
4. `max_concurrent_downloads` and `speed_limit_bytes` are enforced app-wide, across all batches, and changes apply immediately.
5. A single large file (5 GB+) downloads measurably faster than v1.6.4 on the same connection and provider, when the CDN supports ranges.
6. An expired link is refreshed from the provider automatically; the user never has to re-add a torrent to finish a download.
7. The engine has an automated test suite (`cargo test`) run in CI.

### Non-goals (v1)

- Integrity hashing beyond size checks.
- Scheduling, priority, reordering, time-of-day bandwidth rules.
- Resume for rclone remote downloads (they are queued/concurrency-limited only).
- Visual redesign (separate sub-project).
- Headless mode itself (sub-project 2) — only the seams for it.

## 2. Problems in the current implementation

| # | Problem | Location |
|---|---|---|
| 1 | No `Range` resume; writes directly to the final filename, so a partial file looks complete and auto-extract's sibling scan can pick up partial archive parts. | `src-tauri/src/downloader.rs` |
| 2 | Concurrency semaphore is created per `start_downloads` call, so two batches run 2× the configured limit. | `src-tauri/src/commands/downloads.rs` |
| 3 | New `reqwest::Client` per file with no connect or read timeout; a stalled connection hangs forever and holds its slot. | `downloader.rs` |
| 4 | Only the unrestricted URL is kept; nothing can re-resolve an expired link. | `state.rs` `DownloadTask`, `providers/types.rs` `DownloadLink` |
| 5 | `DownloadStatus::Paused` exists but nothing sets it. | `state.rs` |
| 6 | Queue is memory-only; restart loses everything. | `state.rs` |
| 7 | Speed limit is per file, so N concurrent files use N× the cap. | `downloader.rs` |
| 8 | Frontend polls `get_download_tasks` every 3 s despite progress being event-driven. | `src/hooks/useDownloadTasks.tsx` |

## 3. Architecture

Native Rust engine module with a Tauri-free core (chosen over bundling aria2c as a sidecar — per-platform binary/signing burden and weaker provider integration — and over patching `downloader.rs` in place — throwaway once headless arrives).

```
src-tauri/src/engine/
  mod.rs        Engine: cloneable handle (enqueue, pause, resume, cancel, retry, remove, list, shutdown)
  actor.rs      Single task owning all job state; receives EngineMsg over mpsc
  scheduler.rs  Global queue, concurrency permits (resizable), start/stop decisions
  transfer.rs   Runs one Http job: probe → plan → segments → finalize
  segment.rs    One Range worker: stream → limiter → positioned sequential writes → checkpoints
  limiter.rs    Global async token bucket (bytes/sec), shared by all segments of all jobs
  store.rs      downloads.json load/save (atomic temp + rename, throttled)
  pipeline.rs   Post-download: extract → organize (moved from commands/downloads.rs); batch media scan
  events.rs     EventSink trait + EngineEvent
  types.rs      Job, JobKind, JobState, SegmentState, LinkSource, PostStage, EngineConfig
  tests/        mock_server.rs + integration tests
```

### 3.1 Ownership and concurrency model

- **Actor:** one Tokio task owns the `Vec<Job>` / map. Commands and workers communicate with it only via `EngineMsg` on an `mpsc` channel; replies via `oneshot`. No shared `RwLock` over job state. This replaces `AppState.active_downloads` + `AppState.cancel_tokens`.
- **Scheduler:** holds `max_concurrent` permits. On any job leaving `Downloading` (complete, paused, failed, cancelled) the permit is released and the oldest `Pending` job starts. Changing the setting resizes the pool live (shrinking lets running jobs finish; no preemption).
- **Transfer:** spawned per running job with a `Job` snapshot, a job-level `CancellationToken`, the shared `reqwest::Client`, the `Limiter`, and a `LinkRefresher`. It reports progress/segment updates to the actor; it never touches global state.
- **Limiter:** one token bucket for the whole engine; `None` limit = pass-through. Rate changes apply live.

### 3.2 Seams (what keeps the engine Tauri-free)

```rust
trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
}

#[async_trait]
trait LinkRefresher: Send + Sync + 'static {
    async fn refresh(&self, source: &LinkSource) -> Result<RefreshedLink, RefreshError>;
}

struct EngineConfig {
    max_concurrent: u32,
    segments_per_file: u32,
    speed_limit_bytes: Option<u64>,
    post: PostConfig, // auto_extract, delete_after_extract, auto_organize, folders, tmdb key, media-server creds, rar_tool
}
```

- Tauri implementation of `EventSink` maps events to `app.emit("download-progress", ..)` and `app.emit("downloads-changed", ..)`.
- Tauri implementation of `LinkRefresher` calls `state.get_provider().await.refresh_link(source)` (clone the `Arc`, never hold the lock across `.await`) and checks the provider id matches the source's provider.
- `Engine::new(data_dir, config, sink, refresher)` — no `AppHandle`.
- `update_settings` pushes a new `EngineConfig` via `Engine::set_config`.

### 3.3 Out-of-engine paths

- **rclone remote destinations:** enqueued as `JobKind::Remote { rclone_dest }`. The engine grants a concurrency permit and delegates to the existing `rclone::download_to_rclone`, bridged to the job's cancellation token. No segments, no resume. On restart an interrupted Remote job returns to `Pending` and restarts from 0.
- **Symlink mode:** stays in the command handler (it is not a download); it creates completed jobs directly for display.

## 4. Data model and persistence

### 4.1 Types

```rust
struct Job {
    id: String,
    kind: JobKind,               // Http | Remote { rclone_dest: String }
    filename: String,
    destination: String,         // final path; work file is "{destination}.part"
    source: LinkSource,
    url: String,                 // last resolved URL (may be expired)
    total_bytes: i64,
    segments: Vec<SegmentState>, // empty until first successful probe
    resumable: bool,             // false when server ignores Range
    max_segments: u32,           // lowered adaptively on 429/503
    state: JobState,
    attempt: u32,
    retry_at: Option<i64>,       // unix ms, set during backoff
    error: Option<String>,
    post: PostStage,             // None | Extract | Organize | Done
    batch_id: String,
    created_at: i64,
    updated_at: i64,
}

struct SegmentState { start: u64, end: u64 /* inclusive */, done: u64 /* bytes durable on disk */ }

enum LinkSource {
    RealDebrid { hoster_link: String },
    TorBox { torrent_id: String, file_id: u64 },
    Premiumize { transfer_id: String, filename: String },
    Direct,
}

enum JobState { Pending, Downloading, Paused, Extracting, Completed, Failed(String), Cancelled }
```

`JobState` serializes identically to today's `DownloadStatus` (`#[serde(rename_all = "PascalCase")]`), so the TS union is unchanged. Retry backoff is represented as `Downloading` with `attempt > 0` and `retry_at` set.

### 4.2 Storage

- File: `{app_data_dir}/downloads.json`, shape `{ "version": 1, "jobs": [Job, ...] }`. Separate from the settings store because it is written frequently and must not risk the `AppSettings` blob.
- Writes: serialize → `downloads.json.tmp` → fsync → rename over `downloads.json`.
- Cadence: immediately on any state transition; otherwise at most every 2 s while any job is downloading.
- History: terminal jobs (`Completed`/`Failed`/`Cancelled`) are retained until cleared, capped at the newest 500.
- Unknown `version` or corrupt file: log a warning, rename it to `downloads.json.corrupt-<ts>`, start empty.

### 4.3 Crash safety

`SegmentState.done` advances only after bytes are durable. Each segment worker calls `sync_data()` every ~8 MiB or 2 s (whichever first), then reports its new `done` to the actor. The checkpoint may lag the file but never lead it; a crash re-downloads at most a few MiB per segment and can never leave a zero-filled hole.

### 4.4 Startup recovery

| Persisted state | Action |
|---|---|
| `Downloading` / `Pending` | → `Pending`, auto-resume via scheduler |
| `Paused` | stays `Paused` |
| `.part` missing or shorter than `total_bytes` | reset segments to empty (re-plan from 0) |
| `post` ∉ {`None`, `Done`} with a completed file | re-run pipeline from that stage (extraction into the same folder is idempotent) |
| `.part` complete (all segments done, length == total) but not renamed | finalize (rename) then run pipeline |
| Terminal states | kept as history |

## 5. Transfer logic (Http jobs)

1. **Probe:** `GET` with `Range: bytes=0-0` (some CDNs reject `HEAD`).
   - `206` + `Content-Range: bytes 0-0/<total>` → ranges supported, total known.
   - `200` → no range support: single segment, `resumable = false`; failures restart from 0. UI shows "Server doesn't support resume".
   - `Content-Type: text/html`, or status 401/403/404/410 → dead link (§6).
   - On resume, probed total ≠ persisted `total_bytes` → file changed upstream (§6).
2. **Plan** (only when `segments` is empty): `n = min(max_segments, segments_per_file, ceil(total / 8 MiB))`, at least 1. Split evenly. Check free space ≥ remaining bytes (fail early otherwise). Create `{dest}.part` (create parent dirs), `set_len(total)`.
3. **Run segments:** each unfinished segment gets a worker with its own file handle: seek to `start + done`, request `Range: bytes={start+done}-{end}`, write sequentially. Segments never overlap, so no write locking. Before each write, acquire bytes from the global limiter. Progress reported to the transfer ~every 250 ms; durable checkpoints per §4.3.
4. **Tail splitting:** when a worker finishes and the largest remaining segment has > 16 MiB left (and active workers < the job's segment cap), split that segment at the midpoint of its remaining range; the original worker's `end` shrinks and a new worker takes the back half. Persisted like any segment change.
5. **Finalize:** verify every segment complete and file length == total; `sync_all()`; rename `.part` → destination (on Windows remove an existing destination first — matches today's overwrite semantics). Set `post = Extract`, hand to the pipeline.
6. **Pause:** cancel the job token; workers stop, `sync_data()`, report final `done`; job → `Paused`; permit released; `.part` kept.
7. **Cancel:** same stop, then delete `.part`; job → `Cancelled`.

**HTTP client:** one shared `reqwest::Client` (connect timeout 15 s). Every `stream.next()` is wrapped in a 30 s idle timeout.

**Speed:** rolling 3 s average across all of a job's segments.

## 6. Error handling

| Class | Detection | Response |
|---|---|---|
| Transient | timeout, connection reset, 5xx | Retry the segment from its checkpoint: up to 5 times with 1/2/4/8/16 s. If exhausted, job-level backoff: `attempt += 1`, wait 5 s × 3^(attempt−1) capped at 5 min (`retry_at` set), resume from checkpoint. After 8 job attempts → `Failed`. |
| Offline | connect/DNS errors on every active job simultaneously | Global "Waiting for network" state: probe every 30 s, **do not increment `attempt`**. First success resumes all. |
| Connection limit | 429 / 503 (and 403 when > 1 segment active and the link is otherwise valid) | Halve `max_segments` for this job (min 1), honor `Retry-After`, continue. |
| Dead link | 401/403/404/410, HTML body | `LinkRefresher::refresh(source)` once per attempt, update `url`, re-probe. Refresh failure or `Direct` source → `Failed("Link expired and couldn't be refreshed: …")`. |
| Range violation | `200` to a mid-file Range request, or mismatched `Content-Range` | Collapse to one segment from 0, `resumable = false`. |
| File changed | probed size ≠ persisted size | Delete `.part`, re-plan once; second occurrence → `Failed`. |
| Disk | ENOSPC, permission denied, path too long | No retry → `Failed` with plain message (e.g. "Needs 42 GB, 18 GB free"). |
| Provider mismatch | refresh needed but active provider ≠ source provider | `Failed("Switch back to <Provider> to resume")`. Downloads continue while their URL is still valid. |

**Manual:** Retry on a failed job resets `attempt` and resumes from checkpoint; "Retry failed" does it in bulk.

**Shutdown:** tray Quit / OS close sends `Shutdown`; workers checkpoint within 2 s; jobs persist as `Downloading` and resume on next launch.

**Logging:** one `log::warn!` per failure with job id, segment index, HTTP status, attempt.

## 7. Post-download pipeline

Moved verbatim in behavior from `commands/downloads.rs` into `engine/pipeline.rs`:

1. **Extract** (if `auto_extract_archives`): classify via `extractor::classify` using sibling files — now safe because in-progress files carry `.part` and are excluded from the sibling list. Job → `Extracting` during extraction. Optionally delete parts.
2. **Organize** (if `auto_organize`): same single-video rule as today.
3. **Media scan:** once per `batch_id`, when every job in the batch is terminal and at least one completed, call `media_servers::trigger_scans`.

`post` advances after each stage and is persisted, enabling §4.4 re-runs.

## 8. Provider changes

- `providers/types.rs`: `DownloadLink` gains `#[serde(default)] pub source: LinkSource` (default `Direct`). `LinkSource` lives in `providers/types.rs` (shared), re-exported by the engine.
- `DebridProvider` trait gains `async fn refresh_link(&self, source: &LinkSource) -> Result<DownloadLink, ProviderError>`.
- **Real-Debrid:** `get_download_links` / `get_download_link_for_file` set `RealDebrid { hoster_link }` (the link currently discarded after unrestricting). `refresh_link` re-unrestricts it.
- **TorBox:** set `TorBox { torrent_id, file_id }`; `refresh_link` calls `/torrents/requestdl`.
- **Premiumize:** set `Premiumize { transfer_id, filename }`; `refresh_link` re-lists and matches by filename.
- Each provider returns `ProviderError` for sources belonging to another provider.

## 9. IPC and frontend

### 9.1 Commands (`commands/downloads.rs` ↔ `src/api/downloads.ts` ↔ `generate_handler!` in `lib.rs`)

- Kept (same signatures): `start_downloads`, `cancel_download`, `cancel_all_downloads`, `remove_download`, `clear_completed_downloads`, `get_download_tasks`, `unrestrict_torrent_links`, `get_download_history`.
- New: `pause_download(id)`, `resume_download(id)`, `retry_download(id)`, `pause_all_downloads()`, `resume_all_downloads()`, `retry_failed_downloads()`.
- `get_download_tasks` returns jobs mapped to the `DownloadTask` shape plus new optional fields.

### 9.2 Events

- `download-progress`: existing fields unchanged; adds optional `attempt`, `retry_at`, `segments_active`, `resumable`, `error`. Coalesced to ≤ 10/s per job.
- `downloads-changed` (new): emitted on job add/remove/clear. `useDownloadTasks` fetches once on mount and refetches on this event; the 3 s poll is removed.

### 9.3 Settings

- `AppSettings.segments_per_file: u32`, `#[serde(default = "default_segments")]` → 4, clamped 1–16. One numeric field in Settings → Downloads.
- `max_concurrent_downloads` and `speed_limit_bytes` changes apply live via `Engine::set_config`.

### 9.4 UI (current styling; restyled by the later redesign)

- `DownloadsPage` row actions: Pause / Resume, Retry (failed only), Cancel.
- Status sub-line: "Retrying in 12s · attempt 3/8", "Waiting for network", "4 connections", "Server doesn't support resume", or the error message.
- Toolbar: Pause all · Resume all · Retry failed.
- `src/types/index.ts`: add optional fields to `DownloadTask` and `DownloadProgress`.

## 10. Testing

### 10.1 Automated (`cargo test`)

Mock CDN (`engine/tests/mock_server.rs`): Axum on `127.0.0.1:0` serving deterministic pseudo-random bytes with Range support, configurable per test: no-range, drop connection after N bytes, stall, 429 + `Retry-After`, 403 until refresher called, size change, HTML body, `200` to Range.

Doubles: recording `EventSink`, counting `LinkRefresher`, `tempfile` dirs.

Cases:
1. Segmented download → output hash matches source.
2. Pause mid-way → rebuild engine from `downloads.json` → resume → hash matches; mock records no re-requested bytes before the checkpoint minus the checkpoint window.
3. Stall → idle timeout → retry → completes.
4. 429 → `max_segments` halved → completes.
5. 403 → refresher called once → completes.
6. `200` to Range → single segment, `resumable = false` → completes.
7. Size change on resume → reset → completes.
8. Store: simulated crash between tmp write and rename leaves previous `downloads.json` loadable.
9. Scheduler: two batches enqueued, observed concurrent jobs never exceed `max_concurrent`.
10. Limiter: measured throughput within ±15% of the cap.
11. Tail splitting: one slow segment gets split; segment count increases; completes.
12. Offline: all connects refused for a period → `attempt` unchanged → server returns → completes.

CI: add a `cargo test --manifest-path src-tauri/Cargo.toml` step to the `build-check` job in `.github/workflows/build.yml`.

### 10.2 Manual (`npm run tauri dev`)

- Disable network 2 min mid-download → auto-resume.
- Tray Quit mid-download → relaunch → resumes.
- Pause / resume single and all; paused survives restart.
- Two torrents queued → total concurrent ≤ setting.
- Speed comparison vs v1.6.4 on the same 5 GB+ file and provider.
- Auto-extract of a multi-part RAR set still works (no partial parts picked up).

## 11. Risks

- **Provider connection caps:** some hosts may penalize > N connections. Mitigated by adaptive halving and the user-facing `segments_per_file` setting (1 disables segmentation).
- **Sparse file support:** `set_len` on filesystems without sparse files (FAT32/exFAT) writes zeros up front — slower start on huge files, still correct.
- **Windows rename semantics:** handled by remove-then-rename; a crash in between leaves the completed `.part`, which startup recovery detects (length == total, all segments done) and finalizes.
- **Real-Debrid hoster links from older persisted jobs:** none exist (no persistence today), so no migration is needed.
