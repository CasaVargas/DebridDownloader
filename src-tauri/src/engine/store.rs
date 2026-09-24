//! `downloads.json` persistence. Atomic writes: unique temp file → fsync → rename.
use super::types::{now_ms, Job, JobKind, JobState, PostStage};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const HISTORY_CAP: usize = 500;
const FILE_NAME: &str = "downloads.json";
const VERSION: u32 = 1;

#[derive(Deserialize)]
struct StoreFile {
    version: u32,
    jobs: Vec<Job>,
}

#[derive(Serialize)]
struct StoreFileRef<'a> {
    version: u32,
    jobs: &'a [Job],
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join(FILE_NAME) }
    }

    pub fn load(&self) -> Vec<Job> {
        let bytes = match std::fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(e) => {
                log::warn!("Failed to read {}: {}", self.path.display(), e);
                return Vec::new();
            }
        };
        match serde_json::from_slice::<StoreFile>(&bytes) {
            Ok(f) if f.version == VERSION => f.jobs,
            Ok(f) => {
                self.quarantine(&format!("unsupported version {}", f.version));
                Vec::new()
            }
            Err(e) => {
                self.quarantine(&e.to_string());
                Vec::new()
            }
        }
    }

    fn quarantine(&self, why: &str) {
        let dest = self.path.with_file_name(format!("{}.corrupt-{}", FILE_NAME, now_ms()));
        log::warn!("{} is unreadable ({}); moving it to {}", self.path.display(), why, dest.display());
        let _ = std::fs::rename(&self.path, dest);
    }

    pub fn save(&self, jobs: &[Job]) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_vec_pretty(&StoreFileRef { version: VERSION, jobs })
            .map_err(std::io::Error::other)?;
        let tmp = self.path.with_file_name(format!("{}.{}.tmp", FILE_NAME, uuid::Uuid::new_v4().simple()));
        {
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(&data)?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &self.path)
    }
}

/// Keep every unfinished job plus the newest `HISTORY_CAP` finished ones. Preserves order.
pub fn prune_history(jobs: &mut Vec<Job>) {
    let mut terminal: Vec<(i64, String)> = jobs
        .iter()
        .filter(|j| j.state.is_terminal())
        .map(|j| (j.updated_at, j.id.clone()))
        .collect();
    if terminal.len() <= HISTORY_CAP {
        return;
    }
    terminal.sort_by_key(|t| std::cmp::Reverse(t.0));
    let keep: std::collections::HashSet<String> = terminal.into_iter().take(HISTORY_CAP).map(|(_, id)| id).collect();
    jobs.retain(|j| !j.state.is_terminal() || keep.contains(&j.id));
}

/// Startup recovery (spec §4.4). Returns ids whose post-processing must re-run.
pub fn recover(jobs: &mut [Job]) -> Vec<String> {
    let mut rerun = Vec::new();
    for job in jobs.iter_mut() {
        if job.state == JobState::Downloading {
            job.state = JobState::Pending;
        }
        if job.state == JobState::Pending {
            job.retry_at = None;
        }
        if matches!(job.state, JobState::Pending | JobState::Paused)
            && job.kind == JobKind::Http
            && !job.segments.is_empty()
        {
            let part_len = std::fs::metadata(job.part_path()).map(|m| m.len()).ok();
            if part_len != Some(job.total_bytes.max(0) as u64) {
                job.segments.clear();
            }
        }
        if matches!(job.state, JobState::Completed | JobState::Extracting)
            && matches!(job.post, PostStage::Extract | PostStage::Organize)
        {
            rerun.push(job.id.clone());
        }
    }
    rerun
}
