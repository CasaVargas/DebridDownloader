import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import DataTable, { type Column } from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import SlideOverPanel from "../components/SlideOverPanel";
import AddTorrentModal from "../components/AddTorrentModal";
import * as torrentsApi from "../api/torrents";
import * as downloadsApi from "../api/downloads";
import { getSettings } from "../api/settings";
import type { Torrent, TorrentInfo, AppSettings } from "../types";
import {
  formatBytes,
  formatRelativeTime,
  torrentStatusLabel,
} from "../utils";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "downloaded":
      return "bg-[rgba(16,185,129,0.12)] text-[#10b981]";
    case "downloading":
      return "bg-[rgba(59,130,246,0.12)] text-[#3b82f6]";
    case "waiting_files_selection":
    case "queued":
    case "magnet_conversion":
      return "bg-[rgba(234,179,8,0.12)] text-[#eab308]";
    case "error":
    case "dead":
    case "magnet_error":
      return "bg-[rgba(239,68,68,0.12)] text-[#ef4444]";
    default:
      return "bg-[rgba(148,163,184,0.12)] text-[#94a3b8]";
  }
}

export default function TorrentsPage() {
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>("added");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; torrentId: string } | null>(null);

  // Slide-over detail state
  const [detailInfo, setDetailInfo] = useState<TorrentInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const fetchTorrents = useCallback(async () => {
    try {
      setLoading(true);
      const data = await torrentsApi.listTorrents(1, 500);
      setTorrents(data);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTorrents(); }, [fetchTorrents]);
  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);

  // Fetch detail when selectedId changes
  useEffect(() => {
    if (!selectedId) { setDetailInfo(null); return; }
    const fetchInfo = async () => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const data = await torrentsApi.getTorrentInfo(selectedId);
        setDetailInfo(data);
        setSelectedFiles(new Set(data.files.filter((f) => f.selected === 1).map((f) => f.id)));
      } catch (e) {
        setDetailError(String(e));
      } finally {
        setDetailLoading(false);
      }
    };
    fetchInfo();
  }, [selectedId]);

  // Window event listeners
  useEffect(() => {
    const handler = () => fetchTorrents();
    window.addEventListener("refresh-list", handler);
    return () => window.removeEventListener("refresh-list", handler);
  }, [fetchTorrents]);

  useEffect(() => {
    const handler = (e: Event) => setSelectedId((e as CustomEvent).detail);
    window.addEventListener("torrent-select", handler);
    return () => window.removeEventListener("torrent-select", handler);
  }, []);

  useEffect(() => {
    const handler = () => setSelectedId(null);
    window.addEventListener("deselect-item", handler);
    return () => window.removeEventListener("deselect-item", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      if (selectedId && window.confirm("Delete this torrent?")) handleDelete(selectedId);
    };
    window.addEventListener("delete-selected", handler);
    return () => window.removeEventListener("delete-selected", handler);
  }, [selectedId]);

  useEffect(() => {
    const handler = () => { if (selectedId) handleDownloadTorrent(selectedId); };
    window.addEventListener("action-selected", handler);
    return () => window.removeEventListener("action-selected", handler);
  }, [selectedId, settings]);

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

  const handleDelete = async (id: string) => {
    try {
      await torrentsApi.deleteTorrent(id);
      setTorrents((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e) { setError(String(e)); }
  };

  const handleDownloadTorrent = async (id: string) => {
    const torrent = torrents.find((t) => t.id === id);
    if (!torrent) return;
    try {
      let folder = settings?.download_folder ?? null;
      if (!folder) {
        const picked = await open({ directory: true, title: "Select download folder" });
        if (!picked) return;
        folder = picked as string;
      }
      const links = await downloadsApi.unrestrictTorrentLinks(id);
      if (links.length > 0) await downloadsApi.startDownloads(links, folder, torrent.filename);
    } catch (e) { setError(String(e)); }
  };

  const handleSelectFiles = async () => {
    if (!detailInfo) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedFiles).join(",");
      await torrentsApi.selectTorrentFiles(detailInfo.id, ids || "all");
      fetchTorrents();
    } catch (e) { setDetailError(String(e)); }
    finally { setSaving(false); }
  };

  const handleDetailDownload = async () => {
    if (!detailInfo) return;
    setDownloading(true);
    try {
      const s = await getSettings();
      let folder = s.download_folder;
      if (!folder) {
        const picked = await open({ directory: true, title: "Select download folder" });
        if (!picked) { setDownloading(false); return; }
        folder = picked as string;
      }
      const links = await downloadsApi.unrestrictTorrentLinks(detailInfo.id);
      if (links.length > 0) await downloadsApi.startDownloads(links, folder, detailInfo.filename);
      fetchTorrents();
    } catch (e) { setDetailError(String(e)); }
    finally { setDownloading(false); }
  };

  const handleDetailDelete = async () => {
    if (!detailInfo || !window.confirm("Delete this torrent?")) return;
    try {
      await torrentsApi.deleteTorrent(detailInfo.id);
      setSelectedId(null);
      fetchTorrents();
    } catch (e) { setDetailError(String(e)); }
  };

  // Sort + filter
  const filtered = useMemo(() => {
    let result = torrents;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter((t) => t.filename.toLowerCase().includes(q));
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "filename") cmp = a.filename.localeCompare(b.filename);
        else if (sortKey === "bytes") cmp = a.bytes - b.bytes;
        else if (sortKey === "added") cmp = new Date(a.added).getTime() - new Date(b.added).getTime();
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [torrents, filter, sortKey, sortDirection]);

  const totalBytes = torrents.reduce((s, t) => s + t.bytes, 0);

  const columns: Column<Torrent>[] = [
    {
      key: "filename",
      header: "Name",
      width: "1fr",
      sortable: true,
      render: (t) => (
        <div className="text-[15px] font-medium text-[#f1f5f9] truncate">{t.filename}</div>
      ),
    },
    {
      key: "bytes",
      header: "Size",
      width: "100px",
      sortable: true,
      render: (t) => <span className="text-[14px] text-[#94a3b8]">{formatBytes(t.bytes)}</span>,
    },
    {
      key: "added",
      header: "Added",
      width: "110px",
      sortable: true,
      render: (t) => <span className="text-[13px] text-[#64748b]">{formatRelativeTime(t.added)}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (t) => (
        <span className={`text-[12px] px-2.5 py-1 rounded-md font-medium ${statusBadgeClass(t.status)}`}>
          {torrentStatusLabel(t.status)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      render: (t) => (
        <div className="flex gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
          {t.status === "downloaded" && (
            <button
              onClick={() => handleDownloadTorrent(t.id)}
              className="w-[30px] h-[30px] rounded-md flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}
              title="Download"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, torrentId: t.id });
            }}
            className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#64748b]"
            style={{ background: "rgba(255,255,255,0.04)" }}
            title="More"
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
        title="Torrents"
        subtitle={`${torrents.length} items · ${formatBytes(totalBytes)}`}
        filterPlaceholder="Filter torrents..."
        filterValue={filter}
        onFilterChange={setFilter}
        actions={
          <button
            onClick={() => setShowAdd(true)}
            className="text-white rounded-lg px-8 py-3 text-[15px] font-semibold transition-colors shrink-0 whitespace-nowrap"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
          >
            + Add Torrent
          </button>
        }
      />

      {error && (
        <div className="px-7 py-3 text-[14px] text-[#ef4444] bg-[rgba(239,68,68,0.06)]">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(t) => t.id}
        onRowClick={(t) => setSelectedId(t.id)}
        onRowContextMenu={(t, e) =>
          setContextMenu({ x: e.clientX, y: e.clientY, torrentId: t.id })
        }
        selectedId={selectedId}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
        emptyMessage="No torrents yet"
        emptySubtext="Add a magnet link or torrent file to get started"
        loading={loading}
      />

      {/* Slide-over detail */}
      <SlideOverPanel open={!!selectedId} onClose={() => setSelectedId(null)}>
        {detailLoading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-6 h-6 border-2 border-[rgba(16,185,129,0.3)] border-t-[#10b981] rounded-full animate-spin" />
          </div>
        ) : detailInfo ? (
          <>
            {/* Header */}
            <div className="px-6 py-5 border-b border-[rgba(255,255,255,0.06)] flex justify-between items-start gap-3">
              <div className="min-w-0">
                <span className={`text-[12px] px-2.5 py-1 rounded-full font-medium inline-block mb-2 ${statusBadgeClass(detailInfo.status)}`}>
                  {torrentStatusLabel(detailInfo.status)}
                </span>
                <h3 className="text-[18px] font-bold text-[#f1f5f9] leading-snug break-words">
                  {detailInfo.filename}
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
              {detailError && <p className="text-[#ef4444] text-[14px] mb-4">{detailError}</p>}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                <div className="bg-[rgba(255,255,255,0.03)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-1.5">Size</div>
                  <div className="text-[17px] text-[#f1f5f9] font-semibold">{formatBytes(detailInfo.bytes)}</div>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-1.5">Added</div>
                  <div className="text-[15px] text-[#f1f5f9] font-medium">{new Date(detailInfo.added).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-1.5">Links</div>
                  <div className="text-[17px] text-[#f1f5f9] font-semibold">{detailInfo.links.length}</div>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-1.5">Hash</div>
                  <div className="text-[12px] text-[#94a3b8] font-mono truncate">{detailInfo.hash}</div>
                </div>
              </div>

              {/* Files */}
              {detailInfo.files.length > 0 && (
                <div>
                  <div className="text-[11px] text-[#475569] uppercase tracking-[0.5px] mb-2.5">
                    Files ({detailInfo.files.length})
                  </div>
                  <div className="rounded-[10px] border border-[rgba(255,255,255,0.04)] overflow-hidden max-h-64 overflow-y-auto">
                    {detailInfo.files.map((file) => (
                      <label
                        key={file.id}
                        className="flex items-center gap-2.5 px-3.5 py-3 cursor-pointer border-b border-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(file.id)}
                          onChange={() => {
                            setSelectedFiles((prev) => {
                              const next = new Set(prev);
                              if (next.has(file.id)) next.delete(file.id);
                              else next.add(file.id);
                              return next;
                            });
                          }}
                          className="accent-[#10b981]"
                        />
                        <span className="flex-1 text-[14px] text-[#f1f5f9] truncate min-w-0">
                          {file.path.startsWith("/") ? file.path.slice(1) : file.path}
                        </span>
                        <span className="text-[12px] text-[#475569] shrink-0">
                          {formatBytes(file.bytes)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[rgba(255,255,255,0.06)] flex gap-2.5">
              {detailInfo.status === "waiting_files_selection" && (
                <button
                  onClick={handleSelectFiles}
                  disabled={saving || selectedFiles.size === 0}
                  className="flex-1 py-3 rounded-[10px] text-white text-[15px] font-semibold disabled:opacity-40 transition-colors"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
                >
                  {saving ? "Saving..." : "Select Files & Start"}
                </button>
              )}
              {detailInfo.status === "downloaded" && (
                <button
                  onClick={handleDetailDownload}
                  disabled={downloading}
                  className="flex-1 py-3 rounded-[10px] text-white text-[15px] font-semibold disabled:opacity-40 transition-colors"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
                >
                  {downloading ? "Starting..." : "Download"}
                </button>
              )}
              <button
                onClick={handleDetailDelete}
                className="py-3 px-5 rounded-[10px] text-[#ef4444] text-[14px] transition-colors"
                style={{ background: "rgba(239,68,68,0.06)" }}
              >
                Delete
              </button>
            </div>
          </>
        ) : detailError ? (
          <div className="p-6">
            <p className="text-[#ef4444] text-[15px]">{detailError}</p>
          </div>
        ) : null}
      </SlideOverPanel>

      {/* Add torrent modal */}
      {showAdd && (
        <AddTorrentModal
          onClose={() => setShowAdd(false)}
          onAdded={fetchTorrents}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-[#0f0f18] border border-[rgba(255,255,255,0.06)] rounded-lg py-1.5 w-52 z-[60] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 220),
            top: Math.min(contextMenu.y, window.innerHeight - 160),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[#f1f5f9] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            onClick={() => { const id = contextMenu.torrentId; setContextMenu(null); handleDownloadTorrent(id); }}
          >
            Download
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[#ef4444] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            onClick={() => { const id = contextMenu.torrentId; setContextMenu(null); if (window.confirm("Delete this torrent?")) handleDelete(id); }}
          >
            Delete
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[#f1f5f9] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            onClick={() => {
              const torrent = torrents.find((t) => t.id === contextMenu.torrentId);
              setContextMenu(null);
              if (torrent) {
                const text = "magnet:?xt=urn:btih:" + torrent.hash;
                const el = document.createElement("textarea");
                el.value = text;
                el.style.position = "fixed";
                el.style.opacity = "0";
                document.body.appendChild(el);
                el.select();
                document.execCommand("copy");
                document.body.removeChild(el);
              }
            }}
          >
            Copy Magnet
          </button>
        </div>
      )}
    </>
  );
}
