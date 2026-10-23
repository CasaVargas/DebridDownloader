import type { DownloadTask } from "../types";

/** Readmes, tracker ads and checksums that ride along with the real content of a torrent. */
const EXTRA_EXTS = [".txt", ".nfo", ".url", ".sfv", ".md5", ".sha1", ".sha256", ".diz", ".htm", ".html", ".lnk", ".website"];

export function isExtra(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 && EXTRA_EXTS.includes(filename.slice(dot).toLowerCase());
}

/** The completed files of one torrent (one download batch). */
export interface CompletedGroup {
  /** Batch id, or the task id for a file with none (symlinks, older saved jobs). */
  id: string;
  name: string;
  /** Torrent folder the provider prefixes file names with ("Show/S01E01.mkv"), if they all share one. */
  prefix: string | null;
  /** Content largest first, then extras. */
  files: DownloadTask[];
  extras: number;
  totalBytes: number;
  /** Unix ms the last file finished; 0 when unknown. */
  finishedAt: number;
  /** Directory every file was saved in, if they share one. */
  folder: string | null;
}

const lastSep = (p: string) => Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
const dirname = (p: string) => (lastSep(p) >= 0 ? p.slice(0, lastSep(p)) : "");
const basename = (p: string) => p.slice(lastSep(p) + 1);

function sharedValue(values: string[]): string | null {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null;
}

function buildGroup(id: string, tasks: DownloadTask[]): CompletedGroup {
  const content = tasks.filter((t) => !isExtra(t.filename)).sort((a, b) => b.total_bytes - a.total_bytes);
  const extras = tasks.filter((t) => isExtra(t.filename)).sort((a, b) => b.total_bytes - a.total_bytes);
  const prefix = tasks.every((t) => t.filename.includes("/")) ? sharedValue(tasks.map((t) => t.filename.split("/")[0])) : null;
  const folder = sharedValue(tasks.map((t) => dirname(t.destination)));
  const name = prefix ?? (tasks.length === 1 ? basename(tasks[0].filename) : (folder && basename(folder)) || basename(tasks[0].filename));
  return {
    id,
    name,
    prefix,
    files: [...content, ...extras],
    extras: extras.length,
    totalBytes: tasks.reduce((s, t) => s + t.total_bytes, 0),
    finishedAt: Math.max(0, ...tasks.map((t) => t.updated_at ?? 0)),
    folder: folder || null,
  };
}

/** Groups completed downloads by the torrent they came from. Order follows first appearance. */
export function groupCompleted(tasks: DownloadTask[]): CompletedGroup[] {
  const byId = new Map<string, DownloadTask[]>();
  for (const t of tasks) {
    const id = t.batch_id || t.id;
    const list = byId.get(id);
    if (list) list.push(t);
    else byId.set(id, [t]);
  }
  return [...byId].map(([id, list]) => buildGroup(id, list));
}

/** A file's name inside its group, without the torrent folder the group is already named after. */
export function fileLabel(t: DownloadTask, group: CompletedGroup): string {
  return group.prefix ? t.filename.slice(group.prefix.length + 1) : t.filename;
}
