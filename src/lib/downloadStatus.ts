import type { AppSettings, DownloadTask } from "../types";

export const MAX_ATTEMPTS = 8; // engine Timing::default().max_attempts

export type Tone = "success" | "info" | "warning" | "danger" | "idle";

export function isActiveStatus(status: DownloadTask["status"]): boolean {
  return status === "Downloading" || status === "Pending" || status === "Extracting";
}

export function isFailedStatus(status: DownloadTask["status"]): status is { Failed: string } {
  return typeof status === "object" && "Failed" in status;
}

/**
 * Which controls a download offers. `Extracting` (shown as "Finishing…") offers none: the engine
 * can't stop post-processing, and removing the job mid-way would orphan the running extraction.
 */
export function downloadActions(t: DownloadTask): { pause: boolean; resume: boolean; retry: boolean; cancel: boolean; remove: boolean } {
  const s = t.status;
  const running = s === "Downloading" || s === "Pending";
  const failedOrCancelled = isFailedStatus(s) || s === "Cancelled";
  return {
    pause: running,
    resume: s === "Paused",
    retry: failedOrCancelled,
    cancel: running || s === "Paused",
    remove: failedOrCancelled || s === "Completed",
  };
}

function percent(t: DownloadTask): number {
  return t.total_bytes > 0 ? (t.downloaded_bytes / t.total_bytes) * 100 : 0;
}

/**
 * How a download's state is presented: a tone for StatusDot, a label, and whether the row shows a
 * progress bar instead of a status sub-line. Presentation only — the engine's status enum is untouched.
 * `Extracting` covers all post-processing (extract and/or organize), so it reads "Finishing…".
 */
export function downloadStatusView(t: DownloadTask, now: number): { tone: Tone; label: string; showProgress: boolean; detail: string | null } {
  if (t.waiting_for_network) return { tone: "warning", label: "Waiting for network", showProgress: false, detail: null };
  if (t.status === "Pending" && t.retry_at) {
    const s = Math.max(0, Math.ceil((t.retry_at - now) / 1000));
    return { tone: "warning", label: `Retrying in ${s}s · attempt ${t.attempt ?? 0}/${MAX_ATTEMPTS}`, showProgress: false, detail: null };
  }
  if (isFailedStatus(t.status)) return { tone: "danger", label: t.error || t.status.Failed || "Failed", showProgress: false, detail: null };
  switch (t.status) {
    case "Downloading": {
      const detail =
        t.resumable === false ? "Server doesn't support resume" : (t.segments_active ?? 0) > 1 ? `${t.segments_active} connections` : null;
      return { tone: "info", label: "Downloading", showProgress: true, detail };
    }
    case "Extracting":
      return { tone: "info", label: "Finishing…", showProgress: false, detail: null };
    case "Pending":
      return { tone: "warning", label: "Queued", showProgress: false, detail: null };
    case "Paused":
      return { tone: "idle", label: `Paused · ${Math.round(percent(t))}%`, showProgress: false, detail: null };
    case "Cancelled":
      return { tone: "idle", label: "Cancelled", showProgress: false, detail: null };
    case "Completed":
      return { tone: "success", label: "Completed", showProgress: false, detail: null };
  }
  return { tone: "idle", label: "Unknown", showProgress: false, detail: null };
}

/** Post-download steps the engine runs, from the current settings (for the inspector's "Then" line). */
export function postProcessingSteps(s: Partial<AppSettings> | null): string[] {
  if (!s) return [];
  const steps: string[] = [];
  if (s.auto_extract_archives) steps.push("Extract");
  if (s.auto_organize) steps.push("Organize");
  if (s.plex_url || s.jellyfin_url || s.emby_url) steps.push("Media scan");
  return steps;
}
