//! Restart-resume test for the `debriddownloader-headless` binary: queue a download over HTTP,
//! kill the process mid-download, start it again on the same data dir and check the job resumes
//! from `downloads.json` (not from byte 0) to a complete, byte-identical file.
//!
//! The mock CDN is throttled for the first run, so the kill always lands mid-download: the test
//! waits until `downloads.json` holds a checkpoint with progress on every segment, and the
//! throttle makes finishing the file in that time impossible.
//!
//! The binary only exists with the `headless` feature:
//! `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features headless --test headless_restart`
#![cfg(feature = "headless")]

#[path = "../src/engine/tests/mock_server.rs"]
#[allow(dead_code)]
mod mock_server;

use mock_server::{free_port, MockOpts, MockServer};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const TOKEN: &str = "restart-token";
/// 16 MiB over 4 segments at 16 KiB per 100 ms each is ~25 s throttled; the kill comes after the
/// first checkpoint (~2 s).
const SIZE: usize = 16 * 1024 * 1024;

struct KillOnDrop(Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn(data_dir: &Path, port: u16) -> KillOnDrop {
    KillOnDrop(
        Command::new(env!("CARGO_BIN_EXE_debriddownloader-headless"))
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env("DEBRIDDOWNLOADER_PORT", port.to_string())
            .env("DEBRIDDOWNLOADER_DATA_DIR", data_dir)
            .env("DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN", TOKEN)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start the headless binary"),
    )
}

async fn wait_healthy(child: &mut KillOnDrop, client: &reqwest::Client, base: &str) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            panic!("headless binary exited early: {}", status);
        }
        match client.get(format!("{}/health", base)).send().await {
            Ok(resp) if resp.status() == 200 => return,
            _ if Instant::now() < deadline => tokio::time::sleep(Duration::from_millis(100)).await,
            other => panic!("no answer on {}: {:?}", base, other.map(|r| r.status())),
        }
    }
}

async fn list(client: &reqwest::Client, base: &str) -> Vec<serde_json::Value> {
    let resp = client.get(format!("{}/api/downloads", base)).bearer_auth(TOKEN).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    resp.json().await.unwrap()
}

/// The persisted job's segments as `(start, end, done)`, if `downloads.json` has them yet.
fn persisted_segments(data_dir: &Path, id: &str) -> Option<Vec<(u64, u64, u64)>> {
    let raw = std::fs::read(data_dir.join("downloads.json")).ok()?;
    let doc: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let jobs = doc["jobs"].as_array()?;
    let job = jobs.iter().find(|j| j["id"] == id)?;
    let segs = job["segments"].as_array()?;
    Some(
        segs.iter()
            .map(|s| (s["start"].as_u64().unwrap(), s["end"].as_u64().unwrap(), s["done"].as_u64().unwrap()))
            .collect(),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn killed_headless_process_resumes_download_from_downloads_json() {
    let cdn = MockServer::start(MockOpts {
        size: SIZE,
        ranges: true,
        chunk_delay: Some(Duration::from_millis(100)),
        ..Default::default()
    })
    .await;
    let data = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let client = reqwest::Client::new();

    // ── First run: queue the download over HTTP, kill once a checkpoint is on disk ──
    let port = free_port();
    let base = format!("http://127.0.0.1:{}", port);
    let mut first = spawn(data.path(), port);
    wait_healthy(&mut first, &client, &base).await;

    let resp = client
        .post(format!("{}/api/downloads", base))
        .bearer_auth(TOKEN)
        .json(&serde_json::json!({
            "links": [{ "filename": "big.bin", "filesize": SIZE, "download": cdn.url(), "streamable": null }],
            "destinationFolder": out.path().to_string_lossy(),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "{}", resp.text().await.unwrap_or_default());
    let ids: Vec<String> = resp.json().await.unwrap();
    assert_eq!(ids.len(), 1);
    let id = ids[0].clone();

    // Mid-download, deterministically: every segment has durable progress in downloads.json.
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(segs) = persisted_segments(data.path(), &id) {
            if !segs.is_empty() && segs.iter().all(|&(_, _, done)| done > 0) {
                break;
            }
        }
        assert!(first.0.try_wait().unwrap().is_none(), "headless binary exited during the download");
        assert!(Instant::now() < deadline, "no checkpoint in downloads.json; list: {:?}", list(&client, &base).await);
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let jobs = list(&client, &base).await;
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0]["status"], "Downloading", "still in flight before the kill");

    // Hard kill: no graceful shutdown, no final checkpoint.
    first.0.kill().unwrap();
    first.0.wait().unwrap();
    drop(first);

    let segs = persisted_segments(data.path(), &id).expect("job persisted in downloads.json");
    let persisted_done: u64 = segs.iter().map(|&(_, _, done)| done).sum();
    assert!(persisted_done > 0 && persisted_done < SIZE as u64, "killed mid-download ({persisted_done} of {SIZE})");
    let saved = std::fs::read_to_string(data.path().join("downloads.json")).unwrap();
    assert!(saved.contains("\"Downloading\""), "job persisted as in-flight");
    let dest = out.path().join("big.bin");
    assert!(!dest.exists(), "file not finished before the kill");

    // ── Second run: same data dir, new port, unthrottled CDN ──
    let before = cdn.ranges().len();
    cdn.update(|o| o.chunk_delay = None);
    let port = free_port();
    let base = format!("http://127.0.0.1:{}", port);
    let mut second = spawn(data.path(), port);
    wait_healthy(&mut second, &client, &base).await;

    let deadline = Instant::now() + Duration::from_secs(60);
    let job = loop {
        let jobs = list(&client, &base).await;
        assert_eq!(jobs.len(), 1, "the job came back from downloads.json");
        assert_eq!(jobs[0]["id"], id.as_str());
        let status = &jobs[0]["status"];
        if status == "Completed" {
            break jobs[0].clone();
        }
        assert!(status.is_string(), "job failed after restart: {}", status);
        assert!(second.0.try_wait().unwrap().is_none(), "headless binary exited during the resume");
        assert!(Instant::now() < deadline, "did not complete after restart: {}", jobs[0]);
        tokio::time::sleep(Duration::from_millis(100)).await;
    };

    // Correct final size and content.
    assert_eq!(job["downloaded_bytes"].as_i64(), Some(SIZE as i64));
    let got = std::fs::read(&dest).expect("final file exists");
    assert_eq!(got.len(), SIZE, "final file size");
    assert!(got == cdn.data(), "final file content matches the CDN");

    // Resumed, not restarted: the second run's ranged requests (ignoring a `bytes=0-0` probe)
    // never start at byte 0, each starts at or past the persisted checkpoint of its segment, and
    // together they fetch less than the whole file.
    let resumed: Vec<(u64, u64)> = cdn.ranges()[before..].iter().copied().filter(|&r| r != (0, 0)).collect();
    assert!(!resumed.is_empty(), "second run fetched ranges");
    for &(start, end) in &resumed {
        assert!(start > 0, "second run re-requested from byte 0: {:?}", resumed);
        let seg = segs.iter().find(|&&(s, e, _)| start >= s && start <= e).expect("range inside a persisted segment");
        assert!(start >= seg.0 + seg.2, "range {}-{} starts before the checkpoint of segment {:?}", start, end, seg);
    }
    let refetched: u64 = resumed.iter().map(|&(s, e)| e + 1 - s).sum();
    assert!(refetched < SIZE as u64, "second run fetched {refetched} bytes of {SIZE}");
    assert!(
        refetched <= SIZE as u64 - persisted_done,
        "second run re-fetched checkpointed bytes ({refetched} > {} remaining)",
        SIZE as u64 - persisted_done
    );
}
