# UI Redesign + Torrent Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the app's visual design with a refined dark+glow theme, and add a torrent search feature that scrapes public trackers from Rust.

**Architecture:** The UI redesign touches all existing frontend files (CSS theme, Layout, all pages, all modals). The search feature adds a new Rust scraper module with a trait-based design, a new Tauri command, and a new React page. Both share the updated design system.

**Tech Stack:** Tauri v2, React 19, TypeScript, Tailwind CSS v4, Rust (reqwest, scraper crate, tokio, futures)

**Spec:** `docs/superpowers/specs/2026-03-14-ui-redesign-and-search-design.md`

---

## Chunk 1: Design System + Sidebar + Auth Page

### Task 1: Update CSS Design System

**Files:**
- Modify: `src/styles/index.css`

- [ ] **Step 1: Add new theme tokens and gradient utilities**

Add these tokens inside the existing `@theme` block in `src/styles/index.css`:

```css
--color-rd-card-gradient-start: #1e1e34;
--color-rd-card-gradient-end: #1a1a2c;
--color-rd-sidebar-start: #141428;
--color-rd-sidebar-end: #0f0f1e;
--color-rd-border-soft: rgba(255, 255, 255, 0.06);
--color-rd-border-hover: rgba(255, 255, 255, 0.12);
--shadow-glow-green: 0 0 20px rgba(120, 190, 32, 0.15), 0 0 4px rgba(120, 190, 32, 0.1);
--shadow-glow-blue: 0 0 20px rgba(59, 130, 246, 0.15), 0 0 4px rgba(59, 130, 246, 0.1);
--shadow-glow-red: 0 0 20px rgba(239, 68, 68, 0.15), 0 0 4px rgba(239, 68, 68, 0.1);
--shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
--shadow-card-hover: 0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
```

Also add these utility classes after the existing CSS in the same file:

```css
/* Card base */
.card-base {
  background: linear-gradient(135deg, var(--color-rd-card-gradient-start), var(--color-rd-card-gradient-end));
  border: 1px solid var(--color-rd-border-soft);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  transition: all 0.2s ease;
}

.card-base:hover {
  border-color: var(--color-rd-border-hover);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

/* Gradient progress bars */
.progress-bar-blue {
  background: linear-gradient(90deg, #2563eb, #38bdf8);
  border-radius: 9999px;
}

.progress-bar-green {
  background: linear-gradient(90deg, #78be20, #9adf3a);
  border-radius: 9999px;
}

/* Glow dot animations */
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 4px currentColor, 0 0 8px currentColor; opacity: 1; }
  50% { box-shadow: 0 0 8px currentColor, 0 0 16px currentColor; opacity: 0.7; }
}

.glow-dot-active {
  animation: glow-pulse 2s ease-in-out infinite;
}

/* Skeleton loading animation */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(90deg, var(--color-rd-card) 25%, var(--color-rd-card-hover) 50%, var(--color-rd-card) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

/* Modal transitions */
.modal-backdrop {
  animation: fade-in 0.2s ease;
}

.modal-content {
  animation: slide-up 0.25s ease;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
```

- [ ] **Step 2: Verify the app still compiles and renders**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/index.css
git commit -m "feat: add refined design system tokens, glow shadows, and utility classes"
```

---

### Task 2: Redesign Sidebar (Layout.tsx)

**Files:**
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: Update the sidebar with gradient background, glow nav items, avatar, and premium expiry**

Rewrite `Layout.tsx` with these changes:
- `aside` background: use `bg-gradient-to-b from-[var(--color-rd-sidebar-start)] to-[var(--color-rd-sidebar-end)]` instead of flat `bg-rd-dark`
- Active nav item: add a left green accent bar (`border-l-2 border-rd-green`) and green glow background (`bg-rd-green/10 shadow-[var(--shadow-glow-green)]`)
- User section: show avatar image from `user.avatar` with fallback to initials (first letter of username in a green circle). Show premium expiry below username as `Premium until {date}` in `text-zinc-600 text-[11px]`
- The `useAuth` hook provides `user` which has `avatar: string`, `username: string`, `expiration: string`, and `premium: number`
- Add the "Search" nav item between "Torrents" and "Downloads" with a magnifying glass SVG icon, path `/search`
- Increase padding: sidebar `px-3` → `px-4`, nav items `py-2.5` → `py-2.5` (keep), gap between branding and nav `py-4` → `py-5`

The Search nav item SVG icon:
```tsx
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <circle cx="11" cy="11" r="8" />
  <line x1="21" y1="21" x2="16.65" y2="16.65" />
</svg>
```

Avatar fallback logic:
```tsx
{user && (
  <div className="mt-3 flex items-center gap-2.5 px-1">
    {user.avatar ? (
      <img src={user.avatar} alt="" className="w-8 h-8 rounded-full" />
    ) : (
      <div className="w-8 h-8 rounded-full bg-rd-green/20 text-rd-green flex items-center justify-center text-xs font-bold">
        {user.username.charAt(0).toUpperCase()}
      </div>
    )}
    <div className="min-w-0">
      <p className="text-xs text-zinc-300 font-medium truncate">{user.username}</p>
      {user.expiration && (
        <p className="text-[11px] text-zinc-600 truncate">
          Premium until {new Date(user.expiration).toLocaleDateString()}
        </p>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 2: Verify sidebar renders correctly**

Run: `npm run build`
Expected: Build succeeds. The sidebar should show gradient background, new search nav item, and user avatar section.

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout.tsx
git commit -m "feat: redesign sidebar with gradient bg, glow nav, avatar, search tab"
```

---

### Task 3: Redesign Auth Page

**Files:**
- Modify: `src/pages/AuthPage.tsx`

- [ ] **Step 1: Apply refined styling to the auth page**

Update `AuthPage.tsx`:
- Outer container: keep `bg-rd-darker` but add a subtle radial gradient overlay: `bg-[radial-gradient(ellipse_at_center,rgba(120,190,32,0.04)_0%,transparent_70%)]`
- Login card: replace `bg-rd-dark` with `card-base` class + `bg-gradient-to-b from-[#1a1a30] to-[#141428]`. Add `shadow-[var(--shadow-glow-green)]` for a subtle green glow around the card
- Logo/title area: make the green "DebridDownloader" text slightly larger (`text-3xl` → `text-4xl`), add a small download icon above it
- Mode toggle: softer styling — replace the hard `bg-rd-green` active state with `bg-rd-green/20 text-rd-green border border-rd-green/30` for a more subtle selected state
- Input fields: add `focus:shadow-[var(--shadow-glow-green)]` for green glow on focus
- Buttons: keep existing `bg-rd-green` but add `shadow-lg shadow-rd-green/25` for glow
- Add the `modal-content` class to the card for a subtle entrance animation

- [ ] **Step 2: Verify auth page renders**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AuthPage.tsx
git commit -m "feat: redesign auth page with gradient card and glow effects"
```

---

## Chunk 2: Torrent + Download + History + Settings Page Redesigns

### Task 4: Redesign Torrents Page

**Files:**
- Modify: `src/pages/TorrentsPage.tsx`

- [ ] **Step 1: Update torrent cards and page layout**

Changes to `TorrentsPage.tsx`:
- Page header: `text-2xl` → `text-3xl`, add `tracking-tight`
- Stats line: style the "X ready" count as a subtle green pill badge: `bg-rd-green/10 text-rd-green px-2 py-0.5 rounded-full text-xs font-medium`
- Action bar: apply `card-base` class instead of `bg-rd-card border border-rd-border rounded-xl`
- Torrent row cards: apply `card-base` class. Remove the flat `bg-rd-card border-rd-border` classes
- Status dot: for `downloading` status, add `glow-dot-active` class alongside `bg-blue-400`. For `downloaded`, add a subtle green glow: `shadow-[0_0_6px_rgba(74,222,128,0.4)]`
- Progress bar: replace `bg-blue-500` with the `progress-bar-blue` class
- Delete button: keep reveal-on-hover, but use `hover:shadow-[var(--shadow-glow-red)]` for red glow on hover
- Empty state: replace the bland icon with a more inviting illustration — a dashed-border rounded box with a large download arrow, styled with green accents. Update copy: "No torrents yet" / "Search for torrents or add a magnet link to get started"

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/TorrentsPage.tsx
git commit -m "feat: redesign torrents page with glow cards and refined layout"
```

---

### Task 5: Redesign Downloads Page

**Files:**
- Modify: `src/pages/DownloadsPage.tsx`

- [ ] **Step 1: Add stats bar and update card styling**

Changes to `DownloadsPage.tsx`:
- Page header: `text-2xl` → `text-3xl`, add `tracking-tight`
- Stats: replace the inline text stats with pill badges:
  ```tsx
  <div className="flex items-center gap-2 mt-2">
    <span className="bg-blue-500/10 text-blue-400 px-2.5 py-0.5 rounded-full text-xs font-medium">
      {activeTasks.length} active
    </span>
    <span className="bg-green-500/10 text-green-400 px-2.5 py-0.5 rounded-full text-xs font-medium">
      {completedTasks.length} completed
    </span>
    {totalSpeed > 0 && (
      <span className="bg-rd-green/10 text-rd-green px-2.5 py-0.5 rounded-full text-xs font-medium">
        {formatSpeed(totalSpeed)}
      </span>
    )}
  </div>
  ```
- Active download cards: apply `card-base` class. Progress bar: use `progress-bar-blue` class instead of `bg-gradient-to-r from-blue-600 to-blue-400`
- Progress bar track: `bg-rd-darker` → `bg-black/30 rounded-full`; increase height `h-2` → `h-2.5`
- Completed cards: apply `card-base` class with reduced opacity: `opacity-80`
- Failed cards: apply `card-base` with red glow: `shadow-[var(--shadow-glow-red)]`
- Empty state: update icon and copy similar to torrents page

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/DownloadsPage.tsx
git commit -m "feat: redesign downloads page with pill badges and glow cards"
```

---

### Task 6: Redesign History Page

**Files:**
- Modify: `src/pages/HistoryPage.tsx`

- [ ] **Step 1: Update card styling and date formatting**

Changes to `HistoryPage.tsx`:
- Page header: `text-2xl` → `text-3xl`, add `tracking-tight`
- History item cards: apply `card-base` class instead of `bg-rd-card border border-rd-border rounded-xl`
- File icon container: `bg-rd-surface` → `bg-rd-green/10`, icon stroke color → `text-rd-green/60`
- Date display: use `toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })` for better formatting like "Mar 14, 2026"
- Pagination buttons: apply card-base-like styling with `bg-gradient-to-b from-rd-card-gradient-start to-rd-card-gradient-end`
- Empty state: match updated empty state styling from other pages

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/HistoryPage.tsx
git commit -m "feat: redesign history page with refined cards and date formatting"
```

---

### Task 7: Redesign Settings Page

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Update settings cards and visual grouping**

Changes to `SettingsPage.tsx`:
- Page header: `text-2xl` → `text-3xl`, add `tracking-tight`
- Settings cards: apply `card-base` class instead of `bg-rd-card border border-rd-border rounded-xl`
- Section labels: increase weight, add a subtle green left border: `border-l-2 border-rd-green/30 pl-3`
- Browse button: add hover glow effect
- Select dropdown: `bg-rd-darker` → gradient background matching card internals
- Save button: add `shadow-[var(--shadow-glow-green)]` for green glow
- "Saved!" state: add a brief green glow pulse animation

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: redesign settings page with refined cards and visual grouping"
```

---

### Task 8: Redesign Modals (AddTorrentModal + TorrentDetail)

**Files:**
- Modify: `src/components/AddTorrentModal.tsx`
- Modify: `src/components/TorrentDetail.tsx`

- [ ] **Step 1: Update AddTorrentModal styling**

Changes to `AddTorrentModal.tsx`:
- Backdrop: add `modal-backdrop` class to the overlay div
- Modal card: add `modal-content` class. Replace `bg-rd-dark border border-rd-border rounded-2xl` with `card-base` + `bg-gradient-to-b from-[#1e1e38] to-[#161628]`
- Textarea: add `focus:shadow-[var(--shadow-glow-green)]` glow effect
- "Add Magnet" button: add `shadow-[var(--shadow-glow-green)]`
- Upload button: replace dashed border with `card-base` + subtle hover glow
- Error display: add `shadow-[var(--shadow-glow-red)]`

- [ ] **Step 2: Update TorrentDetail modal styling**

Changes to `TorrentDetail.tsx`:
- Backdrop: add `modal-backdrop` class
- Modal card: add `modal-content` class. Replace `bg-rd-dark border border-rd-border rounded-2xl` with `card-base` + gradient background
- Info grid cards (`bg-rd-surface rounded-lg`): replace with subtle gradient: `bg-gradient-to-b from-white/[0.03] to-transparent border border-rd-border-soft rounded-lg`
- File list: softer styling with `border-rd-border-soft`
- Footer buttons: add appropriate glow shadows (green for download, blue for select)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/AddTorrentModal.tsx src/components/TorrentDetail.tsx
git commit -m "feat: redesign modals with gradient cards and entrance animations"
```

---

## Chunk 3: Rust Scraper Backend

### Task 9: Add `scraper` Dependency and Create Scraper Module Skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/scrapers/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod scrapers;`)

- [ ] **Step 1: Add the `scraper` crate to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:
```toml
scraper = "0.22"
```

- [ ] **Step 2: Create `src-tauri/src/scrapers/mod.rs` with types, trait, utility, and aggregator**

```rust
pub mod piratebay;
pub mod thirteen37x;

use futures::future::join_all;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub magnet: String,
    pub info_hash: String,
    pub size_bytes: u64,
    pub size_display: String,
    pub seeders: u32,
    pub leechers: u32,
    pub date: String,
    pub source: String,
    pub category: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchParams {
    pub query: String,
    pub category: Option<String>,
    pub sort_by: Option<String>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerStatus {
    pub name: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub tracker_status: Vec<TrackerStatus>,
}

#[derive(Debug, thiserror::Error)]
pub enum ScraperError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Scraper timed out after {0}s")]
    Timeout(u64),
    #[error("Tracker returned CAPTCHA or block page")]
    Blocked,
}

// ── Trait ──

pub trait TorrentScraper: Send + Sync {
    fn name(&self) -> &str;
    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>>;
}

// ── Utilities ──

/// Extract info_hash from a magnet URI and normalize to lowercase hex.
pub fn extract_info_hash(magnet: &str) -> Option<String> {
    let magnet_lower = magnet.to_lowercase();
    let xt_start = magnet_lower.find("xt=urn:btih:")?;
    let hash_start = xt_start + "xt=urn:btih:".len();
    let rest = &magnet[hash_start..];
    let hash_end = rest.find('&').unwrap_or(rest.len());
    let hash = &rest[..hash_end];
    if hash.is_empty() {
        return None;
    }
    // Could be base32 encoded (40 char hex or 32 char base32)
    Some(hash.to_lowercase())
}

/// Format bytes into human-readable string.
pub fn format_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    if bytes == 0 {
        return "0 B".to_string();
    }
    let exp = (bytes as f64).log(1024.0).floor() as usize;
    let exp = exp.min(UNITS.len() - 1);
    let size = bytes as f64 / 1024_f64.powi(exp as i32);
    format!("{:.1} {}", size, UNITS[exp])
}

// ── Aggregator ──

const SCRAPER_TIMEOUT_SECS: u64 = 10;

pub async fn search_all(params: &SearchParams) -> SearchResponse {
    let scrapers: Vec<Box<dyn TorrentScraper>> = vec![
        Box::new(piratebay::PirateBayScraper::new()),
        Box::new(thirteen37x::Thirteen37xScraper::new()),
    ];

    let futures: Vec<_> = scrapers
        .into_iter()
        .map(|scraper| {
            let name = scraper.name().to_string();
            let params = params.clone();
            async move {
                let result = tokio::time::timeout(
                    Duration::from_secs(SCRAPER_TIMEOUT_SECS),
                    scraper.search(&params),
                )
                .await;

                match result {
                    Ok(Ok(results)) => (
                        results,
                        TrackerStatus { name, ok: true, error: None },
                    ),
                    Ok(Err(e)) => (
                        vec![],
                        TrackerStatus { name, ok: false, error: Some(e.to_string()) },
                    ),
                    Err(_) => (
                        vec![],
                        TrackerStatus {
                            name,
                            ok: false,
                            error: Some(format!("Timed out after {}s", SCRAPER_TIMEOUT_SECS)),
                        },
                    ),
                }
            }
        })
        .collect();

    let outcomes = join_all(futures).await;

    let mut tracker_status = Vec::new();
    let mut all_results = Vec::new();

    for (results, status) in outcomes {
        tracker_status.push(status);
        all_results.extend(results);
    }

    // Deduplicate by info_hash
    let mut seen = std::collections::HashSet::new();
    all_results.retain(|r| {
        if r.info_hash.is_empty() {
            return true; // keep results without hash (can't dedupe)
        }
        seen.insert(r.info_hash.clone())
    });

    // Sort
    let sort_by = params.sort_by.as_deref().unwrap_or("seeders");
    match sort_by {
        "size" => all_results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes)),
        "date" => all_results.sort_by(|a, b| b.date.cmp(&a.date)),
        _ => all_results.sort_by(|a, b| b.seeders.cmp(&a.seeders)),
    }

    SearchResponse {
        results: all_results,
        tracker_status,
    }
}
```

- [ ] **Step 3: Add `mod scrapers;` to `src-tauri/src/lib.rs`**

Add `mod scrapers;` after the existing module declarations at the top of `lib.rs`:
```rust
mod api;
mod commands;
mod downloader;
mod scrapers;  // ← add this line
mod state;
```

- [ ] **Step 4: Create empty scraper files so it compiles**

Create `src-tauri/src/scrapers/piratebay.rs`:
```rust
use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use std::future::Future;
use std::pin::Pin;

pub struct PirateBayScraper {
    client: reqwest::Client,
}

impl PirateBayScraper {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/0.1.0")
                .build()
                .expect("Failed to create HTTP client"),
        }
    }
}

impl TorrentScraper for PirateBayScraper {
    fn name(&self) -> &str {
        "The Pirate Bay"
    }

    fn search(
        &self,
        _params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        Box::pin(async move {
            Ok(vec![]) // placeholder
        })
    }
}
```

Create `src-tauri/src/scrapers/thirteen37x.rs`:
```rust
use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use std::future::Future;
use std::pin::Pin;

pub struct Thirteen37xScraper {
    client: reqwest::Client,
}

impl Thirteen37xScraper {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/0.1.0")
                .build()
                .expect("Failed to create HTTP client"),
        }
    }
}

impl TorrentScraper for Thirteen37xScraper {
    fn name(&self) -> &str {
        "1337x"
    }

    fn search(
        &self,
        _params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        Box::pin(async move {
            Ok(vec![]) // placeholder
        })
    }
}
```

- [ ] **Step 5: Verify the Rust project compiles**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader/src-tauri && cargo check`
Expected: Compiles successfully with no errors (warnings OK).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/scrapers/
git commit -m "feat: add scraper module skeleton with types, trait, and aggregator"
```

---

### Task 10: Implement The Pirate Bay Scraper (apibay.org JSON API)

**Files:**
- Modify: `src-tauri/src/scrapers/piratebay.rs`

- [ ] **Step 1: Implement the full PirateBay scraper**

Replace the placeholder in `piratebay.rs` with the full implementation:

```rust
use super::{extract_info_hash, format_size, SearchParams, SearchResult, ScraperError, TorrentScraper};
use serde::Deserialize;
use std::future::Future;
use std::pin::Pin;

const API_BASE: &str = "https://apibay.org";

// Standard BitTorrent tracker list for constructing magnet URIs
const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969",
    "udp://open.demonii.si:1337/announce",
];

#[derive(Debug, Deserialize)]
struct ApiResult {
    #[serde(default)]
    name: String,
    #[serde(default)]
    info_hash: String,
    #[serde(default)]
    seeders: String,
    #[serde(default)]
    leechers: String,
    #[serde(default)]
    size: String,
    #[serde(default)]
    added: String,
    #[serde(default)]
    category: String,
}

pub struct PirateBayScraper {
    client: reqwest::Client,
}

impl PirateBayScraper {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/0.1.0")
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    fn category_code(category: Option<&str>) -> &'static str {
        match category {
            Some("movies") => "207",   // HD Movies
            Some("tv") => "208",       // HD TV
            Some("games") => "400",    // Games
            Some("software") => "300", // Applications
            Some("music") => "100",    // Audio
            _ => "0",                  // All
        }
    }

    fn map_category(code: &str) -> String {
        match code {
            c if c.starts_with('1') => "Music".to_string(),
            c if c.starts_with('2') => "Movies".to_string(),
            c if c.starts_with('3') => "Software".to_string(),
            c if c.starts_with('4') => "Games".to_string(),
            c if c.starts_with('5') => "TV".to_string(),
            c if c.starts_with('6') => "Other".to_string(),
            _ => "Other".to_string(),
        }
    }

    fn build_magnet(info_hash: &str, name: &str) -> String {
        let encoded_name = urlencoding::encode(name);
        let trackers: String = TRACKERS
            .iter()
            .map(|t| format!("&tr={}", urlencoding::encode(t)))
            .collect();
        format!(
            "magnet:?xt=urn:btih:{}&dn={}{}",
            info_hash, encoded_name, trackers
        )
    }
}

impl TorrentScraper for PirateBayScraper {
    fn name(&self) -> &str {
        "The Pirate Bay"
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            let cat = Self::category_code(params.category.as_deref());
            let url = format!("{}/q.php?q={}&cat={}", API_BASE, urlencoding::encode(&params.query), cat);

            let resp = self.client.get(&url).send().await?;
            let text = resp.text().await?;

            // Check for block/captcha
            if text.contains("<!DOCTYPE") || text.contains("<html") {
                return Err(ScraperError::Blocked);
            }

            let api_results: Vec<ApiResult> = serde_json::from_str(&text)
                .map_err(|e| ScraperError::ParseError(e.to_string()))?;

            let results: Vec<SearchResult> = api_results
                .into_iter()
                .filter(|r| r.name != "No results returned" && !r.info_hash.is_empty())
                .map(|r| {
                    let size_bytes: u64 = r.size.parse().unwrap_or(0);
                    let magnet = Self::build_magnet(&r.info_hash, &r.name);
                    let info_hash = r.info_hash.to_lowercase();
                    let seeders: u32 = r.seeders.parse().unwrap_or(0);
                    let leechers: u32 = r.leechers.parse().unwrap_or(0);

                    // Convert unix timestamp to date string
                    let date = chrono::DateTime::from_timestamp_opt(
                        r.added.parse::<i64>().unwrap_or(0), 0
                    )
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();

                    SearchResult {
                        title: r.name,
                        magnet,
                        info_hash,
                        size_bytes,
                        size_display: format_size(size_bytes),
                        seeders,
                        leechers,
                        date,
                        source: "The Pirate Bay".to_string(),
                        category: Self::map_category(&r.category),
                    }
                })
                .collect();

            Ok(results)
        })
    }
}
```

- [ ] **Step 2: Add `urlencoding` dependency to Cargo.toml**

Add to `[dependencies]`:
```toml
urlencoding = "2"
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader/src-tauri && cargo check`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/scrapers/piratebay.rs
git commit -m "feat: implement PirateBay scraper via apibay.org JSON API"
```

---

### Task 11: Implement 1337x Scraper (HTML Scraping)

**Files:**
- Modify: `src-tauri/src/scrapers/thirteen37x.rs`

- [ ] **Step 1: Implement the full 1337x scraper**

Replace the placeholder in `thirteen37x.rs` with:

```rust
use super::{extract_info_hash, format_size, SearchParams, SearchResult, ScraperError, TorrentScraper};
use scraper::{Html, Selector};
use std::future::Future;
use std::pin::Pin;

const BASE_URL: &str = "https://www.1337x.to";

pub struct Thirteen37xScraper {
    client: reqwest::Client,
}

impl Thirteen37xScraper {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    fn category_path(category: Option<&str>) -> &'static str {
        match category {
            Some("movies") => "Movies",
            Some("tv") => "TV",
            Some("games") => "Games",
            Some("software") => "Apps",
            Some("music") => "Music",
            _ => "",
        }
    }

    fn build_search_url(query: &str, category: Option<&str>, sort_by: Option<&str>, page: u32) -> String {
        let cat = Self::category_path(category);
        let encoded_query = query.replace(' ', "+");

        if cat.is_empty() {
            // No category filter
            match sort_by {
                Some("size") => format!("{}/sort-search/{}/size/desc/{}/", BASE_URL, encoded_query, page),
                Some("date") => format!("{}/sort-search/{}/time/desc/{}/", BASE_URL, encoded_query, page),
                Some("seeders") | _ => format!("{}/sort-search/{}/seeders/desc/{}/", BASE_URL, encoded_query, page),
            }
        } else {
            // With category filter
            match sort_by {
                Some("size") => format!("{}/sort-category-search/{}/{}/size/desc/{}/", BASE_URL, encoded_query, cat, page),
                Some("date") => format!("{}/sort-category-search/{}/{}/time/desc/{}/", BASE_URL, encoded_query, cat, page),
                Some("seeders") | _ => format!("{}/sort-category-search/{}/{}/seeders/desc/{}/", BASE_URL, encoded_query, cat, page),
            }
        }
    }

    /// Parse the search results page to get titles, links, seeders, leechers, size, date.
    fn parse_search_results(html: &str) -> Result<Vec<PartialResult>, ScraperError> {
        let document = Html::parse_document(html);

        // Check for CAPTCHA or block
        if html.contains("captcha") || html.contains("cf-browser-verification") {
            return Err(ScraperError::Blocked);
        }

        let table_selector = Selector::parse("table.table-list tbody tr")
            .map_err(|_| ScraperError::ParseError("Failed to parse table selector".into()))?;
        let name_selector = Selector::parse("td.coll-1.name a:nth-child(2)")
            .map_err(|_| ScraperError::ParseError("Failed to parse name selector".into()))?;
        let seeds_selector = Selector::parse("td.coll-2")
            .map_err(|_| ScraperError::ParseError("Failed to parse seeds selector".into()))?;
        let leeches_selector = Selector::parse("td.coll-3")
            .map_err(|_| ScraperError::ParseError("Failed to parse leeches selector".into()))?;
        let date_selector = Selector::parse("td.coll-date")
            .map_err(|_| ScraperError::ParseError("Failed to parse date selector".into()))?;
        let size_selector = Selector::parse("td.coll-4")
            .map_err(|_| ScraperError::ParseError("Failed to parse size selector".into()))?;

        let mut results = Vec::new();

        for row in document.select(&table_selector) {
            let name_el = match row.select(&name_selector).next() {
                Some(el) => el,
                None => continue,
            };

            let title = name_el.text().collect::<String>().trim().to_string();
            let detail_path = match name_el.value().attr("href") {
                Some(href) => href.to_string(),
                None => continue,
            };

            let seeders: u32 = row.select(&seeds_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().parse().unwrap_or(0))
                .unwrap_or(0);

            let leechers: u32 = row.select(&leeches_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().parse().unwrap_or(0))
                .unwrap_or(0);

            let date = row.select(&date_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();

            let size_text = row.select(&size_selector)
                .next()
                .map(|el| {
                    // The size cell contains the size and a span with unit info
                    // Get only the first text node
                    el.text().next().unwrap_or("").trim().to_string()
                })
                .unwrap_or_default();

            results.push(PartialResult {
                title,
                detail_path,
                seeders,
                leechers,
                date,
                size_display: size_text,
            });
        }

        Ok(results)
    }

    /// Fetch the detail page to get the magnet link.
    async fn fetch_magnet(&self, detail_path: &str) -> Result<String, ScraperError> {
        let url = format!("{}{}", BASE_URL, detail_path);
        let resp = self.client.get(&url).send().await?;
        let html = resp.text().await?;
        let document = Html::parse_document(&html);

        let magnet_selector = Selector::parse("a[href^=\"magnet:\"]")
            .map_err(|_| ScraperError::ParseError("Failed to parse magnet selector".into()))?;

        document
            .select(&magnet_selector)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|s| s.to_string())
            .ok_or_else(|| ScraperError::ParseError("No magnet link found on detail page".into()))
    }

    fn parse_size_to_bytes(size_str: &str) -> u64 {
        let size_str = size_str.trim();
        let parts: Vec<&str> = size_str.split_whitespace().collect();
        if parts.len() < 2 {
            return 0;
        }
        let num: f64 = parts[0].replace(',', "").parse().unwrap_or(0.0);
        let unit = parts[1].to_uppercase();
        match unit.as_str() {
            "KB" => (num * 1024.0) as u64,
            "MB" => (num * 1024.0 * 1024.0) as u64,
            "GB" => (num * 1024.0 * 1024.0 * 1024.0) as u64,
            "TB" => (num * 1024.0 * 1024.0 * 1024.0 * 1024.0) as u64,
            _ => num as u64,
        }
    }
}

struct PartialResult {
    title: String,
    detail_path: String,
    seeders: u32,
    leechers: u32,
    date: String,
    size_display: String,
}

impl TorrentScraper for Thirteen37xScraper {
    fn name(&self) -> &str {
        "1337x"
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            let page = params.page.unwrap_or(1);
            let url = Self::build_search_url(
                &params.query,
                params.category.as_deref(),
                params.sort_by.as_deref(),
                page,
            );

            let resp = self.client.get(&url).send().await?;
            let html = resp.text().await?;
            let partial_results = Self::parse_search_results(&html)?;

            let mut results = Vec::new();

            // Fetch magnet links from detail pages (limit concurrency to avoid rate limiting)
            for partial in partial_results {
                match self.fetch_magnet(&partial.detail_path).await {
                    Ok(magnet) => {
                        let info_hash = extract_info_hash(&magnet).unwrap_or_default();
                        let size_bytes = Self::parse_size_to_bytes(&partial.size_display);
                        results.push(SearchResult {
                            title: partial.title,
                            magnet,
                            info_hash,
                            size_bytes,
                            size_display: if partial.size_display.is_empty() {
                                format_size(size_bytes)
                            } else {
                                partial.size_display
                            },
                            seeders: partial.seeders,
                            leechers: partial.leechers,
                            date: partial.date,
                            source: "1337x".to_string(),
                            category: "Other".to_string(), // 1337x category is in the URL, not easily in the row
                        });
                    }
                    Err(e) => {
                        log::warn!("Failed to fetch magnet for '{}': {}", partial.title, e);
                        // Skip this result rather than failing the whole search
                    }
                }
            }

            Ok(results)
        })
    }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader/src-tauri && cargo check`
Expected: Compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/scrapers/thirteen37x.rs
git commit -m "feat: implement 1337x scraper with HTML parsing and magnet extraction"
```

---

### Task 12: Add Tauri Search Command

**Files:**
- Create: `src-tauri/src/commands/search.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/commands/search.rs`**

```rust
use crate::scrapers::{self, SearchResponse};

#[tauri::command]
pub async fn search_torrents(
    query: String,
    category: Option<String>,
    sort_by: Option<String>,
    page: Option<u32>,
) -> Result<SearchResponse, String> {
    let params = scrapers::SearchParams {
        query,
        category,
        sort_by,
        page,
    };

    Ok(scrapers::search_all(&params).await)
}
```

- [ ] **Step 2: Add `pub mod search;` to `src-tauri/src/commands/mod.rs`**

Add after existing modules:
```rust
pub mod auth;
pub mod downloads;
pub mod search;    // ← add this line
pub mod settings;
pub mod torrents;
```

- [ ] **Step 3: Register the command in `src-tauri/src/lib.rs`**

Add `commands::search::search_torrents,` to the `generate_handler![]` macro. Add it in a new `// Search` section after the `// Settings` section:

```rust
// Settings
commands::settings::get_settings,
commands::settings::update_settings,
// Search
commands::search::search_torrents,
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader/src-tauri && cargo check`
Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/search.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add search_torrents Tauri command"
```

---

## Chunk 4: Frontend Search Feature + Routing

### Task 13: Add TypeScript Types and API Wrapper for Search

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/api/search.ts`

- [ ] **Step 1: Add search types to `src/types/index.ts`**

Add at the end of the file:
```typescript
// ── Search ──

export interface SearchResult {
  title: string;
  magnet: string;
  info_hash: string;
  size_bytes: number;
  size_display: string;
  seeders: number;
  leechers: number;
  date: string;
  source: string;
  category: string;
}

export interface TrackerStatus {
  name: string;
  ok: boolean;
  error: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  tracker_status: TrackerStatus[];
}
```

- [ ] **Step 2: Create `src/api/search.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { SearchResponse } from "../types";

export async function searchTorrents(
  query: string,
  category?: string,
  sortBy?: string,
  page?: number
): Promise<SearchResponse> {
  return invoke("search_torrents", {
    query,
    category: category ?? null,
    sort_by: sortBy ?? null,   // snake_case to match Rust param name
    page: page ?? null,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/api/search.ts
git commit -m "feat: add search TypeScript types and API wrapper"
```

---

### Task 14: Build the Search Page

**Files:**
- Create: `src/pages/SearchPage.tsx`

- [ ] **Step 1: Create the SearchPage component**

Create `src/pages/SearchPage.tsx` with:
- Search bar at top (full-width input with search icon and submit on Enter or button click)
- Filter row: category `<select>` (All, Movies, TV, Games, Software, Music, Other) and sort `<select>` (Seeders, Size, Date)
- Results list: cards using `card-base` class, showing title (bold truncated), size, seeders/leechers (color coded), source badge (small pill), date, and "Add" button
- Seeder color coding: `text-green-400` for ≥10, `text-yellow-400` for 1-9, `text-red-400` for 0
- Source badge: `bg-rd-green/10 text-rd-green text-[11px] px-2 py-0.5 rounded-full`
- "Add" button: on click, calls `addMagnet(result.magnet)` then `selectTorrentFiles(id, "all")`, shows brief "Added!" feedback
- Loading state: 5 skeleton cards using the `.skeleton` class
- Empty state before first search: search icon + "Search for torrents across public trackers"
- Empty state after search with no results: "No results found for '{query}'"
- Tracker warning banner: if any `tracker_status` has `ok: false`, show subtle orange warning at top
- Pagination: Prev/Next buttons at bottom, disabled when at page 1 or results are empty

```typescript
import { useState } from "react";
import * as searchApi from "../api/search";
import * as torrentsApi from "../api/torrents";
import type { SearchResult, TrackerStatus } from "../types";

const CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "movies", label: "Movies" },
  { value: "tv", label: "TV Shows" },
  { value: "games", label: "Games" },
  { value: "software", label: "Software" },
  { value: "music", label: "Music" },
  { value: "other", label: "Other" },
];

const SORT_OPTIONS = [
  { value: "seeders", label: "Most Seeders" },
  { value: "size", label: "Largest" },
  { value: "date", label: "Newest" },
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sortBy, setSortBy] = useState("seeders");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const handleSearch = async (newPage?: number) => {
    const searchPage = newPage ?? 1;
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    setPage(searchPage);

    try {
      const response = await searchApi.searchTorrents(
        query.trim(),
        category || undefined,
        sortBy,
        searchPage
      );
      setResults(response.results);
      setTrackerStatus(response.tracker_status);
    } catch (e) {
      setError(String(e));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (result: SearchResult) => {
    setAddingId(result.info_hash);
    try {
      const added = await torrentsApi.addMagnet(result.magnet);
      await torrentsApi.selectTorrentFiles(added.id, "all");
      setAddedIds((prev) => new Set(prev).add(result.info_hash));
    } catch (e) {
      setError(`Failed to add "${result.title}": ${e}`);
    } finally {
      setAddingId(null);
    }
  };

  const seedersColor = (seeders: number) => {
    if (seeders >= 10) return "text-green-400";
    if (seeders >= 1) return "text-yellow-400";
    return "text-red-400";
  };

  const failedTrackers = trackerStatus.filter((t) => !t.ok);

  return (
    <div className="p-6">
      {/* Header */}
      <h2 className="text-3xl font-bold text-zinc-100 tracking-tight mb-6">Search</h2>

      {/* Search bar */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search for torrents..."
            className="w-full pl-12 pr-4 py-3 bg-rd-card border border-rd-border rounded-xl text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-rd-green focus:shadow-[var(--shadow-glow-green)] text-sm transition-all"
          />
        </div>
        <button
          onClick={() => handleSearch()}
          disabled={loading || !query.trim()}
          className="px-6 py-3 bg-rd-green text-black font-semibold rounded-xl hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-all shadow-lg shadow-rd-green/20"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-2.5 bg-rd-card border border-rd-border rounded-lg text-sm text-zinc-300 focus:outline-none focus:border-rd-green transition-colors"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-4 py-2.5 bg-rd-card border border-rd-border rounded-lg text-sm text-zinc-300 focus:outline-none focus:border-rd-green transition-colors"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Tracker warnings */}
      {failedTrackers.length > 0 && (
        <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl text-sm text-orange-400 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {failedTrackers.map((t) => t.name).join(", ")} unavailable — showing results from other sources
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : !searched ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-rd-card border border-rd-border flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="text-zinc-400 font-medium mb-1">Search for torrents</p>
          <p className="text-zinc-600 text-sm">Find content across public trackers</p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <p className="text-zinc-400 font-medium mb-1">No results found</p>
          <p className="text-zinc-600 text-sm">Try a different search term or category</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {results.map((result) => (
              <div
                key={result.info_hash || result.title}
                className="card-base flex items-center gap-4 px-5 py-4"
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{result.title}</p>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-xs text-zinc-400">{result.size_display}</span>
                    <span className={`text-xs font-medium ${seedersColor(result.seeders)}`}>
                      ↑{result.seeders}
                    </span>
                    <span className="text-xs text-zinc-600">↓{result.leechers}</span>
                    <span className="bg-rd-green/10 text-rd-green text-[11px] px-2 py-0.5 rounded-full font-medium">
                      {result.source}
                    </span>
                    {result.date && (
                      <span className="text-xs text-zinc-600">{result.date}</span>
                    )}
                  </div>
                </div>

                {/* Add button */}
                <button
                  onClick={() => handleAdd(result)}
                  disabled={addingId === result.info_hash || addedIds.has(result.info_hash)}
                  className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    addedIds.has(result.info_hash)
                      ? "bg-green-500/20 text-green-400 border border-green-500/30 cursor-default"
                      : "bg-rd-green text-black hover:bg-green-400 shadow-lg shadow-rd-green/20 disabled:opacity-40"
                  }`}
                >
                  {addedIds.has(result.info_hash)
                    ? "Added"
                    : addingId === result.info_hash
                      ? "Adding..."
                      : "Add"}
                </button>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              disabled={page <= 1}
              onClick={() => handleSearch(page - 1)}
              className="px-4 py-2 bg-rd-card border border-rd-border rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Previous
            </button>
            <span className="text-sm text-zinc-500 tabular-nums">Page {page}</span>
            <button
              disabled={results.length === 0}
              onClick={() => handleSearch(page + 1)}
              className="px-4 py-2 bg-rd-card border border-rd-border rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds (SearchPage is created but not routed yet — that's fine, it just needs to compile).

- [ ] **Step 3: Commit**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat: create SearchPage with filters, results, and add-to-torrent flow"
```

---

### Task 15: Wire Up Routing and Navigation

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add SearchPage import and route**

In `App.tsx`:
- Add import: `import SearchPage from "./pages/SearchPage";`
- Add route inside the authenticated layout block, after the torrents route:
  ```tsx
  <Route path="/search" element={<SearchPage />} />
  ```

The search nav item was already added to `Layout.tsx` in Task 2.

- [ ] **Step 2: Verify the full app builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Verify the full Rust backend builds**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader/src-tauri && cargo build`
Expected: Build succeeds (this is the first full build, not just check).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up search page routing"
```

---

### Task 16: Final Integration Test

- [ ] **Step 1: Run the full app in dev mode**

Run: `cd /Volumes/DATA/VibeCoding/DebridDownloader && npm run tauri dev`
Expected: App launches, sidebar shows all tabs including Search, all pages render with new styling.

- [ ] **Step 2: Test search functionality**

In the running app:
1. Click the Search tab
2. Type a search query and press Enter
3. Verify results appear with title, size, seeders, source badge
4. Click "Add" on a result and verify it appears on the Torrents page

- [ ] **Step 3: Verify all pages render correctly**

Navigate through all tabs (Torrents, Search, Downloads, History, Settings) and verify the new design is applied consistently.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete UI redesign and torrent search feature"
```
