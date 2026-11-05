import { invoke } from "@tauri-apps/api/core";
import type { DownloadLink, ZipDownloadStarted, ZipEntry, ZipInspection } from "../types";

/**
 * Read a torrent ZIP/RAR's file list remotely (HTTP Range), without downloading the archive.
 * `fileId` null: the torrent's single download link (Real-Debrid's packed RAR).
 */
export async function inspectTorrentArchive(torrentId: string, fileId: number | null): Promise<ZipInspection> {
  return invoke("inspect_torrent_archive", { torrentId, fileId });
}

/** Queue the given archive members as individual downloads (no extract step afterwards). */
export async function startArchiveContentsDownload(
  link: DownloadLink,
  archiveSize: number,
  entries: ZipEntry[],
  destinationFolder: string,
  torrentName?: string
): Promise<ZipDownloadStarted> {
  return invoke("start_archive_contents_download", {
    link,
    archiveSize,
    entries,
    destinationFolder,
    torrentName: torrentName ?? null,
  });
}
