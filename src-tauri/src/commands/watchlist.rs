//! Tauri wrappers; the bodies live in `crate::service::watchlist`.
use crate::engine_host::TauriEvents;
use crate::persistence::Persistence;
use crate::service::watchlist as svc;
use crate::state::AppState;
use crate::watchlist::{WatchMatch, WatchRule};
use tauri::State;

#[tauri::command]
pub async fn get_watch_rules(state: State<'_, AppState>) -> Result<Vec<WatchRule>, String> {
    Ok(svc::get_watch_rules(&state).await)
}

#[tauri::command]
pub async fn add_watch_rule(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    rule: WatchRule,
) -> Result<WatchRule, String> {
    svc::add_watch_rule(&state, &persistence, rule).await
}

#[tauri::command]
pub async fn update_watch_rule(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    rule: WatchRule,
) -> Result<WatchRule, String> {
    svc::update_watch_rule(&state, &persistence, rule).await
}

#[tauri::command]
pub async fn delete_watch_rule(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    svc::delete_watch_rule(&state, &persistence, &id).await
}

#[tauri::command]
pub async fn get_watch_matches(state: State<'_, AppState>, rule_id: Option<String>) -> Result<Vec<WatchMatch>, String> {
    Ok(svc::get_watch_matches(&state, rule_id.as_deref()).await)
}

#[tauri::command]
pub async fn clear_watch_matches(
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    rule_id: Option<String>,
) -> Result<(), String> {
    svc::clear_watch_matches(&state, &persistence, rule_id.as_deref()).await
}

#[tauri::command]
pub async fn run_watch_rule_now(
    app: tauri::AppHandle,
    persistence: State<'_, Persistence>,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<WatchMatch>, String> {
    svc::run_watch_rule_now(&state, &persistence, &TauriEvents::new(app), &id).await
}
