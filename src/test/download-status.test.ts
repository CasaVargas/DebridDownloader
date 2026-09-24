import { describe, expect, it } from "vitest";
import { downloadStatusView, postProcessingSteps } from "../lib/downloadStatus";
import type { DownloadTask } from "../types";

const base: DownloadTask = { id: "1", filename: "f", url: "", destination: "/d/f", total_bytes: 100, downloaded_bytes: 40, speed: 0, status: "Downloading" };
const NOW = 1_000_000;

describe("downloadStatusView", () => {
  it("shows Extracting as 'Finishing…' with the info tone", () => {
    expect(downloadStatusView({ ...base, status: "Extracting" }, NOW)).toMatchObject({ tone: "info", label: "Finishing…" });
  });
  it("retrying countdown is a warning", () => {
    const v = downloadStatusView({ ...base, status: "Pending", retry_at: NOW + 12_000, attempt: 3 }, NOW);
    expect(v).toMatchObject({ tone: "warning", label: "Retrying in 12s · attempt 3/8" });
  });
  it("waiting for network wins and is a warning", () => {
    expect(downloadStatusView({ ...base, status: "Pending", waiting_for_network: true }, NOW)).toMatchObject({ tone: "warning", label: "Waiting for network" });
  });
  it("paused is idle and shows progress", () => {
    expect(downloadStatusView({ ...base, status: "Paused" }, NOW)).toMatchObject({ tone: "idle", label: "Paused · 40%" });
  });
  it("failed is danger and prefers the engine's error text", () => {
    expect(downloadStatusView({ ...base, status: { Failed: "boom" }, error: "Link expired" }, NOW)).toMatchObject({ tone: "danger", label: "Link expired" });
    expect(downloadStatusView({ ...base, status: { Failed: "boom" } }, NOW)).toMatchObject({ tone: "danger", label: "boom" });
  });
  it("downloading shows the progress bar, not a sub-line", () => {
    expect(downloadStatusView(base, NOW)).toMatchObject({ tone: "info", showProgress: true });
  });
});

describe("postProcessingSteps", () => {
  it("lists the steps that apply, in engine order", () => {
    expect(postProcessingSteps({ auto_extract_archives: true, auto_organize: true, plex_url: "http://p" })).toEqual(["Extract", "Organize", "Media scan"]);
    expect(postProcessingSteps({ auto_organize: true })).toEqual(["Organize"]);
    expect(postProcessingSteps(null)).toEqual([]);
  });
});
