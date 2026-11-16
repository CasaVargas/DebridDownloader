import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse, SearchResult } from "../types";

// Issue #93: Search Trackers fired a search (fanned out to every Prowlarr indexer) on each
// keystroke. Searches are now debounced ~600 ms, Enter runs a pending search at once, and
// responses from superseded searches are dropped.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
const { searchTorrents, checkCacheAvailability, addMagnet } = vi.hoisted(() => ({
  searchTorrents: vi.fn(),
  checkCacheAvailability: vi.fn(),
  addMagnet: vi.fn(),
}));
vi.mock("../api/search", () => ({
  searchTorrents: (...a: unknown[]) => searchTorrents(...a),
  checkCacheAvailability: (...a: unknown[]) => checkCacheAvailability(...a),
  getTrackerConfigs: vi.fn().mockResolvedValue([{ id: "p", name: "Prowlarr", url: "x", tracker_type: "prowlarr", enabled: true }]),
}));
vi.mock("../api/settings", () => ({ getSettings: vi.fn().mockResolvedValue({ torbox_search_enabled: false }) }));
vi.mock("../api/torrents", () => ({
  listTorrents: vi.fn().mockResolvedValue([]),
  addMagnet: (...a: unknown[]) => addMagnet(...a),
  selectTorrentFiles: vi.fn().mockResolvedValue(undefined),
}));

import SearchPage from "../pages/SearchPage";
import { TooltipProvider } from "../components/ui";

const DEBOUNCE = 600;

function result(title: string, hash: string): SearchResult {
  return { title, magnet: `magnet:?xt=urn:btih:${hash}`, info_hash: hash, size_bytes: 1, size_display: "1 B", seeders: 5, leechers: 0, date: "", source: "Prowlarr", category: "" };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  render(<MemoryRouter><TooltipProvider><SearchPage /></TooltipProvider></MemoryRouter>);
  const input = screen.getByRole("textbox", { name: "Search torrents or paste magnet link" });
  const type = (v: string) => act(async () => { fireEvent.change(input, { target: { value: v } }); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const flush = () => act(async () => {});
  return { input, type, advance, flush };
}

describe("Search Trackers debounce (#93)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchTorrents.mockReset();
    checkCacheAvailability.mockReset().mockResolvedValue([]);
    addMagnet.mockReset().mockResolvedValue({ id: "new" });
  });
  afterEach(() => vi.useRealTimers());

  it("searches once, with the full query, for keystrokes inside the debounce window", async () => {
    searchTorrents.mockResolvedValue({ results: [], tracker_status: [] } satisfies SearchResponse);
    const { type, advance } = setup();
    await type("spiderman br");
    await advance(DEBOUNCE - 100);
    await type("spiderman brand new day");
    await advance(DEBOUNCE - 1);
    expect(searchTorrents).not.toHaveBeenCalled();
    await advance(1);
    expect(searchTorrents).toHaveBeenCalledTimes(1);
    expect(searchTorrents).toHaveBeenCalledWith("spiderman brand new day", undefined, "seeders", 1);
  });

  it("does not search before the debounce delay elapses after the last keystroke", async () => {
    searchTorrents.mockResolvedValue({ results: [], tracker_status: [] });
    const { type, advance } = setup();
    await type("d");
    await advance(400);
    await type("du");
    await advance(400);
    await type("dun");
    await advance(400);
    expect(searchTorrents).not.toHaveBeenCalled();
    await advance(200);
    expect(searchTorrents).toHaveBeenCalledTimes(1);
    expect(searchTorrents).toHaveBeenCalledWith("dun", undefined, "seeders", 1);
  });

  it("drops results, tracker status and cache check from a search that a newer one superseded", async () => {
    const first = deferred<SearchResponse>();
    const second = deferred<SearchResponse>();
    searchTorrents.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { type, advance, flush } = setup();

    await type("alpha");
    await advance(DEBOUNCE);
    await type("beta");
    await advance(DEBOUNCE);
    expect(searchTorrents).toHaveBeenCalledTimes(2);

    // The older search finishes while the newer one is still running: ignored.
    await act(async () => {
      first.resolve({ results: [result("Alpha Movie", "aaa")], tracker_status: [{ name: "SlowIndexer", ok: false, error: "timed out" }] });
    });
    await flush();
    expect(screen.queryByText("Alpha Movie")).toBeNull();
    expect(screen.queryByText(/SlowIndexer/)).toBeNull();
    expect(checkCacheAvailability).not.toHaveBeenCalled();
    expect(screen.getByText("Searching, please wait...")).toBeInTheDocument();

    await act(async () => { second.resolve({ results: [result("Beta Movie", "bbb")], tracker_status: [] }); });
    await flush();
    expect(screen.getByText("Beta Movie")).toBeInTheDocument();
    expect(checkCacheAvailability).toHaveBeenCalledTimes(1);
    expect(checkCacheAvailability).toHaveBeenCalledWith(["bbb"]);
  });

  it("drops a superseded search that resolves after the newer one, and its error", async () => {
    const first = deferred<SearchResponse>();
    const second = deferred<SearchResponse>();
    searchTorrents.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { type, advance, flush } = setup();

    await type("alpha");
    await advance(DEBOUNCE);
    await type("beta");
    await advance(DEBOUNCE);
    await act(async () => { second.resolve({ results: [result("Beta Movie", "bbb")], tracker_status: [] }); });
    await flush();
    await act(async () => { first.resolve({ results: [result("Alpha Movie", "aaa")], tracker_status: [{ name: "SlowIndexer", ok: false, error: "x" }] }); });
    await flush();
    expect(screen.getByText("Beta Movie")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Movie")).toBeNull();
    expect(screen.queryByText(/SlowIndexer/)).toBeNull();
    expect(checkCacheAvailability).toHaveBeenCalledTimes(1);
    expect(checkCacheAvailability).toHaveBeenCalledWith(["bbb"]);

    // A stale failure doesn't clobber the current results either.
    const third = deferred<SearchResponse>();
    const fourth = deferred<SearchResponse>();
    searchTorrents.mockImplementationOnce(() => third.promise).mockImplementationOnce(() => fourth.promise);
    await type("gamma");
    await advance(DEBOUNCE);
    await type("delta");
    await advance(DEBOUNCE);
    await act(async () => { fourth.resolve({ results: [result("Delta Movie", "ddd")], tracker_status: [] }); });
    await act(async () => { third.reject(new Error("stale failure")); });
    await flush();
    expect(screen.getByText("Delta Movie")).toBeInTheDocument();
    expect(screen.queryByText("stale failure")).toBeNull();
  });

  it("Enter on an unsearched query searches immediately and adds nothing", async () => {
    searchTorrents.mockResolvedValue({ results: [result("Dune", "ddd")], tracker_status: [] });
    const { input, type, advance, flush } = setup();
    await type("dune");
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(searchTorrents).toHaveBeenCalledTimes(1);
    expect(searchTorrents).toHaveBeenCalledWith("dune", undefined, "seeders", 1);
    await flush();
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(addMagnet).not.toHaveBeenCalled();

    // The pending debounce was cancelled: no second search fires.
    await advance(DEBOUNCE * 2);
    expect(searchTorrents).toHaveBeenCalledTimes(1);

    // Enter on the already-searched query keeps adding the selected result.
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(addMagnet).toHaveBeenCalledWith("magnet:?xt=urn:btih:ddd");
    expect(searchTorrents).toHaveBeenCalledTimes(1);
  });

  it("Enter with a changed query searches again instead of adding the old selection", async () => {
    searchTorrents
      .mockResolvedValueOnce({ results: [result("Dune", "ddd")], tracker_status: [] })
      .mockResolvedValueOnce({ results: [result("Dune Part Two", "eee")], tracker_status: [] });
    const { input, type, advance, flush } = setup();
    await type("dune");
    await advance(DEBOUNCE);
    await flush();
    expect(screen.getByText("Dune")).toBeInTheDocument();

    await type("dune part two");
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(searchTorrents).toHaveBeenCalledTimes(2);
    expect(searchTorrents).toHaveBeenLastCalledWith("dune part two", undefined, "seeders", 1);
    expect(addMagnet).not.toHaveBeenCalled();
  });

  it("clearing the input empties results and errors and cancels the pending debounce", async () => {
    searchTorrents.mockRejectedValueOnce(new Error("Prowlarr down"));
    const { type, advance, flush } = setup();
    await type("dune");
    await advance(DEBOUNCE);
    await flush();
    expect(screen.getByText("Prowlarr down")).toBeInTheDocument();

    searchTorrents.mockResolvedValue({ results: [result("Dune", "ddd")], tracker_status: [] });
    await type("dune 2");
    await advance(DEBOUNCE);
    await flush();
    expect(screen.getByText("Dune")).toBeInTheDocument();

    await type("");
    expect(screen.queryByText("Dune")).toBeNull();
    expect(screen.queryByText("Prowlarr down")).toBeNull();

    // Typing then clearing before the debounce fires never searches.
    searchTorrents.mockClear();
    await type("arrival");
    await advance(DEBOUNCE / 2);
    await type("");
    await advance(DEBOUNCE * 2);
    expect(searchTorrents).not.toHaveBeenCalled();
  });

  it("clearing the input discards a search that is still in flight", async () => {
    const pending = deferred<SearchResponse>();
    searchTorrents.mockImplementationOnce(() => pending.promise);
    const { type, advance, flush } = setup();
    await type("dune");
    await advance(DEBOUNCE);
    expect(searchTorrents).toHaveBeenCalledTimes(1);
    await type("");
    await act(async () => { pending.resolve({ results: [result("Dune", "ddd")], tracker_status: [] }); });
    await flush();
    expect(screen.queryByText("Dune")).toBeNull();
    expect(screen.queryByText("Searching, please wait...")).toBeNull();
    expect(checkCacheAvailability).not.toHaveBeenCalled();
  });
});
