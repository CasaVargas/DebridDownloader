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

pub fn count_videos(dir: &Path) -> usize {
    const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "avi", "mov", "m4v", "webm"];
    let mut count = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if VIDEO_EXTS.contains(&ext.to_lowercase().as_str()) {
                    count += 1;
                }
            }
        }
    }
    count
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

#[cfg(test)]
mod count_tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn empty_dir_zero() {
        let d = tempdir().unwrap();
        assert_eq!(count_videos(d.path()), 0);
    }

    #[test]
    fn one_video_one() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("movie.mkv"), b"").unwrap();
        fs::write(d.path().join("readme.nfo"), b"").unwrap();
        assert_eq!(count_videos(d.path()), 1);
    }

    #[test]
    fn two_videos_two() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("a.mkv"), b"").unwrap();
        fs::write(d.path().join("b.mp4"), b"").unwrap();
        assert_eq!(count_videos(d.path()), 2);
    }

    #[test]
    fn nested_videos_counted() {
        let d = tempdir().unwrap();
        fs::create_dir(d.path().join("sub")).unwrap();
        fs::write(d.path().join("sub/a.mkv"), b"").unwrap();
        fs::write(d.path().join("b.mp4"), b"").unwrap();
        assert_eq!(count_videos(d.path()), 2);
    }

    #[test]
    fn sample_and_extras_ignored() {
        let d = tempdir().unwrap();
        fs::write(d.path().join("movie.mkv"), b"").unwrap();
        fs::write(d.path().join("sample.srt"), b"").unwrap();
        fs::write(d.path().join("poster.jpg"), b"").unwrap();
        assert_eq!(count_videos(d.path()), 1);
    }
}

/// Pure helper: given the selected tool + input/output paths, build the
/// (binary, args) pair the extractor will exec.
pub(crate) fn rar_command(tool: RarTool, primary: &Path, dest: &Path) -> (String, Vec<String>) {
    let p = primary.to_string_lossy().into_owned();
    let d = dest.to_string_lossy().into_owned();
    match tool {
        RarTool::SevenZip => ("7z".into(), vec!["x".into(), "-y".into(), format!("-o{}", d), p]),
        RarTool::SevenZz  => ("7zz".into(), vec!["x".into(), "-y".into(), format!("-o{}", d), p]),
        RarTool::Unar     => ("unar".into(), vec!["-o".into(), d, "-f".into(), p]),
        RarTool::Unrar    => ("unrar".into(), vec!["x".into(), "-y".into(), "-o+".into(), p, format!("{}/", d)]),
        RarTool::None     => (String::new(), Vec::new()),
    }
}

fn extract_tar(primary: &Path, dest: &Path, kind: ArchiveKind) -> Result<(), ExtractError> {
    std::fs::create_dir_all(dest).map_err(ExtractError::Io)?;
    let file = std::fs::File::open(primary).map_err(ExtractError::Io)?;
    let reader: Box<dyn std::io::Read> = match kind {
        ArchiveKind::TarGz => Box::new(flate2::read::GzDecoder::new(file)),
        ArchiveKind::TarXz => Box::new(xz2::read::XzDecoder::new(file)),
        ArchiveKind::TarBz2 => Box::new(bzip2::read::BzDecoder::new(file)),
        _ => return Err(ExtractError::UnsupportedFormat),
    };
    let mut archive = tar::Archive::new(reader);
    archive.unpack(dest).map_err(|e| ExtractError::BadArchive(e.to_string()))?;
    Ok(())
}

fn extract_7z(primary: &Path, dest: &Path) -> Result<(), ExtractError> {
    std::fs::create_dir_all(dest).map_err(ExtractError::Io)?;
    sevenz_rust2::decompress_file(primary, dest)
        .map_err(|e| ExtractError::BadArchive(e.to_string()))?;
    Ok(())
}

async fn extract_rar(primary: &Path, dest: &Path, tool: RarTool) -> Result<(), ExtractError> {
    if matches!(tool, RarTool::None) {
        return Err(ExtractError::RarToolMissing);
    }
    std::fs::create_dir_all(dest).map_err(ExtractError::Io)?;
    let (bin, args) = rar_command(tool, primary, dest);
    let output = tokio::process::Command::new(&bin)
        .args(&args)
        .output()
        .await
        .map_err(ExtractError::Io)?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr.chars().rev().take(200).collect::<String>();
    let tail: String = tail.chars().rev().collect();

    // Heuristic: password prompts show in stderr
    if stderr.to_lowercase().contains("password") {
        return Err(ExtractError::PasswordRequired);
    }
    Err(ExtractError::ToolFailed {
        tool: bin,
        stderr: tail,
    })
}

pub async fn extract(
    group: &ArchiveGroup,
    dest: &Path,
    rar_tool: RarTool,
) -> Result<(), ExtractError> {
    let primary = group.primary.clone();
    let dest_buf = dest.to_path_buf();
    match group.kind {
        ArchiveKind::Rar => extract_rar(&primary, &dest_buf, rar_tool).await,
        kind @ (ArchiveKind::Zip | ArchiveKind::SevenZip
               | ArchiveKind::TarGz | ArchiveKind::TarXz | ArchiveKind::TarBz2) => {
            tokio::task::spawn_blocking(move || match kind {
                ArchiveKind::Zip => extract_zip(&primary, &dest_buf),
                ArchiveKind::SevenZip => extract_7z(&primary, &dest_buf),
                ArchiveKind::TarGz | ArchiveKind::TarXz | ArchiveKind::TarBz2 => {
                    extract_tar(&primary, &dest_buf, kind)
                }
                _ => unreachable!(),
            })
            .await
            .map_err(|e| ExtractError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
        }
    }
}

fn extract_zip(primary: &Path, dest: &Path) -> Result<(), ExtractError> {
    std::fs::create_dir_all(dest).map_err(ExtractError::Io)?;
    let file = std::fs::File::open(primary).map_err(ExtractError::Io)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| ExtractError::BadArchive(e.to_string()))?;
    archive.extract(dest)
        .map_err(|e| ExtractError::BadArchive(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod extract_zip_tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn build_zip(path: &Path, files: &[(&str, &[u8])]) {
        let f = File::create(path).unwrap();
        let mut zw = ZipWriter::new(f);
        let opts = SimpleFileOptions::default();
        for (name, content) in files {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(content).unwrap();
        }
        zw.finish().unwrap();
    }

    #[test]
    fn extract_zip_three_files() {
        let d = tempdir().unwrap();
        let archive = d.path().join("a.zip");
        build_zip(&archive, &[
            ("a.txt", b"A"), ("b.txt", b"BB"), ("c.txt", b"CCC"),
        ]);
        let dest = d.path().join("out");
        extract_zip(&archive, &dest).unwrap();
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"A");
        assert_eq!(fs::read(dest.join("b.txt")).unwrap(), b"BB");
        assert_eq!(fs::read(dest.join("c.txt")).unwrap(), b"CCC");
    }

    #[test]
    fn extract_zip_truncated_errors() {
        let d = tempdir().unwrap();
        let archive = d.path().join("a.zip");
        build_zip(&archive, &[("a.txt", b"A")]);
        // Truncate to 20 bytes — breaks central directory
        let bytes = fs::read(&archive).unwrap();
        fs::write(&archive, &bytes[..20]).unwrap();
        let dest = d.path().join("out");
        let err = extract_zip(&archive, &dest).unwrap_err();
        assert!(matches!(err, ExtractError::BadArchive(_)), "got {:?}", err);
    }

    #[tokio::test]
    async fn dispatcher_zip() {
        use std::fs::{self, File};
        use std::io::Write;
        use tempfile::tempdir;
        use zip::write::{SimpleFileOptions, ZipWriter};

        let d = tempdir().unwrap();
        let archive = d.path().join("a.zip");
        let f = File::create(&archive).unwrap();
        let mut zw = ZipWriter::new(f);
        zw.start_file("x.txt", SimpleFileOptions::default()).unwrap();
        zw.write_all(b"hi").unwrap();
        zw.finish().unwrap();

        let group = ArchiveGroup {
            kind: ArchiveKind::Zip,
            primary: archive.clone(),
            all_parts: vec![archive.clone()],
        };
        let dest = d.path().join("out");
        extract(&group, &dest, RarTool::None).await.unwrap();
        assert_eq!(fs::read(dest.join("x.txt")).unwrap(), b"hi");
    }
}

#[cfg(test)]
mod extract_7z_tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn extract_7z_files() {
        let d = tempdir().unwrap();
        let archive = d.path().join("a.7z");
        // Build via sevenz-rust2 compress API
        let src = d.path().join("src");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), b"A").unwrap();
        fs::write(src.join("b.txt"), b"BB").unwrap();
        sevenz_rust2::compress_to_path(&src, &archive).unwrap();

        let dest = d.path().join("out");
        extract_7z(&archive, &dest).unwrap();
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"A");
        assert_eq!(fs::read(dest.join("b.txt")).unwrap(), b"BB");
    }
}

#[cfg(test)]
mod extract_tar_tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;

    fn build_tar_gz(path: &Path, files: &[(&str, &[u8])]) {
        let tar_gz = File::create(path).unwrap();
        let enc = GzEncoder::new(tar_gz, Compression::default());
        let mut tar = tar::Builder::new(enc);
        for (name, content) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_cksum();
            tar.append_data(&mut header, name, *content).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    fn extract_tar_gz_files() {
        let d = tempdir().unwrap();
        let archive = d.path().join("a.tar.gz");
        build_tar_gz(&archive, &[("a.txt", b"A"), ("b.txt", b"BB")]);
        let dest = d.path().join("out");
        extract_tar(&archive, &dest, ArchiveKind::TarGz).unwrap();
        assert_eq!(fs::read(dest.join("a.txt")).unwrap(), b"A");
        assert_eq!(fs::read(dest.join("b.txt")).unwrap(), b"BB");
    }
}

#[cfg(test)]
mod rar_cmd_tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn sevenzip_args() {
        let (bin, args) = rar_command(RarTool::SevenZip, Path::new("/d/x.rar"), Path::new("/d/out"));
        assert_eq!(bin, "7z");
        assert_eq!(args, vec!["x", "-y", "-o/d/out", "/d/x.rar"]);
    }

    #[test]
    fn sevenzz_args() {
        let (bin, args) = rar_command(RarTool::SevenZz, Path::new("/d/x.rar"), Path::new("/d/out"));
        assert_eq!(bin, "7zz");
        assert_eq!(args, vec!["x", "-y", "-o/d/out", "/d/x.rar"]);
    }

    #[test]
    fn unar_args() {
        let (bin, args) = rar_command(RarTool::Unar, Path::new("/d/x.rar"), Path::new("/d/out"));
        assert_eq!(bin, "unar");
        assert_eq!(args, vec!["-o", "/d/out", "-f", "/d/x.rar"]);
    }

    #[test]
    fn unrar_args() {
        let (bin, args) = rar_command(RarTool::Unrar, Path::new("/d/x.rar"), Path::new("/d/out"));
        assert_eq!(bin, "unrar");
        assert_eq!(args, vec!["x", "-y", "-o+", "/d/x.rar", "/d/out/"]);
    }

    #[test]
    fn none_returns_empty() {
        let (bin, args) = rar_command(RarTool::None, Path::new("/d/x.rar"), Path::new("/d/out"));
        assert_eq!(bin, "");
        assert!(args.is_empty());
        let _ = PathBuf::new();
    }
}
