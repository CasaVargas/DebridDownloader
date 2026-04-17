use crate::providers::types::{DownloadItem, DownloadLink};
use crate::downloader;
use crate::rclone;
use crate::state::{AppState, DownloadStatus, DownloadTask};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

/// Get download links for a torrent (replaces unrestrict_torrent_links)
#[tauri::command]
pub async fn unrestrict_torrent_links(
    state: State<'_, AppState>,
    torrent_id: String,
) -> Result<Vec<DownloadLink>, String> {
    let provider = state.get_provider().await;
    provider
        .get_download_links(&torrent_id)
        .await
        .map_err(|e| format!("{}", e))
}

/// Start downloading files to a folder
#[tauri::command]
pub async fn start_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    links: Vec<DownloadLink>,
    destination_folder: String,
    torrent_name: Option<String>,
) -> Result<Vec<String>, String> {
    let settings = state.settings.read().await;
    let create_subfolders = settings.create_torrent_subfolders;
    let max_concurrent = settings.max_concurrent_downloads as usize;
    let symlink_mode = settings.symlink_mode;
    let symlink_mount_path = settings.symlink_mount_path.clone();
    let symlink_library_path = settings.symlink_library_path.clone();
    let auto_organize = settings.auto_organize;
    let movies_folder = settings.movies_folder.clone();
    let tv_folder = settings.tv_folder.clone();
    let tmdb_api_key = settings.tmdb_api_key.clone();
    let plex_url = settings.plex_url.clone();
    let plex_token = settings.plex_token.clone();
    let jellyfin_url = settings.jellyfin_url.clone();
    let jellyfin_api_key = settings.jellyfin_api_key.clone();
    let emby_url = settings.emby_url.clone();
    let emby_api_key = settings.emby_api_key.clone();
    let speed_limit_bytes = settings.speed_limit_bytes;
    let auto_extract = settings.auto_extract_archives;
    let delete_after_extract = settings.delete_archives_after_extract;
    drop(settings);

    // Symlink mode: create symlinks instead of downloading
    if symlink_mode {
        let mount_path = symlink_mount_path
            .ok_or_else(|| "Symlink mode is on but no mount path configured".to_string())?;
        let library_path = symlink_library_path
            .ok_or_else(|| "Symlink mode is on but no library folder configured".to_string())?;

        // Verify mount path exists
        if !tokio::fs::try_exists(&mount_path).await.unwrap_or(false) {
            return Err("Mount path not found — is your rclone mount running?".to_string());
        }

        let mut task_ids = Vec::new();

        for link in &links {
            let id = uuid::Uuid::new_v4().to_string();

            // Source: file on the rclone mount
            // Try with torrent subfolder first, then flat — mount structure varies
            let source = if let Some(ref name) = torrent_name {
                let with_subfolder = PathBuf::from(&mount_path)
                    .join(name)
                    .join(&link.filename);
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
            let dest = if auto_organize {
                if let (Some(ref mf), Some(ref tf)) = (&movies_folder, &tv_folder) {
                    let result = crate::organizer::organize_path(
                        &link.filename, mf, tf, tmdb_api_key.as_deref(),
                    ).await;
                    result.dest_path
                } else {
                    return Err("Auto-organize is on but Movies/TV folder not configured".to_string());
                }
            } else if create_subfolders {
                if let Some(ref name) = torrent_name {
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
                tokio::fs::create_dir_all(parent).await
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
            tokio::fs::symlink(&source, &dest).await
                .map_err(|e| format!("Failed to create symlink: {}", e))?;

            let task = DownloadTask {
                id: id.clone(),
                filename: link.filename.clone(),
                url: link.download.clone(),
                destination: dest.to_string_lossy().to_string(),
                total_bytes: link.filesize,
                downloaded_bytes: link.filesize,
                speed: 0.0,
                status: DownloadStatus::Completed,
                remote: Some("symlink".to_string()),
            };

            state.active_downloads.write().await.insert(id.clone(), task.clone());

            // Emit completion event
            let progress = crate::downloader::DownloadProgress {
                id: id.clone(),
                filename: task.filename.clone(),
                downloaded_bytes: task.total_bytes,
                total_bytes: task.total_bytes,
                speed: 0.0,
                status: DownloadStatus::Completed,
                remote: Some("symlink".to_string()),
            };
            let _ = app.emit("download-progress", &progress);

            task_ids.push(id);
        }

        // Trigger media server scans
        let scan_app = app.clone();
        let s_plex_url = plex_url.clone();
        let s_plex_token = plex_token.clone();
        let s_jellyfin_url = jellyfin_url.clone();
        let s_jellyfin_key = jellyfin_api_key.clone();
        let s_emby_url = emby_url.clone();
        let s_emby_key = emby_api_key.clone();
        tokio::spawn(async move {
            crate::media_servers::trigger_scans(
                &scan_app,
                s_plex_url.as_deref(), s_plex_token.as_deref(),
                s_jellyfin_url.as_deref(), s_jellyfin_key.as_deref(),
                s_emby_url.as_deref(), s_emby_key.as_deref(),
            ).await;
        });

        return Ok(task_ids);
    }

    let mut task_ids = Vec::new();

    for link in &links {
        let id = uuid::Uuid::new_v4().to_string();
        let is_remote = rclone::is_rclone_path(&destination_folder);

        let dest = if is_remote {
            // rclone paths: string concatenation, NOT PathBuf
            let base = destination_folder.trim_end_matches('/');
            if create_subfolders {
                if let Some(ref name) = torrent_name {
                    format!("{}/{}/{}", base, sanitize_filename(name), sanitize_filename(&link.filename))
                } else {
                    format!("{}/{}", base, sanitize_filename(&link.filename))
                }
            } else {
                format!("{}/{}", base, sanitize_filename(&link.filename))
            }
        } else {
            // Local paths: use PathBuf as before
            if create_subfolders {
                if let Some(ref name) = torrent_name {
                    PathBuf::from(&destination_folder)
                        .join(sanitize_filename(name))
                        .join(sanitize_filename(&link.filename))
                } else {
                    PathBuf::from(&destination_folder).join(sanitize_filename(&link.filename))
                }
            } else {
                PathBuf::from(&destination_folder).join(sanitize_filename(&link.filename))
            }
            .to_string_lossy()
            .to_string()
        };

        let task = DownloadTask {
            id: id.clone(),
            filename: link.filename.clone(),
            url: link.download.clone(),
            destination: dest,
            total_bytes: link.filesize,
            downloaded_bytes: 0,
            speed: 0.0,
            status: DownloadStatus::Pending,
            remote: if is_remote {
                Some(destination_folder.clone())
            } else {
                None
            },
        };

        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        state.active_downloads.write().await.insert(id.clone(), task);
        state.cancel_tokens.write().await.insert(id.clone(), cancel_tx);
        task_ids.push((id, cancel_rx));
    }

    let ids: Vec<String> = task_ids.iter().map(|(id, _)| id.clone()).collect();

    let active_downloads = state.active_downloads.clone();
    let cancel_tokens_map = state.cancel_tokens.clone();

    let dl_auto_organize = auto_organize;
    let dl_movies_folder = movies_folder.clone();
    let dl_tv_folder = tv_folder.clone();
    let dl_tmdb_key = tmdb_api_key.clone();
    let dl_plex_url = plex_url;
    let dl_plex_token = plex_token;
    let dl_jellyfin_url = jellyfin_url;
    let dl_jellyfin_key = jellyfin_api_key;
    let dl_emby_url = emby_url;
    let dl_emby_key = emby_api_key;
    let dl_auto_extract = auto_extract;
    let dl_delete_after = delete_after_extract;
    let dl_rar_tool = state.rar_tool; // RarTool is Copy

    tokio::spawn(async move {
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));
        let mut handles = Vec::new();

        for (id, mut cancel_rx) in task_ids {
            let sem = semaphore.clone();
            let app = app.clone();
            let downloads = active_downloads.clone();
            let cancel_map = cancel_tokens_map.clone();
            let task_organize = dl_auto_organize;
            let task_movies = dl_movies_folder.clone();
            let task_tv = dl_tv_folder.clone();
            let task_tmdb = dl_tmdb_key.clone();
            let task_auto_extract = dl_auto_extract;
            let task_delete_after = dl_delete_after;
            let task_rar_tool = dl_rar_tool; // Copy

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();

                let mut task = {
                    let dl = downloads.read().await;
                    match dl.get(&id) {
                        Some(t) => t.clone(),
                        None => return,
                    }
                };

                let result = if task.remote.is_some() {
                    crate::rclone::download_to_rclone(app.clone(), &mut task, &mut cancel_rx, speed_limit_bytes).await
                } else {
                    downloader::download_file(app.clone(), &mut task, &mut cancel_rx, speed_limit_bytes).await
                };

                if let Err(e) = result {
                    task.status = DownloadStatus::Failed(e);
                }

                // Post-download: extract if archive, then organize the result.
                if task.status == DownloadStatus::Completed && task.remote.is_none() {
                    // --- Extract phase ---
                    let mut extracted_dir: Option<std::path::PathBuf> = None;
                    if task_auto_extract {
                        // Build sibling list from the download's directory.
                        let archive_path = std::path::PathBuf::from(&task.destination);
                        if let Some(parent) = archive_path.parent() {
                            let mut siblings: Vec<std::path::PathBuf> = Vec::new();
                            if let Ok(mut entries) = tokio::fs::read_dir(parent).await {
                                while let Ok(Some(entry)) = entries.next_entry().await {
                                    siblings.push(entry.path());
                                }
                            }
                            let sibling_refs: Vec<&std::path::Path> =
                                siblings.iter().map(|p| p.as_path()).collect();
                            if let Some(group) =
                                crate::extractor::classify(&archive_path, &sibling_refs)
                            {
                                // Mark Extracting and emit
                                task.status = DownloadStatus::Extracting;
                                downloads.write().await.insert(id.clone(), task.clone());
                                let _ = app.emit("download-progress",
                                    &crate::downloader::DownloadProgress {
                                        id: id.clone(),
                                        filename: task.filename.clone(),
                                        downloaded_bytes: task.total_bytes,
                                        total_bytes: task.total_bytes,
                                        speed: 0.0,
                                        status: DownloadStatus::Extracting,
                                        remote: task.remote.clone(),
                                    });

                                // Extract into <parent>/<basename-without-ext>/
                                let base = crate::extractor::archive_basename(&group.primary);
                                let dest = parent.join(&base);
                                match crate::extractor::extract(&group, &dest, task_rar_tool).await {
                                    Ok(()) => {
                                        extracted_dir = Some(dest.clone());
                                        task.status = DownloadStatus::Completed;
                                        // Delete archive parts if requested
                                        if task_delete_after {
                                            for part in &group.all_parts {
                                                if let Err(e) = tokio::fs::remove_file(part).await {
                                                    log::warn!(
                                                        "Failed to delete archive part {:?}: {}",
                                                        part, e
                                                    );
                                                }
                                            }
                                        }
                                        log::info!("Extracted: {:?} → {:?}", group.primary, dest);
                                    }
                                    Err(e) => {
                                        task.status = DownloadStatus::Failed(e.to_string());
                                        log::warn!("Extract failed: {}", e);
                                    }
                                }
                            }
                        }
                    }

                    // --- Organize phase ---
                    // If extraction produced exactly one video, organize that.
                    // If it produced 0 or >1, skip organize.
                    // If extraction didn't happen, fall back to original organize.
                    if task.status == DownloadStatus::Completed && task_organize {
                        if let (Some(ref mf), Some(ref tf)) = (&task_movies, &task_tv) {
                            let organize_source = if let Some(ref ed) = extracted_dir {
                                let count = crate::extractor::count_videos(ed);
                                if count == 1 {
                                    find_single_video(ed)
                                } else {
                                    log::info!(
                                        "Extracted dir has {} videos — skipping organize",
                                        count
                                    );
                                    None
                                }
                            } else {
                                Some(std::path::PathBuf::from(&task.destination))
                            };

                            if let Some(src) = organize_source {
                                let fname = src
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or(&task.filename)
                                    .to_string();
                                let result = crate::organizer::organize_path(
                                    &fname, mf, tf, task_tmdb.as_deref(),
                                )
                                .await;
                                match crate::organizer::move_file(&src, &result.dest_path).await {
                                    Ok(()) => {
                                        task.destination =
                                            result.dest_path.to_string_lossy().to_string();
                                        log::info!(
                                            "Organized: {} → {}",
                                            task.filename, task.destination
                                        );
                                    }
                                    Err(e) => {
                                        log::warn!(
                                            "Failed to organize {}: {}", task.filename, e
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                downloads.write().await.insert(id.clone(), task);
                cancel_map.write().await.remove(&id);
            });

            handles.push(handle);
        }

        for handle in handles {
            let _ = handle.await;
        }

        // Trigger media server scans after all downloads complete
        crate::media_servers::trigger_scans(
            &app,
            dl_plex_url.as_deref(), dl_plex_token.as_deref(),
            dl_jellyfin_url.as_deref(), dl_jellyfin_key.as_deref(),
            dl_emby_url.as_deref(), dl_emby_key.as_deref(),
        ).await;
    });

    Ok(ids)
}

#[tauri::command]
pub async fn cancel_download(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    if let Some(tx) = state.cancel_tokens.read().await.get(&id) {
        let _ = tx.send(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_all_downloads(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let tokens = state.cancel_tokens.read().await;
    for tx in tokens.values() {
        let _ = tx.send(true);
    }
    drop(tokens);
    state.cancel_tokens.write().await.clear();
    state.active_downloads.write().await.clear();
    Ok(())
}

#[tauri::command]
pub async fn get_download_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<DownloadTask>, String> {
    let downloads = state.active_downloads.read().await;
    Ok(downloads.values().cloned().collect())
}

#[tauri::command]
pub async fn remove_download(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    if let Some(tx) = state.cancel_tokens.read().await.get(&id) {
        let _ = tx.send(true);
    }
    state.cancel_tokens.write().await.remove(&id);
    state.active_downloads.write().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn clear_completed_downloads(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut downloads = state.active_downloads.write().await;
    downloads.retain(|_, task| {
        matches!(
            task.status,
            DownloadStatus::Pending
                | DownloadStatus::Downloading
                | DownloadStatus::Paused
                | DownloadStatus::Extracting
        )
    });
    Ok(())
}

#[tauri::command]
pub async fn get_download_history(
    state: State<'_, AppState>,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<DownloadItem>, String> {
    let provider = state.get_provider().await;
    provider
        .download_history(page.unwrap_or(1), limit.unwrap_or(100))
        .await
        .map_err(|e| format!("{}", e))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}


fn find_single_video(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "avi", "mov", "m4v", "webm"];
    let mut found: Option<std::path::PathBuf> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() { stack.push(path); continue; }
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
                    if found.is_some() { return None; } // multiple videos
                    found = Some(path);
                }
            }
        }
    }
    found
}
