use crate::downloader::emit_progress;
use crate::state::{DownloadStatus, DownloadTask};
use futures::StreamExt;
use serde::Serialize;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct RcloneInfo {
    pub version: String,
    pub available: bool,
}

/// Check if rclone is installed and return version info
pub async fn check_rclone() -> Option<RcloneInfo> {
    let output = Command::new("rclone")
        .arg("version")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // First line is like "rclone v1.68.0"
    let version = stdout
        .lines()
        .next()
        .unwrap_or("rclone (unknown version)")
        .to_string();

    Some(RcloneInfo {
        version,
        available: true,
    })
}

/// List configured rclone remotes
pub async fn list_remotes() -> Result<Vec<String>, String> {
    let output = Command::new("rclone")
        .arg("listremotes")
        .output()
        .await
        .map_err(|e| format!("Failed to run rclone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("rclone listremotes failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let remotes: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(remotes)
}

/// Detect if a path is an rclone remote (matches `name:` or `name:path`)
pub fn is_rclone_path(path: &str) -> bool {
    // Pattern: alphanumeric/hyphen/underscore followed by colon
    // Must not match Windows drive letters like C:\
    if let Some(colon_pos) = path.find(':') {
        if colon_pos == 0 {
            return false;
        }
        // Windows drive letter: single char + colon + backslash
        if colon_pos == 1 && path.len() > 2 && path.as_bytes()[2] == b'\\' {
            return false;
        }
        let name = &path[..colon_pos];
        name.chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    } else {
        false
    }
}

/// Download a file by piping HTTP stream to rclone rcat
pub async fn download_to_rclone(
    app: AppHandle,
    task: &mut DownloadTask,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
    speed_limit: Option<u64>,
) -> Result<(), String> {
    // Start HTTP stream from debrid URL
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

    // Build rclone rcat command
    // destination is the full rclone path like "gdrive:Media/Movies/file.mkv"
    let mut cmd_args = vec![
        "rcat".to_string(),
        "--timeout".to_string(),
        "0".to_string(),
    ];

    if total > 0 {
        cmd_args.push("--size".to_string());
        cmd_args.push(total.to_string());
    }

    cmd_args.push(task.destination.clone());

    let mut child = Command::new("rclone")
        .args(&cmd_args)
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start rclone: {}", e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open rclone stdin".to_string())?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: i64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut speed_bytes: i64 = 0;
    let mut speed_start = std::time::Instant::now();

    let pipe_result: Result<(), String> = loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        if let Err(e) = stdin.write_all(&bytes).await {
                            break Err(format!("Failed to write to rclone: {}", e));
                        }
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
                        break Err(format!("Download stream error: {}", e));
                    }
                    None => break Ok(()),
                }
            }
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    // Kill rclone process
                    let _ = child.kill().await;

                    // Clean up partial remote file (fire-and-forget)
                    let dest = task.destination.clone();
                    tokio::spawn(async move {
                        let _ = Command::new("rclone")
                            .args(["deletefile", &dest])
                            .output()
                            .await;
                    });

                    task.status = DownloadStatus::Cancelled;
                    emit_progress(&app, task);
                    return Ok(());
                }
            }
        }
    };

    // Close stdin to signal EOF to rclone
    drop(stdin);

    if let Err(e) = pipe_result {
        let _ = child.kill().await;
        let _ = child.wait().await; // Reap the process to avoid zombies
        task.status = DownloadStatus::Failed(e.clone());
        emit_progress(&app, task);
        return Err(e);
    }

    // Wait for rclone to finish uploading
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for rclone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let err = if stderr.is_empty() {
            format!("rclone exited with code {}", output.status)
        } else {
            stderr
        };
        task.status = DownloadStatus::Failed(err.clone());
        emit_progress(&app, task);
        return Err(err);
    }

    task.status = DownloadStatus::Completed;
    task.speed = 0.0;
    emit_progress(&app, task);

    Ok(())
}
