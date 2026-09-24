use crate::engine::{JobKind, JobView, NewJob};
use crate::providers::types::{DownloadItem, DownloadLink};
use crate::rclone;
use crate::state::{AppSettings, AppState};
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Get download links for a torrent
#[tauri::command]
pub async fn unrestrict_torrent_links(state: State<'_, AppState>, torrent_id: String) -> Result<Vec<DownloadLink>, String> {
    let provider = state.get_provider().await;
    provider.get_download_links(&torrent_id).await.map_err(|e| format!("{}", e))
}

/// Queue files for download
#[tauri::command]
pub async fn start_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    links: Vec<DownloadLink>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<Vec<String>, String> {
    let settings = state.settings.read().await.clone();
    let engine = state.engine()?;
    if settings.symlink_mode {
        return symlink_downloads(&app, &engine, &settings, &links, torrent_name.as_deref()).await;
    }
    let is_remote = rclone::is_rclone_path(&destination_folder);
    let batch_id = uuid::Uuid::new_v4().to_string();
    let jobs = links
        .iter()
        .map(|link| NewJob {
            kind: if is_remote { JobKind::Remote { rclone_dest: destination_folder.clone() } } else { JobKind::Http },
            filename: link.filename.clone(),
            destination: build_destination(
                &destination_folder,
                is_remote,
                settings.create_torrent_subfolders,
                torrent_name.as_deref(),
                &link.filename,
            ),
            source: link.source.clone(),
            url: link.download.clone(),
            total_bytes: link.filesize,
            batch_id: batch_id.clone(),
        })
        .collect();
    Ok(engine.enqueue(jobs).await)
}

pub(crate) fn build_destination(folder: &str, is_remote: bool, subfolders: bool, torrent_name: Option<&str>, filename: &str) -> String {
    let file = sanitize_filename(filename);
    if is_remote {
        // rclone paths: string concatenation, NOT PathBuf
        let base = folder.trim_end_matches('/');
        match (subfolders, torrent_name) {
            (true, Some(name)) => format!("{}/{}/{}", base, sanitize_filename(name), file),
            _ => format!("{}/{}", base, file),
        }
    } else {
        let mut p = PathBuf::from(folder);
        if let (true, Some(name)) = (subfolders, torrent_name) {
            p = p.join(sanitize_filename(name));
        }
        p.join(file).to_string_lossy().to_string()
    }
}

/// Symlink mode: create symlinks from the rclone mount instead of downloading.
async fn symlink_downloads(
    app: &AppHandle,
    engine: &crate::engine::Engine,
    settings: &AppSettings,
    links: &[DownloadLink],
    torrent_name: Option<&str>,
) -> Result<Vec<String>, String> {
    let mount_path = settings
        .symlink_mount_path
        .clone()
        .ok_or_else(|| "Symlink mode is on but no mount path configured".to_string())?;
    let library_path = settings
        .symlink_library_path
        .clone()
        .ok_or_else(|| "Symlink mode is on but no library folder configured".to_string())?;

    // Verify mount path exists
    if !tokio::fs::try_exists(&mount_path).await.unwrap_or(false) {
        return Err("Mount path not found — is your rclone mount running?".to_string());
    }

    let mut task_ids = Vec::new();

    for link in links {
        // Source: file on the rclone mount
        // Try with torrent subfolder first, then flat — mount structure varies
        let source = if let Some(name) = torrent_name {
            let with_subfolder = PathBuf::from(&mount_path).join(name).join(&link.filename);
            if tokio::fs::try_exists(&with_subfolder).await.unwrap_or(false) {
                with_subfolder
            } else {
                // Try flat (single-file torrents or flat mount)
                PathBuf::from(&mount_path).join(&link.filename)
            }
        } else {
            PathBuf::from(&mount_path).join(&link.filename)
        };

        // Destination: organized path or raw library folder
        let dest = if settings.auto_organize {
            if let (Some(mf), Some(tf)) = (&settings.movies_folder, &settings.tv_folder) {
                let result =
                    crate::organizer::organize_path(&link.filename, mf, tf, settings.tmdb_api_key.as_deref()).await;
                result.dest_path
            } else {
                return Err("Auto-organize is on but Movies/TV folder not configured".to_string());
            }
        } else if settings.create_torrent_subfolders {
            if let Some(name) = torrent_name {
                PathBuf::from(&library_path)
                    .join(sanitize_filename(name))
                    .join(sanitize_filename(&link.filename))
            } else {
                PathBuf::from(&library_path).join(sanitize_filename(&link.filename))
            }
        } else {
            PathBuf::from(&library_path).join(sanitize_filename(&link.filename))
        };

        // Create parent directories
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create library directory: {}", e))?;
        }

        // Verify source file exists on the mount
        if !tokio::fs::try_exists(&source).await.unwrap_or(false) {
            return Err(format!(
                "File not found on mount: {} — torrent may still be processing",
                source.display()
            ));
        }

        // Remove existing symlink if present
        if tokio::fs::symlink_metadata(&dest).await.is_ok() {
            let _ = tokio::fs::remove_file(&dest).await;
        }

        // Create symlink
        #[cfg(unix)]
        tokio::fs::symlink(&source, &dest)
            .await
            .map_err(|e| format!("Failed to create symlink: {}", e))?;

        let id = engine
            .add_completed(NewJob {
                kind: JobKind::Symlink,
                filename: link.filename.clone(),
                destination: dest.to_string_lossy().to_string(),
                source: link.source.clone(),
                url: link.download.clone(),
                total_bytes: link.filesize,
                batch_id: String::new(),
            })
            .await;
        task_ids.push(id);
    }

    // Trigger media server scans
    let scan_app = app.clone();
    let s = settings.clone();
    tokio::spawn(async move {
        crate::media_servers::trigger_scans(
            &scan_app,
            s.plex_url.as_deref(),
            s.plex_token.as_deref(),
            s.jellyfin_url.as_deref(),
            s.jellyfin_api_key.as_deref(),
            s.emby_url.as_deref(),
            s.emby_api_key.as_deref(),
        )
        .await;
    });

    Ok(task_ids)
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.cancel(&id);
    Ok(())
}

#[tauri::command]
pub async fn cancel_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.cancel_all();
    Ok(())
}

#[tauri::command]
pub async fn get_download_tasks(state: State<'_, AppState>) -> Result<Vec<JobView>, String> {
    Ok(state.engine()?.list().await)
}

#[tauri::command]
pub async fn remove_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn clear_completed_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.clear_inactive();
    Ok(())
}

#[tauri::command]
pub async fn pause_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.pause(&id);
    Ok(())
}

#[tauri::command]
pub async fn resume_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.resume(&id);
    Ok(())
}

#[tauri::command]
pub async fn retry_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine()?.retry(&id);
    Ok(())
}

#[tauri::command]
pub async fn pause_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.pause_all();
    Ok(())
}

#[tauri::command]
pub async fn resume_all_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.resume_all();
    Ok(())
}

#[tauri::command]
pub async fn retry_failed_downloads(state: State<'_, AppState>) -> Result<(), String> {
    state.engine()?.retry_failed();
    Ok(())
}

#[tauri::command]
pub async fn get_download_history(state: State<'_, AppState>, page: Option<u32>, limit: Option<u32>) -> Result<Vec<DownloadItem>, String> {
    let provider = state.get_provider().await;
    provider.download_history(page.unwrap_or(1), limit.unwrap_or(100)).await.map_err(|e| format!("{}", e))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::build_destination;

    #[test]
    fn destinations() {
        assert_eq!(build_destination("/dl", false, true, Some("Show S01"), "e1.mkv"), std::path::PathBuf::from("/dl").join("Show S01").join("e1.mkv").to_string_lossy());
        assert_eq!(build_destination("/dl", false, false, Some("Show"), "a:b.mkv"), std::path::PathBuf::from("/dl").join("a_b.mkv").to_string_lossy());
        assert_eq!(build_destination("gdrive:Media/", true, true, Some("T"), "f.mkv"), "gdrive:Media/T/f.mkv");
        assert_eq!(build_destination("gdrive:Media", true, false, None, "f.mkv"), "gdrive:Media/f.mkv");
    }
}
