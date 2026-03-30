use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum MediaType {
    Movie,
    Tv,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedMedia {
    pub media_type: MediaType,
    pub title: String,
    pub year: Option<u32>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
}

/// Parse a media filename into structured metadata.
pub fn parse_filename(filename: &str) -> ParsedMedia {
    // Strip file extension
    let name = filename
        .rfind('.')
        .map(|i| &filename[..i])
        .unwrap_or(filename);

    // Check for TV pattern: S01E02, s01e02, S01.E02
    let tv_re = Regex::new(r"(?i)[.\s_-]S(\d{1,2})[.\s_-]?E(\d{1,3})").unwrap();
    if let Some(caps) = tv_re.captures(name) {
        let season: u32 = caps[1].parse().unwrap_or(1);
        let episode: u32 = caps[2].parse().unwrap_or(1);
        let match_start = caps.get(0).unwrap().start();
        let title_part = &name[..match_start];
        let title = clean_title(title_part);

        return ParsedMedia {
            media_type: MediaType::Tv,
            title,
            year: None,
            season: Some(season),
            episode: Some(episode),
        };
    }

    // Check for "Season X Episode Y" pattern
    let season_re = Regex::new(r"(?i)Season[.\s_-]?(\d{1,2})[.\s_-]?Episode[.\s_-]?(\d{1,3})").unwrap();
    if let Some(caps) = season_re.captures(name) {
        let season: u32 = caps[1].parse().unwrap_or(1);
        let episode: u32 = caps[2].parse().unwrap_or(1);
        let match_start = caps.get(0).unwrap().start();
        let title_part = &name[..match_start];
        let title = clean_title(title_part);

        return ParsedMedia {
            media_type: MediaType::Tv,
            title,
            year: None,
            season: Some(season),
            episode: Some(episode),
        };
    }

    // Movie: look for a 4-digit year
    let year_re = Regex::new(r"[.\s_(-]((?:19|20)\d{2})[.\s_)-]").unwrap();
    if let Some(caps) = year_re.captures(name) {
        let full_year: u32 = caps[1].parse().unwrap_or(0);
        let match_start = caps.get(0).unwrap().start();
        let title_part = &name[..match_start];
        let title = clean_title(title_part);

        return ParsedMedia {
            media_type: MediaType::Movie,
            title,
            year: if full_year >= 1900 && full_year <= 2099 { Some(full_year) } else { None },
            season: None,
            episode: None,
        };
    }

    // Fallback: strip quality indicators and treat as movie
    let title = clean_title(name);
    ParsedMedia {
        media_type: MediaType::Movie,
        title,
        year: None,
        season: None,
        episode: None,
    }
}

/// Clean a title portion: replace dots/underscores with spaces, strip quality tags, trim.
fn clean_title(raw: &str) -> String {
    let quality_re = Regex::new(
        r"(?i)[.\s_-](?:1080p|720p|480p|2160p|4K|BluRay|BrRip|BDRip|WEB-?DL|WEB-?Rip|HDRip|DVDRip|HDTV|x264|x265|H\.?264|H\.?265|HEVC|AAC|DDP?5\.?1|AC3|REMUX|DV|HDR(?:10)?|FLUX|YIFY|RARBG|FGT|EVO|SPARKS|AMIABLE)\b"
    ).unwrap();

    let cleaned = if let Some(m) = quality_re.find(raw) {
        &raw[..m.start()]
    } else {
        raw
    };

    let result: String = cleaned
        .chars()
        .map(|c| match c {
            '.' | '_' => ' ',
            _ => c,
        })
        .collect();

    let space_re = Regex::new(r"\s+").unwrap();
    space_re.replace_all(result.trim(), " ").to_string()
}
