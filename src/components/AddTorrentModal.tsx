import { useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import * as torrentsApi from "../api/torrents";

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddTorrentModal({ onClose, onAdded }: Props) {
  const [magnet, setMagnet] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAddMagnet = async () => {
    if (!magnet.trim()) {
      setError("Please enter a magnet link");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await torrentsApi.addMagnet(magnet.trim());
      await torrentsApi.selectTorrentFiles(result.id, "all");
      onAdded();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAddFile = async () => {
    const selected = await openFile({
      title: "Select .torrent file",
      filters: [{ name: "Torrent Files", extensions: ["torrent"] }],
    });
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const bytes = await readFile(selected as string);
      const result = await torrentsApi.addTorrentFile(Array.from(bytes));
      await torrentsApi.selectTorrentFiles(result.id, "all");
      onAdded();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      style={{ animation: "fade-in 0.15s ease" }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--theme-bg-surface)] border border-[var(--theme-border)] rounded-xl w-full max-w-lg p-8"
        style={{ animation: "slide-up 0.2s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[18px] font-semibold text-[var(--theme-text-primary)] tracking-[-0.3px]">
            Add Torrent
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors p-1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Magnet */}
        <div className="mb-5">
          <label className="block text-[15px] font-medium text-[var(--theme-text-secondary)] mb-2">
            Magnet Link
          </label>
          <textarea
            value={magnet}
            onChange={(e) => setMagnet(e.target.value)}
            placeholder="magnet:?xt=urn:btih:..."
            rows={3}
            className="w-full px-4 py-3 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-md text-[var(--theme-text-primary)] placeholder-[var(--theme-text-ghost)] text-[15px] font-mono focus:outline-none focus:border-[rgba(16,185,129,0.3)] transition-all duration-150 resize-none"
          />
          <button
            onClick={handleAddMagnet}
            disabled={loading || !magnet.trim()}
            className="mt-3 w-full py-3 bg-[#10b981] hover:bg-[#34d399] text-white font-medium rounded-md text-[15px] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Adding..." : "Add Magnet"}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px border-[var(--theme-border-subtle)] bg-[var(--theme-border-subtle)]" />
          <span className="text-[var(--theme-text-ghost)] text-[13px]">OR</span>
          <div className="flex-1 h-px border-[var(--theme-border-subtle)] bg-[var(--theme-border-subtle)]" />
        </div>

        {/* File upload */}
        <button
          onClick={handleAddFile}
          disabled={loading}
          className="w-full py-4 bg-[var(--theme-bg-surface)] border border-[var(--theme-border)] rounded-md text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] transition-all text-[15px] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex flex-col items-center gap-2">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--theme-text-muted)]"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload .torrent File
          </div>
        </button>

        {/* Error */}
        {error && (
          <div className="mt-4 text-[#ef4444] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.1)] rounded-md text-[15px] p-4">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
