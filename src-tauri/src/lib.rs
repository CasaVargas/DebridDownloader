mod api;
mod commands;
mod downloader;
mod scrapers;
mod state;
mod streaming;

use state::AppState;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("DebridDownloader")
                .build(),
        )
        .setup(|app| {
            // Build tray menu
            let show_i = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_i, &quit_i])
                .build()?;

            // Build tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DebridDownloader")
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Start streaming proxy server
            let state: tauri::State<'_, AppState> = app.state();
            let sessions = state.stream_sessions.clone();
            let port_holder = state.streaming_port.clone();
            tokio::spawn(async move {
                if let Err(e) = streaming::start_streaming_server(sessions, port_holder).await {
                    log::error!("Streaming server failed: {}", e);
                }
            });

            Ok(())
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::set_api_token,
            commands::auth::load_saved_token,
            commands::auth::logout,
            commands::auth::is_authenticated,
            commands::auth::get_user,
            commands::auth::oauth_start,
            commands::auth::oauth_poll_credentials,
            commands::auth::oauth_get_token,
            // Torrents
            commands::torrents::list_torrents,
            commands::torrents::get_torrent_info,
            commands::torrents::add_magnet,
            commands::torrents::add_torrent_file,
            commands::torrents::select_torrent_files,
            commands::torrents::delete_torrent,
            // Downloads
            commands::downloads::unrestrict_link,
            commands::downloads::unrestrict_torrent_links,
            commands::downloads::start_downloads,
            commands::downloads::cancel_download,
            commands::downloads::get_download_tasks,
            commands::downloads::clear_completed_downloads,
            commands::downloads::get_download_history,
            // Settings
            commands::settings::get_settings,
            commands::settings::update_settings,
            // Search
            commands::search::search_torrents,
            commands::search::get_tracker_configs,
            commands::search::save_tracker_configs,
            // Streaming
            commands::streaming::get_stream_url,
            commands::streaming::cleanup_stream_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
