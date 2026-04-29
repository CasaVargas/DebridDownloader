// ── Authentication ──

export interface DeviceCode {
  device_code: string;
  user_code: string;
  interval: number;
  expires_in: number;
  verification_url: string;
}

export interface DeviceCredentials {
  client_id: string;
  client_secret: string;
}

export interface OAuthToken {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token: string;
}

export interface User {
  username: string;
  email: string;
  premium: boolean;
  expiration: string | null;
}

// ── Provider ──

export interface ProviderInfo {
  id: string;
  name: string;
  auth_method: "api_key" | "oauth_device";
  supports_streaming: boolean;
}

// ── Torrents ──

export interface Torrent {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  progress: number;
  status: string;
  added: string;
  links: string[];
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface TorrentFile {
  id: number;
  path: string;
  bytes: number;
  selected: boolean;
}

export interface TorrentInfo {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  progress: number;
  status: string;
  added: string;
  files: TorrentFile[];
  links: string[];
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface AddTorrentResponse {
  id: string;
}

// ── Downloads ──

export interface DownloadLink {
  filename: string;
  filesize: number;
  download: string;
  streamable?: boolean;
}

export interface DownloadItem {
  id: string;
  filename: string;
  filesize: number;
  download: string;
  generated: string;
}

export type DownloadStatus =
  | "Pending"
  | "Downloading"
  | "Paused"
  | "Extracting"
  | "Completed"
  | "Cancelled"
  | { Failed: string };

export interface DownloadTask {
  id: string;
  filename: string;
  url: string;
  destination: string;
  total_bytes: number;
  downloaded_bytes: number;
  speed: number;
  status: DownloadStatus;
  remote?: string | null;
}

export interface DownloadProgress {
  id: string;
  filename: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed: number;
  status: DownloadStatus;
  remote?: string | null;
}

// ── Settings ──

export interface AppSettings {
  download_folder: string | null;
  max_concurrent_downloads: number;
  create_torrent_subfolders: boolean;
  theme: string;
  provider: string;
  symlink_mode?: boolean;
  symlink_mount_path?: string | null;
  symlink_library_path?: string | null;
  auto_organize?: boolean;
  movies_folder?: string | null;
  tv_folder?: string | null;
  tmdb_api_key?: string | null;
  plex_url?: string | null;
  plex_token?: string | null;
  jellyfin_url?: string | null;
  jellyfin_api_key?: string | null;
  emby_url?: string | null;
  emby_api_key?: string | null;
  speed_limit_bytes?: number | null;
  auto_extract_archives?: boolean;
  delete_archives_after_extract?: boolean;
  torbox_search_enabled?: boolean;
}

// ── Search ──

export interface SearchResult {
  title: string;
  magnet: string;
  info_hash: string;
  size_bytes: number;
  size_display: string;
  seeders: number;
  leechers: number;
  date: string;
  source: string;
  category: string;
}

export interface TrackerStatus {
  name: string;
  ok: boolean;
  error: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  tracker_status: TrackerStatus[];
}

export interface TrackerConfig {
  id: string;
  name: string;
  url: string;
  tracker_type: string;
  enabled: boolean;
  api_key?: string;
}

// Streaming
export interface StreamUrlResponse {
  stream_url: string;
  session_id: string;
}

// ── rclone ──

export interface RcloneInfo {
  version: string;
  available: boolean;
}

// ── Watch List ──

export type RuleType =
  | { type: "Keyword" }
  | { type: "TvShow"; last_season: number | null; last_episode: number | null };

export type WatchAction = "Notify" | "AutoAdd";

export type MatchStatus =
  | { type: "Notified" }
  | { type: "Added" }
  | { type: "Failed"; reason: string };

export interface WatchRule {
  id: string;
  name: string;
  rule_type: RuleType;
  query: string;
  category: string | null;
  regex_filter: string | null;
  min_seeders: number | null;
  min_size_bytes: number | null;
  max_size_bytes: number | null;
  action: WatchAction;
  interval_minutes: number;
  enabled: boolean;
  created_at: string;
  last_checked: string | null;
}

export interface WatchMatch {
  rule_id: string;
  info_hash: string;
  magnet: string;
  title: string;
  size_bytes: number;
  matched_at: string;
  action_taken: WatchAction;
  status: MatchStatus;
  season: number | null;
  episode: number | null;
}
