use super::limiter::Limiter;
use super::refresh::{LinkRefresher, RefreshError};
use super::segment::{
    classify_reqwest, content_range_total, is_html, run_segment, status_error, SegmentCtx, SegmentError, SegmentMsg,
};
use super::types::{Job, SegmentState};
use reqwest::header::RANGE;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct TransferConfig {
    pub segments_per_file: u32,
    pub min_segment: u64,
    pub split_threshold: u64,
    pub connect_timeout: Duration,
    pub idle_timeout: Duration,
    pub segment_retries: u32,
    pub retry_base: Duration,
    pub checkpoint_bytes: u64,
    pub checkpoint_interval: Duration,
    pub progress_interval: Duration,
}

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            segments_per_file: 4,
            min_segment: 8 * 1024 * 1024,
            split_threshold: 16 * 1024 * 1024,
            connect_timeout: Duration::from_secs(15),
            idle_timeout: Duration::from_secs(30),
            segment_retries: 5,
            retry_base: Duration::from_secs(1),
            checkpoint_bytes: 8 * 1024 * 1024,
            checkpoint_interval: Duration::from_secs(2),
            progress_interval: Duration::from_millis(250),
        }
    }
}

#[derive(Clone)]
pub struct TransferDeps {
    pub client: reqwest::Client,
    pub limiter: Arc<Limiter>,
    pub refresher: Arc<dyn LinkRefresher>,
    pub cfg: TransferConfig,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransferUpdate {
    Progress { downloaded: u64, speed: f64, segments_active: u32 },
    Checkpoint { segments: Vec<SegmentState> },
    Probed { total_bytes: i64, resumable: bool, segments: Vec<SegmentState>, size_resets: u32 },
    Url(String),
    MaxSegments(u32),
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransferOutcome {
    Finished,
    Stopped,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TransferError {
    Transient(String),
    Offline(String),
    Fatal(String),
}

pub type UpdateTx = mpsc::UnboundedSender<TransferUpdate>;

pub fn build_client(cfg: &TransferConfig) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(cfg.connect_timeout)
        .build()
        .expect("reqwest client")
}

pub fn plan_segments(total: u64, max: u32, min_segment: u64) -> Vec<SegmentState> {
    if total == 0 {
        return Vec::new();
    }
    let by_size = total.div_ceil(min_segment.max(1));
    let n = (max.max(1) as u64).min(by_size).max(1);
    let base = total / n;
    let mut out = Vec::with_capacity(n as usize);
    let mut start = 0;
    for i in 0..n {
        let end = if i == n - 1 { total - 1 } else { start + base - 1 };
        out.push(SegmentState { start, end, done: 0 });
        start = end + 1;
    }
    out
}

pub struct Probe {
    pub total: Option<u64>,
    pub ranges: bool,
}

pub async fn probe(client: &reqwest::Client, url: &str, timeout: std::time::Duration) -> Result<Probe, SegmentError> {
    let resp = tokio::time::timeout(timeout, client.get(url).header(RANGE, "bytes=0-0").send())
        .await
        .map_err(|_| SegmentError::Transient("probe timed out".into()))?
        .map_err(classify_reqwest)?;
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    if let Some(e) = status_error(status, &headers) {
        return Err(e);
    }
    if is_html(&headers) {
        return Err(SegmentError::DeadLink("server returned a web page instead of the file".into()));
    }
    match status {
        206 => {
            let total = content_range_total(&headers);
            Ok(Probe { total, ranges: total.is_some() })
        }
        416 => Ok(Probe { total: Some(content_range_total(&headers).unwrap_or(0)), ranges: true }),
        200 => Ok(Probe { total: resp.content_length(), ranges: false }),
        other => Err(SegmentError::Transient(format!("unexpected HTTP {other}"))),
    }
}

fn map_probe_err(e: SegmentError) -> TransferError {
    match e {
        SegmentError::Connect(m) => TransferError::Offline(m),
        SegmentError::Disk(m) => TransferError::Fatal(format!("Disk error: {m}")),
        SegmentError::ConnLimit { .. } => TransferError::Transient("server is rate limiting".into()),
        SegmentError::Transient(m) => TransferError::Transient(m),
        other => TransferError::Transient(format!("{other:?}")),
    }
}

async fn part_len(path: &Path) -> Option<u64> {
    tokio::fs::metadata(path).await.ok().map(|m| m.len())
}

fn human(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB { format!("{:.1} GB", b / GB) } else { format!("{:.0} MB", b / MB) }
}

fn ensure_space(dest: &str, needed: u64) -> Result<(), TransferError> {
    let mut dir = Path::new(dest).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    while !dir.exists() {
        match dir.parent() {
            Some(p) => dir = p.to_path_buf(),
            None => return Ok(()),
        }
    }
    match fs4::available_space(&dir) {
        Ok(free) if free < needed => Err(TransferError::Fatal(format!(
            "Not enough disk space: needs {}, {} free",
            human(needed),
            human(free)
        ))),
        _ => Ok(()),
    }
}

async fn prepare_part(part: &Path, total: Option<u64>) -> Result<(), TransferError> {
    let fatal = |e: std::io::Error| TransferError::Fatal(format!("Disk error: {e}"));
    if let Some(parent) = part.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(fatal)?;
    }
    let f = tokio::fs::File::create(part).await.map_err(fatal)?;
    if let Some(t) = total {
        f.set_len(t).await.map_err(fatal)?;
    }
    Ok(())
}

async fn finalize(job: &Job) -> Result<(), TransferError> {
    let fatal = |e: std::io::Error| TransferError::Fatal(format!("Disk error: {e}"));
    let part = job.part_path();
    let dest = PathBuf::from(&job.destination);
    let f = tokio::fs::OpenOptions::new().write(true).open(&part).await.map_err(fatal)?;
    let len = f.metadata().await.map_err(fatal)?.len();
    if len != job.total_bytes.max(0) as u64 {
        return Err(TransferError::Transient(format!("size mismatch: {} of {} bytes", len, job.total_bytes)));
    }
    f.sync_all().await.map_err(fatal)?;
    drop(f);
    #[cfg(windows)]
    if dest.exists() {
        let _ = tokio::fs::remove_file(&dest).await;
    }
    tokio::fs::rename(&part, &dest).await.map_err(fatal)
}

async fn refresh_or_fail(job: &mut Job, deps: &TransferDeps, tx: &UpdateTx, refreshed: &mut bool, why: &str) -> Result<(), TransferError> {
    if *refreshed {
        return Err(TransferError::Fatal(format!("Link expired and couldn't be refreshed: {why}")));
    }
    *refreshed = true;
    match deps.refresher.refresh(&job.source).await {
        Ok(l) => {
            log::info!("Refreshed link for {} ({})", job.filename, job.id);
            job.url = l.url.clone();
            let _ = tx.send(TransferUpdate::Url(l.url));
            Ok(())
        }
        Err(RefreshError::ProviderMismatch(p)) => Err(TransferError::Fatal(format!("Switch back to {p} to resume"))),
        Err(e) => Err(TransferError::Fatal(format!("Link expired and couldn't be refreshed: {e}"))),
    }
}

pub async fn run_transfer(mut job: Job, deps: TransferDeps, cancel: CancellationToken, tx: UpdateTx) -> Result<TransferOutcome, TransferError> {
    let part = job.part_path();
    let mut refreshed = false;
    let mut range_fallback = false;
    loop {
        // Crash between the last write and the rename: just finalize.
        if !job.segments.is_empty()
            && job.segments.iter().all(|s| s.is_done())
            && part_len(&part).await == Some(job.total_bytes.max(0) as u64)
        {
            finalize(&job).await?;
            return Ok(TransferOutcome::Finished);
        }

        let p = match probe(&deps.client, &job.url, deps.cfg.idle_timeout).await {
            Ok(p) => p,
            Err(SegmentError::DeadLink(why)) => {
                refresh_or_fail(&mut job, &deps, &tx, &mut refreshed, &why).await?;
                continue;
            }
            Err(e) => {
                log::warn!("Probe failed for {} ({}): {:?}", job.filename, job.id, e);
                return Err(map_probe_err(e));
            }
        };
        if cancel.is_cancelled() {
            return Ok(TransferOutcome::Stopped);
        }

        let ranges = p.ranges && job.resumable;
        if let Some(t) = p.total {
            if !job.segments.is_empty() && job.total_bytes != t as i64 {
                if job.size_resets >= 1 {
                    return Err(TransferError::Fatal("The file changed on the server while downloading".into()));
                }
                log::warn!("{} changed size upstream ({} → {}), restarting", job.filename, job.total_bytes, t);
                job.size_resets += 1;
                job.segments.clear();
            }
            job.total_bytes = t as i64;
        }
        if !job.segments.is_empty() && part_len(&part).await != Some(job.total_bytes.max(0) as u64) {
            job.segments.clear(); // .part missing or truncated → start over
        }
        if !ranges {
            job.resumable = false;
            job.segments.clear(); // no Range support → always from 0
        }

        if job.segments.is_empty() {
            if p.total == Some(0) {
                prepare_part(&part, Some(0)).await?;
                job.total_bytes = 0;
                finalize(&job).await?;
                return Ok(TransferOutcome::Finished);
            }
            job.segments = match p.total {
                Some(t) if ranges => plan_segments(t, job.max_segments.min(deps.cfg.segments_per_file), deps.cfg.min_segment),
                Some(t) => vec![SegmentState { start: 0, end: t - 1, done: 0 }],
                None => vec![SegmentState { start: 0, end: u64::MAX - 1, done: 0 }],
            };
            if let Some(t) = p.total {
                ensure_space(&job.destination, t)?;
            }
            prepare_part(&part, p.total).await?;
        }
        let _ = tx.send(TransferUpdate::Probed {
            total_bytes: job.total_bytes,
            resumable: job.resumable,
            segments: job.segments.clone(),
            size_resets: job.size_resets,
        });

        match run_segments(&mut job, &deps, &cancel, &tx, ranges, p.total.is_none()).await {
            Ok(()) => {
                if p.total.is_none() {
                    job.total_bytes = job.downloaded() as i64;
                }
                finalize(&job).await?;
                return Ok(TransferOutcome::Finished);
            }
            Err(RunError::Stopped) => return Ok(TransferOutcome::Stopped),
            Err(RunError::DeadLink(why)) => {
                refresh_or_fail(&mut job, &deps, &tx, &mut refreshed, &why).await?;
            }
            Err(RunError::RangeIgnored) => {
                if range_fallback {
                    return Err(TransferError::Fatal("Server returned inconsistent byte ranges".into()));
                }
                log::warn!("{} ignored Range mid-download; falling back to a single stream", job.filename);
                range_fallback = true;
                job.resumable = false;
                job.segments.clear();
            }
            Err(RunError::Transient(m)) => return Err(TransferError::Transient(m)),
            Err(RunError::Offline(m)) => return Err(TransferError::Offline(m)),
            Err(RunError::Disk(m)) => return Err(TransferError::Fatal(format!("Disk error: {m}"))),
        }
    }
}

enum RunError {
    Stopped,
    DeadLink(String),
    RangeIgnored,
    Transient(String),
    Offline(String),
    Disk(String),
}

pub struct SpeedMeter {
    window: std::time::Duration,
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedMeter {
    pub fn new(window: std::time::Duration) -> Self {
        Self { window, samples: VecDeque::new() }
    }
    pub fn add(&mut self, n: u64) {
        self.samples.push_back((Instant::now(), n));
        self.trim();
    }
    fn trim(&mut self) {
        let Some(cutoff) = Instant::now().checked_sub(self.window) else { return };
        while matches!(self.samples.front(), Some((t, _)) if *t < cutoff) {
            self.samples.pop_front();
        }
    }
    pub fn rate(&mut self) -> f64 {
        self.trim();
        self.samples.iter().map(|(_, n)| *n).sum::<u64>() as f64 / self.window.as_secs_f64()
    }
}

type Workers = JoinSet<(usize, Result<u64, SegmentError>)>;

fn spawn_worker(
    set: &mut Workers,
    ctx: Arc<SegmentCtx>,
    i: usize,
    seg: SegmentState,
    end: Arc<AtomicU64>,
    tx: mpsc::UnboundedSender<SegmentMsg>,
    delay: Option<std::time::Duration>,
) {
    set.spawn(async move {
        if let Some(d) = delay {
            tokio::select! {
                _ = ctx.cancel.cancelled() => return (i, Err(SegmentError::Cancelled)),
                _ = tokio::time::sleep(d) => {}
            }
        }
        (i, run_segment(&ctx, i, seg.start, seg.done, end, &tx).await)
    });
}

/// Stop every worker, fold in their final durable progress.
async fn stop_workers(
    run_cancel: &CancellationToken,
    set: &mut Workers,
    seg_rx: &mut mpsc::UnboundedReceiver<SegmentMsg>,
    job: &mut Job,
    ends: &[Arc<AtomicU64>],
    tx: &UpdateTx,
) {
    run_cancel.cancel();
    while let Some(res) = set.join_next().await {
        if let Ok((i, Ok(done))) = res {
            job.segments[i].done = job.segments[i].done.max(done);
        }
    }
    while let Ok(msg) = seg_rx.try_recv() {
        if let SegmentMsg::Checkpoint { index, done } = msg {
            job.segments[index].done = job.segments[index].done.max(done);
        }
    }
    for (i, e) in ends.iter().enumerate() {
        job.segments[i].end = e.load(Ordering::SeqCst);
    }
    let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
}

async fn run_segments(
    job: &mut Job,
    deps: &TransferDeps,
    cancel: &CancellationToken,
    tx: &UpdateTx,
    use_range: bool,
    until_eof: bool,
) -> Result<(), RunError> {
    let cfg = &deps.cfg;
    let run_cancel = cancel.child_token();
    let ctx = Arc::new(SegmentCtx {
        client: deps.client.clone(),
        url: job.url.clone(),
        path: job.part_path(),
        limiter: deps.limiter.clone(),
        cancel: run_cancel.clone(),
        use_range,
        until_eof,
        idle_timeout: cfg.idle_timeout,
        checkpoint_bytes: cfg.checkpoint_bytes,
        checkpoint_interval: cfg.checkpoint_interval,
    });
    let (seg_tx, mut seg_rx) = mpsc::unbounded_channel::<SegmentMsg>();
    let mut ends: Vec<Arc<AtomicU64>> = job.segments.iter().map(|s| Arc::new(AtomicU64::new(s.end))).collect();
    let mut live: Vec<u64> = job.segments.iter().map(|s| s.done).collect();
    let mut pending: VecDeque<usize> = (0..job.segments.len()).filter(|&i| !job.segments[i].is_done()).collect();
    let mut delays: HashMap<usize, std::time::Duration> = HashMap::new();
    let mut retries: HashMap<usize, u32> = HashMap::new();
    let mut active: Vec<usize> = Vec::new();
    let mut cap = if use_range { job.max_segments.min(cfg.segments_per_file).max(1) as usize } else { 1 };
    let mut set: Workers = JoinSet::new();
    let mut speed = SpeedMeter::new(std::time::Duration::from_secs(3));
    let mut tick = tokio::time::interval(cfg.progress_interval);
    let mut not_before: Option<Instant> = None;

    loop {
        if not_before.is_some_and(|t| Instant::now() >= t) {
            not_before = None;
        }
        while active.len() < cap && not_before.is_none() {
            let Some(i) = pending.pop_front() else { break };
            if !use_range {
                job.segments[i].done = 0; // can't resume without Range
            }
            live[i] = job.segments[i].done;
            spawn_worker(&mut set, ctx.clone(), i, job.segments[i], ends[i].clone(), seg_tx.clone(), delays.remove(&i));
            active.push(i);
        }
        if active.is_empty() && pending.is_empty() {
            let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
            return Ok(());
        }

        let wake = not_before.unwrap_or_else(|| Instant::now() + std::time::Duration::from_secs(3600));
        tokio::select! {
            _ = cancel.cancelled() => {
                stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                return Err(RunError::Stopped);
            }
            Some(msg) = seg_rx.recv() => match msg {
                SegmentMsg::Bytes { index, n } => {
                    live[index] += n;
                    speed.add(n);
                }
                SegmentMsg::Checkpoint { index, done } => {
                    job.segments[index].done = job.segments[index].done.max(done);
                    job.segments[index].end = ends[index].load(Ordering::SeqCst);
                    let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
                }
            },
            Some(res) = set.join_next(), if !set.is_empty() => {
                let (i, r) = res.expect("segment task panicked");
                active.retain(|&a| a != i);
                match r {
                    Ok(done) => {
                        job.segments[i].done = done;
                        job.segments[i].end = ends[i].load(Ordering::SeqCst);
                        live[i] = done;
                        if use_range && pending.is_empty() {
                            try_split(job, &mut ends, &mut live, &mut pending, &active, cfg.split_threshold, tx);
                        }
                    }
                    Err(SegmentError::Cancelled) => {}
                    Err(e @ (SegmentError::Transient(_) | SegmentError::Connect(_))) => {
                        let n = retries.entry(i).or_insert(0);
                        *n += 1;
                        log::warn!("Segment {} of {} failed (attempt {}): {:?}", i, job.id, n, e);
                        if *n > cfg.segment_retries {
                            stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                            return Err(match e {
                                SegmentError::Connect(m) => RunError::Offline(m),
                                SegmentError::Transient(m) => RunError::Transient(m),
                                _ => unreachable!(),
                            });
                        }
                        delays.insert(i, cfg.retry_base * 2u32.pow(*n - 1));
                        pending.push_front(i);
                    }
                    Err(SegmentError::ConnLimit { retry_after }) => {
                        if cap > 1 {
                            cap = (cap / 2).max(1);
                            job.max_segments = cap as u32;
                            let _ = tx.send(TransferUpdate::MaxSegments(cap as u32));
                            log::warn!("{} is limiting connections; using {} segments", job.id, cap);
                        } else {
                            let n = retries.entry(i).or_insert(0);
                            *n += 1;
                            if *n > cfg.segment_retries {
                                stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                                return Err(RunError::Transient("server is rate limiting".into()));
                            }
                        }
                        not_before = Some(Instant::now() + retry_after.unwrap_or(std::time::Duration::from_secs(1)));
                        pending.push_front(i);
                    }
                    Err(SegmentError::DeadLink(w)) => {
                        stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                        return Err(RunError::DeadLink(w));
                    }
                    Err(SegmentError::RangeIgnored) => {
                        stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                        return Err(RunError::RangeIgnored);
                    }
                    Err(SegmentError::Disk(m)) => {
                        stop_workers(&run_cancel, &mut set, &mut seg_rx, job, &ends, tx).await;
                        return Err(RunError::Disk(m));
                    }
                }
            }
            _ = tick.tick() => {
                let _ = tx.send(TransferUpdate::Progress {
                    downloaded: live.iter().sum(),
                    speed: speed.rate(),
                    segments_active: active.len() as u32,
                });
            }
            _ = tokio::time::sleep_until(wake), if not_before.is_some() => {}
        }
    }
}

/// Split the active segment with the most bytes left, so no connection idles at the tail.
fn try_split(
    job: &mut Job,
    ends: &mut Vec<Arc<AtomicU64>>,
    live: &mut Vec<u64>,
    pending: &mut VecDeque<usize>,
    active: &[usize],
    threshold: u64,
    tx: &UpdateTx,
) {
    let best = active
        .iter()
        .map(|&j| {
            let pos = job.segments[j].start + live[j];
            let end = ends[j].load(Ordering::SeqCst);
            (j, pos, end, (end + 1).saturating_sub(pos))
        })
        .filter(|&(_, _, _, rem)| rem > threshold)
        .max_by_key(|&(_, _, _, rem)| rem);
    let Some((j, pos, end, rem)) = best else { return };
    let mid = pos + rem / 2;
    ends[j].store(mid - 1, Ordering::SeqCst);
    job.segments[j].end = mid - 1;
    job.segments.push(SegmentState { start: mid, end, done: 0 });
    ends.push(Arc::new(AtomicU64::new(end)));
    live.push(0);
    pending.push_back(job.segments.len() - 1);
    let _ = tx.send(TransferUpdate::Checkpoint { segments: job.segments.clone() });
}
