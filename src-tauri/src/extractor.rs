//! Post-download archive extraction: classify completed files into
//! ArchiveGroups, dispatch to the right backend, surface typed errors.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    Rar,
    SevenZip,
    TarGz,
    TarXz,
    TarBz2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveGroup {
    pub kind: ArchiveKind,
    pub primary: PathBuf,
    pub all_parts: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RarTool {
    SevenZip,  // `7z`
    SevenZz,   // `7zz`
    Unar,
    Unrar,
    None,
}

impl RarTool {
    pub fn name(self) -> Option<&'static str> {
        match self {
            RarTool::SevenZip => Some("7z"),
            RarTool::SevenZz => Some("7zz"),
            RarTool::Unar => Some("unar"),
            RarTool::Unrar => Some("unrar"),
            RarTool::None => Option::None,
        }
    }
}

#[derive(Debug)]
pub enum ExtractError {
    UnsupportedFormat,
    RarToolMissing,
    ToolFailed { tool: String, stderr: String },
    Io(std::io::Error),
    BadArchive(String),
    PasswordRequired,
}

impl std::fmt::Display for ExtractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExtractError::UnsupportedFormat => write!(f, "Unsupported archive format"),
            ExtractError::RarToolMissing => write!(
                f,
                "Install 7-Zip, p7zip, or unar to extract RAR archives"
            ),
            ExtractError::ToolFailed { tool, stderr } => {
                write!(f, "Extract failed ({}): {}", tool, stderr)
            }
            ExtractError::Io(e) => write!(f, "Extract IO error: {}", e),
            ExtractError::BadArchive(msg) => write!(f, "Archive corrupt: {}", msg),
            ExtractError::PasswordRequired => write!(
                f,
                "Archive is password-protected (not supported in v1)"
            ),
        }
    }
}

impl std::error::Error for ExtractError {}

use regex::Regex;
use std::sync::OnceLock;

fn re_rar5() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^(?P<base>.+)\.part0*1\.rar$").unwrap())
}
fn re_rar5_any() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^(?P<base>.+)\.part(?P<n>\d+)\.rar$").unwrap())
}
fn re_old_rar() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^(?P<base>.+)\.rar$").unwrap())
}
fn re_old_rar_part() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^(?P<base>.+)\.r(?P<n>\d{2,3})$").unwrap())
}
fn re_7z_split() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^(?P<base>.+)\.7z\.(?P<n>\d{3})$").unwrap())
}

fn sibling_names<'a>(siblings: &'a [&Path]) -> Vec<(&'a Path, &'a str)> {
    siblings.iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(|n| (*p, n)))
        .collect()
}

fn find_path<'a>(names: &'a [(&'a Path, &'a str)], wanted: &str) -> Option<&'a Path> {
    names.iter().find(|(_, n)| *n == wanted).map(|(p, _)| *p)
}

pub fn classify(completed: &Path, siblings: &[&Path]) -> Option<ArchiveGroup> {
    let name = completed.file_name()?.to_str()?;
    let names = sibling_names(siblings);

    // Case 1 & 1b: RAR5 split — completed may be any partN; find part1 as primary.
    if let Some(caps) = re_rar5_any().captures(name) {
        let base = &caps["base"];
        let mut parts: Vec<(u32, &Path)> = names.iter()
            .filter_map(|(p, n)| {
                let c = re_rar5_any().captures(n)?;
                if &c["base"] != base { return Option::None; }
                Some((c["n"].parse().ok()?, *p))
            })
            .collect();
        parts.sort_by_key(|(n, _)| *n);
        // Require contiguous 1..=N
        let expected: Vec<u32> = (1..=parts.len() as u32).collect();
        let actual: Vec<u32> = parts.iter().map(|(n, _)| *n).collect();
        if actual != expected { return Option::None; }
        let primary = parts[0].1.to_path_buf();
        return Some(ArchiveGroup {
            kind: ArchiveKind::Rar,
            primary,
            all_parts: parts.into_iter().map(|(_, p)| p.to_path_buf()).collect(),
        });
    }

    // Case 2: Old-style RAR — .rar + at least one .rNN
    if let Some(caps) = re_old_rar().captures(name) {
        let base = &caps["base"];
        let mut extras: Vec<(u32, &Path)> = names.iter()
            .filter_map(|(p, n)| {
                let c = re_old_rar_part().captures(n)?;
                if &c["base"] != base { return Option::None; }
                Some((c["n"].parse().ok()?, *p))
            })
            .collect();
        let primary_path = find_path(&names, name)?.to_path_buf();
        if extras.is_empty() {
            // No siblings → treat as single .rar (see Case 4 below).
        } else {
            extras.sort_by_key(|(n, _)| *n);
            // Require contiguous from .r00
            let expected: Vec<u32> = (0..extras.len() as u32).collect();
            let actual: Vec<u32> = extras.iter().map(|(n, _)| *n).collect();
            if actual != expected { return Option::None; }
            let mut all_parts = vec![primary_path.clone()];
            all_parts.extend(extras.into_iter().map(|(_, p)| p.to_path_buf()));
            return Some(ArchiveGroup {
                kind: ArchiveKind::Rar,
                primary: primary_path,
                all_parts,
            });
        }
    }

    // Case 3: 7z split
    if let Some(caps) = re_7z_split().captures(name) {
        let base = &caps["base"];
        let mut parts: Vec<(u32, &Path)> = names.iter()
            .filter_map(|(p, n)| {
                let c = re_7z_split().captures(n)?;
                if &c["base"] != base { return Option::None; }
                Some((c["n"].parse().ok()?, *p))
            })
            .collect();
        parts.sort_by_key(|(n, _)| *n);
        let expected: Vec<u32> = (1..=parts.len() as u32).collect();
        let actual: Vec<u32> = parts.iter().map(|(n, _)| *n).collect();
        if actual != expected { return Option::None; }
        let primary = parts[0].1.to_path_buf();
        return Some(ArchiveGroup {
            kind: ArchiveKind::SevenZip,
            primary,
            all_parts: parts.into_iter().map(|(_, p)| p.to_path_buf()).collect(),
        });
    }

    // Case 4: Single-file archive by extension
    let lower = name.to_lowercase();
    let kind = if lower.ends_with(".tar.gz") { Some(ArchiveKind::TarGz) }
        else if lower.ends_with(".tar.xz") { Some(ArchiveKind::TarXz) }
        else if lower.ends_with(".tar.bz2") { Some(ArchiveKind::TarBz2) }
        else if lower.ends_with(".zip") { Some(ArchiveKind::Zip) }
        else if lower.ends_with(".7z") { Some(ArchiveKind::SevenZip) }
        else if lower.ends_with(".rar") { Some(ArchiveKind::Rar) }
        else { Option::None };

    kind.map(|k| ArchiveGroup {
        kind: k,
        primary: completed.to_path_buf(),
        all_parts: vec![completed.to_path_buf()],
    })
}

pub fn detect_rar_tool() -> RarTool {
    // Priority: 7z > 7zz > unar > unrar.
    // 7z is the traditional p7zip binary; 7zz is the new unified 7-Zip CLI
    // shipped by Igor Pavlov. Either works.
    for (bin, tool) in [
        ("7z", RarTool::SevenZip),
        ("7zz", RarTool::SevenZz),
        ("unar", RarTool::Unar),
        ("unrar", RarTool::Unrar),
    ] {
        if which::which(bin).is_ok() {
            return tool;
        }
    }
    RarTool::None
}

pub fn count_videos(_dir: &Path) -> usize {
    0  // filled in by Task 5
}

#[cfg(test)]
mod classify_tests {
    use super::*;
    use std::path::PathBuf;

    fn p(s: &str) -> PathBuf { PathBuf::from(s) }
    fn sibs<'a>(v: &'a [PathBuf]) -> Vec<&'a Path> { v.iter().map(|p| p.as_path()).collect() }

    #[test]
    fn split_rar5_complete() {
        let files = vec![
            p("/dl/Movie.part1.rar"),
            p("/dl/Movie.part2.rar"),
            p("/dl/Movie.part3.rar"),
        ];
        let g = classify(&files[0], &sibs(&files)).unwrap();
        assert_eq!(g.kind, ArchiveKind::Rar);
        assert_eq!(g.primary, p("/dl/Movie.part1.rar"));
        assert_eq!(g.all_parts.len(), 3);
    }

    #[test]
    fn split_rar5_missing_middle_part() {
        let files = vec![
            p("/dl/Movie.part1.rar"),
            p("/dl/Movie.part3.rar"),
        ];
        assert!(classify(&files[0], &sibs(&files)).is_none());
    }

    #[test]
    fn split_rar5_called_from_non_primary_part() {
        // classify should still return the group even if called with part3
        let files = vec![
            p("/dl/Movie.part1.rar"),
            p("/dl/Movie.part2.rar"),
            p("/dl/Movie.part3.rar"),
        ];
        let g = classify(&files[2], &sibs(&files)).unwrap();
        assert_eq!(g.primary, p("/dl/Movie.part1.rar"));
    }

    #[test]
    fn old_style_rar_complete() {
        let files = vec![
            p("/dl/Movie.rar"),
            p("/dl/Movie.r00"),
            p("/dl/Movie.r01"),
        ];
        let g = classify(&files[0], &sibs(&files)).unwrap();
        assert_eq!(g.kind, ArchiveKind::Rar);
        assert_eq!(g.primary, p("/dl/Movie.rar"));
        assert_eq!(g.all_parts.len(), 3);
    }

    #[test]
    fn old_style_rar_missing_r01() {
        let files = vec![
            p("/dl/Movie.rar"),
            p("/dl/Movie.r00"),
            p("/dl/Movie.r02"),
        ];
        assert!(classify(&files[0], &sibs(&files)).is_none());
    }

    #[test]
    fn split_7z_complete() {
        let files = vec![
            p("/dl/Movie.7z.001"),
            p("/dl/Movie.7z.002"),
        ];
        let g = classify(&files[0], &sibs(&files)).unwrap();
        assert_eq!(g.kind, ArchiveKind::SevenZip);
        assert_eq!(g.primary, p("/dl/Movie.7z.001"));
        assert_eq!(g.all_parts.len(), 2);
    }

    #[test]
    fn single_zip() {
        let files = vec![p("/dl/Movie.zip")];
        let g = classify(&files[0], &sibs(&files)).unwrap();
        assert_eq!(g.kind, ArchiveKind::Zip);
        assert_eq!(g.all_parts, vec![p("/dl/Movie.zip")]);
    }

    #[test]
    fn single_tar_gz() {
        let files = vec![p("/dl/foo.tar.gz")];
        let g = classify(&files[0], &sibs(&files)).unwrap();
        assert_eq!(g.kind, ArchiveKind::TarGz);
    }

    #[test]
    fn plain_mkv_is_not_archive() {
        let files = vec![p("/dl/Movie.mkv")];
        assert!(classify(&files[0], &sibs(&files)).is_none());
    }

    #[test]
    fn bare_numeric_split_unsupported() {
        let files = vec![p("/dl/foo.001"), p("/dl/foo.002")];
        assert!(classify(&files[0], &sibs(&files)).is_none());
    }
}

#[cfg(test)]
mod detect_tests {
    use super::*;

    #[test]
    fn detect_does_not_panic() {
        // Result depends on the runner's environment; just ensure no panic
        // and that .name() is consistent with the variant.
        let t = detect_rar_tool();
        match t {
            RarTool::None => assert!(t.name().is_none()),
            _ => assert!(t.name().is_some()),
        }
    }
}
