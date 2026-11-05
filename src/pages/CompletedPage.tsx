import { useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import DataTable, { type Column } from "../components/DataTable";
import { Button, cn, IconButton, Inspector, Toolbar } from "../components/ui";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import { fileLabel, groupCompleted, isExtra, type CompletedGroup } from "../lib/completedGroups";
import type { DownloadTask } from "../types";
import { formatBytes, formatRelativeTime } from "../utils";

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
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    className={cn("transition-transform duration-120 motion-reduce:transition-none", open && "rotate-90")}
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/** Cloud for rclone remotes, chain link for symlinks; nothing for plain local files. */
function StorageIcon({ t }: { t: DownloadTask }) {
  if (t.remote === "symlink") {
    return (
      <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <title>Symlinked</title>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  if (t.remote) {
    return (
      <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <title>{t.remote}</title>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
    );
  }
  return null;
}

/** Reveal is only possible for files on this machine (local or symlinked), as before. */
const canReveal = (t: DownloadTask) => !!t.destination && (!t.remote || t.remote === "symlink");

function storageLabel(t: DownloadTask): string {
  if (t.remote === "symlink") return "Symlinked";
  if (t.remote) return `Remote (${t.remote})`;
  return "Local";
}

const finishedLabel = (ms: number) => (ms > 0 ? formatRelativeTime(new Date(ms).toISOString()) : "--");
const finishedFull = (ms: number) =>
  ms > 0 ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "--";

/** One table row: a torrent, one of its files, or the toggle that shows its extras. */
type Row =
  | { kind: "group"; key: string; group: CompletedGroup }
  | { kind: "file"; key: string; group: CompletedGroup; task: DownloadTask }
  | { kind: "extras"; key: string; group: CompletedGroup };

const toggled = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export default function CompletedPage() {
  const { tasks, refreshTasks } = useDownloadTasks();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>("finished");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [extrasOpen, setExtrasOpen] = useState<Set<string>>(new Set());
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const filterRef = useRef<HTMLInputElement>(null);

  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "Completed"), [tasks]);
  const groups = useMemo(() => groupCompleted(completedTasks), [completedTasks]);

  const sortedGroups = useMemo(() => {
    let result = groups;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter((g) => g.name.toLowerCase().includes(q) || g.files.some((t) => t.filename.toLowerCase().includes(q)));
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "name") cmp = a.name.localeCompare(b.name);
        else if (sortKey === "size") cmp = a.totalBytes - b.totalBytes;
        else if (sortKey === "finished") cmp = a.finishedAt - b.finishedAt;
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [groups, filter, sortKey, sortDirection]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const group of sortedGroups) {
      out.push({ kind: "group", key: `group:${group.id}`, group });
      if (group.files.length < 2 || !expanded.has(group.id)) continue;
      const content = group.files.slice(0, group.files.length - group.extras);
      const extras = group.files.slice(content.length);
      for (const task of content) out.push({ kind: "file", key: task.id, group, task });
      // Extras sit behind a toggle, unless they're all the torrent has.
      if (content.length > 0 && extras.length > 0) out.push({ kind: "extras", key: `extras:${group.id}`, group });
      if (content.length === 0 || extrasOpen.has(group.id)) {
        for (const task of extras) out.push({ kind: "file", key: task.id, group, task });
      }
    }
    return out;
  }, [sortedGroups, expanded, extrasOpen]);

  const selectedRow = rows.find((r) => r.key === selectedKey) ?? null;

  /** Collapsing hides the selected file, so the selection moves up to the row that hid it. */
  const toggleGroup = (group: CompletedGroup) => {
    if (expanded.has(group.id) && selectedRow && selectedRow.kind !== "group" && selectedRow.group.id === group.id) {
      setSelectedKey(`group:${group.id}`);
    }
    setExpanded((s) => toggled(s, group.id));
  };
  const toggleExtras = (group: CompletedGroup) => {
    if (extrasOpen.has(group.id) && selectedRow?.kind === "file" && selectedRow.group.id === group.id && isExtra(selectedRow.task.filename)) {
      setSelectedKey(`extras:${group.id}`);
    }
    setExtrasOpen((s) => toggled(s, group.id));
  };

  useEffect(() => {
    const onDeselect = () => setSelectedKey(null);
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

  // Enter opens or closes the selected torrent (or its extras).
  useEffect(() => {
    const onAction = () => {
      if (selectedRow?.kind === "group" && selectedRow.group.files.length > 1) toggleGroup(selectedRow.group);
      else if (selectedRow?.kind === "extras") toggleExtras(selectedRow.group);
    };
    window.addEventListener("action-selected", onAction);
    return () => window.removeEventListener("action-selected", onAction);
  }, [selectedKey, rows]);

  const handleClearAll = async () => {
    try {
      await downloadsApi.clearCompletedDownloads();
      refreshTasks();
    } catch { /* ignore */ }
  };

  /** Drops the entries from the list; the engine never deletes finished files. */
  const handleRemove = async (row: Row) => {
    const list = row.kind === "file" ? [row.task] : row.group.files;
    if (selectedKey === row.key || (row.kind !== "file" && selectedRow?.group.id === row.group.id)) setSelectedKey(null);
    for (const t of list) await downloadsApi.removeDownload(t.id).catch(() => {});
    refreshTasks();
  };

  const reveal = (t: DownloadTask) => revealItemInDir(t.destination).catch(() => {});
  /** A torrent reveals its largest file, which opens the torrent's folder with the main file picked out. */
  const revealTarget = (row: Row) => (row.kind === "file" ? row.task : row.group.files[0]);

  const selectRow = (row: Row) => { setSelectedKey(row.key); setInspectorOpen(true); };
  const clickRow = (row: Row) => {
    if (row.kind === "extras") toggleExtras(row.group);
    selectRow(row);
  };

  const totalBytes = completedTasks.reduce((s, t) => s + t.total_bytes, 0);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      width: "minmax(0, 1fr)",
      sortable: true,
      render: (row) => {
        if (row.kind === "extras") {
          return (
            <span className="pl-7.5 text-sm text-fg-muted">
              {extrasOpen.has(row.group.id) ? "Show fewer" : `+ ${row.group.extras} more`}
            </span>
          );
        }
        if (row.kind === "file") {
          const label = fileLabel(row.task, row.group);
          return (
            <div className="truncate pl-7.5 text-base" title={label}>
              <span className={isExtra(row.task.filename) ? "text-fg-muted" : "text-fg"}>{label}</span>
            </div>
          );
        }
        const g = row.group;
        const open = expanded.has(g.id);
        return (
          <div className="flex items-center gap-1.5">
            {g.files.length > 1 ? (
              <IconButton
                size="sm"
                label={open ? "Collapse" : "Expand"}
                aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); toggleGroup(g); }}
              >
                <ChevronIcon open={open} />
              </IconButton>
            ) : (
              <span className="size-6 shrink-0" aria-hidden />
            )}
            <span className="truncate text-base text-fg" title={g.name}>{g.name}</span>
            {g.files.length > 1 && <span className="shrink-0 text-sm text-fg-muted tabular">{g.files.length} files</span>}
            <StorageIcon t={g.files[0]} />
          </div>
        );
      },
    },
    {
      key: "size",
      header: "Size",
      width: 20,
      sortable: true,
      render: (row) =>
        row.kind === "extras" ? null : (
          <span className={cn("text-base tabular", row.kind === "group" ? "text-fg-secondary" : "text-fg-muted")}>
            {formatBytes(row.kind === "file" ? row.task.total_bytes : row.group.totalBytes)}
          </span>
        ),
    },
    {
      key: "finished",
      header: "Finished",
      width: 26,
      sortable: true,
      render: (row) =>
        row.kind === "group" ? <span className="text-sm text-fg-muted tabular">{finishedLabel(row.group.finishedAt)}</span> : null,
    },
    {
      key: "actions",
      header: "",
      width: 16,
      render: (row) =>
        row.kind === "extras" ? null : (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canReveal(revealTarget(row)) && (
              <IconButton label="Show in Folder" onClick={() => reveal(revealTarget(row))}>
                <FolderIcon />
              </IconButton>
            )}
            <IconButton label="Remove from list" variant="danger" onClick={() => handleRemove(row)}>
              <RemoveIcon />
            </IconButton>
          </div>
        ),
    },
  ];

  const inspected = selectedRow;
  const g = inspected?.group;

  return (
    <>
      <Toolbar
        title="Completed"
        subtitle={`${groups.length} torrent${groups.length !== 1 ? "s" : ""} · ${formatBytes(totalBytes)}`}
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
            rowKey={(r) => r.key}
            onRowClick={clickRow}
            onKeyboardSelect={selectRow}
            selectedId={selectedKey}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
            emptyMessage="No completed downloads"
            emptySubtext="Downloads will appear here once they finish."
          />
        </div>

        {inspected && g && (
          <Inspector
            id="completed"
            open={inspectorOpen}
            onClose={() => setSelectedKey(null)}
            title={inspected.kind === "file" ? fileLabel(inspected.task, g) : g.name}
            subtitle={
              inspected.kind === "file"
                ? formatBytes(inspected.task.total_bytes)
                : g.files.length > 1 ? `${g.files.length} files · ${formatBytes(g.totalBytes)}` : formatBytes(g.totalBytes)
            }
            footer={
              <>
                {canReveal(revealTarget(inspected)) && (
                  <Button onClick={() => reveal(revealTarget(inspected))}>Show in Folder</Button>
                )}
                <Button variant="danger" title="Removes it from this list. The files stay on disk." onClick={() => handleRemove(inspected)}>
                  Remove
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">
              {inspected.kind === "file" ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  {g.files.length > 1 && (
                    <>
                      <dt className="text-fg-muted">Torrent</dt>
                      <dd className="break-words text-fg">{g.name}</dd>
                    </>
                  )}
                  <dt className="text-fg-muted">Finished</dt>
                  <dd className="text-fg tabular">{finishedFull(inspected.task.updated_at ?? 0)}</dd>
                  <dt className="text-fg-muted">Saved to</dt>
                  <dd className="break-all text-fg">{inspected.task.destination || "--"}</dd>
                  <dt className="text-fg-muted">Storage</dt>
                  <dd className="text-fg">{storageLabel(inspected.task)}</dd>
                </dl>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-fg-muted">Finished</dt>
                  <dd className="text-fg tabular">{finishedFull(g.finishedAt)}</dd>
                  <dt className="text-fg-muted">Saved to</dt>
                  <dd className="break-all text-fg">{g.files.length === 1 ? g.files[0].destination || "--" : g.folder ?? "Several folders"}</dd>
                  <dt className="text-fg-muted">Storage</dt>
                  <dd className="text-fg">{storageLabel(g.files[0])}</dd>
                </dl>
              )}

              {inspected.kind !== "file" && g.files.length > 1 && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">Files ({g.files.length})</div>
                  <div className="rounded-md border border-border">
                    {g.files.map((t) => (
                      <div key={t.id} className="flex items-start gap-2 border-b border-border-subtle px-2 py-1.5 last:border-b-0">
                        <span className={cn("min-w-0 flex-1 break-words text-sm", isExtra(t.filename) ? "text-fg-muted" : "text-fg")}>
                          {fileLabel(t, g)}
                        </span>
                        <span className="shrink-0 text-sm text-fg-muted tabular">{formatBytes(t.total_bytes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Inspector>
        )}
      </div>
    </>
  );
}
