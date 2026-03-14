import { useEffect, useState } from "react";
import * as downloadsApi from "../api/downloads";
import type { DownloadItem } from "../types";
import { formatBytes } from "../utils";

export default function HistoryPage() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const data = await downloadsApi.getDownloadHistory(page, 50);
        setItems(data);
        setError("");
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [page]);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-zinc-100 tracking-tight">History</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Past unrestricted links from Real-Debrid
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 text-sm bg-rd-card border border-rd-border rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            Prev
          </button>
          <span className="px-3 py-1.5 text-sm text-zinc-500 tabular-nums">
            Page {page}
          </span>
          <button
            disabled={items.length < 50}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-sm bg-rd-card border border-rd-border rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
          >
            Next
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-rd-green/30 border-t-rd-green rounded-full animate-spin mb-4" />
          <p className="text-zinc-500 text-sm">Loading history...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-rd-green/10 border border-rd-green/20 flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-rd-green/60">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="text-zinc-300 font-medium">No download history</p>
          <p className="text-zinc-500 text-sm mt-1">Unrestricted links will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 p-4 card-base"
            >
              <div className="w-8 h-8 rounded-lg bg-rd-green/10 flex items-center justify-center shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-rd-green/60">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-300 truncate">
                  {item.filename}
                </p>
                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                  <span>{formatBytes(item.filesize)}</span>
                  <span className="text-zinc-600">{item.host}</span>
                  <span className="text-zinc-600">
                    {new Date(item.generated).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
