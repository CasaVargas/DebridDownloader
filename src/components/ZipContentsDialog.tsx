import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as archiveApi from "../api/archive";
import { getSettings } from "../api/settings";
import type { ZipEntry, ZipInspection } from "../types";
import { formatBytes } from "../utils";
import { Button, Dialog, Input, Spinner } from "./ui";

/**
 * "Download contents" for a ZIP inside a torrent: lists the archive remotely and downloads each
 * selected file straight into place, so a large archive never has to be unzipped afterwards.
 */
export default function ZipContentsDialog({
  torrentId,
  fileId,
  fileName,
  torrentName,
  onClose,
  onStarted,
}: {
  torrentId: string;
  fileId: number;
  fileName: string;
  torrentName?: string;
  onClose(): void;
  onStarted(root: string, count: number): void;
}) {
  const [info, setInfo] = useState<ZipInspection | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    archiveApi
      .inspectTorrentZip(torrentId, fileId)
      .then((data) => {
        if (!alive) return;
        setInfo(data);
        setSelected(new Set(data.entries.filter((e) => !e.is_dir && !e.unsupported).map((e) => e.path)));
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [torrentId, fileId]);

  const files = useMemo(() => (info?.entries ?? []).filter((e) => !e.is_dir), [info]);
  const usable = useMemo(() => files.filter((e) => !e.unsupported), [files]);
  const unsupported = files.length - usable.length;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((e) => e.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);

  const chosen = usable.filter((e) => selected.has(e.path));
  const chosenBytes = chosen.reduce((s, e) => s + e.size, 0);
  const compressedCount = chosen.filter((e) => e.method !== 0).length;
  const allSelected = usable.length > 0 && chosen.length === usable.length;

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const setVisible = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of visible) {
        if (e.unsupported) continue;
        if (on) next.add(e.path);
        else next.delete(e.path);
      }
      return next;
    });

  const start = async () => {
    if (!info || chosen.length === 0) return;
    setStarting(true);
    setError("");
    try {
      const s = await getSettings();
      let folder = s.download_folder;
      if (!folder) {
        const picked = await open({ directory: true, title: "Select download folder" });
        if (!picked) return;
        folder = picked as string;
      }
      // Empty folders only come along when the whole archive is selected.
      const dirs = allSelected ? (info.entries ?? []).filter((e) => e.is_dir) : [];
      const result = await archiveApi.startZipContentsDownload(
        info.link,
        info.archive_size,
        [...dirs, ...chosen] as ZipEntry[],
        folder,
        torrentName
      );
      onStarted(result.root, result.ids.length);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Download contents"
      description={
        info
          ? `${fileName} · ${files.length} files · ${formatBytes(files.reduce((s, e) => s + e.size, 0))} unpacked`
          : fileName
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={start} disabled={!info || chosen.length === 0 || starting}>
            {starting ? "Starting..." : `Download ${chosen.length} ${chosen.length === 1 ? "file" : "files"} (${formatBytes(chosenBytes)})`}
          </Button>
        </>
      }
    >
      {!info && !error && (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-fg-muted">
          <Spinner />
          Reading the archive's file list…
        </div>
      )}
      {error && <p className="mb-3 text-sm text-danger" role="alert">{error}</p>}
      {info && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-secondary">
            Each file is downloaded straight out of the archive into its folder. The ZIP itself is never
            saved, so there is nothing to unzip afterwards.
            {compressedCount > 0 &&
              ` ${compressedCount} compressed ${compressedCount === 1 ? "file is" : "files are"} unpacked as soon as each one finishes.`}
          </p>
          {unsupported > 0 && (
            <p className="text-sm text-warning">
              {unsupported} {unsupported === 1 ? "file" : "files"} can't be taken out of the archive remotely (see below). Download
              the whole ZIP to get {unsupported === 1 ? "it" : "them"}.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input className="flex-1" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button size="sm" onClick={() => setVisible(true)}>
              Select all
            </Button>
            <Button size="sm" onClick={() => setVisible(false)}>
              None
            </Button>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-md border border-border">
            {visible.map((e) => {
              const slash = e.path.lastIndexOf("/");
              const folder = slash >= 0 ? e.path.slice(0, slash + 1) : "";
              const name = slash >= 0 ? e.path.slice(slash + 1) : e.path;
              return (
                <label
                  key={e.path}
                  className="flex min-h-7.5 items-center gap-2 border-b border-border-subtle px-2 py-1 last:border-b-0 hover:bg-raised"
                  title={e.unsupported ?? e.path}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.path}`}
                    checked={!e.unsupported && selected.has(e.path)}
                    disabled={!!e.unsupported}
                    onChange={() => toggle(e.path)}
                    className="size-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="text-fg-muted">{folder}</span>
                    <span className={e.unsupported ? "text-fg-muted line-through" : "text-fg"}>{name}</span>
                    {e.unsupported && <span className="ml-2 text-xs text-warning">{e.unsupported}</span>}
                  </span>
                  <span className="shrink-0 text-sm text-fg-muted tabular">{formatBytes(e.size)}</span>
                </label>
              );
            })}
            {visible.length === 0 && <p className="px-2 py-3 text-sm text-fg-muted">No files match.</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
