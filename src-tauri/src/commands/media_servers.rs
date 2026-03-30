use crate::media_servers;

#[tauri::command]
pub async fn test_media_server(
    server_type: String,
    url: String,
    credential: String,
) -> Result<String, String> {
    media_servers::test_connection(&server_type, &url, &credential).await
}
