import { invoke } from "@tauri-apps/api/core";
import type { StreamUrlResponse } from "../types";

export async function getStreamUrl(
  torrentId: string,
  fileId: number
): Promise<StreamUrlResponse> {
  return invoke("get_stream_url", { torrentId, fileId });
}

export async function cleanupStreamSession(
  sessionId: string
): Promise<void> {
  return invoke("cleanup_stream_session", { sessionId });
}
