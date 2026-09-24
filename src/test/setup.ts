import "@testing-library/jest-dom/vitest";

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
