# Symlink Mode — Link Debrid Mount to Media Library

**Date:** 2026-03-23
**Status:** Approved

## Problem

Users with rclone mounts of their debrid service (Real-Debrid WebDAV, TorBox, etc.) want files to appear in their Plex/Jellyfin library instantly without any data transfer. Currently they must download files (locally or to a cloud remote) even though the files are already accessible via the mount.

## Solution Overview

Add a "symlink mode" toggle. When enabled, all downloads create symbolic links from the user's media library folder to the corresponding files on their rclone mount. Zero data transfer, instant completion. Third mode alongside local downloads and rclone remote downloads.

## Settings

Three new fields in `AppSettings`:

- `symlink_mode: bool` (default `false`) — global toggle
- `symlink_mount_path: Option<String>` — where debrid files live on the rclone mount (e.g. `/Volumes/realdebrid/torrents`)
- `symlink_library_path: Option<String>` — where symlinks are created for Plex/Jellyfin (e.g. `/media/Movies`)

When symlink mode is on, the download engine creates symlinks instead of downloading. No per-download mode selector — it's a global setting.

## Backend — Symlink Creation

When `start_downloads` is called and `symlink_mode` is enabled:

1. Read `symlink_mount_path` and `symlink_library_path` from settings
2. Validate both paths are configured (error if not)
3. For each download link, construct paths:
   - **Source (symlink target):** `{mount_path}/{torrent_name}/{filename}` — the actual file on the mount
   - **Destination (symlink location):** `{library_path}/{torrent_name}/{filename}` — where Plex looks
4. Create parent directories at destination with `tokio::fs::create_dir_all`
5. Create symlink with `tokio::fs::symlink` (Unix)
6. Set task status to `Completed` immediately
7. Emit progress event with `downloaded_bytes = total_bytes` so frontend shows 100%

The `DownloadTask.remote` field is set to `Some("symlink")` to distinguish symlinked files from local and rclone downloads in the UI.

### Path Construction

Uses `PathBuf` (these are local filesystem paths, unlike rclone remotes). The `sanitize_filename` function applies to torrent name and filename components. Respects `create_torrent_subfolders` setting.

**Mount path structure:** The mount path the user configures should point to the directory where torrent folders/files appear. The exact structure depends on the rclone mount configuration and the debrid service. For Real-Debrid WebDAV, this is typically the `/torrents/` subfolder. The user sets their mount path to include this (e.g. `/Volumes/realdebrid/torrents`). The app then looks for `{mount_path}/{torrent_name}/{filename}`. If a file has a common name across torrents, the torrent name subfolder disambiguates.

**`DownloadTask.destination`** is set to the **symlink location** (library path side), not the mount path. This is what the Completed page's "Reveal" button uses to open the file in Finder.

### Serde Compatibility

All new `AppSettings` fields MUST use `#[serde(default)]` to maintain compatibility with existing serialized settings from users who upgrade.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Mount path not configured | Error: "Symlink mode is on but no mount path configured" |
| Library path not configured | Error: "Symlink mode is on but no library folder configured" |
| Mount path doesn't exist | Error: "Mount path not found — is your rclone mount running?" |
| Source file not on mount | Error: "File not found on mount — torrent may still be processing" |
| Symlink creation fails | Surface OS error message |
| Library path doesn't exist | Create it automatically with `create_dir_all` |
| Symlink already exists | Overwrite (remove old symlink, create new one) |

### No Download Engine Involvement

Symlink creation does NOT go through `download_file` or `download_to_rclone`. It's a direct filesystem operation in `start_downloads` — no HTTP streaming, no child processes, no progress tracking needed. Tasks complete instantly.

## Frontend Changes

### Settings Page

New "Symlink Mode" section after Remote Downloads:

- `ToggleRow` for "Create symlinks instead of downloading"
- Description: "Link files from your debrid mount to your media library — zero transfer, instant availability"
- When toggled on, two path inputs appear below:
  - "Mount Path" — text input + Browse button
  - "Library Folder" — text input + Browse button
- Warning message if symlink mode is on but either path is empty

### Downloads Page

- Symlinked tasks appear briefly then complete instantly
- Chain link icon (not cloud icon) when `task.remote === "symlink"`

### Completed Page

- Chain link icon next to filename for symlinked files
- "Reveal" button works normally — symlinks are real local filesystem paths

### Torrents Page

- When symlink mode is active, skip the folder picker entirely — the library path from settings is used
- `start_downloads` is called the same way — backend checks symlink mode and uses `symlink_library_path` instead of `destination_folder`
- If symlink mode is on but paths aren't configured, show an error toast directing user to Settings

## What This Does NOT Include

- Per-download mode selection (symlink vs download)
- Automatic rclone mount management
- Mount health monitoring or retry logic
- Reverse symlink cleanup when debrid files expire
- Windows junction/symlink support (macOS/Linux only for now)
