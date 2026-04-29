import { invoke } from "@tauri-apps/api/core";
import type { SearchResponse, TrackerConfig } from "../types";

export async function searchTorrents(
  query: string,
  category?: string,
  sortBy?: string,
  page?: number
): Promise<SearchResponse> {
  return invoke("search_torrents", {
    query,
    category: category ?? null,
    sort_by: sortBy ?? null,
    page: page ?? null,
  });
}

export async function getTrackerConfigs(): Promise<TrackerConfig[]> {
  return invoke("get_tracker_configs");
}

export async function saveTrackerConfigs(configs: TrackerConfig[]): Promise<void> {
  return invoke("save_tracker_configs", { configs });
}

export async function checkCacheAvailability(
  hashes: string[]
): Promise<string[]> {
  return invoke("check_cache_availability", { hashes });
}

export async function testTracker(
  trackerType: string,
  url: string,
  apiKey?: string
): Promise<string> {
  return invoke("test_tracker", {
    trackerType,
    url,
    apiKey: apiKey ?? null,
  });
}
