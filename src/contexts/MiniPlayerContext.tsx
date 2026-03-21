import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { getTorrentInfo } from "../api/torrents";
import { getStreamUrl, cleanupStreamSession } from "../api/streaming";

const INLINE_PLAYABLE_EXTS = [".mp4", ".webm", ".mov", ".m4v"];
const ALL_VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".wmv", ".flv", ".ts"];

function getFileExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

interface MiniPlayerState {
  isOpen: boolean;
  streamUrl: string | null;
  sessionId: string | null;
  filename: string;
  loadingTorrentId: string | null;
  torrentId: string | null;
  fileId: number | null;
  isInlinePlayable: boolean;
  toastMessage: string | null;
}

interface MiniPlayerActions {
  openPreview: (torrentId: string, fileId?: number, filename?: string) => Promise<void>;
  closePreview: () => Promise<void>;
  retryPreview: () => Promise<void>;
  dismissToast: () => void;
}

type MiniPlayerContextValue = MiniPlayerState & MiniPlayerActions;

const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null);

const initialState: MiniPlayerState = {
  isOpen: false,
  streamUrl: null,
  sessionId: null,
  filename: "",
  loadingTorrentId: null,
  torrentId: null,
  fileId: null,
  isInlinePlayable: true,
  toastMessage: null,
};

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MiniPlayerState>(initialState);

  // Refs to avoid stale closures in async callbacks
  const sessionIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const torrentIdRef = useRef<string | null>(null);
  const fileIdRef = useRef<number | null>(null);

  // Keep refs in sync with state
  sessionIdRef.current = state.sessionId;
  torrentIdRef.current = state.torrentId;
  fileIdRef.current = state.fileId;
  loadingRef.current = state.loadingTorrentId !== null;

  const cleanupSession = useCallback(async (sid: string | null) => {
    if (sid) {
      await cleanupStreamSession(sid).catch(() => {});
    }
  }, []);

  const showToast = useCallback((message: string) => {
    setState((s) => ({ ...s, toastMessage: message }));
  }, []);

  const dismissToast = useCallback(() => {
    setState((s) => ({ ...s, toastMessage: null }));
  }, []);

  const openPreview = useCallback(
    async (torrentId: string, fileId?: number, filename?: string) => {
      // Prevent duplicate requests using ref for immediate check
      if (loadingRef.current) return;
      loadingRef.current = true;
      setState((s) => ({ ...s, loadingTorrentId: torrentId }));

      try {
        // Cleanup any existing session using ref for current value
        await cleanupSession(sessionIdRef.current);

        let targetFileId = fileId;
        let targetFilename = filename;
        let inlinePlayable = true;

        // If no fileId provided, fetch torrent info and pick the largest video file
        if (targetFileId === undefined) {
          const info = await getTorrentInfo(torrentId);
          const videoFiles = info.files.filter((f) =>
            ALL_VIDEO_EXTS.includes(getFileExt(f.path))
          );

          if (videoFiles.length === 0) {
            showToast("No video files found");
            setState((s) => ({ ...s, loadingTorrentId: null }));
            return;
          }

          const largest = videoFiles.reduce((a, b) => (b.bytes > a.bytes ? b : a));
          targetFileId = largest.id;
          targetFilename = largest.path.split("/").pop() || largest.path;
          inlinePlayable = INLINE_PLAYABLE_EXTS.includes(getFileExt(largest.path));
        } else if (targetFilename) {
          inlinePlayable = INLINE_PLAYABLE_EXTS.includes(getFileExt(targetFilename));
        }

        // Get stream URL — targetFileId is guaranteed to be a number here
        const result = await getStreamUrl(torrentId, targetFileId!);

        setState({
          isOpen: true,
          streamUrl: result.stream_url,
          sessionId: result.session_id,
          filename: targetFilename || "Video",
          loadingTorrentId: null,
          torrentId,
          fileId: targetFileId!,
          isInlinePlayable: inlinePlayable,
          toastMessage: null,
        });
      } catch (e) {
        showToast("Not available for streaming yet");
        setState((s) => ({ ...s, loadingTorrentId: null }));
      }
    },
    [cleanupSession, showToast]
  );

  const closePreview = useCallback(async () => {
    await cleanupSession(sessionIdRef.current);
    setState(initialState);
  }, [cleanupSession]);

  const retryPreview = useCallback(async () => {
    const tid = torrentIdRef.current;
    const fid = fileIdRef.current;
    if (!tid || fid === null) return;

    await cleanupSession(sessionIdRef.current);
    setState((s) => ({ ...s, loadingTorrentId: tid, streamUrl: null }));

    try {
      const result = await getStreamUrl(tid, fid);
      setState((s) => ({
        ...s,
        streamUrl: result.stream_url,
        sessionId: result.session_id,
        loadingTorrentId: null,
      }));
    } catch {
      showToast("Still not available for streaming");
      setState((s) => ({ ...s, loadingTorrentId: null }));
    }
  }, [cleanupSession, showToast]);

  const value: MiniPlayerContextValue = {
    ...state,
    openPreview,
    closePreview,
    retryPreview,
    dismissToast,
  };

  return (
    <MiniPlayerContext.Provider value={value}>
      {children}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer(): MiniPlayerContextValue {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error("useMiniPlayer must be used within MiniPlayerProvider");
  return ctx;
}
