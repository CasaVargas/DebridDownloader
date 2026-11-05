//! "Download contents" for ZIP and RAR files on the debrid service: list the archive remotely and
//! queue each member as its own download, so nothing has to be extracted afterwards.
use crate::engine::rar_remote;
use crate::engine::zip_remote::{self, safe_relative_path, ZipEntry};
use crate::engine::{JobKind, NewJob};
use crate::providers::types::DownloadLink;
use crate::rclone;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize)]
pub struct ZipInspection {
    /// The unrestricted link the listing was read from; pass it back to `start_archive_contents_download`.
    pub link: DownloadLink,
    pub archive_size: u64,
    pub entries: Vec<ZipEntry>,
}

/// `archive-listing-progress` event payload.
#[derive(Debug, Clone, Serialize)]
pub struct ListingProgress {
    pub torrent_id: String,
    /// Files found so far.
    pub entries: usize,
    /// Bytes of the archive walked so far.
    pub walked: u64,
    /// Size of the archive.
    pub total: u64,
}

#[derive(Debug, Serialize)]
pub struct ZipDownloadStarted {
    pub ids: Vec<String>,
    /// Folder the archive's contents are written into.
    pub root: String,
}

/// Only provider this has been tested with. TorBox and Premiumize serve archives differently and
/// haven't been verified, so the feature stays off for them.
pub(crate) const SUPPORTED_PROVIDER: &str = "real-debrid";

async fn require_supported_provider(state: &AppState) -> Result<(), String> {
    let active = state.provider_id.read().await.clone();
    if active != SUPPORTED_PROVIDER {
        return Err("Downloading an archive's contents is only available with Real-Debrid".into());
    }
    Ok(())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).build().expect("reqwest client")
}

/// `.zip` or `.rar` (by name; the readers check the signature).
pub(crate) fn archive_ext(name: &str) -> Option<&'static str> {
    let n = name.to_ascii_lowercase();
    if n.ends_with(".zip") {
        Some("zip")
    } else if n.ends_with(".rar") {
        Some("rar")
    } else {
        None
    }
}

/// Read the file list of a ZIP or RAR inside a torrent without downloading it.
///
/// With `file_id`, that file of the torrent is the archive. Without it, the torrent's single
/// download link is: Real-Debrid packs torrents with many files into one RAR, while still listing
/// the original files.
#[tauri::command]
pub async fn inspect_torrent_archive(
    app: AppHandle,
    state: State<'_, AppState>,
    torrent_id: String,
    file_id: Option<u64>,
) -> Result<ZipInspection, String> {
    require_supported_provider(&state).await?;
    let provider = state.get_provider().await;
    let link = match file_id {
        Some(id) => provider.get_download_link_for_file(&torrent_id, id).await.map_err(|e| e.to_string())?,
        None => {
            let mut links = provider.get_download_links(&torrent_id).await.map_err(|e| e.to_string())?;
            if links.len() != 1 {
                return Err(format!("Expected the torrent to have one packed download, found {}", links.len()));
            }
            links.remove(0)
        }
    };
    let timeout = Duration::from_secs(30);
    let listing = match archive_ext(&link.filename) {
        Some("zip") => zip_remote::read_listing(&client(), &link.download, timeout).await,
        Some(_) => {
            // RAR listings walk the archive header by header; tell the dialog how far it got.
            let report = |entries: usize, walked: u64, total: u64| {
                let _ = app.emit("archive-listing-progress", ListingProgress { torrent_id: torrent_id.clone(), entries, walked, total });
            };
            rar_remote::read_listing(&client(), &link.download, timeout, Some(&report)).await
        }
        None => return Err(format!("{} is not a .zip or .rar file", link.filename)),
    }
    .map_err(|e| e.to_string())?;
    Ok(ZipInspection { link, archive_size: listing.archive_size, entries: listing.entries })
}

fn archive_stem(filename: &str) -> String {
    let name = Path::new(filename).file_name().and_then(|n| n.to_str()).unwrap_or(filename);
    let stem = if archive_ext(name).is_some() { &name[..name.len() - 4] } else { name };
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

/// Queue the selected members of an archive (from `inspect_torrent_archive`) as individual downloads.
#[tauri::command]
pub async fn start_archive_contents_download(
    state: State<'_, AppState>,
    link: DownloadLink,
    archive_size: u64,
    entries: Vec<ZipEntry>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<ZipDownloadStarted, String> {
    require_supported_provider(&state).await?;
    let settings = state.settings.read().await.clone();
    if settings.symlink_mode {
        return Err("Downloading an archive's contents isn't available in symlink mode".into());
    }
    if rclone::is_rclone_path(&destination_folder) {
        return Err("Downloading an archive's contents needs a local folder, not an rclone remote".into());
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
    let batch_name = torrent_name.clone().unwrap_or_else(|| archive_stem(&link.filename));
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
            batch_name: batch_name.clone(),
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
