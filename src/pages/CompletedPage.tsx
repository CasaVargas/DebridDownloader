import { useState, useMemo } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import DataTable, { type Column } from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import type { DownloadTask } from "../types";
import { formatBytes } from "../utils";

export default function CompletedPage() {
  const { tasks, refreshTasks } = useDownloadTasks();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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

  const handleClearAll = async () => {
    try {
      await downloadsApi.clearCompletedDownloads();
      refreshTasks();
    } catch { /* ignore */ }
  };

  const columns: Column<DownloadTask>[] = [
    {
      key: "filename",
      header: "Name",
      width: "1fr",
      sortable: true,
      render: (t) => (
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-medium text-[var(--theme-text-primary)] truncate">{t.filename}</span>
          {t.remote && t.remote !== "symlink" && (
            <svg className="w-3.5 h-3.5 shrink-0 text-[var(--theme-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>{t.remote}</title>
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
          )}
          {t.remote === "symlink" && (
            <svg
              className="w-3.5 h-3.5 shrink-0 text-[var(--theme-text-muted)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
      width: "100px",
      sortable: true,
      render: (t) => <span className="text-[14px] text-[var(--theme-text-secondary)]">{formatBytes(t.total_bytes)}</span>,
    },
    {
      key: "destination",
      header: "Destination",
      width: "0.5fr",
      render: (t) => <span className="text-[13px] text-[var(--theme-text-muted)] truncate block">{t.destination || "--"}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "160px",
      render: (t) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {t.destination && (!t.remote || t.remote === "symlink") && (
            <button
              onClick={(e) => { e.stopPropagation(); revealItemInDir(t.destination).catch(() => {}); }}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-[var(--accent)] hover:bg-[var(--accent-bg-light)] transition-colors"
            >
              Reveal
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadsApi.removeDownload(t.id).then(() => refreshTasks()).catch(() => {});
            }}
            className="px-3 py-1.5 rounded-md text-[13px] font-medium text-[#ef4444] hover:bg-[rgba(239,68,68,0.08)] transition-colors"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <TableToolbar
        title="Completed"
        subtitle={`${completedTasks.length} download${completedTasks.length !== 1 ? "s" : ""}`}
        filterPlaceholder="Filter completed..."
        filterValue={filter}
        onFilterChange={setFilter}
        actions={
          completedTasks.length > 0 ? (
            <button
              onClick={handleClearAll}
              className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] text-[14px] transition-colors"
            >
              Clear All
            </button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(t) => t.id}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
        emptyMessage="No completed downloads"
        emptySubtext="Downloads will appear here once they finish."
      />

    </>
  );
}
