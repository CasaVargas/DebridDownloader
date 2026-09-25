//! Global token bucket shared by every segment of every job.
//! Debt model: callers always take their bytes, then sleep off any deficit.
//! Burst capacity is one second of rate.
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration, Instant};

pub struct Limiter {
    bucket: Mutex<Bucket>,
}

struct Bucket {
    rate: Option<u64>,
    tokens: f64,
    last: Instant,
}

impl Limiter {
    pub fn new(rate: Option<u64>) -> Self {
        Self { bucket: Mutex::new(Bucket { rate, tokens: 0.0, last: Instant::now() }) }
    }

    pub async fn set_rate(&self, rate: Option<u64>) {
        let mut b = self.bucket.lock().await;
        b.rate = rate;
        b.tokens = 0.0;
        b.last = Instant::now();
    }

    pub async fn acquire(&self, n: usize) {
        let wait = {
            let mut b = self.bucket.lock().await;
            let Some(rate) = b.rate else { return };
            let rate = rate.max(1) as f64;
            let now = Instant::now();
            b.tokens = (b.tokens + now.duration_since(b.last).as_secs_f64() * rate).min(rate);
            b.last = now;
            b.tokens -= n as f64;
            if b.tokens >= 0.0 {
                return;
            }
            Duration::from_secs_f64(-b.tokens / rate)
        };
        sleep(wait).await;
    }
}
