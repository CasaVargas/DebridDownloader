//! Download the *contents* of a remote ZIP instead of the archive itself.
//!
//! A ZIP keeps its table of contents (the central directory) at the end of the file, so with
//! HTTP `Range` requests we can read the listing without downloading the archive, then fetch each
//! member's compressed bytes on its own. Every member becomes an ordinary engine job
//! ([`JobKind::ZipEntry`](super::types::JobKind)) whose segments are offsets inside that member:
//!
//! - **Stored** members (method 0, the usual case for video) are written straight into the final
//!   file with the normal multi-connection, resumable transfer. No extraction step at all.
//! - **Deflate / BZip2** members are downloaded the same way into `{dest}.part` (still resumable),
//!   then decoded in one sequential pass with a CRC-32 check while other members keep downloading.
//!
//! Same idea as <https://github.com/saulpw/unzip-http>. Works with any host that honours `Range`
//! (Real-Debrid download servers do).
use super::segment::{classify_reqwest, content_range_start, content_range_total, is_html, status_error, SegmentError};
use futures::StreamExt;
use reqwest::header::RANGE;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const METHOD_STORED: u16 = 0;
pub const METHOD_DEFLATE: u16 = 8;
pub const METHOD_BZIP2: u16 = 12;

const SIG_EOCD: u32 = 0x0605_4b50;
const SIG_ZIP64_LOCATOR: u32 = 0x0706_4b50;
const SIG_ZIP64_EOCD: u32 = 0x0606_4b50;
const SIG_CENTRAL: u32 = 0x0201_4b50;
const SIG_LOCAL: u32 = 0x0403_4b50;
const EOCD_LEN: u64 = 22;
const ZIP64_LOCATOR_LEN: u64 = 20;
const ZIP64_EOCD_LEN: u64 = 56;
const LOCAL_HEADER_LEN: u64 = 30;
/// EOCD + max comment + ZIP64 locator: the most we ever need from the tail to find the directory.
const TAIL_LEN: u64 = EOCD_LEN + 0xFFFF + ZIP64_LOCATOR_LEN;
/// Refuse absurd directories instead of allocating them (≈ 5 million entries).
const MAX_CENTRAL_DIR: u64 = 512 * 1024 * 1024;

/// What a job needs to fetch and rebuild one member. Persisted inside the job.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ZipEntrySpec {
    /// Offset of the member's local file header inside the archive.
    pub header_offset: u64,
    pub compressed_size: u64,
    /// Uncompressed size.
    pub size: u64,
    pub method: u16,
    pub crc32: u32,
    /// Size of the whole archive; a different size on the server means the archive changed.
    pub archive_size: u64,
}

impl ZipEntrySpec {
    /// True when the downloaded bytes are the file itself (no decode pass).
    pub fn is_stored(&self) -> bool {
        self.method == METHOD_STORED
    }
}

/// One row of the archive listing shown to the user.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZipEntry {
    /// Path inside the archive, `/`-separated, as stored (decoded to UTF-8).
    pub path: String,
    pub is_dir: bool,
    pub header_offset: u64,
    pub compressed_size: u64,
    pub size: u64,
    pub method: u16,
    pub crc32: u32,
    pub encrypted: bool,
    /// None when the member can be downloaded; otherwise why not.
    pub unsupported: Option<String>,
}

impl ZipEntry {
    pub fn spec(&self, archive_size: u64) -> ZipEntrySpec {
        ZipEntrySpec {
            header_offset: self.header_offset,
            compressed_size: self.compressed_size,
            size: self.size,
            method: self.method,
            crc32: self.crc32,
            archive_size,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZipListing {
    pub archive_size: u64,
    pub entries: Vec<ZipEntry>,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ZipError {
    #[error("{0}")]
    Http(String),
    #[error("The download server doesn't support byte ranges, so the archive's contents can't be read remotely")]
    NoRanges,
    #[error("Not a ZIP archive (or it is damaged): {0}")]
    Format(String),
    #[error("{0}")]
    Unsupported(String),
}

fn http_err(e: SegmentError) -> ZipError {
    ZipError::Http(match e {
        SegmentError::DeadLink(m) => format!("The download link is no longer valid ({m})"),
        SegmentError::ConnLimit { .. } => "The server is rate limiting; try again in a moment".into(),
        SegmentError::Connect(m) | SegmentError::Transient(m) | SegmentError::Disk(m) => m,
        SegmentError::RangeIgnored => "The server ignored the byte range".into(),
        SegmentError::Cancelled => "Cancelled".into(),
    })
}

/// GET `[start, end]` (inclusive) and return the body plus the archive size from `Content-Range`.
pub async fn fetch_range(
    client: &reqwest::Client,
    url: &str,
    start: u64,
    end: u64,
    timeout: Duration,
) -> Result<(Vec<u8>, u64), SegmentError> {
    let resp = tokio::time::timeout(timeout, client.get(url).header(RANGE, format!("bytes={start}-{end}")).send())
        .await
        .map_err(|_| SegmentError::Transient("request timed out".into()))?
        .map_err(classify_reqwest)?;
    let status = resp.status().as_u16();
    if let Some(e) = status_error(status, resp.headers()) {
        return Err(e);
    }
    if is_html(resp.headers()) {
        return Err(SegmentError::DeadLink("server returned a web page instead of the file".into()));
    }
    // A 200 here would be the whole (possibly huge) archive: drop it unread.
    if status != 206 || content_range_start(resp.headers()) != Some(start) {
        return Err(SegmentError::RangeIgnored);
    }
    let total = content_range_total(resp.headers()).ok_or(SegmentError::RangeIgnored)?;
    let want = (end - start + 1) as usize;
    let mut body = Vec::with_capacity(want.min(64 * 1024 * 1024));
    let mut stream = resp.bytes_stream();
    loop {
        match tokio::time::timeout(timeout, stream.next()).await {
            Err(_) => return Err(SegmentError::Transient("connection stalled".into())),
            Ok(None) => break,
            Ok(Some(Err(e))) => return Err(classify_reqwest(e)),
            Ok(Some(Ok(b))) => body.extend_from_slice(&b),
        }
        if body.len() >= want {
            break;
        }
    }
    body.truncate(want);
    Ok((body, total))
}

async fn get(client: &reqwest::Client, url: &str, start: u64, end: u64, timeout: Duration) -> Result<(Vec<u8>, u64), ZipError> {
    match fetch_range(client, url, start, end, timeout).await {
        Ok(v) => Ok(v),
        Err(SegmentError::RangeIgnored) => Err(ZipError::NoRanges),
        Err(e) => Err(http_err(e)),
    }
}

/// Read the archive listing with a handful of small `Range` requests.
pub async fn read_listing(client: &reqwest::Client, url: &str, timeout: Duration) -> Result<ZipListing, ZipError> {
    let (_, size) = get(client, url, 0, 0, timeout).await?;
    if size < EOCD_LEN {
        return Err(ZipError::Format("file is too small".into()));
    }
    let tail_start = size.saturating_sub(TAIL_LEN);
    let (tail, _) = get(client, url, tail_start, size - 1, timeout).await?;
    let dir = locate_directory(&tail, tail_start, size)?;

    if dir.size > MAX_CENTRAL_DIR {
        return Err(ZipError::Unsupported("The archive's file list is too large".into()));
    }
    let cd = if dir.size == 0 {
        Vec::new()
    } else if dir.offset >= tail_start {
        let from = (dir.offset - tail_start) as usize;
        tail.get(from..from + dir.size as usize).ok_or_else(|| ZipError::Format("central directory out of range".into()))?.to_vec()
    } else {
        // Large listings: allow more time than a tiny probe.
        let (b, _) = get(client, url, dir.offset, dir.offset + dir.size - 1, timeout.max(Duration::from_secs(120))).await?;
        if b.len() as u64 != dir.size {
            return Err(ZipError::Http("connection closed while reading the file list".into()));
        }
        b
    };
    let entries = parse_central_directory(&cd, dir.entries, dir.shift, size)?;
    Ok(ZipListing { archive_size: size, entries })
}

/// Fetch a member's local header. Returns where its data starts and the archive size the server
/// reports (the caller compares it with the size recorded when the listing was read).
pub async fn data_offset(
    client: &reqwest::Client,
    url: &str,
    spec: &ZipEntrySpec,
    timeout: Duration,
) -> Result<(u64, u64), SegmentError> {
    let (h, total) = fetch_range(client, url, spec.header_offset, spec.header_offset + LOCAL_HEADER_LEN - 1, timeout).await?;
    if total != spec.archive_size {
        return Ok((0, total));
    }
    Ok((parse_local_header(&h, spec)?, total))
}

pub fn parse_local_header(h: &[u8], spec: &ZipEntrySpec) -> Result<u64, SegmentError> {
    if h.len() < LOCAL_HEADER_LEN as usize || u32le(h, 0) != SIG_LOCAL {
        return Err(SegmentError::Transient("bad local file header".into()));
    }
    let n = u16le(h, 26) as u64;
    let m = u16le(h, 28) as u64;
    let start = spec.header_offset + LOCAL_HEADER_LEN + n + m;
    if start + spec.compressed_size > spec.archive_size {
        return Err(SegmentError::Transient("member extends past the end of the archive".into()));
    }
    Ok(start)
}

#[derive(Debug, PartialEq)]
pub struct Directory {
    pub offset: u64,
    pub size: u64,
    pub entries: u64,
    /// Bytes prepended to the archive (self-extractors); added to every stored offset.
    pub shift: u64,
}

fn u16le(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}
fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}
fn u64le(b: &[u8], at: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(a)
}

/// Find the central directory from the last bytes of the archive. `tail` starts at `tail_start`.
pub fn locate_directory(tail: &[u8], tail_start: u64, archive_size: u64) -> Result<Directory, ZipError> {
    if (tail.len() as u64) < EOCD_LEN {
        return Err(ZipError::Format("file is too small".into()));
    }
    // Scan backwards for an EOCD whose comment runs exactly to the end of the file.
    let mut found = None;
    let mut i = tail.len() - EOCD_LEN as usize;
    loop {
        if u32le(tail, i) == SIG_EOCD {
            let comment = u16le(tail, i + 20) as usize;
            if i + EOCD_LEN as usize + comment == tail.len() {
                found = Some(i);
                break;
            }
        }
        if i == 0 {
            break;
        }
        i -= 1;
    }
    let e = found.ok_or_else(|| ZipError::Format("end of central directory not found".into()))?;
    let disk = u16le(tail, e + 4);
    let cd_disk = u16le(tail, e + 6);
    let entries = u16le(tail, e + 10) as u64;
    let size = u32le(tail, e + 12) as u64;
    let offset = u32le(tail, e + 16) as u64;
    let record_pos = tail_start + e as u64; // where the directory must end

    let has_locator = e >= ZIP64_LOCATOR_LEN as usize && u32le(tail, e - ZIP64_LOCATOR_LEN as usize) == SIG_ZIP64_LOCATOR;
    if has_locator {
        let l = e - ZIP64_LOCATOR_LEN as usize;
        let z64_off = u64le(tail, l + 8);
        let disks = u32le(tail, l + 16);
        if disks > 1 {
            return Err(split_archive());
        }
        // The ZIP64 record sits right before the locator; use its real position, which also
        // works when bytes were prepended to the archive.
        let z64_pos = (tail_start + l as u64).checked_sub(ZIP64_EOCD_LEN).ok_or_else(|| ZipError::Format("bad ZIP64 locator".into()))?;
        let r = z64_pos.checked_sub(tail_start).map(|r| r as usize).ok_or_else(|| ZipError::Format("ZIP64 record out of range".into()))?;
        if u32le(tail, r) != SIG_ZIP64_EOCD {
            // Record has an extensible data sector; fall back to the stored offset.
            let r = z64_off.checked_sub(tail_start).map(|r| r as usize).filter(|&r| r + ZIP64_EOCD_LEN as usize <= tail.len());
            let r = r.filter(|&r| u32le(tail, r) == SIG_ZIP64_EOCD).ok_or_else(|| ZipError::Format("ZIP64 record not found".into()))?;
            return zip64_dir(tail, r, tail_start + r as u64, archive_size);
        }
        return zip64_dir(tail, r, z64_pos, archive_size);
    }
    if disk != 0 || cd_disk != 0 {
        return Err(split_archive());
    }
    if entries == 0xFFFF || size == 0xFFFF_FFFF || offset == 0xFFFF_FFFF {
        return Err(ZipError::Format("ZIP64 archive without a ZIP64 locator".into()));
    }
    let real = record_pos.checked_sub(size).ok_or_else(|| ZipError::Format("central directory size is invalid".into()))?;
    let shift = real.checked_sub(offset).ok_or_else(|| ZipError::Format("central directory offset is invalid".into()))?;
    let _ = archive_size;
    Ok(Directory { offset: real, size, entries, shift })
}

fn zip64_dir(tail: &[u8], r: usize, record_pos: u64, _archive_size: u64) -> Result<Directory, ZipError> {
    if r + ZIP64_EOCD_LEN as usize > tail.len() {
        return Err(ZipError::Format("ZIP64 record truncated".into()));
    }
    let disk = u32le(tail, r + 16);
    let cd_disk = u32le(tail, r + 20);
    if disk != 0 || cd_disk != 0 {
        return Err(split_archive());
    }
    let entries = u64le(tail, r + 32);
    let size = u64le(tail, r + 40);
    let offset = u64le(tail, r + 48);
    let real = record_pos.checked_sub(size).ok_or_else(|| ZipError::Format("central directory size is invalid".into()))?;
    let shift = real.checked_sub(offset).ok_or_else(|| ZipError::Format("central directory offset is invalid".into()))?;
    Ok(Directory { offset: real, size, entries, shift })
}

fn split_archive() -> ZipError {
    ZipError::Unsupported("Split (multi-part) ZIP archives can't be read remotely".into())
}

/// Parse every central-directory record.
pub fn parse_central_directory(cd: &[u8], expected: u64, shift: u64, archive_size: u64) -> Result<Vec<ZipEntry>, ZipError> {
    let mut out = Vec::with_capacity(expected.min(1_000_000) as usize);
    let mut p = 0usize;
    while p + 46 <= cd.len() && u32le(cd, p) == SIG_CENTRAL {
        let flags = u16le(cd, p + 8);
        let method = u16le(cd, p + 10);
        let crc32 = u32le(cd, p + 16);
        let mut csize = u32le(cd, p + 20) as u64;
        let mut usize_ = u32le(cd, p + 24) as u64;
        let n = u16le(cd, p + 28) as usize;
        let m = u16le(cd, p + 30) as usize;
        let k = u16le(cd, p + 32) as usize;
        let disk = u16le(cd, p + 34) as u32;
        let ext_attr = u32le(cd, p + 38);
        let mut offset = u32le(cd, p + 42) as u64;
        let name_at = p + 46;
        let extra_at = name_at + n;
        let next = extra_at + m + k;
        if next > cd.len() {
            return Err(ZipError::Format("truncated central directory".into()));
        }
        let raw_name = &cd[name_at..extra_at];
        let extra = &cd[extra_at..extra_at + m];

        let mut name = if flags & 0x0800 != 0 { String::from_utf8_lossy(raw_name).into_owned() } else { cp437(raw_name) };
        let mut disk_start = disk;
        let mut q = 0usize;
        while q + 4 <= extra.len() {
            let id = u16le(extra, q);
            let len = u16le(extra, q + 2) as usize;
            let body = &extra[q + 4..(q + 4 + len).min(extra.len())];
            match id {
                0x0001 => {
                    // ZIP64: only the fields that overflowed are present, in this order.
                    let mut f = 0usize;
                    let mut take = |v: &mut u64| {
                        if f + 8 <= body.len() {
                            *v = u64le(body, f);
                            f += 8;
                        }
                    };
                    if usize_ == 0xFFFF_FFFF {
                        take(&mut usize_);
                    }
                    if csize == 0xFFFF_FFFF {
                        take(&mut csize);
                    }
                    if offset == 0xFFFF_FFFF {
                        take(&mut offset);
                    }
                    if disk == 0xFFFF && f + 4 <= body.len() {
                        disk_start = u32le(body, f);
                    }
                }
                0x7075 if body.len() >= 5 && body[0] == 1 => {
                    // Info-ZIP Unicode Path: valid only if it matches the stored name's CRC.
                    let mut c = flate2::Crc::new();
                    c.update(raw_name);
                    if c.sum() == u32le(body, 1) {
                        name = String::from_utf8_lossy(&body[5..]).into_owned();
                    }
                }
                _ => {}
            }
            q += 4 + len;
        }

        let name = name.replace('\\', "/");
        let is_dir = name.ends_with('/') || (ext_attr & 0x10 != 0 && usize_ == 0 && csize == 0);
        let encrypted = flags & 0x0001 != 0;
        let header_offset = offset + shift;
        let unsupported = if is_dir {
            None
        } else if disk_start != 0 {
            Some("stored on another disk of a split archive".to_string())
        } else if encrypted || method == 99 {
            Some("encrypted".to_string())
        } else if !matches!(method, METHOD_STORED | METHOD_DEFLATE | METHOD_BZIP2) {
            Some(format!("compression method {} ({}) isn't supported", method, method_name(method)))
        } else if method == METHOD_STORED && csize != usize_ {
            Some("stored size doesn't match".to_string())
        } else if header_offset + LOCAL_HEADER_LEN + csize > archive_size {
            Some("points past the end of the archive".to_string())
        } else if safe_relative_path(&name).is_none() {
            Some("unsafe path".to_string())
        } else {
            None
        };
        out.push(ZipEntry {
            path: name,
            is_dir,
            header_offset,
            compressed_size: csize,
            size: usize_,
            method,
            crc32,
            encrypted,
            unsupported,
        });
        p = next;
    }
    if (out.len() as u64) < expected {
        return Err(ZipError::Format(format!("expected {} entries, found {}", expected, out.len())));
    }
    Ok(out)
}

pub fn method_name(m: u16) -> &'static str {
    match m {
        0 => "Stored",
        8 => "Deflate",
        9 => "Deflate64",
        12 => "BZip2",
        14 => "LZMA",
        93 => "Zstandard",
        95 => "XZ",
        98 => "PPMd",
        99 => "AES",
        _ => "unknown",
    }
}

/// IBM code page 437, the ZIP default when the UTF-8 flag is clear.
fn cp437(b: &[u8]) -> String {
    const HI: &str = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u{a0}";
    let hi: Vec<char> = HI.chars().collect();
    b.iter().map(|&c| if c < 0x80 { c as char } else { hi[(c - 0x80) as usize] }).collect()
}

fn clean_component(c: &str) -> String {
    let mut s: String = c
        .chars()
        .map(|ch| match ch {
            ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if (ch as u32) < 0x20 => '_',
            ch => ch,
        })
        .collect();
    // Windows drops trailing dots/spaces, which could merge two names.
    if s.ends_with('.') || s.ends_with(' ') {
        s.push('_');
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        s.insert(0, '_');
    }
    s
}

/// Turn an archive path into a safe relative path (components joined by `/`).
/// None for paths that try to escape the destination (`..`) or have no file name.
pub fn safe_relative_path(name: &str) -> Option<Vec<String>> {
    let name = name.replace('\\', "/");
    let mut parts = Vec::new();
    for (i, c) in name.split('/').enumerate() {
        if c.is_empty() || c == "." {
            continue;
        }
        if c == ".." {
            return None;
        }
        // Drive letter like `C:` at the start.
        if i == 0 && c.len() == 2 && c.ends_with(':') && c.as_bytes()[0].is_ascii_alphabetic() {
            continue;
        }
        parts.push(clean_component(c));
    }
    if parts.is_empty() { None } else { Some(parts) }
}

pub enum DecodeOutcome {
    Done,
    Cancelled,
}

/// Decode `{part}` (the raw compressed member) into `dest`, verifying size and CRC-32.
/// Blocking; run on a blocking thread. Writes `{dest}.unzipping` then renames, so a crash never
/// leaves a half-written file under the final name.
pub fn decode_member(part: &Path, dest: &Path, spec: &ZipEntrySpec, cancel: &CancellationToken) -> Result<DecodeOutcome, String> {
    let tmp = std::path::PathBuf::from(format!("{}.unzipping", dest.display()));
    let result = (|| -> Result<DecodeOutcome, String> {
        let src = std::io::BufReader::with_capacity(1 << 20, std::fs::File::open(part).map_err(|e| format!("Disk error: {e}"))?);
        let mut reader: Box<dyn Read> = match spec.method {
            METHOD_DEFLATE => Box::new(flate2::read::DeflateDecoder::new(src)),
            METHOD_BZIP2 => Box::new(bzip2::read::BzDecoder::new(src)),
            METHOD_STORED => Box::new(src),
            m => return Err(format!("compression method {m} isn't supported")),
        };
        let out = std::fs::File::create(&tmp).map_err(|e| format!("Disk error: {e}"))?;
        let mut w = std::io::BufWriter::with_capacity(1 << 20, out);
        let mut crc = flate2::Crc::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut written: u64 = 0;
        loop {
            if cancel.is_cancelled() {
                return Ok(DecodeOutcome::Cancelled);
            }
            let n = reader.read(&mut buf).map_err(|e| format!("corrupt data: {e}"))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > spec.size {
                return Err("decoded data is larger than expected".into());
            }
            crc.update(&buf[..n]);
            w.write_all(&buf[..n]).map_err(|e| format!("Disk error: {e}"))?;
        }
        if written != spec.size {
            return Err(format!("decoded {} of {} bytes", written, spec.size));
        }
        if crc.sum() != spec.crc32 {
            return Err("CRC check failed".into());
        }
        let f = w.into_inner().map_err(|e| format!("Disk error: {e}"))?;
        super::fsync::sync_all_blocking(&f).map_err(|e| format!("Disk error: {e}"))?;
        drop(f);
        #[cfg(windows)]
        if dest.exists() {
            let _ = std::fs::remove_file(dest);
        }
        std::fs::rename(&tmp, dest).map_err(|e| format!("Disk error: {e}"))?;
        Ok(DecodeOutcome::Done)
    })();
    if !matches!(result, Ok(DecodeOutcome::Done)) {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}
