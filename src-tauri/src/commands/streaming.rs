use crate::state::{AppState, StreamSession};
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_stream_url(
    state: State<'_, AppState>,
    torrent_id: String,
    file_id: u64,
) -> Result<serde_json::Value, String> {
    // Check streaming server is running
    let port = state
        .streaming_port
        .read()
        .await
        .ok_or("Streaming server not running")?;

    // Fetch torrent info
    let info = state
        .client
        .torrent_info(&torrent_id)
        .await
        .map_err(|e| format!("Failed to fetch torrent info: {}", e))?;

    // Precondition: torrent must be downloaded
    if info.status != "downloaded" {
        return Err("Torrent is not ready for streaming.".to_string());
    }

    // Map file_id to link index:
    // RD's links array corresponds 1:1 with selected files in order
    let selected_files: Vec<_> = info.files.iter().filter(|f| f.selected == 1).collect();
    let link_index = selected_files
        .iter()
        .position(|f| f.id == file_id)
        .ok_or("File not available for streaming")?;

    let link = info
        .links
        .get(link_index)
        .ok_or("No link available for this file")?;

    // Unrestrict the link
    let unrestricted = state
        .client
        .unrestrict_link(link)
        .await
        .map_err(|e| format!("Failed to unrestrict link: {}", e))?;

    // Create session
    let session_id = Uuid::new_v4().to_string();
    let session = StreamSession {
        url: unrestricted.download,
        created_at: Instant::now(),
    };

    state
        .stream_sessions
        .write()
        .await
        .insert(session_id.clone(), session);

    let stream_url = format!("http://127.0.0.1:{}/stream/{}", port, session_id);

    Ok(serde_json::json!({
        "stream_url": stream_url,
        "session_id": session_id
    }))
}

#[tauri::command]
pub async fn cleanup_stream_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.stream_sessions.write().await.remove(&session_id);
    Ok(())
}
