# Torznab Support & Flexible Numeric Parsing

**Date:** 2026-03-21
**Status:** Approved

## Problem

Two related issues with tracker search:

1. **Bug:** The TPB API parser (`piratebay.rs`) declares `seeders`, `leechers`, and `size` as `String` types. When modern indexer managers like Prowlarr or Jackett return these as JSON integers (`"size": 888301184` instead of `"size": "888301184"`), serde deserialization fails with: `invalid type: integer, expected a string`.

2. **Feature gap:** No native support for Torznab/Newznab, the industry-standard API used by Prowlarr and Jackett. Users must hack Torznab endpoints into TPB-style URLs, which is fragile and error-prone.

## Scope

- Fix the numeric parsing bug in the existing TPB scraper
- Add a native Torznab scraper as a first-class tracker type
- Extract shared utilities used by both scrapers
- Update the Settings UI to support Torznab tracker configuration
- Add 3 new Rust dependencies: `quick-xml`, `bendy`, `sha1`

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Torznab config model | Base URL + API Key per tracker | Prowlarr/Jackett already aggregate across indexers; no need to discover individual ones |
| Category handling | Pass-through from Torznab response | Torznab returns human-readable category names; no need to map or constrain |
| Results without magnet/hash | Download `.torrent`, extract info hash | Maximizes result coverage at cost of one extra HTTP call per affected result |
| Code sharing | Shared `utils.rs` module | DRY without premature abstraction; sweet spot for 2 tracker types |
| Settings UI | Single form with type dropdown, API key always visible | Simple, unified experience; API key optional for TPB, effectively required for Torznab |

## Architecture

### File Changes

| File | Change |
|------|--------|
| `src-tauri/src/scrapers/utils.rs` | **New.** Shared utilities |
| `src-tauri/src/scrapers/torznab.rs` | **New.** Torznab scraper implementation |
| `src-tauri/src/scrapers/piratebay.rs` | Fix `ApiResult` to use flexible deserializer; remove `build_magnet` and `TRACKERS` (moved to utils) |
| `src-tauri/src/scrapers/mod.rs` | Add `api_key` to `TrackerConfig`; add `torznab` match arm in `build_scrapers`; `pub mod` declarations; move `format_size` to utils |
| `src-tauri/Cargo.toml` | Add `quick-xml`, `bendy`, `sha1` |
| `src/types/index.ts` | Add `api_key?` to `TrackerConfig` |
| `src/pages/SettingsPage.tsx` | Tracker type dropdown, API key field, adaptive placeholders |

### Component 1: Shared Utilities (`scrapers/utils.rs`)

Five responsibilities:

**1. Flexible numeric deserialization:**
```rust
pub fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where D: serde::Deserializer<'de>
```
Accepts a JSON value that is either a string or a number, always returns `String`. Used by `ApiResult` in `piratebay.rs` to fix the parsing bug.

**2. Torrent file info hash extraction:**
```rust
pub async fn extract_info_hash_from_torrent(url: &str, client: &reqwest::Client) -> Result<String, ScraperError>
```
Downloads a `.torrent` file, parses bencoded data, SHA1-hashes the raw `info` dictionary bytes (not re-serialized), returns the 40-char hex info hash. Note: must hash the original bytes from the bencoded stream, not a re-serialized version, to get a correct info hash.

**3. Magnet link construction:**
```rust
pub fn build_magnet(info_hash: &str, name: &str) -> String
```
Moved from `PirateBayScraper::build_magnet` in `piratebay.rs`. Constructs a magnet URI with the `TRACKERS` constant (also moved here) appended as `&tr=` parameters. `piratebay.rs` switches to calling `utils::build_magnet`.

**4. Size formatting:**
```rust
pub fn format_size(bytes: u64) -> String
```
Moved from `mod.rs` (currently at line 87). Converts bytes to human-readable string (e.g., "1.5 GB").

**5. Common tracker list (`TRACKERS` constant):**
Moved from `piratebay.rs` (lines 6-15). Used by `build_magnet`.

### Component 2: Bug Fix in `piratebay.rs`

Apply `#[serde(deserialize_with = "deserialize_string_or_number")]` to the `seeders`, `leechers`, and `size` fields of `ApiResult`:

```rust
#[derive(Debug, Deserialize)]
struct ApiResult {
    #[serde(default)]
    name: String,
    #[serde(default)]
    info_hash: String,
    #[serde(default, deserialize_with = "crate::scrapers::utils::deserialize_string_or_number")]
    seeders: String,
    #[serde(default, deserialize_with = "crate::scrapers::utils::deserialize_string_or_number")]
    leechers: String,
    #[serde(default, deserialize_with = "crate::scrapers::utils::deserialize_string_or_number")]
    size: String,
    #[serde(default)]
    added: String,
    #[serde(default)]
    category: String,
}
```

Backwards-compatible: APIs returning strings continue to work. APIs returning integers now work too.

Remove `build_magnet` method and `TRACKERS` constant (now in `utils.rs`). Call `utils::build_magnet` instead.

### Component 3: TrackerConfig Update

**Backend (`scrapers/mod.rs`):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub tracker_type: String,  // "piratebay_api" | "torznab"
    pub enabled: bool,
    #[serde(default)]
    pub api_key: Option<String>,
}
```

**Factory update:**
```rust
match config.tracker_type.as_str() {
    "piratebay_api" => Some(Box::new(piratebay::PirateBayScraper::new(config.url.clone()))),
    "torznab" => {
        if let Some(ref api_key) = config.api_key {
            if !api_key.is_empty() {
                Some(Box::new(torznab::TorznabScraper::new(
                    config.url.clone(),
                    api_key.clone(),
                )))
            } else {
                // Return None — tracker status will show "missing API key" error
                None
            }
        } else {
            None
        }
    }
    _ => None,
}
```
When a Torznab tracker has no API key, it is skipped during search and its `TrackerStatus` reports a configuration error rather than making a doomed HTTP request.

**Frontend (`types/index.ts`):**
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

`#[serde(default)]` on `api_key` ensures existing saved configs without this field deserialize to `None`.

### Component 4: Torznab Scraper (`scrapers/torznab.rs`)

**Struct:**
```rust
pub struct TorznabScraper {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}
```

**Search URL:**
```
{base_url}/api?t=search&apikey={api_key}&q={query}&cat={torznab_cats}
```

Category mapping for outgoing requests: Movies=2000, TV=5000, Games=1000, Software=4000, Music=3000. For unspecified or unrecognized categories, omit the `&cat=` parameter entirely (search all).

**XML parsing flow (using `quick-xml`):**

For each `<item>` in the RSS response:
1. Extract `<title>` → title
2. Extract `<size>` or `<enclosure length="">` → size_bytes
3. Extract `<torznab:attr name="seeders" value="">` → seeders
4. Extract `<torznab:attr name="peers" value="">` → compute leechers as `peers.saturating_sub(seeders)` (Torznab `peers` = total connected, not just leechers; use saturating subtraction to handle inconsistent data where seeders > peers)
5. Extract `<torznab:attr name="infohash" value="">` → info_hash (if present)
6. Extract `<torznab:attr name="magneturl" value="">` → magnet (if present)
7. Extract `<link>` → torrent download URL (fallback for magnet resolution)
8. Extract `<torznab:attr name="category" value="">` → category (pass-through)
9. Extract `<pubDate>` → date (parse RFC 2822 via `chrono::DateTime::parse_from_rfc2822`, format as `YYYY-MM-DD` to match existing `SearchResult.date` field used for sorting)

**Magnet resolution for results without info_hash/magnet:**
Call `utils::extract_info_hash_from_torrent` on the `<link>` URL, then `utils::build_magnet` to construct the magnet URI. To avoid timeout issues (the scraper has a 10-second timeout), `.torrent` downloads run concurrently with a concurrency limit of 5, and a maximum of 10 fallback downloads per search. Results exceeding this cap are dropped.

**Error handling:**
- Torznab error XML (`<error code="..." description="...">`) → descriptive `ScraperError`
- Auth failures (code 100/101) → clear message in tracker status
- Invalid XML → `ScraperError::ParseError`

### Component 5: Settings UI (`SettingsPage.tsx`)

Changes to the Add/Edit Tracker form:

1. **Tracker Type dropdown:** `<select>` with options "Pirate Bay API" (`piratebay_api`) and "Torznab" (`torznab`). Default: "Pirate Bay API".

2. **API Key field:** Always visible. Placeholder adapts:
   - TPB selected: "Optional"
   - Torznab selected: "Required — from Prowlarr/Jackett settings"

3. **URL field placeholder** adapts:
   - TPB: `https://apibay.org`
   - Torznab: `http://localhost:9696/1/api`

4. **Validation:** Inline warning when saving a Torznab tracker without an API key (non-blocking).

5. **Tracker type badge:** Update the existing badge display (currently shows "API" / "HTML") to show "API" for `piratebay_api` and "Torznab" for `torznab`.

6. **Help text:** The existing TPB-specific help text (mentions `/q.php?q=search_term`) should adapt when "Torznab" is selected, describing the Torznab API format instead.

7. **New state:** Add `newTrackerApiKey` and `newTrackerType` state variables for the form, include `api_key` and `tracker_type` in the `handleAddTracker` config construction.

No changes to SearchPage, results display, or other UI.

### Component 6: New Dependencies

Added to `src-tauri/Cargo.toml`:

| Crate | Version | Purpose |
|-------|---------|---------|
| `quick-xml` | latest | Torznab XML response parsing |
| `bendy` | latest | Parse `.torrent` files for info hash extraction (preferred over `serde_bencode` for raw byte access needed for correct SHA1 hashing) |
| `sha1` | latest | Hash info dictionary to produce info hash |

All lightweight, well-maintained, pure Rust.

## What's NOT in Scope

- Auto-discovery of indexers from Prowlarr/Jackett
- Per-indexer configuration within a Prowlarr/Jackett instance
- Custom category mapping or filtering
- Torrent file caching
- Any changes to the debrid provider layer (Real-Debrid, TorBox)
