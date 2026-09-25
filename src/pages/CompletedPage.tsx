import { useEffect, useMemo, useRef, useState } from "react";
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

  const filtered = useMemo(() => {
    let result = completedTasks;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter((t) => t.filename.toLowerCase().includes(q));
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "filename") cmp = a.filename.localeCompare(b.filename);
        else if (sortKey === "total_bytes") cmp = a.total_bytes - b.total_bytes;
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [completedTasks, filter, sortKey, sortDirection]);

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
  const selected = completedTasks.find((t) => t.id === selectedId) ?? null;
  const totalBytes = completedTasks.reduce((s, t) => s + t.total_bytes, 0);

  const columns: Column<DownloadTask>[] = [
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
            data={filtered}
            rowKey={(t) => t.id}
            onRowClick={selectRow}
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
