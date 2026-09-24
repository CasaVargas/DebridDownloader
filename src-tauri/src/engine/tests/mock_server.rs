//! Minimal range-capable HTTP file server with fault injection.
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use axum::body::Bytes;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const CHUNK: usize = 16 * 1024;

pub fn pattern(size: usize) -> Vec<u8> {
    (0..size).map(|i| ((i * 31 + 7) % 251) as u8).collect()
}

#[derive(Clone, Default)]
pub struct MockOpts {
    pub size: usize,
    /// Honor `Range` headers.
    pub ranges: bool,
    /// Honor `Range` only for the `bytes=0-0` probe (server "lies" afterwards).
    pub ranges_probe_only: bool,
    /// Omit Content-Length (chunked transfer).
    pub no_length: bool,
    /// Abort the body after this many bytes, for the first `drop_times` requests.
    pub drop_after: Option<usize>,
    pub drop_times: usize,
    /// Stop sending (hang) after this many bytes, for the first `stall_times` requests.
    pub stall_after: Option<usize>,
    pub stall_times: usize,
    /// Reply 429 when this many bodies are already streaming.
    pub conn_limit: Option<usize>,
    /// Refuse over-limit connections with 403 instead of 429 (some hosts do).
    pub conn_limit_forbidden: bool,
    /// Reply with an HTML page instead of the file.
    pub html: bool,
    /// Sleep between 16 KiB chunks.
    pub chunk_delay: Option<Duration>,
    /// Serve these bytes instead of `pattern(size)`.
    pub data: Option<Vec<u8>>,
}

struct Inner {
    opts: MockOpts,
    data: Vec<u8>,
    token: String,
    requests: usize,
    active: usize,
    max_active: usize,
    ranges: Vec<(u64, u64)>,
    drops_done: usize,
    stalls_done: usize,
}

type Shared = Arc<Mutex<Inner>>;

struct ShutdownOnDrop(Mutex<Option<tokio::sync::oneshot::Sender<()>>>);
impl Drop for ShutdownOnDrop {
    fn drop(&mut self) {
        if let Some(tx) = self.0.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }
}

#[derive(Clone)]
pub struct MockServer {
    pub addr: SocketAddr,
    inner: Shared,
    _shutdown: Arc<ShutdownOnDrop>,
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

impl MockServer {
    pub async fn start(opts: MockOpts) -> Self {
        Self::start_on(0, opts).await
    }

    pub async fn start_on(port: u16, opts: MockOpts) -> Self {
        let data = opts.data.clone().unwrap_or_else(|| pattern(opts.size));
        let inner = Arc::new(Mutex::new(Inner {
            opts,
            data,
            token: "t0".into(),
            requests: 0,
            active: 0,
            max_active: 0,
            ranges: Vec::new(),
            drops_done: 0,
            stalls_done: 0,
        }));
        let app = Router::new().route("/file/{token}", get(handler)).with_state(inner.clone());
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = rx.await;
                })
                .await;
        });
        Self { addr, inner, _shutdown: Arc::new(ShutdownOnDrop(Mutex::new(Some(tx)))) }
    }

    pub fn url(&self) -> String {
        format!("http://{}/file/{}", self.addr, self.inner.lock().unwrap().token)
    }

    /// Expire every URL handed out so far; returns the new valid URL.
    pub fn rotate(&self) -> String {
        {
            let mut g = self.inner.lock().unwrap();
            let n = g.token.trim_start_matches('t').parse::<u32>().unwrap_or(0) + 1;
            g.token = format!("t{n}");
        }
        self.url()
    }

    pub fn data(&self) -> Vec<u8> {
        self.inner.lock().unwrap().data.clone()
    }
    #[allow(dead_code)] // part of the harness API; no current test swaps the payload
    pub fn set_data(&self, data: Vec<u8>) {
        self.inner.lock().unwrap().data = data;
    }
    pub fn update(&self, f: impl FnOnce(&mut MockOpts)) {
        f(&mut self.inner.lock().unwrap().opts);
    }
    #[allow(dead_code)] // part of the harness API
    pub fn requests(&self) -> usize {
        self.inner.lock().unwrap().requests
    }
    pub fn max_active(&self) -> usize {
        self.inner.lock().unwrap().max_active
    }
    pub fn ranges(&self) -> Vec<(u64, u64)> {
        self.inner.lock().unwrap().ranges.clone()
    }
}

struct ActiveGuard(Shared);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.lock().unwrap().active -= 1;
    }
}

fn parse_range(headers: &HeaderMap, total: usize) -> Option<(usize, usize)> {
    let v = headers.get(header::RANGE)?.to_str().ok()?;
    let spec = v.strip_prefix("bytes=")?;
    let (s, e) = spec.split_once('-')?;
    let start: usize = s.parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if e.is_empty() { total - 1 } else { e.parse::<usize>().ok()?.min(total - 1) };
    Some((start, end))
}

async fn handler(State(inner): State<Shared>, Path(token): Path<String>, headers: HeaderMap) -> Response {
    let mut g = inner.lock().unwrap();
    g.requests += 1;
    if token != g.token {
        return (StatusCode::FORBIDDEN, "expired").into_response();
    }
    if g.opts.html {
        return ([(header::CONTENT_TYPE, "text/html")], "<html>please log in</html>").into_response();
    }
    if let Some(limit) = g.opts.conn_limit {
        if g.active >= limit {
            if g.opts.conn_limit_forbidden {
                return (StatusCode::FORBIDDEN, "too many connections").into_response();
            }
            return (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, "0")], "").into_response();
        }
    }
    let total = g.data.len();
    let wants_range = headers.contains_key(header::RANGE);
    let is_probe = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) == Some("bytes=0-0");
    let honor = g.opts.ranges || (g.opts.ranges_probe_only && is_probe);
    if honor && wants_range && total == 0 {
        return (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, "bytes */0")], "").into_response();
    }
    let range = if honor { parse_range(&headers, total) } else { None };
    let (start, end, status) = match range {
        Some((s, e)) => (s, e, StatusCode::PARTIAL_CONTENT),
        None => (0, total.saturating_sub(1), StatusCode::OK),
    };
    let body: Vec<u8> = if total == 0 { Vec::new() } else { g.data[start..=end].to_vec() };
    if status == StatusCode::PARTIAL_CONTENT {
        g.ranges.push((start as u64, end as u64));
    }
    let drop_after = if g.drops_done < g.opts.drop_times {
        g.drops_done += 1;
        g.opts.drop_after
    } else {
        None
    };
    let stall_after = if g.stalls_done < g.opts.stall_times {
        g.stalls_done += 1;
        g.opts.stall_after
    } else {
        None
    };
    let delay = g.opts.chunk_delay;
    let no_length = g.opts.no_length;
    let accept = if g.opts.ranges { "bytes" } else { "none" };
    g.active += 1;
    g.max_active = g.max_active.max(g.active);
    drop(g);

    let len = body.len();
    let guard = ActiveGuard(inner.clone());
    let stream = futures::stream::unfold(
        (body, 0usize, false, guard),
        move |(body, pos, finished, guard)| async move {
            if finished || pos >= body.len() {
                return None;
            }
            if let Some(d) = drop_after {
                if pos >= d {
                    return Some((Err(std::io::Error::other("dropped")), (body, pos, true, guard)));
                }
            }
            if let Some(s) = stall_after {
                if pos >= s {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                }
            }
            if let Some(d) = delay {
                tokio::time::sleep(d).await;
            }
            let mut end = (pos + CHUNK).min(body.len());
            for limit in [drop_after, stall_after].into_iter().flatten() {
                if pos < limit {
                    end = end.min(limit);
                }
            }
            let chunk = Bytes::copy_from_slice(&body[pos..end]);
            Some((Ok::<Bytes, std::io::Error>(chunk), (body, end, false, guard)))
        },
    );

    let mut resp = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ACCEPT_RANGES, accept);
    if !no_length {
        resp = resp.header(header::CONTENT_LENGTH, len);
    }
    if status == StatusCode::PARTIAL_CONTENT {
        resp = resp.header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, total));
    }
    resp.body(Body::from_stream(stream)).unwrap()
}
