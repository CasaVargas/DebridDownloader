# ⚡ DebridDownloader

> 🚀 A blazing-fast, native desktop client for managing torrents and downloads through [Real-Debrid](https://real-debrid.com). Built with Tauri, React, and Rust.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Version](https://img.shields.io/badge/version-0.1.0-orange?style=for-the-badge)
![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Tauri](https://img.shields.io/badge/tauri-%2324C8DB.svg?style=for-the-badge&logo=tauri&logoColor=%23FFFFFF)

---

## ✨ Features

| | Feature | Description |
|---|---------|-------------|
| 🧲 | **Torrent Management** | Add magnets or `.torrent` files, select files, monitor progress |
| 🔍 | **Tracker Search** | Search multiple torrent trackers and add results with one click |
| 📥 | **Download Engine** | Multi-threaded downloads with real-time speed, ETA, and progress |
| 🎯 | **System Tray** | Runs in the background with menu bar / system tray icon |
| 🚀 | **Launch at Login** | Optionally start when your computer boots |
| ⌨️ | **Keyboard First** | `⌘K` search, `⌘R` refresh, arrow nav, `Enter` to download |
| 🌗 | **Dark & Light Mode** | Full theme support with smooth transitions |
| 🎨 | **6 Accent Colors** | Emerald, Blue, Violet, Rose, Amber, Cyan |
| 🔐 | **Signed & Notarized** | macOS builds signed with Developer ID & notarized by Apple |
| 💾 | **Secure Token Storage** | API tokens stored in OS keychain, not plain text |

---

## 📸 Screenshots

<!-- TODO: Add screenshots -->

---

## 📦 Download

<table>
<tr><th>Platform</th><th>Architecture</th><th>Download</th></tr>
<tr><td>🍎 macOS</td><td>Apple Silicon (M1/M2/M3/M4)</td><td><a href="https://github.com/prjoni99/DebridDownloader/releases/latest"><code>.dmg</code></a></td></tr>
<tr><td>🍎 macOS</td><td>Intel</td><td><a href="https://github.com/prjoni99/DebridDownloader/releases/latest"><code>.dmg</code></a></td></tr>
<tr><td>🪟 Windows</td><td>x64</td><td><a href="https://github.com/prjoni99/DebridDownloader/releases/latest"><code>.exe</code> installer</a></td></tr>
<tr><td>🪟 Windows</td><td>ARM64</td><td><a href="https://github.com/prjoni99/DebridDownloader/releases/latest"><code>.exe</code> installer</a></td></tr>
<tr><td>🐧 Linux</td><td>x64</td><td><a href="https://github.com/prjoni99/DebridDownloader/releases/latest"><code>.deb</code> / <code>.AppImage</code></a></td></tr>
</table>

---

## 📋 Requirements

- 🔑 A [Real-Debrid](https://real-debrid.com) premium account
- 💻 macOS 11+ / Windows 10+ / Modern Linux distro

---

## 🏁 Getting Started

1. 📥 Download and install for your platform
2. 🚀 Launch DebridDownloader
3. 🔐 Connect your Real-Debrid account:
   - **API Token** — paste from [real-debrid.com/apitoken](https://real-debrid.com/apitoken)
   - **OAuth Login** — authorize via browser (device code flow)
4. 🧲 Start adding torrents and downloading!

---

## 🎮 Usage

### 🧲 Adding Torrents

- Click **+ Add Torrent** to paste a magnet link or upload a `.torrent` file
- Use **Search** (`⌘K`) to find torrents across multiple trackers
- Paste a magnet link directly into the search bar — it gets added instantly

### 📥 Managing Downloads

- 📋 **Torrents** — all your Real-Debrid torrents with sortable columns (name, size, date, status)
- ⬇️ **Downloads** — active downloads with live speed, ETA, and progress bars
- ✅ **Completed** — finished downloads with "Reveal in Finder" to locate files
- 🔎 **Search** — integrated tracker search with seeder counts and one-click add

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|:--------:|--------|
| `⌘K` | 🔍 Open search |
| `⌘R` | 🔄 Refresh current view |
| `Esc` | ❌ Close panel / deselect |
| `Enter` | 📥 Download selected torrent |
| `Delete` | 🗑️ Delete selected item |
| `Tab` | 🔀 Switch search mode (in search view) |
| `↑↓` | 🔼🔽 Navigate results |

### ⚙️ Settings

| Setting | Description |
|---------|-------------|
| 📁 Download folder | Set default location or get prompted each time |
| 🔢 Max concurrent | Control parallel downloads (1-10) |
| 📂 Subfolders | Organize files into torrent-named folders |
| ⚡ Auto-start | Automatically download when torrents are ready |
| 🚀 Launch at login | Start with your computer |
| 🔔 Notifications | Get notified when downloads complete |
| 🌗 Theme | Dark or light mode |
| 🎨 Accent color | Emerald 💚 Blue 💙 Violet 💜 Rose 🩷 Amber 🧡 Cyan 🩵 |

---

## 🛠️ Development

### Prerequisites

| Tool | Version |
|------|---------|
| [Node.js](https://nodejs.org) | 22+ |
| [Rust](https://rustup.rs) | stable |

**Platform-specific:**
- 🍎 **macOS**: `xcode-select --install`
- 🐧 **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
- 🪟 **Windows**: [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Win 10/11)

### Setup

```bash
git clone https://github.com/prjoni99/DebridDownloader.git
cd DebridDownloader
npm install
```

### 🔥 Dev Server

```bash
npm run tauri dev
```

> Starts Vite dev server (hot reload) + Tauri window

### 📦 Build

```bash
npm run tauri build
```

> Produces platform-specific installers in `src-tauri/target/release/bundle/`

### ✅ Type Check

```bash
npx tsc --noEmit
```

---

## 🏗️ Architecture

### Two-Process Model (Tauri v2)

```
┌──────────────────────────────────────────────────┐
│                                                  │
│   🌐 Frontend (React 19 + TypeScript)            │
│   Vite + Tailwind CSS v4 + React Router v7       │
│                                                  │
│          invoke() ◄──── IPC ────► #[command]      │
│                                                  │
│   ⚙️  Backend (Rust)                              │
│   Real-Debrid API · File Downloads · Keyring     │
│   Plugins: opener, dialog, fs, store, autostart  │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 🌐 Frontend (`src/`)

| Path | Purpose |
|------|---------|
| `pages/` | 📄 Route views: Torrents, Downloads, Completed, Search, Settings, Auth |
| `components/` | 🧩 Shared UI: Sidebar, DataTable, SlideOverPanel, TableToolbar |
| `hooks/` | 🪝 Auth context, download polling, theme/accent management |
| `api/` | 📡 Thin `invoke()` wrappers — one file per domain |
| `types/` | 📝 TypeScript interfaces mirroring Rust types |
| `styles/` | 🎨 Tailwind v4 theme + CSS custom properties |

### ⚙️ Backend (`src-tauri/src/`)

| Module | Purpose |
|--------|---------|
| `lib.rs` | 🏗️ Tauri builder — plugins, tray icon, commands |
| `state.rs` | 💾 App state: RD client, settings, downloads, cancel tokens |
| `api/` | 🌐 Real-Debrid REST API client |
| `commands/` | 🔌 Tauri `#[command]` bridge functions |
| `downloader.rs` | 📥 Download engine with progress events + cancellation |
| `scrapers/` | 🔍 Torrent tracker search aggregation |

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| 🏗️ Framework | [Tauri v2](https://v2.tauri.app) |
| 🌐 Frontend | React 19 · TypeScript · Tailwind CSS v4 · React Router v7 |
| ⚙️ Backend | Rust · Tokio · Reqwest |
| 🔐 Token Storage | OS Keychain (`keyring` crate) |
| 📦 Packaging | NSIS (Windows) · DMG (macOS) · DEB/AppImage (Linux) |
| 🚀 CI/CD | GitHub Actions — build, sign, notarize, release |

---

## 📄 License

MIT — do whatever you want with it.

---

<p align="center">
  <b>Made with 🦀 Rust + ⚛️ React + 💚 Real-Debrid</b>
  <br>
  <sub>Built by <a href="https://github.com/prjoni99">Jonathan Vargas</a></sub>
</p>
