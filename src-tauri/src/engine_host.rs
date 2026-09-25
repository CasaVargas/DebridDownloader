//! Tauri adapters for the engine's seams.
use crate::engine::{
    EngineEvent, EventSink, Job, LinkRefresher, LinkSource, RefreshError, RefreshedLink, RemoteOutcome, RemoteRunner,
};
use crate::state::{AppState, DownloadStatus, DownloadTask};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

pub struct TauriSink {
    app: AppHandle,
}
impl TauriSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriSink {
    fn emit(&self, event: EngineEvent) {
        match event {
            EngineEvent::Progress(view) => {
                let _ = self.app.emit("download-progress", &view);
            }
            EngineEvent::ListChanged => {
                let _ = self.app.emit("downloads-changed", ());
            }
            EngineEvent::BatchFinished { batch_id } => {
                log::info!("Download batch {} finished; triggering media-server scans", batch_id);
                let app = self.app.clone();
                tauri::async_runtime::spawn(async move {
                    let s = app.state::<AppState>().settings.read().await.clone();
                    crate::media_servers::trigger_scans(
                        &app,
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

pub struct ProviderRefresher {
    app: AppHandle,
}
impl ProviderRefresher {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl LinkRefresher for ProviderRefresher {
    async fn refresh(&self, source: &LinkSource) -> Result<RefreshedLink, RefreshError> {
        let state = self.app.state::<AppState>();
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

pub struct TauriRemoteRunner {
    app: AppHandle,
}
impl TauriRemoteRunner {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl RemoteRunner for TauriRemoteRunner {
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
        let result = crate::rclone::download_to_rclone(self.app.clone(), &mut task, &mut wrx, speed_limit).await;
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
    }
}
