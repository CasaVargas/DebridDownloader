import { call } from "./transport";
import type { SearchResponse, TrackerConfig } from "../types";

export async function searchTorrents(
  query: string,
  category?: string,
  sortBy?: string,
  page?: number
): Promise<SearchResponse> {
  return call("search_torrents", {
    query,
    category: category ?? null,
    sort_by: sortBy ?? null,
    page: page ?? null,
  });
}

export async function getTrackerConfigs(): Promise<TrackerConfig[]> {
  return call("get_tracker_configs");
}

export async function saveTrackerConfigs(configs: TrackerConfig[]): Promise<void> {
  return call("save_tracker_configs", { configs });
}

export async function checkCacheAvailability(
  hashes: string[]
): Promise<string[]> {
  return call("check_cache_availability", { hashes });
}

export async function testTracker(
  trackerType: string,
  url: string,
  apiKey?: string
): Promise<string> {
  return call("test_tracker", {
    trackerType,
    url,
    apiKey: apiKey ?? null,
  });
}
