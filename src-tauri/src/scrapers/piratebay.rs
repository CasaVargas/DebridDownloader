use super::{format_size, SearchParams, SearchResult, ScraperError, TorrentScraper};
use serde::Deserialize;
use std::future::Future;
use std::pin::Pin;

const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969",
    "udp://open.demonii.si:1337/announce",
];

#[derive(Debug, Deserialize)]
struct ApiResult {
    #[serde(default)]
    name: String,
    #[serde(default)]
    info_hash: String,
    #[serde(default)]
    seeders: String,
    #[serde(default)]
    leechers: String,
    #[serde(default)]
    size: String,
    #[serde(default)]
    added: String,
    #[serde(default)]
    category: String,
}

pub struct PirateBayScraper {
    client: reqwest::Client,
    base_url: String,
}

impl PirateBayScraper {
    pub fn new(base_url: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("DebridDownloader/0.1.0")
                .build()
                .expect("Failed to create HTTP client"),
            base_url,
        }
    }

    fn category_code(category: Option<&str>) -> &'static str {
        match category {
            Some("movies") => "207",
            Some("tv") => "208",
            Some("games") => "400",
            Some("software") => "300",
            Some("music") => "100",
            _ => "0",
        }
    }

    fn map_category(code: &str) -> String {
        match code {
            c if c.starts_with('1') => "Music".to_string(),
            c if c.starts_with('2') => "Movies".to_string(),
            c if c.starts_with('3') => "Software".to_string(),
            c if c.starts_with('4') => "Games".to_string(),
            c if c.starts_with('5') => "TV".to_string(),
            c if c.starts_with('6') => "Other".to_string(),
            _ => "Other".to_string(),
        }
    }

    fn build_magnet(info_hash: &str, name: &str) -> String {
        let encoded_name = urlencoding::encode(name);
        let trackers: String = TRACKERS
            .iter()
            .map(|t| format!("&tr={}", urlencoding::encode(t)))
            .collect();
        format!(
            "magnet:?xt=urn:btih:{}&dn={}{}",
            info_hash, encoded_name, trackers
        )
    }
}

impl TorrentScraper for PirateBayScraper {
    fn name(&self) -> &str {
        "Pirate Bay API"
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            let cat = Self::category_code(params.category.as_deref());
            let url = format!("{}/q.php?q={}&cat={}", self.base_url, urlencoding::encode(&params.query), cat);

            let resp = self.client.get(&url).send().await?;
            let text = resp.text().await?;

            if text.contains("<!DOCTYPE") || text.contains("<html") {
                return Err(ScraperError::Blocked);
            }

            let api_results: Vec<ApiResult> = serde_json::from_str(&text)
                .map_err(|e| ScraperError::ParseError(e.to_string()))?;

            let source = self.base_url.clone();
            let results: Vec<SearchResult> = api_results
                .into_iter()
                .filter(|r| r.name != "No results returned" && !r.info_hash.is_empty())
                .map(|r| {
                    let size_bytes: u64 = r.size.parse().unwrap_or(0);
                    let magnet = Self::build_magnet(&r.info_hash, &r.name);
                    let info_hash = r.info_hash.to_lowercase();
                    let seeders: u32 = r.seeders.parse().unwrap_or(0);
                    let leechers: u32 = r.leechers.parse().unwrap_or(0);

                    let date = chrono::DateTime::from_timestamp_secs(
                        r.added.parse::<i64>().unwrap_or(0)
                    )
                    .map(|dt: chrono::DateTime<chrono::Utc>| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();

                    SearchResult {
                        title: r.name,
                        magnet,
                        info_hash,
                        size_bytes,
                        size_display: format_size(size_bytes),
                        seeders,
                        leechers,
                        date,
                        source: source.clone(),
                        category: Self::map_category(&r.category),
                    }
                })
                .collect();

            Ok(results)
        })
    }
}
