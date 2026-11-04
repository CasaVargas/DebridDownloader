//! Read a remote RAR's file list with HTTP `Range` requests, so its files can be downloaded one
//! by one like ZIP members (see `zip_remote`). Real-Debrid packs torrents with many files into a
//! single RAR.
//!
//! RAR has no central directory: each file's header sits right before its data. We walk the
//! headers, reading windows of the archive so that runs of small files cost one request, and
//! jumping over large files. Only *stored* members (RAR's "store" mode, no compression) can be
//! fetched on their own; compressed RAR data needs the proprietary RAR decoder.
use super::zip_remote::{cp437, get, safe_relative_path, ZipEntry, ZipError, ZipListing, METHOD_STORED};
use std::time::Duration;

const SIG_RAR4: &[u8] = b"Rar!\x1a\x07\x00";
const SIG_RAR5: &[u8] = b"Rar!\x1a\x07\x01\x00";
/// How far into the file to look for the signature (self-extracting stubs come first).
const SIG_SEARCH: u64 = 1024 * 1024;
/// Bytes fetched per request while walking headers through small files.
const WINDOW: u64 = 512 * 1024;
/// Bytes fetched after jumping over a large file: the next header is all we need.
const SMALL_READ: u64 = 16 * 1024;
/// Minimum time between progress reports.
const PROGRESS_EVERY: Duration = Duration::from_millis(150);

/// Called while listing with (entries found, bytes of the archive walked, archive size).
pub type Progress<'a> = &'a (dyn Fn(usize, u64, u64) + Send + Sync);
const MAX_HEADER: u64 = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 5_000_000;
/// Method codes we report for compressed RAR members; never decodable here.
const METHOD_RAR_COMPRESSED: u16 = 0x1000;

const COMPRESSED: &str = "compressed with RAR compression (only RARs made in \"store\" mode can be downloaded file by file)";

/// A sliding window over the remote archive.
struct Remote<'a> {
    client: &'a reqwest::Client,
    url: &'a str,
    size: u64,
    timeout: Duration,
    window: u64,
    start: u64,
    buf: Vec<u8>,
    /// The last jump skipped more than a window of data, so read just enough for a header.
    jumped_far: bool,
    progress: Option<Progress<'a>>,
    last_report: Option<std::time::Instant>,
}

impl<'a> Remote<'a> {
    /// Bytes `[pos, pos + len)`, fetching a new window when they aren't buffered.
    async fn bytes(&mut self, pos: u64, len: u64) -> Result<&[u8], ZipError> {
        if pos + len > self.size {
            return Err(ZipError::Format("archive is truncated".into()));
        }
        let have = pos >= self.start && pos + len <= self.start + self.buf.len() as u64;
        if !have {
            let ahead = if self.jumped_far { SMALL_READ.min(self.window) } else { self.window };
            let end = (pos + len.max(ahead)).min(self.size) - 1;
            let (b, _) = get(self.client, self.url, pos, end, self.timeout).await?;
            if (b.len() as u64) < len {
                return Err(ZipError::Http("connection closed while reading the archive".into()));
            }
            self.start = pos;
            self.buf = b;
        }
        let from = (pos - self.start) as usize;
        Ok(&self.buf[from..from + len as usize])
    }

    /// Record a jump over `skip` bytes of member data, then report progress (throttled).
    fn advance(&mut self, skip: u64, entries: usize, pos: u64) {
        self.jumped_far = skip > self.window;
        let Some(p) = self.progress else { return };
        if self.last_report.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
            self.last_report = Some(std::time::Instant::now());
            p(entries, pos.min(self.size), self.size);
        }
    }
}

fn u16le(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}
fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// RAR5 variable-length integer: 7 bits per byte, high bit = more. Returns (value, bytes used).
fn vint(b: &[u8], at: usize) -> Option<(u64, usize)> {
    let mut v: u64 = 0;
    for i in 0..10 {
        let c = *b.get(at + i)?;
        v |= ((c & 0x7f) as u64) << (7 * i);
        if c & 0x80 == 0 {
            return Some((v, i + 1));
        }
    }
    None
}

/// Cursor over a RAR5 header.
struct V<'b> {
    b: &'b [u8],
    p: usize,
}
impl V<'_> {
    fn vint(&mut self) -> Result<u64, ZipError> {
        let (v, n) = vint(self.b, self.p).ok_or_else(|| ZipError::Format("bad RAR header".into()))?;
        self.p += n;
        Ok(v)
    }
    fn u32(&mut self) -> Result<u32, ZipError> {
        if self.p + 4 > self.b.len() {
            return Err(ZipError::Format("bad RAR header".into()));
        }
        let v = u32le(self.b, self.p);
        self.p += 4;
        Ok(v)
    }
    fn take(&mut self, n: usize) -> Result<&[u8], ZipError> {
        let s = self.b.get(self.p..self.p + n).ok_or_else(|| ZipError::Format("bad RAR header".into()))?;
        self.p += n;
        Ok(s)
    }
}

/// Decode a RAR 2.x–4.x Unicode file name (`ascii \0 encoded`), as unrar's `DecodeFileName`.
pub fn decode_rar4_unicode(name: &[u8], enc: &[u8]) -> String {
    let mut out: Vec<u16> = Vec::new();
    let Some(&high) = enc.first() else { return String::new() };
    let high = (high as u16) << 8;
    let (mut pos, mut flags, mut bits) = (1usize, 0u8, 0u32);
    let at = |i: usize| enc.get(i).copied();
    while pos < enc.len() {
        if bits == 0 {
            flags = enc[pos];
            pos += 1;
            bits = 8;
        }
        match flags >> 6 {
            0 => {
                let Some(c) = at(pos) else { break };
                out.push(c as u16);
                pos += 1;
            }
            1 => {
                let Some(c) = at(pos) else { break };
                out.push(c as u16 | high);
                pos += 1;
            }
            2 => {
                let (Some(lo), Some(hi)) = (at(pos), at(pos + 1)) else { break };
                out.push(lo as u16 | (hi as u16) << 8);
                pos += 2;
            }
            _ => {
                let Some(len) = at(pos) else { break };
                pos += 1;
                if len & 0x80 != 0 {
                    let Some(corr) = at(pos) else { break };
                    pos += 1;
                    for _ in 0..(len & 0x7f) + 2 {
                        let Some(&c) = name.get(out.len()) else { break };
                        out.push((c.wrapping_add(corr) as u16) | high);
                    }
                } else {
                    for _ in 0..len as usize + 2 {
                        let Some(&c) = name.get(out.len()) else { break };
                        out.push(c as u16);
                    }
                }
            }
        }
        flags <<= 2;
        bits -= 2;
    }
    String::from_utf16_lossy(&out)
}

fn plain_name(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => cp437(raw),
    }
}

#[allow(clippy::too_many_arguments)]
fn entry(
    path: String,
    is_dir: bool,
    data_offset: u64,
    packed: u64,
    size: u64,
    stored: bool,
    crc32: u32,
    encrypted: bool,
    split: bool,
    archive_size: u64,
) -> ZipEntry {
    let path = path.replace('\\', "/");
    let unsupported = if is_dir {
        None
    } else if encrypted {
        Some("encrypted".to_string())
    } else if split {
        Some("split across several volumes".to_string())
    } else if !stored {
        Some(COMPRESSED.to_string())
    } else if packed != size {
        Some("stored size doesn't match".to_string())
    } else if data_offset + packed > archive_size {
        Some("points past the end of the archive".to_string())
    } else if safe_relative_path(&path).is_none() {
        Some("unsafe path".to_string())
    } else {
        None
    };
    ZipEntry {
        path: if is_dir && !path.ends_with('/') { format!("{path}/") } else { path },
        is_dir,
        header_offset: data_offset,
        compressed_size: packed,
        size,
        method: if stored { METHOD_STORED } else { METHOD_RAR_COMPRESSED },
        crc32,
        flags: 0,
        data_offset: Some(data_offset),
        encrypted,
        unsupported,
    }
}

/// Read the file list of the RAR at `url`.
pub async fn read_listing(client: &reqwest::Client, url: &str, timeout: Duration, progress: Option<Progress<'_>>) -> Result<ZipListing, ZipError> {
    read_listing_with_window(client, url, timeout, WINDOW, progress).await
}

/// `read_listing` with a chosen read-ahead window (tests use a small one).
pub async fn read_listing_with_window(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
    window: u64,
    progress: Option<Progress<'_>>,
) -> Result<ZipListing, ZipError> {
    let mut attempt = 0;
    loop {
        match read_listing_once(client, url, timeout, window, progress).await {
            Err(e @ (ZipError::NoRanges(_) | ZipError::Http(_))) if attempt < 2 => {
                attempt += 1;
                log::warn!("Reading RAR listing failed (attempt {attempt}): {e}; retrying");
                tokio::time::sleep(Duration::from_secs(2 * attempt)).await;
            }
            r => return r,
        }
    }
}

async fn read_listing_once(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
    window: u64,
    progress: Option<Progress<'_>>,
) -> Result<ZipListing, ZipError> {
    let (_, size) = get(client, url, 0, 0, timeout).await?;
    let mut r = Remote { client, url, size, timeout, window, start: 0, buf: Vec::new(), jumped_far: false, progress, last_report: None };
    let head = r.bytes(0, size.min(SIG_SEARCH.min(window.max(64))).max(1)).await?.to_vec();
    let find = |sig: &[u8]| head.windows(sig.len()).position(|w| w == sig);
    let entries = match (find(SIG_RAR5), find(SIG_RAR4)) {
        (Some(p), _) => walk_rar5(&mut r, p as u64 + SIG_RAR5.len() as u64).await?,
        (None, Some(p)) => walk_rar4(&mut r, p as u64 + SIG_RAR4.len() as u64).await?,
        _ => return Err(ZipError::Format("RAR signature not found".into())),
    };
    Ok(ZipListing { archive_size: size, entries })
}

async fn walk_rar4(r: &mut Remote<'_>, mut pos: u64) -> Result<Vec<ZipEntry>, ZipError> {
    let size = r.size;
    let mut out = Vec::new();
    while pos + 7 <= size && out.len() < MAX_ENTRIES {
        let base = r.bytes(pos, 7).await?.to_vec();
        let kind = base[2];
        let flags = u16le(&base, 3);
        let head_size = u16le(&base, 5) as u64;
        if head_size < 7 {
            return Err(ZipError::Format("bad RAR block".into()));
        }
        let h = r.bytes(pos, head_size).await?.to_vec();
        let file_like = matches!(kind, 0x74 | 0x7a);
        let mut add = 0u64;
        if file_like || flags & 0x8000 != 0 {
            if h.len() < 11 {
                return Err(ZipError::Format("bad RAR block".into()));
            }
            add = u32le(&h, 7) as u64;
        }
        match kind {
            0x73 if flags & 0x0080 != 0 => {
                return Err(ZipError::Unsupported("This RAR's file list is encrypted (password protected)".into()));
            }
            0x7b => break, // end of archive
            0x74 => {
                if h.len() < 32 {
                    return Err(ZipError::Format("bad RAR file header".into()));
                }
                let mut packed = add;
                let mut unp = u32le(&h, 11) as u64;
                let crc = u32le(&h, 16);
                let method = h[25];
                let name_len = u16le(&h, 26) as usize;
                let mut p = 32usize;
                if flags & 0x0100 != 0 {
                    if h.len() < 40 {
                        return Err(ZipError::Format("bad RAR file header".into()));
                    }
                    packed |= (u32le(&h, 32) as u64) << 32;
                    unp |= (u32le(&h, 36) as u64) << 32;
                    p = 40;
                }
                add = packed;
                let raw = h.get(p..p + name_len).ok_or_else(|| ZipError::Format("bad RAR file name".into()))?;
                let name = if flags & 0x0200 != 0 {
                    match raw.iter().position(|&c| c == 0) {
                        Some(z) => decode_rar4_unicode(&raw[..z], &raw[z + 1..]),
                        None => String::from_utf8_lossy(raw).into_owned(),
                    }
                } else {
                    plain_name(raw)
                };
                let is_dir = flags & 0x00e0 == 0x00e0;
                out.push(entry(
                    name,
                    is_dir,
                    pos + head_size,
                    packed,
                    unp,
                    method == 0x30,
                    crc,
                    flags & 0x0004 != 0,
                    flags & 0x0003 != 0,
                    size,
                ));
            }
            0x7a if flags & 0x0100 != 0 && h.len() >= 36 => add |= (u32le(&h, 32) as u64) << 32,
            _ => {}
        }
        pos = pos + head_size + add;
        r.advance(add, out.len(), pos);
    }
    Ok(out)
}

async fn walk_rar5(r: &mut Remote<'_>, mut pos: u64) -> Result<Vec<ZipEntry>, ZipError> {
    let size = r.size;
    let mut out = Vec::new();
    while pos + 7 <= size && out.len() < MAX_ENTRIES {
        // CRC32 (4) + header size (vint, ≤ 3 bytes for headers up to 2 MiB).
        let probe = r.bytes(pos, (size - pos).min(7)).await?.to_vec();
        let (hsize, hn) = vint(&probe, 4).ok_or_else(|| ZipError::Format("bad RAR header size".into()))?;
        if hsize == 0 || hsize > MAX_HEADER {
            return Err(ZipError::Format("bad RAR header size".into()));
        }
        let start = 4 + hn as u64;
        let h = r.bytes(pos + start, hsize).await?.to_vec();
        let mut v = V { b: &h, p: 0 };
        let kind = v.vint()?;
        let hflags = v.vint()?;
        let extra_size = if hflags & 0x1 != 0 { v.vint()? } else { 0 };
        let data_size = if hflags & 0x2 != 0 { v.vint()? } else { 0 };
        let data_start = pos + start + hsize;
        match kind {
            4 => return Err(ZipError::Unsupported("This RAR's file list is encrypted (password protected)".into())),
            5 => break, // end of archive
            2 => {
                let fflags = v.vint()?;
                let mut unp = v.vint()?;
                let _attrs = v.vint()?;
                if fflags & 0x2 != 0 {
                    v.u32()?;
                }
                let crc = if fflags & 0x4 != 0 { v.u32()? } else { 0 };
                let comp = v.vint()?;
                let _os = v.vint()?;
                let name_len = v.vint()? as usize;
                let name = String::from_utf8_lossy(v.take(name_len)?).into_owned();
                // Extra area: the last `extra_size` bytes of the header. Record type 1 = encryption.
                let mut encrypted = false;
                let ex_from = h.len().saturating_sub(extra_size as usize);
                let mut e = V { b: &h[ex_from..], p: 0 };
                while e.p < e.b.len() {
                    let Ok(rsize) = e.vint() else { break };
                    let rstart = e.p;
                    let Ok(rtype) = e.vint() else { break };
                    if rtype == 1 {
                        encrypted = true;
                    }
                    e.p = rstart + rsize as usize;
                }
                let is_dir = fflags & 0x1 != 0;
                if fflags & 0x8 != 0 {
                    unp = data_size; // unknown unpacked size; only meaningful for stored data
                }
                let method = (comp >> 7) & 0x7;
                out.push(entry(
                    name,
                    is_dir,
                    data_start,
                    data_size,
                    unp,
                    method == 0,
                    crc,
                    encrypted,
                    hflags & 0x18 != 0,
                    size,
                ));
            }
            _ => {}
        }
        pos = data_start + data_size;
        r.advance(data_size, out.len(), pos);
    }
    Ok(out)
}
