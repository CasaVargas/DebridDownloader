# Native UI Polish — Design

- **Status:** Draft for review
- **Date:** 2026-09-24
- **Scope:** Sub-project 2 of the "supercharge" roadmap. Runs in parallel with sub-project 1 (resilient download engine, `specs/2026-09-23-resilient-download-engine-design.md`). README/website copy and screenshots are a separate follow-up.
- **Mockups:** `.superpowers/brainstorm/73979-1790285619/content/` (`visual-direction-v2.html`, `tokens.html`, `shell-and-settings.html`) — local, gitignored.

## 1. Goal

Make DebridDownloader look and behave like a sturdy native desktop utility instead of a generated UI: one coherent visual system, shared accessible components, a usable Settings structure, and keyboard control that works on every OS.

### Direction (decided)

- **Native desktop utility** with pro-tool density and keyboard-first control. Visual base: "quiet native" (neutral graphite/white surfaces, visible 1px borders, 30px rows, 13px base text, accent used sparingly), borrowing shortcut hints and outlined secondary buttons from "utility dense."
- **One neutral design on macOS, Windows, and Linux.** System font and OS light/dark; identical layout, controls, and spacing everywhere.
- **Appearance:** theme = System (default) / Light / Dark. The 6 existing accents stay, but the accent appears only on the primary action, selection, progress, and focus.

### Success criteria

1. Zero hardcoded color hex values or arbitrary pixel sizes in `src/pages/**` and `src/components/**` (enforced by lint).
2. One token source (`src/styles/tokens.css`); the Tailwind `@theme` `noir-*`/`emerald`/`status-*` tokens and the JS `THEMES` palette copy are gone.
3. Every text/background token pair passes WCAG AA in both themes (4.5:1 body text; 3:1 large text and non-text UI), checked by a test.
4. Theme follows the OS by default and switches live when the OS changes.
5. Every shortcut works with ⌘ on macOS and Ctrl on Windows/Linux; hints render accordingly.
6. Every interactive control is reachable by keyboard with a visible focus ring; dialogs trap focus; menus and selects support arrow keys and type-ahead.
7. Settings is split into 6 sections with URL routes; no feature is lost in the move.
8. Every screen verified by screenshot in dark and light with two accents.

### Non-goals

- New features or behavior changes (other than: System theme, keyboard shortcuts, docked inspector, Settings split, About merged into Backup).
- Engine behavior (sub-project 1).
- Platform-adaptive styling (vibrancy, Fluent, etc.).
- README / `docs/` website changes (follow-up).

## 2. Problems in the current UI

| # | Problem | Where |
|---|---|---|
| 1 | Three competing token systems that have already drifted (`--theme-text-muted` is `#475569` in one, `#64748b` in another). | `src/styles/index.css` `@theme` + `:root`, `src/hooks/useAccentColor.ts` `THEMES` |
| 2 | ~166 hardcoded hex/rgba values; status colors hardcoded per page. | `src/pages/*`, `src/components/*` |
| 3 | No type/spacing/radius scale: arbitrary `text-[15px]`, `rounded-[10px]`, `p-3.5`; four radius sizes mixed ad hoc. | everywhere |
| 4 | Generated-UI tells: near-black backgrounds with 4–6% white borders, accent-tinted fills and glows, gradients, `rounded-lg/xl` on everything. | everywhere |
| 5 | Layout edge-clipping: sidebar logo/section labels and page headers touch the window edge (likely since `14bf360` removed the wildcard padding reset). | `Sidebar.tsx`, `Layout.tsx`, `TableToolbar.tsx` |
| 6 | Every page hand-rolls buttons, inputs, badges; no shared primitives. Settings alone has 213 `className`s. | `src/pages/*` |
| 7 | Shortcuts check `metaKey` only — ⌘K/⌘R do nothing on Windows/Linux. | `src/components/Layout.tsx:75-100` |
| 8 | Sidebar provider-name map lacks Premiumize (shows raw id `premiumize`). | `src/components/Sidebar.tsx` |
| 9 | Settings is one 1,400-line scroll with 10 sections. | `src/pages/SettingsPage.tsx` |
| 10 | Detail view is an overlay slide-over with a scrim that blocks the list. | `src/components/SlideOverPanel.tsx` |

## 3. Visual language (tokens)

All values live in `src/styles/tokens.css`. Components never reference raw values.

### 3.1 Color

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#1e1e1e` | `#ffffff` | window / content background |
| `--surface` | `#252526` | `#f5f5f5` | sidebar, inspector, panels, settings groups |
| `--raised` | `#2d2d30` | `#f0f0f0` | hover, icon-button fill, kbd, count badges |
| `--border` | `#3a3a3a` | `#e0e0e0` | control borders, dividers |
| `--border-subtle` | `#2a2a2a` | `#ededed` | row separators |
| `--text` | `#e8e8e8` | `#1f1f1f` | primary text |
| `--text-secondary` | `#a8a8a8` | `#555555` | secondary text, numbers |
| `--text-muted` | `#8a8a8a` | `#6b6b6b` | meta, labels, placeholders |
| `--selected` | accent @ 16% | accent @ 12% | selected row / nav |
| `--success` | `#3fb950` | `#1a7f37` | Ready / Completed |
| `--info` | `#58a6ff` | `#0969da` | Downloading |
| `--warning` | `#d29922` | `#9a6700` | Retrying / waiting |
| `--danger` | `#f85149` | `#cf222e` | Failed / destructive |
| `--idle` | `#8a8a8a` | `#8c8c8c` | Paused / queued |
| `--accent`, `--accent-hover`, `--accent-fg`, `--accent-subtle` | per accent | per accent | set by `useAppearance` |

- Accents: emerald, blue, violet, rose, amber, cyan. Dark theme uses the existing values (`#10b981`, `#3b82f6`, `#8b5cf6`, `#f43f5e`, `#f59e0b`, `#06b6d4`); light theme uses one step darker for contrast on white (`#059669`, `#2563eb`, `#7c3aed`, `#e11d48`, `#d97706`, `#0891b2`).
- `--accent-fg` (text on a filled accent button) is a static per-accent, per-theme table choosing whichever of `#ffffff` / `#111111` has the higher contrast ratio against that accent; the contrast test (§7) asserts every entry is ≥ 4.5:1.
- Status colors are independent of the accent.
- No gradients, glows, blur, or accent-tinted borders anywhere.

### 3.2 Type

System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif`. Weights 400/500/600 only. Numbers use `font-variant-numeric: tabular-nums`.

| Token | Size / weight | Use |
|---|---|---|
| `xl` | 20 / 600 | dialog & onboarding titles |
| `lg` | 15 / 600 | toolbar title, settings pane title |
| `md` | 14 / 500 | section headings |
| `base` | 13 / 400 | body, rows, controls (root font size) |
| `sm` | 12 / 400 | meta, help text, status lines |
| `xs` | 11 / 600 uppercase +0.05em | sidebar sections, column headers, group labels |

### 3.3 Space, radius, size, elevation, motion

- Spacing: 4px grid — 4, 8, 12, 16, 24, 32 (2 and 6 for hairline adjustments only).
- Radius: `sm` 4 (badges, kbd) · `md` 6 (buttons, inputs, rows, nav items) · `lg` 8 (panels, dialogs, settings groups). Fully round only for status dots and toggles.
- Heights: control 28 (small 24) · table row 30 (38 when it has a status sub-line) · toolbar 44 · sidebar item 26.
- Elevation: panels/dialogs = 1px `--border` + `0 8px 24px` shadow (40% black dark, 8% light). Nothing else has a shadow.
- Focus: 2px `--accent` ring, 1px offset, `:focus-visible` only.
- Motion: 120ms ease-out for hover/press/panel; disabled under `prefers-reduced-motion`.

## 4. Architecture

### 4.1 Token layer

- `src/styles/tokens.css`: `:root` (non-color tokens), `[data-theme="dark"]` and `[data-theme="light"]` (palette). Tailwind v4 `@theme` maps utilities to the variables (`bg-surface`, `text-muted`, `border-subtle`, `rounded-md`, `h-control`, `text-sm`, …).
- `src/styles/index.css` imports Tailwind and `tokens.css`, keeps global resets, scrollbar, selection, keyframes. The custom checkbox/select CSS moves into the `Toggle`/`Select` primitives.
- During migration, old names (`--theme-*`, `--accent-bg-*`) are aliased to new tokens so untouched screens keep working; aliases are deleted in the final cleanup step.

### 4.2 Appearance

`src/hooks/useAccentColor.ts` → `src/hooks/useAppearance.ts`:
- `theme: "system" | "light" | "dark"`; `"system"` resolves via `matchMedia("(prefers-color-scheme: dark)")` and listens for changes.
- Sets `document.documentElement.dataset.theme` and the four accent variables.
- Persists in the existing `frontend-settings` localStorage key; missing theme → `"system"`; existing `"light"`/`"dark"` values are preserved.
- Exposes `{ theme, resolvedTheme, accent, setTheme, setAccent }`.

### 4.3 Primitives (`src/components/ui/`)

One small file each, all styled only with tokens:

- `Button` — variants `primary | secondary | ghost | danger`, sizes `md | sm`, optional `kbd` hint.
- `IconButton` — required `label` (aria-label + tooltip).
- `Input` — optional leading icon and trailing `kbd` hint.
- `Toggle` — accessible switch (`role="switch"`).
- `StatusDot` — `status: "success" | "info" | "warning" | "danger" | "idle"` + label.
- `CountBadge`, `Kbd` (renders ⌘/Ctrl per platform).
- `Toolbar` — title, subtitle, filter, actions slot; 44px.
- `Inspector` — docked, resizable right panel (min 220, default 280, max 420), open state + width persisted in localStorage.
- `SettingsGroup` / `SettingsRow` — grouped settings rows (label, description, control).
- Radix-backed (`@radix-ui/react-dialog`, `-dropdown-menu`, `-select`, `-tooltip`): `Dialog`, `Menu` (also used for row context menus), `Select`, `Tooltip`.

Lint: ESLint `no-restricted-syntax` (or a small custom rule) rejects Tailwind arbitrary values containing `#` or `px` inside `className` strings in `src/pages/**` and `src/components/**` (excluding `src/components/ui/**` where needed). Added in the final cleanup step.

### 4.4 Shell

- **Sidebar:** sections Library (Torrents, Downloads + active count, Completed) and Find (Search, Watch List + unread count), shortcut hints on hover/always-visible `kbd`. The avatar popover is replaced by a **footer**: provider name + plan, days left, Settings (`Mod ,`), sign-out in a `Menu`. Provider names come from one shared map including Premiumize.
- **Toolbar:** replaces `TableToolbar` on every list page.
- **Inspector:** replaces `SlideOverPanel` (Downloads, Torrents, Completed). Opens on row selection or `Mod I`; no scrim; list stays interactive.
- **Layout padding:** explicit window/content insets from tokens (fixes problem #5).

### 4.5 Settings

`src/pages/SettingsPage.tsx` → `src/pages/settings/`:

| Section / route | Contains (from today's sections) |
|---|---|
| General `/settings/general` | Behavior (launch at login, magnet handler, notifications) + Appearance (theme, accent) |
| Account `/settings/account` | Debrid Provider |
| Downloads `/settings/downloads` | Downloads (folder, subfolders, auto-start, concurrency, connections per file, speed limit, extraction) + Remote Downloads (rclone) |
| Library `/settings/library` | Media Library (auto-organize, TMDB) + Media Servers + Symlink Mode |
| Search `/settings/search` | Trackers + TorBox Search |
| Backup `/settings/backup` | Backup & Restore + version/update/about info (from `AboutPage`) |

- `SettingsLayout` renders a secondary nav column + the active section. `/settings` → `/settings/general`; `/about` → `/settings/backup`.
- Shared settings state/logic (`applyChange`, `markSaved`, persistence) moves to a `useSettings` hook so sections stay small.

### 4.6 Keyboard

`src/hooks/useShortcut.ts`: `useShortcut(combo, handler, { allowInInputs? })` where `combo` uses `Mod` = ⌘ on macOS, Ctrl elsewhere; single-key shortcuts are ignored while focus is in a text field.

| Keys | Action |
|---|---|
| `1` `2` `3` `4` | Torrents / Downloads / Completed / Watch List |
| `Mod K` | Search |
| `Mod N` | Add torrent |
| `Mod ,` | Settings |
| `/` | Focus filter |
| `↑` `↓` / `Enter` | Move selection / default action |
| `Mod I` | Toggle inspector |
| `Space` | Pause/resume selected download |
| `Mod R` | Refresh (existing) |
| `Delete` / `Backspace` | Remove/cancel selection (existing) |
| `Esc` | Close inspector or dialog (existing) |

Existing handlers in `Layout.tsx` move onto `useShortcut`.

## 5. Coordination with the engine sub-project

The engine plan modifies `src/pages/DownloadsPage.tsx`, `src/hooks/useDownloadTasks.tsx`, `src/types/index.ts`, `src/api/downloads.ts`, and the downloads block of `SettingsPage.tsx`.

- Polish is built on its own branch/worktree.
- All screens the engine doesn't touch are done first.
- The **Downloads page (with Inspector) and Settings → Downloads** are done last, after rebasing onto the completed engine branch, restyling the engine's pause/resume/retry controls and status lines in one pass.
- If the engine isn't finished when polish reaches that point, polish stops and waits; it does not guess at the engine's UI.
- Polish must not change engine behavior, IPC, or types beyond presentation.

## 6. Build order

Each step leaves the app working:

1. Tokens + aliases + `useAppearance` (System/Light/Dark).
2. Primitives (incl. Radix-backed).
3. Shell: Sidebar + footer, Toolbar, `useShortcut` (Ctrl fix + new shortcuts), layout padding fix, Premiumize name.
4. Torrents (+ Add Torrent dialog, row context menu, Inspector).
5. Search.
6. Watch List.
7. Completed.
8. Auth.
9. Toast, MiniPlayer, VideoPlayer.
10. Settings split (all sections except Downloads) + About → Backup.
11. *(after rebasing onto the engine branch)* Downloads + Inspector, Settings → Downloads.
12. Cleanup: remove aliases, `SlideOverPanel`, `TableToolbar`, JS `THEMES`; enable the lint rule; verify zero hex/px literals.

## 7. Verification

- **Automated (new dev dependency: Vitest):**
  - `useAppearance`: system resolution, live OS change, persistence/migration of the stored value, accent-fg selection.
  - `useShortcut`: ⌘ vs Ctrl mapping per platform; single-key shortcuts ignored in inputs.
  - Contrast test: every text/background and status/background token pair, both themes, against AA thresholds.
  - Run in CI alongside `npx tsc --noEmit`.
- **Visual (per step):** `npm run tauri dev` screenshots of each touched screen in dark and light, with emerald and one other accent. A step is not done without them.
- **Keyboard pass (per step):** every control reachable by Tab, focus ring visible, dialogs trap focus, Esc closes.
- **Final:** every screen at the minimum window size in both themes; Windows check (Ctrl shortcuts, Segoe UI rendering) via the Windows/WSL build before release.

## 8. Risks

- **Merge overlap with the engine** on `DownloadsPage.tsx` / Settings downloads: mitigated by ordering (§5).
- **Radix bundle size** (~25 KB gzipped for four packages): accepted for correct focus/keyboard/ARIA behavior.
- **Settings split regressions** (a setting lost or miswired in the move): mitigated by moving logic into `useSettings` first, then relocating JSX section by section, checking each setting persists after restart.
- **Light theme under-tested today:** covered by per-step screenshots in both themes and the contrast test.
