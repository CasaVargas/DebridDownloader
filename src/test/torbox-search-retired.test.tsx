import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Issue #92: TorBox retired its Search API (its host no longer resolves), so the
// scraper is gone, Settings > Search shows a retirement note instead of the toggle, and a
// persisted `torbox_search_enabled: true` no longer counts as a search source.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../api/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ max_concurrent_downloads: 3, create_torrent_subfolders: true, download_folder: null, theme: "dark", provider: "torbox", torbox_search_enabled: true }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  detectRarTool: vi.fn().mockResolvedValue(null),
}));
vi.mock("../api/providers", () => ({ getActiveProvider: vi.fn().mockResolvedValue("torbox") }));
vi.mock("../api/search", () => ({
  getTrackerConfigs: vi.fn().mockResolvedValue([]),
  saveTrackerConfigs: vi.fn().mockResolvedValue(undefined),
  testTracker: vi.fn(),
  searchTorrents: vi.fn().mockResolvedValue({ results: [], tracker_status: [] }),
  checkCacheAvailability: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/torrents", () => ({
  listTorrents: vi.fn().mockResolvedValue([]),
  addMagnet: vi.fn(),
  selectTorrentFiles: vi.fn(),
}));

import { settingsRoutes } from "../pages/settings/SettingsLayout";
import SearchPage from "../pages/SearchPage";
import { TooltipProvider } from "../components/ui";

const ROOT = resolve(__dirname, "../..");
const RETIRED_HOST = ["search-api", "torbox", "app"].join(".");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|rs)$/.test(f) ? [p] : [];
  });
}

describe("TorBox Search retirement (#92)", () => {
  it("no source file under src/ or src-tauri/src/ references the retired search host", () => {
    const hits = [...walk(`${ROOT}/src`), ...walk(`${ROOT}/src-tauri/src`)].filter((p) => readFileSync(p, "utf8").includes(RETIRED_HOST));
    expect(hits).toEqual([]);
  });

  it("Settings > Search shows the retirement note pointing to Prowlarr/Jackett and no toggle", async () => {
    render(
      <MemoryRouter initialEntries={["/settings/search"]}>
        <Routes>{settingsRoutes}</Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/TorBox retired its Search API/)).toHaveTextContent(/Prowlarr or Jackett/);
    expect(screen.queryByRole("switch", { name: "TorBox Search" })).not.toBeInTheDocument();
  });

  it("with torbox_search_enabled persisted and no trackers, Search shows the no-source state", async () => {
    render(<MemoryRouter><TooltipProvider><SearchPage /></TooltipProvider></MemoryRouter>);
    expect(await screen.findByText("No trackers configured")).toBeInTheDocument();
  });
});
