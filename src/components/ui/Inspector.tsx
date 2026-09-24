import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./IconButton";

const MIN = 220, DEFAULT = 280, MAX = 420;

function readWidth(id: string): number {
  const n = Number(localStorage.getItem(`inspector-width:${id}`));
  return Number.isFinite(n) && n >= MIN && n <= MAX ? n : DEFAULT;
}

export function Inspector({ id, open, onClose, title, subtitle, footer, children }: {
  id: string; open: boolean; onClose(): void; title: string; subtitle?: string; footer?: ReactNode; children: ReactNode;
}) {
  const [width, setWidth] = useState(() => readWidth(id));
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setWidth(Math.min(MAX, Math.max(MIN, drag.current.w + (drag.current.x - e.clientX))));
    };
    const up = () => {
      if (drag.current) localStorage.setItem(`inspector-width:${id}`, String(width));
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [id, width]);

  if (!open) return null;
  return (
    <aside className="relative flex shrink-0 flex-col border-l border-border bg-surface" style={{ width }} aria-label={title}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        className="absolute inset-y-0 -left-0.5 w-1 cursor-col-resize hover:bg-accent/40"
        onPointerDown={(e) => { drag.current = { x: e.clientX, w: width }; }}
      />
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-md font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-fg-muted tabular">{subtitle}</p>}
        </div>
        <IconButton label="Close inspector" size="sm" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      {footer && <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">{footer}</div>}
    </aside>
  );
}
