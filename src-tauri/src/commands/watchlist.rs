use crate::state::AppState;
use crate::watchlist::{self, WatchMatch, WatchRule, WatchAction, RuleType, MatchStatus};
use crate::persistence::{Persistence, WATCH_MATCHES_KEY, WATCH_RULES_KEY, WATCH_SEEN_KEY};
use tauri::{Emitter, Manager, State};

// ── Store helpers ───────────────────────────────────────────────────

fn save_rules(persistence: &Persistence, rules: &[WatchRule]) -> Result<(), String> {
    persistence.set_json(WATCH_RULES_KEY, rules)
}

fn save_matches(persistence: &Persistence, matches: &[WatchMatch]) -> Result<(), String> {
    persistence.set_json(WATCH_MATCHES_KEY, matches)
}

fn save_seen(
    persistence: &Persistence,
    seen: &std::collections::HashMap<String, std::collections::HashSet<String>>,
) -> Result<(), String> {
    persistence.set_json(WATCH_SEEN_KEY, seen)
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_watch_rules(state: State<'_, AppState>) -> Result<Vec<WatchRule>, String> {
    let rules = state.watch_rules.read().await;
    Ok(rules.clone())
}

#[tauri::command]
pub async fn add_watch_rule(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    rule: WatchRule,
) -> Result<WatchRule, String> {
    if let Some(ref pattern) = rule.regex_filter {
        if !pattern.is_empty() {
            watchlist::validate_regex(pattern)?;
        }
    }

    let mut rules = state.watch_rules.write().await;
    rules.push(rule.clone());
    save_rules(&persistence, &rules)?;
    Ok(rule)
}

#[tauri::command]
pub async fn update_watch_rule(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    rule: WatchRule,
) -> Result<WatchRule, String> {
    if let Some(ref pattern) = rule.regex_filter {
        if !pattern.is_empty() {
            watchlist::validate_regex(pattern)?;
        }
    }

    let mut rules = state.watch_rules.write().await;
    if let Some(existing) = rules.iter_mut().find(|r| r.id == rule.id) {
        *existing = rule.clone();
        save_rules(&persistence, &rules)?;
        Ok(rule)
    } else {
        Err("Rule not found".to_string())
    }
}

#[tauri::command]
pub async fn delete_watch_rule(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut rules = state.watch_rules.write().await;
    rules.retain(|r| r.id != id);
    save_rules(&persistence, &rules)?;

    let mut matches = state.watch_matches.write().await;
    matches.retain(|m| m.rule_id != id);
    save_matches(&persistence, &matches)?;

    let mut seen = state.watch_seen.write().await;
    seen.remove(&id);
    save_seen(&persistence, &seen)?;

    Ok(())
}

#[tauri::command]
pub async fn get_watch_matches(
    state: State<'_, AppState>,
    rule_id: Option<String>,
) -> Result<Vec<WatchMatch>, String> {
    let matches = state.watch_matches.read().await;
    match rule_id {
        Some(id) => Ok(matches.iter().filter(|m| m.rule_id == id).cloned().collect()),
        None => Ok(matches.clone()),
    }
}

#[tauri::command]
pub async fn clear_watch_matches(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    rule_id: Option<String>,
) -> Result<(), String> {
    let mut matches = state.watch_matches.write().await;
    match rule_id {
        Some(id) => matches.retain(|m| m.rule_id != id),
        None => matches.clear(),
    }
    save_matches(&persistence, &matches)?;
    Ok(())
}

#[tauri::command]
pub async fn run_watch_rule_now(
    app: tauri::AppHandle,
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<WatchMatch>, String> {
    let rule = {
        let rules = state.watch_rules.read().await;
        rules.iter().find(|r| r.id == id).cloned()
    };

    let rule = rule.ok_or("Rule not found")?;

    let tracker_configs = persistence.load_tracker_configs();
    if tracker_configs.is_empty() {
        return Err("No trackers configured".to_string());
    }

    let new_matches = watchlist::run_rule_standalone(&app, &state, &rule, &tracker_configs).await;

    if !new_matches.is_empty() {
        for m in &new_matches {
            let _ = app.emit("watchlist-match", m.clone());
        }

        let mut matches = state.watch_matches.write().await;
        matches.extend(new_matches.clone());
        if matches.len() > watchlist::MAX_MATCHES {
            let drain_count = matches.len() - watchlist::MAX_MATCHES;
            matches.drain(..drain_count);
        }
        save_matches(&persistence, &matches)?;

        let mut rules = state.watch_rules.write().await;
        if let Some(existing) = rules.iter_mut().find(|r| r.id == id) {
            existing.last_checked = Some(chrono::Utc::now().to_rfc3339());

            if let watchlist::RuleType::TvShow {
                ref mut last_season,
                ref mut last_episode,
            } = existing.rule_type
            {
                for m in &new_matches {
                    if let (Some(s), Some(e)) = (m.season, m.episode) {
                        let current = (last_season.unwrap_or(0), last_episode.unwrap_or(0));
                        if (s, e) > current {
                            *last_season = Some(s);
                            *last_episode = Some(e);
                        }
                    }
                }
            }
        }
        save_rules(&persistence, &rules)?;
    }

    Ok(new_matches)
}
