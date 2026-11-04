import { invoke } from "@tauri-apps/api/core";
import type { DownloadLink, ZipDownloadStarted, ZipEntry, ZipInspection } from "../types";

/** Read a torrent ZIP's file list remotely (HTTP Range), without downloading the archive. */
export async function inspectTorrentZip(torrentId: string, fileId: number): Promise<ZipInspection> {
  return invoke("inspect_torrent_zip", { torrentId, fileId });
}

/** Queue the given ZIP members as individual downloads (no unzip step afterwards). */
export async function startZipContentsDownload(
  link: DownloadLink,
  archiveSize: number,
  entries: ZipEntry[],
  destinationFolder: string,
  torrentName?: string
): Promise<ZipDownloadStarted> {
  return invoke("start_zip_contents_download", {
    link,
    archiveSize,
    entries,
    destinationFolder,
    torrentName: torrentName ?? null,
  });
}
