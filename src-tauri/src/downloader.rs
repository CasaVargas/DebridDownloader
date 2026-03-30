use crate::state::{DownloadStatus, DownloadTask};
use futures::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub id: String,
    pub filename: String,
    pub downloaded_bytes: i64,
    pub total_bytes: i64,
    pub speed: f64,
    pub status: DownloadStatus,
    pub remote: Option<String>,
}

pub async fn download_file(
    app: AppHandle,
    task: &mut DownloadTask,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
    speed_limit: Option<u64>,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&task.destination);

    if let Some(parent) = dest_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Download from the direct URL — no provider auth needed
    let client = reqwest::Client::new();
    let resp = client
        .get(&task.url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(task.total_bytes as u64) as i64;
    task.total_bytes = total;
    task.status = DownloadStatus::Downloading;
    task.downloaded_bytes = 0;

    emit_progress(&app, task);

    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: i64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut speed_bytes: i64 = 0;
    let mut speed_start = std::time::Instant::now();

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        file.write_all(&bytes).await.map_err(|e| format!("Write error: {}", e))?;
                        downloaded += bytes.len() as i64;
                        speed_bytes += bytes.len() as i64;
                        task.downloaded_bytes = downloaded;

                        let elapsed = speed_start.elapsed().as_secs_f64();
                        if elapsed >= 1.0 {
                            task.speed = speed_bytes as f64 / elapsed;
                            speed_bytes = 0;
                            speed_start = std::time::Instant::now();
                        }

                        // Throttle if over speed limit
                        if let Some(limit) = speed_limit {
                            let el = speed_start.elapsed().as_secs_f64();
                            if el > 0.0 && speed_bytes as f64 / el > limit as f64 {
                                let target = speed_bytes as f64 / limit as f64;
                                let sleep = target - el;
                                if sleep > 0.0 {
                                    tokio::time::sleep(std::time::Duration::from_secs_f64(sleep)).await;
                                }
                            }
                        }

                        if last_emit.elapsed().as_millis() >= 100 {
                            emit_progress(&app, task);
                            last_emit = std::time::Instant::now();
                        }
                    }
                    Some(Err(e)) => {
                        task.status = DownloadStatus::Failed(e.to_string());
                        emit_progress(&app, task);
                        return Err(format!("Download stream error: {}", e));
                    }
                    None => break,
                }
            }
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    task.status = DownloadStatus::Cancelled;
                    emit_progress(&app, task);
                    let _ = tokio::fs::remove_file(&dest_path).await;
                    return Ok(());
                }
            }
        }
    }

    file.flush().await.map_err(|e| format!("Flush error: {}", e))?;

    task.status = DownloadStatus::Completed;
    task.speed = 0.0;
    emit_progress(&app, task);

    Ok(())
}

pub fn emit_progress(app: &AppHandle, task: &DownloadTask) {
    let progress = DownloadProgress {
        id: task.id.clone(),
        filename: task.filename.clone(),
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        speed: task.speed,
        status: task.status.clone(),
        remote: task.remote.clone(),
    };
    let _ = app.emit("download-progress", &progress);
}
