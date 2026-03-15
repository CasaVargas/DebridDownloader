import { useEffect, useState } from "react";

const ACCENT_COLORS: Record<string, { primary: string; hover: string; bg: string }> = {
  emerald: { primary: "#10b981", hover: "#34d399", bg: "rgba(16,185,129," },
  blue:    { primary: "#3b82f6", hover: "#60a5fa", bg: "rgba(59,130,246," },
  violet:  { primary: "#8b5cf6", hover: "#a78bfa", bg: "rgba(139,92,246," },
  rose:    { primary: "#f43f5e", hover: "#fb7185", bg: "rgba(244,63,94," },
  amber:   { primary: "#f59e0b", hover: "#fbbf24", bg: "rgba(245,158,11," },
  cyan:    { primary: "#06b6d4", hover: "#22d3ee", bg: "rgba(6,182,212," },
};

function getStoredAccent(): string {
  try {
    const raw = localStorage.getItem("frontend-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.accent_color && ACCENT_COLORS[parsed.accent_color]) {
        return parsed.accent_color;
      }
    }
  } catch { /* ignore */ }
  return "emerald";
}

function applyAccent(name: string) {
  const colors = ACCENT_COLORS[name] ?? ACCENT_COLORS.emerald;
  const root = document.documentElement;
  root.style.setProperty("--accent", colors.primary);
  root.style.setProperty("--accent-hover", colors.hover);
  root.style.setProperty("--accent-bg", colors.bg);
}

export function useAccentColor() {
  const [accent, setAccent] = useState(getStoredAccent);

  // Apply on mount and when accent changes
  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  // Listen for storage changes (from settings page)
  useEffect(() => {
    const handler = () => {
      const next = getStoredAccent();
      setAccent(next);
      applyAccent(next);
    };
    window.addEventListener("accent-changed", handler);
    return () => window.removeEventListener("accent-changed", handler);
  }, []);

  return accent;
}

export { ACCENT_COLORS };
