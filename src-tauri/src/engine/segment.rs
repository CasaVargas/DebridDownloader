//! One Range worker: stream → limiter → sequential writes at an offset → durable checkpoints.
use super::limiter::Limiter;
use futures::StreamExt;
use reqwest::header::{HeaderMap, CONTENT_RANGE, CONTENT_TYPE, RANGE, RETRY_AFTER};
use std::io::SeekFrom;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub struct SegmentCtx {
    pub client: reqwest::Client,
    pub url: String,
    pub path: PathBuf,
    pub limiter: Arc<Limiter>,
    pub cancel: CancellationToken,
    /// Send `Range` and require 206. False for servers without range support.
    pub use_range: bool,
    /// Size unknown: EOF means done instead of "closed early".
    pub until_eof: bool,
    pub idle_timeout: Duration,
    pub checkpoint_bytes: u64,
    pub checkpoint_interval: Duration,
}

#[derive(Debug)]
pub enum SegmentMsg {
    /// Bytes written (not yet durable). Used for live progress and speed.
    Bytes { index: usize, n: u64 },
    /// `done` bytes from the segment start are durable on disk.
    Checkpoint { index: usize, done: u64 },
}

#[derive(Debug, Clone, PartialEq)]
pub enum SegmentError {
    Transient(String),
    Connect(String),
    DeadLink(String),
    ConnLimit { retry_after: Option<Duration> },
    RangeIgnored,
    Disk(String),
    Cancelled,
}

fn disk(e: std::io::Error) -> SegmentError {
    SegmentError::Disk(e.to_string())
}

pub fn classify_reqwest(e: reqwest::Error) -> SegmentError {
    if e.is_connect() {
        SegmentError::Connect(e.to_string())
    } else {
        SegmentError::Transient(e.to_string())
    }
}

pub fn parse_retry_after(h: &HeaderMap) -> Option<Duration> {
    h.get(RETRY_AFTER)?.to_str().ok()?.trim().parse::<u64>().ok().map(Duration::from_secs)
}

pub fn is_html(h: &HeaderMap) -> bool {
    h.get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start().to_ascii_lowercase().starts_with("text/html"))
        .unwrap_or(false)
}

/// `bytes 100-199/1000` → Some(100)
pub fn content_range_start(h: &HeaderMap) -> Option<u64> {
    let v = h.get(CONTENT_RANGE)?.to_str().ok()?;
    let rest = v.strip_prefix("bytes ")?;
    let (range, _) = rest.split_once('/')?;
    range.split_once('-')?.0.trim().parse().ok()
}

/// `bytes 0-0/1000` → Some(1000); `bytes */0` → Some(0); `bytes 0-0/*` → None
pub fn content_range_total(h: &HeaderMap) -> Option<u64> {
    let v = h.get(CONTENT_RANGE)?.to_str().ok()?;
    v.rsplit_once('/')?.1.trim().parse().ok()
}

/// Map a response status to an error class. Shared with `transfer::probe`.
pub fn status_error(status: u16, headers: &HeaderMap) -> Option<SegmentError> {
    match status {
        401 | 403 | 404 | 410 => Some(SegmentError::DeadLink(format!("HTTP {status}"))),
        429 | 503 => Some(SegmentError::ConnLimit { retry_after: parse_retry_after(headers) }),
        500..=599 => Some(SegmentError::Transient(format!("HTTP {status}"))),
        _ => None,
    }
}

fn check_response(resp: &reqwest::Response, use_range: bool, pos: u64) -> Result<(), SegmentError> {
    let status = resp.status().as_u16();
    if let Some(e) = status_error(status, resp.headers()) {
        return Err(e);
    }
    if is_html(resp.headers()) {
        return Err(SegmentError::DeadLink("server returned a web page instead of the file".into()));
    }
    if use_range {
        if status != 206 {
            return Err(SegmentError::RangeIgnored);
        }
        match content_range_start(resp.headers()) {
            Some(s) if s == pos => Ok(()),
            _ => Err(SegmentError::RangeIgnored),
        }
    } else if status == 200 {
        Ok(())
    } else {
        Err(SegmentError::Transient(format!("unexpected HTTP {status}")))
    }
}

async fn checkpoint(
    file: &mut File,
    index: usize,
    start: u64,
    pos: u64,
    tx: &mpsc::UnboundedSender<SegmentMsg>,
) -> Result<(), SegmentError> {
    file.flush().await.map_err(disk)?;
    file.sync_data().await.map_err(disk)?;
    let _ = tx.send(SegmentMsg::Checkpoint { index, done: pos - start });
    Ok(())
}

pub async fn run_segment(
    ctx: &SegmentCtx,
    index: usize,
    start: u64,
    done: u64,
    end: Arc<AtomicU64>,
    tx: &mpsc::UnboundedSender<SegmentMsg>,
) -> Result<u64, SegmentError> {
    let mut pos = start + done;
    let end_now = end.load(Ordering::SeqCst);
    if pos > end_now {
        return Ok(done);
    }

    let mut req = ctx.client.get(&ctx.url);
    if ctx.use_range {
        req = req.header(RANGE, format!("bytes={}-{}", pos, end_now));
    }
    let resp = tokio::select! {
        _ = ctx.cancel.cancelled() => return Err(SegmentError::Cancelled),
        r = tokio::time::timeout(ctx.idle_timeout, req.send()) => match r {
            Err(_) => return Err(SegmentError::Transient("request timed out".into())),
            Ok(r) => r.map_err(classify_reqwest)?,
        },
    };
    check_response(&resp, ctx.use_range, pos)?;

    let mut file = OpenOptions::new().write(true).open(&ctx.path).await.map_err(disk)?;
    file.seek(SeekFrom::Start(pos)).await.map_err(disk)?;

    let mut stream = resp.bytes_stream();
    let mut unsynced: u64 = 0;
    let mut last_sync = Instant::now();

    loop {
        let next = tokio::select! {
            _ = ctx.cancel.cancelled() => {
                checkpoint(&mut file, index, start, pos, tx).await?;
                return Err(SegmentError::Cancelled);
            }
            r = tokio::time::timeout(ctx.idle_timeout, stream.next()) => r,
        };
        let chunk = match next {
            Err(_) => {
                checkpoint(&mut file, index, start, pos, tx).await?;
                return Err(SegmentError::Transient("connection stalled".into()));
            }
            Ok(None) => break,
            Ok(Some(Err(e))) => {
                checkpoint(&mut file, index, start, pos, tx).await?;
                return Err(classify_reqwest(e));
            }
            Ok(Some(Ok(b))) => b,
        };

        let end_now = end.load(Ordering::SeqCst);
        if pos > end_now {
            break;
        }
        let take = ((end_now - pos + 1).min(chunk.len() as u64)) as usize;
        ctx.limiter.acquire(take).await;
        file.write_all(&chunk[..take]).await.map_err(disk)?;
        pos += take as u64;
        unsynced += take as u64;
        let _ = tx.send(SegmentMsg::Bytes { index, n: take as u64 });

        if unsynced >= ctx.checkpoint_bytes || last_sync.elapsed() >= ctx.checkpoint_interval {
            checkpoint(&mut file, index, start, pos, tx).await?;
            unsynced = 0;
            last_sync = Instant::now();
        }
        if pos > end.load(Ordering::SeqCst) {
            break;
        }
    }

    checkpoint(&mut file, index, start, pos, tx).await?;
    if !ctx.until_eof && pos <= end.load(Ordering::SeqCst) {
        return Err(SegmentError::Transient("connection closed early".into()));
    }
    Ok(pos - start)
}
