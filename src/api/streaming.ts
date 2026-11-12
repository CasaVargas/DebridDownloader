import { call } from "./transport";
import type { StreamUrlResponse } from "../types";

export async function getStreamUrl(
  torrentId: string,
  fileId: number
): Promise<StreamUrlResponse> {
  return call("get_stream_url", { torrentId, fileId });
}

export async function cleanupStreamSession(
  sessionId: string
): Promise<void> {
  return call("cleanup_stream_session", { sessionId });
}
