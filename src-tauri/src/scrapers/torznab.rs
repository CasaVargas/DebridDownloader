use super::{SearchParams, SearchResult, ScraperError, TorrentScraper};
use super::utils;
use futures::stream::{self, StreamExt};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::future::Future;
use std::pin::Pin;

pub struct TorznabScraper {
    name: String,
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl TorznabScraper {
    pub fn new(name: String, base_url: String, api_key: String) -> Self {
        Self {
            name,
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/1.1.8")
                .build()
                .expect("Failed to create HTTP client"),
            base_url,
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

impl TorrentScraper for TorznabScraper {
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
                "{}/api?t=search&apikey={}&q={}",
                self.base_url.trim_end_matches('/'),
                urlencoding::encode(&self.api_key),
                urlencoding::encode(&params.query),
            );

            if let Some(cat) = Self::torznab_category(params.category.as_deref()) {
                url.push_str(&format!("&cat={}", cat));
            }

            let resp = self.client.get(&url).send().await?;
            let status = resp.status();
            let text = resp.text().await?;

            // Check for non-XML responses (HTML login pages, redirects, error pages)
            if !status.is_success() {
                return Err(ScraperError::ParseError(format!(
                    "Server returned HTTP {}", status.as_u16()
                )));
            }

            let trimmed = text.trim_start();
            if !trimmed.starts_with("<?xml") && !trimmed.starts_with('<') {
                return Err(ScraperError::ParseError(
                    "Server returned non-XML response — check your URL and API key".to_string()
                ));
            }

            if trimmed.contains("<!DOCTYPE html") || trimmed.contains("<html") {
                return Err(ScraperError::ParseError(
                    "Server returned an HTML page instead of XML — check your URL and API key".to_string()
                ));
            }

            // Check for Torznab error responses
            if let Some(err) = parse_torznab_error(&text) {
                return Err(err);
            }

            let items = parse_torznab_items(&text)?;

            // Split items into those with info_hash (ready) and those needing fallback
            let mut results = Vec::new();
            let mut need_fallback: Vec<TorznabItem> = Vec::new();

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

            // Resolve .torrent fallbacks concurrently (max 10 items, 5 concurrent)
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

// ── XML Parsing ──────────────────────────────────────────────────────

#[derive(Default)]
pub struct TorznabItem {
    pub title: String,
    pub link: String,
    pub size: u64,
    pub seeders: u32,
    pub peers: u32,
    pub info_hash: String,
    pub magnet_url: String,
    pub category: String,
    pub pub_date: String,
}

pub fn parse_torznab_error(xml: &str) -> Option<ScraperError> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "error" {
                    let mut code = String::new();
                    let mut description = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "code" => code = val,
                            "description" => description = val,
                            _ => {}
                        }
                    }
                    let msg = if code == "100" || code == "101" {
                        format!("Authentication failed: {} (code {})", description, code)
                    } else {
                        format!("Torznab error: {} (code {})", description, code)
                    };
                    return Some(ScraperError::ParseError(msg));
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

pub fn parse_torznab_items(xml: &str) -> Result<Vec<TorznabItem>, ScraperError> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut items = Vec::new();

    let mut in_item = false;
    let mut current_item = TorznabItem::default();
    let mut current_tag = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "item" {
                    in_item = true;
                    current_item = TorznabItem::default();
                } else if in_item {
                    current_tag = name.clone();

                    if name == "enclosure" {
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                            if key == "length" && current_item.size == 0 {
                                let val = String::from_utf8_lossy(&attr.value).to_string();
                                current_item.size = val.parse().unwrap_or(0);
                            }
                        }
                    }

                    if name == "attr" {
                        let mut attr_name = String::new();
                        let mut attr_value = String::new();
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                            let val = String::from_utf8_lossy(&attr.value).to_string();
                            match key.as_str() {
                                "name" => attr_name = val,
                                "value" => attr_value = val,
                                _ => {}
                            }
                        }
                        match attr_name.as_str() {
                            "seeders" => current_item.seeders = attr_value.parse().unwrap_or(0),
                            "peers" => current_item.peers = attr_value.parse().unwrap_or(0),
                            "infohash" => current_item.info_hash = attr_value,
                            "magneturl" => current_item.magnet_url = attr_value,
                            "category" => {
                                if current_item.category.is_empty() {
                                    current_item.category = attr_value;
                                }
                            }
                            "size" => {
                                if current_item.size == 0 {
                                    current_item.size = attr_value.parse().unwrap_or(0);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                if !in_item {
                    buf.clear();
                    continue;
                }
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();

                if name == "attr" {
                    let mut attr_name = String::new();
                    let mut attr_value = String::new();
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "name" => attr_name = val,
                            "value" => attr_value = val,
                            _ => {}
                        }
                    }
                    match attr_name.as_str() {
                        "seeders" => current_item.seeders = attr_value.parse().unwrap_or(0),
                        "peers" => current_item.peers = attr_value.parse().unwrap_or(0),
                        "infohash" => current_item.info_hash = attr_value,
                        "magneturl" => current_item.magnet_url = attr_value,
                        "category" => {
                            if current_item.category.is_empty() {
                                current_item.category = attr_value;
                            }
                        }
                        "size" => {
                            if current_item.size == 0 {
                                current_item.size = attr_value.parse().unwrap_or(0);
                            }
                        }
                        _ => {}
                    }
                }

                if name == "enclosure" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        if key == "length" && current_item.size == 0 {
                            let val = String::from_utf8_lossy(&attr.value).to_string();
                            current_item.size = val.parse().unwrap_or(0);
                        }
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_item {
                    let text = e.unescape().unwrap_or_default().to_string();
                    match current_tag.as_str() {
                        "title" => current_item.title = text,
                        "link" => current_item.link = text,
                        "size" => current_item.size = text.parse().unwrap_or(current_item.size),
                        "pubDate" => {
                            current_item.pub_date = chrono::DateTime::parse_from_rfc2822(&text)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_else(|_| text);
                        }
                        "category" => {
                            if current_item.category.is_empty() {
                                current_item.category = text;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "item" {
                    in_item = false;
                    if !current_item.title.is_empty() {
                        items.push(std::mem::take(&mut current_item));
                    }
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(ScraperError::ParseError(format!("XML parse error: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(items)
}
