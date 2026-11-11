//! Host adapters for the engine's seams, shared by the desktop app and the headless server.
//!
//! Each adapter reaches the shared [`AppState`] through a [`StateHandle`]: the desktop app passes
//! its `AppHandle`, the headless server an `Arc<AppState>`. Events go out through
//! [`AppEvents`](crate::events::AppEvents). Only the Tauri half below is desktop-only.
use crate::engine::{
    EngineEvent, EventSink, Job, LinkRefresher, LinkSource, RefreshError, RefreshedLink, RemoteOutcome, RemoteRunner,
};
use crate::events::AppEvents;
use crate::state::{DownloadStatus, DownloadTask, StateHandle};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

// ── Tauri half (desktop) ──

#[cfg(feature = "desktop")]
pub use desktop::TauriEvents;

#[cfg(feature = "desktop")]
mod desktop {
    use crate::state::{AppState, StateHandle};
    use tauri::{AppHandle, Emitter, Manager};

    /// Desktop [`AppEvents`](crate::events::AppEvents): every event goes to the webview via `app.emit`.
    #[derive(Clone)]
    pub struct TauriEvents {
        app: AppHandle,
    }
    impl TauriEvents {
        pub fn new(app: AppHandle) -> Self {
            Self { app }
        }
    }

    impl crate::events::AppEvents for TauriEvents {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            let _ = self.app.emit(event, payload);
        }
    }

    /// The desktop app keeps `AppState` in Tauri's managed state.
    impl StateHandle for AppHandle {
        fn app_state(&self) -> &AppState {
            self.state::<AppState>().inner()
        }
    }
}

// ── Engine seams ──

/// Engine events to the UI: progress and list changes, plus media-server scans when a batch ends.
pub struct HostSink<H: StateHandle + Clone> {
    host: H,
    events: Arc<dyn AppEvents>,
}
impl<H: StateHandle + Clone> HostSink<H> {
    pub fn new(host: H, events: Arc<dyn AppEvents>) -> Self {
        Self { host, events }
    }
}

impl<H: StateHandle + Clone> EventSink for HostSink<H> {
    fn emit(&self, event: EngineEvent) {
        match event {
            EngineEvent::Progress(view) => {
                self.events.emit("download-progress", &view);
            }
            EngineEvent::ListChanged => {
                self.events.emit("downloads-changed", &());
            }
            EngineEvent::BatchFinished { batch_id } => {
                log::info!("Download batch {} finished; triggering media-server scans", batch_id);
                let host = self.host.clone();
                let events = self.events.clone();
                tokio::spawn(async move {
                    let s = host.app_state().settings.read().await.clone();
                    crate::media_servers::trigger_scans(
                        events.as_ref(),
                        s.plex_url.as_deref(),
                        s.plex_token.as_deref(),
                        s.jellyfin_url.as_deref(),
                        s.jellyfin_api_key.as_deref(),
                        s.emby_url.as_deref(),
                        s.emby_api_key.as_deref(),
                    )
                    .await;
                });
            }
        }
    }
}

fn provider_display_name(id: &str) -> String {
    match id {
        "real-debrid" => "Real-Debrid",
        "torbox" => "TorBox",
        "premiumize" => "Premiumize",
        "alldebrid" => "AllDebrid",
        other => other,
    }
    .to_string()
}

pub fn check_provider(source: &LinkSource, active: &str) -> Result<(), RefreshError> {
    match source.provider_id() {
        None => Err(RefreshError::NotRefreshable),
        Some(p) if p != active => Err(RefreshError::ProviderMismatch(provider_display_name(p))),
        Some(_) => Ok(()),
    }
}

pub struct ProviderRefresher<H: StateHandle> {
    host: H,
}
impl<H: StateHandle> ProviderRefresher<H> {
    pub fn new(host: H) -> Self {
        Self { host }
    }
}

#[async_trait::async_trait]
impl<H: StateHandle> LinkRefresher for ProviderRefresher<H> {
    async fn refresh(&self, source: &LinkSource) -> Result<RefreshedLink, RefreshError> {
        let state = self.host.app_state();
        let active = state.provider_id.read().await.clone();
        check_provider(source, &active)?;
        let provider = state.get_provider().await; // clones the Arc; no lock held across .await
        provider
            .refresh_link(source)
            .await
            .map(|l| RefreshedLink { url: l.download })
            .map_err(|e| RefreshError::Failed(e.to_string()))
    }
}

/// Runs `JobKind::Remote` jobs through `rclone rcat`, emitting progress on `events`.
pub struct RcloneRunner {
    events: Arc<dyn AppEvents>,
}
impl RcloneRunner {
    pub fn new(events: Arc<dyn AppEvents>) -> Self {
        Self { events }
    }
}

#[async_trait::async_trait]
impl RemoteRunner for RcloneRunner {
    async fn run(&self, job: Job, cancel: CancellationToken, speed_limit: Option<u64>) -> Result<RemoteOutcome, String> {
        let (wtx, mut wrx) = tokio::sync::watch::channel(false);
        let bridge = tokio::spawn(async move {
            cancel.cancelled().await;
            let _ = wtx.send(true);
            // keep the sender alive until aborted so rclone's `changed()` doesn't spin
            std::future::pending::<()>().await;
        });
        let mut task = DownloadTask {
            id: job.id.clone(),
            filename: job.filename.clone(),
            url: job.url.clone(),
            destination: job.destination.clone(),
            total_bytes: job.total_bytes,
            downloaded_bytes: 0,
            speed: 0.0,
            status: DownloadStatus::Pending,
            remote: job.remote_dest().map(str::to_string),
        };
        let result = crate::rclone::download_to_rclone(self.events.as_ref(), &mut task, &mut wrx, speed_limit).await;
        bridge.abort();
        match result {
            Ok(()) if task.status == DownloadStatus::Cancelled => Ok(RemoteOutcome::Cancelled),
            Ok(()) => Ok(RemoteOutcome::Completed),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{LinkSource, RefreshError};

    #[test]
    fn provider_check() {
        let rd = LinkSource::RealDebrid { hoster_link: "x".into() };
        assert!(check_provider(&rd, "real-debrid").is_ok());
        assert!(matches!(check_provider(&rd, "torbox"), Err(RefreshError::ProviderMismatch(p)) if p == "Real-Debrid"));
        assert!(matches!(check_provider(&LinkSource::Direct, "torbox"), Err(RefreshError::NotRefreshable)));
        let ad = LinkSource::AllDebrid { hoster_link: "x".into() };
        assert!(check_provider(&ad, "alldebrid").is_ok());
        assert!(matches!(check_provider(&ad, "real-debrid"), Err(RefreshError::ProviderMismatch(p)) if p == "AllDebrid"));
    }
}
