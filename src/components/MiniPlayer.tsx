import { useCallback, useEffect, useRef, useState } from "react";
import { useMiniPlayer } from "../contexts/MiniPlayerContext";
import { openUrl } from "@tauri-apps/plugin-opener";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 250;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const EDGE_PADDING = 16;

export default function MiniPlayer() {
  const {
    isOpen,
    streamUrl,
    filename,
    loadingTorrentId,
    isInlinePlayable,
    closePreview,
    retryPreview,
  } = useMiniPlayer();

  // Position & size — component-local state
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const [videoError, setVideoError] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const posRef = useRef(pos);
  posRef.current = pos;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null>(null);

  // Initialize position to bottom-right when first opened
  useEffect(() => {
    if (isOpen && !initialized) {
      setPos({
        x: window.innerWidth - DEFAULT_WIDTH - EDGE_PADDING,
        y: window.innerHeight - DEFAULT_HEIGHT - EDGE_PADDING,
      });
      setSize({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
      setVideoError(false);
      setInitialized(true);
    }
    if (!isOpen) {
      setInitialized(false);
    }
  }, [isOpen, initialized]);

  // Reset video error when stream URL changes
  useEffect(() => {
    setVideoError(false);
  }, [streamUrl]);

  // Clamp position on window resize
  useEffect(() => {
    const handleResize = () => {
      setPos((p) => ({
        x: Math.min(p.x, Math.max(0, window.innerWidth - size.w - EDGE_PADDING)),
        y: Math.min(p.y, Math.max(0, window.innerHeight - size.h - EDGE_PADDING)),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [size.w, size.h]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, closePreview]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - size.w, dragRef.current.origX + dx)),
      y: Math.max(0, Math.min(window.innerHeight - size.h, dragRef.current.origY + dy)),
    });
  }, [size.w, size.h]);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Resize handlers (bottom-left corner: dragging left increases width, dragging down increases height)
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: sizeRef.current.w,
      origH: sizeRef.current.h,
      origX: posRef.current.x,
      origY: posRef.current.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;

    // Bottom-left: drag left = wider (negative dx = more width), drag down = taller
    const newW = Math.max(MIN_WIDTH, resizeRef.current.origW - dx);
    const newH = Math.max(MIN_HEIGHT, resizeRef.current.origH + dy);
    const newX = resizeRef.current.origX + (resizeRef.current.origW - newW);

    setSize({ w: newW, h: newH });
    setPos((p) => ({ x: Math.max(0, newX), y: p.y }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizeRef.current = null;
  }, []);

  const handleExternalPlayer = useCallback(async () => {
    if (streamUrl) {
      await openUrl(streamUrl);
    }
  }, [streamUrl]);

  if (!isOpen) return null;

  const showFallback = !isInlinePlayable || videoError;

  return (
    <div
      ref={containerRef}
      className="fixed rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 100,
        border: "1px solid var(--theme-border)",
        background: "#000",
      }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0"
        style={{ background: "rgba(0,0,0,0.85)" }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        <span className="text-[12px] text-white/70 truncate mr-2">{filename}</span>
        <button
          onClick={(e) => { e.stopPropagation(); closePreview(); }}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 shrink-0 cursor-pointer"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 relative min-h-0">
        {loadingTorrentId ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : showFallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black gap-3 px-4">
            <p className="text-[13px] text-white/60 text-center">
              {videoError ? "Playback failed" : "Format not supported in browser"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleExternalPlayer}
                className="px-4 py-2 rounded-lg text-[12px] font-medium text-white transition-colors cursor-pointer"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
              >
                Open in External Player
              </button>
              {videoError && (
                <button
                  onClick={() => retryPreview()}
                  className="px-4 py-2 rounded-lg text-[12px] text-white/60 hover:text-white transition-colors cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.1)" }}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ) : streamUrl ? (
          <video
            src={streamUrl}
            controls
            autoPlay
            onError={() => setVideoError(true)}
            className="w-full h-full object-contain bg-black"
          />
        ) : null}
      </div>

      {/* Resize handle — bottom-left corner */}
      <div
        className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize"
        style={{ zIndex: 10 }}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 left-1 text-white/30">
          <line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" strokeWidth="1" />
          <line x1="0" y1="6" x2="6" y2="0" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
