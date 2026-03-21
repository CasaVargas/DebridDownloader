import { useCallback, useEffect, useMemo, useState } from "react";
import { useMiniPlayer } from "../contexts/MiniPlayerContext";
import { open } from "@tauri-apps/plugin-dialog";
import DataTable, { type Column } from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import SlideOverPanel from "../components/SlideOverPanel";
import AddTorrentModal from "../components/AddTorrentModal";
import VideoPlayer from "../components/VideoPlayer";
import * as torrentsApi from "../api/torrents";
import * as downloadsApi from "../api/downloads";
import { getSettings } from "../api/settings";
import { getStreamUrl, cleanupStreamSession } from "../api/streaming";
import { openUrl } from "@tauri-apps/plugin-opener";
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

const INLINE_VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v", ".mkv"];
const EXTERNAL_VIDEO_EXTS = [".avi", ".wmv", ".flv", ".ts"];

const getFileExt = (path: string) => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
};

const isInlineVideo = (path: string) => INLINE_VIDEO_EXTS.includes(getFileExt(path));
const isExternalVideo = (path: string) => EXTERNAL_VIDEO_EXTS.includes(getFileExt(path));

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    torrentId: string;
  } | null>(null);

  // Slide-over detail state
  const [detailInfo, setDetailInfo] = useState<TorrentInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { openPreview, isLoading: miniPlayerLoading } = useMiniPlayer();

  // Streaming state
  const [streamingFileId, setStreamingFileId] = useState<number | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const handlePlayInline = async (fileId: number) => {
    if (!detailInfo) return;

    // Toggle off if clicking the same file
    if (streamingFileId === fileId) {
      await handleStopStream();
      return;
    }

    // Cleanup previous session
    if (streamSessionId) {
      await cleanupStreamSession(streamSessionId).catch(() => {});
    }

    setStreamLoading(true);
    setStreamError(null);
    setStreamingFileId(fileId);

    try {
      const result = await getStreamUrl(detailInfo.id, fileId);
      setStreamUrl(result.stream_url);
      setStreamSessionId(result.session_id);
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
      setStreamingFileId(null);
    } finally {
      setStreamLoading(false);
    }
  };

  const handlePlayExternal = async (fileId: number) => {
    if (!detailInfo) return;
    try {
      const result = await getStreamUrl(detailInfo.id, fileId);
      await openUrl(result.stream_url);
      // Don't immediately clean up — external player needs the session alive for streaming
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopStream = async () => {
    if (streamSessionId) {
      await cleanupStreamSession(streamSessionId).catch(() => {});
    }
    setStreamingFileId(null);
    setStreamUrl(null);
    setStreamSessionId(null);
    setStreamError(null);
  };

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
        setSelectedFiles(new Set(data.files.filter((f) => f.selected).map((f) => f.id)));
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
        <div className="text-[15px] font-medium text-[var(--theme-text-primary)] truncate">{t.filename}</div>
      ),
    },
    {
      key: "bytes",
      header: "Size",
      width: "100px",
      sortable: true,
      render: (t) => <span className="text-[14px] text-[var(--theme-text-secondary)]">{formatBytes(t.bytes)}</span>,
    },
    {
      key: "added",
      header: "Added",
      width: "110px",
      sortable: true,
      render: (t) => <span className="text-[13px] text-[var(--theme-text-muted)]">{formatRelativeTime(t.added)}</span>,
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
      width: "155px",
      render: (t) => (
        <div className="flex gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => openPreview(t.id)}
            disabled={miniPlayerLoading}
            className="w-[30px] h-[30px] rounded-md flex items-center justify-center cursor-pointer transition-colors"
            style={{ background: "rgba(139,92,246,0.1)", color: "#8b5cf6" }}
            title="Preview Video"
          >
            {miniPlayerLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
          {t.status === "downloaded" && (
            <button
              onClick={() => handleDownloadTorrent(t.id)}
              className="w-[30px] h-[30px] rounded-md flex items-center justify-center cursor-pointer"
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
            onClick={() => {
              const text = "magnet:?xt=urn:btih:" + t.hash;
              navigator.clipboard.writeText(text).catch(() => {});
            }}
            className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] cursor-pointer"
            style={{ background: "var(--theme-selected)" }}
            title="Copy Magnet"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            onClick={() => { if (window.confirm("Delete this torrent?")) handleDelete(t.id); }}
            className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-[#ef4444] cursor-pointer"
            style={{ background: "rgba(239,68,68,0.08)" }}
            title="Delete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
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
            className="text-white rounded-lg text-[15px] font-semibold transition-colors shrink-0 whitespace-nowrap"
            style={{ background: "var(--accent)", padding: "0 28px" }}
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
      <SlideOverPanel
        open={!!selectedId}
        onClose={() => { handleStopStream(); setSelectedId(null); }}
        width={streamingFileId !== null ? 640 : 420}
      >
        {detailLoading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-6 h-6 border-2 border-[rgba(16,185,129,0.3)] border-t-[#10b981] rounded-full animate-spin" />
          </div>
        ) : detailInfo ? (
          <>
            {/* Header */}
            <div className="px-6 py-5 border-b border-[var(--theme-border)] flex justify-between items-start gap-3">
              <div className="min-w-0">
                <span className={`text-[12px] px-2.5 py-1 rounded-full font-medium inline-block mb-2 ${statusBadgeClass(detailInfo.status)}`}>
                  {torrentStatusLabel(detailInfo.status)}
                </span>
                <h3 className="text-[18px] font-bold text-[var(--theme-text-primary)] leading-snug break-words">
                  {detailInfo.filename}
                </h3>
              </div>
              <button
                onClick={() => { handleStopStream(); setSelectedId(null); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] shrink-0"
                style={{ background: "var(--theme-selected)" }}
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {detailError && <p className="text-[#ef4444] text-[14px] mb-4">{detailError}</p>}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">Size</div>
                  <div className="text-[17px] text-[var(--theme-text-primary)] font-semibold">{formatBytes(detailInfo.bytes)}</div>
                </div>
                <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">Added</div>
                  <div className="text-[15px] text-[var(--theme-text-primary)] font-medium">{new Date(detailInfo.added).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                </div>
                <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">Links</div>
                  <div className="text-[17px] text-[var(--theme-text-primary)] font-semibold">{detailInfo.links.length}</div>
                </div>
                <div className="bg-[var(--theme-hover)] rounded-[10px] p-3.5">
                  <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-1.5">Hash</div>
                  <div className="text-[12px] text-[var(--theme-text-secondary)] font-mono truncate">{detailInfo.hash}</div>
                </div>
              </div>

              {/* Video Player */}
              {streamingFileId !== null && streamUrl && (
                <VideoPlayer
                  streamUrl={streamUrl}
                  filename={
                    detailInfo.files.find((f) => f.id === streamingFileId)?.path.split("/").pop() || "Video"
                  }
                  onClose={handleStopStream}
                  onExternalPlayer={() => {
                    const fid = streamingFileId;
                    handleStopStream();
                    if (fid !== null) handlePlayExternal(fid);
                  }}
                />
              )}

              {streamError && !streamUrl && (
                <div className="mt-5 rounded-[10px] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] p-4 flex items-center justify-between">
                  <p className="text-[13px] text-[#ef4444]">{streamError}</p>
                  <button
                    onClick={() => streamingFileId !== null && handlePlayInline(streamingFileId)}
                    className="text-[12px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] px-3 py-1.5 rounded-md"
                    style={{ background: "var(--theme-hover)" }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Files */}
              {detailInfo.files.length > 0 && (
                <div>
                  <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] mb-2.5">
                    Files ({detailInfo.files.length})
                  </div>
                  <div className="rounded-[10px] border border-[var(--theme-border-subtle)] overflow-hidden max-h-64 overflow-y-auto">
                    {detailInfo.files.map((file) => (
                      <div
                        key={file.id}
                        className={`flex items-center gap-2.5 px-3.5 py-3 border-b border-[var(--theme-border-subtle)] last:border-b-0 transition-colors ${
                          streamingFileId === file.id
                            ? "bg-[rgba(16,185,129,0.06)] border-l-2 border-l-[var(--accent)]"
                            : "hover:bg-[var(--theme-hover)]"
                        }`}
                      >
                        {detailInfo.status === "waiting_files_selection" && (
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
                        )}

                        {detailInfo.status === "downloaded" && isInlineVideo(file.path) && (
                          <button
                            onClick={() => handlePlayInline(file.id)}
                            disabled={streamLoading && streamingFileId === file.id}
                            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                              streamingFileId === file.id
                                ? "bg-[var(--accent)] text-white"
                                : "bg-[rgba(16,185,129,0.1)] text-[#10b981] hover:bg-[rgba(16,185,129,0.2)]"
                            }`}
                          >
                            {streamLoading && streamingFileId === file.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                            ) : streamingFileId === file.id ? (
                              <span className="text-[11px]">■</span>
                            ) : (
                              <span className="text-[11px]">▶</span>
                            )}
                          </button>
                        )}

                        {detailInfo.status === "downloaded" && isExternalVideo(file.path) && (
                          <button
                            onClick={() => handlePlayExternal(file.id)}
                            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--theme-hover)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
                            title="Open in external player"
                          >
                            <span className="text-[11px]">▶↗</span>
                          </button>
                        )}

                        <span className="flex-1 text-[14px] text-[var(--theme-text-primary)] truncate min-w-0">
                          {file.path.startsWith("/") ? file.path.slice(1) : file.path}
                        </span>
                        <span className="text-[12px] text-[var(--theme-text-muted)] shrink-0">
                          {formatBytes(file.bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[var(--theme-border)] flex gap-2.5">
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
          className="fixed bg-[var(--theme-bg-surface)] border border-[var(--theme-border)] rounded-lg py-1.5 w-52 z-[60] shadow-[0_8px_32px_var(--theme-shadow)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 220),
            top: Math.min(contextMenu.y, window.innerHeight - 200),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[var(--theme-text-primary)] cursor-pointer hover:bg-[var(--theme-selected)] transition-colors"
            onClick={() => { const id = contextMenu.torrentId; setContextMenu(null); openPreview(id); }}
          >
            Preview
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[var(--theme-text-primary)] cursor-pointer hover:bg-[var(--theme-selected)] transition-colors"
            onClick={() => { const id = contextMenu.torrentId; setContextMenu(null); handleDownloadTorrent(id); }}
          >
            Download
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[#ef4444] cursor-pointer hover:bg-[var(--theme-selected)] transition-colors"
            onClick={() => { const id = contextMenu.torrentId; setContextMenu(null); if (window.confirm("Delete this torrent?")) handleDelete(id); }}
          >
            Delete
          </button>
          <button
            className="w-full text-left px-4 py-2.5 text-[15px] text-[var(--theme-text-primary)] cursor-pointer hover:bg-[var(--theme-selected)] transition-colors"
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
