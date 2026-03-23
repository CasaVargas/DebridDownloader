import { useEffect, useState, useMemo } from "react";
import DataTable, { type Column } from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import SlideOverPanel from "../components/SlideOverPanel";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import type { DownloadTask } from "../types";
import { formatBytes, formatSpeed, formatEta, getDownloadStatusText } from "../utils";

function isActive(status: DownloadTask["status"]): boolean {
  return status === "Downloading" || status === "Pending";
}

function statusBadgeClass(status: DownloadTask["status"]): string {
  if (status === "Downloading" || status === "Pending") return "bg-[rgba(59,130,246,0.12)] text-[#3b82f6]";
  if (status === "Cancelled") return "bg-[rgba(239,68,68,0.12)] text-[#ef4444]";
  if (typeof status === "object" && "Failed" in status) return "bg-[rgba(239,68,68,0.12)] text-[#ef4444]";
  return "bg-[rgba(148,163,184,0.12)] text-[#94a3b8]";
}

export default function DownloadsPage() {
  const { tasks } = useDownloadTasks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Only show non-completed tasks
  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "Completed"), [tasks]);

  const filtered = useMemo(() => {
    let result = activeTasks;
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
  }, [activeTasks, filter, sortKey, sortDirection]);

  const selectedTask = filtered.find((t) => t.id === selectedId) ?? null;

  // Window event listeners
  useEffect(() => {
    const handler = () => setSelectedId(null);
    window.addEventListener("deselect-item", handler);
    return () => window.removeEventListener("deselect-item", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      if (!selectedId) return;
      const task = activeTasks.find((t) => t.id === selectedId);
      if (task && isActive(task.status)) {
        downloadsApi.cancelDownload(selectedId).catch(() => {});
      } else {
        downloadsApi.removeDownload(selectedId).catch(() => {});
        setSelectedId(null);
      }
    };
    window.addEventListener("delete-selected", handler);
    return () => window.removeEventListener("delete-selected", handler);
  }, [selectedId, activeTasks]);


  const handleCancel = async (id: string) => {
    try { await downloadsApi.cancelDownload(id); } catch { /* ignore */ }
  };

  const handleRemove = async (id: string) => {
    try { await downloadsApi.removeDownload(id); } catch { /* ignore */ }
  };

  const handleCancelAll = async () => {
    try { await downloadsApi.cancelAllDownloads(); setSelectedId(null); } catch { /* ignore */ }
  };

  const handleClearInactive = async () => {
    try { await downloadsApi.clearCompletedDownloads(); setSelectedId(null); } catch { /* ignore */ }
  };

  const columns: Column<DownloadTask>[] = [
    {
      key: "filename",
      header: "Name",
      width: "1fr",
      sortable: true,
      render: (t) => {
        const active = isActive(t.status);
        const pct = t.total_bytes > 0 ? (t.downloaded_bytes / t.total_bytes) * 100 : 0;
        return (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-medium text-[var(--theme-text-primary)] truncate">{t.filename}</span>
              {t.remote && t.remote !== "symlink" && (
                <svg
                  className="w-3.5 h-3.5 shrink-0 text-[var(--theme-text-muted)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
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
            {active && pct > 0 && (
              <div className="mt-1.5 h-[3px] rounded-full bg-[rgba(59,130,246,0.08)]">
                <div className="h-full bg-[#3b82f6] rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "total_bytes",
      header: "Size",
      width: "100px",
      sortable: true,
      render: (t) => <span className="text-[14px] text-[var(--theme-text-secondary)]">{formatBytes(t.total_bytes)}</span>,
    },
    {
      key: "speed",
      header: "Speed",
      width: "100px",
      render: (t) => (
        <span className="text-[13px] text-[var(--theme-text-muted)]">
          {isActive(t.status) && t.speed > 0 ? formatSpeed(t.speed) : "--"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (t) => {
        if (isActive(t.status) && t.total_bytes > 0) {
          const pct = ((t.downloaded_bytes / t.total_bytes) * 100).toFixed(1);
          return <span className="text-[13px] text-[#3b82f6] font-medium">{pct}%</span>;
        }
        return (
          <span className={`text-[12px] px-2.5 py-1 rounded-md font-medium ${statusBadgeClass(t.status)}`}>
            {getDownloadStatusText(t.status)}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      width: "70px",
      render: (t) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {isActive(t.status) ? (
            <button
              onClick={() => handleCancel(t.id)}
              className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#ef4444] cursor-pointer"
              style={{ background: "rgba(239,68,68,0.08)" }}
              title="Cancel"
            >
              ×
            </button>
          ) : (
            <button
              onClick={() => handleRemove(t.id)}
              className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#ef4444] cursor-pointer"
              style={{ background: "rgba(239,68,68,0.08)" }}
              title="Remove"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <TableToolbar
        title="Downloads"
        subtitle={`${activeTasks.length} active`}
        filterPlaceholder="Filter downloads..."
        filterValue={filter}
        onFilterChange={setFilter}
        actions={
          activeTasks.length > 0 ? (
            <div className="flex items-center gap-2">
              {activeTasks.some((t) => !isActive(t.status)) && (
                <button
                  onClick={handleClearInactive}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
                  style={{ background: "var(--theme-selected)" }}
                >
                  Clear Inactive
                </button>
              )}
              <button
                onClick={handleCancelAll}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#ef4444] hover:text-[#dc2626] transition-colors cursor-pointer"
                style={{ background: "rgba(239,68,68,0.08)" }}
              >
                Cancel All
              </button>
            </div>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(t) => t.id}
        onRowClick={(t) => setSelectedId(t.id)}
        selectedId={selectedId}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
        emptyMessage="No active downloads"
        emptySubtext="Download torrents from the Torrents page"
      />

      {/* Slide-over */}
      <SlideOverPanel open={!!selectedTask} onClose={() => setSelectedId(null)}>
        {selectedTask && (() => {
          const task = selectedTask;
          const active = isActive(task.status);
          const pct = task.total_bytes > 0 ? (task.downloaded_bytes / task.total_bytes) * 100 : 0;
          const isFailed = typeof task.status === "object" && "Failed" in task.status;
          const isCancelled = task.status === "Cancelled";

          return (
            <>
              {/* Header */}
              <div className="px-6 py-5 border-b border-[var(--theme-border)] flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <h3 className="text-[18px] font-bold text-[var(--theme-text-primary)] leading-snug break-words">
                    {task.filename}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] shrink-0"
                  style={{ background: "var(--theme-selected)" }}
                >
                  ×
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {active && (
                  <>
                    <div className="text-[28px] font-semibold text-[#3b82f6] mb-3">
                      {pct.toFixed(1)}%
                    </div>
                    <div className="h-1 rounded-full bg-[rgba(59,130,246,0.08)] mb-5">
                      <div className="h-full rounded-full bg-[#3b82f6] transition-all duration-300" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                        <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">Speed</div>
                        <div className="text-[15px] text-[var(--theme-text-primary)] font-medium">{task.speed > 0 ? formatSpeed(task.speed) : "--"}</div>
                      </div>
                      <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                        <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">ETA</div>
                        <div className="text-[15px] text-[var(--theme-text-primary)] font-medium">{formatEta(task.total_bytes, task.downloaded_bytes, task.speed)}</div>
                      </div>
                      <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                        <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">Downloaded</div>
                        <div className="text-[15px] text-[var(--theme-text-primary)] font-medium">{formatBytes(task.downloaded_bytes)} <span className="text-[var(--theme-text-muted)]">of</span> {formatBytes(task.total_bytes)}</div>
                      </div>
                      <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px]">Destination</span>
                          {task.remote && task.remote !== "symlink" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded text-[var(--accent)]" style={{ background: "var(--accent-bg-medium)" }}>
                              Remote
                            </span>
                          )}
                          {task.remote === "symlink" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded text-[var(--accent)]" style={{ background: "var(--accent-bg-medium)" }}>
                              Symlink
                            </span>
                          )}
                        </div>
                        <div className="text-[14px] text-[var(--theme-text-primary)] font-medium truncate">{task.destination || "--"}</div>
                      </div>
                    </div>
                  </>
                )}

                {(isFailed || isCancelled) && (
                  <div className="flex flex-col gap-3">
                    <p className="text-[#ef4444] text-[15px]">{getDownloadStatusText(task.status)}</p>
                    {task.destination && (
                      <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px]">Destination</span>
                          {task.remote && task.remote !== "symlink" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded text-[var(--accent)]" style={{ background: "var(--accent-bg-medium)" }}>
                              Remote
                            </span>
                          )}
                          {task.remote === "symlink" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded text-[var(--accent)]" style={{ background: "var(--accent-bg-medium)" }}>
                              Symlink
                            </span>
                          )}
                        </div>
                        <div className="text-[15px] text-[var(--theme-text-primary)] font-medium break-all">{task.destination}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-[var(--theme-border)] flex gap-2.5">
                {active && (
                  <button
                    onClick={() => handleCancel(task.id)}
                    className="py-3 px-5 rounded-[10px] text-[#ef4444] text-[14px] transition-colors"
                    style={{ background: "rgba(239,68,68,0.06)" }}
                  >
                    Cancel Download
                  </button>
                )}
              </div>
            </>
          );
        })()}
      </SlideOverPanel>

    </>
  );
}
