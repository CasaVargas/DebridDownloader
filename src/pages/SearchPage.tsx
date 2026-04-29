import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { searchTorrents, checkCacheAvailability } from "../api/search";
import { listTorrents, addMagnet, selectTorrentFiles } from "../api/torrents";
import type { SearchResult, Torrent, TrackerStatus } from "../types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "local">("search");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [localTorrents, setLocalTorrents] = useState<Torrent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addingHash, setAddingHash] = useState<string | null>(null);
  const [addedHashes, setAddedHashes] = useState<Set<string>>(new Set());
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus[]>([]);
  const [cachedHashes, setCachedHashes] = useState<Set<string>>(new Set());
  const [cacheChecked, setCacheChecked] = useState(false);
  const [error, setError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      setCacheChecked(false);
      setCachedHashes(new Set());
      try {
        const response = await searchTorrents(query, undefined, "seeders", 1);
        setSearchResults(response.results);
        setTrackerStatus(response.tracker_status);

        const hashes = response.results
          .map((r) => r.info_hash)
          .filter((h) => h.length > 0);
        if (hashes.length > 0) {
          checkCacheAvailability(hashes)
            .then((cached) => {
              setCachedHashes(new Set(cached.map((h) => h.toLowerCase())));
              setCacheChecked(true);
            })
            .catch(() => setCacheChecked(true));
        } else {
          setCacheChecked(true);
        }
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

  const handleSelectTorrent = useCallback((id: string) => {
    navigate("/torrents");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("torrent-select", { detail: id }));
    }, 50);
  }, [navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
            handleSelectTorrent(torrent.id);
          }
        }
      }
    },
    [displayResults, mode, selectedIndex, searchResults, filteredLocal, addedHashes, addingHash, handleAddTorrent, handleSelectTorrent]
  );

  const warningTrackers = trackerStatus.filter((t) => !t.ok);

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="flex items-center gap-4 px-8 py-6 border-b border-[var(--theme-border)] shrink-0" style={{ paddingRight: "80px" }}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--theme-text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search torrents or paste magnet link..."
          className="text-[20px] text-[var(--theme-text-primary)] bg-transparent flex-1 outline-none placeholder:text-[var(--theme-text-ghost)]"
        />
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2 px-8 py-3 border-b border-[var(--theme-border-subtle)] shrink-0">
        <button
          onClick={() => setMode("search")}
          className={`px-5 py-2.5 rounded-lg text-[15px] font-medium cursor-pointer transition-colors ${
            mode === "search"
              ? "bg-[rgba(16,185,129,0.1)] text-[#10b981]"
              : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-hover)]"
          }`}
        >
          Search Trackers
        </button>
        <button
          onClick={() => setMode("local")}
          className={`px-5 py-2.5 rounded-lg text-[15px] font-medium cursor-pointer transition-colors ${
            mode === "local"
              ? "bg-[rgba(16,185,129,0.1)] text-[#10b981]"
              : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-hover)]"
          }`}
        >
          My Torrents
        </button>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="text-[#ef4444] text-[15px] px-8 py-4">{error}</div>
        )}

        {loading && (
          <div className="px-8 py-4 space-y-2" style={{ paddingRight: "80px" }}>
            <div className="flex items-center gap-3 py-2">
              <svg className="animate-spin h-5 w-5 text-[var(--accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-[var(--text-secondary)] text-[14px]">Searching, please wait...</span>
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg"
                style={{
                  animation: "shimmer 1.5s infinite",
                  backgroundSize: "200% 100%",
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%)",
                }}
              />
            ))}
          </div>
        )}

        {!loading && !error && query.trim() === "" && mode === "search" && (
          <div className="flex flex-col items-center justify-center py-32">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--theme-text-faint)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="text-[var(--theme-text-ghost)] text-[18px]">Search trackers for torrents</span>
            <span className="text-[var(--theme-text-faint)] text-[15px] mt-2">or paste a magnet link to add directly</span>
          </div>
        )}

        {!loading && !error && query.trim() !== "" && displayResults.length === 0 && (
          <div className="flex items-center justify-center py-32">
            <span className="text-[var(--theme-text-muted)] text-[18px]">No results found</span>
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
                    className="flex items-center gap-4 px-8 py-5 text-[16px] text-[#10b981]"
                    style={{ paddingRight: "80px" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" className="shrink-0">
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

              const isCached = cachedHashes.has(result.info_hash.toLowerCase());

              return (
                <div
                  key={result.info_hash}
                  onClick={() => !isAdding && handleAddTorrent(result)}
                  className={`flex items-center gap-5 px-8 py-5 cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? "bg-[var(--theme-selected)]"
                      : "hover:bg-[var(--theme-hover)]"
                  }`}
                  style={{ paddingRight: "80px" }}
                >
                  <span className="text-[16px] text-[var(--theme-text-primary)] truncate flex-1">
                    {result.title}
                  </span>
                  {cacheChecked && isCached && (
                    <span title="Cached — instant download" className="shrink-0">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[#10b981]">
                        <path d="M8.5 1L3 9h4.5l-1 6L13 7H8.5l1-6z" fill="currentColor" />
                      </svg>
                    </span>
                  )}
                  {!cacheChecked && result.info_hash.length > 0 && (
                    <span className="shrink-0 w-4 h-4 rounded-full border-2 border-[var(--theme-border)] border-t-[var(--accent)] animate-spin" />
                  )}
                  <span className="text-[13px] bg-[rgba(16,185,129,0.08)] text-[#10b981] rounded-md px-3 py-1 shrink-0 font-medium">
                    {result.source}
                  </span>
                  <span className="text-[15px] text-[var(--theme-text-muted)] shrink-0">
                    {result.size_display}
                  </span>
                  <span className={`text-[15px] ${seederColor} shrink-0 font-medium`}>
                    ↑{result.seeders}
                  </span>
                </div>
              );
            } else {
              const torrent = item as Torrent;
              return (
                <div
                  key={torrent.id}
                  onClick={() => handleSelectTorrent(torrent.id)}
                  className={`flex items-center gap-5 px-8 py-5 cursor-pointer transition-colors ${
                    index === selectedIndex
                      ? "bg-[var(--theme-selected)]"
                      : "hover:bg-[var(--theme-hover)]"
                  }`}
                  style={{ paddingRight: "80px" }}
                >
                  <span className="text-[16px] text-[var(--theme-text-primary)] truncate flex-1">
                    {torrent.filename}
                  </span>
                  <span className="text-[15px] text-[var(--theme-text-muted)] shrink-0">
                    {formatBytes(torrent.bytes)}
                  </span>
                  <span className="text-[13px] bg-[rgba(16,185,129,0.08)] text-[#10b981] rounded-md px-3 py-1 shrink-0 font-medium">
                    {torrent.status}
                  </span>
                </div>
              );
            }
          })}

        {/* Tracker warnings */}
        {warningTrackers.length > 0 && (
          <div className="px-8 py-4 text-[14px] text-[#eab308]" style={{ paddingRight: "80px" }}>
            {warningTrackers.map((t) => (
              <div key={t.name}>
                ⚠ {t.name}: {t.error ?? "unavailable"}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-8 py-3 border-t border-[var(--theme-border-subtle)] flex items-center gap-5 shrink-0">
        <span className="text-[13px] text-[var(--theme-text-faint)]">
          <kbd className="bg-[var(--theme-selected)] border border-[var(--theme-border)] rounded px-1.5 py-0.5 mx-0.5">Tab</kbd>
          {" "}switch mode
        </span>
        <span className="text-[13px] text-[var(--theme-text-faint)]">
          <kbd className="bg-[var(--theme-selected)] border border-[var(--theme-border)] rounded px-1.5 py-0.5 mx-0.5">↑↓</kbd>
          {" "}navigate
        </span>
        <span className="text-[13px] text-[var(--theme-text-faint)]">
          <kbd className="bg-[var(--theme-selected)] border border-[var(--theme-border)] rounded px-1.5 py-0.5 mx-0.5">Enter</kbd>
          {" "}select
        </span>
      </div>
    </div>
  );
}
