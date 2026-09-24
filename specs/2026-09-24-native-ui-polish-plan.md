# Native UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle DebridDownloader into a quiet, native-feeling desktop utility built on one token system and a set of shared accessible primitives, with sectioned Settings and cross-platform keyboard shortcuts.

**Architecture:** `src/styles/tokens.css` is the single source of visual values, exposed to Tailwind v4 via `@theme inline`. `useAppearance` resolves System/Light/Dark and the accent at runtime. Screens are rebuilt from primitives in `src/components/ui/` (four behavior-heavy ones on Radix). A Vitest guard test forbids raw color/pixel literals file by file as each screen migrates.

**Tech Stack:** React 19, TypeScript, Tailwind v4, React Router 7, Radix UI (`react-dialog`, `react-dropdown-menu`, `react-context-menu`, `react-select`, `react-tooltip`), Vitest + jsdom + Testing Library (dev only).

**Spec:** `specs/2026-09-24-native-ui-polish-design.md` — read it first. Mockups (local, gitignored): `.superpowers/brainstorm/73979-1790285619/content/{visual-direction-v2,tokens,shell-and-settings}.html`.

## Global Constraints

- All color, type, spacing, radius, shadow, and motion values come from `src/styles/tokens.css`. No hex/rgb/px literals in `src/pages/**` or `src/components/**` once a file is migrated (enforced by `src/test/no-style-literals.test.ts`).
- Type: system font stack `-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif`; sizes xs 11/600 uppercase +0.05em, sm 12, base 13, md 14/500, lg 15/600, xl 20/600; weights 400/500/600 only; numbers `tabular-nums`.
- Spacing on the 4px grid (Tailwind v4 `--spacing: 4px`, so `p-2` = 8px; decimals like `h-7.5` = 30px are allowed). Radius sm 4 / md 6 / lg 8; fully round only for dots and toggles.
- Heights: control 28 (`h-7`), small 24 (`h-6`), row 30 (`h-7.5`), row with status sub-line 38 (`h-9.5`), toolbar 44 (`h-11`), sidebar item 26 (`h-6.5`).
- Accent appears only on primary actions, selection, progress, and focus. No gradients, glows, blur, or accent-tinted borders.
- Focus: 2px accent ring, 1px offset, `:focus-visible` only. Motion 120ms ease-out; none under `prefers-reduced-motion`.
- One neutral design on macOS/Windows/Linux. Shortcuts use `Mod` = ⌘ on macOS, Ctrl elsewhere.
- Presentation only: do not change engine behavior, IPC commands, or `src/types` semantics.
- **Coordination with the engine sub-project:** do NOT edit `src/pages/DownloadsPage.tsx`, `src/hooks/useDownloadTasks.tsx`, `src/api/downloads.ts`, or `src/types/index.ts` until Task 12, which starts by rebasing onto the finished engine branch.
- Every screen task ends with `npm run tauri dev` screenshots of the touched screen in dark and light, with emerald and one other accent. A task is not done without them.
- Commits: conventional style, one per task, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Deviations from the spec (deliberate, keep them)

1. The "no hardcoded values" rule is enforced by a Vitest test (`no-style-literals.test.ts`) instead of an ESLint rule; the repo has no ESLint.
2. A fifth Radix package, `@radix-ui/react-context-menu`, is added for right-click row menus (`DropdownMenu` can't anchor at the pointer).
3. `--accent-fg` is computed from the same contrast formula the test uses (a pure function in `src/theme/accents.ts`) instead of a hand-written table; the test pins every value ≥ 4.5:1.
4. Two extra primitives, `Spinner` and `EmptyState`, replace the hand-rolled loading and empty views.
5. The Settings nav item for `/settings/backup` is labeled "About & Backup" so update-checking stays discoverable.

## Review Focus

1. **The OS switches between light and dark while the app is open, with theme = System.** The app must follow immediately without a restart. Test: Task 1, `follows OS changes live when theme is system`.
2. **Upgrading users who already saved `"dark"` or `"light"`, or who have a corrupt `frontend-settings` value.** The explicit choice is kept, and a corrupt value falls back to System + emerald without crashing. Test: Task 1, `readPrefs` cases.
3. **Typing a digit, `/` or Space in a text field** (a torrent filter, a tracker URL). It must type the character, not switch pages or pause a download. Test: Task 3, `ignores single-key shortcuts while typing`.
4. **Ctrl shortcuts on Windows/Linux, and ⌘ not being hijacked there.** `Ctrl K` opens Search on Windows. On macOS, `Ctrl K` must not trigger anything. Test: Task 3, `maps Mod per platform`.
5. **An old `/settings` or `/about` link, or an unknown section like `/settings/nope`.** It lands on a real section instead of a blank page. Test: Task 11, `settings routes redirect`.

---

## File Structure

**Create**
- `src/styles/tokens.css` — palette per theme, type/space/radius/shadow/motion tokens, Tailwind `@theme inline` mapping, temporary aliases for old names.
- `src/theme/accents.ts` — accent palette + `contrastRatio`, `pickAccentFg`.
- `src/hooks/useAppearance.ts` — replaces `useAccentColor.ts`.
- `src/lib/platform.ts` — `isMac`, `formatCombo`.
- `src/hooks/useShortcut.ts` — cross-platform keyboard shortcuts.
- `src/lib/providers.ts` — provider id → display name.
- `src/components/ui/` — `cn.ts`, `Button.tsx`, `IconButton.tsx`, `Input.tsx`, `Toggle.tsx`, `StatusDot.tsx`, `CountBadge.tsx`, `Kbd.tsx`, `Spinner.tsx`, `EmptyState.tsx`, `Toolbar.tsx`, `Inspector.tsx`, `SettingsGroup.tsx`, `Dialog.tsx`, `Menu.tsx`, `ContextMenu.tsx`, `Select.tsx`, `Tooltip.tsx`, `index.ts`.
- `src/pages/settings/` — `SettingsLayout.tsx`, `useSettings.tsx`, `GeneralSettings.tsx`, `AccountSettings.tsx`, `DownloadsSettings.tsx`, `LibrarySettings.tsx`, `SearchSettings.tsx`, `BackupSettings.tsx`.
- `src/test/` — `setup.ts`, `no-style-literals.test.ts`, `contrast.test.ts`, `appearance.test.ts`, `shortcut.test.ts`, `primitives.test.tsx`, `settings-routes.test.tsx`.
- `vitest.config.ts`.

**Modify**
- `package.json` (deps + `test` script), `src/styles/index.css`, `src/App.tsx`, `src/components/Layout.tsx`, `src/components/Sidebar.tsx`, `src/components/DataTable.tsx`, `src/components/AddTorrentModal.tsx`, `src/components/Toast.tsx`, `src/components/MiniPlayer.tsx`, `src/components/VideoPlayer.tsx`, `src/pages/{Torrents,Search,WatchList,Completed,Auth}Page.tsx`, `.github/workflows/test.yml` (if the engine branch created it; otherwise create it).

**Delete (Task 13)**
- `src/hooks/useAccentColor.ts`, `src/components/SlideOverPanel.tsx`, `src/components/TableToolbar.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/AboutPage.tsx`.

---

### Task 0: Branch, test harness, and the literal guard

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/test/no-style-literals.test.ts`

**Interfaces:**
- Produces: `npm test` (Vitest, jsdom). `CLEAN_FILES` in `src/test/no-style-literals.test.ts`: every later task appends the files it migrates.

- [x] **Step 1: Create the branch**

Work in a fresh worktree off the branch that holds the specs (`claude/app-supercharging-ideas-e36ea4` or its successor on `main`). Name the branch `feat/native-ui-polish`.

- [x] **Step 2: Install dev dependencies and Radix**

```bash
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-context-menu @radix-ui/react-select @radix-ui/react-tooltip
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @types/node
```
Add to `package.json` `"scripts"`: `"test": "vitest run"`.

- [x] **Step 3: Configure Vitest**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```
`src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [x] **Step 4: Write the guard test (starts empty and passing)**

`src/test/no-style-literals.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Files that have been migrated to tokens + primitives. Each screen task appends its files.
 * Task 13 replaces this list with "every file under src/pages and src/components".
 */
export const CLEAN_FILES: string[] = [];

const RULES: { name: string; re: RegExp }[] = [
  { name: "hex color", re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb()/rgba()", re: /\brgba?\(/ },
  { name: "pixel value", re: /\b\d+(\.\d+)?px\b/ },
  { name: "old --theme-* variable", re: /--theme-/ },
  { name: "old --accent-bg-* variable", re: /--accent-bg-/ },
];

export function findLiterals(source: string): string[] {
  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (line.includes("style-literal-ok")) return; // explicit, reviewed exception
    for (const r of RULES) {
      if (r.re.test(line)) hits.push(`line ${i + 1}: ${r.name}: ${line.trim()}`);
    }
  });
  return hits;
}

describe("no raw style literals in migrated files", () => {
  it("detector catches the patterns it should", () => {
    expect(findLiterals(`className="text-[15px]"`)).toHaveLength(1);
    expect(findLiterals(`style={{ color: "#ef4444" }}`)).toHaveLength(1);
    expect(findLiterals(`bg-[rgba(239,68,68,0.08)]`)).toHaveLength(1);
    expect(findLiterals(`text-[var(--theme-text-muted)]`)).toHaveLength(1);
    expect(findLiterals(`className="h-7 px-3 text-base text-fg"`)).toHaveLength(0);
    expect(findLiterals(`<path d="M21 15v4a2" /> // style-literal-ok`)).toHaveLength(0);
  });

  for (const file of CLEAN_FILES) {
    it(file, () => {
      const hits = findLiterals(readFileSync(resolve(__dirname, "../..", file), "utf8"));
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }
});
```
SVG `d="..."` attributes don't contain `px` or `#`, so icons pass without exceptions. Use `// style-literal-ok` only for values that genuinely can't be tokens (e.g. a video element's intrinsic aspect ratio), and justify each one in the commit message.

- [x] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed (the detector test).

- [x] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test
git commit -m "test(ui): add vitest harness and raw style-literal guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Tokens, accents, and `useAppearance`

**Files:**
- Create: `src/styles/tokens.css`, `src/theme/accents.ts`, `src/hooks/useAppearance.ts`, `src/test/contrast.test.ts`, `src/test/appearance.test.ts`
- Modify: `src/styles/index.css`, `src/components/Layout.tsx:8,13` (swap `useAccentColor()` → `useAppearance()`), `src/pages/SettingsPage.tsx` (import `ACCENTS` instead of `ACCENT_COLORS`; add a System option; default `app_theme: "system"`)

**Interfaces:**
- Produces:
  - `ACCENTS: Record<AccentName, { label: string; dark: string; darkHover: string; light: string; lightHover: string }>`, `type AccentName = "emerald" | "blue" | "violet" | "rose" | "amber" | "cyan"`, `ACCENT_NAMES: AccentName[]`
  - `contrastRatio(a: string, b: string): number`, `pickAccentFg(accentHex: string): "#ffffff" | "#111111"`
  - `type ThemePref = "system" | "light" | "dark"`, `readPrefs(raw: string | null): { theme: ThemePref; accent: AccentName }`, `resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark"`, `applyAppearance(theme: "light" | "dark", accent: AccentName, root?: HTMLElement): void`
  - `useAppearance(): { theme: ThemePref; resolvedTheme: "light" | "dark"; accent: AccentName; setTheme(t: ThemePref): void; setAccent(a: AccentName): void }`
  - Tailwind utilities: colors `bg`, `surface`, `raised`, `border`, `border-subtle`, `fg`, `fg-secondary`, `fg-muted`, `selected`, `success`, `info`, `warning`, `danger`, `idle`, `accent`, `accent-hover`, `accent-fg`, `accent-subtle`; text sizes `xs sm base md lg xl`; radii `sm md lg`; `shadow-panel`; `font-sans`; `duration-120`.

- [x] **Step 1: Write the failing tests**

`src/test/contrast.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS, ACCENT_NAMES, contrastRatio, pickAccentFg } from "../theme/accents";

const css = readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8");

function palette(theme: "dark" | "light"): Record<string, string> {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

describe.each(["dark", "light"] as const)("%s theme contrast", (theme) => {
  const p = palette(theme);
  const text = ["text", "text-secondary", "text-muted"];

  it("defines the full palette", () => {
    for (const k of ["bg", "surface", "raised", "border", "border-subtle", "text", "text-secondary", "text-muted", "success", "info", "warning", "danger", "idle"]) {
      expect(p[k], k).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each(["bg", "surface"])("text tokens ≥ 4.5:1 on %s", (bg) => {
    for (const t of text) expect(contrastRatio(p[t], p[bg]), `${t} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("primary and secondary text ≥ 4.5:1 on raised", () => {
    for (const t of ["text", "text-secondary"]) expect(contrastRatio(p[t], p.raised), t).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["bg", "surface"])("status colors ≥ 3:1 on %s", (bg) => {
    for (const s of ["success", "info", "warning", "danger"]) expect(contrastRatio(p[s], p[bg]), s).toBeGreaterThanOrEqual(3);
  });

  it("every accent: fg ≥ 4.5:1 on the accent and focus ring ≥ 3:1 on bg", () => {
    for (const name of ACCENT_NAMES) {
      const a = ACCENTS[name][theme];
      expect(contrastRatio(pickAccentFg(a), a), `${name} fg`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(a, p.bg), `${name} ring`).toBeGreaterThanOrEqual(3);
    }
  });
});
```
`src/test/appearance.test.ts`:
```ts
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
```

- [x] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../theme/accents`, `../hooks/useAppearance`, `../styles/tokens.css`.

- [x] **Step 3: Write `src/theme/accents.ts`**

```ts
export type AccentName = "emerald" | "blue" | "violet" | "rose" | "amber" | "cyan";

export const ACCENTS: Record<AccentName, { label: string; dark: string; darkHover: string; light: string; lightHover: string }> = {
  emerald: { label: "Emerald", dark: "#10b981", darkHover: "#34d399", light: "#059669", lightHover: "#047857" },
  blue: { label: "Blue", dark: "#3b82f6", darkHover: "#60a5fa", light: "#2563eb", lightHover: "#1d4ed8" },
  violet: { label: "Violet", dark: "#8b5cf6", darkHover: "#a78bfa", light: "#7c3aed", lightHover: "#6d28d9" },
  rose: { label: "Rose", dark: "#f43f5e", darkHover: "#fb7185", light: "#e11d48", lightHover: "#be123c" },
  amber: { label: "Amber", dark: "#f59e0b", darkHover: "#fbbf24", light: "#d97706", lightHover: "#b45309" },
  cyan: { label: "Cyan", dark: "#06b6d4", darkHover: "#22d3ee", light: "#0891b2", lightHover: "#0e7490" },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text color for content on a filled accent surface. */
export function pickAccentFg(accentHex: string): "#ffffff" | "#111111" {
  return contrastRatio("#ffffff", accentHex) >= contrastRatio("#111111", accentHex) ? "#ffffff" : "#111111";
}
```

- [x] **Step 4: Write `src/styles/tokens.css`**

```css
/* Single source of visual values. See specs/2026-09-24-native-ui-polish-design.md §3. */

:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  --motion: 120ms;
  color-scheme: dark;
}

[data-theme="dark"] {
  --bg: #1e1e1e;
  --surface: #252526;
  --raised: #2d2d30;
  --border: #3a3a3a;
  --border-subtle: #2a2a2a;
  --text: #e8e8e8;
  --text-secondary: #a8a8a8;
  --text-muted: #919191;
  --success: #3fb950;
  --info: #58a6ff;
  --warning: #d29922;
  --danger: #f85149;
  --idle: #8a8a8a;
  --shadow-color: rgb(0 0 0 / 0.4);
  --selected-mix: 16%;
  color-scheme: dark;
}

[data-theme="light"] {
  --bg: #ffffff;
  --surface: #f5f5f5;
  --raised: #f0f0f0;
  --border: #e0e0e0;
  --border-subtle: #ededed;
  --text: #1f1f1f;
  --text-secondary: #555555;
  --text-muted: #6b6b6b;
  --success: #1a7f37;
  --info: #0969da;
  --warning: #9a6700;
  --danger: #cf222e;
  --idle: #8c8c8c;
  --shadow-color: rgb(0 0 0 / 0.08);
  --selected-mix: 12%;
  color-scheme: light;
}

:root {
  /* Accent defaults; useAppearance overwrites these at runtime. */
  --accent: #10b981;
  --accent-hover: #34d399;
  --accent-fg: #111111;
  --selected: color-mix(in srgb, var(--accent) var(--selected-mix, 16%), transparent);
  --accent-subtle: color-mix(in srgb, var(--accent) 10%, transparent);
}

@theme inline {
  --font-sans: var(--font-ui);
  --spacing: 4px;

  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-raised: var(--raised);
  --color-border: var(--border);
  --color-border-subtle: var(--border-subtle);
  --color-fg: var(--text);
  --color-fg-secondary: var(--text-secondary);
  --color-fg-muted: var(--text-muted);
  --color-selected: var(--selected);
  --color-success: var(--success);
  --color-info: var(--info);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-idle: var(--idle);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-accent-subtle: var(--accent-subtle);

  --text-xs: 11px;
  --text-xs--line-height: 16px;
  --text-sm: 12px;
  --text-sm--line-height: 16px;
  --text-base: 13px;
  --text-base--line-height: 18px;
  --text-md: 14px;
  --text-md--line-height: 20px;
  --text-lg: 15px;
  --text-lg--line-height: 20px;
  --text-xl: 20px;
  --text-xl--line-height: 26px;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  --shadow-panel: 0 8px 24px var(--shadow-color);
}

/* Temporary aliases so un-migrated screens keep working. Deleted in Task 13. */
:root, [data-theme] {
  --theme-bg: var(--bg);
  --theme-bg-content: var(--bg);
  --theme-bg-sidebar: var(--surface);
  --theme-bg-surface: var(--surface);
  --theme-bg-input: var(--surface);
  --theme-border: var(--border);
  --theme-border-subtle: var(--border-subtle);
  --theme-border-hover: var(--border);
  --theme-hover: var(--raised);
  --theme-selected: var(--raised);
  --theme-text-primary: var(--text);
  --theme-text-secondary: var(--text-secondary);
  --theme-text-muted: var(--text-muted);
  --theme-text-ghost: var(--text-muted);
  --theme-text-faint: var(--border);
  --theme-shadow: var(--shadow-color);
  --theme-scrim: rgb(0 0 0 / 0.4);
  --theme-scrollbar: var(--border);
  --theme-scrollbar-hover: var(--text-muted);
  --accent-bg-subtle: var(--accent-subtle);
  --accent-bg-light: var(--accent-subtle);
  --accent-bg-medium: var(--selected);
}
```
The contrast test parses the `[data-theme="…"] { … }` blocks, so keep one declaration per line in the form `--name: #rrggbb;`.

- [x] **Step 5: Rewrite `src/styles/index.css`**

Replace the whole file with:
```css
@import "tailwindcss";
@import "./tokens.css";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: 18px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

*, *::before, *::after { box-sizing: border-box; }

:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
:focus:not(:focus-visible) { outline: none; }

::selection { background: var(--selected); }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; border: 2px solid var(--bg); }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

.tabular { font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0ms !important; animation-duration: 0ms !important; }
}

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes scale-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
```
The old `input[type="checkbox"]` and `select` global styles are deliberately dropped; `Toggle` and `Select` replace them in the screens that use them. Until those screens are migrated in later tasks, the native controls fall back to OS styling.

- [x] **Step 6: Write `src/hooks/useAppearance.ts`**

```ts
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

function writePrefs(patch: Record<string, string>) {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    current = {};
  }
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
```
The hook listens for `appearance-changed`, which it fires itself after every write, so multiple mounted instances (Layout and Settings) stay in sync.

- [x] **Step 7: Wire it in**

1. `src/components/Layout.tsx`: replace `import { useAccentColor } from "../hooks/useAccentColor";` with `import { useAppearance } from "../hooks/useAppearance";` and `useAccentColor();` with `useAppearance();`.
2. `src/pages/SettingsPage.tsx` (temporary until Task 11):
   - Replace `import { ACCENT_COLORS } from "../hooks/useAccentColor";` with `import { ACCENTS } from "../theme/accents";` and `import { useAppearance } from "../hooks/useAppearance";`.
   - Change `DEFAULT_FRONTEND.app_theme` to `"system"`.
   - Add `{ id: "system", label: "System" }` as the first theme option.
   - Make the theme/accent buttons call `appearance.setTheme(...)` / `appearance.setAccent(...)` (with `const appearance = useAppearance();`) instead of `applyFrontend`, and read the selected state from `appearance.theme` / `appearance.accent`.
   - Replace `ACCENT_COLORS[x]?.primary` with `ACCENTS[x as AccentName]?.dark` (add `type AccentName` to the `../theme/accents` import).
3. Replace the `App.tsx` loading screen's `text-zinc-400 text-lg` with `text-fg-muted text-base` and `bg-[var(--theme-bg)]` with `bg-bg`.
4. Keep `src/hooks/useAccentColor.ts` for now (deleted in Task 13), but it's no longer imported anywhere. Verify with `grep -rn useAccentColor src`: only the file itself remains.

- [x] **Step 8: Run tests and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all pass. If a contrast assertion fails, fix the **token value** in `tokens.css` (keep the spec's intent: neutral grays, AA), update the spec table to match, and note it in the commit message.

- [x] **Step 9: Visual check**

Run `npm run tauri dev`. Screenshot the Torrents screen in Dark, Light, and System (toggle the OS appearance while the app is open) with emerald and violet. Un-migrated screens should look roughly as before through the aliases, just with neutral grays. Nothing may be unreadable.

- [x] **Step 10: Commit**

```bash
git add -A src/styles src/theme src/hooks/useAppearance.ts src/test src/components/Layout.tsx src/pages/SettingsPage.tsx src/App.tsx
git commit -m "feat(ui): add design tokens and System/Light/Dark appearance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Primitives

**Files:**
- Create: everything under `src/components/ui/`, `src/lib/platform.ts`, `src/test/primitives.test.tsx`
- Modify: `src/App.tsx` (wrap in `TooltipProvider`), `src/test/no-style-literals.test.ts` (append every `src/components/ui/*.tsx` file to `CLEAN_FILES`)

**Interfaces:**
- Produces (all exported from `src/components/ui/index.ts`):
  - `cn(...parts: (string | false | null | undefined)[]): string`
  - `Button` props: `ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "sm"; kbd?: string }`
  - `IconButton` props: `ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: "default" | "danger"; size?: "md" | "sm"; children: ReactNode }`
  - `Input` props: `InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; kbd?: string }` (forwardRef)
  - `Toggle` props: `{ checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }`
  - `StatusDot` props: `{ status: "success" | "info" | "warning" | "danger" | "idle"; children?: ReactNode }`
  - `CountBadge` props: `{ children: ReactNode }`; `Kbd` props: `{ combo: string }` (e.g. `"Mod+K"`, `"/"`)
  - `Spinner` props: `{ size?: "sm" | "md" }`; `EmptyState` props: `{ title: string; hint?: string; action?: ReactNode }`
  - `Toolbar` props: `{ title: string; subtitle?: string; filter?: { value: string; onChange(v: string): void; placeholder?: string; inputRef?: Ref<HTMLInputElement> }; actions?: ReactNode }`
  - `Inspector` props: `{ id: string; open: boolean; onClose(): void; title: string; subtitle?: string; footer?: ReactNode; children: ReactNode }`
  - `SettingsGroup` props: `{ title?: string; children: ReactNode }`; `SettingsRow` props: `{ label: string; description?: string; saved?: boolean; children?: ReactNode }`
  - `Dialog` props: `{ open: boolean; onOpenChange(o: boolean): void; title: string; description?: string; footer?: ReactNode; children: ReactNode; width?: "sm" | "md" }`
  - `Menu` props: `{ trigger: ReactNode; items: MenuItem[] }`; `ContextMenu` props: `{ items: MenuItem[]; children: ReactNode }`; `type MenuItem = { label: string; onSelect(): void; danger?: boolean; shortcut?: string; disabled?: boolean } | "separator"`
  - `Select<T extends string>` props: `{ value: T; onValueChange(v: T): void; options: { value: T; label: string }[]; ariaLabel: string; size?: "md" | "sm"; className?: string }`
  - `Tooltip` props: `{ content: string; children: ReactElement }`; `TooltipProvider`
  - `isMac: boolean`, `formatCombo(combo: string): string` from `src/lib/platform.ts`

- [x] **Step 1: Write the failing tests**

`src/test/primitives.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, Toggle, StatusDot, TooltipProvider } from "../components/ui";
import { formatCombo } from "../lib/platform";

describe("primitives", () => {
  it("Button applies variant and is a real button", () => {
    render(<Button variant="primary">Add</Button>);
    const b = screen.getByRole("button", { name: "Add" });
    expect(b).toHaveAttribute("type", "button");
    expect(b.className).toContain("bg-accent");
  });

  it("IconButton requires and exposes a label", () => {
    render(<TooltipProvider><IconButton label="Pause"><span>II</span></IconButton></TooltipProvider>);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("Toggle is an accessible switch", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Launch at login" />);
    const sw = screen.getByRole("switch", { name: "Launch at login" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("StatusDot renders its label", () => {
    render(<StatusDot status="danger">Failed</StatusDot>);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("formatCombo renders per platform", () => {
    expect(formatCombo("Mod+K", true)).toBe("⌘K");
    expect(formatCombo("Mod+K", false)).toBe("Ctrl K");
    expect(formatCombo("Mod+Shift+P", false)).toBe("Ctrl Shift P");
    expect(formatCombo("/", false)).toBe("/");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -- primitives`
Expected: FAIL — cannot resolve `../components/ui`.

- [x] **Step 3: Write `src/lib/platform.ts`**

```ts
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Mod+K" → "⌘K" on macOS, "Ctrl K" elsewhere. */
export function formatCombo(combo: string, mac: boolean = isMac): string {
  const parts = combo.split("+").map((p) => {
    if (p === "Mod") return mac ? "⌘" : "Ctrl";
    if (p === "Shift") return mac ? "⇧" : "Shift";
    if (p === "Alt") return mac ? "⌥" : "Alt";
    return p.length === 1 ? p.toUpperCase() : p;
  });
  return mac ? parts.join("") : parts.join(" ");
}
```
(`"/"` has no `+`, so it's returned unchanged; `toUpperCase` leaves it alone.)

- [x] **Step 4: Write the primitives**

`src/components/ui/cn.ts`:
```ts
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
```

`src/components/ui/Button.tsx`:
```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { Kbd } from "./Kbd";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  kbd?: string;
};

const variants = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-border bg-raised text-fg hover:bg-selected",
  ghost: "text-fg-secondary hover:bg-raised hover:text-fg",
  danger: "border border-danger/40 bg-raised text-danger hover:bg-danger/10",
};
const sizes = { md: "h-7 px-3 text-base", sm: "h-6 px-2 text-sm" };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", kbd, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-120",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && <Kbd combo={kbd} />}
    </button>
  );
});
```

`src/components/ui/Kbd.tsx`:
```tsx
import { formatCombo } from "../../lib/platform";

export function Kbd({ combo }: { combo: string }) {
  return (
    <kbd className="inline-flex h-4.5 items-center rounded-sm border border-border bg-raised px-1 font-sans text-xs font-normal normal-case tracking-normal text-fg-secondary">
      {formatCombo(combo)}
    </kbd>
  );
}
```

`src/components/ui/Tooltip.tsx`:
```tsx
import * as T from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={500} skipDelayDuration={200}>{children}</T.Provider>
);

export function Tooltip({ content, children }: { content: string; children: ReactElement }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={6}
          className="z-50 rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg shadow-panel animate-[fade-in_120ms_ease-out]"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
```
`src/components/ui/IconButton.tsx`:
```tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "default" | "danger";
  size?: "md" | "sm";
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, variant = "default", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-120 disabled:opacity-50",
          size === "md" ? "size-7" : "size-6",
          variant === "danger" ? "text-danger hover:bg-danger/10" : "text-fg-secondary hover:bg-raised hover:text-fg",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
```

`src/components/ui/Input.tsx`:
```tsx
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Kbd } from "./Kbd";

type Props = InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; kbd?: string };

export const Input = forwardRef<HTMLInputElement, Props>(function Input({ icon, kbd, className, ...rest }, ref) {
  return (
    <label
      className={cn(
        "flex h-7 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-base text-fg",
        "focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent/35",
        className,
      )}
    >
      {icon && <span className="shrink-0 text-fg-muted">{icon}</span>}
      <input ref={ref} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted" {...rest} />
      {kbd && <Kbd combo={kbd} />}
    </label>
  );
});
```

`src/components/ui/Toggle.tsx`:
```tsx
import { cn } from "./cn";

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors duration-120 disabled:opacity-50",
        checked ? "bg-accent" : "bg-border",
      )}
    >
      <span className={cn("absolute size-3.5 rounded-full bg-white shadow-sm transition-transform duration-120", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
```
(`bg-white` is a Tailwind named color, not a raw literal, so the guard allows it; the knob is white in both themes, as in native switches.)

`src/components/ui/StatusDot.tsx`:
```tsx
import type { ReactNode } from "react";

const colors = { success: "bg-success", info: "bg-info", warning: "bg-warning", danger: "bg-danger", idle: "bg-idle" };

export function StatusDot({ status, children }: { status: keyof typeof colors; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-base">
      <span className={`size-1.75 shrink-0 rounded-full ${colors[status]}`} aria-hidden />
      {children}
    </span>
  );
}
```

`src/components/ui/CountBadge.tsx`:
```tsx
import type { ReactNode } from "react";

export function CountBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-raised px-1.5 text-xs font-semibold text-fg-secondary tabular">{children}</span>;
}
```

`src/components/ui/Spinner.tsx`:
```tsx
export function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-border border-t-accent ${size === "sm" ? "size-4" : "size-6"}`}
    />
  );
}
```

`src/components/ui/EmptyState.tsx`:
```tsx
import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-24 text-center">
      <p className="text-md font-medium text-fg-secondary">{title}</p>
      {hint && <p className="text-sm text-fg-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
```

`src/components/ui/Toolbar.tsx`:
```tsx
import type { ReactNode, Ref } from "react";
import { Input } from "./Input";

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function Toolbar({ title, subtitle, filter, actions }: {
  title: string;
  subtitle?: string;
  filter?: { value: string; onChange(v: string): void; placeholder?: string; inputRef?: Ref<HTMLInputElement> };
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      {subtitle && <span className="truncate text-sm text-fg-muted tabular">{subtitle}</span>}
      <div className="ml-auto flex items-center gap-2">
        {filter && (
          <Input
            ref={filter.inputRef}
            className="w-56"
            icon={<SearchIcon />}
            kbd="/"
            value={filter.value}
            onChange={(e) => filter.onChange(e.target.value)}
            placeholder={filter.placeholder ?? "Filter"}
            aria-label={filter.placeholder ?? "Filter"}
          />
        )}
        {actions}
      </div>
    </div>
  );
}
```

`src/components/ui/Inspector.tsx`:
```tsx
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
```
The inline `style={{ width }}` passes a number (React appends px at runtime), so there's no `px` literal in the source.

`src/components/ui/SettingsGroup.tsx`:
```tsx
import type { ReactNode } from "react";

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-border bg-surface">
      {title && <h3 className="px-3 pt-2.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>}
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, description, saved, children }: { label: string; description?: string; saved?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-base text-fg">
          {label}
          {saved && <span className="text-sm text-accent" role="status">Saved</span>}
        </div>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
```

`src/components/ui/Dialog.tsx`:
```tsx
import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Dialog({ open, onOpenChange, title, description, footer, children, width = "md" }: {
  open: boolean; onOpenChange(o: boolean): void; title: string; description?: string; footer?: ReactNode; children: ReactNode; width?: "sm" | "md";
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 animate-[fade-in_120ms_ease-out]" />
        <D.Content
          className={`fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-panel animate-[scale-in_120ms_ease-out] ${width === "sm" ? "w-96" : "w-140"}`}
        >
          <div className="px-5 pt-4">
            <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
```
(`max-h-[85vh]` is a viewport unit, not px, so the guard allows it.)

`src/components/ui/Menu.tsx` (also exports the shared `MenuItem` type and item renderer):
```tsx
import * as DM from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { formatCombo } from "../../lib/platform";

export type MenuItem = { label: string; onSelect(): void; danger?: boolean; shortcut?: string; disabled?: boolean } | "separator";

export const menuContentClass = "z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-panel animate-[fade-in_120ms_ease-out]";
export const menuItemClass =
  "flex h-7 cursor-default select-none items-center justify-between gap-6 rounded-md px-2 text-base text-fg outline-none data-[highlighted]:bg-selected data-[disabled]:opacity-50";

export function renderItemContent(item: Exclude<MenuItem, "separator">) {
  return (
    <>
      <span className={item.danger ? "text-danger" : undefined}>{item.label}</span>
      {item.shortcut && <span className="text-sm text-fg-muted">{formatCombo(item.shortcut)}</span>}
    </>
  );
}

export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className={menuContentClass}>
          {items.map((item, i) =>
            item === "separator" ? (
              <DM.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <DM.Item key={item.label} disabled={item.disabled} onSelect={item.onSelect} className={menuItemClass}>
                {renderItemContent(item)}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
```

`src/components/ui/ContextMenu.tsx`:
```tsx
import * as CM from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import { type MenuItem, menuContentClass, menuItemClass, renderItemContent } from "./Menu";

export function ContextMenu({ items, children }: { items: MenuItem[]; children: ReactNode }) {
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={menuContentClass}>
          {items.map((item, i) =>
            item === "separator" ? (
              <CM.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <CM.Item key={item.label} disabled={item.disabled} onSelect={item.onSelect} className={menuItemClass}>
                {renderItemContent(item)}
              </CM.Item>
            ),
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
```

`src/components/ui/Select.tsx`:
```tsx
import * as S from "@radix-ui/react-select";
import { cn } from "./cn";

export function Select<T extends string>({ value, onValueChange, options, ariaLabel, size = "md", className }: {
  value: T; onValueChange(v: T): void; options: { value: T; label: string }[]; ariaLabel: string; size?: "md" | "sm"; className?: string;
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-32 items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 text-fg",
          "data-[placeholder]:text-fg-muted",
          size === "md" ? "h-7 text-base" : "h-6 text-sm",
          className,
        )}
      >
        <S.Value />
        <S.Icon className="text-fg-muted">
          <svg width="10" height="10" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 1.5L6 6.5L11 1.5" /></svg>
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-lg border border-border bg-surface p-1 shadow-panel">
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="flex h-7 cursor-default select-none items-center rounded-md px-2 text-base text-fg outline-none data-[highlighted]:bg-selected data-[state=checked]:font-medium"
              >
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
```
Radix Select values are strings. For numeric settings, pass `String(n)` and convert back with `Number(v)` in `onValueChange`.

`src/components/ui/index.ts`:
```ts
export { cn } from "./cn";
export { Button } from "./Button";
export { IconButton } from "./IconButton";
export { Input } from "./Input";
export { Toggle } from "./Toggle";
export { StatusDot } from "./StatusDot";
export { CountBadge } from "./CountBadge";
export { Kbd } from "./Kbd";
export { Spinner } from "./Spinner";
export { EmptyState } from "./EmptyState";
export { Toolbar } from "./Toolbar";
export { Inspector } from "./Inspector";
export { SettingsGroup, SettingsRow } from "./SettingsGroup";
export { Dialog } from "./Dialog";
export { Menu, type MenuItem } from "./Menu";
export { ContextMenu } from "./ContextMenu";
export { Select } from "./Select";
export { Tooltip, TooltipProvider } from "./Tooltip";
```

- [x] **Step 5: Mount the tooltip provider**

In `src/App.tsx`, import `{ TooltipProvider } from "./components/ui"` and wrap the returned tree: `<TooltipProvider><MiniPlayerProvider>…</MiniPlayerProvider></TooltipProvider>`.

- [x] **Step 6: Add the primitives to the guard**

Append to `CLEAN_FILES` in `src/test/no-style-literals.test.ts`: every file in `src/components/ui/` and `src/lib/platform.ts`. Do **not** add `src/theme/accents.ts` or `src/styles/tokens.css`: they are where the raw values legitimately live.

- [x] **Step 7: Run tests and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all pass. If a Tailwind class like `size-1.75` or `w-140` doesn't generate, check it in the running app (Step 8). Tailwind v4 generates arbitrary multiples of `--spacing`, so they should.

- [x] **Step 8: Visual check**

Temporarily render one of each primitive at the top of `TorrentsPage` in dev, then screenshot it in dark and light (emerald + rose), with a Dialog, Menu, Select and Tooltip open. Compare against `tokens.html` from the mockups. **Remove the temporary render before committing.**

- [x] **Step 9: Commit**

```bash
git add -A src/components/ui src/lib src/test src/App.tsx
git commit -m "feat(ui): add token-based primitives with Radix dialog, menus, select, tooltip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shell — shortcuts, sidebar, layout, data table

**Files:**
- Create: `src/hooks/useShortcut.ts`, `src/lib/providers.ts`, `src/test/shortcut.test.ts`
- Modify: `src/components/Layout.tsx`, `src/components/Sidebar.tsx`, `src/components/DataTable.tsx`, `src/components/Toast.tsx`, `src/test/no-style-literals.test.ts`

**Interfaces:**
- Consumes: primitives (Task 2), `formatCombo`/`isMac` (Task 2).
- Produces:
  - `matchesCombo(e: KeyboardEvent, combo: string, mac?: boolean): boolean`, `isTypingTarget(t: EventTarget | null): boolean`, `useShortcut(combo: string | string[], handler: (e: KeyboardEvent) => void, opts?: { allowInInputs?: boolean; enabled?: boolean }): void`
  - `PROVIDER_NAMES: Record<string, string>`, `providerName(id: string): string`
  - Window events (unchanged names plus one new one): `refresh-list`, `deselect-item`, `delete-selected`, `action-selected`, **`toggle-selected`** (Space), **`focus-filter`** (`/`), **`toggle-inspector`** (`Mod+I`), **`select-next`** / **`select-prev`** (↓/↑)
  - `DataTable` gains `onKeyboardSelect?: (item: T) => void` handling `select-next`/`select-prev`

- [x] **Step 1: Write the failing tests**

`src/test/shortcut.test.ts`:
```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isTypingTarget, matchesCombo, useShortcut } from "../hooks/useShortcut";

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent("keydown", { key: k, ...mods });

describe("matchesCombo", () => {
  it("maps Mod per platform", () => {
    expect(matchesCombo(key("k", { metaKey: true }), "Mod+K", true)).toBe(true);
    expect(matchesCombo(key("k", { ctrlKey: true }), "Mod+K", true)).toBe(false);
    expect(matchesCombo(key("k", { ctrlKey: true }), "Mod+K", false)).toBe(true);
    expect(matchesCombo(key("k", { metaKey: true }), "Mod+K", false)).toBe(false);
  });
  it("requires exact modifiers", () => {
    expect(matchesCombo(key("k", { metaKey: true, shiftKey: true }), "Mod+K", true)).toBe(false);
    expect(matchesCombo(key("1"), "1", true)).toBe(true);
    expect(matchesCombo(key("1", { metaKey: true }), "1", true)).toBe(false);
  });
  it("matches named keys", () => {
    expect(matchesCombo(key(" "), "Space", true)).toBe(true);
    expect(matchesCombo(key("ArrowDown"), "ArrowDown", true)).toBe(true);
    expect(matchesCombo(key(","), "Mod+,", false)).toBe(false);
    expect(matchesCombo(key(",", { ctrlKey: true }), "Mod+,", false)).toBe(true);
  });
});

describe("useShortcut", () => {
  it("ignores single-key shortcuts while typing", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut("1", handler));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("modifier shortcuts still work while typing", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut(["Mod+K"], handler, { mac: true }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("Space/Enter on a focused button activate the button, not the shortcut", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut(["Space", "Enter"], handler));
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    btn.remove();
  });

  it("arrow keys inside an open menu or listbox are left to the widget", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut("ArrowDown", handler));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    menu.appendChild(item);
    document.body.appendChild(menu);
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    menu.remove();
  });

  it("isTypingTarget", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    const div = document.createElement("div");
    div.contentEditable = "true";
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -- shortcut`
Expected: FAIL — cannot resolve `../hooks/useShortcut`.

- [x] **Step 3: Write `src/hooks/useShortcut.ts`**

```ts
import { useEffect, useRef } from "react";
import { isMac } from "../lib/platform";

const NAMED: Record<string, string> = { Space: " ", Esc: "Escape" };

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable || t.contentEditable === "true";
}

const WIDGET = '[role="menu"],[role="listbox"],[role="dialog"],[role="tooltip"]';
const ACTIVATES = 'button,a,[role="switch"],[role="checkbox"],[role="tab"],[role="menuitem"],[role="option"]';

/** Single-key shortcuts yield to text fields, open widgets, and focused controls that use Space/Enter themselves. */
function yieldsToTarget(combo: string, target: EventTarget | null): boolean {
  if (isTypingTarget(target)) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest(WIDGET)) return true;
  if ((combo === "Space" || combo === "Enter") && target.closest(ACTIVATES)) return true;
  return false;
}

export function matchesCombo(e: KeyboardEvent, combo: string, mac: boolean = isMac): boolean {
  const parts = combo.split("+");
  const keyPart = parts[parts.length - 1];
  const wantMod = parts.includes("Mod");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  const modPressed = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (modPressed !== wantMod || otherMod || e.shiftKey !== wantShift || e.altKey !== wantAlt) return false;
  const expected = NAMED[keyPart] ?? keyPart;
  return e.key.length === 1 ? e.key.toLowerCase() === expected.toLowerCase() : e.key === expected;
}

export function useShortcut(
  combo: string | string[],
  handler: (e: KeyboardEvent) => void,
  opts: { allowInInputs?: boolean; enabled?: boolean; mac?: boolean } = {},
) {
  const ref = useRef(handler);
  ref.current = handler;
  const combos = Array.isArray(combo) ? combo : [combo];
  const key = combos.join("|");
  const { allowInInputs = false, enabled = true, mac = isMac } = opts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const hit = combos.find((c) => matchesCombo(e, c, mac));
      if (!hit) return;
      const hasModifier = hit.includes("Mod+") || hit.includes("Alt+");
      if (!allowInInputs && !hasModifier && yieldsToTarget(hit, e.target)) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // combos is derived from `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, allowInInputs, enabled, mac]);
}
```

- [x] **Step 4: Write `src/lib/providers.ts`**

```ts
export const PROVIDER_NAMES: Record<string, string> = {
  "real-debrid": "Real-Debrid",
  torbox: "TorBox",
  premiumize: "Premiumize",
};

export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}
```

- [x] **Step 5: Rebuild `Layout.tsx` shortcuts on `useShortcut`**

Delete the `handleKeyDown` effect and add, inside `Layout`:
```tsx
  const go = (path: string) => () => navigate(path);
  const fire = (name: string) => () => window.dispatchEvent(new Event(name));
  useShortcut("1", go("/torrents"));
  useShortcut("2", go("/downloads"));
  useShortcut("3", go("/completed"));
  useShortcut("4", go("/watchlist"));
  useShortcut("Mod+K", go("/search"));
  useShortcut("Mod+,", go("/settings"));
  useShortcut("Mod+N", fire("open-add-torrent"));
  useShortcut("Mod+R", fire("refresh-list"));
  useShortcut("Mod+I", fire("toggle-inspector"));
  useShortcut("/", fire("focus-filter"));
  useShortcut("Escape", fire("deselect-item"), { allowInInputs: true });
  useShortcut(["Delete", "Backspace"], fire("delete-selected"));
  useShortcut("Enter", fire("action-selected"));
  useShortcut("Space", fire("toggle-selected"));
  useShortcut("ArrowDown", fire("select-next"));
  useShortcut("ArrowUp", fire("select-prev"));
```
Change the layout markup to:
```tsx
      <div className="flex h-screen overflow-hidden bg-bg text-fg">
        <Sidebar … unchanged props … />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
          <Outlet />
        </main>
      </div>
```
`TorrentsPage` currently opens `AddTorrentModal` from its own button. Task 4 makes it also listen for `open-add-torrent`.

- [x] **Step 6: Rebuild `Sidebar.tsx`**

Keep the component's props and data logic (provider fetch, update check, `premiumDays`, `logout`). Replace its markup with:
- `<nav className="flex w-50 shrink-0 flex-col border-r border-border bg-surface px-2 py-2.5">` (200px)
- **Section labels:** `<div className="px-2 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">Library</div>` and "Find".
- **Items:** a `<button>` per nav item, `className={cn("flex h-6.5 w-full items-center gap-2 rounded-md px-2 text-base", active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg")}`, `aria-current={active ? "page" : undefined}`.
  - Icons go to 14px (`width="14" height="14"`).
  - Right side: `<CountBadge>` for Downloads (the count of active tasks from `useDownloadTasks()` with `status` Downloading or Pending; show only when > 0) and Watch List (`unreadWatchCount` when > 0). Otherwise `<Kbd combo="1" />` … `"4"` and `<Kbd combo="Mod+K" />` for Search.
- **Items:** Library = Torrents, Downloads, Completed. Find = Search, Watch List. The "Settings" and "About" nav items are removed (they move to the footer).
- **Footer** (`mt-auto border-t border-border px-2 pt-2`): a `Menu` whose trigger is a full-width ghost button showing `providerName(providerId)` + plan (`user?.type`), and underneath in `text-sm text-fg-muted` `"{premiumDays} days left"`. When `updateAvailable` is set, add `<StatusDot status="info">Update {updateAvailable}</StatusDot>` under it. Menu items: `{ label: "Settings", shortcut: "Mod+,", onSelect: onSettingsOpen }`, `{ label: "About & updates", onSelect: onAboutOpen }`, `"separator"`, `{ label: "Sign out", danger: true, onSelect: logout }`.
- Store the raw provider id in state (`providerId`) and render it through `providerName`. This fixes Premiumize showing as `premiumize`.
- Delete the popover state, refs and the mousedown effect; the Radix Menu handles all of that.

- [x] **Step 7: Rebuild `DataTable.tsx`**

Keep the props API and add `onKeyboardSelect?: (item: T) => void`. Changes:
- **Container:** `className="flex-1 overflow-auto"`, no inline padding.
- **Header:** `role="row"` grid, `className="sticky top-0 z-10 grid h-6.5 items-center gap-3 border-b border-border bg-bg px-4 text-xs font-semibold uppercase tracking-wider text-fg-muted select-none"`, `style={{ gridTemplateColumns }}`.
  - Sort indicator: `↑`/`↓` in `text-fg` for the active column and nothing for inactive ones. Sortable headers are `<button>`s with `aria-sort`.
- **Row:** `role="row"`, `aria-selected`, `className={cn("grid min-h-7.5 cursor-default items-center gap-3 border-b border-border-subtle px-4 py-1", selected ? "bg-selected" : "hover:bg-raised")}`.
  - Delete the `onMouseEnter`/`onMouseLeave` handlers; hover is handled by CSS.
  - Rows are 30px minimum and grow to fit a status sub-line.
- **Loading:** `<div className="flex flex-1 items-center justify-center py-24"><Spinner /></div>`.
- **Empty:** `<EmptyState title={emptyMessage} hint={emptySubtext} />`.
- **Keyboard:** listen for the `select-next`/`select-prev` window events. Move from the current `selectedId` index (or 0) and call `onKeyboardSelect?.(item)`, falling back to `onRowClick?.(item)`. Scroll the new row into view with `scrollIntoView({ block: "nearest" })`, using a ref map keyed by row id.
- `onRowContextMenu` stays for now; Task 4 moves Torrents to `ContextMenu`.

- [x] **Step 8: Rebuild `Toast.tsx`**

Keep its logic. Markup: `className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-fg shadow-panel transition-all duration-120", visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}` with `role="status"`. No inline style.

- [x] **Step 9: Guard + tests**

Append `src/components/Layout.tsx`, `src/components/Sidebar.tsx`, `src/components/DataTable.tsx`, `src/components/Toast.tsx`, `src/hooks/useShortcut.ts`, `src/lib/providers.ts` to `CLEAN_FILES`.
Run: `npm test && npx tsc --noEmit`
Expected: all pass.

- [x] **Step 10: Visual and keyboard check**

In `npm run tauri dev`, screenshot the full window on Torrents in dark and light (emerald + blue):
- The sidebar no longer touches the window edge.
- Count badges appear, and the footer shows the provider and days left.
- The footer menu opens.

Keyboard checks:
- `1`–`4` switch pages; typing `1` in the filter types a "1".
- ⌘K / ⌘, / ⌘R work, and Esc closes the footer menu.
- If you have a Windows or Linux build handy, check Ctrl K there; otherwise note it for Task 13.

Log in with Premiumize, or temporarily hard-code `providerId = "premiumize"` and then revert, to confirm the label reads "Premiumize".

- [x] **Step 11: Commit**

```bash
git add -A src/hooks/useShortcut.ts src/lib/providers.ts src/components/Layout.tsx src/components/Sidebar.tsx src/components/DataTable.tsx src/components/Toast.tsx src/test
git commit -m "feat(ui): rebuild shell with cross-platform shortcuts, sidebar footer, native table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Screen migration recipe (applies to Tasks 4–10 and 12)

Each screen task follows the same TDD loop:
1. Add the task's files to `CLEAN_FILES`.
2. Run `npm test`; it **fails** and lists every raw literal.
3. Rebuild the screen with primitives and token classes until it passes.
4. Run `npx tsc --noEmit`.
5. Take the screenshots, then commit.

Behavior, data fetching, IPC calls and state logic must not change. Only markup and styling change, plus the specific structural items each task names.

**Conversion table**

| Old pattern | New |
|---|---|
| `TableToolbar` | `Toolbar` (pass `filter={{ value, onChange, placeholder, inputRef }}`; wire `inputRef` to the page's `focus-filter` listener: `window.addEventListener("focus-filter", () => ref.current?.focus())`) |
| `SlideOverPanel` + custom header/body/footer | `Inspector` (`id` = page name; `open`/`onClose` from selection; header `title`/`subtitle`; buttons in `footer`); listen for `toggle-inspector` to open/close for the current selection |
| Hand-rolled `<button>` with inline `rgba`/hex styles | `Button` (`primary` for the one main action per screen, `secondary` otherwise, `danger` for destructive) or `IconButton` (`label` required; `variant="danger"` for cancel/delete) |
| Status pills (`bg-[rgba(...)] text-[#...] rounded-md px-2.5`) | `StatusDot` with `status`: Ready/Completed → `success`; Downloading/Extracting → `info`; Pending/Queued/Retrying/Waiting → `warning`; Paused/Cancelled → `idle`; Failed → `danger` |
| Progress bars with `#3b82f6`/rgba track | track `h-0.75 rounded-full bg-border`, fill `h-full rounded-full bg-accent` (width stays an inline `%` style) |
| Spinners `border-[rgba(16,185,129,0.3)] border-t-…` | `Spinner` |
| Empty/"no results" blocks | `EmptyState` |
| Modal overlays (`fixed inset-0` + panel) | `Dialog` |
| Custom right-click menus (positioned divs) | `ContextMenu` wrapping the row |
| `…` action menus | `Menu` with `IconButton` trigger |
| `<select>` | `Select` |
| Checkbox / custom toggle | `Toggle` (checkbox kept only for multi-select lists, e.g. file selection, styled `accent-accent size-4`) |
| `text-[15px] text-[var(--theme-text-primary)]` | `text-base text-fg` (13px base; titles use `Toolbar`/`text-lg`) |
| `text-[13px]/[14px] text-[var(--theme-text-muted)]` | `text-sm text-fg-muted` |
| `text-[12px] uppercase tracking-[…]` labels | `text-xs font-semibold uppercase tracking-wider text-fg-muted` |
| `bg-[var(--theme-hover)] rounded-[10px] p-3.5` info tiles | definition list: `grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm` with `text-fg-muted` keys (no tiles) |
| Page padding `style={{ paddingLeft: "28px", paddingRight: "80px" }}` | `px-4` on the content container; nothing on the right |
| `rounded-xl` / `rounded-2xl` / `rounded-[10px]` | `rounded-lg` for panels, `rounded-md` for controls |
| `shadow-lg`/`shadow-2xl`, gradients, `backdrop-blur` | removed (`shadow-panel` only on dialogs/menus/toasts) |
| Sizes/numbers | add `tabular` to size/speed/ETA/percent text |

**Screenshots per screen:** dark + light, emerald + one other accent, plus every state the screen has (empty, loading, populated, selected with inspector, dialog open, error).

---

### Task 4: Torrents screen and Add Torrent dialog

**Files:**
- Modify: `src/pages/TorrentsPage.tsx`, `src/components/AddTorrentModal.tsx`, `src/test/no-style-literals.test.ts`

**Interfaces:**
- Consumes: `Toolbar`, `Inspector`, `Button`, `IconButton`, `StatusDot`, `ContextMenu`, `Menu`, `Dialog`, `EmptyState`, `Spinner` (Task 2); events from Task 3; `DataTable.onKeyboardSelect`.

- [x] **Step 1:** Append `src/pages/TorrentsPage.tsx` and `src/components/AddTorrentModal.tsx` to `CLEAN_FILES`. Run `npm test`, which fails and lists about 28 literals.
- [x] **Step 2: Torrents page.** Apply the recipe, plus:
  - **Toolbar:** title "Torrents", subtitle `"{n} items · {total size}"`, filter, and the action `<Button variant="primary" kbd="Mod+N" onClick={openAdd}>Add Torrent</Button>`.
  - Listen for `open-add-torrent` → `openAdd()`.
  - **Right-click menu:** replace the `contextMenu` state, its positioned `div` (around lines 684–740) and its Escape effect with a `ContextMenu` wrapping each row. `DataTable`'s row render gets it by wrapping the first column cell's content, or add a `rowWrapper?: (item, row: ReactNode) => ReactNode` prop to `DataTable` that defaults to identity. Menu items are the existing context actions with unchanged handlers.
  - **Row actions:** the green download `IconButton` (`label="Download"`, icon only, no accent fill) plus the `…` `Menu`.
  - **Detail view:** replace the `SlideOverPanel` detail with `Inspector id="torrents"`:
    - body: file list, a definition list of size / added / status / hash
    - footer: Download (primary), Stream (secondary, when available), Delete (danger)
- [x] **Step 3: Add Torrent dialog.** Rebuild `AddTorrentModal` on `Dialog`:
  - title "Add Torrent"
  - body: magnet `Input` (autofocused) + "Choose .torrent file…" secondary button
  - footer: Cancel (ghost) + Add (primary, disabled until input)
  - Keep its props and logic.
- [x] **Step 4:** Run `npm test && npx tsc --noEmit`; everything passes.
- [x] **Step 5: Screenshots.** Empty list, populated, a row selected with the inspector open, the right-click menu, the Add dialog. Dark and light, emerald and violet. Keyboard: ↑/↓ moves the selection, Enter runs the default action, ⌘N opens Add, Esc closes it, `/` focuses the filter.
- [x] **Step 6: Commit** `feat(ui): restyle Torrents and Add Torrent dialog` (with the trailer).

---

### Task 5: Search screen

**Files:** Modify `src/pages/SearchPage.tsx`, `src/test/no-style-literals.test.ts`

- [x] **Step 1:** Append `src/pages/SearchPage.tsx` to `CLEAN_FILES`. Run `npm test`; it fails.
- [x] **Step 2:** Apply the recipe.
  - The search box is a large `Input` (`className="h-9 text-md"`) at the top with `kbd="Mod+K"`.
  - Results use the same row styling as `DataTable`: seeders, size and source columns, `tabular`.
  - Cached-on-provider results show `<StatusDot status="success">Cached</StatusDot>`.
  - "Add" per row is a secondary `Button size="sm"`.
  - The loading state uses `Spinner`; no results and "no trackers configured" use `EmptyState`. The "no trackers" state gets an action `<Button onClick={() => navigate("/settings/search")}>Add a tracker</Button>`.
  - Keep the existing Tab/↑/↓/Enter handling in this page (lines ~151–175), and restyle the highlighted result to `bg-selected`.
- [x] **Step 3:** Run `npm test && npx tsc --noEmit`; everything passes.
- [x] **Step 4: Screenshots.** Empty, loading, results with a highlighted row, no trackers. Both themes, two accents.
- [x] **Step 5: Commit** `feat(ui): restyle Search`.

---

### Task 6: Watch List screen

**Files:** Modify `src/pages/WatchListPage.tsx`, `src/test/no-style-literals.test.ts`

- [x] **Step 1:** Append the file to `CLEAN_FILES`. Run `npm test`; it fails.
- [x] **Step 2:** Apply the recipe.
  - Rules list: each rule is a `SettingsGroup`-style card showing name, query, trackers, interval, an enabled `Toggle` and a `…` `Menu` (Edit / Run now / Delete).
  - Matches list uses `DataTable` rows with `StatusDot`.
  - The add/edit rule form is a `Dialog` with `Input`s and `Select`s (it replaces the page's two `<select>`s).
  - Toolbar primary action: "New Rule".
- [x] **Step 3:** Run `npm test && npx tsc --noEmit`; everything passes.
- [x] **Step 4: Screenshots.** No rules, rules with matches, the edit dialog. Both themes, two accents.
- [x] **Step 5: Commit** `feat(ui): restyle Watch List`.

---

### Task 7: Completed screen

**Files:** Modify `src/pages/CompletedPage.tsx`, `src/test/no-style-literals.test.ts`

- [x] **Step 1:** Append the file to `CLEAN_FILES`. Run `npm test`; it fails.
- [x] **Step 2:** Apply the recipe.
  - Toolbar: "Completed", subtitle with count/total.
  - Rows: name, size, destination (`text-sm text-fg-muted truncate`), with `IconButton`s for Show in Folder / Play (when streamable) / Remove (`danger`).
  - Selecting a row opens `Inspector id="completed"` showing destination, size and completion time, with a footer of Show in Folder / Remove.
- [x] **Step 3:** Run `npm test && npx tsc --noEmit`; everything passes.
- [x] **Step 4: Screenshots.** Empty, populated, with the inspector. Both themes, two accents.
- [x] **Step 5: Commit** `feat(ui): restyle Completed`.

---

### Task 8: Auth screen

**Files:** Modify `src/pages/AuthPage.tsx`, `src/test/no-style-literals.test.ts`

- [x] **Step 1:** Append the file to `CLEAN_FILES`. Run `npm test`; it fails and lists about 13 literals.
- [x] **Step 2:** Apply the recipe. The auth screen is a centered card `w-96 rounded-lg border border-border bg-surface p-6 shadow-panel` on `bg-bg`:
  - app name at `text-xl font-semibold`
  - provider `Select` (Real-Debrid / TorBox / Premiumize via `providerName`)
  - either "Sign in with Real-Debrid" (primary, OAuth) or an API token `Input` + Sign in (primary)
  - a help link in `text-sm text-accent`
  - errors in `text-sm text-danger`
  
  Remove gradients and any glow. `useAppearance()` must also run on this screen: call it at the top of `AuthPage` so theme and accent apply before login.
- [x] **Step 3:** Run `npm test && npx tsc --noEmit`; everything passes.
- [x] **Step 4: Screenshots.** Each provider's form, the OAuth waiting state, the error state. Both themes.
- [x] **Step 5: Commit** `feat(ui): restyle sign-in`.

---

### Task 9: Mini player and video player

**Files:** Modify `src/components/MiniPlayer.tsx`, `src/components/VideoPlayer.tsx`, `src/test/no-style-literals.test.ts`

- [x] **Step 1:** Append both files to `CLEAN_FILES`. Run `npm test`; it fails.
- [x] **Step 2:** Apply the recipe.
  - The mini player is a floating panel `rounded-lg border border-border bg-surface shadow-panel` with `IconButton` controls (Expand, Close).
  - Fullscreen keeps a black backdrop (`bg-black`; a Tailwind named color is allowed).
  - Video element sizing that needs an intrinsic aspect ratio may use `aspect-video`. If a pixel value is truly unavoidable, mark it `// style-literal-ok` with a reason.
  - Keep the Escape logic.
- [x] **Step 3:** Run `npm test && npx tsc --noEmit`; everything passes.
- [x] **Step 4: Screenshots.** Mini player over Torrents, fullscreen. Both themes.
- [x] **Step 5: Commit** `feat(ui): restyle media players`.

---

### Task 10: Settings shell and `useSettings`

**Files:**
- Create: `src/pages/settings/useSettings.tsx`, `src/pages/settings/SettingsLayout.tsx`
- Modify: `src/App.tsx` (routes), `src/test/no-style-literals.test.ts`
- Test: `src/test/settings-routes.test.tsx`

**Interfaces:**
- Produces:
  - `useSettings(): { settings: AppSettings | null; loading: boolean; applyChange(patch: Partial<AppSettings>): Promise<void>; frontend: FrontendSettings; applyFrontend(patch: Partial<FrontendSettings>): void; savedField: string | null; markSaved(field: string): void }`, a context provided by `SettingsLayout` so every section shares one loaded copy (`SettingsProvider` + `useSettings`)
  - `type FrontendSettings` (moved verbatim from `SettingsPage.tsx`, with `app_theme` default `"system"`)
  - `SETTINGS_SECTIONS: { id: "general" | "account" | "downloads" | "library" | "search" | "backup"; label: string }[]`
  - Routes: `/settings` → `/settings/general`; `/settings/:section`; unknown section → `/settings/general`; `/about` → `/settings/backup`

- [ ] **Step 1: Write the failing test**

`src/test/settings-routes.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Sections call Tauri APIs on mount; in jsdom every command resolves to an empty result.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

vi.mock("../api/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ max_concurrent_downloads: 3, create_torrent_subfolders: true, download_folder: null, theme: "dark", provider: "real-debrid" }),
  updateSettings: vi.fn().mockResolvedValue(undefined),
  detectRarTool: vi.fn().mockResolvedValue(null),
}));

import { settingsRoutes } from "../pages/settings/SettingsLayout";

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{settingsRoutes}</Routes>
    </MemoryRouter>,
  );
}

describe("settings routes redirect", () => {
  it.each([
    ["/settings", "General"],
    ["/settings/nope", "General"],
    ["/about", "About & Backup"],
    ["/settings/search", "Search"],
  ])("%s lands on %s", async (path, heading) => {
    at(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- settings-routes`
Expected: FAIL — cannot resolve `../pages/settings/SettingsLayout`.

- [ ] **Step 3: Write `useSettings.tsx`**

Move from `SettingsPage.tsx` into `src/pages/settings/useSettings.tsx`:
- `FrontendSettings`, `DEFAULT_FRONTEND` (with `app_theme: "system"`), `loadFrontendSettings` and `saveFrontendSettings`
- the backend-settings load (`getSettings`)
- `applyChange`, `applyFrontend` and `markSaved` (with `savedField` and the 1.5 s timer)

Wrap them in a context:
```tsx
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

function loadFrontend(): FrontendSettings {
  try {
    const raw = localStorage.getItem("frontend-settings");
    if (raw) return { ...DEFAULT_FRONTEND, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { ...DEFAULT_FRONTEND };
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
  const [frontend, setFrontend] = useState(loadFrontend);
  const [savedField, setSavedField] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<AppSettings | null>(null);
  latest.current = settings;

  useEffect(() => {
    getSettings().then(setSettings).finally(() => setLoading(false));
  }, []);

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
      const next = { ...loadFrontend(), ...frontend, ...patch };
      setFrontend(next);
      localStorage.setItem("frontend-settings", JSON.stringify(next));
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
```
Theme and accent do **not** go through `applyFrontend`; they use `useAppearance` (Task 1). `applyFrontend` re-reads storage before writing so it never overwrites the theme or accent keys that `useAppearance` wrote.

- [ ] **Step 4: Write `SettingsLayout.tsx`**

```tsx
import { NavLink, Navigate, Outlet, Route, useParams } from "react-router-dom";
import { cn, Spinner } from "../../components/ui";
import { SettingsProvider, useSettings } from "./useSettings";
import GeneralSettings from "./GeneralSettings";
import AccountSettings from "./AccountSettings";
import DownloadsSettings from "./DownloadsSettings";
import LibrarySettings from "./LibrarySettings";
import SearchSettings from "./SearchSettings";
import BackupSettings from "./BackupSettings";

export const SETTINGS_SECTIONS = [
  { id: "general", label: "General", el: <GeneralSettings /> },
  { id: "account", label: "Account", el: <AccountSettings /> },
  { id: "downloads", label: "Downloads", el: <DownloadsSettings /> },
  { id: "library", label: "Library", el: <LibrarySettings /> },
  { id: "search", label: "Search", el: <SearchSettings /> },
  { id: "backup", label: "About & Backup", el: <BackupSettings /> },
] as const;

function Section() {
  const { section } = useParams();
  const { loading } = useSettings();
  const found = SETTINGS_SECTIONS.find((s) => s.id === section);
  if (!found) return <Navigate to="/settings/general" replace />;
  if (loading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-160 px-6 py-5">
        <h1 className="mb-4 text-lg font-semibold text-fg">{found.label}</h1>
        {found.el}
      </div>
    </div>
  );
}

function SettingsLayout() {
  return (
    <SettingsProvider>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="w-44 shrink-0 border-r border-border px-2 py-3">
          {SETTINGS_SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              to={`/settings/${s.id}`}
              className={({ isActive }) =>
                cn("flex h-6.5 items-center rounded-md px-2 text-base", isActive ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg")
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </SettingsProvider>
  );
}

/** Route elements to place inside the authenticated <Route element={<Layout/>}>. */
export const settingsRoutes = (
  <>
    <Route path="/settings" element={<SettingsLayout />}>
      <Route index element={<Navigate to="/settings/general" replace />} />
      <Route path=":section" element={<Section />} />
    </Route>
    <Route path="/about" element={<Navigate to="/settings/backup" replace />} />
  </>
);
```
For this task, create the six section files as **stubs** that render nothing but a placeholder `SettingsGroup` with the text "Moving here in Task 11". Task 11 fills them in. `DownloadsSettings` is filled in Task 12.
```tsx
import { SettingsGroup, SettingsRow } from "../../components/ui";
export default function GeneralSettings() {
  return <SettingsGroup><SettingsRow label="Moving here in Task 11" /></SettingsGroup>;
}
```
Keep the old `SettingsPage` reachable at `/settings-legacy` until Task 11 finishes, so nothing is lost mid-migration.

- [ ] **Step 5: Wire routes in `App.tsx`**

Inside the authenticated `<Route element={<Layout />}>`, replace `<Route path="/settings" element={<SettingsPage />} />` and `<Route path="/about" element={<AboutPage />} />` with `{settingsRoutes}` and `<Route path="/settings-legacy" element={<SettingsPage />} />`. In `Layout.tsx`, `activeView` treats `/settings*` as `"settings"` (it already uses `startsWith`).

- [ ] **Step 6:** Append `src/pages/settings/SettingsLayout.tsx` and `src/pages/settings/useSettings.tsx` to `CLEAN_FILES`. Run `npm test && npx tsc --noEmit`; everything passes, including the 4 route cases.
- [ ] **Step 7: Screenshots.** Settings shell with each nav item active. Both themes.
- [ ] **Step 8: Commit** `feat(ui): add sectioned settings shell with shared settings context`.

---

### Task 11: Settings sections (all but Downloads)

**Files:**
- Modify: `src/pages/settings/{General,Account,Library,Search,Backup}Settings.tsx`, `src/test/no-style-literals.test.ts`, `src/App.tsx` (remove `/settings-legacy`)

**Interfaces:**
- Consumes: `useSettings` (Task 10), `useAppearance` (Task 1), `ACCENTS` (Task 1), primitives.

Move each block from `src/pages/SettingsPage.tsx` into its section file. Section → old block, by line range in the pre-migration file:

| Section file | Old blocks (heading → line range) |
|---|---|
| `GeneralSettings` | Behavior (~1104–1178) + Appearance (~1180–1278) |
| `AccountSettings` | Debrid Provider (~368–400) |
| `LibrarySettings` | Media Library (~556–635) + Symlink Mode (~729–823) + Media Servers (~825–908) |
| `SearchSettings` | Trackers (~910–1102), including TorBox Search |
| `BackupSettings` | Backup & Restore (~1280–1370) + the About content from `src/pages/AboutPage.tsx` |

Move each block's local state and handlers along with it: e.g. tracker form state and `handleAddTracker`/`handleTestTracker`/… go to `SearchSettings`; media-server state and `handleTestServer` go to `LibrarySettings`; provider state and `handleSwitchProvider` go to `AccountSettings`. Keep the logic verbatim and replace only the markup.

- [ ] **Step 1:** Append the five section files to `CLEAN_FILES`. Run `npm test`; the stubs pass, so the new content must stay clean as you move it in.
- [ ] **Step 2: General.**
  - `SettingsGroup title="Startup"`: Launch at login, Default magnet handler, Notify when download completes. Each is a `SettingsRow` + `Toggle`, with handlers and descriptions verbatim from the old `ToggleRow`s.
  - `SettingsGroup title="Appearance"`:
    - A Theme row with a segmented control: three `Button size="sm"` in a `rounded-md border border-border p-0.5` wrapper; the selected one is `variant="primary"`, the others `ghost`. Options System / Light / Dark, via `appearance.setTheme`.
    - An Accent row: six swatch buttons `size-5 rounded-full` with `style={{ background: ACCENTS[a][resolvedTheme] }}` (the hex lives in `accents.ts`, not in this file), `aria-label={ACCENTS[a].label}` and `aria-pressed`. The selected one gets `outline-2 outline-offset-2 outline-fg`.
- [ ] **Step 3: Account.**
  - One `SettingsGroup`: an Active provider `Select` over `providers` (labels via `providerName`), calling `handleSwitchProvider` with the switching state shown by `Spinner size="sm"`.
  - An account row showing username, plan and days left, with a Sign out `Button variant="danger" size="sm"`.
- [ ] **Step 4: Library.**
  - Groups: "Organize" (auto-organize toggle, Movies folder, TV folder, TMDB key) · "Media servers" (Plex / Jellyfin / Emby URL + token `Input`s, each with a Test `Button size="sm"` and a result line in `text-sm text-success`/`text-danger`) · "Symlink mode" (toggle, mount path, library folder).
  - Folder rows: the path in `text-sm text-fg-muted truncate` + a "Choose…" secondary button.
  - Debounced text inputs keep their existing debounce logic.
- [ ] **Step 5: Search.**
  - Group "Trackers": one row per tracker (name, type, URL in `text-sm text-fg-muted`, enabled `Toggle`, Edit/Delete `IconButton`s).
  - "Add tracker" is a primary button that opens a `Dialog` holding the existing add/edit form: name `Input`, URL `Input`, type `Select`, API key `Input`, Test (secondary) with the result line, and Save (primary) / Cancel (ghost).
  - Group "Built-in": TorBox Search toggle.
- [ ] **Step 6: About & Backup.**
  - Group "About": version (`getVersion`), Check for updates (secondary) with the existing update/download/relaunch flow and its progress shown as a progress bar, plus links (GitHub, Discussions, Releases) as `text-accent` links.
  - Group "Support": the sponsor link, and "More from CasaVargas" (Beltr) as a plain row with a link. No promo art beyond the existing icon image.
  - Group "Backup": Export (with the include-credentials `Toggle`) and Import buttons, logic verbatim. Replace the `document.getElementById("include-credentials")` lookup with React state.
- [ ] **Step 7: Retire the legacy page.** Check off every setting from the old page against the new sections using this checklist, and verify each one **persists across an app restart** in `npm run tauri dev`:
  - Provider
  - download folder, subfolders, auto-start, concurrency, speed limit, extraction ×2 *(Downloads, which stays on `/settings-legacy` until Task 12)*
  - auto-organize, movies, TV, TMDB
  - rclone *(Downloads, Task 12)*
  - symlink ×3
  - Plex ×2, Jellyfin ×2, Emby ×2
  - trackers add/edit/test/toggle/delete, TorBox search
  - launch at login, magnet handler, notify
  - theme, accent
  - export/import

  Keep `/settings-legacy` routed only for the Downloads block until Task 12.
- [ ] **Step 8:** Run `npm test && npx tsc --noEmit`; everything passes, including `settings-routes` now that real sections render. If a section imports a Tauri plugin that bypasses `@tauri-apps/api/core` and throws in jsdom, add a `vi.mock` for that plugin module in `settings-routes.test.tsx` (resolve to harmless defaults). Never skip the test.
- [ ] **Step 9: Screenshots.** Each section, both themes, two accents, with the tracker dialog open.
- [ ] **Step 10: Commit** `feat(ui): move settings into General, Account, Library, Search, About & Backup`.

---

### Task 12: Downloads screen and Settings → Downloads (after the engine lands)

**Files:**
- Modify: `src/pages/DownloadsPage.tsx`, `src/pages/settings/DownloadsSettings.tsx`, `src/test/no-style-literals.test.ts`, `src/App.tsx` (remove `/settings-legacy`)

**Interfaces:**
- Consumes: the engine branch's `DownloadTask` fields (`attempt`, `retry_at`, `segments_active`, `resumable`, `error`, `waiting_for_network`), its API (`pauseDownload`, `resumeDownload`, `retryDownload`, `pauseAllDownloads`, `resumeAllDownloads`, `retryFailedDownloads`) and `AppSettings.segments_per_file`, as defined in `specs/2026-09-23-resilient-download-engine-plan.md` Tasks 11–12.

- [ ] **Step 1: Rebase onto the engine.** Get the engine branch name from the human, then run `git fetch` and `git rebase <engine-branch>`. If the engine branch isn't finished (its plan file doesn't have Tasks 11–12 all checked), **stop here and report**. Don't implement against a guessed API. Resolve conflicts in `SettingsPage.tsx` in favor of the engine's additions; they're about to move anyway.
- [ ] **Step 2:** Append `src/pages/DownloadsPage.tsx` and `src/pages/settings/DownloadsSettings.tsx` to `CLEAN_FILES`. Run `npm test`; it fails.
- [ ] **Step 3: Downloads page.** Apply the recipe to the engine's version of the page, keeping all of its behavior (`statusDetail`, the pause/resume/retry handlers, bulk actions, the 1 s clock).
  - **Toolbar:** "Downloads", subtitle `"{active} active · {total speed}"`, filter, and actions Pause All / Resume All / Retry Failed / Clear Inactive (secondary, shown under the engine's existing conditions) plus Cancel All (danger).
  - **Rows:**
    - name + progress bar (accent) or the status sub-line: `StatusDot` with `warning` for "Retrying…"/"Waiting for network", `danger` for errors, `idle` for Paused
    - size, speed (`tabular`)
    - `IconButton`s: Pause / Resume / Retry / Cancel / Remove, using the engine's conditions
  - Replace the engine's temporary `IconButton` helper and inline SVG constants with the `ui` versions.
  - **Inspector** (`id="downloads"`; replaces `SlideOverPanel`):
    - subtitle `"{downloaded} of {total} · {eta} left"`
    - a per-connection bar: `segments_active` rendered as that many equal `h-1.5 rounded-sm bg-accent` bars when active
    - a definition list: Speed, Connections, Resumable (Yes/No), Saves to, Then (Extract → Organize → media scan, from the settings flags), Error (if any)
    - footer: Pause/Resume/Retry, Show in Folder, Cancel (danger)
  - Listen for `toggle-selected` (Space): pause if Downloading/Pending, resume if Paused. Listen for `toggle-inspector`.
- [ ] **Step 4: Settings → Downloads.** Move the Downloads block (plus Remote Downloads/rclone) from `SettingsPage.tsx` into `DownloadsSettings.tsx`:
  - Group 1: Download folder (path input with rclone validation and error line, "Choose…"), Create a folder per torrent, Start downloads automatically.
  - Group "Speed": Simultaneous downloads (`Select` 1/2/3/4/5/8/10), Connections per file (`Select` 1/2/4/8/16 with description "Lower this if your provider limits connections"), Speed limit (`Select`, with the existing options).
  - Group "After download": Auto-extract, Delete archives after extract (with the rar-tool hint line).
  - Group "Remote (rclone)": status line + remote chips as `Button size="sm"`.
- [ ] **Step 5: Remove the legacy page.** Delete the `/settings-legacy` route from `App.tsx`. Run through the Task 11 Step 7 checklist for the Downloads items.
- [ ] **Step 6:** Run `npm test && npx tsc --noEmit`; everything passes.
- [ ] **Step 7: Screenshots and keyboard.** Downloads with a live download (inspector open showing connections), a retrying row, a paused row, a failed row, bulk actions, Settings → Downloads. Both themes, two accents. Space pauses and resumes the selected row, ⌘I toggles the inspector, Delete cancels. If no debrid account is available, say so and list the live-download screenshots as NOT DONE.
- [ ] **Step 8: Commit** `feat(ui): restyle Downloads with docked inspector; move download settings`.

---

### Task 13: Cleanup, full guard, CI, final pass

**Files:**
- Delete: `src/hooks/useAccentColor.ts`, `src/components/SlideOverPanel.tsx`, `src/components/TableToolbar.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/AboutPage.tsx`
- Modify: `src/styles/tokens.css` (remove aliases), `src/test/no-style-literals.test.ts`, `.github/workflows/test.yml`, `AGENTS.md`

- [ ] **Step 1: Make the guard global.** Replace `CLEAN_FILES` with a directory walk:
```ts
import { readdirSync, statSync } from "node:fs";
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}
const ROOT = resolve(__dirname, "../..");
export const CLEAN_FILES = [...walk(`${ROOT}/src/pages`), ...walk(`${ROOT}/src/components`)].map((p) => p.slice(ROOT.length + 1));
```
Run `npm test`. It should fail only on the files about to be deleted.
- [ ] **Step 2: Delete the dead files.**
```bash
git rm src/hooks/useAccentColor.ts src/components/SlideOverPanel.tsx src/components/TableToolbar.tsx src/pages/SettingsPage.tsx src/pages/AboutPage.tsx
```
Remove their imports from `App.tsx`. Run `grep -rn "theme-\|accent-bg-\|SlideOverPanel\|TableToolbar\|useAccentColor" src`; the only hits should be in `tokens.css` aliases.
- [ ] **Step 3: Remove the aliases.** Delete the "Temporary aliases" block from `tokens.css`. Run `npm test && npx tsc --noEmit && npm run build`; everything passes.
- [ ] **Step 4: CI.** In `.github/workflows/test.yml` (created by the engine branch; create it with the same shape if it's missing), add a `- run: npm test` step after `npm ci`.
- [ ] **Step 5: Docs.** In `AGENTS.md`:
  - Replace "**Do not hardcode colors** — use the theme variables already defined in `src/styles/`" with: "All visual values live in `src/styles/tokens.css`; build UI from `src/components/ui/` primitives. `npm test` fails on raw hex/rgb/px literals in `src/pages` and `src/components`."
  - Add `npm test` to the Commands table.
  - Change "Settings is ~68 KB by design" to "Settings is split into `src/pages/settings/` sections."
- [ ] **Step 6: Final pass.** In `npm run tauri dev` at the minimum window size:
  - every screen in both themes
  - the full keyboard table from spec §4.6
  - Tab through every screen, checking the focus ring shows
  - OS theme flip with theme = System
  - on the Windows machine (WSL build): Ctrl shortcuts, Segoe UI rendering, `Kbd` hints reading "Ctrl K"
  
  Record each result. Any check you couldn't run is listed as NOT DONE.
- [ ] **Step 7: Commit** `chore(ui): remove legacy styling, enforce token guard everywhere`.
