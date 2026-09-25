import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));

import Sidebar from "../components/Sidebar";
import { TooltipProvider } from "../components/ui";

function renderSidebar(unread = 0) {
  render(
    <TooltipProvider>
      <Sidebar activeView="torrents" onNavigate={() => {}} onSearchOpen={() => {}} onSettingsOpen={() => {}} onAboutOpen={() => {}} unreadWatchCount={unread} />
    </TooltipProvider>,
  );
}

describe("sidebar shortcut hints", () => {
  it("nav key hints are hidden until the row is hovered or focused", () => {
    renderSidebar();
    for (const name of ["Torrents", "Downloads", "Completed", "Search", "Watch List"]) {
      const row = screen.getByRole("button", { name: new RegExp(name) });
      expect(row.className).toContain("group");
      const hint = row.querySelector("kbd")!.parentElement!;
      expect(hint.className).toMatch(/\bopacity-0\b/);
      expect(hint.className).toContain("group-hover:opacity-100");
      expect(hint.className).toContain("group-focus-visible:opacity-100");
    }
  });

  it("count badges stay visible", () => {
    renderSidebar(3);
    const row = screen.getByRole("button", { name: /Watch List/ });
    expect(row.querySelector("kbd")).toBeNull();
    const badge = within(row).getByText("3");
    expect(badge.className).not.toMatch(/\bopacity-0\b/);
    expect(badge.parentElement!.className).not.toMatch(/\bopacity-0\b/);
  });
});
