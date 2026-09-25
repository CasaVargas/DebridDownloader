import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const openPreview = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("../contexts/MiniPlayerContext", () => ({
  useMiniPlayer: () => ({ openPreview, loadingTorrentId: null }),
}));
vi.mock("../api/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ download_folder: "/dl", max_concurrent_downloads: 3, create_torrent_subfolders: true, theme: "dark", provider: "real-debrid" }),
}));
vi.mock("../api/torrents", () => ({
  listTorrents: vi.fn().mockResolvedValue([
    { id: "T1", filename: "Movie.mp4", hash: "abc", bytes: 1000, progress: 100, status: "downloaded", added: "2026-09-20T00:00:00Z", links: ["x"] },
  ]),
  getTorrentInfo: vi.fn().mockResolvedValue({
    id: "T1", filename: "Movie.mp4", hash: "abc", bytes: 1000, progress: 100, status: "downloaded", added: "2026-09-20T00:00:00Z", links: ["x"],
    files: [
      { id: 7, path: "/Movie.mp4", bytes: 990, selected: true },
      { id: 8, path: "/Extras/clip.mkv", bytes: 10, selected: true },
    ],
  }),
  deleteTorrent: vi.fn(),
  selectTorrentFiles: vi.fn(),
}));

import TorrentsPage from "../pages/TorrentsPage";
import { TooltipProvider } from "../components/ui";

describe("Torrents inspector preview", () => {
  it("plays a file in the mini player instead of inline in the inspector", async () => {
    render(<TooltipProvider><TorrentsPage /></TooltipProvider>);
    fireEvent.click(await screen.findByText("Movie.mp4", { selector: "div" }));
    const play = await screen.findAllByRole("button", { name: /^Play/ });
    fireEvent.click(play[0]);
    expect(openPreview).toHaveBeenCalledWith("T1", 7, "Movie.mp4");
    expect(document.querySelector("aside video")).toBeNull();
  });
});
