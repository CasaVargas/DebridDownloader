# ⚡ DebridDownloader

> 🚀 A blazing-fast, native desktop client for managing torrents and downloads through [Real-Debrid](https://real-debrid.com), [TorBox](https://torbox.app), and [Premiumize](https://premiumize.me). Built with Tauri, React, and Rust.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-GPL--3.0-green?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.6.0-orange?style=for-the-badge)
![Rust](https://img.shields.io/badge/rust-%23000000.svg?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Tauri](https://img.shields.io/badge/tauri-%2324C8DB.svg?style=for-the-badge&logo=tauri&logoColor=%23FFFFFF)
![Real-Debrid](https://img.shields.io/badge/Real--Debrid-77C351?style=for-the-badge)
![TorBox](https://img.shields.io/badge/TorBox-3b82f6?style=for-the-badge)
![Premiumize](https://img.shields.io/badge/Premiumize-ff6600?style=for-the-badge)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/SsDDexkhUx)

---

## ✨ Features

| | Feature | Description |
|---|---------|-------------|
| 🧲 | **Torrent Management** | Add magnets or `.torrent` files, select files, monitor progress |
| 🔗 | **Magnet Link Handler** | Set as default magnet handler — links add to torrents instantly |
| 🔍 | **User-Configured Search** | Add your own tracker sources in Settings — the app ships with none |
| 📡 | **Torznab Support** | Connect private trackers via Torznab API with API key auth |
| 📥 | **Download Engine** | Multi-threaded downloads with real-time speed, ETA, and progress |
| 🔄 | **Auto-Updater** | In-app updates — never miss a release |
| 🎯 | **System Tray** | Runs in the background with menu bar / system tray icon |
| 🚀 | **Launch at Login** | Optionally start when your computer boots |
| ⌨️ | **Keyboard First** | `⌘K` search, `⌘R` refresh, arrow nav, `Enter` to download |
| 🌗 | **Dark & Light Mode** | Full theme support with CSS variable-driven theming |
| 🎨 | **6 Accent Colors** | Emerald, Blue, Violet, Rose, Amber, Cyan |
| 🔐 | **Signed & Notarized** | macOS builds signed with Developer ID & notarized by Apple |
| 💾 | **Secure Token Storage** | API tokens stored in OS keychain, not plain text |

---

## 🌐 Website

**[casavargas.app/DebridDownloader](https://casavargas.app/DebridDownloader/)** — screenshots, download links, and feature overview.

---

## 📦 Download

<table>
<tr><th>Platform</th><th>Architecture</th><th>Download</th></tr>
<tr><td>🍎 macOS</td><td>Apple Silicon (M1/M2/M3/M4)</td><td><a href="https://github.com/CasaVargas/DebridDownloader/releases/latest"><code>.dmg</code></a></td></tr>
<tr><td>🪟 Windows</td><td>x64</td><td><a href="https://github.com/CasaVargas/DebridDownloader/releases/latest"><code>.exe</code> installer</a></td></tr>
<tr><td>🪟 Windows</td><td>ARM64</td><td><a href="https://github.com/CasaVargas/DebridDownloader/releases/latest"><code>.exe</code> installer</a></td></tr>
<tr><td>🐧 Linux</td><td>x64</td><td><a href="https://github.com/CasaVargas/DebridDownloader/releases/latest"><code>.deb</code> / <code>.AppImage</code></a></td></tr>
</table>

---

## 📋 Requirements

- 🔑 A [Real-Debrid](https://real-debrid.com), [TorBox](https://torbox.app), or [Premiumize](https://premiumize.me) premium account
- 💻 macOS 11+ / Windows 10+ / Modern Linux distro

---

## 🏁 Getting Started

1. 📥 Download and install for your platform
2. 🚀 Launch DebridDownloader
3. 🔐 Connect your debrid provider:
   - **Real-Debrid** — API token from [real-debrid.com/apitoken](https://real-debrid.com/apitoken) or OAuth login
   - **TorBox** — API token from [torbox.app](https://torbox.app)
   - **Premiumize** — API key from [premiumize.me/account](https://www.premiumize.me/account)
4. ⚙️ (Optional) Add tracker sources in **Settings > Trackers** to enable search
5. 🧲 Start adding torrents and downloading!

---

## 🎮 Usage

### 🧲 Adding Torrents

- Click **+ Add Torrent** to paste a magnet link or upload a `.torrent` file
- Use **Search** (`⌘K`) to find torrents across your configured trackers
- Paste a magnet link directly into the search bar — it gets added instantly

### 🔍 Configuring Search Trackers

The app **ships with no trackers built in**. You add your own sources in **Settings > Trackers**:

1. Go to **Settings** in the sidebar
2. Scroll to the **Trackers** section
3. Enter a name, base URL, select the type, and click **Add**
4. Supported types:
   - **PirateBay API** — sites with a TPB-compatible JSON API (`/q.php?q=query`)
   - **Torznab** — private trackers with Torznab API support (requires API key)

You can add multiple trackers — searches run in parallel across all enabled sources. Each tracker can be toggled on/off individually.

### 📥 Managing Downloads

- 📋 **Torrents** — all your torrents with sortable columns (name, size, date, status)
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
| 🔍 Trackers | Add/remove/toggle your own torrent search sources |
| 🚀 Launch at login | Start with your computer |
| 🔔 Notifications | Get notified when downloads complete |
| 🌗 Theme | Dark or light mode |
| 🎨 Accent color | Emerald 💚 Blue 💙 Violet 💜 Rose 🩷 Amber 🧡 Cyan 🩵 |

---

## ⚖️ Legal

DebridDownloader is a **download management tool**. It:

- ✅ Provides an interface to the [Real-Debrid API](https://api.real-debrid.com/) and [TorBox API](https://api.torbox.app) — legitimate paid services
- ✅ Ships with **zero torrent tracker sources** — users bring their own
- ✅ Does not host, index, or distribute any copyrighted content
- ✅ Does not include any hardcoded tracker URLs, scraper targets, or search endpoints
- ✅ Functions similarly to other download managers like JDownloader, Internet Download Manager, or aria2

The app is a neutral tool. Users are responsible for how they use it and what sources they configure. The developers do not endorse or encourage piracy.

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
git clone https://github.com/CasaVargas/DebridDownloader.git
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
| `styles/` | 🎨 Tailwind v4 theme + CSS custom properties for theming |

### ⚙️ Backend (`src-tauri/src/`)

| Module | Purpose |
|--------|---------|
| `lib.rs` | 🏗️ Tauri builder — plugins, tray icon, commands |
| `state.rs` | 💾 App state: RD client, settings, downloads, cancel tokens |
| `providers/` | 🌐 Debrid provider clients (Real-Debrid, TorBox) |
| `commands/` | 🔌 Tauri `#[command]` bridge functions |
| `downloader.rs` | 📥 Download engine with progress events + cancellation |
| `scrapers/` | 🔍 User-configurable tracker search (API-based) |

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

GPL-3.0 — see [LICENSE](LICENSE) for details.

---

## 🏠 More from Casa Vargas

| | Project | Description |
|---|---------|-------------|
| 📄 | **[OneScribe](https://getonescribe.app)** | AI-powered document scanner for iOS — 83 document types, fully on-device processing, no cloud required |
| 🌐 | **[casavargas.app](https://casavargas.app)** | All our projects and apps |

---

<p align="center">
  <b>Made with 🦀 Rust + ⚛️ React + 💚 Real-Debrid + 💙 TorBox</b>
  <br>
  <sub>Built by <a href="https://casavargas.app">Casa Vargas</a></sub>
  <br>
  <sub>💬 <a href="https://discord.gg/SsDDexkhUx">Join our Discord</a></sub>
</p>
