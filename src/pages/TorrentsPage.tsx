import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import * as torrentsApi from "../api/torrents";
import * as downloadsApi from "../api/downloads";
import type { Torrent } from "../types";
import {
  formatBytes,
  torrentStatusColor,
  torrentStatusLabel,
} from "../utils";
import TorrentDetail from "../components/TorrentDetail";
import AddTorrentModal from "../components/AddTorrentModal";

export default function TorrentsPage() {
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
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

  useEffect(() => {
    fetchTorrents();
  }, [fetchTorrents]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === readyTorrents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(readyTorrents.map((t) => t.id)));
    }
  };

  const readyTorrents = torrents.filter((t) => t.status === "downloaded");

  const handleDownloadSelected = async () => {
    if (selected.size === 0) return;
    const folder = await open({ directory: true, title: "Select download folder" });
    if (!folder) return;
    setDownloading(true);
    try {
      for (const torrentId of selected) {
        const torrent = torrents.find((t) => t.id === torrentId);
        if (!torrent) continue;
        const links = await downloadsApi.unrestrictTorrentLinks(torrentId);
        if (links.length > 0) {
          await downloadsApi.startDownloads(links, folder as string, torrent.filename);
        }
      }
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    if (readyTorrents.length === 0) return;
    const folder = await open({ directory: true, title: "Select download folder" });
    if (!folder) return;
    setDownloading(true);
    try {
      for (const torrent of readyTorrents) {
        const links = await downloadsApi.unrestrictTorrentLinks(torrent.id);
        if (links.length > 0) {
          await downloadsApi.startDownloads(links, folder as string, torrent.filename);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await torrentsApi.deleteTorrent(id);
      setTorrents((prev) => prev.filter((t) => t.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-zinc-100 tracking-tight">Torrents</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {torrents.length} total &middot;{" "}
            <span className="bg-rd-green/10 text-rd-green px-2 py-0.5 rounded-full text-xs font-medium">{readyTorrents.length} ready</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-rd-green text-black font-semibold rounded-lg hover:bg-green-400 text-sm transition-all duration-150 shadow-lg shadow-rd-green/20"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Torrent
          </button>
          <button
            onClick={fetchTorrents}
            className="flex items-center gap-2 px-4 py-2 bg-rd-card border border-rd-border rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Action bar */}
      {readyTorrents.length > 0 && (
        <div className="flex items-center gap-3 mb-6 px-4 py-3 card-base">
          <button
            onClick={selectAll}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-rd-surface border border-rd-border rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all duration-150"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            {selected.size === readyTorrents.length ? "Deselect All" : "Select All"}
          </button>

          <div className="h-5 w-px bg-rd-border" />

          <button
            onClick={handleDownloadSelected}
            disabled={selected.size === 0 || downloading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-600/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {downloading ? "Starting..." : `Download Selected (${selected.size})`}
          </button>

          <button
            onClick={handleDownloadAll}
            disabled={downloading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-rd-green/20 border border-rd-green/30 text-rd-green rounded-lg hover:bg-rd-green/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download All Ready
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      {/* Torrent list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-rd-green/30 border-t-rd-green rounded-full animate-spin mb-4" />
          <p className="text-zinc-500 text-sm">Loading torrents...</p>
        </div>
      ) : torrents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-rd-card border border-rd-border flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <p className="text-zinc-400 font-medium mb-1">No torrents yet</p>
          <p className="text-zinc-600 text-sm mb-4">Search for torrents or add a magnet link to get started</p>
          <button
            onClick={() => setShowAdd(true)}
            className="text-rd-green text-sm font-medium hover:underline"
          >
            Add your first torrent
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {torrents.map((torrent) => (
            <div
              key={torrent.id}
              className={`group flex items-center gap-4 px-5 py-4 rounded-xl border transition-all duration-150 cursor-pointer ${
                selected.has(torrent.id)
                  ? "card-base bg-rd-green/[0.06] border-rd-green/40 shadow-[0_0_20px_rgba(120,190,32,0.1)]"
                  : "card-base"
              }`}
              onClick={() => setDetailId(torrent.id)}
            >
              {/* Checkbox */}
              {torrent.status === "downloaded" && (
                <input
                  type="checkbox"
                  checked={selected.has(torrent.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleSelect(torrent.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}

              {/* Status indicator */}
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${
                  torrent.status === "downloaded"
                    ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]"
                    : torrent.status === "downloading"
                      ? "bg-blue-400 animate-pulse glow-dot-active"
                      : torrent.status === "error" || torrent.status === "magnet_error" || torrent.status === "dead"
                        ? "bg-red-400"
                        : "bg-yellow-400"
                }`}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate group-hover:text-zinc-100">
                  {torrent.filename}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span
                    className={`text-xs font-medium ${torrentStatusColor(torrent.status)}`}
                  >
                    {torrentStatusLabel(torrent.status)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatBytes(torrent.bytes)}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {torrent.links.length} file{torrent.links.length !== 1 ? "s" : ""}
                  </span>
                  {torrent.speed != null && torrent.speed > 0 && (
                    <span className="text-xs text-blue-400">
                      {formatBytes(torrent.speed)}/s
                    </span>
                  )}
                </div>
                {/* Progress bar */}
                {torrent.progress > 0 && torrent.progress < 100 && (
                  <div className="mt-2 h-1 bg-rd-darker rounded-full overflow-hidden">
                    <div
                      className="h-full progress-bar-blue rounded-full transition-all duration-500"
                      style={{ width: `${torrent.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(torrent.id);
                }}
                className="shrink-0 p-2 rounded-lg text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 hover:shadow-[0_0_20px_rgba(239,68,68,0.15)] transition-all duration-150"
                title="Delete torrent"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {detailId && (
        <TorrentDetail
          torrentId={detailId}
          onClose={() => setDetailId(null)}
          onRefresh={fetchTorrents}
        />
      )}

      {/* Add modal */}
      {showAdd && (
        <AddTorrentModal
          onClose={() => setShowAdd(false)}
          onAdded={fetchTorrents}
        />
      )}
    </div>
  );
}
