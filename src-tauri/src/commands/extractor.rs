use crate::extractor;

/// Re-scan PATH for a RAR tool and return the tool name, or None.
/// Called by the Settings UI whenever it mounts / refreshes.
#[tauri::command]
pub async fn detect_rar_tool() -> Option<String> {
    extractor::detect_rar_tool()
        .name()
        .map(|s| s.to_string())
}
