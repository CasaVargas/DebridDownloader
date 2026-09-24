import { useCallback, useEffect, useState } from "react";
import { ACCENTS, ACCENT_NAMES, type AccentName, pickAccentFg } from "../theme/accents";

export type ThemePref = "system" | "light" | "dark";
const KEY = "frontend-settings";
const EVENT = "appearance-changed";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readPrefs(raw: string | null): { theme: ThemePref; accent: AccentName } {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== "object") parsed = {};
  const theme = ["system", "light", "dark"].includes(parsed.app_theme as string) ? (parsed.app_theme as ThemePref) : "system";
  const accent = ACCENT_NAMES.includes(parsed.accent_color as AccentName) ? (parsed.accent_color as AccentName) : "emerald";
  return { theme, accent };
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

export function applyAppearance(theme: "light" | "dark", accent: AccentName, root: HTMLElement = document.documentElement) {
  const a = ACCENTS[accent];
  const base = theme === "dark" ? a.dark : a.light;
  root.dataset.theme = theme;
  root.style.setProperty("--accent", base);
  root.style.setProperty("--accent-hover", theme === "dark" ? a.darkHover : a.lightHover);
  root.style.setProperty("--accent-fg", pickAccentFg(base));
}

/** Apply the stored appearance synchronously, before React mounts (no unthemed flash on the loading/auth screens). */
export function applyStoredAppearance() {
  const prefs = readPrefs(localStorage.getItem(KEY));
  applyAppearance(resolveTheme(prefs.theme, window.matchMedia(DARK_QUERY).matches), prefs.accent);
}

function writePrefs(patch: Record<string, string>) {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    current = {};
  }
  if (!current || typeof current !== "object") current = {};
  localStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  window.dispatchEvent(new Event(EVENT));
}

export function useAppearance() {
  const [prefs, setPrefs] = useState(() => readPrefs(localStorage.getItem(KEY)));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  const resolvedTheme = resolveTheme(prefs.theme, systemDark);

  useEffect(() => {
    applyAppearance(resolvedTheme, prefs.accent);
  }, [resolvedTheme, prefs.accent]);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onOs = (e: { matches: boolean }) => setSystemDark(e.matches);
    const onPrefs = () => setPrefs(readPrefs(localStorage.getItem(KEY)));
    mq.addEventListener("change", onOs);
    window.addEventListener(EVENT, onPrefs);
    return () => {
      mq.removeEventListener("change", onOs);
      window.removeEventListener(EVENT, onPrefs);
    };
  }, []);

  const setTheme = useCallback((t: ThemePref) => writePrefs({ app_theme: t }), []);
  const setAccent = useCallback((a: AccentName) => writePrefs({ accent_color: a }), []);

  return { theme: prefs.theme, resolvedTheme, accent: prefs.accent, setTheme, setAccent };
}
