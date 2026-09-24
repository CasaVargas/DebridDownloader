export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(totalBytes: number, downloadedBytes: number, speed: number): string {
  if (speed <= 0) return "--";
  const remaining = totalBytes - downloadedBytes;
  const seconds = remaining / speed;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export function torrentStatusColor(status: string): string {
  switch (status) {
    case "downloaded":
      return "text-green-400";
    case "downloading":
      return "text-blue-400";
    case "queued":
      return "text-yellow-400";
    case "uploading":
    case "compressing":
      return "text-purple-400";
    case "waiting_files_selection":
      return "text-orange-400";
    case "magnet_conversion":
      return "text-cyan-400";
    case "error":
    case "magnet_error":
    case "virus":
    case "dead":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}

/** StatusDot tone for a provider torrent status. */
export function torrentStatusDot(status: string): "success" | "info" | "warning" | "danger" | "idle" {
  switch (status) {
    case "downloaded":
      return "success";
    case "downloading":
      return "info";
    case "waiting_files_selection":
    case "queued":
    case "magnet_conversion":
      return "warning";
    case "error":
    case "dead":
    case "magnet_error":
    case "virus":
      return "danger";
    default:
      return "idle";
  }
}

export function torrentStatusLabel(status: string): string {
  switch (status) {
    case "downloaded":
      return "Ready";
    case "downloading":
      return "Downloading";
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "compressing":
      return "Compressing";
    case "waiting_files_selection":
      return "Select Files";
    case "magnet_conversion":
      return "Converting";
    case "magnet_error":
      return "Magnet Error";
    case "error":
      return "Error";
    case "virus":
      return "Virus Detected";
    case "dead":
      return "Dead";
    default:
      return status;
  }
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffDays < 1) {
    if (diffHr >= 1) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
    if (diffMin >= 1) return `${diffMin} min ago`;
    return "just now";
  }
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function getDownloadStatusText(
  status: import("./types").DownloadStatus
): string {
  if (typeof status === "string") return status;
  if ("Failed" in status) return `Failed: ${status.Failed}`;
  return "Unknown";
}
