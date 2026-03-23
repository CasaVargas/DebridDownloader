# rclone Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream debrid downloads directly to rclone remotes via piped `rclone rcat`, zero local disk usage.

**Architecture:** New `rclone.rs` module for detection/execution, modified `downloader.rs` with rclone pipe path, `DownloadTask.remote` field for routing, frontend smart destination detection via regex pattern on the path input.

**Tech Stack:** Rust (tokio::process::Command, stdin pipe), React/TypeScript (Tailwind), Tauri IPC

**Spec:** `docs/superpowers/specs/2026-03-23-rclone-integration-design.md`

**Note:** No test infrastructure exists in this project. Steps marked "Verify" use `cargo check`, `cargo build`, `npm run build`, and manual testing via `npm run tauri dev`.

---

## File Structure

### New Files
- `src-tauri/src/rclone.rs` — rclone detection, remote listing, rcat piping, cleanup
- `src/api/rclone.ts` — Frontend API wrappers for rclone Tauri commands
- `src/hooks/useRclone.ts` — Hook for rclone status + remote listing

### Modified Files
- `src-tauri/src/state.rs` — Add `remote: Option<String>` to `DownloadTask`
- `src-tauri/src/commands/downloads.rs` — Route to rclone download path when remote detected
- `src-tauri/src/commands/mod.rs` — Add `pub mod rclone;`
- `src-tauri/src/commands/rclone.rs` — Tauri command wrappers for rclone functions (NEW)
- `src-tauri/src/lib.rs` — Register new rclone commands
- `src/types/index.ts` — Add `remote` field to `DownloadTask`, add `RcloneInfo` type
- `src/api/downloads.ts` — No changes needed (destination_folder already accepts string)
- `src/pages/SettingsPage.tsx` — rclone status section, text input for download path
- `src/pages/DownloadsPage.tsx` — Cloud icon for remote transfers
- `src/hooks/useDownloadTasks.tsx` — No changes needed (`remote` comes from base task via polling, not progress events)

---

## Task 1: rclone Detection Module (Backend)

**Files:**
- Create: `src-tauri/src/rclone.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod rclone;`)

- [ ] **Step 1: Create `src-tauri/src/rclone.rs` with detection functions**

```rust
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct RcloneInfo {
    pub version: String,
    pub available: bool,
}

/// Check if rclone is installed and return version info
pub async fn check_rclone() -> Option<RcloneInfo> {
    let output = Command::new("rclone")
        .arg("version")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // First line is like "rclone v1.68.0"
    let version = stdout
        .lines()
        .next()
        .unwrap_or("rclone (unknown version)")
        .to_string();

    Some(RcloneInfo {
        version,
        available: true,
    })
}

/// List configured rclone remotes
pub async fn list_remotes() -> Result<Vec<String>, String> {
    let output = Command::new("rclone")
        .arg("listremotes")
        .output()
        .await
        .map_err(|e| format!("Failed to run rclone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("rclone listremotes failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let remotes: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(remotes)
}

/// Detect if a path is an rclone remote (matches `name:` or `name:path`)
pub fn is_rclone_path(path: &str) -> bool {
    // Pattern: alphanumeric/hyphen/underscore followed by colon
    // Must not match Windows drive letters like C:\
    if let Some(colon_pos) = path.find(':') {
        if colon_pos == 0 {
            return false;
        }
        // Windows drive letter: single char + colon + backslash
        if colon_pos == 1 && path.len() > 2 && path.as_bytes()[2] == b'\\' {
            return false;
        }
        let name = &path[..colon_pos];
        name.chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    } else {
        false
    }
}
```

- [ ] **Step 2: Add module declaration to `lib.rs`**

In `src-tauri/src/lib.rs`, add near the top with other `mod` declarations:

```rust
mod rclone;
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors (warnings about unused functions are fine)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/rclone.rs src-tauri/src/lib.rs
git commit -m "feat(rclone): add detection module with version check, remote listing, and path detection"
```

---

## Task 2: rclone Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/rclone.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Create `src-tauri/src/commands/rclone.rs`**

```rust
use crate::rclone;

#[tauri::command]
pub async fn check_rclone() -> Option<rclone::RcloneInfo> {
    rclone::check_rclone().await
}

#[tauri::command]
pub async fn list_rclone_remotes() -> Result<Vec<String>, String> {
    rclone::list_remotes().await
}

#[tauri::command]
pub async fn validate_rclone_remote(remote_name: String) -> Result<bool, String> {
    let remotes = rclone::list_remotes().await?;
    // remote_name might be "gdrive:" or "gdrive" — normalize
    let normalized = if remote_name.ends_with(':') {
        remote_name.clone()
    } else {
        format!("{}:", remote_name)
    };
    Ok(remotes.iter().any(|r| r == &normalized))
}
```

- [ ] **Step 2: Add module to `src-tauri/src/commands/mod.rs`**

Add:
```rust
pub mod rclone;
```

- [ ] **Step 3: Register commands in `src-tauri/src/lib.rs`**

In the `invoke_handler` block, add after the Settings section:

```rust
// rclone
commands::rclone::check_rclone,
commands::rclone::list_rclone_remotes,
commands::rclone::validate_rclone_remote,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/rclone.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rclone): add Tauri commands for rclone detection and remote validation"
```

---

## Task 3: Data Model Changes

**Files:**
- Modify: `src-tauri/src/state.rs` — Add `remote` field to `DownloadTask`
- Modify: `src-tauri/src/commands/downloads.rs` — Populate `remote` field
- Modify: `src-tauri/src/downloader.rs` — Add `remote` to `DownloadProgress`
- Modify: `src/types/index.ts` — Add TypeScript types

- [ ] **Step 1: Add `remote` field to `DownloadTask` in `state.rs`**

In `src-tauri/src/state.rs`, modify the `DownloadTask` struct to add after `status`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub destination: String,
    pub total_bytes: i64,
    pub downloaded_bytes: i64,
    pub speed: f64,
    pub status: DownloadStatus,
    #[serde(default)]
    pub remote: Option<String>,
}
```

- [ ] **Step 2: Add `remote` to `DownloadProgress` in `downloader.rs`**

In `src-tauri/src/downloader.rs`, modify `DownloadProgress`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub id: String,
    pub filename: String,
    pub downloaded_bytes: i64,
    pub total_bytes: i64,
    pub speed: f64,
    pub status: DownloadStatus,
    pub remote: Option<String>,
}
```

And update `emit_progress` to include the field:

```rust
fn emit_progress(app: &AppHandle, task: &DownloadTask) {
    let progress = DownloadProgress {
        id: task.id.clone(),
        filename: task.filename.clone(),
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        speed: task.speed,
        status: task.status.clone(),
        remote: task.remote.clone(),
    };
    let _ = app.emit("download-progress", &progress);
}
```

- [ ] **Step 3: Populate `remote` field in `start_downloads` in `downloads.rs`**

In `src-tauri/src/commands/downloads.rs`, in the task creation loop, detect rclone paths and set `remote`. Modify the `for link in &links` loop:

```rust
use crate::rclone;

// ... inside start_downloads, in the for loop:

let is_remote = rclone::is_rclone_path(&destination_folder);

let dest = if is_remote {
    // rclone paths: string concatenation, NOT PathBuf
    let base = destination_folder.trim_end_matches('/');
    if create_subfolders {
        if let Some(ref name) = torrent_name {
            format!("{}/{}/{}", base, sanitize_filename(name), sanitize_filename(&link.filename))
        } else {
            format!("{}/{}", base, sanitize_filename(&link.filename))
        }
    } else {
        format!("{}/{}", base, sanitize_filename(&link.filename))
    }
} else {
    // Local paths: use PathBuf as before
    if create_subfolders {
        if let Some(ref name) = torrent_name {
            PathBuf::from(&destination_folder)
                .join(sanitize_filename(name))
                .join(sanitize_filename(&link.filename))
        } else {
            PathBuf::from(&destination_folder).join(sanitize_filename(&link.filename))
        }
    } else {
        PathBuf::from(&destination_folder).join(sanitize_filename(&link.filename))
    }
    .to_string_lossy()
    .to_string()
};

let task = DownloadTask {
    id: id.clone(),
    filename: link.filename.clone(),
    url: link.download.clone(),
    destination: dest,
    total_bytes: link.filesize,
    downloaded_bytes: 0,
    speed: 0.0,
    status: DownloadStatus::Pending,
    remote: if is_remote {
        Some(destination_folder.clone())
    } else {
        None
    },
};
```

- [ ] **Step 4: Update TypeScript types in `src/types/index.ts`**

Add `remote` to `DownloadTask` and `DownloadProgress`:

```typescript
export interface DownloadTask {
  id: string;
  filename: string;
  url: string;
  destination: string;
  total_bytes: number;
  downloaded_bytes: number;
  speed: number;
  status: DownloadStatus;
  remote?: string | null;
}

export interface DownloadProgress {
  id: string;
  filename: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed: number;
  status: DownloadStatus;
  remote?: string | null;
}
```

Add the `RcloneInfo` type:

```typescript
// ── rclone ──

export interface RcloneInfo {
  version: string;
  available: boolean;
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Then: `npm run build`
Expected: Both compile cleanly

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/downloader.rs src-tauri/src/commands/downloads.rs src/types/index.ts
git commit -m "feat(rclone): add remote field to DownloadTask and route rclone vs local paths"
```

---

## Task 4: rclone Download Engine

**Files:**
- Modify: `src-tauri/src/rclone.rs` — Add `download_to_rclone` function
- Modify: `src-tauri/src/commands/downloads.rs` — Route to rclone download path

- [ ] **Step 1: Add `download_to_rclone` to `src-tauri/src/rclone.rs`**

Append to the existing `rclone.rs`:

```rust
use crate::state::{DownloadStatus, DownloadTask};
use crate::downloader::emit_progress;
use futures::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Download a file by piping HTTP stream to rclone rcat
pub async fn download_to_rclone(
    app: AppHandle,
    task: &mut DownloadTask,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
) -> Result<(), String> {
    // Start HTTP stream from debrid URL
    let client = reqwest::Client::new();
    let resp = client
        .get(&task.url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(task.total_bytes as u64) as i64;
    task.total_bytes = total;
    task.status = DownloadStatus::Downloading;
    task.downloaded_bytes = 0;

    emit_progress(&app, task);

    // Build rclone rcat command
    // destination is the full rclone path like "gdrive:Media/Movies/file.mkv"
    let mut cmd_args = vec![
        "rcat".to_string(),
        "--timeout".to_string(),
        "0".to_string(),
    ];

    if total > 0 {
        cmd_args.push("--size".to_string());
        cmd_args.push(total.to_string());
    }

    cmd_args.push(task.destination.clone());

    let mut child = Command::new("rclone")
        .args(&cmd_args)
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start rclone: {}", e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open rclone stdin".to_string())?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: i64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut speed_bytes: i64 = 0;
    let mut speed_start = std::time::Instant::now();

    let pipe_result: Result<(), String> = loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        if let Err(e) = stdin.write_all(&bytes).await {
                            break Err(format!("Failed to write to rclone: {}", e));
                        }
                        downloaded += bytes.len() as i64;
                        speed_bytes += bytes.len() as i64;
                        task.downloaded_bytes = downloaded;

                        let elapsed = speed_start.elapsed().as_secs_f64();
                        if elapsed >= 1.0 {
                            task.speed = speed_bytes as f64 / elapsed;
                            speed_bytes = 0;
                            speed_start = std::time::Instant::now();
                        }

                        if last_emit.elapsed().as_millis() >= 100 {
                            emit_progress(&app, task);
                            last_emit = std::time::Instant::now();
                        }
                    }
                    Some(Err(e)) => {
                        break Err(format!("Download stream error: {}", e));
                    }
                    None => break Ok(()),
                }
            }
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    // Kill rclone process
                    let _ = child.kill().await;

                    // Clean up partial remote file (fire-and-forget)
                    let dest = task.destination.clone();
                    tokio::spawn(async move {
                        let _ = Command::new("rclone")
                            .args(["deletefile", &dest])
                            .output()
                            .await;
                    });

                    task.status = DownloadStatus::Cancelled;
                    emit_progress(&app, task);
                    return Ok(());
                }
            }
        }
    };

    // Close stdin to signal EOF to rclone
    drop(stdin);

    if let Err(e) = pipe_result {
        let _ = child.kill().await;
        task.status = DownloadStatus::Failed(e.clone());
        emit_progress(&app, task);
        return Err(e);
    }

    // Wait for rclone to finish uploading
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for rclone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let err = if stderr.is_empty() {
            format!("rclone exited with code {}", output.status)
        } else {
            stderr
        };
        task.status = DownloadStatus::Failed(err.clone());
        emit_progress(&app, task);
        return Err(err);
    }

    task.status = DownloadStatus::Completed;
    task.speed = 0.0;
    emit_progress(&app, task);

    Ok(())
}
```

- [ ] **Step 2: Make `emit_progress` public in `downloader.rs`**

In `src-tauri/src/downloader.rs`, change:

```rust
fn emit_progress(app: &AppHandle, task: &DownloadTask) {
```

to:

```rust
pub fn emit_progress(app: &AppHandle, task: &DownloadTask) {
```

- [ ] **Step 3: Route downloads in `commands/downloads.rs`**

In `src-tauri/src/commands/downloads.rs`, modify the spawned task handler inside `start_downloads`. Replace the existing download call:

```rust
let result =
    downloader::download_file(app, &mut task, &mut cancel_rx).await;
```

with:

```rust
let result = if task.remote.is_some() {
    crate::rclone::download_to_rclone(app, &mut task, &mut cancel_rx).await
} else {
    downloader::download_file(app, &mut task, &mut cancel_rx).await
};
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles cleanly

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/rclone.rs src-tauri/src/downloader.rs src-tauri/src/commands/downloads.rs
git commit -m "feat(rclone): add rclone download engine with stdin pipe, cancellation, and cleanup"
```

---

## Task 5: Frontend API + Hook

**Files:**
- Create: `src/api/rclone.ts`
- Create: `src/hooks/useRclone.ts`

- [ ] **Step 1: Create `src/api/rclone.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { RcloneInfo } from "../types";

export async function checkRclone(): Promise<RcloneInfo | null> {
  return invoke("check_rclone");
}

export async function listRcloneRemotes(): Promise<string[]> {
  return invoke("list_rclone_remotes");
}

export async function validateRcloneRemote(
  remoteName: string
): Promise<boolean> {
  return invoke("validate_rclone_remote", { remoteName });
}
```

- [ ] **Step 2: Create `src/hooks/useRclone.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import { checkRclone, listRcloneRemotes } from "../api/rclone";
import type { RcloneInfo } from "../types";

export function useRclone() {
  const [rcloneInfo, setRcloneInfo] = useState<RcloneInfo | null>(null);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkRclone().then((info) => {
      setRcloneInfo(info);
      setLoading(false);
    });
  }, []);

  const refreshRemotes = useCallback(async () => {
    if (!rcloneInfo?.available) return;
    try {
      const list = await listRcloneRemotes();
      setRemotes(list);
    } catch {
      setRemotes([]);
    }
  }, [rcloneInfo]);

  return { rcloneInfo, remotes, refreshRemotes, loading };
}

/**
 * Detect if a path string is an rclone remote path.
 * Matches: "name:", "name:path", "my-remote:folder/subfolder"
 * Does NOT match: "C:\Users\..." (Windows drive letter)
 */
export function isRclonePath(path: string): boolean {
  const colonIndex = path.indexOf(":");
  if (colonIndex <= 0) return false;
  // Windows drive letter: single char + colon + backslash
  if (colonIndex === 1 && path.length > 2 && path[2] === "\\") return false;
  const name = path.substring(0, colonIndex);
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
```

- [ ] **Step 3: Verify frontend build**

Run: `npm run build`
Expected: Compiles cleanly

- [ ] **Step 4: Commit**

```bash
git add src/api/rclone.ts src/hooks/useRclone.ts
git commit -m "feat(rclone): add frontend API wrappers and useRclone hook"
```

---

## Task 6: Settings Page — rclone Status Section + Smart Path Input

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

This task modifies the Settings page to:
1. Convert the download folder picker to a text input + browse button combo
2. Show rclone detection status
3. Add "List Remotes" button with clickable remote names
4. Validate rclone paths and show errors

- [ ] **Step 1: Read the current SettingsPage.tsx to understand the layout**

Read: `src/pages/SettingsPage.tsx`

Identify:
- Where the download folder section is (look for `download_folder` or the browse/folder picker button)
- The existing folder picker implementation (uses `@tauri-apps/plugin-dialog` `open()`)
- The page's section pattern/styling (label + control layout, spacing classes)

- [ ] **Step 2: Convert download folder to text input + browse button**

Replace the existing folder picker UI with:

```tsx
import { useRclone, isRclonePath } from "../hooks/useRclone";
import { validateRcloneRemote } from "../api/rclone";

// Inside the component:
const { rcloneInfo, remotes, refreshRemotes } = useRclone();
const [pathError, setPathError] = useState<string | null>(null);

// Validation when user changes the path:
const handlePathChange = async (newPath: string) => {
  setPathError(null);
  if (isRclonePath(newPath)) {
    if (!rcloneInfo?.available) {
      setPathError("This looks like an rclone remote but rclone is not installed");
      return;
    }
    // Extract remote name (everything before the first colon)
    const remoteName = newPath.split(":")[0];
    const valid = await validateRcloneRemote(remoteName);
    if (!valid) {
      setPathError(`Remote "${remoteName}" not found in rclone config`);
      return;
    }
  }
  // Save the path to settings
  updateSettings({ ...settings, download_folder: newPath || null });
};
```

The JSX for the download folder row:

```tsx
<div className="flex items-center gap-2">
  <input
    type="text"
    value={settings.download_folder ?? ""}
    onChange={(e) => handlePathChange(e.target.value)}
    placeholder="Select folder or enter rclone remote (e.g. gdrive:Media)"
    className="flex-1 bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] rounded-lg px-3 py-2 text-sm border border-[var(--theme-border)]"
  />
  {isRclonePath(settings.download_folder ?? "") && (
    <svg className="w-4 h-4 text-[var(--accent)]" /* cloud icon */ />
  )}
  <button onClick={handleBrowse} /* existing browse handler */>
    Browse
  </button>
</div>
{pathError && (
  <p className="text-red-400 text-xs mt-1">{pathError}</p>
)}
```

- [ ] **Step 3: Add rclone status section below download folder**

Add a new settings section after the download folder:

```tsx
{/* rclone Integration */}
<div className="settings-section">
  <h3>rclone</h3>
  {rcloneInfo?.available ? (
    <div>
      <p className="text-sm text-[var(--theme-text-secondary)]">
        {rcloneInfo.version}
      </p>
      <button onClick={refreshRemotes}>List Remotes</button>
      {remotes.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {remotes.map((remote) => (
            <button
              key={remote}
              onClick={() => handlePathChange(remote)}
              className="text-xs px-2 py-1 rounded bg-[var(--theme-bg-tertiary)] hover:bg-[var(--accent)] transition-colors"
            >
              {remote}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : (
    <p className="text-sm text-[var(--theme-text-secondary)]">
      rclone not installed — install from rclone.org to enable remote downloads
    </p>
  )}
</div>
```

Match the existing section styling (labels, spacing, card backgrounds) from the rest of SettingsPage.

- [ ] **Step 4: Verify with dev server**

Run: `npm run tauri dev`
Expected:
- Download folder field is now a text input with Browse button
- Can type rclone paths like `gdrive:Media` — cloud icon appears
- If rclone not installed: error shows when typing rclone path
- rclone section shows version or "not installed"
- "List Remotes" shows clickable remote names

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(rclone): add rclone status section and smart path input to Settings"
```

---

## Task 7: Downloads Page — Cloud Icon for Remote Transfers

**Files:**
- Modify: `src/pages/DownloadsPage.tsx`

- [ ] **Step 1: Read the current DownloadsPage.tsx**

Read: `src/pages/DownloadsPage.tsx`

Identify where the filename/progress is rendered for each download task.

- [ ] **Step 2: Add cloud icon indicator**

Next to the filename display for each download, check `task.remote`:
- If `task.remote` is set (non-null): show a small cloud/upload icon with a tooltip showing the remote name
- If `task.remote` is null/undefined: render nothing (local download, no change)

Use an inline SVG cloud icon (no dependencies). Keep it subtle — same color as secondary text, small size.

- [ ] **Step 3: Verify with dev server**

Run: `npm run tauri dev`
Start a test download to a local path — no icon should appear.
If rclone is available, test with an rclone remote path — cloud icon should appear.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DownloadsPage.tsx
git commit -m "feat(rclone): add cloud icon indicator for remote transfers on Downloads page"
```

---

## Task 8: Download Dialog — Smart Destination Input

**Files:**
- Modify: `src/pages/TorrentsPage.tsx` (or wherever the download initiation dialog lives)

- [ ] **Step 1: Read the download initiation flow**

Read: `src/pages/TorrentsPage.tsx`

Find `handleDownloadTorrent` and `handleDetailDownload` — these are where the folder picker is invoked and `startDownloads` is called. The current pattern is:

```typescript
// Pseudocode of current flow:
let folder = settings.download_folder;
if (!folder) {
  folder = await open({ directory: true, title: "Select download folder" });
}
if (!folder) return; // user cancelled
const links = await unrestrictTorrentLinks(torrentId);
await startDownloads(links, folder, torrentName);
```

- [ ] **Step 2: Add rclone path detection to the download flow**

Import `isRclonePath` and modify the download handler functions:

```typescript
import { isRclonePath } from "../hooks/useRclone";

// In handleDownloadTorrent / handleDetailDownload:
let folder = settings.download_folder;

if (!folder) {
  // No default path set — must use folder picker (can't pick rclone remotes here)
  folder = await open({ directory: true, title: "Select download folder" });
}

if (!folder) return; // user cancelled

// If it's an rclone path, skip any local-path validation (e.g. directory existence checks)
// The backend handles rclone routing based on the path pattern
const links = await unrestrictTorrentLinks(torrentId);
await startDownloads(links, folder, torrentName);
```

Key change: The existing flow already works for rclone paths because `startDownloads` passes `destination_folder` as a plain string. The backend's `is_rclone_path()` detection handles the routing. The only frontend concern is ensuring:
- No native folder picker is shown if `settings.download_folder` is already an rclone path
- No local directory validation is applied to rclone paths

If the existing code does any post-selection path validation (checking directory exists, etc.), guard those checks with `!isRclonePath(folder)`.

- [ ] **Step 3: Verify with dev server**

Run: `npm run tauri dev`
1. Set an rclone remote as download path in Settings (e.g. `gdrive:Media`)
2. Go to Torrents page, initiate a download
3. Expected: Download starts without folder picker popup
4. Expected: Download appears on Downloads page with cloud icon
5. Expected: `task.destination` shows full rclone path like `gdrive:Media/filename.mkv`

- [ ] **Step 4: Commit**

```bash
git add src/pages/TorrentsPage.tsx
git commit -m "feat(rclone): support rclone remote paths in download initiation flow"
```

---

## Task 9: Integration Testing & Polish

- [ ] **Step 1: Full build verification**

Run: `cd src-tauri && cargo check && cd .. && npm run build`
Expected: No errors on either side

- [ ] **Step 2: Manual end-to-end test (rclone available)**

If rclone is installed:
1. Open Settings → verify rclone version shows
2. Click "List Remotes" → verify remotes appear
3. Click a remote → verify it fills the download path
4. Start a download → verify cloud icon appears on Downloads page
5. Cancel mid-download → verify partial file is cleaned up

- [ ] **Step 3: Manual end-to-end test (rclone NOT available)**

If rclone is not installed (or rename binary temporarily):
1. Open Settings → verify "not installed" message shows
2. Type an rclone path in download folder → verify error appears
3. All existing local download functionality unchanged

- [ ] **Step 4: Production build**

Run: `npm run tauri build`
Expected: Builds successfully, app launches

- [ ] **Step 5: Commit any polish fixes**

```bash
git add -A
git commit -m "feat(rclone): integration testing polish and fixes"
```
