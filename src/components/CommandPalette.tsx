import { useState, useEffect, useRef, useCallback } from "react";
import { searchTorrents } from "../api/search";
import { listTorrents, addMagnet, selectTorrentFiles } from "../api/torrents";
import type { SearchResult, Torrent, TrackerStatus } from "../types";

interface CommandPaletteProps {
  onClose: () => void;
  onSelectTorrent: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function CommandPalette({ onClose, onSelectTorrent }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "local">("search");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [localTorrents, setLocalTorrents] = useState<Torrent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addingHash, setAddingHash] = useState<string | null>(null);
  const [addedHashes, setAddedHashes] = useState<Set<string>>(new Set());
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus[]>([]);
  const [error, setError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Fetch local torrents on mount
  useEffect(() => {
    listTorrents(1, 500)
      .then(setLocalTorrents)
      .catch(() => {});
  }, []);

  // Reset selectedIndex when query or mode changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, mode]);

  // Debounced search
  useEffect(() => {
    if (mode !== "search") return;
    if (!query.trim()) {
      setSearchResults([]);
      setTrackerStatus([]);
      setError("");
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await searchTorrents(query, undefined, "seeders", 1);
        setSearchResults(response.results);
        setTrackerStatus(response.tracker_status);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode]);

  // Magnet paste detection
  const handleChange = useCallback(async (value: string) => {
    if (value.startsWith("magnet:?")) {
      setQuery("");
      try {
        const result = await addMagnet(value);
        await selectTorrentFiles(result.id, "all");
        setAddedHashes((prev) => new Set(prev).add("pasted"));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    setQuery(value);
  }, []);

  // Compute displayed results
  const filteredLocal = mode === "local"
    ? localTorrents.filter((t) =>
        t.filename.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  const displayResults = mode === "search" ? searchResults : filteredLocal;

  const handleAddTorrent = useCallback(async (result: SearchResult) => {
    setAddingHash(result.info_hash);
    try {
      const response = await addMagnet(result.magnet);
      await selectTorrentFiles(response.id, "all");
      setAddedHashes((prev) => {
        const next = new Set(prev);
        next.add(result.info_hash);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingHash(null);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        setMode((prev) => (prev === "search" ? "local" : "search"));
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < displayResults.length - 1 ? prev + 1 : prev
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (displayResults.length === 0) return;

        if (mode === "search") {
          const result = searchResults[selectedIndex];
          if (result && !addedHashes.has(result.info_hash) && addingHash !== result.info_hash) {
            handleAddTorrent(result);
          }
        } else {
          const torrent = filteredLocal[selectedIndex];
          if (torrent) {
            onSelectTorrent(torrent.id);
            onClose();
          }
        }
      }
    },
    [displayResults, mode, selectedIndex, searchResults, filteredLocal, addedHashes, addingHash, handleAddTorrent, onSelectTorrent, onClose]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  const warningTrackers = trackerStatus.filter((t) => !t.ok);

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
      style={{ animation: "fade-in 0.15s ease" }}
    >
      <div
        className="w-[560px] max-h-[420px] bg-[#0f0f18] border border-[rgba(255,255,255,0.06)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
        style={{ animation: "slide-up 0.15s ease" }}
      >
        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search torrents or paste magnet..."
          autoFocus
          className="text-[15px] text-[#f1f5f9] bg-transparent w-full px-4 py-3.5 border-b border-[rgba(255,255,255,0.04)] outline-none placeholder:text-[#374151]"
        />

        {/* Mode tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-[rgba(255,255,255,0.04)]">
          <button
            onClick={() => setMode("search")}
            className={`px-3 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
              mode === "search"
                ? "bg-[rgba(16,185,129,0.08)] text-[#10b981]"
                : "text-[#475569] hover:text-[#94a3b8]"
            }`}
          >
            Search Trackers
          </button>
          <button
            onClick={() => setMode("local")}
            className={`px-3 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
              mode === "local"
                ? "bg-[rgba(16,185,129,0.08)] text-[#10b981]"
                : "text-[#475569] hover:text-[#94a3b8]"
            }`}
          >
            My Torrents
          </button>
        </div>

        {/* Results area */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="text-[#ef4444] text-[13px] px-4 py-2">{error}</div>
          )}

          {loading && (
            <>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-[rgba(255,255,255,0.03)] h-10 mx-4 my-1 rounded-md"
                  style={{
                    animation: "shimmer 1.5s infinite",
                    backgroundSize: "200% 100%",
                    background:
                      "linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)",
                  }}
                />
              ))}
            </>
          )}

          {!loading && !error && query.trim() === "" && mode === "search" && (
            <div className="flex items-center justify-center h-full py-12">
              <span className="text-[#374151] text-[13px]">Type to search...</span>
            </div>
          )}

          {!loading && !error && query.trim() !== "" && displayResults.length === 0 && (
            <div className="flex items-center justify-center h-full py-12">
              <span className="text-[#475569] text-[13px]">No results found</span>
            </div>
          )}

          {!loading &&
            displayResults.map((item, index) => {
              if (mode === "search") {
                const result = item as SearchResult;
                const isAdded = addedHashes.has(result.info_hash);
                const isAdding = addingHash === result.info_hash;

                if (isAdded) {
                  return (
                    <div
                      key={result.info_hash}
                      className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#10b981]"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                        <path d="M2 7.5L5.5 11L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Added!
                    </div>
                  );
                }

                const seederColor =
                  result.seeders >= 10
                    ? "text-[#10b981]"
                    : result.seeders >= 1
                    ? "text-[#eab308]"
                    : "text-[#ef4444]";

                return (
                  <div
                    key={result.info_hash}
                    onClick={() => !isAdding && handleAddTorrent(result)}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-[13px] ${
                      index === selectedIndex ? "bg-[rgba(255,255,255,0.03)]" : ""
                    }`}
                  >
                    <span className="text-[#f1f5f9] truncate flex-1">
                      {result.title}
                    </span>
                    <span className="text-[10px] bg-[rgba(16,185,129,0.08)] text-[#10b981] rounded px-1.5 py-0.5 shrink-0">
                      {result.source}
                    </span>
                    <span className="text-[#475569] shrink-0">
                      {result.size_display}
                    </span>
                    <span className={`${seederColor} shrink-0`}>
                      ↑{result.seeders}
                    </span>
                  </div>
                );
              } else {
                const torrent = item as Torrent;
                return (
                  <div
                    key={torrent.id}
                    onClick={() => {
                      onSelectTorrent(torrent.id);
                      onClose();
                    }}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-[13px] ${
                      index === selectedIndex ? "bg-[rgba(255,255,255,0.03)]" : ""
                    }`}
                  >
                    <span className="text-[#f1f5f9] truncate flex-1">
                      {torrent.filename}
                    </span>
                    <span className="text-[#475569] shrink-0">
                      {formatBytes(torrent.bytes)}
                    </span>
                    <span className="text-[10px] bg-[rgba(16,185,129,0.08)] text-[#10b981] rounded px-1.5 py-0.5 shrink-0">
                      {torrent.status}
                    </span>
                  </div>
                );
              }
            })}

          {/* Tracker warnings */}
          {warningTrackers.length > 0 && (
            <div className="px-4 py-2 text-[11px] text-[#eab308]">
              {warningTrackers.map((t) => (
                <div key={t.name}>
                  ⚠ {t.name}: {t.error ?? "unavailable"}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
