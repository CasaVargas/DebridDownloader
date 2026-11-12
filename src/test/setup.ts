import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library can't register its automatic cleanup.
afterEach(() => cleanup());

// jsdom has no matchMedia; components that call useAppearance need one. Tests that care about the
// OS scheme (appearance.test.ts) stub their own with vi.stubGlobal.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Components and hooks reach the backend through src/api/transport.ts, which picks Tauri IPC when
// the WebView's `__TAURI_INTERNALS__` is there. Tests mock `@tauri-apps/api/core` / `event`, so
// behave like the desktop app; transport.test.ts removes the marker to test browser mode.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
