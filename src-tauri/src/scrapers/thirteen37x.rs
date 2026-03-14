use super::{extract_info_hash, format_size, SearchParams, SearchResult, ScraperError, TorrentScraper};
use scraper::{Html, Selector};
use std::future::Future;
use std::pin::Pin;

const BASE_URL: &str = "https://www.1337x.to";

pub struct Thirteen37xScraper {
    client: reqwest::Client,
}

impl Thirteen37xScraper {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    fn category_path(category: Option<&str>) -> &'static str {
        match category {
            Some("movies") => "Movies",
            Some("tv") => "TV",
            Some("games") => "Games",
            Some("software") => "Apps",
            Some("music") => "Music",
            _ => "",
        }
    }

    fn build_search_url(query: &str, category: Option<&str>, sort_by: Option<&str>, page: u32) -> String {
        let cat = Self::category_path(category);
        let encoded_query = query.replace(' ', "+");

        if cat.is_empty() {
            match sort_by {
                Some("size") => format!("{}/sort-search/{}/size/desc/{}/", BASE_URL, encoded_query, page),
                Some("date") => format!("{}/sort-search/{}/time/desc/{}/", BASE_URL, encoded_query, page),
                Some("seeders") | _ => format!("{}/sort-search/{}/seeders/desc/{}/", BASE_URL, encoded_query, page),
            }
        } else {
            match sort_by {
                Some("size") => format!("{}/sort-category-search/{}/{}/size/desc/{}/", BASE_URL, encoded_query, cat, page),
                Some("date") => format!("{}/sort-category-search/{}/{}/time/desc/{}/", BASE_URL, encoded_query, cat, page),
                Some("seeders") | _ => format!("{}/sort-category-search/{}/{}/seeders/desc/{}/", BASE_URL, encoded_query, cat, page),
            }
        }
    }

    fn parse_search_results(html: &str) -> Result<Vec<PartialResult>, ScraperError> {
        let document = Html::parse_document(html);

        if html.contains("captcha") || html.contains("cf-browser-verification") {
            return Err(ScraperError::Blocked);
        }

        let table_selector = Selector::parse("table.table-list tbody tr")
            .map_err(|_| ScraperError::ParseError("Failed to parse table selector".into()))?;
        let name_selector = Selector::parse("td.coll-1.name a:nth-child(2)")
            .map_err(|_| ScraperError::ParseError("Failed to parse name selector".into()))?;
        let seeds_selector = Selector::parse("td.coll-2")
            .map_err(|_| ScraperError::ParseError("Failed to parse seeds selector".into()))?;
        let leeches_selector = Selector::parse("td.coll-3")
            .map_err(|_| ScraperError::ParseError("Failed to parse leeches selector".into()))?;
        let date_selector = Selector::parse("td.coll-date")
            .map_err(|_| ScraperError::ParseError("Failed to parse date selector".into()))?;
        let size_selector = Selector::parse("td.coll-4")
            .map_err(|_| ScraperError::ParseError("Failed to parse size selector".into()))?;

        let mut results = Vec::new();

        for row in document.select(&table_selector) {
            let name_el = match row.select(&name_selector).next() {
                Some(el) => el,
                None => continue,
            };

            let title = name_el.text().collect::<String>().trim().to_string();
            let detail_path = match name_el.value().attr("href") {
                Some(href) => href.to_string(),
                None => continue,
            };

            let seeders: u32 = row.select(&seeds_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().parse().unwrap_or(0))
                .unwrap_or(0);

            let leechers: u32 = row.select(&leeches_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().parse().unwrap_or(0))
                .unwrap_or(0);

            let date = row.select(&date_selector)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .unwrap_or_default();

            let size_text = row.select(&size_selector)
                .next()
                .map(|el| {
                    el.text().next().unwrap_or("").trim().to_string()
                })
                .unwrap_or_default();

            results.push(PartialResult {
                title,
                detail_path,
                seeders,
                leechers,
                date,
                size_display: size_text,
            });
        }

        Ok(results)
    }

    async fn fetch_magnet(&self, detail_path: &str) -> Result<String, ScraperError> {
        let url = format!("{}{}", BASE_URL, detail_path);
        let resp = self.client.get(&url).send().await?;
        let html = resp.text().await?;
        let document = Html::parse_document(&html);

        let magnet_selector = Selector::parse("a[href^=\"magnet:\"]")
            .map_err(|_| ScraperError::ParseError("Failed to parse magnet selector".into()))?;

        document
            .select(&magnet_selector)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|s| s.to_string())
            .ok_or_else(|| ScraperError::ParseError("No magnet link found on detail page".into()))
    }

    fn parse_size_to_bytes(size_str: &str) -> u64 {
        let size_str = size_str.trim();
        let parts: Vec<&str> = size_str.split_whitespace().collect();
        if parts.len() < 2 {
            return 0;
        }
        let num: f64 = parts[0].replace(',', "").parse().unwrap_or(0.0);
        let unit = parts[1].to_uppercase();
        match unit.as_str() {
            "KB" => (num * 1024.0) as u64,
            "MB" => (num * 1024.0 * 1024.0) as u64,
            "GB" => (num * 1024.0 * 1024.0 * 1024.0) as u64,
            "TB" => (num * 1024.0 * 1024.0 * 1024.0 * 1024.0) as u64,
            _ => num as u64,
        }
    }
}

struct PartialResult {
    title: String,
    detail_path: String,
    seeders: u32,
    leechers: u32,
    date: String,
    size_display: String,
}

impl TorrentScraper for Thirteen37xScraper {
    fn name(&self) -> &str {
        "1337x"
    }

    fn search(
        &self,
        params: &SearchParams,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SearchResult>, ScraperError>> + Send + '_>> {
        let params = params.clone();
        Box::pin(async move {
            let page = params.page.unwrap_or(1);
            let url = Self::build_search_url(
                &params.query,
                params.category.as_deref(),
                params.sort_by.as_deref(),
                page,
            );

            let resp = self.client.get(&url).send().await?;
            let html = resp.text().await?;
            let partial_results = Self::parse_search_results(&html)?;

            let mut results = Vec::new();

            for partial in partial_results {
                match self.fetch_magnet(&partial.detail_path).await {
                    Ok(magnet) => {
                        let info_hash = extract_info_hash(&magnet).unwrap_or_default();
                        let size_bytes = Self::parse_size_to_bytes(&partial.size_display);
                        results.push(SearchResult {
                            title: partial.title,
                            magnet,
                            info_hash,
                            size_bytes,
                            size_display: if partial.size_display.is_empty() {
                                format_size(size_bytes)
                            } else {
                                partial.size_display
                            },
                            seeders: partial.seeders,
                            leechers: partial.leechers,
                            date: partial.date,
                            source: "1337x".to_string(),
                            category: "Other".to_string(),
                        });
                    }
                    Err(e) => {
                        log::warn!("Failed to fetch magnet for '{}': {}", partial.title, e);
                    }
                }
            }

            Ok(results)
        })
    }
}
