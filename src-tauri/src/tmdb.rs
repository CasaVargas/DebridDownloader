use serde::Deserialize;

const DEFAULT_API_KEY: &str = "e81295fd01827c1fafc498f0057806b0";
const BASE_URL: &str = "https://api.themoviedb.org/3";

#[derive(Debug, Deserialize)]
struct SearchMovieResponse {
    results: Vec<MovieResult>,
}

#[derive(Debug, Deserialize)]
struct MovieResult {
    title: String,
    release_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchTvResponse {
    results: Vec<TvResult>,
}

#[derive(Debug, Deserialize)]
struct TvResult {
    name: String,
}

#[derive(Debug, Clone)]
pub struct TmdbMatch {
    pub title: String,
    pub year: Option<u32>,
}

/// Look up a movie on TMDb. Returns the official title + year, or None if not found.
pub async fn search_movie(title: &str, year: Option<u32>, api_key: Option<&str>) -> Option<TmdbMatch> {
    let key = api_key.unwrap_or(DEFAULT_API_KEY);
    let client = reqwest::Client::new();

    let mut url = format!("{}/search/movie?api_key={}&query={}", BASE_URL, key, urlencoding::encode(title));
    if let Some(y) = year {
        url.push_str(&format!("&year={}", y));
    }

    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        log::warn!("TMDb movie search failed with status {}", resp.status());
        return None;
    }

    let data: SearchMovieResponse = resp.json().await.ok()?;
    let result = data.results.first()?;

    let tmdb_year = result.release_date.as_ref().and_then(|d| {
        d.split('-').next()?.parse::<u32>().ok()
    });

    Some(TmdbMatch {
        title: result.title.clone(),
        year: tmdb_year,
    })
}

/// Look up a TV show on TMDb. Returns the official show name, or None if not found.
pub async fn search_tv(title: &str, api_key: Option<&str>) -> Option<TmdbMatch> {
    let key = api_key.unwrap_or(DEFAULT_API_KEY);
    let client = reqwest::Client::new();

    let url = format!("{}/search/tv?api_key={}&query={}", BASE_URL, key, urlencoding::encode(title));

    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        log::warn!("TMDb TV search failed with status {}", resp.status());
        return None;
    }

    let data: SearchTvResponse = resp.json().await.ok()?;
    let result = data.results.first()?;

    Some(TmdbMatch {
        title: result.name.clone(),
        year: None,
    })
}
