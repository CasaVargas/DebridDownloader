use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use super::torznab::{parse_torznab_error, parse_torznab_items};
use super::utils;
use futures::stream::{self, StreamExt};
use std::future::Future;
use std::pin::Pin;

pub struct JackettScraper {
    name: String,
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl JackettScraper {
    pub fn new(name: String, base_url: String, api_key: String) -> Self {
        let url = normalize_url(&base_url);
        Self {
            name,
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/1.6.3")
                .build()
                .expect("Failed to create HTTP client"),
            base_url: url,
            api_key,
        }
    }

    fn torznab_category(category: Option<&str>) -> Option<&'static str> {
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

pub fn normalize_jackett_url(url: &str) -> String {
    normalize_url(url)
}

fn normalize_url(url: &str) -> String {
    let url = url.trim_end_matches('/');
    if url.contains("/api/v2.0/indexers/") {
        return url.to_string();
    }
    let base = if let Some(pos) = url.find("/UI") {
        &url[..pos]
    } else {
        url
    };
    format!("{}/api/v2.0/indexers/all/results/torznab", base.trim_end_matches('/'))
}

impl TorrentScraper for JackettScraper {
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
                "{}?t=search&apikey={}&q={}",
                self.base_url,
                urlencoding::encode(&self.api_key),
                urlencoding::encode(&params.query),
            );

            if let Some(cat) = Self::torznab_category(params.category.as_deref()) {
                url.push_str(&format!("&cat={}", cat));
            }

            let resp = self.client.get(&url).send().await?;
            let status = resp.status();
            let text = resp.text().await?;

            if !status.is_success() {
                return Err(ScraperError::ParseError(format!(
                    "Jackett returned HTTP {}", status.as_u16()
                )));
            }

            let trimmed = text.trim_start();
            if !trimmed.starts_with("<?xml") && !trimmed.starts_with('<') {
                return Err(ScraperError::ParseError(
                    "Jackett returned non-XML response — check your URL and API key".to_string()
                ));
            }

            if trimmed.contains("<!DOCTYPE html") || trimmed.contains("<html") {
                return Err(ScraperError::ParseError(
                    "Jackett returned an HTML page instead of XML — check your URL and API key".to_string()
                ));
            }

            if let Some(err) = parse_torznab_error(&text) {
                return Err(err);
            }

            let items = parse_torznab_items(&text)?;

            let mut results = Vec::new();
            let mut need_fallback = Vec::new();

            for item in items {
                if !item.info_hash.is_empty() {
                    let magnet = if !item.magnet_url.is_empty() {
                        item.magnet_url
                    } else {
                        utils::build_magnet(&item.info_hash, &item.title)
                    };
                    results.push(SearchResult {
                        title: item.title,
                        magnet,
                        info_hash: item.info_hash.to_lowercase(),
                        size_bytes: item.size,
                        size_display: utils::format_size(item.size),
                        seeders: item.seeders,
                        leechers: item.peers.saturating_sub(item.seeders),
                        date: item.pub_date,
                        source: self.name.clone(),
                        category: item.category,
                    });
                } else if !item.link.is_empty() {
                    need_fallback.push(item);
                }
            }

            const MAX_FALLBACK: usize = 10;
            const CONCURRENCY: usize = 5;

            let fallback_results: Vec<Option<SearchResult>> = stream::iter(
                need_fallback.into_iter().take(MAX_FALLBACK)
            )
            .map(|item| {
                let client = &self.client;
                let source = self.name.clone();
                async move {
                    match utils::extract_info_hash_from_torrent(&item.link, client).await {
                        Ok(hash) => {
                            let magnet = utils::build_magnet(&hash, &item.title);
                            Some(SearchResult {
                                title: item.title,
                                magnet,
                                info_hash: hash.to_lowercase(),
                                size_bytes: item.size,
                                size_display: utils::format_size(item.size),
                                seeders: item.seeders,
                                leechers: item.peers.saturating_sub(item.seeders),
                                date: item.pub_date,
                                source,
                                category: item.category,
                            })
                        }
                        Err(e) => {
                            log::warn!("Failed to extract info hash from {}: {}", item.link, e);
                            None
                        }
                    }
                }
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;

            results.extend(fallback_results.into_iter().flatten());

            Ok(results)
        })
    }
}
