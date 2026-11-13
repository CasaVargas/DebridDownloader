import { call, downloadFileUrl } from "./transport";
import type {
  DownloadItem,
  DownloadLink,
  DownloadTask,
} from "../types";

/** Links for every file in the torrent, or only `fileIds` (ids from `TorrentInfo.files`). */
export async function unrestrictTorrentLinks(
  torrentId: string,
  fileIds?: number[]
): Promise<DownloadLink[]> {
  return call("unrestrict_torrent_links", { torrentId, fileIds: fileIds ?? null });
}

export async function startDownloads(
  links: DownloadLink[],
  destinationFolder: string,
  torrentName?: string
): Promise<string[]> {
  return call("start_downloads", {
    links,
    destinationFolder,
    torrentName: torrentName ?? null,
  });
}

/**
 * Browser UI only: have the browser save the finished file of download `id` from the headless
 * server to the device it runs on. The server answers with an attachment, so the page stays put.
 */
export function saveToDevice(id: string): void {
  const a = document.createElement("a");
  a.href = downloadFileUrl(id);
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function cancelDownload(id: string): Promise<void> {
  return call("cancel_download", { id });
}

export async function removeDownload(id: string): Promise<void> {
  return call("remove_download", { id });
}

export async function cancelAllDownloads(): Promise<void> {
  return call("cancel_all_downloads");
}

export async function getDownloadTasks(): Promise<DownloadTask[]> {
  return call("get_download_tasks");
}

export async function clearCompletedDownloads(): Promise<void> {
  return call("clear_completed_downloads");
}

export async function getDownloadHistory(
  page?: number,
  limit?: number
): Promise<DownloadItem[]> {
  return call("get_download_history", {
    page: page ?? null,
    limit: limit ?? null,
  });
}

export async function pauseDownload(id: string): Promise<void> {
  return call("pause_download", { id });
}

export async function resumeDownload(id: string): Promise<void> {
  return call("resume_download", { id });
}

export async function retryDownload(id: string): Promise<void> {
  return call("retry_download", { id });
}

export async function pauseAllDownloads(): Promise<void> {
  return call("pause_all_downloads");
}

export async function resumeAllDownloads(): Promise<void> {
  return call("resume_all_downloads");
}

export async function retryFailedDownloads(): Promise<void> {
  return call("retry_failed_downloads");
}

/** Batch controls: every download of one torrent / archive's contents. */
export async function pauseBatch(batchId: string): Promise<void> {
  return call("pause_batch", { batchId });
}

export async function resumeBatch(batchId: string): Promise<void> {
  return call("resume_batch", { batchId });
}

export async function retryBatch(batchId: string): Promise<void> {
  return call("retry_batch", { batchId });
}

export async function cancelBatch(batchId: string): Promise<void> {
  return call("cancel_batch", { batchId });
}
