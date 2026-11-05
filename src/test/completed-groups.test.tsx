import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fileLabel, groupCompleted, isExtra } from "../lib/completedGroups";
import type { DownloadTask } from "../types";
import { formatBytes } from "../utils";

// The Completed view groups finished files by the torrent they came from.

const { tasks, removeDownload } = vi.hoisted(() => {
  const task = (id: string, batch: string, filename: string, bytes: number, dest: string, updated: number) => ({
    id, filename, url: "", destination: dest, total_bytes: bytes, downloaded_bytes: bytes, speed: 0,
    status: "Completed", batch_id: batch, updated_at: updated,
  });
  const dir = "/dl/Escape Simulator 2";
  return {
    tasks: [
      task("e1", "B1", "Escape.Simulator.2-RUNE/README.txt", 338, `${dir}/a`, 1000),
      task("e2", "B1", "Escape.Simulator.2-RUNE/rune-escape.iso", 15e9, `${dir}/b`, 3000),
      task("e3", "B1", "Escape.Simulator.2-RUNE/IGG-GAMES.COM.url", 196, `${dir}/c`, 2000),
      task("e4", "B1", "Escape.Simulator.2-RUNE/Crack/steam_api64.dll", 4e5, `${dir}/d`, 2000),
      task("m1", "B2", "Movie.2012.mkv", 2e9, "/dl/Movie.2012.mkv", 5000),
      task("s1", "", "Linked.mkv", 1e9, "/lib/Linked.mkv", 4000),
    ] as DownloadTask[],
    removeDownload: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../hooks/useDownloadTasks", () => ({ useDownloadTasks: () => ({ tasks, refreshTasks: vi.fn() }) }));
vi.mock("../api/downloads", () => ({
  removeDownload: (...a: unknown[]) => removeDownload(...a),
  clearCompletedDownloads: vi.fn(),
}));

import CompletedPage from "../pages/CompletedPage";
import { TooltipProvider } from "../components/ui";

describe("groupCompleted", () => {
  const groups = groupCompleted(tasks);
  const escape = groups.find((g) => g.id === "B1")!;

  it("makes one group per batch, and one per file that has no batch", () => {
    expect(groups.map((g) => g.id)).toEqual(["B1", "B2", "s1"]);
  });

  it("names a torrent after its shared folder and strips it from file names", () => {
    expect(escape.name).toBe("Escape.Simulator.2-RUNE");
    expect(escape.files.map((t) => fileLabel(t, escape))).toEqual([
      "rune-escape.iso", "Crack/steam_api64.dll", "README.txt", "IGG-GAMES.COM.url",
    ]);
  });

  it("puts content before extras, largest first, and totals the torrent", () => {
    expect(escape.extras).toBe(2);
    expect(escape.totalBytes).toBe(338 + 15e9 + 196 + 4e5);
    expect(escape.finishedAt).toBe(3000);
    expect(escape.folder).toBe("/dl/Escape Simulator 2");
  });

  it("names a lone file after itself", () => {
    expect(groups.find((g) => g.id === "B2")!.name).toBe("Movie.2012.mkv");
  });

  it("treats readmes, links and checksums as extras", () => {
    expect(["a.txt", "b.NFO", "c.url", "d.sfv"].every(isExtra)).toBe(true);
    expect(["a.mkv", "b.iso", "c.dll", "noext"].some(isExtra)).toBe(false);
  });
});

describe("Completed page", () => {
  const renderPage = () => render(<TooltipProvider><CompletedPage /></TooltipProvider>);
  const rowNames = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("lists torrents newest first, collapsed", () => {
    renderPage();
    expect(screen.getByText(`3 torrents · ${formatBytes(tasks.reduce((s, t) => s + t.total_bytes, 0))}`)).toBeInTheDocument();
    expect(rowNames()).toEqual(["Movie.2012.mkv", "Linked.mkv", "Escape.Simulator.2-RUNE4 files"]);
  });

  it("expands a torrent with its extras tucked behind + N more", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(rowNames().slice(2)).toEqual(["Escape.Simulator.2-RUNE4 files", "rune-escape.iso", "Crack/steam_api64.dll", "+ 2 more"]);
    fireEvent.click(screen.getByText("+ 2 more"));
    expect(rowNames().slice(5)).toEqual(["Show fewer", "README.txt", "IGG-GAMES.COM.url"]);
  });

  it("removing a torrent removes every one of its files from the list", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Escape.Simulator.2-RUNE"));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Remove" }));
    });
    expect(removeDownload.mock.calls.map((c) => c[0]).sort()).toEqual(["e1", "e2", "e3", "e4"]);
  });
});
