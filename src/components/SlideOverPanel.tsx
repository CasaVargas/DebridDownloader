import { useEffect, type ReactNode } from "react";

interface SlideOverPanelProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function SlideOverPanel({
  open,
  onClose,
  children,
}: SlideOverPanelProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "var(--theme-scrim)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col overflow-hidden"
        style={{
          width: "420px",
          backgroundColor: "var(--theme-bg-surface)",
          borderLeft: "1px solid var(--theme-border)",
          boxShadow: "-8px 0 40px var(--theme-shadow)",
          animation: "slide-in-right 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </>
  );
}
