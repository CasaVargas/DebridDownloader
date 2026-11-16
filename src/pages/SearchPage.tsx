import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { searchTorrents, checkCacheAvailability, getTrackerConfigs } from "../api/search";
import { getSettings } from "../api/settings";
import { listTorrents, addMagnet, selectTorrentFiles } from "../api/torrents";
import type { SearchResult, Torrent, TrackerStatus } from "../types";
import { Button, cn, EmptyState, Input, Kbd, Spinner, StatusDot } from "../components/ui";
import { torrentStatusDot, torrentStatusLabel } from "../utils";

const SEARCH_COLS = "minmax(0, 1fr) calc(var(--spacing) * 24) calc(var(--spacing) * 20) calc(var(--spacing) * 16) calc(var(--spacing) * 18)";
// Wait this long after the last keystroke before hitting the trackers (Prowlarr fans each query
// out to every indexer, so partial queries are expensive). Enter skips the wait.
const SEARCH_DEBOUNCE_MS = 600;
const LOCAL_COLS = "minmax(0, 1fr) calc(var(--spacing) * 20) calc(var(--spacing) * 28)";

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

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
  // Whether any search source (enabled tracker or TorBox search) exists, for the "no trackers" empty state.
  const [sourcesKnown, setSourcesKnown] = useState(false);
  const [hasSearchSource, setHasSearchSource] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Id of the newest tracker search; older responses compare against it and bail out.
  const requestIdRef = useRef(0);
  // Query the last tracker search ran with, so Enter knows whether to search or add.
  const lastSearchedRef = useRef<string | null>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    Promise.all([getTrackerConfigs(), getSettings().catch(() => null)])
      .then(([trackers, settings]) => {
        setHasSearchSource(trackers.some((t) => t.enabled) || !!settings?.torbox_search_enabled);
        setSourcesKnown(true);
      })
      .catch(() => {});
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

  // Runs one tracker search. Each run takes a new request id; a response, error or cache check
  // that comes back after a newer search started (or after the input was cleared) is dropped.
  const runSearch = useCallback(async (q: string) => {
    const id = ++requestIdRef.current;
    const isCurrent = () => id === requestIdRef.current;
    lastSearchedRef.current = q;
    setLoading(true);
    setError("");
    setCacheChecked(false);
    setCachedHashes(new Set());
    try {
      const response = await searchTorrents(q, undefined, "seeders", 1);
      if (!isCurrent()) return;
      setSearchResults(response.results);
      setTrackerStatus(response.tracker_status);

      const hashes = response.results
        .map((r) => r.info_hash)
        .filter((h) => h.length > 0);
      if (hashes.length > 0) {
        checkCacheAvailability(hashes)
          .then((cached) => {
            if (!isCurrent()) return;
            setCachedHashes(new Set(cached.map((h) => h.toLowerCase())));
            setCacheChecked(true);
          })
          .catch(() => {
            if (isCurrent()) setCacheChecked(true);
          });
      } else {
        setCacheChecked(true);
      }
    } catch (e) {
      if (!isCurrent()) return;
      setError(e instanceof Error ? e.message : String(e));
      setSearchResults([]);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const cancelPendingSearch = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  // Debounced search
  useEffect(() => {
    if (mode !== "search") return;
    if (!query.trim()) {
      cancelPendingSearch();
      // Invalidate any search still in flight so its results don't land after the clear.
      requestIdRef.current++;
      lastSearchedRef.current = null;
      setSearchResults([]);
      setTrackerStatus([]);
      setError("");
      setLoading(false);
      return;
    }

    cancelPendingSearch();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runSearch(query);
    }, SEARCH_DEBOUNCE_MS);

    return cancelPendingSearch;
  }, [query, mode, runSearch]);

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
        // A query that hasn't been searched yet: search now instead of waiting for the debounce.
        if (mode === "search" && query.trim() && query !== lastSearchedRef.current) {
          cancelPendingSearch();
          runSearch(query);
          return;
        }
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
    [displayResults, mode, query, runSearch, selectedIndex, searchResults, filteredLocal, addedHashes, addingHash, handleAddTorrent, handleSelectTorrent]
  );

  const warningTrackers = trackerStatus.filter((t) => !t.ok);
  const noTrackers = sourcesKnown && !hasSearchSource;

  const tabClass = (active: boolean) =>
    cn(
      "h-6 rounded-md px-2.5 text-sm font-medium transition-colors duration-120",
      active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg",
    );

  return (
    <div className="flex h-full flex-col">
      {/* Search input */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search torrents or paste magnet link..."
          aria-label="Search torrents or paste magnet link"
          icon={<SearchIcon />}
          kbd="Mod+K"
          className="h-9 text-md"
        />
        {/* Mode tabs */}
        <div role="tablist" aria-label="Search mode" className="flex gap-1">
          <button type="button" role="tab" aria-selected={mode === "search"} onClick={() => setMode("search")} className={tabClass(mode === "search")}>
            Search Trackers
          </button>
          <button type="button" role="tab" aria-selected={mode === "local"} onClick={() => setMode("local")} className={tabClass(mode === "local")}>
            My Torrents
          </button>
        </div>
      </div>

      {/* Results area */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {error && <div className="border-b border-border px-4 py-2 text-sm text-danger">{error}</div>}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-fg-secondary">
            <Spinner size="sm" />
            Searching, please wait...
          </div>
        )}

        {!loading && !error && query.trim() === "" && mode === "search" && (
          noTrackers ? (
            <EmptyState
              title="No trackers configured"
              hint="Add a tracker to search from here, or paste a magnet link"
              action={<Button onClick={() => navigate("/settings/search")}>Add a tracker</Button>}
            />
          ) : (
            <EmptyState title="Search trackers for torrents" hint="or paste a magnet link to add directly" />
          )
        )}

        {!loading && !error && query.trim() !== "" && displayResults.length === 0 && <EmptyState title="No results found" />}

        {!loading && displayResults.length > 0 && (
          <div role="table" aria-label={mode === "search" ? "Search results" : "My torrents"}>
            <div
              role="row"
              className="sticky top-0 z-10 grid h-6.5 select-none items-center gap-3 border-b border-border bg-bg px-4 text-xs font-semibold uppercase tracking-wider text-fg-muted"
              style={{ gridTemplateColumns: mode === "search" ? SEARCH_COLS : LOCAL_COLS }}
            >
              <span role="columnheader">Name</span>
              {mode === "search" ? (
                <>
                  <span role="columnheader">Source</span>
                  <span role="columnheader" className="text-right">Size</span>
                  <span role="columnheader" className="text-right">Seeders</span>
                  <span role="columnheader" />
                </>
              ) : (
                <>
                  <span role="columnheader" className="text-right">Size</span>
                  <span role="columnheader">Status</span>
                </>
              )}
            </div>

            {displayResults.map((item, index) => {
              if (mode === "search") {
                const result = item as SearchResult;
                const isAdded = addedHashes.has(result.info_hash);
                const isAdding = addingHash === result.info_hash;
                const seederColor =
                  result.seeders >= 10 ? "text-success" : result.seeders >= 1 ? "text-warning" : "text-danger";
                const isCached = cachedHashes.has(result.info_hash.toLowerCase());

                return (
                  <div
                    key={result.info_hash}
                    role="row"
                    aria-selected={index === selectedIndex}
                    onClick={() => !isAdding && !isAdded && handleAddTorrent(result)}
                    className={cn(
                      "grid min-h-7.5 cursor-default items-center gap-3 border-b border-border-subtle px-4 py-1",
                      index === selectedIndex ? "bg-selected" : "hover:bg-raised",
                    )}
                    style={{ gridTemplateColumns: SEARCH_COLS }}
                  >
                    <span role="cell" className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-base text-fg">{result.title}</span>
                      {cacheChecked && isCached && (
                        <span className="shrink-0 text-sm text-fg-secondary" title="Cached — instant download">
                          <StatusDot status="success">Cached</StatusDot>
                        </span>
                      )}
                      {!cacheChecked && result.info_hash.length > 0 && <Spinner size="sm" />}
                    </span>
                    <span role="cell" className="truncate text-sm text-fg-secondary">{result.source}</span>
                    <span role="cell" className="text-right text-base text-fg-secondary tabular">{result.size_display}</span>
                    <span role="cell" className={cn("text-right text-base font-medium tabular", seederColor)}>↑{result.seeders}</span>
                    <span role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      {isAdded ? (
                        <StatusDot status="success"><span className="text-sm">Added</span></StatusDot>
                      ) : (
                        <Button size="sm" disabled={isAdding} onClick={() => handleAddTorrent(result)}>
                          {isAdding ? "Adding..." : "Add"}
                        </Button>
                      )}
                    </span>
                  </div>
                );
              } else {
                const torrent = item as Torrent;
                return (
                  <div
                    key={torrent.id}
                    role="row"
                    aria-selected={index === selectedIndex}
                    onClick={() => handleSelectTorrent(torrent.id)}
                    className={cn(
                      "grid min-h-7.5 cursor-default items-center gap-3 border-b border-border-subtle px-4 py-1",
                      index === selectedIndex ? "bg-selected" : "hover:bg-raised",
                    )}
                    style={{ gridTemplateColumns: LOCAL_COLS }}
                  >
                    <span role="cell" className="truncate text-base text-fg">{torrent.filename}</span>
                    <span role="cell" className="text-right text-base text-fg-secondary tabular">{formatBytes(torrent.bytes)}</span>
                    <span role="cell">
                      <StatusDot status={torrentStatusDot(torrent.status)}>{torrentStatusLabel(torrent.status)}</StatusDot>
                    </span>
                  </div>
                );
              }
            })}
          </div>
        )}

        {/* Tracker warnings */}
        {warningTrackers.length > 0 && (
          <div className="px-4 py-3 text-sm text-warning">
            {warningTrackers.map((t) => (
              <div key={t.name}>
                ⚠ {t.name}: {t.error ?? "unavailable"}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-sm text-fg-muted">
        <span className="flex items-center gap-1.5"><Kbd combo="Tab" /> switch mode</span>
        <span className="flex items-center gap-1.5"><Kbd combo="↑↓" /> navigate</span>
        <span className="flex items-center gap-1.5"><Kbd combo="Enter" /> select</span>
      </div>
    </div>
  );
}
