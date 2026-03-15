import { useEffect, useState, useMemo } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import DataTable, { type Column } from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import SlideOverPanel from "../components/SlideOverPanel";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import type { DownloadTask } from "../types";
import { formatBytes } from "../utils";

export default function CompletedPage() {
  const { tasks, refreshTasks } = useDownloadTasks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);

  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "Completed"), [tasks]);

  // Close context menu
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

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

  const selectedTask = filtered.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    const handler = () => setSelectedId(null);
    window.addEventListener("deselect-item", handler);
    return () => window.removeEventListener("deselect-item", handler);
  }, []);

  const handleClearAll = async () => {
    try {
      await downloadsApi.clearCompletedDownloads();
      refreshTasks();
      setSelectedId(null);
    } catch { /* ignore */ }
  };

  const columns: Column<DownloadTask>[] = [
    {
      key: "filename",
      header: "Name",
      width: "1fr",
      sortable: true,
      render: (t) => <div className="text-[15px] font-medium text-[#f1f5f9] truncate">{t.filename}</div>,
    },
    {
      key: "total_bytes",
      header: "Size",
      width: "100px",
      sortable: true,
      render: (t) => <span className="text-[14px] text-[#94a3b8]">{formatBytes(t.total_bytes)}</span>,
    },
    {
      key: "destination",
      header: "Destination",
      width: "0.5fr",
      render: (t) => <span className="text-[13px] text-[#64748b] truncate block">{t.destination || "--"}</span>,
    },
    {
      key: "actions",
      header: "",
      width: "70px",
      render: (t) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, taskId: t.id });
            }}
            className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#64748b]"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            ···
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
              className="text-[#475569] hover:text-[#94a3b8] text-[14px] transition-colors"
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
        onRowClick={(t) => setSelectedId(t.id)}
        selectedId={selectedId}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
        emptyMessage="No completed downloads"
        emptySubtext="Downloads will appear here once they finish."
      />

      {/* Slide-over */}
      <SlideOverPanel open={!!selectedTask} onClose={() => setSelectedId(null)}>
        {selectedTask && (
          <>
            {/* Header */}
            <div className="px-6 py-5 border-b border-[rgba(255,255,255,0.06)] flex justify-between items-start gap-3">
              <div className="min-w-0">
                <h3 className="text-[18px] font-bold text-[#f1f5f9] leading-snug break-words">
                  {selectedTask.filename}
                </h3>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#64748b] hover:text-[#f1f5f9] shrink-0"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Checkmark */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-full bg-[rgba(16,185,129,0.12)] flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span className="text-[15px] text-[#10b981] font-medium">Download complete</span>
              </div>

              {/* Info cards */}
              <div className="flex flex-col gap-2.5">
                <div className="bg-[rgba(255,255,255,0.03)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-1.5">Size</div>
                  <div className="text-[17px] text-[#f1f5f9] font-semibold">{formatBytes(selectedTask.total_bytes)}</div>
                </div>
                {selectedTask.destination && (
                  <div className="bg-[rgba(255,255,255,0.03)] rounded-[10px] p-3.5">
                    <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-1.5">Saved to</div>
                    <div className="text-[15px] text-[#f1f5f9] font-medium break-all">{selectedTask.destination}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[rgba(255,255,255,0.06)] flex gap-2.5">
              {selectedTask.destination && (
                <button
                  onClick={() => openPath(selectedTask.destination).catch(() => {})}
                  className="flex-1 py-3 rounded-[10px] text-white text-[15px] font-semibold transition-colors"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
                >
                  Reveal in Finder
                </button>
              )}
              <button
                onClick={() => { setSelectedId(null); handleClearAll(); }}
                className="py-3 px-5 rounded-[10px] text-[#ef4444] text-[14px] transition-colors"
                style={{ background: "rgba(239,68,68,0.06)" }}
              >
                Remove
              </button>
            </div>
          </>
        )}
      </SlideOverPanel>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-[#0f0f18] border border-[rgba(255,255,255,0.06)] rounded-lg py-1.5 w-52 z-[60] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 240),
            top: Math.min(contextMenu.y, window.innerHeight - 120),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const menuTask = filtered.find((t) => t.id === contextMenu.taskId);
            return (
              <>
                {menuTask?.destination && (
                  <button
                    className="w-full text-left px-4 py-2.5 text-[15px] text-[#f1f5f9] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    onClick={() => { setContextMenu(null); openPath(menuTask.destination).catch(() => {}); }}
                  >
                    Reveal in Finder
                  </button>
                )}
                <button
                  className="w-full text-left px-4 py-2.5 text-[15px] text-[#ef4444] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                  onClick={() => { setContextMenu(null); handleClearAll(); }}
                >
                  Remove
                </button>
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}
