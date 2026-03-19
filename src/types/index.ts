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
  id: number;
  username: string;
  email: string;
  points: number;
  locale: string;
  avatar: string;
  type: string;
  premium: number;
  expiration: string;
}

// ── Torrents ──

export interface Torrent {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  host: string;
  split: number;
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
  selected: number;
}

export interface TorrentInfo {
  id: string;
  filename: string;
  original_filename?: string;
  hash: string;
  bytes: number;
  original_bytes?: number;
  host: string;
  split: number;
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
  uri: string;
}

// ── Unrestrict ──

export interface UnrestrictedLink {
  id: string;
  filename: string;
  mimeType?: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  crc?: number;
  download: string;
  streamable?: number;
}

// ── Downloads ──

export interface DownloadItem {
  id: string;
  filename: string;
  mimeType?: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
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
}

export interface DownloadProgress {
  id: string;
  filename: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed: number;
  status: DownloadStatus;
}

// ── Settings ──

export interface AppSettings {
  download_folder: string | null;
  max_concurrent_downloads: number;
  create_torrent_subfolders: boolean;
  theme: string;
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
}

// Streaming
export interface StreamUrlResponse {
  stream_url: string;
  session_id: string;
}
