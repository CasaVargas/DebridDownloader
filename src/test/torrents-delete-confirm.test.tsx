import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #47: in Tauri, tauri-plugin-dialog replaces window.confirm with an async version that
// returns a Promise. Deleting must wait for the answer and do nothing on "No".

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("../contexts/MiniPlayerContext", () => ({
  useMiniPlayer: () => ({ openPreview: vi.fn(), loadingTorrentId: null }),
}));
vi.mock("../api/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ download_folder: "/dl", max_concurrent_downloads: 3, create_torrent_subfolders: true, theme: "dark", provider: "real-debrid" }),
}));
const { torrent, deleteTorrent } = vi.hoisted(() => ({
  torrent: { id: "T1", filename: "Movie.mp4", hash: "abc", bytes: 1000, progress: 100, status: "downloaded", added: "2026-09-20T00:00:00Z", links: ["x"] },
  deleteTorrent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../api/torrents", () => ({
  listTorrents: vi.fn().mockImplementation(() => Promise.resolve([torrent])),
  getTorrentInfo: vi.fn().mockResolvedValue({ ...torrent, files: [{ id: 7, path: "/Movie.mp4", bytes: 990, selected: true }] }),
  deleteTorrent: (...args: unknown[]) => deleteTorrent(...args),
  selectTorrentFiles: vi.fn(),
}));

import TorrentsPage from "../pages/TorrentsPage";
import { TooltipProvider } from "../components/ui";
import { confirmAction } from "../lib/confirm";

/** A window.confirm shaped like tauri-plugin-dialog's: returns a Promise we resolve by hand. */
function stubAsyncConfirm() {
  let answer!: (v: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>((r) => { answer = r; }));
  vi.stubGlobal("confirm", confirm);
  window.confirm = confirm as unknown as typeof window.confirm;
  return { confirm, answer: (v: boolean) => act(async () => { answer(v); }) };
}

async function renderAndSelect() {
  render(<TooltipProvider><TorrentsPage /></TooltipProvider>);
  fireEvent.click(await screen.findByText("Movie.mp4", { selector: "div" }));
  // Inspector "Delete" button (exact name; the row's More menu is separate).
  return await screen.findByRole("button", { name: "Delete" });
}

describe("Torrent delete confirmation (#47)", () => {
  const realConfirm = window.confirm;
  beforeEach(() => deleteTorrent.mockClear());
  afterEach(() => { vi.unstubAllGlobals(); window.confirm = realConfirm; });

  it("inspector Delete waits for the answer and keeps the torrent on No", async () => {
    const { confirm, answer } = stubAsyncConfirm();
    fireEvent.click(await renderAndSelect());
    expect(confirm).toHaveBeenCalledWith("Delete this torrent?");
    await act(async () => {});
    expect(deleteTorrent).not.toHaveBeenCalled(); // dialog still open
    await answer(false);
    expect(deleteTorrent).not.toHaveBeenCalled();
  });

  it("inspector Delete deletes after Yes", async () => {
    const { answer } = stubAsyncConfirm();
    fireEvent.click(await renderAndSelect());
    await act(async () => {});
    expect(deleteTorrent).not.toHaveBeenCalled();
    await answer(true);
    await waitFor(() => expect(deleteTorrent).toHaveBeenCalledWith("T1"));
  });

  it("delete-selected shortcut waits for the answer and keeps the torrent on No", async () => {
    const { confirm, answer } = stubAsyncConfirm();
    await renderAndSelect();
    act(() => { window.dispatchEvent(new Event("delete-selected")); });
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(deleteTorrent).not.toHaveBeenCalled();
    await answer(false);
    expect(deleteTorrent).not.toHaveBeenCalled();
  });

  it("row More-actions Delete waits for the answer and keeps the torrent on No", async () => {
    const { confirm, answer } = stubAsyncConfirm();
    render(<TooltipProvider><TorrentsPage /></TooltipProvider>);
    const more = await screen.findByRole("button", { name: "More actions" });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith("Delete this torrent?");
    await act(async () => {});
    expect(deleteTorrent).not.toHaveBeenCalled();
    await answer(false);
    expect(deleteTorrent).not.toHaveBeenCalled();
  });

  it("toolbar Delete All waits for the answer and keeps torrents on No", async () => {
    const { confirm, answer } = stubAsyncConfirm();
    render(<TooltipProvider><TorrentsPage /></TooltipProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete All" }));
    expect(confirm).toHaveBeenCalledWith("Delete all 1 torrents?");
    await act(async () => {});
    expect(deleteTorrent).not.toHaveBeenCalled();
    await answer(false);
    expect(deleteTorrent).not.toHaveBeenCalled();
    expect(screen.getByText("Movie.mp4", { selector: "div" })).toBeInTheDocument();
  });

  it("delete-selected shortcut deletes after Yes", async () => {
    const { answer } = stubAsyncConfirm();
    await renderAndSelect();
    act(() => { window.dispatchEvent(new Event("delete-selected")); });
    await answer(true);
    await waitFor(() => expect(deleteTorrent).toHaveBeenCalledWith("T1"));
  });
});

describe("confirmAction", () => {
  const realConfirm = window.confirm;
  afterEach(() => { window.confirm = realConfirm; });

  it("treats a pending-then-false async confirm as No", async () => {
    window.confirm = (() => Promise.resolve(false)) as unknown as typeof window.confirm;
    await expect(confirmAction("x")).resolves.toBe(false);
  });

  it("accepts async true and sync true/false", async () => {
    window.confirm = (() => Promise.resolve(true)) as unknown as typeof window.confirm;
    await expect(confirmAction("x")).resolves.toBe(true);
    window.confirm = () => true;
    await expect(confirmAction("x")).resolves.toBe(true);
    window.confirm = () => false;
    await expect(confirmAction("x")).resolves.toBe(false);
  });
});
