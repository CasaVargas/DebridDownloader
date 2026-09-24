//! The single owner of job state. Everything else talks to it through `EngineMsg`.
use super::events::{EngineEvent, EventSink, JobView};
use super::limiter::Limiter;
use super::pipeline::{run_post, PipelineEvent, PostResult};
use super::refresh::LinkRefresher;
use super::remote::{RemoteOutcome, RemoteRunner};
use super::store::{prune_history, recover, Store};
use super::transfer::{build_client, run_transfer, TransferConfig, TransferDeps, TransferError, TransferOutcome, TransferUpdate};
use super::types::*;
use super::{EngineDeps, Timing};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub enum Control {
    Pause(String),
    Resume(String),
    Cancel(String),
    Retry(String),
    Remove(String),
    PauseAll,
    ResumeAll,
    RetryFailed,
    CancelAll,
    ClearInactive,
}

pub enum EngineMsg {
    Enqueue { jobs: Vec<NewJob>, reply: oneshot::Sender<Vec<String>> },
    AddCompleted { job: NewJob, reply: oneshot::Sender<String> },
    List(oneshot::Sender<Vec<JobView>>),
    Control(Control),
    SetConfig(EngineConfig),
    Shutdown(oneshot::Sender<()>),
    ShutdownDeadline,
    Update { id: String, update: TransferUpdate },
    TransferDone { id: String, result: Result<TransferOutcome, TransferError> },
    RemoteDone { id: String, result: Result<RemoteOutcome, String> },
    Pipeline { id: String, event: PipelineEvent },
    PipelineDone { id: String, result: PostResult },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum StopReason {
    Pause,
    Cancel,
    Remove,
    Shutdown,
}

struct Running {
    cancel: CancellationToken,
    stop: Option<StopReason>,
    downloaded: u64,
    speed: f64,
    segments_active: u32,
    last_bytes_at: Instant,
}

struct SaveReq {
    jobs: Vec<Job>,
    ack: Option<oneshot::Sender<()>>,
}

pub struct Actor {
    jobs: Vec<Job>,
    running: HashMap<String, Running>,
    pipelines: HashSet<String>,
    offline: HashSet<String>,
    notified_batches: HashSet<String>,
    last_emit: HashMap<String, Instant>,
    config: EngineConfig,
    transfer_cfg: TransferConfig,
    timing: Timing,
    sink: Arc<dyn EventSink>,
    refresher: Arc<dyn LinkRefresher>,
    remote: Arc<dyn RemoteRunner>,
    client: reqwest::Client,
    limiter: Arc<Limiter>,
    tx: mpsc::UnboundedSender<EngineMsg>,
    saver: mpsc::UnboundedSender<SaveReq>,
    dirty: bool,
    last_save: Instant,
    shutting_down: Option<oneshot::Sender<()>>,
}

impl Actor {
    pub fn spawn(deps: EngineDeps, tx: mpsc::UnboundedSender<EngineMsg>, rx: mpsc::UnboundedReceiver<EngineMsg>) {
        let store = Arc::new(Store::new(&deps.data_dir));
        let jobs = store.load();
        let saver = spawn_saver(store);
        let mut transfer_cfg = deps.transfer;
        transfer_cfg.segments_per_file = deps.config.segments_per_file.clamp(1, 16);
        let actor = Actor {
            jobs,
            running: HashMap::new(),
            pipelines: HashSet::new(),
            offline: HashSet::new(),
            notified_batches: HashSet::new(),
            last_emit: HashMap::new(),
            limiter: Arc::new(Limiter::new(deps.config.speed_limit_bytes)),
            client: build_client(&transfer_cfg),
            config: deps.config,
            transfer_cfg,
            timing: deps.timing,
            sink: deps.sink,
            refresher: deps.refresher,
            remote: deps.remote,
            tx,
            saver,
            dirty: false,
            last_save: Instant::now(),
            shutting_down: None,
        };
        tokio::spawn(actor.run(rx));
    }

    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<EngineMsg>) {
        for id in recover(&mut self.jobs) {
            self.start_pipeline(&id);
        }
        self.dirty = true;
        self.schedule();
        let mut tick = tokio::time::interval(self.timing.tick);
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    let Some(msg) = msg else { break };
                    if self.handle(msg) {
                        break;
                    }
                }
                _ = tick.tick() => {
                    self.schedule();
                    self.save(false, None);
                }
            }
        }
    }

    /// Returns true when the actor should exit.
    fn handle(&mut self, msg: EngineMsg) -> bool {
        match msg {
            EngineMsg::Enqueue { jobs, reply } => {
                let ids = jobs.into_iter().map(|n| self.enqueue(n)).collect();
                let _ = reply.send(ids);
                self.sink.emit(EngineEvent::ListChanged);
                self.save(true, None);
                self.schedule();
            }
            EngineMsg::AddCompleted { job, reply } => {
                let now = now_ms();
                let mut j = Job::from_new(job, uuid::Uuid::new_v4().to_string(), now);
                j.state = JobState::Completed;
                j.post = PostStage::Done;
                let _ = reply.send(j.id.clone());
                self.jobs.push(j);
                self.sink.emit(EngineEvent::ListChanged);
                self.save(true, None);
            }
            EngineMsg::List(reply) => {
                let _ = reply.send(self.jobs.iter().map(|j| self.view(j)).collect());
            }
            EngineMsg::Control(c) => self.control(c),
            EngineMsg::SetConfig(cfg) => {
                let limiter = self.limiter.clone();
                let rate = cfg.speed_limit_bytes;
                tokio::spawn(async move { limiter.set_rate(rate).await });
                self.transfer_cfg.segments_per_file = cfg.segments_per_file.clamp(1, 16);
                self.config = cfg;
                self.schedule();
            }
            EngineMsg::Shutdown(reply) => {
                self.shutting_down = Some(reply);
                for r in self.running.values_mut() {
                    r.stop = Some(StopReason::Shutdown);
                    r.cancel.cancel();
                }
                if self.running.is_empty() {
                    return self.finish_shutdown();
                }
                let tx = self.tx.clone();
                let grace = self.timing.shutdown_grace;
                tokio::spawn(async move {
                    tokio::time::sleep(grace).await;
                    let _ = tx.send(EngineMsg::ShutdownDeadline);
                });
            }
            EngineMsg::ShutdownDeadline => return self.finish_shutdown(),
            EngineMsg::Update { id, update } => self.on_update(&id, update),
            EngineMsg::TransferDone { id, result } => {
                self.on_transfer_done(&id, result);
                if self.shutting_down.is_some() && self.running.is_empty() {
                    return self.finish_shutdown();
                }
            }
            EngineMsg::RemoteDone { id, result } => {
                self.on_remote_done(&id, result);
                if self.shutting_down.is_some() && self.running.is_empty() {
                    return self.finish_shutdown();
                }
            }
            EngineMsg::Pipeline { id, event } => {
                if let Some(job) = self.job_mut(&id) {
                    match event {
                        PipelineEvent::Extracting => job.state = JobState::Extracting,
                        PipelineEvent::Stage(s) => job.post = s,
                    }
                    job.updated_at = now_ms();
                    self.dirty = true;
                    self.emit(&id, true);
                }
            }
            EngineMsg::PipelineDone { id, result } => {
                self.pipelines.remove(&id);
                if let Some(job) = self.job_mut(&id) {
                    job.destination = result.destination;
                    job.post = PostStage::Done;
                    match result.error {
                        Some(e) => {
                            job.state = JobState::Failed(e.clone());
                            job.error = Some(e);
                        }
                        None => job.state = JobState::Completed,
                    }
                    job.updated_at = now_ms();
                    let batch = job.batch_id.clone();
                    self.emit(&id, true);
                    self.check_batch(&batch);
                    self.save(true, None);
                }
            }
        }
        false
    }

    fn finish_shutdown(&mut self) -> bool {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.save(true, Some(ack_tx));
        if let Some(reply) = self.shutting_down.take() {
            tokio::spawn(async move {
                let _ = ack_rx.await;
                let _ = reply.send(());
            });
        }
        true
    }

    fn job_mut(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    fn enqueue(&mut self, n: NewJob) -> String {
        if let Some(existing) = self.jobs.iter().find(|j| j.destination == n.destination && !j.state.is_terminal()) {
            return existing.id.clone();
        }
        let job = Job::from_new(n, uuid::Uuid::new_v4().to_string(), now_ms());
        let id = job.id.clone();
        self.jobs.push(job);
        id
    }

    fn view(&self, j: &Job) -> JobView {
        let r = self.running.get(&j.id);
        let downloaded = match (&j.state, r) {
            (_, Some(r)) => r.downloaded,
            (JobState::Completed | JobState::Extracting, None) => j.total_bytes.max(0) as u64,
            _ => j.downloaded(),
        };
        JobView {
            id: j.id.clone(),
            filename: j.filename.clone(),
            url: j.url.clone(),
            destination: j.destination.clone(),
            total_bytes: j.total_bytes,
            downloaded_bytes: downloaded as i64,
            speed: r.map(|r| r.speed).unwrap_or(0.0),
            status: j.state.clone(),
            remote: match &j.kind {
                JobKind::Remote { rclone_dest } => Some(rclone_dest.clone()),
                JobKind::Symlink => Some("symlink".into()),
                JobKind::Http => None,
            },
            attempt: j.attempt,
            retry_at: j.retry_at,
            segments_active: r.map(|r| r.segments_active).unwrap_or(0),
            resumable: j.resumable,
            error: j.error.clone(),
            waiting_for_network: self.offline.contains(&j.id),
        }
    }

    fn emit(&mut self, id: &str, force: bool) {
        let now = Instant::now();
        if !force {
            if let Some(t) = self.last_emit.get(id) {
                if now.duration_since(*t) < self.timing.emit_interval {
                    return;
                }
            }
        }
        if let Some(job) = self.jobs.iter().find(|j| j.id == id) {
            let v = self.view(job);
            self.last_emit.insert(id.to_string(), now);
            self.sink.emit(EngineEvent::Progress(v));
        }
    }

    fn save(&mut self, force: bool, ack: Option<oneshot::Sender<()>>) {
        if ack.is_none() && (!self.dirty || (!force && self.last_save.elapsed() < self.timing.save_interval)) {
            return;
        }
        prune_history(&mut self.jobs);
        let _ = self.saver.send(SaveReq { jobs: self.jobs.clone(), ack });
        self.dirty = false;
        self.last_save = Instant::now();
    }

    fn schedule(&mut self) {
        if self.shutting_down.is_some() {
            return;
        }
        let max = self.config.max_concurrent.max(1) as usize;
        let now = now_ms();
        while self.running.len() < max {
            let Some(idx) = self.jobs.iter().position(|j| {
                j.state == JobState::Pending && !self.running.contains_key(&j.id) && j.retry_at.is_none_or(|t| t <= now)
            }) else {
                break;
            };
            self.start_job(idx);
        }
    }

    fn start_job(&mut self, idx: usize) {
        let job = &mut self.jobs[idx];
        job.state = JobState::Downloading;
        job.retry_at = None;
        job.updated_at = now_ms();
        let id = job.id.clone();
        let emit_id = id.clone();
        let snapshot = job.clone();
        let kind = snapshot.kind.clone();
        let cancel = CancellationToken::new();
        self.running.insert(
            id.clone(),
            Running {
                cancel: cancel.clone(),
                stop: None,
                downloaded: snapshot.downloaded(),
                speed: 0.0,
                segments_active: 0,
                last_bytes_at: Instant::now(),
            },
        );
        let tx = self.tx.clone();
        match kind {
            JobKind::Http => {
                let deps = TransferDeps {
                    client: self.client.clone(),
                    limiter: self.limiter.clone(),
                    refresher: self.refresher.clone(),
                    cfg: self.transfer_cfg.clone(),
                };
                tokio::spawn(async move {
                    let (utx, mut urx) = mpsc::unbounded_channel();
                    let fut = run_transfer(snapshot, deps, cancel, utx);
                    tokio::pin!(fut);
                    let result = loop {
                        tokio::select! {
                            biased;
                            Some(update) = urx.recv() => { let _ = tx.send(EngineMsg::Update { id: id.clone(), update }); }
                            r = &mut fut => break r,
                        }
                    };
                    while let Ok(update) = urx.try_recv() {
                        let _ = tx.send(EngineMsg::Update { id: id.clone(), update });
                    }
                    let _ = tx.send(EngineMsg::TransferDone { id, result });
                });
            }
            JobKind::Remote { .. } => {
                let remote = self.remote.clone();
                let limit = self.config.speed_limit_bytes;
                tokio::spawn(async move {
                    let result = remote.run(snapshot, cancel, limit).await;
                    let _ = tx.send(EngineMsg::RemoteDone { id, result });
                });
            }
            JobKind::Symlink => {
                self.running.remove(&id);
                self.jobs[idx].state = JobState::Completed;
            }
        }
        self.dirty = true;
        self.emit(&emit_id, true);
    }

    fn on_update(&mut self, id: &str, update: TransferUpdate) {
        let mut force = false;
        match update {
            TransferUpdate::Progress { downloaded, speed, segments_active } => {
                if let Some(r) = self.running.get_mut(id) {
                    if downloaded > r.downloaded {
                        r.last_bytes_at = Instant::now();
                        self.offline.remove(id);
                    }
                    r.downloaded = downloaded;
                    r.speed = speed;
                    r.segments_active = segments_active;
                }
            }
            TransferUpdate::Checkpoint { segments } => {
                if let Some(j) = self.job_mut(id) {
                    j.segments = segments;
                }
                self.dirty = true;
            }
            TransferUpdate::Probed { total_bytes, resumable, segments, size_resets } => {
                if let Some(j) = self.job_mut(id) {
                    j.total_bytes = total_bytes;
                    j.resumable = resumable;
                    j.segments = segments;
                    j.size_resets = size_resets;
                }
                self.dirty = true;
                force = true;
            }
            TransferUpdate::Url(u) => {
                if let Some(j) = self.job_mut(id) {
                    j.url = u;
                }
                self.dirty = true;
            }
            TransferUpdate::MaxSegments(n) => {
                if let Some(j) = self.job_mut(id) {
                    j.max_segments = n;
                }
                self.dirty = true;
            }
        }
        self.emit(id, force);
    }

    fn delete_part(job: &Job) {
        let part = job.part_path();
        tokio::spawn(async move {
            let _ = tokio::fs::remove_file(part).await;
        });
    }

    fn backoff(&mut self, idx: usize, msg: String) {
        let t = self.timing.clone();
        let job = &mut self.jobs[idx];
        job.attempt += 1;
        log::warn!("Download {} failed (attempt {}/{}): {}", job.id, job.attempt, t.max_attempts, msg);
        if job.attempt >= t.max_attempts {
            job.state = JobState::Failed(msg.clone());
            job.error = Some(msg);
            return;
        }
        let delay = t.backoff_base.saturating_mul(3u32.saturating_pow(job.attempt - 1)).min(t.backoff_cap);
        job.state = JobState::Pending;
        job.retry_at = Some(now_ms() + delay.as_millis() as i64);
        job.error = Some(msg);
    }

    fn on_transfer_done(&mut self, id: &str, result: Result<TransferOutcome, TransferError>) {
        let stop = self.running.remove(id).and_then(|r| r.stop);
        let Some(idx) = self.jobs.iter().position(|j| j.id == id) else {
            self.schedule();
            return;
        };
        match (stop, result) {
            (Some(StopReason::Shutdown), _) => {} // stays Downloading → resumes next launch
            (Some(StopReason::Pause), _) => self.jobs[idx].state = JobState::Paused,
            (Some(StopReason::Cancel), _) => {
                Self::delete_part(&self.jobs[idx]);
                self.jobs[idx].segments.clear();
                self.jobs[idx].state = JobState::Cancelled;
            }
            (Some(StopReason::Remove), _) => {
                Self::delete_part(&self.jobs[idx]);
                self.jobs.remove(idx);
                self.offline.remove(id);
                self.sink.emit(EngineEvent::ListChanged);
                self.dirty = true;
                self.save(true, None);
                self.schedule();
                return;
            }
            (None, Ok(TransferOutcome::Finished)) => {
                self.offline.remove(id);
                let job = &mut self.jobs[idx];
                job.state = JobState::Completed;
                job.attempt = 0;
                job.error = None;
                job.post = PostStage::Extract;
                self.start_pipeline(id);
            }
            (None, Ok(TransferOutcome::Stopped)) => self.jobs[idx].state = JobState::Paused,
            (None, Err(TransferError::Fatal(m))) => {
                log::warn!("Download {} failed permanently: {}", id, m);
                self.jobs[idx].state = JobState::Failed(m.clone());
                self.jobs[idx].error = Some(m);
            }
            (None, Err(TransferError::Transient(m))) => self.backoff(idx, m),
            (None, Err(TransferError::Offline(m))) => {
                let idle = self.transfer_cfg.idle_timeout;
                let nobody_else_moving = self.running.values().all(|r| r.last_bytes_at.elapsed() > idle);
                if nobody_else_moving {
                    log::info!("Download {} waiting for network: {}", id, m);
                    self.offline.insert(id.to_string());
                    let job = &mut self.jobs[idx];
                    job.state = JobState::Pending;
                    job.retry_at = Some(now_ms() + self.timing.offline_retry.as_millis() as i64);
                    job.error = Some("Waiting for network".into());
                } else {
                    self.backoff(idx, m);
                }
            }
        }
        self.jobs[idx].updated_at = now_ms();
        let batch = self.jobs[idx].batch_id.clone();
        self.dirty = true;
        self.emit(id, true);
        self.check_batch(&batch);
        self.save(true, None);
        self.schedule();
    }

    fn on_remote_done(&mut self, id: &str, result: Result<RemoteOutcome, String>) {
        let stop = self.running.remove(id).and_then(|r| r.stop);
        let Some(idx) = self.jobs.iter().position(|j| j.id == id) else { return };
        match (stop, result) {
            (Some(StopReason::Shutdown), _) => {}
            (Some(StopReason::Remove), _) => {
                self.jobs.remove(idx);
                self.sink.emit(EngineEvent::ListChanged);
                self.save(true, None);
                self.schedule();
                return;
            }
            (Some(StopReason::Pause), _) => self.jobs[idx].state = JobState::Paused,
            (_, Ok(RemoteOutcome::Cancelled)) | (Some(StopReason::Cancel), _) => self.jobs[idx].state = JobState::Cancelled,
            (None, Ok(RemoteOutcome::Completed)) => {
                self.jobs[idx].state = JobState::Completed;
                self.jobs[idx].post = PostStage::Done;
            }
            (None, Err(m)) => {
                self.jobs[idx].state = JobState::Failed(m.clone());
                self.jobs[idx].error = Some(m);
            }
        }
        self.jobs[idx].updated_at = now_ms();
        let batch = self.jobs[idx].batch_id.clone();
        self.dirty = true;
        self.emit(id, true);
        self.check_batch(&batch);
        self.save(true, None);
        self.schedule();
    }

    fn start_pipeline(&mut self, id: &str) {
        let Some(job) = self.jobs.iter().find(|j| j.id == id).cloned() else { return };
        self.pipelines.insert(id.to_string());
        let cfg = self.config.post.clone();
        let tx = self.tx.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            let (etx, mut erx) = mpsc::unbounded_channel();
            let fut = run_post(&job, &cfg, &etx);
            tokio::pin!(fut);
            let result = loop {
                tokio::select! {
                    biased;
                    Some(event) = erx.recv() => { let _ = tx.send(EngineMsg::Pipeline { id: id.clone(), event }); }
                    r = &mut fut => break r,
                }
            };
            while let Ok(event) = erx.try_recv() {
                let _ = tx.send(EngineMsg::Pipeline { id: id.clone(), event });
            }
            let _ = tx.send(EngineMsg::PipelineDone { id, result });
        });
    }

    fn check_batch(&mut self, batch: &str) {
        if batch.is_empty() || self.notified_batches.contains(batch) {
            return;
        }
        let in_batch: Vec<&Job> = self.jobs.iter().filter(|j| j.batch_id == batch).collect();
        let settled = in_batch.iter().all(|j| {
            j.state.is_terminal() && !self.pipelines.contains(&j.id) && (j.state != JobState::Completed || j.post == PostStage::Done)
        });
        if !settled {
            return;
        }
        self.notified_batches.insert(batch.to_string());
        if in_batch.iter().any(|j| j.state == JobState::Completed) {
            self.sink.emit(EngineEvent::BatchFinished { batch_id: batch.to_string() });
        }
    }

    fn control(&mut self, c: Control) {
        match c {
            Control::Pause(id) => self.pause(&id),
            Control::Resume(id) => self.resume(&id),
            Control::Cancel(id) => self.cancel(&id),
            Control::Retry(id) => self.retry(&id),
            Control::Remove(id) => self.remove(&id),
            Control::PauseAll => {
                for id in self.ids_where(|j| matches!(j.state, JobState::Pending | JobState::Downloading)) {
                    self.pause(&id);
                }
            }
            Control::ResumeAll => {
                for id in self.ids_where(|j| j.state == JobState::Paused) {
                    self.resume(&id);
                }
            }
            Control::RetryFailed => {
                for id in self.ids_where(|j| matches!(j.state, JobState::Failed(_))) {
                    self.retry(&id);
                }
            }
            Control::CancelAll => {
                for id in self.ids_where(|j| matches!(j.state, JobState::Pending | JobState::Downloading | JobState::Paused)) {
                    self.cancel(&id);
                }
            }
            Control::ClearInactive => {
                for j in self.jobs.iter().filter(|j| matches!(j.state, JobState::Failed(_))) {
                    Self::delete_part(j);
                }
                self.jobs.retain(|j| {
                    matches!(j.state, JobState::Pending | JobState::Downloading | JobState::Paused | JobState::Extracting)
                });
                self.sink.emit(EngineEvent::ListChanged);
            }
        }
        self.dirty = true;
        self.save(true, None);
        self.schedule();
    }

    fn ids_where(&self, f: impl Fn(&Job) -> bool) -> Vec<String> {
        self.jobs.iter().filter(|j| f(j)).map(|j| j.id.clone()).collect()
    }

    fn stop_running(&mut self, id: &str, reason: StopReason) -> bool {
        if let Some(r) = self.running.get_mut(id) {
            r.stop = Some(reason);
            r.cancel.cancel();
            return true;
        }
        false
    }

    fn pause(&mut self, id: &str) {
        if self.stop_running(id, StopReason::Pause) {
            return;
        }
        if let Some(j) = self.job_mut(id) {
            if j.state == JobState::Pending {
                j.state = JobState::Paused;
                j.retry_at = None;
            }
        }
        self.offline.remove(id);
        self.emit(id, true);
    }

    fn resume(&mut self, id: &str) {
        if let Some(j) = self.job_mut(id) {
            if j.state == JobState::Paused {
                j.state = JobState::Pending;
                j.retry_at = None;
            }
        }
        self.emit(id, true);
    }

    fn cancel(&mut self, id: &str) {
        if self.stop_running(id, StopReason::Cancel) {
            return;
        }
        if let Some(j) = self.job_mut(id) {
            if matches!(j.state, JobState::Pending | JobState::Paused) {
                j.state = JobState::Cancelled;
                j.segments.clear();
                let snapshot = j.clone();
                Self::delete_part(&snapshot);
            }
        }
        self.offline.remove(id);
        self.emit(id, true);
    }

    fn retry(&mut self, id: &str) {
        if let Some(j) = self.job_mut(id) {
            if matches!(j.state, JobState::Failed(_) | JobState::Cancelled) || (j.state == JobState::Pending && j.retry_at.is_some()) {
                j.state = JobState::Pending;
                j.attempt = 0;
                j.error = None;
                j.retry_at = None;
                j.size_resets = 0;
            }
        }
        self.emit(id, true);
    }

    fn remove(&mut self, id: &str) {
        if self.stop_running(id, StopReason::Remove) {
            return;
        }
        if let Some(idx) = self.jobs.iter().position(|j| j.id == id) {
            let job = self.jobs.remove(idx);
            if job.state != JobState::Completed {
                Self::delete_part(&job); // never touch the finished file
            }
            self.offline.remove(id);
            self.sink.emit(EngineEvent::ListChanged);
        }
    }
}

/// Serializes saves so an older snapshot can never overwrite a newer one.
fn spawn_saver(store: Arc<Store>) -> mpsc::UnboundedSender<SaveReq> {
    let (tx, mut rx) = mpsc::unbounded_channel::<SaveReq>();
    tokio::spawn(async move {
        while let Some(mut req) = rx.recv().await {
            let mut acks = Vec::new();
            if let Some(a) = req.ack.take() {
                acks.push(a);
            }
            while let Ok(mut newer) = rx.try_recv() {
                if let Some(a) = newer.ack.take() {
                    acks.push(a);
                }
                req = newer;
            }
            let store = store.clone();
            let jobs = req.jobs;
            let res = tokio::task::spawn_blocking(move || store.save(&jobs)).await;
            if let Ok(Err(e)) = res {
                log::warn!("Failed to save downloads.json: {}", e);
            }
            for a in acks {
                let _ = a.send(());
            }
        }
    });
    tx
}
