import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import DataTable, { type Column } from "../components/DataTable";
import { Button, IconButton, Inspector, Toolbar } from "../components/ui";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import type { DownloadTask } from "../types";
import { formatBytes } from "../utils";

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const RemoveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "rotate-90 transition-transform" : "transition-transform"}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

/** Finished files of one torrent / archive's contents. */
interface Group {
  id: string;
  name: string;
  files: DownloadTask[];
  totalBytes: number;
  /** Deepest folder that holds every file of the group. */
  folder: string;
}

type Row = { kind: "group"; group: Group } | { kind: "task"; task: DownloadTask; child: boolean };

const groupKey = (id: string) => `batch:${id}`;

/** Common parent directory of local paths ("/" or "\\" separated). */
function commonFolder(paths: string[]): string {
  const split = (p: string) => p.split(/[\\/]/).slice(0, -1);
  let common = split(paths[0] ?? "");
  for (const p of paths.slice(1)) {
    const parts = split(p);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) break;
  }
  const sep = (paths[0] ?? "").includes("\\") ? "\\" : "/"; // Windows paths use backslashes
  return common.join(sep);
}

/** Reveal is only possible for files on this machine (local or symlinked), as before. */
const canReveal = (t: DownloadTask) => !!t.destination && (!t.remote || t.remote === "symlink");

function storageLabel(t: DownloadTask): string {
  if (t.remote === "symlink") return "Symlinked";
  if (t.remote) return `Remote (${t.remote})`;
  return "Local";
}

export default function CompletedPage() {
  const { tasks, refreshTasks } = useDownloadTasks();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const filterRef = useRef<HTMLInputElement>(null);

  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "Completed"), [tasks]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Files of one batch (a torrent, or an archive's contents) are listed under one folder row.
  const groups = useMemo(() => {
    const byBatch = new Map<string, DownloadTask[]>();
    for (const t of completedTasks) {
      if (!t.batch_id) continue;
      const list = byBatch.get(t.batch_id);
      if (list) list.push(t);
      else byBatch.set(t.batch_id, [t]);
    }
    const out = new Map<string, Group>();
    for (const [id, files] of byBatch) {
      if (files.length < 2) continue;
      const name = files.find((t) => t.batch_name)?.batch_name || "Batch";
      const local = files.filter((t) => !t.remote || t.remote === "symlink").map((t) => t.destination);
      out.set(id, {
        id,
        name,
        files,
        totalBytes: files.reduce((s, t) => s + Math.max(0, t.total_bytes), 0),
        folder: local.length === files.length ? commonFolder(local) : "",
      });
    }
    return out;
  }, [completedTasks]);

  const rows = useMemo(() => {
    const q = filter.toLowerCase();
    const matches = (t: DownloadTask) => !q || t.filename.toLowerCase().includes(q);
    const bySort = <T,>(list: T[], name: (x: T) => string, size: (x: T) => number) =>
      !sortKey
        ? list
        : [...list].sort((a, b) => {
            const cmp = sortKey === "filename" ? name(a).localeCompare(name(b)) : sortKey === "total_bytes" ? size(a) - size(b) : 0;
            return sortDirection === "asc" ? cmp : -cmp;
          });
    type Top = { kind: "group"; group: Group } | { kind: "task"; task: DownloadTask };
    const top: Top[] = [];
    const seen = new Set<string>();
    for (const t of completedTasks) {
      const g = t.batch_id ? groups.get(t.batch_id) : undefined;
      if (g) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          if (!q || g.name.toLowerCase().includes(q) || g.files.some(matches)) top.push({ kind: "group", group: g });
        }
      } else if (matches(t)) {
        top.push({ kind: "task", task: t });
      }
    }
    const sorted = bySort(
      top,
      (r) => (r.kind === "group" ? r.group.name : r.task.filename),
      (r) => (r.kind === "group" ? r.group.totalBytes : r.task.total_bytes),
    );
    const out: Row[] = [];
    for (const r of sorted) {
      if (r.kind === "task") {
        out.push({ kind: "task", task: r.task, child: false });
        continue;
      }
      out.push(r);
      const nameHit = q && r.group.name.toLowerCase().includes(q);
      if (expanded.has(r.group.id) || (q && !nameHit)) {
        const kids = q && !nameHit ? r.group.files.filter(matches) : r.group.files;
        for (const t of bySort(kids, (x) => x.filename, (x) => x.total_bytes)) out.push({ kind: "task", task: t, child: true });
      }
    }
    return out;
  }, [completedTasks, groups, expanded, filter, sortKey, sortDirection]);

  useEffect(() => {
    const onDeselect = () => setSelectedId(null);
    const onFocus = () => filterRef.current?.focus();
    const onToggle = () => setInspectorOpen((o) => !o);
    window.addEventListener("deselect-item", onDeselect);
    window.addEventListener("focus-filter", onFocus);
    window.addEventListener("toggle-inspector", onToggle);
    return () => {
      window.removeEventListener("deselect-item", onDeselect);
      window.removeEventListener("focus-filter", onFocus);
      window.removeEventListener("toggle-inspector", onToggle);
    };
  }, []);

  const handleClearAll = async () => {
    try {
      await downloadsApi.clearCompletedDownloads();
      refreshTasks();
    } catch { /* ignore */ }
  };

  const handleRemove = (t: DownloadTask) => {
    downloadsApi.removeDownload(t.id).then(() => refreshTasks()).catch(() => {});
    if (selectedId === t.id) setSelectedId(null);
  };

  const selectRow = (t: DownloadTask) => { setSelectedId(t.id); setInspectorOpen(true); };
  const clickRow = (r: Row) => {
    if (r.kind === "group") {
      setSelectedId(groupKey(r.group.id));
      toggleGroup(r.group.id);
    } else selectRow(r.task);
  };
  const handleRemoveGroup = (g: Group) => {
    downloadsApi.removeCompletedBatch(g.id).then(() => refreshTasks()).catch(() => {});
  };
  const selected = completedTasks.find((t) => t.id === selectedId) ?? null;
  const totalBytes = completedTasks.reduce((s, t) => s + t.total_bytes, 0);

  const taskColumns: Column<DownloadTask>[] = [
    {
      key: "filename",
      header: "Name",
      width: "minmax(0, 1fr)",
      sortable: true,
      render: (t) => (
        <div className="flex items-center gap-1.5">
          <span className="truncate text-base text-fg">{t.filename}</span>
          {t.remote && t.remote !== "symlink" && (
            <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>{t.remote}</title>
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
          )}
          {t.remote === "symlink" && (
            <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Symlinked</title>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          )}
        </div>
      ),
    },
    {
      key: "total_bytes",
      header: "Size",
      width: 20,
      sortable: true,
      render: (t) => <span className="text-base text-fg-secondary tabular">{formatBytes(t.total_bytes)}</span>,
    },
    {
      key: "destination",
      header: "Destination",
      width: "minmax(0, 0.6fr)",
      render: (t) => <span className="block truncate text-sm text-fg-muted" title={t.destination}>{t.destination || "--"}</span>,
    },
    {
      key: "actions",
      header: "",
      width: 16,
      render: (t) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canReveal(t) && (
            <IconButton label="Show in Folder" onClick={() => revealItemInDir(t.destination).catch(() => {})}>
              <FolderIcon />
            </IconButton>
          )}
          <IconButton label="Remove" variant="danger" onClick={() => handleRemove(t)}>
            <RemoveIcon />
          </IconButton>
        </div>
      ),
    },
  ];

  const groupCell: Record<string, (g: Group) => ReactNode> = {
    filename: (g) => (
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-fg-muted"><ChevronIcon open={expanded.has(g.id) || !!filter} /></span>
        <span className="shrink-0 text-fg-muted"><FolderIcon /></span>
        <span className="min-w-0 truncate text-base font-medium text-fg" title={g.name}>{g.name}</span>
        <span className="shrink-0 text-sm text-fg-muted tabular">{g.files.length.toLocaleString()} files</span>
      </div>
    ),
    total_bytes: (g) => <span className="text-base text-fg-secondary tabular">{formatBytes(g.totalBytes)}</span>,
    destination: (g) => <span className="block truncate text-sm text-fg-muted" title={g.folder}>{g.folder || "--"}</span>,
    actions: (g) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {g.folder && (
          <IconButton label="Show in Folder" onClick={() => revealItemInDir(g.folder).catch(() => {})}>
            <FolderIcon />
          </IconButton>
        )}
        <IconButton label="Remove all from the list (files stay on disk)" variant="danger" onClick={() => handleRemoveGroup(g)}>
          <RemoveIcon />
        </IconButton>
      </div>
    ),
  };
  const columns: Column<Row>[] = taskColumns.map((c) => ({
    ...c,
    render: (r: Row) => {
      if (r.kind === "group") return groupCell[c.key]?.(r.group) ?? null;
      const cell = c.render(r.task);
      return r.child && c.key === "filename" ? <div className="pl-7">{cell}</div> : cell;
    },
  }));

  return (
    <>
      <Toolbar
        title="Completed"
        subtitle={`${completedTasks.length} download${completedTasks.length !== 1 ? "s" : ""} · ${formatBytes(totalBytes)}`}
        filter={{ value: filter, onChange: setFilter, placeholder: "Filter completed", inputRef: filterRef }}
        actions={
          completedTasks.length > 0 ? (
            <Button onClick={handleClearAll}>Clear All</Button>
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(r) => (r.kind === "group" ? groupKey(r.group.id) : r.task.id)}
            onRowClick={clickRow}
            selectedId={selectedId}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
            emptyMessage="No completed downloads"
            emptySubtext="Downloads will appear here once they finish."
          />
        </div>

        {selected && (
          <Inspector
            id="completed"
            open={inspectorOpen}
            onClose={() => setSelectedId(null)}
            title={selected.filename}
            subtitle={formatBytes(selected.total_bytes)}
            footer={
              <>
                {canReveal(selected) && (
                  <Button onClick={() => revealItemInDir(selected.destination).catch(() => {})}>Show in Folder</Button>
                )}
                <Button variant="danger" onClick={() => handleRemove(selected)}>Remove</Button>
              </>
            }
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-fg-muted">Size</dt>
              <dd className="text-fg tabular">{formatBytes(selected.total_bytes)}</dd>
              <dt className="text-fg-muted">Saved to</dt>
              <dd className="break-all text-fg">{selected.destination || "--"}</dd>
              <dt className="text-fg-muted">Storage</dt>
              <dd className="text-fg">{storageLabel(selected)}</dd>
            </dl>
          </Inspector>
        )}
      </div>
    </>
  );
}
