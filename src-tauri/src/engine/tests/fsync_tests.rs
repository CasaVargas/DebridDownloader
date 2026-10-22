use crate::engine::fsync::*;
use tokio::io::AsyncWriteExt;

async fn written(dir: &tempfile::TempDir) -> tokio::fs::File {
    let mut f = tokio::fs::File::create(dir.path().join("f")).await.unwrap();
    f.write_all(b"hello").await.unwrap();
    f.flush().await.unwrap();
    f
}

#[tokio::test]
async fn syncs_a_local_file() {
    let dir = tempfile::tempdir().unwrap();
    let f = written(&dir).await;
    sync_data(&f).await.unwrap();
    sync_all(&f).await.unwrap();
    sync_all_blocking(&f.into_std().await).unwrap();
}

#[tokio::test]
async fn other_errors_pass_through() {
    let dir = tempfile::tempdir().unwrap();
    let f = written(&dir).await;
    let err = or_fsync(&f, Err(std::io::Error::other("disk on fire"))).await.unwrap_err();
    assert_eq!(err.to_string(), "disk on fire");
}

/// macOS SMB shares reject F_FULLFSYNC with ENOTSUP (os error 45).
#[cfg(target_vendor = "apple")]
#[tokio::test]
async fn unsupported_full_fsync_falls_back_to_fsync() {
    let dir = tempfile::tempdir().unwrap();
    let f = written(&dir).await;
    or_fsync(&f, Err(std::io::Error::from_raw_os_error(libc::ENOTSUP))).await.unwrap();
}
