use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub use crate::providers::types::LinkSource;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum JobState {
    Pending,
    Downloading,
    Paused,
    Extracting,
    Completed,
    Failed(String),
    Cancelled,
}

impl JobState {
    pub fn is_terminal(&self) -> bool {
        matches!(self, JobState::Completed | JobState::Failed(_) | JobState::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum JobKind {
    Http,
    Remote { rclone_dest: String },
    Symlink,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PostStage {
    None,
    Extract,
    Organize,
    Done,
}

/// Inclusive byte range `[start, end]`; `done` = bytes durable on disk from `start`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct SegmentState {
    pub start: u64,
    pub end: u64,
    pub done: u64,
}

impl SegmentState {
    pub fn len(&self) -> u64 {
        self.end + 1 - self.start
    }
    #[cfg(test)]
    pub fn pos(&self) -> u64 {
        self.start + self.done
    }
    #[cfg(test)]
    pub fn remaining(&self) -> u64 {
        self.len().saturating_sub(self.done)
    }
    pub fn is_done(&self) -> bool {
        self.done >= self.len()
    }
}

fn yes() -> bool {
    true
}
fn default_max_segments() -> u32 {
    16
}
fn post_none() -> PostStage {
    PostStage::None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Job {
    pub id: String,
    pub kind: JobKind,
    pub filename: String,
    /// Final path. The work file is `{destination}.part`.
    pub destination: String,
    #[serde(default)]
    pub source: LinkSource,
    /// Last resolved URL (may be expired).
    pub url: String,
    pub total_bytes: i64,
    #[serde(default)]
    pub segments: Vec<SegmentState>,
    #[serde(default = "yes")]
    pub resumable: bool,
    #[serde(default = "default_max_segments")]
    pub max_segments: u32,
    pub state: JobState,
    #[serde(default)]
    pub attempt: u32,
    #[serde(default)]
    pub retry_at: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default = "post_none")]
    pub post: PostStage,
    #[serde(default)]
    pub size_resets: u32,
    #[serde(default)]
    pub batch_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Job {
    pub fn from_new(n: NewJob, id: String, now: i64) -> Job {
        Job {
            id,
            kind: n.kind,
            filename: n.filename,
            destination: n.destination,
            source: n.source,
            url: n.url,
            total_bytes: n.total_bytes,
            segments: Vec::new(),
            resumable: true,
            max_segments: default_max_segments(),
            state: JobState::Pending,
            attempt: 0,
            retry_at: None,
            error: None,
            post: PostStage::None,
            size_resets: 0,
            batch_id: n.batch_id,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn part_path(&self) -> PathBuf {
        PathBuf::from(format!("{}.part", self.destination))
    }

    /// Durable bytes on disk (sum of segment progress).
    pub fn downloaded(&self) -> u64 {
        self.segments.iter().map(|s| s.done.min(s.len())).sum()
    }

    pub fn remote_dest(&self) -> Option<&str> {
        match &self.kind {
            JobKind::Remote { rclone_dest } => Some(rclone_dest),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewJob {
    pub kind: JobKind,
    pub filename: String,
    pub destination: String,
    pub source: LinkSource,
    pub url: String,
    pub total_bytes: i64,
    pub batch_id: String,
}

#[derive(Debug, Clone)]
pub struct PostConfig {
    pub auto_extract: bool,
    pub delete_after_extract: bool,
    pub auto_organize: bool,
    pub movies_folder: Option<String>,
    pub tv_folder: Option<String>,
    pub tmdb_api_key: Option<String>,
    pub rar_tool: crate::extractor::RarTool,
}

impl Default for PostConfig {
    fn default() -> Self {
        Self {
            auto_extract: false,
            delete_after_extract: false,
            auto_organize: false,
            movies_folder: None,
            tv_folder: None,
            tmdb_api_key: None,
            rar_tool: crate::extractor::RarTool::None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub max_concurrent: u32,
    pub segments_per_file: u32,
    pub speed_limit_bytes: Option<u64>,
    pub post: PostConfig,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self { max_concurrent: 3, segments_per_file: 4, speed_limit_bytes: None, post: PostConfig::default() }
    }
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
