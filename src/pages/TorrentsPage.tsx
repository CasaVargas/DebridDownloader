import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMiniPlayer } from "../contexts/MiniPlayerContext";
import { open } from "@tauri-apps/plugin-dialog";
import DataTable, { type Column } from "../components/DataTable";
import AddTorrentModal from "../components/AddTorrentModal";
import VideoPlayer from "../components/VideoPlayer";
import * as torrentsApi from "../api/torrents";
import * as downloadsApi from "../api/downloads";
import { getSettings } from "../api/settings";
import { getStreamUrl, cleanupStreamSession } from "../api/streaming";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Torrent, TorrentInfo, AppSettings } from "../types";
import { Button, ContextMenu, IconButton, Inspector, Menu, Spinner, StatusDot, Toolbar, type MenuItem } from "../components/ui";
import {
  formatBytes,
  formatRelativeTime,
  torrentStatusDot,
  torrentStatusLabel,
} from "../utils";

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);

/** Copy via a hidden textarea (the right-click menu's original copy path). */
function copyText(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const filterRef = useRef<HTMLInputElement>(null);

  // Slide-over detail state
  const [detailInfo, setDetailInfo] = useState<TorrentInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { openPreview, loadingTorrentId: miniPlayerLoadingId } = useMiniPlayer();

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
    // Esc used to close the slide-over, which also stopped any inline stream.
    const handler = () => { handleStopStream(); setSelectedId(null); };
    window.addEventListener("deselect-item", handler);
    return () => window.removeEventListener("deselect-item", handler);
  }, [streamSessionId]);

  useEffect(() => {
    const onAdd = () => setShowAdd(true);
    const onFocus = () => filterRef.current?.focus();
    const onToggle = () => setInspectorOpen((o) => !o);
    window.addEventListener("open-add-torrent", onAdd);
    window.addEventListener("focus-filter", onFocus);
    window.addEventListener("toggle-inspector", onToggle);
    return () => {
      window.removeEventListener("open-add-torrent", onAdd);
      window.removeEventListener("focus-filter", onFocus);
      window.removeEventListener("toggle-inspector", onToggle);
    };
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

  const handleDelete = async (id: string) => {
    try {
      await torrentsApi.deleteTorrent(id);
      setTorrents((prev) => prev.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e) { setError(String(e)); }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(`Delete all ${torrents.length} torrents?`)) return;
    try {
      for (const t of torrents) {
        await torrentsApi.deleteTorrent(t.id).catch(() => {});
      }
      setTorrents([]);
      setSelectedId(null);
    } catch (e) { setError(String(e)); }
  };

  const handleDownloadTorrent = async (id: string) => {
    const torrent = torrents.find((t) => t.id === id);
    if (!torrent) return;
    try {
      // Symlink mode: backend uses library path from settings, no folder picker needed
      let folder = settings?.download_folder ?? null;
      if (settings?.symlink_mode) {
        if (!settings?.symlink_mount_path || !settings?.symlink_library_path) {
          setError("Symlink mode is on but mount path or library folder is not configured. Check Settings.");
          return;
        }
        folder = settings.symlink_library_path;
      } else if (!folder) {
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
      if (s.symlink_mode) {
        if (!s.symlink_mount_path || !s.symlink_library_path) {
          setDetailError("Symlink mode is on but mount path or library folder is not configured. Check Settings.");
          setDownloading(false);
          return;
        }
        folder = s.symlink_library_path;
      } else if (!folder) {
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

  const selectRow = (id: string) => { setSelectedId(id); setInspectorOpen(true); };
  const closeInspector = () => { handleStopStream(); setSelectedId(null); };

  // Right-click menu: same actions and handlers as the old positioned menu.
  const rowMenuItems = (t: Torrent): MenuItem[] => [
    { label: "Preview", onSelect: () => openPreview(t.id) },
    { label: "Download", onSelect: () => handleDownloadTorrent(t.id) },
    { label: "Delete", danger: true, onSelect: () => { if (window.confirm("Delete this torrent?")) handleDelete(t.id); } },
    ...(torrents.length > 1
      ? (["separator", { label: `Delete All (${torrents.length})`, danger: true, onSelect: () => handleDeleteAll() }] as MenuItem[])
      : []),
    { label: "Copy Magnet", onSelect: () => copyText("magnet:?xt=urn:btih:" + t.hash) },
  ];

  const columns: Column<Torrent>[] = [
    {
      key: "filename",
      header: "Name",
      width: "minmax(0, 1fr)",
      sortable: true,
      render: (t) => <div className="truncate text-base text-fg">{t.filename}</div>,
    },
    {
      key: "bytes",
      header: "Size",
      width: 20,
      sortable: true,
      render: (t) => <span className="text-base text-fg-secondary tabular">{formatBytes(t.bytes)}</span>,
    },
    {
      key: "added",
      header: "Added",
      width: 24,
      sortable: true,
      render: (t) => <span className="text-sm text-fg-muted tabular">{formatRelativeTime(t.added)}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: 28,
      render: (t) => <StatusDot status={torrentStatusDot(t.status)}>{torrentStatusLabel(t.status)}</StatusDot>,
    },
    {
      key: "actions",
      header: "",
      width: 22,
      render: (t) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {miniPlayerLoadingId === t.id && <Spinner size="sm" />}
          {t.status === "downloaded" && (
            <IconButton label="Download" onClick={() => handleDownloadTorrent(t.id)}>
              <DownloadIcon />
            </IconButton>
          )}
          <Menu
            trigger={
              <IconButton label="More actions">
                <MoreIcon />
              </IconButton>
            }
            items={[
              { label: "Preview Video", onSelect: () => openPreview(t.id), disabled: miniPlayerLoadingId === t.id },
              { label: "Copy Magnet", onSelect: () => { navigator.clipboard.writeText("magnet:?xt=urn:btih:" + t.hash).catch(() => {}); } },
              "separator",
              { label: "Delete", danger: true, onSelect: () => { if (window.confirm("Delete this torrent?")) handleDelete(t.id); } },
            ]}
          />
        </div>
      ),
    },
  ];

  const inspectorVisible = !!selectedId && inspectorOpen;
  const canDownload = detailInfo?.status === "downloaded";

  return (
    <>
      <Toolbar
        title="Torrents"
        subtitle={`${torrents.length} items · ${formatBytes(totalBytes)}`}
        filter={{ value: filter, onChange: setFilter, placeholder: "Filter torrents", inputRef: filterRef }}
        actions={
          <>
            {torrents.length > 0 && (
              <Button variant="danger" onClick={handleDeleteAll}>
                Delete All
              </Button>
            )}
            <Button variant="primary" kbd="Mod+N" onClick={() => setShowAdd(true)}>
              Add Torrent
            </Button>
          </>
        }
      />

      {error && <div className="border-b border-border px-4 py-2 text-sm text-danger">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DataTable
            columns={columns}
            data={filtered}
            rowKey={(t) => t.id}
            onRowClick={(t) => selectRow(t.id)}
            onKeyboardSelect={(t) => selectRow(t.id)}
            rowWrapper={(t, row) => <ContextMenu items={rowMenuItems(t)}>{row}</ContextMenu>}
            selectedId={selectedId}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
            emptyMessage="No torrents yet"
            emptySubtext="Add a magnet link or torrent file to get started"
            loading={loading}
          />
        </div>

        <Inspector
          id="torrents"
          open={inspectorVisible}
          onClose={closeInspector}
          title={detailInfo?.filename ?? torrents.find((t) => t.id === selectedId)?.filename ?? "Torrent"}
          subtitle={detailInfo ? `${formatBytes(detailInfo.bytes)} · ${torrentStatusLabel(detailInfo.status)}` : undefined}
          footer={
            detailInfo ? (
              <>
                {detailInfo.status === "waiting_files_selection" && (
                  <Button variant="primary" onClick={handleSelectFiles} disabled={saving || selectedFiles.size === 0}>
                    {saving ? "Saving..." : "Select Files & Start"}
                  </Button>
                )}
                {canDownload && (
                  <Button variant="primary" onClick={handleDetailDownload} disabled={downloading}>
                    {downloading ? "Starting..." : "Download"}
                  </Button>
                )}
                {canDownload && (
                  <Button onClick={() => openPreview(detailInfo.id)} disabled={miniPlayerLoadingId === detailInfo.id}>
                    Preview
                  </Button>
                )}
                <Button variant="danger" onClick={handleDetailDelete}>
                  Delete
                </Button>
              </>
            ) : undefined
          }
        >
          {detailLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : detailInfo ? (
            <div className="flex flex-col gap-4">
              {detailError && <p className="text-sm text-danger">{detailError}</p>}

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-fg-muted">Status</dt>
                <dd><StatusDot status={torrentStatusDot(detailInfo.status)}><span className="text-sm">{torrentStatusLabel(detailInfo.status)}</span></StatusDot></dd>
                <dt className="text-fg-muted">Size</dt>
                <dd className="text-fg tabular">{formatBytes(detailInfo.bytes)}</dd>
                <dt className="text-fg-muted">Added</dt>
                <dd className="text-fg tabular">{new Date(detailInfo.added).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
                <dt className="text-fg-muted">Links</dt>
                <dd className="text-fg tabular">{detailInfo.links.length}</dd>
                <dt className="text-fg-muted">Hash</dt>
                <dd className="truncate font-mono text-fg-secondary" title={detailInfo.hash}>{detailInfo.hash}</dd>
              </dl>

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
                <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <p className="text-sm text-danger">{streamError}</p>
                  <Button size="sm" onClick={() => streamingFileId !== null && handlePlayInline(streamingFileId)}>
                    Retry
                  </Button>
                </div>
              )}

              {/* Files */}
              {detailInfo.files.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Files ({detailInfo.files.length})
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                    {detailInfo.files.map((file) => (
                      <div
                        key={file.id}
                        className={`flex min-h-7.5 items-center gap-2 border-b border-border-subtle px-2 py-1 last:border-b-0 ${
                          streamingFileId === file.id ? "bg-selected" : "hover:bg-raised"
                        }`}
                      >
                        {detailInfo.status === "waiting_files_selection" && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${file.path}`}
                            checked={selectedFiles.has(file.id)}
                            onChange={() => {
                              setSelectedFiles((prev) => {
                                const next = new Set(prev);
                                if (next.has(file.id)) next.delete(file.id);
                                else next.add(file.id);
                                return next;
                              });
                            }}
                            className="size-4 shrink-0 accent-accent"
                          />
                        )}

                        {detailInfo.status === "downloaded" && isInlineVideo(file.path) && (
                          <IconButton
                            size="sm"
                            label={streamingFileId === file.id ? "Stop playback" : "Play"}
                            onClick={() => handlePlayInline(file.id)}
                            disabled={streamLoading && streamingFileId === file.id}
                          >
                            {streamLoading && streamingFileId === file.id ? (
                              <Spinner size="sm" />
                            ) : streamingFileId === file.id ? (
                              <span className="text-xs">■</span>
                            ) : (
                              <span className="text-xs">▶</span>
                            )}
                          </IconButton>
                        )}

                        {detailInfo.status === "downloaded" && isExternalVideo(file.path) && (
                          <IconButton size="sm" label="Open in external player" onClick={() => handlePlayExternal(file.id)}>
                            <span className="text-xs">▶↗</span>
                          </IconButton>
                        )}

                        <span className="min-w-0 flex-1 truncate text-sm text-fg">
                          {file.path.startsWith("/") ? file.path.slice(1) : file.path}
                        </span>
                        <span className="shrink-0 text-sm text-fg-muted tabular">{formatBytes(file.bytes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : detailError ? (
            <p className="text-sm text-danger">{detailError}</p>
          ) : null}
        </Inspector>
      </div>

      {/* Add torrent modal */}
      {showAdd && (
        <AddTorrentModal
          onClose={() => setShowAdd(false)}
          onAdded={fetchTorrents}
        />
      )}
    </>
  );
}
