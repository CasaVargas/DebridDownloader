use crate::persistence::{Persistence, TRACKER_CONFIGS_KEY, WATCH_RULES_KEY};
use crate::state::AppState;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct ExportData {
    version: String,
    app_settings: serde_json::Value,
    frontend_settings: Option<serde_json::Value>,
    tracker_configs: Option<serde_json::Value>,
    watch_rules: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub frontend_settings: Option<String>,
    pub imported_sections: Vec<String>,
}

/// The settings blob, tracker configs, watch rules and the frontend's own settings as one JSON
/// document. Without `include_credentials`, media-server/TMDB keys and tracker API keys are left out.
pub async fn export_settings(
    state: &AppState,
    persistence: &Persistence,
    include_credentials: bool,
    frontend_settings_json: &str,
) -> Result<String, String> {
    let settings = state.settings.read().await;
    let mut settings_value = serde_json::to_value(&*settings).map_err(|e| e.to_string())?;
    drop(settings);

    // Strip credentials if not included
    if !include_credentials {
        if let Some(obj) = settings_value.as_object_mut() {
            obj.remove("plex_token");
            obj.remove("jellyfin_api_key");
            obj.remove("emby_api_key");
            obj.remove("tmdb_api_key");
        }
    }

    // Load tracker configs from store
    let mut tracker_configs = persistence.get(TRACKER_CONFIGS_KEY)?;

    // Strip tracker API keys if not including credentials
    if !include_credentials {
        if let Some(serde_json::Value::Array(ref mut configs)) = tracker_configs {
            for config in configs.iter_mut() {
                if let Some(obj) = config.as_object_mut() {
                    obj.remove("api_key");
                }
            }
        }
    }

    let watch_rules = persistence.get(WATCH_RULES_KEY)?;

    let frontend_value: Option<serde_json::Value> = serde_json::from_str(frontend_settings_json).ok();

    let export = ExportData {
        version: "1.0".to_string(),
        app_settings: settings_value,
        frontend_settings: frontend_value,
        tracker_configs,
        watch_rules,
    };

    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

/// Apply a document from [`export_settings`]; returns the frontend settings for the caller to
/// apply and the sections that were imported.
pub async fn import_settings(state: &AppState, persistence: &Persistence, json: &str) -> Result<ImportResult, String> {
    let data: ExportData = serde_json::from_str(json).map_err(|e| format!("Invalid settings file: {}", e))?;

    let mut imported = Vec::new();

    // Import app settings (persist + update in-memory)
    if let Ok(settings) = serde_json::from_value::<crate::state::AppSettings>(data.app_settings) {
        crate::service::settings::save_app_settings(persistence, &settings)?;
        let config = settings.engine_config(state.rar_tool);
        *state.settings.write().await = settings;
        if let Ok(engine) = state.engine() {
            engine.set_config(config);
        }
        imported.push("app_settings".to_string());
    }

    // Import tracker configs
    if let Some(configs) = data.tracker_configs {
        persistence.set(TRACKER_CONFIGS_KEY, configs)?;
        imported.push("tracker_configs".to_string());
    }

    // Import watch rules
    if let Some(rules_value) = data.watch_rules {
        if let Ok(rules) = serde_json::from_value::<Vec<crate::watchlist::WatchRule>>(rules_value.clone()) {
            *state.watch_rules.write().await = rules;
        }
        persistence.set(WATCH_RULES_KEY, rules_value)?;
        imported.push("watch_rules".to_string());
    }

    let frontend_json = data.frontend_settings.map(|v| v.to_string());
    if frontend_json.is_some() {
        imported.push("frontend_settings".to_string());
    }

    Ok(ImportResult { frontend_settings: frontend_json, imported_sections: imported })
}
