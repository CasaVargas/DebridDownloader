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
