import { useEffect, useState } from "react";

const ACCENT_COLORS: Record<string, { primary: string; hover: string; bg: string }> = {
  emerald: { primary: "#10b981", hover: "#34d399", bg: "rgba(16,185,129," },
  blue:    { primary: "#3b82f6", hover: "#60a5fa", bg: "rgba(59,130,246," },
  violet:  { primary: "#8b5cf6", hover: "#a78bfa", bg: "rgba(139,92,246," },
  rose:    { primary: "#f43f5e", hover: "#fb7185", bg: "rgba(244,63,94," },
  amber:   { primary: "#f59e0b", hover: "#fbbf24", bg: "rgba(245,158,11," },
  cyan:    { primary: "#06b6d4", hover: "#22d3ee", bg: "rgba(6,182,212," },
};

const THEMES = {
  dark: {
    "--theme-bg": "#08080f",
    "--theme-bg-content": "#0a0a12",
    "--theme-bg-sidebar": "#07070d",
    "--theme-bg-surface": "#0f0f18",
    "--theme-bg-input": "#08080f",
    "--theme-border": "rgba(255,255,255,0.06)",
    "--theme-border-subtle": "rgba(255,255,255,0.04)",
    "--theme-border-hover": "rgba(255,255,255,0.1)",
    "--theme-hover": "rgba(255,255,255,0.03)",
    "--theme-selected": "rgba(255,255,255,0.04)",
    "--theme-text-primary": "#f1f5f9",
    "--theme-text-secondary": "#94a3b8",
    "--theme-text-muted": "#475569",
    "--theme-text-ghost": "#374151",
    "--theme-text-faint": "#1e293b",
    "--theme-shadow": "rgba(0,0,0,0.5)",
    "--theme-scrim": "rgba(0,0,0,0.4)",
    "--theme-scrollbar": "#1e293b",
    "--theme-scrollbar-hover": "#334155",
  },
  light: {
    "--theme-bg": "#f8fafc",
    "--theme-bg-content": "#ffffff",
    "--theme-bg-sidebar": "#f1f5f9",
    "--theme-bg-surface": "#f1f5f9",
    "--theme-bg-input": "#ffffff",
    "--theme-border": "rgba(0,0,0,0.08)",
    "--theme-border-subtle": "rgba(0,0,0,0.04)",
    "--theme-border-hover": "rgba(0,0,0,0.15)",
    "--theme-hover": "rgba(0,0,0,0.03)",
    "--theme-selected": "rgba(0,0,0,0.05)",
    "--theme-text-primary": "#0f172a",
    "--theme-text-secondary": "#475569",
    "--theme-text-muted": "#64748b",
    "--theme-text-ghost": "#94a3b8",
    "--theme-text-faint": "#cbd5e1",
    "--theme-shadow": "rgba(0,0,0,0.1)",
    "--theme-scrim": "rgba(0,0,0,0.2)",
    "--theme-scrollbar": "#cbd5e1",
    "--theme-scrollbar-hover": "#94a3b8",
  },
} as const;

function getStoredSettings(): { accent: string; theme: string } {
  try {
    const raw = localStorage.getItem("frontend-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        accent: parsed.accent_color && ACCENT_COLORS[parsed.accent_color] ? parsed.accent_color : "emerald",
        theme: parsed.app_theme === "light" ? "light" : "dark",
      };
    }
  } catch { /* ignore */ }
  return { accent: "emerald", theme: "dark" };
}

function applyAccent(name: string) {
  const colors = ACCENT_COLORS[name] ?? ACCENT_COLORS.emerald;
  const root = document.documentElement;
  root.style.setProperty("--accent", colors.primary);
  root.style.setProperty("--accent-hover", colors.hover);
  root.style.setProperty("--accent-bg", colors.bg);
}

function applyTheme(mode: string) {
  const vars = mode === "light" ? THEMES.light : THEMES.dark;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export function useAccentColor() {
  const [settings, setSettings] = useState(getStoredSettings);

  useEffect(() => {
    applyAccent(settings.accent);
    applyTheme(settings.theme);
  }, [settings]);

  useEffect(() => {
    const handler = () => {
      const next = getStoredSettings();
      setSettings(next);
      applyAccent(next.accent);
      applyTheme(next.theme);
    };
    window.addEventListener("accent-changed", handler);
    window.addEventListener("theme-changed", handler);
    return () => {
      window.removeEventListener("accent-changed", handler);
      window.removeEventListener("theme-changed", handler);
    };
  }, []);

  return settings.accent;
}

export { ACCENT_COLORS };
