//! Key/value persistence behind a trait, so `settings.json` doesn't have to go through Tauri.
//!
//! The desktop app uses [`TauriStore`] (`tauri-plugin-store`, the same `settings.json` it has
//! always written). A headless host has no `AppHandle`, so it uses [`JsonFileStore`]: the same
//! flat JSON object, read and written directly.
//!
//! One file holds both the `AppSettings` blob ([`SETTINGS_KEY`]) and the watchlist data
//! (`watch_rules`, `watch_matches`, `watch_seen_hashes`), plus the search `tracker_configs`.

use crate::scrapers::TrackerConfig;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// File name of the store, relative to the app data dir.
pub const SETTINGS_STORE: &str = "settings.json";
/// Key of the `AppSettings` blob.
pub const SETTINGS_KEY: &str = "app_settings";
pub const TRACKER_CONFIGS_KEY: &str = "tracker_configs";
pub const WATCH_RULES_KEY: &str = "watch_rules";
pub const WATCH_MATCHES_KEY: &str = "watch_matches";
pub const WATCH_SEEN_KEY: &str = "watch_seen_hashes";

pub trait KvStore: Send + Sync {
    /// `Ok(None)` when nothing is stored under `key`.
    fn get(&self, key: &str) -> Result<Option<Value>, String>;
    /// Store `value` under `key` and persist it to disk.
    fn set(&self, key: &str, value: Value) -> Result<(), String>;
}

/// Tauri managed state holding the active persistence backend.
#[derive(Clone)]
pub struct Persistence(pub Arc<dyn KvStore>);

impl std::ops::Deref for Persistence {
    type Target = dyn KvStore;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}

impl Persistence {
    /// Serialize `value` and store it under `key`.
    pub fn set_json<T: Serialize + ?Sized>(&self, key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_value(value).map_err(|e| e.to_string())?;
        self.set(key, json)
    }

    /// Saved tracker configs; empty when none are saved or the store can't be read.
    pub fn load_tracker_configs(&self) -> Vec<TrackerConfig> {
        match self.get(TRACKER_CONFIGS_KEY) {
            Ok(Some(val)) => serde_json::from_value(val).unwrap_or_default(),
            _ => vec![],
        }
    }
}

// ── Tauri-store backend (desktop) ──

/// `tauri-plugin-store` backend: every call goes through `app.store(file)`, as before the seam.
#[cfg(feature = "desktop")]
pub struct TauriStore<R: tauri::Runtime = tauri::Wry> {
    app: tauri::AppHandle<R>,
    file: String,
}

#[cfg(feature = "desktop")]
impl<R: tauri::Runtime> TauriStore<R> {
    pub fn new(app: tauri::AppHandle<R>, file: impl Into<String>) -> Self {
        Self { app, file: file.into() }
    }
}

#[cfg(feature = "desktop")]
impl<R: tauri::Runtime> KvStore for TauriStore<R> {
    fn get(&self, key: &str) -> Result<Option<Value>, String> {
        use tauri_plugin_store::StoreExt;
        let store = self.app.store(&self.file).map_err(|e| e.to_string())?;
        Ok(store.get(key))
    }

    fn set(&self, key: &str, value: Value) -> Result<(), String> {
        use tauri_plugin_store::StoreExt;
        let store = self.app.store(&self.file).map_err(|e| e.to_string())?;
        store.set(key, value);
        store.save().map_err(|e| e.to_string())
    }
}

// ── JSON-file backend (headless) ──

/// Headless backend: a flat JSON object in one file, the same shape `tauri-plugin-store` writes,
/// so a desktop `settings.json` can be pointed at directly.
pub struct JsonFileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl JsonFileStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into(), lock: Mutex::new(()) }
    }

    /// `settings.json` inside `data_dir`.
    pub fn in_dir(data_dir: &Path) -> Self {
        Self::new(data_dir.join(SETTINGS_STORE))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// A missing or empty file is an empty map. Anything else that can't be read is an error, so
    /// a later `set` never overwrites a file we failed to parse.
    fn read_map(&self) -> Result<Map<String, Value>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Ok(Map::new()),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("Store file {} is unreadable: {}", self.path.display(), e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(format!("Failed to read {}: {}", self.path.display(), e)),
        }
    }

    /// Write a temp file then rename, so a crash can't leave a half-written store.
    fn write_map(&self, map: &Map<String, Value>) -> Result<(), String> {
        use std::io::Write;
        if let Some(dir) = self.path.parent() {
            if !dir.as_os_str().is_empty() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
            }
        }
        let json = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
        let mut tmp = self.path.clone().into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        let mut file = std::fs::File::create(&tmp)
            .map_err(|e| format!("Failed to write {}: {}", tmp.display(), e))?;
        file.write_all(&json).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&tmp, &self.path)
            .map_err(|e| format!("Failed to write {}: {}", self.path.display(), e))
    }
}

impl KvStore for JsonFileStore {
    fn get(&self, key: &str) -> Result<Option<Value>, String> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        Ok(self.read_map()?.get(key).cloned())
    }

    fn set(&self, key: &str, value: Value) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut map = self.read_map()?;
        map.insert(key.to_string(), value);
        self.write_map(&map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppSettings;
    use serde_json::json;

    fn file_store(dir: &tempfile::TempDir) -> JsonFileStore {
        JsonFileStore::in_dir(dir.path())
    }

    #[test]
    fn json_file_store_set_then_get_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let s = file_store(&dir);
        assert_eq!(s.get(WATCH_RULES_KEY).unwrap(), None);
        s.set(WATCH_RULES_KEY, json!([{"id": "a"}])).unwrap();
        s.set(TRACKER_CONFIGS_KEY, json!([])).unwrap();
        assert_eq!(s.get(WATCH_RULES_KEY).unwrap(), Some(json!([{"id": "a"}])));
        assert_eq!(s.get(TRACKER_CONFIGS_KEY).unwrap(), Some(json!([])));
        s.set(WATCH_RULES_KEY, json!([])).unwrap();
        assert_eq!(s.get(WATCH_RULES_KEY).unwrap(), Some(json!([])));
    }

    #[test]
    fn json_file_store_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        file_store(&dir).set(WATCH_SEEN_KEY, json!({"r": ["h1"]})).unwrap();
        let fresh = file_store(&dir);
        assert_eq!(fresh.get(WATCH_SEEN_KEY).unwrap(), Some(json!({"r": ["h1"]})));
        assert_eq!(fresh.path(), dir.path().join("settings.json"));
    }

    #[test]
    fn json_file_store_reads_a_tauri_store_file() {
        // tauri-plugin-store writes a flat pretty-printed JSON object; a headless host can reuse it.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(SETTINGS_STORE);
        let existing = json!({
            "app_settings": serde_json::to_value(AppSettings::default()).unwrap(),
            "watch_rules": [],
            "tracker_configs": [{"id": "t", "name": "T", "url": "http://x", "tracker_type": "torznab", "enabled": true}],
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&existing).unwrap()).unwrap();
        let s = JsonFileStore::new(&path);
        assert_eq!(s.get(WATCH_RULES_KEY).unwrap(), Some(json!([])));
        s.set(WATCH_MATCHES_KEY, json!([])).unwrap();
        // Writing one key keeps the others.
        let on_disk: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(on_disk["tracker_configs"], existing["tracker_configs"]);
        assert_eq!(on_disk["app_settings"], existing["app_settings"]);
        assert_eq!(on_disk["watch_matches"], json!([]));
    }

    #[test]
    fn json_file_store_creates_missing_dirs_and_treats_empty_file_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let s = JsonFileStore::new(dir.path().join("nested/data/settings.json"));
        s.set("k", json!(1)).unwrap();
        assert_eq!(s.get("k").unwrap(), Some(json!(1)));

        let empty = dir.path().join("empty.json");
        std::fs::write(&empty, "  \n").unwrap();
        assert_eq!(JsonFileStore::new(&empty).get("k").unwrap(), None);
    }

    #[test]
    fn unreadable_file_is_an_error_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let s = file_store(&dir);
        std::fs::write(s.path(), "not json").unwrap();
        assert!(s.get("a").is_err());
        assert!(s.set("a", json!(1)).is_err());
        assert_eq!(std::fs::read_to_string(s.path()).unwrap(), "not json");
    }

    #[test]
    fn persistence_round_trips_app_settings_blob() {
        let dir = tempfile::tempdir().unwrap();
        let p = Persistence(Arc::new(file_store(&dir)));
        let mut settings = AppSettings::default();
        settings.download_folder = Some("/downloads".into());
        settings.provider = "torbox".into();
        p.set_json(SETTINGS_KEY, &settings).unwrap();
        let loaded: AppSettings =
            serde_json::from_value(p.get(SETTINGS_KEY).unwrap().unwrap()).unwrap();
        assert_eq!(loaded.download_folder.as_deref(), Some("/downloads"));
        assert_eq!(loaded.provider, "torbox");
    }

    #[test]
    fn load_tracker_configs_defaults_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        let p = Persistence(Arc::new(file_store(&dir)));
        assert!(p.load_tracker_configs().is_empty());

        // Garbage under the key, or an unreadable file, also yields empty (as before the seam).
        p.set(TRACKER_CONFIGS_KEY, json!("nope")).unwrap();
        assert!(p.load_tracker_configs().is_empty());
        std::fs::write(dir.path().join(SETTINGS_STORE), "{").unwrap();
        assert!(p.load_tracker_configs().is_empty());
    }

    #[test]
    fn load_tracker_configs_reads_saved_configs() {
        let dir = tempfile::tempdir().unwrap();
        let p = Persistence(Arc::new(file_store(&dir)));
        let configs: Vec<TrackerConfig> = serde_json::from_value(json!([
            {"id": "t1", "name": "Tracker", "url": "http://x", "tracker_type": "torznab", "enabled": true}
        ]))
        .unwrap();
        p.set_json(TRACKER_CONFIGS_KEY, &configs).unwrap();
        let loaded = p.load_tracker_configs();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "t1");
    }

    /// Commands and the watch loop go through [`Persistence`]; only this module may call
    /// `tauri-plugin-store` directly.
    #[test]
    fn no_direct_store_access_outside_persistence() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        let mut stack = vec![src];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|e| e == "rs")
                    && path.file_name().is_some_and(|n| n != "persistence.rs")
                {
                    let text = std::fs::read_to_string(&path).unwrap();
                    if text.contains("StoreExt") || text.contains(".store(\"") || text.contains(".store(SETTINGS_STORE") {
                        offenders.push(path.display().to_string());
                    }
                }
            }
        }
        assert!(offenders.is_empty(), "direct tauri-plugin-store use in: {:?}", offenders);
    }
}
