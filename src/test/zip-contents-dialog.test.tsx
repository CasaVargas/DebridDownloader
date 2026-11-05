import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { entries } = vi.hoisted(() => ({
  entries: Array.from({ length: 5000 }, (_, i) => ({
    path: `Game/data/file${String(i).padStart(4, "0")}.bin`,
    is_dir: false,
    header_offset: i * 100,
    compressed_size: 100,
    size: 100,
    method: 0,
    crc32: 0,
    flags: 0,
    data_offset: null,
    has_crc: true,
    encrypted: false,
    unsupported: null,
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/archive", () => ({
  inspectTorrentArchive: vi.fn().mockResolvedValue({
    link: { filename: "Game.zip", filesize: 500000, download: "https://x/Game.zip", source: { type: "Direct" } },
    archive_size: 600000,
    entries,
  }),
  startArchiveContentsDownload: vi.fn(),
}));

import ZipContentsDialog from "../components/ZipContentsDialog";
import { TooltipProvider } from "../components/ui";

const boxes = () => screen.queryAllByRole("checkbox", { name: /^Select / });

describe("Download contents dialog", () => {
  it("renders only a window of a long file list, but selects all of it", async () => {
    render(
      <TooltipProvider>
        <ZipContentsDialog torrentId="T1" fileId={1} fileName="Game.zip" onClose={() => {}} onStarted={() => {}} />
      </TooltipProvider>,
    );
    await screen.findByLabelText("Select Game/data/file0000.bin");
    expect(boxes().length).toBeLessThan(100);
    expect(screen.queryByLabelText("Select Game/data/file4999.bin")).toBeNull();
    // Every usable file is selected, not just the rendered ones.
    expect(screen.getByRole("button", { name: /Download 5000 files/ })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Filter files"), { target: { value: "file4999" } });
    expect(boxes()).toHaveLength(1);
    expect(screen.getByLabelText("Select Game/data/file4999.bin")).toBeTruthy();
  });
});
