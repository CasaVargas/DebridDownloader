use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use super::utils;
use serde::Deserialize;
use std::future::Future;
use std::pin::Pin;

pub struct ProwlarrScraper {
    name: String,
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

pub fn normalize_prowlarr_url(url: &str) -> String {
    let url = url.trim_end_matches('/');
    for suffix in ["/api/v1/search", "/api/v1/health", "/api/v1/indexer", "/api/v1"] {
        if let Some(base) = url.strip_suffix(suffix) {
            return base.trim_end_matches('/').to_string();
        }
    }
    url.to_string()
}

impl ProwlarrScraper {
    pub fn new(name: String, base_url: String, api_key: String) -> Self {
        let url = normalize_prowlarr_url(&base_url);
        Self {
            name,
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/1.1.8")
                .build()
                .expect("Failed to create HTTP client"),
            base_url: url,
            api_key,
        }
    }

    fn prowlarr_categories(category: Option<&str>) -> Option<&'static str> {
        match category {
            Some("movies") => Some("2000"),
            Some("tv") => Some("5000"),
            Some("games") => Some("1000"),
            Some("software") => Some("4000"),
            Some("music") => Some("3000"),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProwlarrResult {
    #[serde(default)]
    guid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    seeders: Option<u32>,
    #[serde(default)]
    leechers: Option<u32>,
    #[serde(default)]
    indexer: Option<String>,
    #[serde(default)]
    publish_date: Option<String>,
    #[serde(default)]
    info_hash: Option<String>,
    #[serde(default)]
    magnet_url: Option<String>,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    categories: Option<Vec<ProwlarrCategory>>,
}

#[derive(Debug, Deserialize)]
struct ProwlarrCategory {
    #[serde(default)]
    name: Option<String>,
}

impl TorrentScraper for ProwlarrScraper {
    fn name(&self) -> &str {
        &self.name
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            let mut url = format!(
                "{}/api/v1/search?query={}&type=search",
                self.base_url.trim_end_matches('/'),
                urlencoding::encode(&params.query),
            );

            if let Some(cat) = Self::prowlarr_categories(params.category.as_deref()) {
                url.push_str(&format!("&categories={}", cat));
            }

            let resp = self.client
                .get(&url)
                .header("X-Api-Key", &self.api_key)
                .send()
                .await?;

            let status = resp.status();
            if !status.is_success() {
                return Err(ScraperError::ParseError(format!(
                    "Prowlarr returned HTTP {} — check your URL and API key", status.as_u16()
                )));
            }

            let items: Vec<ProwlarrResult> = resp.json().await.map_err(|e| {
                ScraperError::ParseError(format!("Failed to parse Prowlarr response: {}", e))
            })?;

            let results: Vec<SearchResult> = items
                .into_iter()
                .filter_map(|item| {
                    // Get magnet URL — only accept strings that start with "magnet:"
                    let magnet = [
                        item.magnet_url.as_deref(),
                        Some(item.guid.as_str()),
                        item.download_url.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .find(|s| s.starts_with("magnet:"))
                    .map(|s| s.to_string())?;

                    // Extract info_hash
                    let info_hash = item.info_hash
                        .filter(|h| !h.is_empty())
                        .unwrap_or_else(|| {
                            super::extract_info_hash(&magnet).unwrap_or_default()
                        })
                        .to_lowercase();

                    if info_hash.is_empty() {
                        return None;
                    }

                    let date = item.publish_date
                        .as_deref()
                        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                        .unwrap_or_default();

                    let category = item.categories
                        .as_ref()
                        .and_then(|cats| cats.first())
                        .and_then(|c| c.name.clone())
                        .unwrap_or_default();

                    let source = item.indexer.unwrap_or_else(|| self.name.clone());

                    Some(SearchResult {
                        title: item.title,
                        magnet,
                        info_hash,
                        size_bytes: item.size,
                        size_display: utils::format_size(item.size),
                        seeders: item.seeders.unwrap_or(0),
                        leechers: item.leechers.unwrap_or(0),
                        date,
                        source,
                        category,
                    })
                })
                .collect();

            Ok(results)
        })
    }
}
