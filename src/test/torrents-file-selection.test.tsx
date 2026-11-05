import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Picking which files of a ready torrent to download, and showing file names in full.

const LONG_NAME = "www.UIndex.org - ParaNorman 2012 1080p BluRay REMUX AVC DTS-HD-MA 5 1-UnKn0wn.mkv";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("../contexts/MiniPlayerContext", () => ({
  useMiniPlayer: () => ({ openPreview: vi.fn(), loadingTorrentId: null }),
}));
vi.mock("../api/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ download_folder: "/dl", max_concurrent_downloads: 3, create_torrent_subfolders: true, theme: "dark", provider: "real-debrid" }),
}));
const { torrent, unrestrictTorrentLinks, startDownloads } = vi.hoisted(() => ({
  torrent: { id: "T1", filename: "ParaNorman 2012", hash: "abc", bytes: 3000, progress: 100, status: "downloaded", added: "2026-10-22T00:00:00Z", links: ["a", "b", "c"] },
  unrestrictTorrentLinks: vi.fn(),
  startDownloads: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/torrents", () => ({
  listTorrents: vi.fn().mockImplementation(() => Promise.resolve([torrent])),
  getTorrentInfo: vi.fn().mockImplementation(() =>
    Promise.resolve({
      ...torrent,
      files: [
        { id: 1, path: "/ParaNorman/info.nfo", bytes: 100, selected: true },
        { id: 2, path: `/ParaNorman/${LONG_NAME}`, bytes: 2000, selected: true },
        { id: 3, path: "/ParaNorman/Extras/sample.mkv", bytes: 900, selected: true },
        { id: 4, path: "/ParaNorman/junk.exe", bytes: 5, selected: false },
      ],
    }),
  ),
  deleteTorrent: vi.fn(),
  selectTorrentFiles: vi.fn(),
}));
vi.mock("../api/downloads", () => ({
  unrestrictTorrentLinks: (...args: unknown[]) => unrestrictTorrentLinks(...args),
  startDownloads: (...args: unknown[]) => startDownloads(...args),
}));

import TorrentsPage from "../pages/TorrentsPage";
import { TooltipProvider } from "../components/ui";

const LINK = { filename: LONG_NAME, filesize: 2000, download: "https://x/y" };

const inspector = () => within(screen.getByRole("complementary", { name: "ParaNorman 2012" }));

async function renderAndSelect() {
  render(<TooltipProvider><TorrentsPage /></TooltipProvider>);
  fireEvent.click(await screen.findByText("ParaNorman 2012", { selector: "div" }));
  await screen.findByRole("checkbox", { name: `Select ParaNorman/${LONG_NAME}` });
}

describe("Torrent file selection", () => {
  beforeEach(() => {
    unrestrictTorrentLinks.mockReset().mockResolvedValue([LINK]);
    startDownloads.mockClear();
  });

  it("starts with every available file ticked and downloads them all in one request", async () => {
    await renderAndSelect();
    expect(screen.getByText("3 of 3 selected, 2.9 KB")).toBeInTheDocument();
    await act(async () => { fireEvent.click(inspector().getByRole("button", { name: "Download" })); });
    expect(unrestrictTorrentLinks).toHaveBeenCalledWith("T1", undefined);
    expect(startDownloads).toHaveBeenCalledWith([LINK], "/dl", "ParaNorman 2012");
  });

  it("downloads only the ticked files", async () => {
    await renderAndSelect();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select ParaNorman/info.nfo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select ParaNorman/Extras/sample.mkv" }));
    expect(screen.getByText("1 of 3 selected, 2.0 KB")).toBeInTheDocument();
    await act(async () => { fireEvent.click(inspector().getByRole("button", { name: "Download 1 file" })); });
    expect(unrestrictTorrentLinks).toHaveBeenCalledWith("T1", [2]);
    expect(startDownloads).toHaveBeenCalledWith([LINK], "/dl", "ParaNorman 2012");
  });

  it("clicking a file name toggles its checkbox", async () => {
    await renderAndSelect();
    fireEvent.click(screen.getByText("info.nfo"));
    expect(screen.getByRole("checkbox", { name: "Select ParaNorman/info.nfo" })).not.toBeChecked();
  });

  it("Select none disables Download and Select all restores it", async () => {
    await renderAndSelect();
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(inspector().getByRole("button", { name: "Download" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(inspector().getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("files the provider has no link for can't be ticked", async () => {
    await renderAndSelect();
    const junk = screen.getByRole("checkbox", { name: "Select ParaNorman/junk.exe" });
    expect(junk).toBeDisabled();
    expect(junk).not.toBeChecked();
  });

  it("shows long names in full, with the folder underneath", async () => {
    await renderAndSelect();
    const name = screen.getByText(LONG_NAME);
    expect(name).not.toHaveClass("truncate");
    expect(screen.getByText("ParaNorman/Extras")).toBeInTheDocument();
  });

  it("reports when no links come back instead of doing nothing", async () => {
    unrestrictTorrentLinks.mockResolvedValue([]);
    await renderAndSelect();
    await act(async () => { fireEvent.click(inspector().getByRole("button", { name: "Download" })); });
    await waitFor(() => expect(screen.getByText(/No download links/)).toBeInTheDocument());
    expect(startDownloads).not.toHaveBeenCalled();
  });
});
