import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadItem,
  DownloadLink,
  DownloadTask,
} from "../types";

export async function unrestrictTorrentLinks(
  torrentId: string
): Promise<DownloadLink[]> {
  return invoke("unrestrict_torrent_links", { torrentId });
}

export async function startDownloads(
  links: DownloadLink[],
  destinationFolder: string,
  torrentName?: string
): Promise<string[]> {
  return invoke("start_downloads", {
    links,
    destinationFolder,
    torrentName: torrentName ?? null,
  });
}

export async function cancelDownload(id: string): Promise<void> {
  return invoke("cancel_download", { id });
}

export async function removeDownload(id: string): Promise<void> {
  return invoke("remove_download", { id });
}

export async function cancelAllDownloads(): Promise<void> {
  return invoke("cancel_all_downloads");
}

export async function getDownloadTasks(): Promise<DownloadTask[]> {
  return invoke("get_download_tasks");
}

export async function clearCompletedDownloads(): Promise<void> {
  return invoke("clear_completed_downloads");
}

export async function getDownloadHistory(
  page?: number,
  limit?: number
): Promise<DownloadItem[]> {
  return invoke("get_download_history", {
    page: page ?? null,
    limit: limit ?? null,
  });
}

export async function pauseDownload(id: string): Promise<void> {
  return invoke("pause_download", { id });
}

export async function resumeDownload(id: string): Promise<void> {
  return invoke("resume_download", { id });
}

export async function retryDownload(id: string): Promise<void> {
  return invoke("retry_download", { id });
}

export async function pauseAllDownloads(): Promise<void> {
  return invoke("pause_all_downloads");
}

export async function resumeAllDownloads(): Promise<void> {
  return invoke("resume_all_downloads");
}

export async function retryFailedDownloads(): Promise<void> {
  return invoke("retry_failed_downloads");
}
