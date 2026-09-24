import { useCallback, useEffect, useRef, useState } from "react";
import { useMiniPlayer } from "../contexts/MiniPlayerContext";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, cn, IconButton, Spinner } from "./ui";

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
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // Store pre-fullscreen position/size so we can restore on exit
  const preFullscreenRef = useRef<{ pos: typeof pos; size: typeof size } | null>(null);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((fs) => {
      if (fs) {
        if (preFullscreenRef.current) {
          setPos(preFullscreenRef.current.pos);
          setSize(preFullscreenRef.current.size);
          preFullscreenRef.current = null;
        }
        return false;
      } else {
        preFullscreenRef.current = { pos: posRef.current, size: sizeRef.current };
        return true;
      }
    });
  }, []);

  // Escape key: exit fullscreen first, then close player
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFullscreen) {
          toggleFullscreen();
        } else {
          closePreview();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, isFullscreen, closePreview, toggleFullscreen]);

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
      role="region"
      aria-label={`Preview: ${filename}`}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden",
        isFullscreen ? "inset-0 bg-black" : "rounded-lg border border-border bg-surface shadow-panel",
      )}
      style={isFullscreen ? undefined : { left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Header — drag handle */}
      <div
        className={cn(
          "flex h-9 shrink-0 select-none items-center justify-between gap-2 border-b border-border bg-surface pl-3 pr-1",
          !isFullscreen && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={isFullscreen ? undefined : handleDragStart}
        onPointerMove={isFullscreen ? undefined : handleDragMove}
        onPointerUp={isFullscreen ? undefined : handleDragEnd}
      >
        <span className="truncate text-sm text-fg-secondary">{filename}</span>
        <div className="flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {isInlinePlayable && !videoError && streamUrl && (
            <IconButton size="sm" label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
              {isFullscreen ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </IconButton>
          )}
          <IconButton size="sm" label="Close preview" onClick={(e) => { e.stopPropagation(); closePreview(); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="relative min-h-0 flex-1">
        {loadingTorrentId ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Spinner />
          </div>
        ) : showFallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface px-4">
            <p className="text-center text-sm text-fg-secondary">
              {videoError ? "Playback failed" : "Format not supported in browser"}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleExternalPlayer}>
                Open in External Player
              </Button>
              {videoError && (
                <Button size="sm" onClick={() => retryPreview()}>
                  Retry
                </Button>
              )}
            </div>
          </div>
        ) : streamUrl ? (
          <video
            src={streamUrl}
            controls
            autoPlay
            onError={() => setVideoError(true)}
            className="size-full bg-black object-contain"
          />
        ) : null}
      </div>

      {/* Resize handle — bottom-left corner (hidden in fullscreen) */}
      {!isFullscreen && (
        <div
          aria-hidden
          className="absolute bottom-0 left-0 z-10 size-4 cursor-nesw-resize"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="absolute bottom-1 left-1 text-fg-muted">
            <line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" strokeWidth="1" />
            <line x1="0" y1="6" x2="6" y2="0" stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      )}
    </div>
  );
}
