use std::time::Duration;

#[derive(Debug, Clone)]
pub struct TransferConfig {
    pub segments_per_file: u32,
    pub min_segment: u64,
    pub split_threshold: u64,
    pub connect_timeout: Duration,
    pub idle_timeout: Duration,
    pub segment_retries: u32,
    pub retry_base: Duration,
    pub checkpoint_bytes: u64,
    pub checkpoint_interval: Duration,
    pub progress_interval: Duration,
}

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            segments_per_file: 4,
            min_segment: 8 * 1024 * 1024,
            split_threshold: 16 * 1024 * 1024,
            connect_timeout: Duration::from_secs(15),
            idle_timeout: Duration::from_secs(30),
            segment_retries: 5,
            retry_base: Duration::from_secs(1),
            checkpoint_bytes: 8 * 1024 * 1024,
            checkpoint_interval: Duration::from_secs(2),
            progress_interval: Duration::from_millis(250),
        }
    }
}
