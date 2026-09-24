import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Sections call Tauri APIs on mount; in jsdom every command resolves to an empty result.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

vi.mock("../api/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ max_concurrent_downloads: 3, create_torrent_subfolders: true, download_folder: null, theme: "dark", provider: "real-debrid" }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  detectRarTool: vi.fn().mockResolvedValue(null),
}));

import { settingsRoutes } from "../pages/settings/SettingsLayout";

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{settingsRoutes}</Routes>
    </MemoryRouter>,
  );
}

describe("settings routes redirect", () => {
  it.each([
    ["/settings", "General"],
    ["/settings/nope", "General"],
    ["/about", "About & Backup"],
    ["/settings/search", "Search"],
  ])("%s lands on %s", async (path, heading) => {
    at(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });
});
