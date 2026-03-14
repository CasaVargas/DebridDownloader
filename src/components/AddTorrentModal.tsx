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
        className="bg-[#0f0f18] border border-[rgba(255,255,255,0.06)] rounded-xl w-full max-w-lg p-6"
        style={{ animation: "slide-up 0.2s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[14px] font-semibold text-[#f1f5f9] tracking-[-0.2px]">
            Add Torrent
          </h3>
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#f1f5f9] transition-colors p-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Magnet */}
        <div className="mb-4">
          <label className="block text-[13px] font-medium text-[#94a3b8] mb-2">
            Magnet Link
          </label>
          <textarea
            value={magnet}
            onChange={(e) => setMagnet(e.target.value)}
            placeholder="magnet:?xt=urn:btih:..."
            rows={3}
            className="w-full px-3 py-2.5 bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-md text-[#f1f5f9] placeholder-[#374151] text-[13px] font-mono focus:outline-none focus:border-[rgba(16,185,129,0.3)] transition-all duration-150 resize-none"
          />
          <button
            onClick={handleAddMagnet}
            disabled={loading || !magnet.trim()}
            className="mt-3 w-full py-2.5 bg-[#10b981] hover:bg-[#34d399] text-white font-medium rounded-md text-[13px] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Adding..." : "Add Magnet"}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.04)]" />
          <span className="text-[#374151] text-[11px]">OR</span>
          <div className="flex-1 h-px border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.04)]" />
        </div>

        {/* File upload */}
        <button
          onClick={handleAddFile}
          disabled={loading}
          className="w-full py-3 bg-[#0f0f18] border border-[rgba(255,255,255,0.06)] rounded-md text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[rgba(255,255,255,0.1)] transition-all text-[13px] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex flex-col items-center gap-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[#475569]"
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
          <div className="mt-4 text-[#ef4444] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.1)] rounded-md text-[13px] p-3">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
