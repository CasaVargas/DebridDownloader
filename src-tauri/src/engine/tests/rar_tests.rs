//! Remote RAR listing + member download. RAR5 fixtures were made with RAR 7.00 from the files in
//! `expected()`; RAR4 archives are built here because current RAR can't write RAR4 anymore.
use super::mock_server::*;
use super::support::*;
use super::transfer_tests::{deps, http_job};
use crate::engine::rar_remote::*;
use crate::engine::transfer::*;
use crate::engine::types::*;
use crate::engine::zip_remote::{ZipEntry, ZipError, ZipListing};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const T: Duration = Duration::from_secs(5);
const FIX: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/engine/tests/fixtures/");

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!("{FIX}{name}")).unwrap()
}

/// The files inside the fixtures (same generator that made them).
fn expected() -> Vec<(String, Vec<u8>)> {
    let mut v = vec![
        ("Show/S01/e1.mkv".to_string(), pattern(40_000)),
        ("Show/S01/notes.txt".to_string(), b"the quick brown fox jumps over the lazy dog\n".repeat(300)),
        ("Show/Ελληνικά.srt".to_string(), "Γεια σου κόσμε\n".repeat(50).into_bytes()),
        ("Show/empty.txt".to_string(), Vec::new()),
    ];
    for i in 0..40 {
        v.push((format!("Show/S01/small{i:02}.txt"), format!("file {i} ").repeat(i + 1).into_bytes()));
    }
    v
}

async fn serve(bytes: Vec<u8>) -> MockServer {
    MockServer::start(MockOpts { size: bytes.len(), ranges: true, data: Some(bytes), ..Default::default() }).await
}

async fn list(s: &MockServer, window: u64) -> Result<ZipListing, ZipError> {
    read_listing_with_window(&build_client(&fast_transfer_cfg()), &s.url(), T, window, None).await
}

async fn download(s: &MockServer, e: &ZipEntry, archive_size: u64, dir: &tempfile::TempDir) -> (Result<TransferOutcome, TransferError>, Vec<u8>) {
    let name = e.path.replace('/', "_");
    let mut j = http_job(dir, &name, s.url(), e.compressed_size as i64);
    j.kind = JobKind::ZipEntry { entry: e.spec(archive_size) };
    let (tx, _rx) = mpsc::unbounded_channel();
    let r = run_transfer(j.clone(), deps(no_refresh()), CancellationToken::new(), tx).await;
    let got = std::fs::read(&j.destination).unwrap_or_default();
    (r, got)
}

async fn check_all(bytes: Vec<u8>, window: u64) -> MockServer {
    let s = serve(bytes).await;
    let l = list(&s, window).await.unwrap();
    let dir = tempfile::tempdir().unwrap();
    for (path, data) in expected() {
        let e = l.entries.iter().find(|e| e.path == path).unwrap_or_else(|| panic!("{path} missing from {:?}", l.entries.iter().map(|e| &e.path).collect::<Vec<_>>()));
        assert_eq!(e.unsupported, None, "{path}");
        assert_eq!(e.size, data.len() as u64, "{path}");
        let (r, got) = download(&s, e, l.archive_size, &dir).await;
        assert_eq!(r, Ok(TransferOutcome::Finished), "{path}");
        assert_eq!(got, data, "{path}");
    }
    let d = l.entries.iter().find(|e| e.path == "Show/Empty Dir/").expect("empty dir listed");
    assert!(d.is_dir);
    s
}

#[tokio::test]
async fn rar5_store_lists_and_downloads() {
    check_all(fixture("rar5_store.rar"), 512 * 1024).await;
}

#[tokio::test]
async fn small_files_share_requests() {
    let bytes = fixture("rar5_store.rar");
    let s = serve(bytes).await;
    let l = list(&s, 16 * 1024).await.unwrap();
    // Probe + windows: far fewer requests than the ~47 headers walked.
    let reqs = s.ranges().len();
    assert!(l.entries.len() >= 45);
    assert!(reqs < l.entries.len() / 2, "{reqs} requests for {} entries", l.entries.len());
}

#[tokio::test]
async fn tiny_window_still_lists_everything() {
    check_all(fixture("rar5_store.rar"), 64).await;
}

#[tokio::test]
async fn rar5_compressed_members_are_flagged() {
    let s = serve(fixture("rar5_compressed.rar")).await;
    let l = list(&s, 512 * 1024).await.unwrap();
    let notes = l.entries.iter().find(|e| e.path == "Show/S01/notes.txt").unwrap();
    assert!(notes.unsupported.as_deref().unwrap().contains("store"), "{:?}", notes.unsupported);
}

#[tokio::test]
async fn rar5_encrypted_headers_are_reported() {
    let s = serve(fixture("rar5_encrypted_headers.rar")).await;
    assert!(matches!(list(&s, 512 * 1024).await, Err(ZipError::Unsupported(m)) if m.contains("encrypted")));
}

#[tokio::test]
async fn rar5_encrypted_files_are_flagged() {
    let s = serve(fixture("rar5_encrypted_files.rar")).await;
    let l = list(&s, 512 * 1024).await.unwrap();
    assert_eq!(l.entries[0].unsupported.as_deref(), Some("encrypted"));
}

#[tokio::test]
async fn rar5_split_members_are_flagged() {
    let s = serve(fixture("rar5_split.part1.rar")).await;
    let l = list(&s, 512 * 1024).await.unwrap();
    let e = l.entries.iter().find(|e| e.path == "Show/S01/e1.mkv").unwrap();
    assert!(e.unsupported.as_deref().unwrap().contains("volumes"));
}

#[tokio::test]
async fn not_a_rar_is_rejected() {
    let s = MockServer::start(MockOpts { size: 5000, ranges: true, ..Default::default() }).await;
    assert!(matches!(list(&s, 512 * 1024).await, Err(ZipError::Format(_))));
}

// ── RAR4 (built by hand: store mode only, which is all we can download anyway) ──

/// Encode a name the way RAR 2.x–4.x stores Unicode names: ascii part, NUL, then high byte 0 and
/// groups of four two-byte characters (flag byte 0b10101010).
fn rar4_unicode(name: &str) -> Vec<u8> {
    let ascii: Vec<u8> = name.chars().map(|c| if c.is_ascii() { c as u8 } else { b'_' }).collect();
    let units: Vec<u16> = name.encode_utf16().collect();
    let mut out = ascii;
    out.push(0);
    out.push(0); // high byte
    for chunk in units.chunks(4) {
        out.push(0xAA);
        for u in chunk {
            out.extend_from_slice(&u.to_le_bytes());
        }
    }
    out
}

fn rar4(files: &[(&str, &[u8])], dirs: &[&str]) -> Vec<u8> {
    let mut out = b"Rar!\x1a\x07\x00".to_vec();
    // Main archive header: crc(2) type(1) flags(2) size(2) + 6 reserved bytes.
    out.extend_from_slice(&[0, 0, 0x73, 0, 0, 13, 0, 0, 0, 0, 0, 0, 0]);
    let mut push = |name: &str, data: &[u8], dir: bool| {
        let unicode = !name.is_ascii();
        let raw = if unicode { rar4_unicode(name) } else { name.as_bytes().to_vec() };
        let mut flags: u16 = 0x8000 | 0x0100; // has data size; large-file fields present
        if unicode {
            flags |= 0x0200;
        }
        if dir {
            flags |= 0x00e0;
        }
        let head_size = 40 + raw.len();
        let mut h = Vec::new();
        h.extend_from_slice(&[0, 0, 0x74]);
        h.extend_from_slice(&flags.to_le_bytes());
        h.extend_from_slice(&(head_size as u16).to_le_bytes());
        h.extend_from_slice(&(data.len() as u32).to_le_bytes()); // packed
        h.extend_from_slice(&(data.len() as u32).to_le_bytes()); // unpacked
        h.push(2); // host OS: Windows
        let mut crc = flate2::Crc::new();
        crc.update(data);
        h.extend_from_slice(&crc.sum().to_le_bytes());
        h.extend_from_slice(&0u32.to_le_bytes()); // time
        h.push(29); // version
        h.push(0x30); // method: store
        h.extend_from_slice(&(raw.len() as u16).to_le_bytes());
        h.extend_from_slice(&(if dir { 0x10u32 } else { 0x20 }).to_le_bytes());
        h.extend_from_slice(&0u32.to_le_bytes()); // high packed
        h.extend_from_slice(&0u32.to_le_bytes()); // high unpacked
        h.extend_from_slice(&raw);
        assert_eq!(h.len(), head_size);
        out.extend_from_slice(&h);
        out.extend_from_slice(data);
    };
    for d in dirs {
        push(d, &[], true);
    }
    for (n, d) in files {
        push(n, d, false);
    }
    out.extend_from_slice(&[0, 0, 0x7b, 0, 0x40, 7, 0]); // end of archive
    out
}

#[tokio::test]
async fn rar4_store_lists_and_downloads() {
    let exp = expected();
    let files: Vec<(String, Vec<u8>)> = exp.iter().map(|(p, d)| (p.replace('/', "\\"), d.clone())).collect();
    let refs: Vec<(&str, &[u8])> = files.iter().map(|(p, d)| (p.as_str(), d.as_slice())).collect();
    let bytes = rar4(&refs, &["Show\\Empty Dir"]);
    check_all(bytes.clone(), 512 * 1024).await;
    check_all(bytes, 100).await;
}

#[test]
fn rar4_unicode_names_decode() {
    let enc = rar4_unicode("Ελληνικά/ταινία.mkv");
    let z = enc.iter().position(|&c| c == 0).unwrap();
    assert_eq!(decode_rar4_unicode(&enc[..z], &enc[z + 1..]), "Ελληνικά/ταινία.mkv");
    // Mode 3 (copy from the ASCII name) as WinRAR writes for mostly-ASCII names.
    assert_eq!(decode_rar4_unicode(b"abcdef", &[0, 0xC0, 4]), "abcdef");
}

#[tokio::test]
async fn large_files_cost_one_small_read_each() {
    // Ten 300 KB files with a 64 KB window: after each jump only a header-sized read is needed.
    let data: Vec<Vec<u8>> = (0..10).map(|i| pattern(300_000 + i)).collect();
    let names: Vec<String> = (0..10).map(|i| format!("big{i}.bin")).collect();
    let refs: Vec<(&str, &[u8])> = names.iter().zip(&data).map(|(n, d)| (n.as_str(), d.as_slice())).collect();
    let s = serve(rar4(&refs, &[])).await;
    let seen = std::sync::Mutex::new(Vec::new());
    let report = |n: usize, pos: u64, _total: u64| seen.lock().unwrap().push((n, pos));
    let l = read_listing_with_window(&build_client(&fast_transfer_cfg()), &s.url(), T, 64 * 1024, Some(&report)).await.unwrap();
    assert_eq!(l.entries.len(), 10);
    let fetched: u64 = s.ranges().iter().map(|(a, b)| b - a + 1).sum();
    assert!(fetched < 64 * 1024 + 10 * 17 * 1024, "fetched {fetched} bytes");
    assert!(!seen.lock().unwrap().is_empty());
}
