import { useState, useRef, useCallback } from "react";
import { Button } from "./ui";

interface VideoPlayerProps {
  streamUrl: string;
  filename: string;
  onClose: () => void;
  onExternalPlayer: () => void;
}

export default function VideoPlayer({
  streamUrl,
  filename,
  onClose,
  onExternalPlayer,
}: VideoPlayerProps) {
  const [error, setError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleError = useCallback(() => {
    setError(true);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-bg px-4 py-6">
        <p className="text-center text-sm text-fg-secondary">Can't play this format in the browser.</p>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={onExternalPlayer}>
            Open in External Player
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-black">
      <video
        ref={videoRef}
        src={streamUrl}
        controls
        autoPlay
        onError={handleError}
        className="aspect-video w-full bg-black"
      />
      <button
        type="button"
        aria-label="Close player"
        onClick={onClose}
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-black/60 text-white/80 opacity-0 transition-opacity duration-120 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="truncate border-t border-border bg-surface px-3 py-1.5 text-sm text-fg-muted">{filename}</div>
    </div>
  );
}
