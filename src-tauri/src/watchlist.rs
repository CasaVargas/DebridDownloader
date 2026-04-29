use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;
use crate::scrapers::{self, SearchParams, TrackerConfig};
use crate::state::AppState;

// ── Data Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchRule {
    pub id: String,
    pub name: String,
    pub rule_type: RuleType,
    pub query: String,
    pub category: Option<String>,
    pub regex_filter: Option<String>,
    pub min_seeders: Option<u32>,
    pub min_size_bytes: Option<u64>,
    pub max_size_bytes: Option<u64>,
    pub action: WatchAction,
    pub interval_minutes: u32,
    pub enabled: bool,
    pub created_at: String,
    pub last_checked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum RuleType {
    Keyword,
    TvShow {
        last_season: Option<u32>,
        last_episode: Option<u32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WatchAction {
    Notify,
    AutoAdd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchMatch {
    pub rule_id: String,
    pub info_hash: String,
    pub magnet: String,
    pub title: String,
    pub size_bytes: u64,
    pub matched_at: String,
    pub action_taken: WatchAction,
    pub status: MatchStatus,
    pub season: Option<u32>,
    pub episode: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "reason")]
pub enum MatchStatus {
    Notified,
    Added,
    Failed(String),
}

// ── Episode Parser ──────────────────────────────────────────────────

static EPISODE_RE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"(?i)S(\d{1,2})E(\d{1,2})").unwrap(),
        Regex::new(r"(?i)(\d{1,2})x(\d{2})").unwrap(),
    ]
});

pub fn parse_episode(title: &str) -> Option<(u32, u32)> {
    for re in EPISODE_RE.iter() {
        if let Some(caps) = re.captures(title) {
            let season: u32 = caps[1].parse().ok()?;
            let episode: u32 = caps[2].parse().ok()?;
            return Some((season, episode));
        }
    }
    None
}

// ── Result Filtering ────────────────────────────────────────────────

use crate::scrapers::SearchResult;

pub fn filter_results(
    results: &[SearchResult],
    rule: &WatchRule,
    seen: &HashSet<String>,
) -> Vec<SearchResult> {
    let regex = rule
        .regex_filter
        .as_ref()
        .and_then(|r| Regex::new(r).ok());

    results
        .iter()
        .filter(|r| {
            if r.info_hash.is_empty() {
                return false;
            }
            if seen.contains(&r.info_hash) {
                return false;
            }
            if let Some(ref re) = regex {
                if !re.is_match(&r.title) {
                    return false;
                }
            }
            if let Some(min) = rule.min_seeders {
                if r.seeders < min {
                    return false;
                }
            }
            if let Some(min) = rule.min_size_bytes {
                if r.size_bytes < min {
                    return false;
                }
            }
            if let Some(max) = rule.max_size_bytes {
                if r.size_bytes > max {
                    return false;
                }
            }
            if let RuleType::TvShow {
                last_season,
                last_episode,
            } = &rule.rule_type
            {
                match parse_episode(&r.title) {
                    None => return false,
                    Some((s, e)) => {
                        if let (Some(ls), Some(le)) = (last_season, last_episode) {
                            if (s, e) <= (*ls, *le) {
                                return false;
                            }
                        }
                    }
                }
            }
            true
        })
        .cloned()
        .collect()
}

/// Validate that a regex string compiles. Returns Ok(()) or Err with message.
pub fn validate_regex(pattern: &str) -> Result<(), String> {
    Regex::new(pattern).map(|_| ()).map_err(|e| format!("Invalid regex: {}", e))
}

// ── Watch Loop ─────────────────────────────────────────────────────

const TICK_INTERVAL_SECS: u64 = 60;
pub const MAX_MATCHES: usize = 500;
pub const MAX_SEEN_PER_RULE: usize = 5000;

pub async fn start_watch_loop(app: tauri::AppHandle, cancel: CancellationToken) {
    let mut logged_no_trackers = false;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                log::info!("Watch loop cancelled, shutting down");
                return;
            }
            _ = tokio::time::sleep(Duration::from_secs(TICK_INTERVAL_SECS)) => {}
        }

        let state: tauri::State<'_, AppState> = app.state();

        // Load tracker configs
        let tracker_configs = load_tracker_configs(&app);
        if tracker_configs.is_empty() {
            if !logged_no_trackers {
                log::info!("Watch loop: no trackers configured, skipping");
                logged_no_trackers = true;
            }
            continue;
        }
        logged_no_trackers = false;

        // Snapshot enabled rules that are due
        let rules_snapshot: Vec<WatchRule> = {
            let rules = state.watch_rules.read().await;
            let now = chrono::Utc::now();
            rules
                .iter()
                .filter(|r| {
                    if !r.enabled {
                        return false;
                    }
                    match &r.last_checked {
                        None => true,
                        Some(ts) => {
                            if let Ok(last) = chrono::DateTime::parse_from_rfc3339(ts) {
                                let elapsed = now.signed_duration_since(last);
                                elapsed.num_minutes() >= r.interval_minutes as i64
                            } else {
                                true
                            }
                        }
                    }
                })
                .cloned()
                .collect()
        };

        for rule in &rules_snapshot {
            if cancel.is_cancelled() {
                return;
            }

            let new_matches = run_rule(&app, &state, rule, &tracker_configs).await;

            if !new_matches.is_empty() {
                for m in &new_matches {
                    let _ = app.emit("watchlist-match", m.clone());
                }

                {
                    let mut matches = state.watch_matches.write().await;
                    matches.extend(new_matches.clone());
                    if matches.len() > MAX_MATCHES {
                        let drain_count = matches.len() - MAX_MATCHES;
                        matches.drain(..drain_count);
                    }
                    let _ = save_to_store(&app, "watch_matches", &*matches);
                }
            }

            {
                let mut rules = state.watch_rules.write().await;
                if let Some(existing) = rules.iter_mut().find(|r| r.id == rule.id) {
                    if existing.last_checked == rule.last_checked {
                        existing.last_checked = Some(chrono::Utc::now().to_rfc3339());

                        if let RuleType::TvShow {
                            ref mut last_season,
                            ref mut last_episode,
                        } = existing.rule_type
                        {
                            for m in &new_matches {
                                if let (Some(s), Some(e)) = (m.season, m.episode) {
                                    let current = (
                                        last_season.unwrap_or(0),
                                        last_episode.unwrap_or(0),
                                    );
                                    if (s, e) > current {
                                        *last_season = Some(s);
                                        *last_episode = Some(e);
                                    }
                                }
                            }
                        }
                    }
                }
                let _ = save_to_store(&app, "watch_rules", &*rules);
            }
        }
    }
}

async fn run_rule(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    rule: &WatchRule,
    tracker_configs: &[TrackerConfig],
) -> Vec<WatchMatch> {
    let params = SearchParams {
        query: rule.query.clone(),
        category: rule.category.clone(),
        sort_by: Some("seeders".to_string()),
        page: None,
    };

    let response = scrapers::search_all(&params, tracker_configs, vec![]).await;

    let seen = {
        let seen_map = state.watch_seen.read().await;
        seen_map.get(&rule.id).cloned().unwrap_or_default()
    };

    let filtered = filter_results(&response.results, rule, &seen);

    let now = chrono::Utc::now().to_rfc3339();
    let mut new_matches = Vec::new();

    for result in &filtered {
        let episode_info = parse_episode(&result.title);

        let (status, action_taken) = match rule.action {
            WatchAction::Notify => (MatchStatus::Notified, WatchAction::Notify),
            WatchAction::AutoAdd => {
                match auto_add(app, state, &result.magnet).await {
                    Ok(()) => (MatchStatus::Added, WatchAction::AutoAdd),
                    Err(reason) => (MatchStatus::Failed(reason), WatchAction::AutoAdd),
                }
            }
        };

        new_matches.push(WatchMatch {
            rule_id: rule.id.clone(),
            info_hash: result.info_hash.clone(),
            magnet: result.magnet.clone(),
            title: result.title.clone(),
            size_bytes: result.size_bytes,
            matched_at: now.clone(),
            action_taken,
            status,
            season: episode_info.map(|(s, _)| s),
            episode: episode_info.map(|(_, e)| e),
        });
    }

    if !new_matches.is_empty() {
        let mut seen_map = state.watch_seen.write().await;
        let rule_seen = seen_map.entry(rule.id.clone()).or_default();
        for m in &new_matches {
            rule_seen.insert(m.info_hash.clone());
        }
        if rule_seen.len() > MAX_SEEN_PER_RULE {
            let excess = rule_seen.len() - MAX_SEEN_PER_RULE;
            let to_remove: Vec<_> = rule_seen.iter().take(excess).cloned().collect();
            for h in to_remove {
                rule_seen.remove(&h);
            }
        }
        let _ = save_to_store(app, "watch_seen_hashes", &*seen_map);
    }

    new_matches
}

async fn auto_add(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    magnet: &str,
) -> Result<(), String> {
    let provider = state.get_provider().await;

    let add_response = provider
        .add_magnet(magnet)
        .await
        .map_err(|e| format!("Failed to add magnet: {}", e))?;

    let backoff_ms = [1000u64, 2000, 4000, 8000, 16000, 32000];
    let mut files_ready = false;

    for delay in &backoff_ms {
        tokio::time::sleep(Duration::from_millis(*delay)).await;
        match provider.torrent_info(&add_response.id).await {
            Ok(info) => {
                if info.status == "downloaded" || !info.files.is_empty() {
                    let file_ids: Vec<u64> = info.files.iter().map(|f| f.id).collect();
                    if !file_ids.is_empty() {
                        if let Err(e) = provider.select_files(&add_response.id, &file_ids).await {
                            log::warn!("Watch auto-add: select_files failed: {}", e);
                        }
                    }
                    files_ready = true;
                    break;
                }
            }
            Err(e) => {
                log::warn!("Watch auto-add: torrent_info failed: {}", e);
            }
        }
    }

    if !files_ready {
        log::info!(
            "Watch auto-add: torrent {} not ready after polling, recorded as Added",
            add_response.id
        );
    }

    Ok(())
}

fn load_tracker_configs(app: &tauri::AppHandle) -> Vec<TrackerConfig> {
    let store = match app.store("settings.json") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    match store.get("tracker_configs") {
        Some(val) => serde_json::from_value(val.clone()).unwrap_or_default(),
        None => vec![],
    }
}

fn save_to_store<T: Serialize>(
    app: &tauri::AppHandle,
    key: &str,
    value: &T,
) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let json = serde_json::to_value(value).map_err(|e| e.to_string())?;
    store.set(key, json);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Public entry point for running a single rule on demand (used by run_watch_rule_now command)
pub async fn run_rule_standalone(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    rule: &WatchRule,
    tracker_configs: &[TrackerConfig],
) -> Vec<WatchMatch> {
    run_rule(app, state, rule, tracker_configs).await
}
