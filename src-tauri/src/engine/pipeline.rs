//! Post-download steps: extract → organize. Media-server scans are the host's job (BatchFinished).
use super::types::{Job, PostConfig, PostStage};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;

#[derive(Debug, Clone, PartialEq)]
pub enum PipelineEvent {
    Extracting,
    Stage(PostStage),
}

#[derive(Debug, Clone, PartialEq)]
pub struct PostResult {
    pub destination: String,
    pub error: Option<String>,
}

const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "avi", "mov", "m4v", "webm"];

/// Files next to a download, excluding in-progress `.part` files.
pub async fn list_siblings(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = entries.next_entry().await {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("part") {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

pub async fn run_post(job: &Job, cfg: &PostConfig, events: &mpsc::UnboundedSender<PipelineEvent>) -> PostResult {
    let mut destination = job.destination.clone();
    let mut extracted: Option<PathBuf> = None;
    let mut stage = job.post;

    if stage == PostStage::Extract || stage == PostStage::None {
        if cfg.auto_extract {
            match extract_step(&job.destination, cfg, events).await {
                Ok(dir) => extracted = dir,
                Err(e) => return PostResult { destination, error: Some(e) },
            }
        }
        stage = PostStage::Organize;
        let _ = events.send(PipelineEvent::Stage(PostStage::Organize));
    }
    if stage == PostStage::Organize {
        if cfg.auto_organize {
            if let Some(d) = organize_step(&destination, extracted.as_deref(), &job.filename, cfg).await {
                destination = d;
            }
        }
        let _ = events.send(PipelineEvent::Stage(PostStage::Done));
    }
    PostResult { destination, error: None }
}

async fn extract_step(path: &str, cfg: &PostConfig, events: &mpsc::UnboundedSender<PipelineEvent>) -> Result<Option<PathBuf>, String> {
    let archive = PathBuf::from(path);
    let Some(parent) = archive.parent() else { return Ok(None) };
    let siblings = list_siblings(parent).await;
    let refs: Vec<&Path> = siblings.iter().map(|p| p.as_path()).collect();
    let Some(group) = crate::extractor::classify(&archive, &refs) else { return Ok(None) };
    let _ = events.send(PipelineEvent::Extracting);
    let dest = parent.join(crate::extractor::archive_basename(&group.primary));
    crate::extractor::extract(&group, &dest, cfg.rar_tool).await.map_err(|e| e.to_string())?;
    if cfg.delete_after_extract {
        for part in &group.all_parts {
            if let Err(e) = tokio::fs::remove_file(part).await {
                log::warn!("Failed to delete archive part {:?}: {}", part, e);
            }
        }
    }
    log::info!("Extracted: {:?} → {:?}", group.primary, dest);
    Ok(Some(dest))
}

async fn organize_step(destination: &str, extracted: Option<&Path>, filename: &str, cfg: &PostConfig) -> Option<String> {
    let (Some(mf), Some(tf)) = (&cfg.movies_folder, &cfg.tv_folder) else { return None };
    let src = match extracted {
        Some(dir) => {
            let n = crate::extractor::count_videos(dir);
            if n != 1 {
                log::info!("Extracted dir has {} videos — skipping organize", n);
                return None;
            }
            find_single_video(dir)?
        }
        None => PathBuf::from(destination),
    };
    let fname = src.file_name().and_then(|n| n.to_str()).unwrap_or(filename).to_string();
    let result = crate::organizer::organize_path(&fname, mf, tf, cfg.tmdb_api_key.as_deref()).await;
    match crate::organizer::move_file(&src, &result.dest_path).await {
        Ok(()) => {
            let d = result.dest_path.to_string_lossy().to_string();
            log::info!("Organized: {} → {}", filename, d);
            Some(d)
        }
        Err(e) => {
            log::warn!("Failed to organize {}: {}", filename, e);
            None
        }
    }
}

fn find_single_video(dir: &Path) -> Option<PathBuf> {
    let mut found: Option<PathBuf> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
                    if found.is_some() {
                        return None;
                    }
                    found = Some(path);
                }
            }
        }
    }
    found
}
