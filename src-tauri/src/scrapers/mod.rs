pub mod jackett;
pub mod piratebay;
pub mod prowlarr;
pub mod torznab;
pub mod utils;
pub use utils::format_size;

use futures::future::join_all;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub magnet: String,
    pub info_hash: String,
    pub size_bytes: u64,
    pub size_display: String,
    pub seeders: u32,
    pub leechers: u32,
    pub date: String,
    pub source: String,
    pub category: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchParams {
    pub query: String,
    pub category: Option<String>,
    pub sort_by: Option<String>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerStatus {
    pub name: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub tracker_status: Vec<TrackerStatus>,
}

/// User-configured tracker
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub tracker_type: String, // "piratebay_api" | "torznab" | "prowlarr" | "jackett"
    pub enabled: bool,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ScraperError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Scraper timed out after {0}s")]
    Timeout(u64),
    #[error("Tracker returned CAPTCHA or block page")]
    Blocked,
}

pub trait TorrentScraper: Send + Sync {
    fn name(&self) -> &str;
    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>>;
}

pub fn extract_info_hash(magnet: &str) -> Option<String> {
    let magnet_lower = magnet.to_lowercase();
    let xt_start = magnet_lower.find("xt=urn:btih:")?;
    let hash_start = xt_start + "xt=urn:btih:".len();
    let rest = &magnet[hash_start..];
    let hash_end = rest.find('&').unwrap_or(rest.len());
    let hash = &rest[..hash_end];
    if hash.is_empty() {
        return None;
    }
    Some(hash.to_lowercase())
}

const SCRAPER_TIMEOUT_SECS: u64 = 10;

/// Build scrapers from user-configured tracker list
fn build_scrapers(configs: &[TrackerConfig]) -> (Vec<Box<dyn TorrentScraper>>, Vec<TrackerStatus>) {
    let mut scrapers: Vec<Box<dyn TorrentScraper>> = Vec::new();
    let mut config_errors: Vec<TrackerStatus> = Vec::new();

    for config in configs.iter().filter(|c| c.enabled) {
        match config.tracker_type.as_str() {
            "piratebay_api" => {
                scrapers.push(Box::new(piratebay::PirateBayScraper::new(config.url.clone())));
            }
            "torznab" => {
                match &config.api_key {
                    Some(key) if !key.is_empty() => {
                        scrapers.push(Box::new(torznab::TorznabScraper::new(
                            config.name.clone(),
                            config.url.clone(),
                            key.clone(),
                        )));
                    }
                    _ => {
                        config_errors.push(TrackerStatus {
                            name: config.name.clone(),
                            ok: false,
                            error: Some("Missing API key — configure in Settings".into()),
                        });
                    }
                }
            }
            "prowlarr" => {
                match &config.api_key {
                    Some(key) if !key.is_empty() => {
                        scrapers.push(Box::new(prowlarr::ProwlarrScraper::new(
                            config.name.clone(),
                            config.url.clone(),
                            key.clone(),
                        )));
                    }
                    _ => {
                        config_errors.push(TrackerStatus {
                            name: config.name.clone(),
                            ok: false,
                            error: Some("Missing API key — configure in Settings".into()),
                        });
                    }
                }
            }
            "jackett" => {
                match &config.api_key {
                    Some(key) if !key.is_empty() => {
                        scrapers.push(Box::new(jackett::JackettScraper::new(
                            config.name.clone(),
                            config.url.clone(),
                            key.clone(),
                        )));
                    }
                    _ => {
                        config_errors.push(TrackerStatus {
                            name: config.name.clone(),
                            ok: false,
                            error: Some("Missing API key — configure in Settings".into()),
                        });
                    }
                }
            }
            _ => {}
        }
    }

    (scrapers, config_errors)
}

pub async fn search_all(params: &SearchParams, tracker_configs: &[TrackerConfig]) -> SearchResponse {
    let (scrapers, config_errors) = build_scrapers(tracker_configs);

    if scrapers.is_empty() && config_errors.is_empty() {
        return SearchResponse {
            results: vec![],
            tracker_status: vec![TrackerStatus {
                name: "No trackers".to_string(),
                ok: false,
                error: Some("No trackers configured. Add trackers in Settings.".to_string()),
            }],
        };
    }
    if scrapers.is_empty() {
        return SearchResponse {
            results: vec![],
            tracker_status: config_errors,
        };
    }

    let futures: Vec<_> = scrapers
        .into_iter()
        .map(|scraper| {
            let name = scraper.name().to_string();
            let params = params.clone();
            async move {
                let result = tokio::time::timeout(
                    Duration::from_secs(SCRAPER_TIMEOUT_SECS),
                    scraper.search(&params),
                )
                .await;

                match result {
                    Ok(Ok(results)) => (
                        results,
                        TrackerStatus { name, ok: true, error: None },
                    ),
                    Ok(Err(e)) => (
                        vec![],
                        TrackerStatus { name, ok: false, error: Some(e.to_string()) },
                    ),
                    Err(_) => (
                        vec![],
                        TrackerStatus {
                            name,
                            ok: false,
                            error: Some(format!("Timed out after {}s", SCRAPER_TIMEOUT_SECS)),
                        },
                    ),
                }
            }
        })
        .collect();

    let outcomes = join_all(futures).await;

    let mut tracker_status = Vec::new();
    let mut all_results = Vec::new();

    for (results, status) in outcomes {
        tracker_status.push(status);
        all_results.extend(results);
    }
    tracker_status.extend(config_errors);

    let mut seen = std::collections::HashSet::new();
    all_results.retain(|r| {
        if r.info_hash.is_empty() {
            return true;
        }
        seen.insert(r.info_hash.clone())
    });

    let sort_by = params.sort_by.as_deref().unwrap_or("seeders");
    match sort_by {
        "size" => all_results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes)),
        "date" => all_results.sort_by(|a, b| b.date.cmp(&a.date)),
        _ => all_results.sort_by(|a, b| b.seeders.cmp(&a.seeders)),
    }

    SearchResponse {
        results: all_results,
        tracker_status,
    }
}
