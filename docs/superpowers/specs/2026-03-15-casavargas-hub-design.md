# casavargas.app Brand Hub — Design Spec

## Overview

A minimal single-page brand hub at `casavargas.app`, hosted via GitHub Pages from `CasaVargas/casavargas.github.io`. Dark aesthetic matching DebridDownloader's landing page. Single `index.html` with inline CSS/JS/SVGs. Zero dependencies.

## Sections

### 1. Hero

- **Background**: Dark gradient (charcoal → near-black) with subtle green radial glow (same palette as DebridDownloader landing page)
- **Content**:
  - "Casa Vargas" in large bold type (wordmark, no logo image needed)
  - Tagline: "Software by Jonathan Vargas"
- **No download button** — this is a hub, not a product page

### 2. Projects Grid

- **Layout**: Centered grid, responsive — 2 columns on desktop, 1 on mobile
- **Each project card**: Dark card with border (same card style as DebridDownloader features grid)
  - Project icon (inline SVG — lightning bolt for DebridDownloader)
  - Project name (bold)
  - One-line description
  - Tags: pill badges showing "Open Source" / "Paid", platform ("macOS", "Windows", etc.)
  - Link: entire card is clickable, goes to project's site or repo
  - Hover: subtle lift + border highlight
- **Current projects**:
  1. **DebridDownloader** — "Blazing-fast desktop client for Real-Debrid" — Open Source — macOS, Windows — links to `https://casavargas.github.io/DebridDownloader/` (or the GitHub repo)
- **Adding new projects**: Just add another card div. No JS needed, no config file.

### 3. Footer

- Link to GitHub org: `https://github.com/CasaVargas`
- Minimal, single line
- Same muted style as DebridDownloader footer

## Custom Domain Setup

- `CNAME` file in repo root containing `casavargas.app`
- DNS on registrar: either CNAME to `casavargas.github.io` or A records to GitHub Pages IPs (185.199.108-111.153)
- GitHub repo Settings > Pages > Custom domain: `casavargas.app`

## Technical Constraints

- **Single file**: `index.html` with inline `<style>`, inline SVGs
- **Zero dependencies**: No CDN, no icon libraries, no fonts (system font stack)
- **No JS needed** — purely static content, no platform detection
- **Responsive**: Mobile-first, single breakpoint at ~640px
- **GitHub Pages**: Served from root of `casavargas.github.io` repo on `main` branch

## HTML Head / Meta

- `<title>`: "Casa Vargas — Software by Jonathan Vargas"
- `<meta name="description">`: "Casa Vargas builds native desktop and mobile apps. Open source and paid software by Jonathan Vargas."
- Open Graph tags: `og:title`, `og:description`, `og:type` (website), `og:url` (https://casavargas.app/)
- Twitter card: `twitter:card` (summary), `twitter:title`, `twitter:description`
- Inline SVG favicon (stylized "CV" monogram or simple icon)
- `<meta name="theme-color" content="#0a0a0a">`

## Accessibility

- All SVG icons: `aria-hidden="true"` with visible text labels
- Cards are `<a>` elements with descriptive content
- `focus-visible` outline on all interactive elements
- Color contrast: same green (#77C351) on dark (#0a0a0a) = WCAG AAA compliant
- `prefers-reduced-motion`: no animations to disable (static page)

## Color Palette

Same as DebridDownloader landing page:
- Background: `#0a0a0a` → `#1a1a2e` gradient
- Card background: `rgba(255,255,255,0.05)`
- Card border: `rgba(255,255,255,0.1)`
- Accent green: `#77C351`
- Text primary: `#ffffff`
- Text secondary: `rgba(255,255,255,0.6)`

## System Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
```
