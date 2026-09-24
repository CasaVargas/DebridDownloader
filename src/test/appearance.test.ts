import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppearance, readPrefs, resolveTheme, useAppearance } from "../hooks/useAppearance";

let systemDark = true;
const listeners = new Set<(e: { matches: boolean }) => void>();
beforeEach(() => {
  localStorage.clear();
  listeners.clear();
  systemDark = true;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("dark") ? systemDark : false,
    media: q,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("readPrefs", () => {
  it("defaults to system + emerald", () => expect(readPrefs(null)).toEqual({ theme: "system", accent: "emerald" }));
  it("keeps an explicit saved choice", () =>
    expect(readPrefs(JSON.stringify({ app_theme: "light", accent_color: "rose" }))).toEqual({ theme: "light", accent: "rose" }));
  it("survives garbage", () => expect(readPrefs("{not json")).toEqual({ theme: "system", accent: "emerald" }));
  it("rejects unknown values", () =>
    expect(readPrefs(JSON.stringify({ app_theme: "sepia", accent_color: "puce" }))).toEqual({ theme: "system", accent: "emerald" }));
});

describe("resolveTheme", () => {
  it("system follows the OS", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("explicit wins", () => expect(resolveTheme("light", true)).toBe("light"));
});

describe("applyAppearance", () => {
  it("sets data-theme and accent variables", () => {
    applyAppearance("light", "blue", document.documentElement);
    const s = document.documentElement.style;
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(s.getPropertyValue("--accent")).toBe("#2563eb");
    expect(s.getPropertyValue("--accent-fg")).toBe("#ffffff");
  });
});

describe("useAppearance", () => {
  it("follows OS changes live when theme is system", () => {
    const { result } = renderHook(() => useAppearance());
    expect(result.current.resolvedTheme).toBe("dark");
    act(() => {
      systemDark = false;
      listeners.forEach((cb) => cb({ matches: false }));
    });
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists choices into frontend-settings without dropping other keys", () => {
    localStorage.setItem("frontend-settings", JSON.stringify({ notify_on_complete: false }));
    const { result } = renderHook(() => useAppearance());
    act(() => result.current.setTheme("dark"));
    act(() => result.current.setAccent("amber"));
    expect(JSON.parse(localStorage.getItem("frontend-settings")!)).toEqual({
      notify_on_complete: false, app_theme: "dark", accent_color: "amber",
    });
  });
});
