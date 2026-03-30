mod commands;
mod providers;
mod downloader;
mod media_parser;
mod media_servers;
mod rclone;
mod tmdb;
mod organizer;
mod scrapers;
mod state;
mod streaming;
mod watchlist;

use state::AppState;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_store::StoreExt;

/// Holds a magnet URI received during cold start, before the frontend is ready.
pub struct PendingMagnetUri(pub std::sync::Mutex<Option<String>>);

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
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Always bring the window to front
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for arg in argv.iter() {
                if commands::magnet::validate_magnet_uri(arg) {
                    let _ = app.emit("magnet-link-received", arg.clone());
                    return;
                }
            }
        }))
        .manage(PendingMagnetUri(std::sync::Mutex::new(None)))
        .setup(|app| {
            // Deep-link handler for magnet URIs
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                // Show and focus the window when a deep link arrives
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }

                for url in event.urls() {
                    let url_str = url.to_string();
                    if commands::magnet::validate_magnet_uri(&url_str) {
                        // Store as pending in case the frontend hasn't loaded yet (cold start)
                        if let Some(state) = app_handle.try_state::<PendingMagnetUri>() {
                            *state.0.lock().unwrap() = Some(url_str.clone());
                        }
                        let _ = app_handle.emit("magnet-link-received", url_str);
                    } else {
                        log::debug!("Dropped invalid magnet URI: {}", url_str);
                    }
                }
            });

            // Check for pending magnet URI from cold start CLI args (Windows/Linux)
            for arg in std::env::args().skip(1) {
                if commands::magnet::validate_magnet_uri(&arg) {
                    if let Some(state) = app.try_state::<PendingMagnetUri>() {
                        *state.0.lock().unwrap() = Some(arg);
                    }
                    break;
                }
            }

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

            // Migrate unprefixed keyring keys to prefixed format
            {
                use keyring::Entry;
                let migrate = || -> Result<(), Box<dyn std::error::Error>> {
                    let service = "com.jonathan.debriddownloader";
                    let migration_key = Entry::new(service, "migration_v2_done")?;
                    if migration_key.get_password().is_ok() {
                        return Ok(()); // already migrated
                    }

                    let keys = ["api_token", "refresh_token", "oauth_client_id", "oauth_client_secret"];
                    for key in &keys {
                        if let Ok(entry) = Entry::new(service, key) {
                            if let Ok(value) = entry.get_password() {
                                let new_key = format!("real-debrid.{}", key);
                                if let Ok(new_entry) = Entry::new(service, &new_key) {
                                    let _ = new_entry.set_password(&value);
                                }
                                let _ = entry.delete_credential();
                            }
                        }
                    }

                    migration_key.set_password("done")?;
                    Ok(())
                };
                if let Err(e) = migrate() {
                    log::warn!("Keyring migration failed: {}", e);
                }
            }

            // Start streaming proxy server
            let state: tauri::State<'_, AppState> = app.state();
            let sessions = state.stream_sessions.clone();
            let port_holder = state.streaming_port.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = streaming::start_streaming_server(sessions, port_holder).await {
                    log::error!("Streaming server failed: {}", e);
                }
            });

            // Load watch list data from store and spawn watch loop
            {
                let state: tauri::State<'_, AppState> = app.state();
                let store = app.store("settings.json").map_err(|e| e.to_string())?;

                if let Some(val) = store.get("watch_rules") {
                    if let Ok(rules) = serde_json::from_value::<Vec<watchlist::WatchRule>>(val.clone()) {
                        *state.watch_rules.blocking_write() = rules;
                    }
                }

                if let Some(val) = store.get("watch_matches") {
                    if let Ok(matches) = serde_json::from_value::<Vec<watchlist::WatchMatch>>(val.clone()) {
                        *state.watch_matches.blocking_write() = matches;
                    }
                }

                if let Some(val) = store.get("watch_seen_hashes") {
                    if let Ok(seen) = serde_json::from_value::<std::collections::HashMap<String, std::collections::HashSet<String>>>(val.clone()) {
                        *state.watch_seen.blocking_write() = seen;
                    }
                }

                let app_handle = app.handle().clone();
                let cancel = state.watch_cancel.clone();
                tauri::async_runtime::spawn(async move {
                    watchlist::start_watch_loop(app_handle, cancel).await;
                });
            }

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
            // Provider management
            commands::auth::get_available_providers,
            commands::auth::get_auth_method,
            commands::auth::switch_provider,
            commands::auth::get_active_provider,
            // Torrents
            commands::torrents::list_torrents,
            commands::torrents::get_torrent_info,
            commands::torrents::add_magnet,
            commands::torrents::add_torrent_file,
            commands::torrents::select_torrent_files,
            commands::torrents::delete_torrent,
            // Downloads
            commands::downloads::unrestrict_torrent_links,
            commands::downloads::start_downloads,
            commands::downloads::cancel_download,
            commands::downloads::remove_download,
            commands::downloads::cancel_all_downloads,
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
            // Magnet link handler
            commands::magnet::set_magnet_handler,
            commands::magnet::get_pending_magnet_uri,
            // rclone
            commands::rclone::check_rclone,
            commands::rclone::list_rclone_remotes,
            commands::rclone::validate_rclone_remote,
            // Media servers
            commands::media_servers::test_media_server,
            // Watch list
            commands::watchlist::get_watch_rules,
            commands::watchlist::add_watch_rule,
            commands::watchlist::update_watch_rule,
            commands::watchlist::delete_watch_rule,
            commands::watchlist::get_watch_matches,
            commands::watchlist::clear_watch_matches,
            commands::watchlist::run_watch_rule_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
