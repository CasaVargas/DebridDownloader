use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use super::torznab::{parse_torznab_items, parse_torznab_error};
use super::utils;
use serde::Deserialize;
use std::future::Future;
use std::pin::Pin;

const SEARCH_API_URL: &str = "https://search-api.torbox.app";

pub struct TorBoxSearchScraper {
    api_key: String,
    client: reqwest::Client,
}

impl TorBoxSearchScraper {
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/1.6.3")
                .build()
                .expect("Failed to create HTTP client"),
            api_key,
        }
    }

    async fn meta_search(&self, query: &str) -> Result<Vec<MetaResult>, ScraperError> {
        let url = format!(
            "{}/meta/search/{}",
            SEARCH_API_URL,
            urlencoding::encode(query),
        );

        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await?;

        if !resp.status().is_success() {
            return Ok(Vec::new());
        }

        let body: MetaSearchResponse = resp.json().await.map_err(|e| {
            ScraperError::ParseError(format!("Failed to parse TorBox meta response: {}", e))
        })?;

        if !body.success {
            return Ok(Vec::new());
        }

        Ok(body.data.unwrap_or_default())
    }

    async fn torznab_search(&self, media_type: &str, imdb_id: &str) -> Result<Vec<SearchResult>, ScraperError> {
        let t = match media_type {
            "series" => "tvsearch",
            _ => "movie",
        };

        let url = format!(
            "{}/torznab/api?t={}&apikey={}&imdbid={}",
            SEARCH_API_URL,
            t,
            urlencoding::encode(&self.api_key),
            urlencoding::encode(imdb_id),
        );

        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Ok(Vec::new());
        }

        let text = resp.text().await?;

        if let Some(err) = parse_torznab_error(&text) {
            return Err(err);
        }

        let items = parse_torznab_items(&text)?;

        let results: Vec<SearchResult> = items
            .into_iter()
            .filter_map(|item| {
                if item.info_hash.is_empty() && item.magnet_url.is_empty() {
                    return None;
                }

                let info_hash = if !item.info_hash.is_empty() {
                    item.info_hash.to_lowercase()
                } else if let Some(h) = super::extract_info_hash(&item.magnet_url) {
                    h.to_lowercase()
                } else {
                    return None;
                };

                let magnet = if !item.magnet_url.is_empty() {
                    item.magnet_url
                } else {
                    utils::build_magnet(&info_hash, &item.title)
                };

                Some(SearchResult {
                    title: item.title,
                    magnet,
                    info_hash,
                    size_bytes: item.size,
                    size_display: utils::format_size(item.size),
                    seeders: item.seeders,
                    leechers: item.peers.saturating_sub(item.seeders),
                    date: item.pub_date,
                    source: "TorBox Search".to_string(),
                    category: item.category,
                })
            })
            .collect();

        Ok(results)
    }
}

#[derive(Debug, Deserialize)]
struct MetaSearchResponse {
    success: bool,
    #[serde(default)]
    data: Option<Vec<MetaResult>>,
}

#[derive(Debug, Deserialize)]
struct MetaResult {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    imdb_id: Option<String>,
    #[serde(default, rename = "mediaType")]
    media_type: Option<String>,
}

impl MetaResult {
    fn get_imdb_id(&self) -> Option<&str> {
        if let Some(id) = &self.imdb_id {
            if !id.is_empty() {
                return Some(id);
            }
        }
        if let Some(id) = &self.id {
            if let Some(stripped) = id.strip_prefix("imdb:") {
                return Some(stripped);
            }
            if let Some(stripped) = id.strip_prefix("imdb_id:") {
                return Some(stripped);
            }
        }
        None
    }
}

impl TorrentScraper for TorBoxSearchScraper {
    fn name(&self) -> &str {
        "TorBox Search"
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            // Step 1: resolve query to IMDB IDs via meta search
            let meta_results = self.meta_search(&params.query).await?;

            if meta_results.is_empty() {
                return Ok(Vec::new());
            }

            // Step 2: search torrents by IMDB ID for each unique result (max 5)
            let mut all_results = Vec::new();
            let mut seen_hashes = std::collections::HashSet::new();
            let mut seen_imdb = std::collections::HashSet::new();

            for meta in meta_results.iter() {
                if seen_imdb.len() >= 5 {
                    break;
                }
                let imdb_id = match meta.get_imdb_id() {
                    Some(id) => id,
                    None => continue,
                };
                if !seen_imdb.insert(imdb_id.to_string()) {
                    continue;
                }
                let media_type = meta.media_type.as_deref().unwrap_or("movie");

                match self.torznab_search(media_type, imdb_id).await {
                    Ok(results) => {
                        for r in results {
                            if seen_hashes.insert(r.info_hash.clone()) {
                                all_results.push(r);
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("TorBox Search failed for {}: {}", imdb_id, e);
                    }
                }
            }

            Ok(all_results)
        })
    }
}
