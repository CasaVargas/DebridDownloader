//! Secret storage behind a trait, so secrets don't have to live in the OS keyring.
//!
//! The desktop app uses [`KeyringStore`] (OS keychain / Credential Manager / Secret Service).
//! A headless host (NAS, Docker) has no keyring, so it uses [`FileStore`]: an environment
//! variable wins, else a `0600` JSON file under the config dir.
//!
//! Keys are `<provider-id>.<name>` (e.g. `real-debrid.api_token`) in every backend.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub trait SecretStore: Send + Sync {
    /// `Ok(None)` when no secret is stored under `key`.
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    /// Deleting a missing key is not an error.
    fn delete(&self, key: &str) -> Result<(), String>;
}

/// Tauri managed state holding the active secret backend.
#[derive(Clone)]
pub struct Secrets(pub Arc<dyn SecretStore>);

impl std::ops::Deref for Secrets {
    type Target = dyn SecretStore;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}

// ── Keyring backend (desktop) ──

pub const KEYRING_SERVICE: &str = "com.jonathan.debriddownloader";

/// OS keyring backend under service `com.jonathan.debriddownloader`.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self { service: KEYRING_SERVICE.to_string() }
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, String> {
        static MIGRATE: std::sync::Once = std::sync::Once::new();
        MIGRATE.call_once(|| {
            if let Err(e) = migrate_unprefixed_keys(&self.service) {
                log::warn!("Keyring migration failed: {}", e);
            }
        });
        keyring::Entry::new(&self.service, key).map_err(|e| format!("Keyring error: {}", e))
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match self.entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("{}", e)),
        }
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        self.entry(key)?.set_password(value).map_err(|e| format!("{}", e))
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("{}", e)),
        }
    }
}

/// Rename pre-1.x unprefixed keys to `real-debrid.<key>`. Runs on the first keyring access rather
/// than in `setup`: setup is on the main thread after the window exists, so a macOS keychain
/// prompt there froze the webview on a blank white window (#38).
fn migrate_unprefixed_keys(service: &str) -> Result<(), keyring::Error> {
    let migration_key = keyring::Entry::new(service, "migration_v2_done")?;
    if migration_key.get_password().is_ok() {
        return Ok(()); // already migrated
    }

    let keys = ["api_token", "refresh_token", "oauth_client_id", "oauth_client_secret"];
    for key in &keys {
        if let Ok(entry) = keyring::Entry::new(service, key) {
            if let Ok(value) = entry.get_password() {
                if let Ok(new_entry) = keyring::Entry::new(service, &format!("real-debrid.{}", key)) {
                    let _ = new_entry.set_password(&value);
                }
                let _ = entry.delete_credential();
            }
        }
    }

    migration_key.set_password("done")
}

// ── File/env backend (headless) ──

/// Default env var prefix: `real-debrid.api_token` → `DEBRIDDOWNLOADER_SECRET_REAL_DEBRID_API_TOKEN`.
pub const ENV_PREFIX: &str = "DEBRIDDOWNLOADER_SECRET_";
pub const SECRETS_FILE_NAME: &str = "secrets.json";

/// Headless backend: an env var overrides, else a JSON map in a `0600` file.
pub struct FileStore {
    path: PathBuf,
    env_prefix: String,
    lock: Mutex<()>,
}

impl FileStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self::with_env_prefix(path, ENV_PREFIX)
    }

    /// `secrets.json` inside `config_dir`.
    pub fn in_dir(config_dir: &Path) -> Self {
        Self::new(config_dir.join(SECRETS_FILE_NAME))
    }

    pub fn with_env_prefix(path: impl Into<PathBuf>, env_prefix: &str) -> Self {
        Self { path: path.into(), env_prefix: env_prefix.to_string(), lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn env_var_name(&self, key: &str) -> String {
        let suffix: String = key
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
            .collect();
        format!("{}{}", self.env_prefix, suffix)
    }

    fn read_map(&self) -> Result<BTreeMap<String, String>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Ok(BTreeMap::new()),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("Secrets file {} is unreadable: {}", self.path.display(), e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(format!("Failed to read {}: {}", self.path.display(), e)),
        }
    }

    /// Write via a `0600` temp file + rename so the secrets are never world-readable,
    /// not even briefly, and a crash can't leave a half-written file.
    fn write_map(&self, map: &BTreeMap<String, String>) -> Result<(), String> {
        use std::io::Write;
        if let Some(dir) = self.path.parent() {
            if !dir.as_os_str().is_empty() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
            }
        }
        let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
        let mut tmp = self.path.clone().into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);

        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp).map_err(|e| format!("Failed to write {}: {}", tmp.display(), e))?;
        #[cfg(unix)]
        {
            // A leftover temp file keeps its old mode; force 0600 regardless.
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&tmp, &self.path)
            .map_err(|e| format!("Failed to write {}: {}", self.path.display(), e))
    }
}

impl SecretStore for FileStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        if let Ok(v) = std::env::var(self.env_var_name(key)) {
            if !v.is_empty() {
                return Ok(Some(v));
            }
        }
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        Ok(self.read_map()?.get(key).cloned())
    }

    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut map = self.read_map()?;
        map.insert(key.to_string(), value.to_string());
        self.write_map(&map)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut map = self.read_map()?;
        if map.remove(key).is_some() {
            self.write_map(&map)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir, prefix: &str) -> FileStore {
        FileStore::with_env_prefix(dir.path().join("secrets.json"), prefix)
    }

    #[test]
    fn file_store_set_then_get_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir, "DD_TEST_ROUNDTRIP_");
        assert_eq!(s.get("real-debrid.api_token").unwrap(), None);
        s.set("real-debrid.api_token", "abc123").unwrap();
        s.set("torbox.api_token", "tb").unwrap();
        assert_eq!(s.get("real-debrid.api_token").unwrap().as_deref(), Some("abc123"));
        assert_eq!(s.get("torbox.api_token").unwrap().as_deref(), Some("tb"));
        s.set("real-debrid.api_token", "updated").unwrap();
        assert_eq!(s.get("real-debrid.api_token").unwrap().as_deref(), Some("updated"));
    }

    #[test]
    fn file_store_delete_removes() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir, "DD_TEST_DELETE_");
        s.set("real-debrid.api_token", "abc").unwrap();
        s.set("real-debrid.refresh_token", "keep").unwrap();
        s.delete("real-debrid.api_token").unwrap();
        assert_eq!(s.get("real-debrid.api_token").unwrap(), None);
        assert_eq!(s.get("real-debrid.refresh_token").unwrap().as_deref(), Some("keep"));
        // Deleting a missing key is fine.
        s.delete("real-debrid.api_token").unwrap();
        s.delete("never.set").unwrap();
    }

    #[test]
    fn file_store_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        store(&dir, "DD_TEST_RESTART_").set("premiumize.api_token", "persisted").unwrap();
        let fresh = store(&dir, "DD_TEST_RESTART_");
        assert_eq!(fresh.get("premiumize.api_token").unwrap().as_deref(), Some("persisted"));
    }

    #[test]
    fn env_var_overrides_file() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir, "DD_TEST_ENV_OVERRIDE_");
        s.set("real-debrid.api_token", "from-file").unwrap();
        let var = s.env_var_name("real-debrid.api_token");
        assert_eq!(var, "DD_TEST_ENV_OVERRIDE_REAL_DEBRID_API_TOKEN");
        std::env::set_var(&var, "from-env");
        let got = s.get("real-debrid.api_token").unwrap();
        // Env var also answers when nothing is in the file.
        let only_env = store(&tempfile::tempdir().unwrap(), "DD_TEST_ENV_OVERRIDE_")
            .get("real-debrid.api_token")
            .unwrap();
        std::env::remove_var(&var);
        assert_eq!(got.as_deref(), Some("from-env"));
        assert_eq!(only_env.as_deref(), Some("from-env"));
        assert_eq!(s.get("real-debrid.api_token").unwrap().as_deref(), Some("from-file"));
    }

    #[test]
    fn default_env_var_name() {
        let s = FileStore::new("/nonexistent/secrets.json");
        assert_eq!(
            s.env_var_name("real-debrid.api_token"),
            "DEBRIDDOWNLOADER_SECRET_REAL_DEBRID_API_TOKEN"
        );
        assert_eq!(FileStore::in_dir(Path::new("/cfg")).path(), Path::new("/cfg/secrets.json"));
    }

    #[test]
    fn unreadable_file_is_an_error_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir, "DD_TEST_CORRUPT_");
        std::fs::write(s.path(), "not json").unwrap();
        assert!(s.get("a.b").is_err());
        assert!(s.set("a.b", "c").is_err());
        assert_eq!(std::fs::read_to_string(s.path()).unwrap(), "not json");
    }

    #[cfg(unix)]
    #[test]
    fn file_is_created_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let s = FileStore::with_env_prefix(dir.path().join("nested/cfg/secrets.json"), "DD_TEST_MODE_");
        s.set("real-debrid.api_token", "abc").unwrap();
        let mode = std::fs::metadata(s.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "got {:o}", mode);
        // Still 0600 after a rewrite.
        s.delete("real-debrid.api_token").unwrap();
        s.set("x.y", "z").unwrap();
        let mode = std::fs::metadata(s.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "got {:o}", mode);
    }

    #[test]
    fn secrets_wrapper_derefs_to_store() {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Secrets(Arc::new(store(&dir, "DD_TEST_WRAPPER_")));
        secrets.set("k.v", "1").unwrap();
        assert_eq!(secrets.get("k.v").unwrap().as_deref(), Some("1"));
    }
}
