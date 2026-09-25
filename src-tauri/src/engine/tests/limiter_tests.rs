use crate::engine::limiter::Limiter;
use std::sync::Arc;
use tokio::time::{Duration, Instant};

#[tokio::test(start_paused = true)]
async fn unlimited_never_waits() {
    let l = Limiter::new(None);
    let t = Instant::now();
    for _ in 0..1000 {
        l.acquire(1_000_000).await;
    }
    assert_eq!(t.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn holds_rate_within_15_percent() {
    let l = Limiter::new(Some(1000)); // 1000 B/s
    let t = Instant::now();
    for _ in 0..30 {
        l.acquire(100).await; // 3000 bytes total
    }
    let secs = t.elapsed().as_secs_f64();
    assert!((2.55..=3.45).contains(&secs), "took {secs}s");
}

#[tokio::test(start_paused = true)]
async fn rate_is_shared_across_tasks() {
    let l = Arc::new(Limiter::new(Some(1000)));
    let t = Instant::now();
    let mut hs = Vec::new();
    for _ in 0..3 {
        let l = l.clone();
        hs.push(tokio::spawn(async move {
            for _ in 0..10 {
                l.acquire(100).await;
            }
        }));
    }
    for h in hs {
        h.await.unwrap();
    }
    let secs = t.elapsed().as_secs_f64();
    assert!((2.55..=3.45).contains(&secs), "took {secs}s");
}

#[tokio::test(start_paused = true)]
async fn set_rate_applies_live() {
    let l = Limiter::new(Some(100));
    l.set_rate(None).await;
    let t = Instant::now();
    l.acquire(1_000_000).await;
    assert_eq!(t.elapsed(), Duration::ZERO);
}
