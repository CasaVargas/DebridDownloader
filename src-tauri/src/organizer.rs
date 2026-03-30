use crate::media_parser::{self, MediaType};
use crate::tmdb;
use std::path::PathBuf;

/// Result of organizing a file — the destination path where it should go.
pub struct OrganizeResult {
    pub dest_path: PathBuf,
    pub title: String,
    pub media_type: MediaType,
}

/// Determine the organized destination path for a media file.
pub async fn organize_path(
    filename: &str,
    movies_folder: &str,
    tv_folder: &str,
    tmdb_api_key: Option<&str>,
) -> OrganizeResult {
    let parsed = media_parser::parse_filename(filename);

    match parsed.media_type {
        MediaType::Movie => {
            let tmdb_match = tmdb::search_movie(&parsed.title, parsed.year, tmdb_api_key).await;

            let (title, year) = if let Some(m) = tmdb_match {
                (m.title, m.year.or(parsed.year))
            } else {
                (parsed.title.clone(), parsed.year)
            };

            let folder_name = if let Some(y) = year {
                format!("{} ({})", title, y)
            } else {
                title.clone()
            };

            let safe_folder = sanitize_path_component(&folder_name);

            let dest = PathBuf::from(movies_folder)
                .join(safe_folder)
                .join(filename);

            OrganizeResult {
                dest_path: dest,
                title,
                media_type: MediaType::Movie,
            }
        }
        MediaType::Tv => {
            let tmdb_match = tmdb::search_tv(&parsed.title, tmdb_api_key).await;

            let title = if let Some(m) = tmdb_match {
                m.title
            } else {
                parsed.title.clone()
            };

            let season = parsed.season.unwrap_or(1);

            let safe_title = sanitize_path_component(&title);
            let season_folder = format!("Season {:02}", season);

            let dest = PathBuf::from(tv_folder)
                .join(safe_title)
                .join(season_folder)
                .join(filename);

            OrganizeResult {
                dest_path: dest,
                title,
                media_type: MediaType::Tv,
            }
        }
    }
}

/// Move a downloaded file to its organized location.
/// Falls back to copy+delete if rename fails (cross-device).
pub async fn move_file(source: &PathBuf, dest: &PathBuf) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    match tokio::fs::rename(source, dest).await {
        Ok(()) => Ok(()),
        Err(_) => {
            tokio::fs::copy(source, dest)
                .await
                .map_err(|e| format!("Failed to copy file: {}", e))?;
            tokio::fs::remove_file(source)
                .await
                .map_err(|e| format!("File copied but failed to remove original: {}", e))?;
            Ok(())
        }
    }
}

fn sanitize_path_component(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}
