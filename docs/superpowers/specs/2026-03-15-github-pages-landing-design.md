# GitHub Pages Landing Page — Design Spec

## Overview

A single-file static landing page (`docs/index.html`) for DebridDownloader, served via GitHub Pages from the `docs/` folder on `main`. Dark gradient aesthetic matching the app's identity, CSS-only animations, JS only for platform auto-detection.

## Sections

### 1. Hero (full viewport)

- **Background**: Dark gradient (charcoal → near-black) with a subtle green radial glow behind the heading
- **Content**:
  - Inline SVG lightning bolt icon + "DebridDownloader" in large bold type
  - Tagline: "Blazing-fast desktop client for Real-Debrid"
  - Subtext: "Manage torrents and downloads with a native app built on Rust + React"
- **Smart download button**:
  - Detects visitor OS via `navigator.userAgentData.platform` (primary), falling back to `navigator.platform` / `navigator.userAgent` parsing
  - Shows platform-specific label: "Download for macOS" / "Download for Windows" / "Download for Linux"
  - **Fallback**: If detection fails or OS is unrecognized, show generic "Download on GitHub" linking to the releases page
  - Platform-appropriate inline SVG icon (Apple, Windows, Linux)
  - All download links point to `https://github.com/prjoni99/DebridDownloader/releases/latest` — the user picks the right asset from the release page
  - Small "Other platforms ↓" text link below, smooth-scrolls to `#downloads` section
- **Animation**: Soft pulsing green CSS glow behind hero text (`@keyframes` pulse on a pseudo-element). Respects `prefers-reduced-motion: reduce` by disabling the animation.

### 2. Features Grid

- **Heading**: "Features"
- **Layout**: 3-column CSS grid, responsive — collapses to 2 columns at ~768px, 1 column at ~480px
- **Cards**: Dark background with subtle border (`rgba` white), slight `translateY` + shadow on hover (CSS transition)
- **Each card**: Inline SVG icon (no icon library) + feature name (bold) + one-line description
- **Features** (6 cards — trimmed for impact):
  1. Torrent Management — Add magnets or .torrent files, select files, monitor progress
  2. Tracker Search — Add your own tracker sources, search across all in parallel
  3. Download Engine — Multi-threaded with real-time speed, ETA, and progress
  4. Keyboard First — Cmd+K search, Cmd+R refresh, full keyboard navigation
  5. Secure Storage — API tokens in OS keychain, signed & notarized on macOS
  6. Themes — Dark and light mode with 6 accent colors, system tray support

### 3. Screenshots

- **Heading**: "See It In Action"
- **Display**: Centered container with CSS-only macOS window chrome (title bar with 3 colored dots)
- **Content**: Placeholder state — dashed border box with "Screenshot coming soon" text
- **Layout**: Horizontally scrollable row for 2-3 screenshots (CSS `overflow-x: auto`, snap scrolling)
- **Future**: Drop images into `docs/`, update `<img src>` attributes

### 4. Downloads + Tech Stack + Footer

#### Downloads Table
- **Heading**: "Download"
- **Section id**: `id="downloads"` (anchor target for hero link)
- **Layout**: Styled grid with rows per platform:
  - macOS — Apple Silicon (M1/M2/M3/M4) — `.dmg`
  - macOS — Intel — `.dmg`
  - Windows — x64 — `.exe` installer
- All download buttons link to the same GitHub Releases latest page
- Auto-detected platform row gets a subtle green highlight + "Recommended for you" badge

#### Tech Stack Strip
- Horizontal bar below downloads
- Shows: Tauri, React, Rust, TypeScript, Tailwind CSS
- Muted text/icons, not prominent — credibility, not hero

#### Footer
- "Built by Jonathan Vargas" with link to `https://github.com/prjoni99`
- GitHub repo link
- "MIT License" (update if license changes)
- Single line, minimal

## HTML Head / Meta

- `<title>`: "DebridDownloader — Fast Desktop Client for Real-Debrid"
- `<meta name="description">`: "A blazing-fast native desktop client for managing torrents and downloads through Real-Debrid. Built with Tauri, React, and Rust."
- **Open Graph tags**: `og:title`, `og:description`, `og:type` (website), `og:url`, `og:image` (placeholder — can add a social card later)
- **Twitter card**: `twitter:card` (summary_large_image), `twitter:title`, `twitter:description`
- **Favicon**: Inline SVG favicon via `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">` (lightning bolt)
- `<meta name="viewport">` for responsive
- `<meta name="theme-color" content="#0a0a0a">`

## Accessibility

- All SVG icons have `aria-hidden="true"` with visible text labels alongside
- Download buttons are `<a>` elements with descriptive text (not icon-only)
- Color contrast: `#77C351` on `#0a0a0a` = 7.2:1 ratio (passes WCAG AAA)
- `prefers-reduced-motion`: disables glow pulse animation
- Keyboard navigable: all interactive elements are focusable with visible focus indicators

## Technical Constraints

- **Single file**: Everything in `docs/index.html` — inline `<style>`, inline `<script>`, inline SVGs
- **Zero dependencies**: No CDN links, no icon libraries, no fonts (use system font stack)
- **CSS-only animations**: Glow pulse, hover transitions, smooth scroll (`scroll-behavior: smooth`)
- **JS minimal**: Only for platform detection logic (~20-30 lines)
- **Responsive**: Mobile-first with breakpoints at ~480px and ~768px
- **GitHub Pages**: Served from `docs/` folder on `main` branch

## Color Palette

- Background: `#0a0a0a` → `#1a1a2e` gradient
- Card background: `#1a1a1a` or `rgba(255,255,255,0.05)`
- Card border: `rgba(255,255,255,0.1)`
- Primary accent (green): `#77C351` (RD green from the app's design system)
- Text primary: `#ffffff`
- Text secondary: `rgba(255,255,255,0.6)`
- Glow: `rgba(119, 195, 81, 0.3)` radial behind hero

## System Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
```
