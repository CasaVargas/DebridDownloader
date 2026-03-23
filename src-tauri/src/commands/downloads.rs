use crate::providers::types::{DownloadItem, DownloadLink};
use crate::downloader;
use crate::rclone;
use crate::state::{AppState, DownloadStatus, DownloadTask};
use std::path::PathBuf;
use tauri::{AppHandle, State};

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
    drop(settings);

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

    tokio::spawn(async move {
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));
        let mut handles = Vec::new();

        for (id, mut cancel_rx) in task_ids {
            let sem = semaphore.clone();
            let app = app.clone();
            let downloads = active_downloads.clone();
            let cancel_map = cancel_tokens_map.clone();

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();

                let mut task = {
                    let dl = downloads.read().await;
                    match dl.get(&id) {
                        Some(t) => t.clone(),
                        None => return,
                    }
                };

                let result =
                    downloader::download_file(app, &mut task, &mut cancel_rx).await;

                if let Err(e) = result {
                    task.status = DownloadStatus::Failed(e);
                }

                downloads.write().await.insert(id.clone(), task);
                cancel_map.write().await.remove(&id);
            });

            handles.push(handle);
        }

        for handle in handles {
            let _ = handle.await;
        }
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
            DownloadStatus::Pending | DownloadStatus::Downloading | DownloadStatus::Paused
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
