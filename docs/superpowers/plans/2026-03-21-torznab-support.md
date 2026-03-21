# Torznab Support & Flexible Numeric Parsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the TPB parser's string-vs-integer bug and add native Torznab (Prowlarr/Jackett) search support.

**Architecture:** New shared `utils.rs` extracts common logic (magnet building, size formatting, flexible deserialization). New `torznab.rs` implements the `TorrentScraper` trait for Torznab XML APIs. `TrackerConfig` gains an optional `api_key` field. Settings UI adds a Torznab option to the tracker type dropdown with an API key input.

**Tech Stack:** Rust (Tauri 2.x backend), TypeScript/React (frontend), `quick-xml` for XML parsing, `bendy` for bencoded `.torrent` parsing, `sha1` for info hash computation.

**Spec:** `docs/superpowers/specs/2026-03-21-torznab-support-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/Cargo.toml` | Modify | Add `quick-xml`, `bendy`, `sha1` dependencies |
| `src-tauri/src/scrapers/utils.rs` | Create | Shared utilities: `deserialize_string_or_number`, `build_magnet`, `format_size`, `extract_info_hash_from_torrent`, `TRACKERS` constant |
| `src-tauri/src/scrapers/mod.rs` | Modify | Add `pub mod utils; pub mod torznab;`, add `api_key` to `TrackerConfig`, update `build_scrapers` factory, remove `format_size` (moved to utils) |
| `src-tauri/src/scrapers/piratebay.rs` | Modify | Use `utils::deserialize_string_or_number` on numeric fields, use `utils::build_magnet`, remove local `TRACKERS` and `build_magnet` |
| `src-tauri/src/scrapers/torznab.rs` | Create | `TorznabScraper` implementing `TorrentScraper` trait, XML parsing, `.torrent` fallback |
| `src/types/index.ts` | Modify | Add `api_key?: string` to `TrackerConfig` |
| `src/pages/SettingsPage.tsx` | Modify | Add Torznab option to type dropdown, API key input, adaptive placeholders/help text, fix badge |

---

### Task 1: Add Cargo Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml:16-41`

- [ ] **Step 1: Add the three new crate dependencies**

Add after the `urlencoding = "2"` line (line 38):

```toml
quick-xml = "0.37"
bendy = { version = "0.3", features = ["std"] }
sha1 = "0.10"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors (warnings OK).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add quick-xml, bendy, sha1 dependencies for Torznab support"
```

---

### Task 2: Create Shared Utilities Module (`utils.rs`)

**Files:**
- Create: `src-tauri/src/scrapers/utils.rs`
- Modify: `src-tauri/src/scrapers/mod.rs:1` (add `pub mod utils;`)

- [ ] **Step 1: Create `utils.rs` with all shared utilities**

Create `src-tauri/src/scrapers/utils.rs` with the following complete content:

```rust
use super::ScraperError;
use serde::de::{self, Visitor};
use std::fmt;

/// Common public trackers appended to magnet links.
pub const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969",
    "udp://open.demonii.si:1337/announce",
];

// ── Flexible serde deserializer ──────────────────────────────────────

/// Deserializes a JSON value that is either a string or a number into a `String`.
/// Used to handle APIs that may return numeric fields as either `"42"` or `42`.
pub fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct StringOrNumber;

    impl<'de> Visitor<'de> for StringOrNumber {
        type Value = String;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string or a number")
        }

        fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
            Ok(v)
        }

        fn visit_i64<E: de::Error>(self, v: i64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_u64<E: de::Error>(self, v: u64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_f64<E: de::Error>(self, v: f64) -> Result<String, E> {
            Ok(v.to_string())
        }

        fn visit_unit<E: de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }

        fn visit_none<E: de::Error>(self) -> Result<String, E> {
            Ok(String::new())
        }
    }

    deserializer.deserialize_any(StringOrNumber)
}

// ── Magnet link construction ─────────────────────────────────────────

/// Build a magnet URI from an info hash and display name, with common public trackers.
pub fn build_magnet(info_hash: &str, name: &str) -> String {
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

// ── Size formatting ──────────────────────────────────────────────────

/// Format a byte count into a human-readable string (e.g., "1.5 GB").
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

// ── Torrent file → info hash extraction ──────────────────────────────

/// Download a `.torrent` file from `url`, parse the bencoded content,
/// SHA1-hash the raw `info` dictionary bytes, and return the 40-char hex info hash.
pub async fn extract_info_hash_from_torrent(
    url: &str,
    client: &reqwest::Client,
) -> Result<String, ScraperError> {
    let bytes = client
        .get(url)
        .send()
        .await?
        .bytes()
        .await?;

    extract_info_hash_from_bytes(&bytes)
}

/// Extract the info hash from raw bencoded `.torrent` bytes.
fn extract_info_hash_from_bytes(data: &[u8]) -> Result<String, ScraperError> {
    // Find the "info" key in the top-level dictionary and extract its raw bytes.
    // We need the raw bytes (not re-serialized) for a correct SHA1 hash.
    let info_key = b"4:info";
    let info_pos = data
        .windows(info_key.len())
        .position(|w| w == info_key)
        .ok_or_else(|| ScraperError::ParseError("No 'info' key in torrent file".into()))?;

    let info_start = info_pos + info_key.len();
    let info_bytes = find_bencode_value_end(data, info_start)?;

    use sha1::{Digest, Sha1};
    let hash = Sha1::digest(info_bytes);
    Ok(hash.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Given bencoded data starting at `start`, find the complete bencoded value
/// and return the slice containing it.
fn find_bencode_value_end(data: &[u8], start: usize) -> Result<&[u8], ScraperError> {
    if start >= data.len() {
        return Err(ScraperError::ParseError("Unexpected end of torrent data".into()));
    }

    let mut pos = start;
    match data[pos] {
        b'd' => {
            // Dictionary: d...e
            pos += 1;
            while pos < data.len() && data[pos] != b'e' {
                // Key (always a byte string)
                let key_slice = find_bencode_value_end(data, pos)?;
                pos += key_slice.len();
                // Value
                let val_slice = find_bencode_value_end(data, pos)?;
                pos += val_slice.len();
            }
            if pos >= data.len() {
                return Err(ScraperError::ParseError("Unterminated dictionary".into()));
            }
            pos += 1; // skip 'e'
            Ok(&data[start..pos])
        }
        b'l' => {
            // List: l...e
            pos += 1;
            while pos < data.len() && data[pos] != b'e' {
                let val_slice = find_bencode_value_end(data, pos)?;
                pos += val_slice.len();
            }
            if pos >= data.len() {
                return Err(ScraperError::ParseError("Unterminated list".into()));
            }
            pos += 1; // skip 'e'
            Ok(&data[start..pos])
        }
        b'i' => {
            // Integer: i<number>e
            let end = data[pos..]
                .iter()
                .position(|&b| b == b'e')
                .ok_or_else(|| ScraperError::ParseError("Unterminated integer".into()))?;
            Ok(&data[start..=pos + end])
        }
        b'0'..=b'9' => {
            // Byte string: <length>:<data>
            let colon = data[pos..]
                .iter()
                .position(|&b| b == b':')
                .ok_or_else(|| ScraperError::ParseError("Invalid byte string".into()))?;
            let len_str = std::str::from_utf8(&data[pos..pos + colon])
                .map_err(|_| ScraperError::ParseError("Invalid length".into()))?;
            let len: usize = len_str
                .parse()
                .map_err(|_| ScraperError::ParseError("Invalid length number".into()))?;
            let end = pos + colon + 1 + len;
            if end > data.len() {
                return Err(ScraperError::ParseError("Byte string exceeds data".into()));
            }
            Ok(&data[start..end])
        }
        _ => Err(ScraperError::ParseError(format!(
            "Unknown bencode type: {}",
            data[pos] as char
        ))),
    }
}
```

- [ ] **Step 2: Add `pub mod utils;` to `mod.rs`**

In `src-tauri/src/scrapers/mod.rs`, add at line 2 (after `pub mod piratebay;`):

```rust
pub mod utils;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles (utils is declared but not yet used — warnings about dead code are fine).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scrapers/utils.rs src-tauri/src/scrapers/mod.rs
git commit -m "feat: add shared scraper utilities module (deserializer, magnet builder, torrent parser)"
```

---

### Task 3: Fix TPB Parser — Flexible Numeric Deserialization

**Files:**
- Modify: `src-tauri/src/scrapers/piratebay.rs:1-84`

- [ ] **Step 1: Update imports and remove `TRACKERS` constant**

Replace lines 1-15 of `piratebay.rs`:

```rust
use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use super::utils;
use serde::Deserialize;
use std::future::Future;
use std::pin::Pin;
```

This removes: the `TRACKERS` constant (now in `utils.rs`) and the old `format_size` import.

- [ ] **Step 2: Add `deserialize_with` to `ApiResult` fields**

Replace the `ApiResult` struct (lines 17-33) with:

```rust
#[derive(Debug, Deserialize)]
struct ApiResult {
    #[serde(default)]
    name: String,
    #[serde(default)]
    info_hash: String,
    #[serde(default, deserialize_with = "utils::deserialize_string_or_number")]
    seeders: String,
    #[serde(default, deserialize_with = "utils::deserialize_string_or_number")]
    leechers: String,
    #[serde(default, deserialize_with = "utils::deserialize_string_or_number")]
    size: String,
    #[serde(default)]
    added: String,
    #[serde(default)]
    category: String,
}
```

- [ ] **Step 3: Remove local `build_magnet` method, use `utils` versions**

Remove the `build_magnet` method from `impl PirateBayScraper` (lines 74-84).

In the `search` method body, replace:
- `let magnet = Self::build_magnet(&r.info_hash, &r.name);` → `let magnet = utils::build_magnet(&r.info_hash, &r.name);`
- `format_size(size_bytes)` → `utils::format_size(size_bytes)`

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scrapers/piratebay.rs
git commit -m "fix: accept both string and integer JSON values for seeders/leechers/size"
```

---

### Task 4: Update `TrackerConfig` and `build_scrapers` in `mod.rs`

**Files:**
- Modify: `src-tauri/src/scrapers/mod.rs:44-112`

- [ ] **Step 1: Move `format_size` out of `mod.rs`**

Delete the `format_size` function (lines 87-96) from `mod.rs`. It now lives in `utils.rs`. Add a re-export so any existing callers keep working:

After the `pub mod` lines at the top, add:
```rust
pub use utils::format_size;
```

- [ ] **Step 2: Add `api_key` field to `TrackerConfig`**

Replace the `TrackerConfig` struct (lines 44-52) with:

```rust
/// User-configured tracker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub tracker_type: String, // "piratebay_api" | "torznab"
    pub enabled: bool,
    #[serde(default)]
    pub api_key: Option<String>,
}
```

- [ ] **Step 3: Update `build_scrapers` factory**

Replace the `build_scrapers` function (lines 101-112) with:

```rust
/// Build scrapers from user-configured tracker list
fn build_scrapers(configs: &[TrackerConfig]) -> Vec<(Box<dyn TorrentScraper>, Option<TrackerStatus>)> {
    configs
        .iter()
        .filter(|c| c.enabled)
        .map(|config| -> (Option<Box<dyn TorrentScraper>>, Option<TrackerStatus>) {
            match config.tracker_type.as_str() {
                "piratebay_api" => (
                    Some(Box::new(piratebay::PirateBayScraper::new(config.url.clone()))),
                    None,
                ),
                "torznab" => {
                    match &config.api_key {
                        Some(key) if !key.is_empty() => (
                            Some(Box::new(torznab::TorznabScraper::new(
                                config.name.clone(),
                                config.url.clone(),
                                key.clone(),
                            ))),
                            None,
                        ),
                        _ => (
                            None,
                            Some(TrackerStatus {
                                name: config.name.clone(),
                                ok: false,
                                error: Some("Missing API key — configure in Settings".into()),
                            }),
                        ),
                    }
                }
                _ => (None, None),
            }
        })
        .fold(vec![], |mut acc, (scraper, status)| {
            if let Some(s) = scraper {
                acc.push((s, None));
            } else if let Some(st) = status {
                acc.push((Box::new(piratebay::PirateBayScraper::new(String::new())) as Box<dyn TorrentScraper>, Some(st)));
            }
            acc
        })
        .into_iter()
        .collect()
}
```

Actually, this is getting convoluted. A cleaner approach — keep `build_scrapers` returning `Vec<Box<dyn TorrentScraper>>` and handle the missing-API-key status separately in `search_all`:

Replace `build_scrapers` with:

```rust
fn build_scrapers(configs: &[TrackerConfig]) -> (Vec<Box<dyn TorrentScraper>>, Vec<TrackerStatus>) {
    let mut scrapers: Vec<Box<dyn TorrentScraper>> = Vec::new();
    let mut config_errors: Vec<TrackerStatus> = Vec::new();

    for config in configs.iter().filter(|c| c.enabled) {
        match config.tracker_type.as_str() {
            "piratebay_api" => {
                scrapers.push(Box::new(piratebay::PirateBayScraper::new(config.url.clone())));
            }
            "torznab" => {
                match &config.api_key {
                    Some(key) if !key.is_empty() => {
                        scrapers.push(Box::new(torznab::TorznabScraper::new(
                            config.name.clone(),
                            config.url.clone(),
                            key.clone(),
                        )));
                    }
                    _ => {
                        config_errors.push(TrackerStatus {
                            name: config.name.clone(),
                            ok: false,
                            error: Some("Missing API key — configure in Settings".into()),
                        });
                    }
                }
            }
            _ => {}
        }
    }

    (scrapers, config_errors)
}
```

- [ ] **Step 4: Update `search_all` to use new `build_scrapers` signature**

In `search_all`, replace:
```rust
let scrapers = build_scrapers(tracker_configs);
```
with:
```rust
let (scrapers, config_errors) = build_scrapers(tracker_configs);
```

And after the `for (results, status) in outcomes` loop, add:
```rust
tracker_status.extend(config_errors);
```

Also update the empty-scrapers check: it should still show "no trackers" if both scrapers AND config_errors are empty, but if there are only config_errors (all Torznab trackers missing keys), still proceed — the config_errors will show in tracker_status.

Replace the empty check:
```rust
if scrapers.is_empty() {
    return SearchResponse {
        results: vec![],
        tracker_status: vec![TrackerStatus {
            name: "No trackers".to_string(),
            ok: false,
            error: Some("No trackers configured. Add trackers in Settings.".to_string()),
        }],
    };
}
```

With:
```rust
if scrapers.is_empty() && config_errors.is_empty() {
    return SearchResponse {
        results: vec![],
        tracker_status: vec![TrackerStatus {
            name: "No trackers".to_string(),
            ok: false,
            error: Some("No trackers configured. Add trackers in Settings.".to_string()),
        }],
    };
}
if scrapers.is_empty() {
    return SearchResponse {
        results: vec![],
        tracker_status: config_errors,
    };
}
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scrapers/mod.rs
git commit -m "feat: add api_key to TrackerConfig and torznab factory support"
```

---

### Task 5: Create Torznab Scraper (`torznab.rs`)

**Files:**
- Create: `src-tauri/src/scrapers/torznab.rs`
- Modify: `src-tauri/src/scrapers/mod.rs:2` (add `pub mod torznab;`)

- [ ] **Step 1: Add `pub mod torznab;` to `mod.rs`**

In `src-tauri/src/scrapers/mod.rs`, add after `pub mod utils;`:

```rust
pub mod torznab;
```

- [ ] **Step 2: Create the complete Torznab scraper**

Create `src-tauri/src/scrapers/torznab.rs` with:

```rust
use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use super::utils;
use futures::stream::{self, StreamExt};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::future::Future;
use std::pin::Pin;

pub struct TorznabScraper {
    name: String,
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl TorznabScraper {
    pub fn new(name: String, base_url: String, api_key: String) -> Self {
        Self {
            name,
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/1.1.2")
                .build()
                .expect("Failed to create HTTP client"),
            base_url,
            api_key,
        }
    }

    fn torznab_category(category: Option<&str>) -> Option<&'static str> {
        match category {
            Some("movies") => Some("2000"),
            Some("tv") => Some("5000"),
            Some("games") => Some("1000"),
            Some("software") => Some("4000"),
            Some("music") => Some("3000"),
            _ => None,
        }
    }
}

impl TorrentScraper for TorznabScraper {
    fn name(&self) -> &str {
        &self.name
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            let mut url = format!(
                "{}/api?t=search&apikey={}&q={}",
                self.base_url.trim_end_matches('/'),
                urlencoding::encode(&self.api_key),
                urlencoding::encode(&params.query),
            );

            if let Some(cat) = Self::torznab_category(params.category.as_deref()) {
                url.push_str(&format!("&cat={}", cat));
            }

            let resp = self.client.get(&url).send().await?;
            let text = resp.text().await?;

            // Check for Torznab error responses
            if let Some(err) = parse_torznab_error(&text) {
                return Err(err);
            }

            let items = parse_torznab_items(&text)?;

            // Split items into those with info_hash (ready) and those needing fallback
            let mut results = Vec::new();
            let mut need_fallback: Vec<TorznabItem> = Vec::new();

            for item in items {
                if !item.info_hash.is_empty() {
                    let magnet = if !item.magnet_url.is_empty() {
                        item.magnet_url
                    } else {
                        utils::build_magnet(&item.info_hash, &item.title)
                    };
                    results.push(SearchResult {
                        title: item.title,
                        magnet,
                        info_hash: item.info_hash.to_lowercase(),
                        size_bytes: item.size,
                        size_display: utils::format_size(item.size),
                        seeders: item.seeders,
                        leechers: item.peers.saturating_sub(item.seeders),
                        date: item.pub_date,
                        source: self.name.clone(),
                        category: item.category,
                    });
                } else if !item.link.is_empty() {
                    need_fallback.push(item);
                }
                // Items with no info_hash and no link are dropped
            }

            // Resolve .torrent fallbacks concurrently (max 10 items, 5 concurrent)
            const MAX_FALLBACK: usize = 10;
            const CONCURRENCY: usize = 5;

            let fallback_results: Vec<Option<SearchResult>> = stream::iter(
                need_fallback.into_iter().take(MAX_FALLBACK)
            )
            .map(|item| {
                let client = &self.client;
                let source = self.name.clone();
                async move {
                    match utils::extract_info_hash_from_torrent(&item.link, client).await {
                        Ok(hash) => {
                            let magnet = utils::build_magnet(&hash, &item.title);
                            Some(SearchResult {
                                title: item.title,
                                magnet,
                                info_hash: hash.to_lowercase(),
                                size_bytes: item.size,
                                size_display: utils::format_size(item.size),
                                seeders: item.seeders,
                                leechers: item.peers.saturating_sub(item.seeders),
                                date: item.pub_date,
                                source,
                                category: item.category,
                            })
                        }
                        Err(e) => {
                            log::warn!("Failed to extract info hash from {}: {}", item.link, e);
                            None
                        }
                    }
                }
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;

            results.extend(fallback_results.into_iter().flatten());

            Ok(results)
        })
    }
}

// ── XML Parsing ──────────────────────────────────────────────────────

#[derive(Default)]
struct TorznabItem {
    title: String,
    link: String,
    size: u64,
    seeders: u32,
    peers: u32,
    info_hash: String,
    magnet_url: String,
    category: String,
    pub_date: String,
}

fn parse_torznab_error(xml: &str) -> Option<ScraperError> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "error" {
                    let mut code = String::new();
                    let mut description = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "code" => code = val,
                            "description" => description = val,
                            _ => {}
                        }
                    }
                    let msg = if code == "100" || code == "101" {
                        format!("Authentication failed: {} (code {})", description, code)
                    } else {
                        format!("Torznab error: {} (code {})", description, code)
                    };
                    return Some(ScraperError::ParseError(msg));
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

fn parse_torznab_items(xml: &str) -> Result<Vec<TorznabItem>, ScraperError> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut items = Vec::new();

    let mut in_item = false;
    let mut current_item = TorznabItem::default();
    let mut current_tag = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "item" {
                    in_item = true;
                    current_item = TorznabItem::default();
                } else if in_item {
                    current_tag = name.clone();

                    // Handle <enclosure> for size fallback
                    if name == "enclosure" {
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                            if key == "length" && current_item.size == 0 {
                                let val = String::from_utf8_lossy(&attr.value).to_string();
                                current_item.size = val.parse().unwrap_or(0);
                            }
                        }
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                if !in_item {
                    buf.clear();
                    continue;
                }
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();

                // Handle <torznab:attr name="X" value="Y" />
                if name == "attr" {
                    let mut attr_name = String::new();
                    let mut attr_value = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "name" => attr_name = val,
                            "value" => attr_value = val,
                            _ => {}
                        }
                    }
                    match attr_name.as_str() {
                        "seeders" => current_item.seeders = attr_value.parse().unwrap_or(0),
                        "peers" => current_item.peers = attr_value.parse().unwrap_or(0),
                        "infohash" => current_item.info_hash = attr_value,
                        "magneturl" => current_item.magnet_url = attr_value,
                        "category" => {
                            if current_item.category.is_empty() {
                                current_item.category = attr_value;
                            }
                        }
                        "size" => {
                            if current_item.size == 0 {
                                current_item.size = attr_value.parse().unwrap_or(0);
                            }
                        }
                        _ => {}
                    }
                }

                // Handle <enclosure length="..." /> (self-closing)
                if name == "enclosure" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        if key == "length" && current_item.size == 0 {
                            let val = String::from_utf8_lossy(&attr.value).to_string();
                            current_item.size = val.parse().unwrap_or(0);
                        }
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_item {
                    let text = e.unescape().unwrap_or_default().to_string();
                    match current_tag.as_str() {
                        "title" => current_item.title = text,
                        "link" => current_item.link = text,
                        "size" => current_item.size = text.parse().unwrap_or(current_item.size),
                        "pubDate" => {
                            current_item.pub_date = chrono::DateTime::parse_from_rfc2822(&text)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_else(|_| text);
                        }
                        "category" => {
                            if current_item.category.is_empty() {
                                current_item.category = text;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "item" {
                    in_item = false;
                    if !current_item.title.is_empty() {
                        items.push(std::mem::take(&mut current_item));
                    }
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(ScraperError::ParseError(format!("XML parse error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(items)
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scrapers/torznab.rs src-tauri/src/scrapers/mod.rs
git commit -m "feat: add Torznab scraper with XML parsing and .torrent fallback"
```

---

### Task 6: Frontend — Update TypeScript Types

**Files:**
- Modify: `src/types/index.ts:162-168`

- [ ] **Step 1: Add `api_key` to `TrackerConfig` interface**

Replace the `TrackerConfig` interface (lines 162-168) with:

```typescript
export interface TrackerConfig {
  id: string;
  name: string;
  url: string;
  tracker_type: string;
  enabled: boolean;
  api_key?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add api_key field to TrackerConfig TypeScript type"
```

---

### Task 7: Frontend — Update Settings UI

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add `newTrackerApiKey` state**

After line 59 (`const [newTrackerType, setNewTrackerType] = useState("piratebay_api");`), add:

```typescript
const [newTrackerApiKey, setNewTrackerApiKey] = useState("");
```

- [ ] **Step 2: Update `handleAddTracker` to include `api_key`**

Replace the `config` object in `handleAddTracker` (lines 107-113):

```typescript
    const config: TrackerConfig = {
      id: crypto.randomUUID(),
      name: newTrackerName.trim(),
      url,
      tracker_type: newTrackerType,
      enabled: true,
      api_key: newTrackerApiKey.trim() || undefined,
    };
```

And add to the reset block (after line 123):
```typescript
    setNewTrackerApiKey("");
```

- [ ] **Step 3: Add Torznab option to the tracker type dropdown**

Replace line 387 (the single `<option>` in the type `<select>`):

```tsx
<option value="piratebay_api">API (TPB-style)</option>
<option value="torznab">Torznab (Prowlarr/Jackett)</option>
```

- [ ] **Step 4: Add API key input field**

After the URL input row (after line 407's closing `</div>` for the flex gap-3), add a new row before the Add button's parent div. Actually, it's cleaner to add the API key field in the same flex-col structure. Insert after the URL + Add button row (after the `</div>` on line 407):

```tsx
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newTrackerApiKey}
                      onChange={(e) => setNewTrackerApiKey(e.target.value)}
                      placeholder={newTrackerType === "torznab" ? "API Key (required for Torznab)" : "API Key (optional)"}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
                      className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                  </div>
```

- [ ] **Step 5: Update URL placeholder to be adaptive**

Replace the URL input's `placeholder` (line 395):

From:
```
placeholder="Base URL (e.g., https://example.org)"
```
To:
```
placeholder={newTrackerType === "torznab" ? "Base URL (e.g., http://localhost:9696/1/api)" : "Base URL (e.g., https://apibay.org)"}
```

- [ ] **Step 6: Fix tracker type badge**

Replace line 347:
```tsx
{tracker.tracker_type === "piratebay_api" ? "API" : "HTML"}
```
With:
```tsx
{tracker.tracker_type === "piratebay_api" ? "API" : tracker.tracker_type === "torznab" ? "Torznab" : tracker.tracker_type}
```

- [ ] **Step 7: Update help text to be adaptive**

Replace the help text block (lines 410-417) with:

```tsx
                <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--theme-border-subtle)" }}>
                  <div className="text-[13px] text-[var(--theme-text-muted)] font-medium mb-3">How it works</div>
                  <div className="text-[13px] text-[var(--theme-text-ghost)]">
                    <div className="p-3 rounded-lg" style={{ background: "var(--theme-bg-content)" }}>
                      {newTrackerType === "torznab" ? (
                        <>
                          <p>Connect to a Torznab-compatible indexer (Prowlarr, Jackett, etc.). Enter the API endpoint URL and your API key. The app queries the Torznab API and parses the XML response for search results.</p>
                          <p className="mt-2 text-[var(--theme-text-muted)]">Find your API URL and key in your indexer manager's settings. For Prowlarr, it's typically <code className="text-[var(--theme-text-muted)] px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>http://localhost:9696/&#123;indexer_id&#125;/api</code>.</p>
                        </>
                      ) : (
                        <>
                          <p>Enter the base URL of a site with a TPB-compatible JSON API. The app queries <code className="text-[var(--theme-text-muted)] px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>/q.php?q=search_term</code> and expects a JSON array of results with fields: name, info_hash, seeders, leechers, size, added, category.</p>
                          <p className="mt-2 text-[var(--theme-text-muted)]">Need help finding compatible sources? Check the <a href="https://github.com/CasaVargas/DebridDownloader/discussions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>community discussions</a>.</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
```

- [ ] **Step 8: Add inline warning for missing Torznab API key**

After the API key input field (added in Step 4), add:

```tsx
                  {newTrackerType === "torznab" && !newTrackerApiKey.trim() && (
                    <p className="text-[13px] text-[#f59e0b]">Torznab trackers require an API key to authenticate</p>
                  )}
```

- [ ] **Step 9: Verify frontend compiles**

Run: `cd /Users/jonathan/Desktop/DebridDownloader && npm run build`
Expected: Builds with no errors.

- [ ] **Step 10: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: add Torznab tracker type to Settings UI with API key field"
```

---

### Task 8: Full Build Verification

- [ ] **Step 1: Verify Rust backend builds**

Run: `cd src-tauri && cargo build`
Expected: Builds successfully.

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/jonathan/Desktop/DebridDownloader && npm run build`
Expected: Builds successfully.

- [ ] **Step 3: Verify full Tauri app builds**

Run: `cd /Users/jonathan/Desktop/DebridDownloader && npm run tauri build -- --debug`
Expected: Builds a debug app bundle. (This may take several minutes.)

Note: If the full Tauri build is too slow for verification, `cargo build` + `npm run build` independently passing is sufficient confidence.
