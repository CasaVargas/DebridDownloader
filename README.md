# DebridDownloader

A fast, native desktop client for managing torrents and downloads through the [Real-Debrid](https://real-debrid.com) API. Built with Tauri, React, and Rust.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-0.1.0-orange)

## Features

- **Torrent Management** — Add magnets or `.torrent` files, select files, and monitor progress
- **Tracker Search** — Search multiple torrent trackers directly from the app and add results with one click
- **Download Engine** — Multi-threaded file downloads with real-time speed, ETA, and progress tracking
- **System Tray** — Runs in the background with a menu bar icon (macOS) / system tray (Windows/Linux)
- **Launch at Login** — Optionally start the app when your computer boots
- **Keyboard Shortcuts** — `Cmd+K` search, `Cmd+R` refresh, arrow key navigation, `Enter` to download
- **Dark & Light Mode** — Full theme support with 6 accent color options
- **Code Signed & Notarized** — macOS builds are signed with Developer ID and notarized by Apple

## Screenshots

<!-- TODO: Add screenshots -->

## Download

Grab the latest release for your platform:

| Platform | Architecture | Download |
|----------|-------------|----------|
| macOS | Apple Silicon (M1/M2/M3/M4) | [`.dmg`](https://github.com/prjoni99/DebridDownloader/releases/latest) |
| macOS | Intel | [`.dmg`](https://github.com/prjoni99/DebridDownloader/releases/latest) |
| Windows | x64 | [`.exe` installer](https://github.com/prjoni99/DebridDownloader/releases/latest) |
| Windows | ARM64 | [`.exe` installer](https://github.com/prjoni99/DebridDownloader/releases/latest) |
| Linux | x64 | [`.deb` / `.AppImage`](https://github.com/prjoni99/DebridDownloader/releases/latest) |

## Requirements

- A [Real-Debrid](https://real-debrid.com) premium account
- macOS 11+, Windows 10+, or a modern Linux distribution

## Getting Started

1. Download and install the app for your platform
2. Launch DebridDownloader
3. Connect your Real-Debrid account using either:
   - **API Token** — paste your token from [real-debrid.com/apitoken](https://real-debrid.com/apitoken)
   - **OAuth Login** — authorize via browser (device code flow)
4. Start adding torrents and downloading

## Usage

### Adding Torrents

- Click **+ Add Torrent** to paste a magnet link or upload a `.torrent` file
- Use **Search** (`Cmd+K`) to find torrents across multiple trackers
- Paste a magnet link directly into the search bar to add it instantly

### Managing Downloads

- The **Torrents** page shows all your Real-Debrid torrents with status, size, and age
- Click any torrent to open the detail panel — view files, select which to download, and start the download
- The **Downloads** page shows active download progress with speed and ETA
- The **Completed** page lists finished downloads with "Reveal in Finder" to locate files

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open search |
| `Cmd+R` | Refresh current view |
| `Esc` | Close panel / deselect |
| `Enter` | Download selected torrent |
| `Delete` | Delete selected item |

### Settings

- **Download folder** — set a default location or get prompted each time
- **Max concurrent downloads** — control parallel download count (1-10)
- **Create subfolders** — organize files into torrent-named folders
- **Auto-start downloads** — automatically download when torrents are ready
- **Launch at login** — start with your computer
- **Notifications** — get notified when downloads complete
- **Theme** — dark or light mode
- **Accent color** — emerald, blue, violet, rose, amber, or cyan

## Development

### Prerequisites

- [Node.js](https://nodejs.org) 22+
- [Rust](https://rustup.rs) (stable)
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Windows**: [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11)

### Setup

```bash
git clone https://github.com/prjoni99/DebridDownloader.git
cd DebridDownloader
npm install
```

### Dev Server

```bash
npm run tauri dev
```

Starts both the Vite dev server (hot reload) and the Tauri window.

### Build

```bash
npm run tauri build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

### Type Check

```bash
npx tsc --noEmit
```

## Architecture

### Two-Process Model (Tauri v2)

```
┌─────────────────────────────────────────────┐
│  Frontend (React 19 + TypeScript)           │
│  Vite + Tailwind CSS v4 + React Router v7   │
│                                             │
│  invoke() ←──── IPC ────→ #[command]        │
│                                             │
│  Backend (Rust)                             │
│  Real-Debrid API · File Downloads · Keyring │
│  Tauri Plugins: opener, dialog, fs, store,  │
│  autostart                                  │
└─────────────────────────────────────────────┘
```

### Frontend (`src/`)

| Path | Purpose |
|------|---------|
| `pages/` | Route-level views: Torrents, Downloads, Completed, Search, Settings, Auth |
| `components/` | Shared UI: Sidebar, DataTable, SlideOverPanel, TableToolbar, AddTorrentModal |
| `hooks/` | Auth context, download task polling, accent color/theme management |
| `api/` | Thin `invoke()` wrappers — one file per domain |
| `types/` | TypeScript interfaces mirroring Rust types |
| `styles/` | Tailwind v4 theme with CSS custom properties for theming |

### Backend (`src-tauri/src/`)

| Module | Purpose |
|--------|---------|
| `lib.rs` | Tauri builder — plugins, tray icon, commands |
| `state.rs` | App state: RD client, settings, active downloads, cancel tokens |
| `api/` | Real-Debrid REST API client (torrents, unrestrict, downloads) |
| `commands/` | Tauri `#[command]` bridge functions (auth, torrents, downloads, settings, search) |
| `downloader.rs` | File download engine with progress events and cancellation |
| `scrapers/` | Torrent tracker search aggregation |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://v2.tauri.app) |
| Frontend | React 19, TypeScript, Tailwind CSS v4, React Router v7 |
| Backend | Rust, Tokio, Reqwest |
| API Storage | OS Keychain (`keyring` crate) |
| Packaging | NSIS (Windows), DMG (macOS), DEB/AppImage (Linux) |
| CI/CD | GitHub Actions — build, sign, notarize, release |

## License

MIT
