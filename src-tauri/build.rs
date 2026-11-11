fn main() {
    // Only the desktop app embeds the Tauri context; the headless server has no Tauri at all.
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
