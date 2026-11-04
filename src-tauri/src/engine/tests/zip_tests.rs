use super::mock_server::*;
use super::support::*;
use super::transfer_tests::{deps, http_job};
use crate::engine::transfer::*;
use crate::engine::types::*;
use crate::engine::zip_remote::*;
use std::io::Write;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

const T: Duration = Duration::from_secs(5);

struct Member {
    name: &'static str,
    data: Vec<u8>,
    method: CompressionMethod,
}

fn text(n: usize) -> Vec<u8> {
    (0..n).map(|i| b"the quick brown fox jumps over the lazy dog\n"[i % 44]).collect()
}

fn build_zip(members: &[Member], dirs: &[&str], large: bool) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for d in dirs {
        w.add_directory(*d, SimpleFileOptions::default()).unwrap();
    }
    for m in members {
        let o = SimpleFileOptions::default().compression_method(m.method).large_file(large);
        w.start_file(m.name, o).unwrap();
        w.write_all(&m.data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

fn sample() -> Vec<Member> {
    vec![
        Member { name: "Show/S01/e1.mkv", data: pattern(1_000_000), method: CompressionMethod::Stored },
        Member { name: "Show/S01/notes.txt", data: text(600_000), method: CompressionMethod::Deflated },
        Member { name: "Show/Ελληνικά.srt", data: text(5_000), method: CompressionMethod::Bzip2 },
        Member { name: "Show/empty.txt", data: Vec::new(), method: CompressionMethod::Deflated },
        Member { name: "Show/empty-stored.bin", data: Vec::new(), method: CompressionMethod::Stored },
    ]
}

async fn serve(bytes: Vec<u8>) -> MockServer {
    MockServer::start(MockOpts { size: bytes.len(), ranges: true, data: Some(bytes), ..Default::default() }).await
}

fn entry_job(dir: &tempfile::TempDir, url: String, e: &ZipEntry, archive_size: u64) -> Job {
    let name = e.path.replace('/', "_");
    let mut j = http_job(dir, &name, url, e.compressed_size as i64);
    j.kind = JobKind::ZipEntry { entry: e.spec(archive_size) };
    j
}

async fn run(job: Job) -> (Result<TransferOutcome, TransferError>, Vec<TransferUpdate>) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let r = run_transfer(job, deps(no_refresh()), CancellationToken::new(), tx).await;
    let mut ups = Vec::new();
    while let Ok(u) = rx.try_recv() {
        ups.push(u);
    }
    (r, ups)
}

async fn download_all(bytes: Vec<u8>, members: &[Member]) {
    let s = serve(bytes.clone()).await;
    let listing = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await.unwrap();
    assert_eq!(listing.archive_size, bytes.len() as u64);
    let dir = tempfile::tempdir().unwrap();
    for m in members {
        let e = listing.entries.iter().find(|e| e.path == m.name).unwrap_or_else(|| panic!("{} missing", m.name));
        assert_eq!(e.unsupported, None, "{}", m.name);
        let j = entry_job(&dir, s.url(), e, listing.archive_size);
        let (r, ups) = run(j.clone()).await;
        assert_eq!(r, Ok(TransferOutcome::Finished), "{}", m.name);
        assert_eq!(read(&j.destination), m.data, "{}", m.name);
        assert!(!j.part_path().exists());
        let compressed = !e.spec(0).is_stored();
        assert_eq!(ups.contains(&TransferUpdate::Unpacking), compressed, "{}", m.name);
    }
    // The archive itself was never fetched in full: no request covers it from 0.
    assert!(s.ranges().iter().all(|&(a, b)| !(a == 0 && b + 1 == bytes.len() as u64)));
}

#[tokio::test]
async fn listing_reads_names_dirs_and_methods() {
    let bytes = build_zip(&sample(), &["Show/", "Show/Extras/"], false);
    let s = serve(bytes.clone()).await;
    let l = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await.unwrap();
    let names: Vec<_> = l.entries.iter().map(|e| e.path.as_str()).collect();
    assert!(names.contains(&"Show/Extras/"));
    assert!(names.contains(&"Show/Ελληνικά.srt"));
    let dir = l.entries.iter().find(|e| e.path == "Show/Extras/").unwrap();
    assert!(dir.is_dir);
    let mkv = l.entries.iter().find(|e| e.path == "Show/S01/e1.mkv").unwrap();
    assert_eq!((mkv.method, mkv.size, mkv.compressed_size), (METHOD_STORED, 1_000_000, 1_000_000));
    let txt = l.entries.iter().find(|e| e.path == "Show/S01/notes.txt").unwrap();
    assert_eq!(txt.method, METHOD_DEFLATE);
    assert!(txt.compressed_size < txt.size);
    // Only small tail / directory reads, never the bulk of the archive.
    let fetched: u64 = s.ranges().iter().map(|(a, b)| b - a + 1).sum();
    assert!(fetched < 100_000, "fetched {fetched} bytes to list the archive");
}

#[tokio::test]
async fn members_download_without_the_archive() {
    let m = sample();
    download_all(build_zip(&m, &["Show/"], false), &m).await;
}

#[tokio::test]
async fn zip64_members_download() {
    let m = sample();
    download_all(build_zip(&m, &[], true), &m).await;
}

#[tokio::test]
async fn self_extractor_prefix_is_handled() {
    let m = sample();
    let mut bytes = pattern(4321);
    bytes.extend(build_zip(&m, &[], false));
    download_all(bytes, &m).await;
}

#[tokio::test]
async fn crc_mismatch_discards_the_download() {
    let m = sample();
    let bytes = build_zip(&m, &[], false);
    let s = serve(bytes).await;
    let l = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await.unwrap();
    let mut e = l.entries.iter().find(|e| e.path == "Show/S01/notes.txt").unwrap().clone();
    e.crc32 ^= 1;
    let dir = tempfile::tempdir().unwrap();
    let j = entry_job(&dir, s.url(), &e, l.archive_size);
    let (r, _) = run(j.clone()).await;
    assert!(matches!(r, Err(TransferError::Transient(ref m)) if m.contains("CRC")), "{r:?}");
    assert!(!j.part_path().exists());
    assert!(!std::path::Path::new(&j.destination).exists());
}

#[tokio::test]
async fn changed_archive_is_fatal() {
    let m = sample();
    let bytes = build_zip(&m, &[], false);
    let s = serve(bytes.clone()).await;
    let l = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await.unwrap();
    let mut grown = bytes;
    grown.extend_from_slice(b"extra");
    s.set_data(grown);
    let dir = tempfile::tempdir().unwrap();
    let e = l.entries.iter().find(|e| e.path == "Show/S01/e1.mkv").unwrap();
    let (r, _) = run(entry_job(&dir, s.url(), e, l.archive_size)).await;
    assert!(matches!(r, Err(TransferError::Fatal(_))), "{r:?}");
}

#[tokio::test]
async fn expired_link_is_refreshed() {
    let m = sample();
    let s = serve(build_zip(&m, &[], false)).await;
    let l = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await.unwrap();
    let old = s.url();
    let fresh = s.rotate();
    let dir = tempfile::tempdir().unwrap();
    let e = l.entries.iter().find(|e| e.path == "Show/S01/e1.mkv").unwrap();
    let j = entry_job(&dir, old, e, l.archive_size);
    let refresher = FakeRefresher::new(move || Ok(fresh.clone()));
    let (tx, _rx) = mpsc::unbounded_channel();
    let r = run_transfer(j.clone(), deps(refresher.clone()), CancellationToken::new(), tx).await;
    assert_eq!(r, Ok(TransferOutcome::Finished));
    assert_eq!(refresher.calls(), 1);
    assert_eq!(read(&j.destination), m[0].data);
}

#[tokio::test]
async fn server_without_ranges_is_reported() {
    let bytes = build_zip(&sample(), &[], false);
    let s = MockServer::start(MockOpts { size: bytes.len(), ranges: false, data: Some(bytes), ..Default::default() }).await;
    let r = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await;
    assert_eq!(r, Err(ZipError::NoRanges));
}

#[tokio::test]
async fn non_zip_is_rejected() {
    let s = MockServer::start(MockOpts { size: 200_000, ranges: true, ..Default::default() }).await;
    let r = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await;
    assert!(matches!(r, Err(ZipError::Format(_))), "{r:?}");
}

#[tokio::test]
async fn encrypted_and_unknown_methods_are_flagged() {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    w.start_file("secret.txt", SimpleFileOptions::default()).unwrap();
    w.write_all(b"hidden").unwrap();
    w.start_file("x.zst", SimpleFileOptions::default().compression_method(CompressionMethod::Zstd)).unwrap();
    w.write_all(&text(1000)).unwrap();
    let mut bytes = w.finish().unwrap().into_inner();
    // Mark the first member as encrypted in the central directory (general-purpose flag bit 0).
    let cd = bytes.windows(4).position(|w| w == [0x50, 0x4b, 0x01, 0x02]).unwrap();
    bytes[cd + 8] |= 1;
    let s = serve(bytes).await;
    let l = read_listing(&build_client(&fast_transfer_cfg()), &s.url(), T).await.unwrap();
    assert_eq!(l.entries[0].unsupported.as_deref(), Some("encrypted"));
    assert!(l.entries[1].unsupported.as_deref().unwrap().contains("Zstandard"));
}

#[test]
fn unsafe_paths_are_rejected_or_cleaned() {
    assert_eq!(safe_relative_path("../etc/passwd"), None);
    assert_eq!(safe_relative_path("a/../../b"), None);
    assert_eq!(safe_relative_path("/abs/file"), Some(vec!["abs".into(), "file".into()]));
    assert_eq!(safe_relative_path("C:\\win\\x.txt"), Some(vec!["win".into(), "x.txt".into()]));
    assert_eq!(safe_relative_path("a/./b:c?.txt"), Some(vec!["a".into(), "b_c_.txt".into()]));
    assert_eq!(safe_relative_path("CON.txt"), Some(vec!["_CON.txt".into()]));
    assert_eq!(safe_relative_path("dots..."), Some(vec!["dots..._".into()]));
    assert_eq!(safe_relative_path("/"), None);
}
