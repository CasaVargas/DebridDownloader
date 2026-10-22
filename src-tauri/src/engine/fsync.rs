//! `fsync` that also works on network shares.
//!
//! On Apple platforms std's `sync_all`/`sync_data` issue `fcntl(F_FULLFSYNC)`, which the macOS SMB
//! client rejects with ENOTSUP, so every download to a NAS failed at its first checkpoint with
//! "Operation not supported (os error 45)". Like SQLite, fall back to plain `fsync(2)`: it still
//! pushes our writes to the server, just without the drive-cache flush only local disks honor.
use std::io;
use tokio::fs::File;

pub async fn sync_data(file: &File) -> io::Result<()> {
    or_fsync(file, file.sync_data().await).await
}

pub async fn sync_all(file: &File) -> io::Result<()> {
    or_fsync(file, file.sync_all().await).await
}

/// Blocking `sync_all` for `std::fs::File`.
pub fn sync_all_blocking(file: &std::fs::File) -> io::Result<()> {
    let result = file.sync_all();
    if full_fsync_unsupported(&result) {
        fsync(file)
    } else {
        result
    }
}

/// Retry an `F_FULLFSYNC` the filesystem doesn't support as a plain `fsync(2)`.
pub(crate) async fn or_fsync(file: &File, result: io::Result<()>) -> io::Result<()> {
    if !full_fsync_unsupported(&result) {
        return result;
    }
    let f = file.try_clone().await?.into_std().await;
    tokio::task::spawn_blocking(move || fsync(&f)).await.map_err(io::Error::other)?
}

#[cfg(target_vendor = "apple")]
fn full_fsync_unsupported(result: &io::Result<()>) -> bool {
    matches!(result, Err(e) if e.raw_os_error() == Some(libc::ENOTSUP))
}

#[cfg(not(target_vendor = "apple"))]
fn full_fsync_unsupported(_: &io::Result<()>) -> bool {
    false
}

#[cfg(target_vendor = "apple")]
fn fsync(f: &std::fs::File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    loop {
        // SAFETY: `f` keeps the descriptor open for the duration of the call.
        if unsafe { libc::fsync(f.as_raw_fd()) } == 0 {
            return Ok(());
        }
        let e = io::Error::last_os_error();
        if e.kind() != io::ErrorKind::Interrupted {
            return Err(e);
        }
    }
}

/// Everywhere else std's `sync_all` already is `fsync(2)`.
#[cfg(not(target_vendor = "apple"))]
fn fsync(f: &std::fs::File) -> io::Result<()> {
    f.sync_all()
}
