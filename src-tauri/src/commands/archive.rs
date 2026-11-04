//! "Download contents" for ZIP files on the debrid service: list the archive remotely and queue
//! each member as its own download, so nothing has to be unzipped afterwards.
use crate::engine::zip_remote::{self, safe_relative_path, ZipEntry};
use crate::engine::{JobKind, NewJob};
use crate::providers::types::DownloadLink;
use crate::rclone;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ZipInspection {
    /// The unrestricted link the listing was read from; pass it back to `start_zip_contents_download`.
    pub link: DownloadLink,
    pub archive_size: u64,
    pub entries: Vec<ZipEntry>,
}

#[derive(Debug, Serialize)]
pub struct ZipDownloadStarted {
    pub ids: Vec<String>,
    /// Folder the archive's contents are written into.
    pub root: String,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).build().expect("reqwest client")
}

pub(crate) fn is_zip_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".zip")
}

/// Read the file list of a ZIP inside a torrent without downloading it.
#[tauri::command]
pub async fn inspect_torrent_zip(state: State<'_, AppState>, torrent_id: String, file_id: u64) -> Result<ZipInspection, String> {
    let provider = state.get_provider().await;
    let link = provider.get_download_link_for_file(&torrent_id, file_id).await.map_err(|e| e.to_string())?;
    if !is_zip_name(&link.filename) {
        return Err(format!("{} is not a .zip file", link.filename));
    }
    let listing = zip_remote::read_listing(&client(), &link.download, Duration::from_secs(30))
        .await
        .map_err(|e| e.to_string())?;
    Ok(ZipInspection { link, archive_size: listing.archive_size, entries: listing.entries })
}

fn archive_stem(filename: &str) -> String {
    let name = Path::new(filename).file_name().and_then(|n| n.to_str()).unwrap_or(filename);
    let stem = if is_zip_name(name) { &name[..name.len() - 4] } else { name };
    safe_relative_path(stem).map(|p| p.join("_")).unwrap_or_else(|| "archive".into())
}

/// Where the contents go. Like "smart extract": if every selected path sits under one top-level
/// folder, that folder is used as-is; otherwise a folder named after the archive is created.
pub(crate) fn contents_root(
    folder: &str,
    subfolders: bool,
    torrent_name: Option<&str>,
    archive_filename: &str,
    paths: &[Vec<String>],
) -> PathBuf {
    let mut root = PathBuf::from(folder);
    let stem = archive_stem(archive_filename);
    if let (true, Some(t)) = (subfolders, torrent_name) {
        // Single-file torrents are usually named after the zip; don't nest twice.
        let t_stem = archive_stem(t);
        if t_stem != stem {
            root = root.join(safe_relative_path(t).map(|p| p.join("_")).unwrap_or(t_stem));
        }
    }
    let first = paths.first().and_then(|p| p.first());
    let single_top = match first {
        Some(top) => paths.iter().all(|p| p.len() >= 2 && p.first() == Some(top)),
        None => false,
    };
    if single_top { root } else { root.join(stem) }
}

/// Queue the selected members of a ZIP (from `inspect_torrent_zip`) as individual downloads.
#[tauri::command]
pub async fn start_zip_contents_download(
    state: State<'_, AppState>,
    link: DownloadLink,
    archive_size: u64,
    entries: Vec<ZipEntry>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<ZipDownloadStarted, String> {
    let settings = state.settings.read().await.clone();
    if settings.symlink_mode {
        return Err("Downloading a ZIP's contents isn't available in symlink mode".into());
    }
    if rclone::is_rclone_path(&destination_folder) {
        return Err("Downloading a ZIP's contents needs a local folder, not an rclone remote".into());
    }
    if let Some(bad) = entries.iter().find(|e| !e.is_dir && e.unsupported.is_some()) {
        return Err(format!("{} can't be downloaded: {}", bad.path, bad.unsupported.as_deref().unwrap_or("")));
    }
    let mut items = Vec::with_capacity(entries.len());
    for e in &entries {
        let parts = safe_relative_path(&e.path).ok_or_else(|| format!("Unsafe path in archive: {}", e.path))?;
        items.push((e, parts));
    }
    let paths: Vec<Vec<String>> = items.iter().map(|(_, p)| p.clone()).collect();
    let root = contents_root(&destination_folder, settings.create_torrent_subfolders, torrent_name.as_deref(), &link.filename, &paths);

    // One up-front space check gives a clear message instead of hundreds of failed jobs.
    let needed: u64 = entries.iter().filter(|e| !e.is_dir).map(|e| e.size).sum();
    let mut probe_dir = root.clone();
    while !probe_dir.exists() {
        match probe_dir.parent() {
            Some(p) => probe_dir = p.to_path_buf(),
            None => break,
        }
    }
    if let Ok(free) = fs4::available_space(&probe_dir) {
        if free < needed {
            return Err(format!(
                "Not enough disk space: the selected files need {:.1} GB, {:.1} GB free",
                needed as f64 / 1e9,
                free as f64 / 1e9
            ));
        }
    }

    let engine = state.engine()?;
    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut jobs = Vec::new();
    for (e, parts) in items {
        let dest = parts.iter().fold(root.clone(), |p, c| p.join(c));
        if e.is_dir {
            tokio::fs::create_dir_all(&dest).await.map_err(|err| format!("Couldn't create {}: {}", dest.display(), err))?;
            continue;
        }
        jobs.push(NewJob {
            kind: JobKind::ZipEntry { entry: e.spec(archive_size) },
            filename: parts.last().cloned().unwrap_or_default(),
            destination: dest.to_string_lossy().to_string(),
            source: link.source.clone(),
            url: link.download.clone(),
            total_bytes: e.compressed_size as i64,
            batch_id: batch_id.clone(),
        });
    }
    let ids = engine.enqueue(jobs).await;
    Ok(ZipDownloadStarted { ids, root: root.to_string_lossy().to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Vec<String> {
        safe_relative_path(s).unwrap()
    }

    #[test]
    fn root_uses_existing_top_folder() {
        let paths = vec![p("Show/S01/e1.mkv"), p("Show/S01/e2.mkv")];
        assert_eq!(contents_root("/dl", true, Some("Show.zip"), "Show.zip", &paths), PathBuf::from("/dl"));
    }

    #[test]
    fn root_creates_archive_folder_for_loose_files() {
        let paths = vec![p("a.mkv"), p("sub/b.mkv")];
        assert_eq!(contents_root("/dl", false, None, "Pack.ZIP", &paths), PathBuf::from("/dl").join("Pack"));
    }

    #[test]
    fn root_keeps_torrent_folder_when_names_differ() {
        let paths = vec![p("a.mkv")];
        assert_eq!(
            contents_root("/dl", true, Some("Big Torrent"), "part.zip", &paths),
            PathBuf::from("/dl").join("Big Torrent").join("part")
        );
    }
}
