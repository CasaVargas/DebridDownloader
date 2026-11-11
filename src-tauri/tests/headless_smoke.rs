//! Smoke test for the `debriddownloader-headless` binary: start it with no display on a configured
//! port and get 200 from `/health`.
//!
//! The binary only exists with the `headless` feature:
//! `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features headless --test headless_smoke`
#![cfg(feature = "headless")]

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct KillOnDrop(Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

#[tokio::test]
async fn headless_binary_serves_health_without_a_display() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();
    let mut child = KillOnDrop(
        Command::new(env!("CARGO_BIN_EXE_debriddownloader-headless"))
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env("DEBRIDDOWNLOADER_PORT", port.to_string())
            .env("DEBRIDDOWNLOADER_DATA_DIR", dir.path())
            .env("DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN", "smoke-token")
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start the headless binary"),
    );

    let base = format!("http://127.0.0.1:{}", port);
    let client = reqwest::Client::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    let health = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            panic!("headless binary exited early: {}", status);
        }
        match client.get(format!("{}/health", base)).send().await {
            Ok(resp) => break resp,
            Err(_) if Instant::now() < deadline => tokio::time::sleep(Duration::from_millis(100)).await,
            Err(e) => panic!("no answer on {}: {}", base, e),
        }
    };
    assert_eq!(health.status(), 200);

    let denied = client.get(format!("{}/api/downloads", base)).send().await.unwrap();
    assert_eq!(denied.status(), 401);
    let allowed = client.get(format!("{}/api/downloads", base)).bearer_auth("smoke-token").send().await.unwrap();
    assert_eq!(allowed.status(), 200);
    assert_eq!(allowed.text().await.unwrap(), "[]");

    // SIGTERM (docker stop) shuts it down cleanly and checkpoints the engine.
    #[cfg(unix)]
    {
        let pid = child.0.id().to_string();
        assert!(Command::new("kill").args(["-TERM", &pid]).status().unwrap().success());
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                assert!(status.success(), "exit status {}", status);
                break;
            }
            assert!(Instant::now() < deadline, "did not exit on SIGTERM");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}
