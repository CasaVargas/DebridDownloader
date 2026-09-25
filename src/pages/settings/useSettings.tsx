import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getSettings, updateSettings } from "../../api/settings";
import type { AppSettings } from "../../types";

export interface FrontendSettings {
  auto_start_downloads: boolean;
  launch_at_login: boolean;
  handle_magnet_links: boolean;
  accent_color: string;
  app_theme: string;
  default_sort_key: string;
  default_sort_direction: "asc" | "desc";
  notify_on_complete: boolean;
}

const DEFAULT_FRONTEND: FrontendSettings = {
  auto_start_downloads: false,
  launch_at_login: false,
  handle_magnet_links: false,
  accent_color: "emerald",
  app_theme: "system",
  default_sort_key: "added",
  default_sort_direction: "desc",
  notify_on_complete: true,
};

export function loadFrontendSettings(): FrontendSettings {
  try {
    const raw = localStorage.getItem("frontend-settings");
    if (raw) return { ...DEFAULT_FRONTEND, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULT_FRONTEND };
}

export function saveFrontendSettings(s: FrontendSettings) {
  localStorage.setItem("frontend-settings", JSON.stringify(s));
}

type Ctx = {
  settings: AppSettings | null;
  loading: boolean;
  applyChange(patch: Partial<AppSettings>): Promise<void>;
  frontend: FrontendSettings;
  applyFrontend(patch: Partial<FrontendSettings>): void;
  savedField: string | null;
  markSaved(field: string): void;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [frontend, setFrontend] = useState(loadFrontendSettings);
  const [savedField, setSavedField] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<AppSettings | null>(null);
  latest.current = settings;

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value: Ctx = {
    settings,
    loading,
    async applyChange(patch) {
      if (!latest.current) return;
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setSettings(next);
      await updateSettings(next);
    },
    frontend,
    applyFrontend(patch) {
      // Theme and accent are owned by useAppearance: always keep the stored values so a
      // stale copy in this state never overwrites them.
      const stored = loadFrontendSettings();
      const next = { ...frontend, ...patch, app_theme: stored.app_theme, accent_color: stored.accent_color };
      setFrontend(next);
      saveFrontendSettings(next);
    },
    savedField,
    markSaved(field) {
      setSavedField(field);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSavedField(null), 1500);
    },
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
