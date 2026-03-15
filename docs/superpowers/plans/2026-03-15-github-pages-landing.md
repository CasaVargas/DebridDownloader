# GitHub Pages Landing Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single-file static landing page for DebridDownloader served via GitHub Pages.

**Architecture:** Single `docs/index.html` with inline CSS, inline JS (~25 lines for platform detection), and inline SVGs. No dependencies, no build step. GitHub Pages serves from `docs/` on `main`.

**Tech Stack:** HTML5, CSS3 (grid, animations, `@media`, `prefers-reduced-motion`), vanilla JS (platform detection)

**Spec:** `docs/superpowers/specs/2026-03-15-github-pages-landing-design.md`

---

## Chunk 1: Build the landing page

### Task 1: Create `docs/index.html` with HTML structure and meta tags

**Files:**
- Create: `docs/index.html`

- [ ] **Step 1: Create the HTML skeleton with head/meta**

Create `docs/index.html` with:
- DOCTYPE, lang="en"
- `<meta charset>`, `<meta viewport>`, `<meta theme-color content="#0a0a0a">`
- `<title>DebridDownloader — Fast Desktop Client for Real-Debrid</title>`
- `<meta name="description" content="A blazing-fast native desktop client for managing torrents and downloads through Real-Debrid. Built with Tauri, React, and Rust.">`
- Open Graph tags: `og:title`, `og:description`, `og:type` (website), `og:url` (https://prjoni99.github.io/DebridDownloader/). Omit `og:image` for now (add later when a social card image exists — an empty content attr is invalid)
- Twitter card: `twitter:card` (summary_large_image), `twitter:title`, `twitter:description`
- Inline SVG favicon (lightning bolt) via `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">`
- Empty `<style>` block
- Empty `<body>` with section landmarks: `<header id="hero">`, `<section id="features">`, `<section id="screenshots">`, `<section id="downloads">`, `<footer>`
- Empty `<script>` block at end of body

- [ ] **Step 2: Verify file renders**

Open `docs/index.html` in browser or verify structure is valid HTML5. Confirm the favicon shows.

### Task 2: Add CSS — reset, variables, layout, responsive

**Files:**
- Modify: `docs/index.html` (inline `<style>` block)

- [ ] **Step 3: Write CSS reset and custom properties**

Inside the `<style>` block, add:

```css
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background: #0a0a0a;
  color: #fff;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
:root {
  --green: #77C351;
  --green-glow: rgba(119, 195, 81, 0.3);
  --bg-dark: #0a0a0a;
  --bg-card: rgba(255,255,255,0.05);
  --border-card: rgba(255,255,255,0.1);
  --text-secondary: rgba(255,255,255,0.6);
}
a { color: var(--green); text-decoration: none; }
a:hover { text-decoration: underline; }
```

- [ ] **Step 4: Write hero section CSS**

```css
.hero {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  background: linear-gradient(180deg, #1a1a2e 0%, #0a0a0a 100%);
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, var(--green-glow) 0%, transparent 70%);
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation: pulse 4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.6; transform: translate(-50%, -50%) scale(1.1); }
}
@media (prefers-reduced-motion: reduce) {
  .hero::before { animation: none; opacity: 0.3; }
}
.hero-icon { width: 64px; height: 64px; margin-bottom: 1.5rem; position: relative; }
.hero h1 { font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 800; letter-spacing: -0.02em; position: relative; }
.hero .tagline { font-size: clamp(1.1rem, 2.5vw, 1.4rem); color: var(--text-secondary); margin-top: 0.75rem; position: relative; }
.hero .subtext { font-size: 1rem; color: var(--text-secondary); margin-top: 0.5rem; position: relative; }
.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 2rem;
  padding: 0.875rem 2rem;
  background: var(--green);
  color: #0a0a0a;
  font-weight: 700;
  font-size: 1.1rem;
  border-radius: 12px;
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
}
.download-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px var(--green-glow); text-decoration: none; }
.download-btn svg { width: 20px; height: 20px; }
.other-platforms { margin-top: 0.75rem; font-size: 0.875rem; color: var(--text-secondary); position: relative; }
```

- [ ] **Step 5: Write features grid CSS**

```css
.section { padding: 5rem 2rem; max-width: 1100px; margin: 0 auto; }
.section-title { font-size: 2rem; font-weight: 700; text-align: center; margin-bottom: 3rem; }
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}
.feature-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  padding: 1.5rem;
  transition: transform 0.2s, box-shadow 0.2s;
}
.feature-card:hover { transform: translateY(-4px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
.feature-card svg { width: 32px; height: 32px; color: var(--green); margin-bottom: 0.75rem; }
.feature-card h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }
.feature-card p { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5; }
@media (max-width: 768px) { .features-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .features-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Write screenshots section CSS**

```css
.screenshots-row {
  display: flex;
  gap: 1.5rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-bottom: 1rem;
}
.screenshot-frame {
  flex: 0 0 min(100%, 700px);
  scroll-snap-align: start;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-card);
  background: var(--bg-card);
}
.window-chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.08);
}
.window-dot { width: 12px; height: 12px; border-radius: 50%; }
.window-dot.red { background: #ff5f57; }
.window-dot.yellow { background: #ffbd2e; }
.window-dot.green { background: #28c840; }
.screenshot-placeholder {
  height: 350px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border: 2px dashed var(--border-card);
  margin: 1rem;
  border-radius: 8px;
  font-size: 0.95rem;
}
```

- [ ] **Step 7: Write downloads table + tech strip + footer CSS**

```css
.downloads-grid {
  display: grid;
  gap: 0.75rem;
  max-width: 600px;
  margin: 0 auto;
}
.download-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  transition: border-color 0.2s;
}
.download-row:hover { border-color: var(--green); }
.download-row.recommended { border-color: var(--green); background: rgba(119,195,81,0.08); }
.download-row svg { width: 24px; height: 24px; flex-shrink: 0; }
.download-row .platform-info { flex: 1; }
.download-row .platform-name { font-weight: 600; font-size: 0.95rem; }
.download-row .platform-arch { font-size: 0.8rem; color: var(--text-secondary); }
.download-row .badge { font-size: 0.7rem; background: var(--green); color: #0a0a0a; padding: 2px 8px; border-radius: 99px; font-weight: 600; margin-left: 0.5rem; }
.download-row .dl-link { font-weight: 600; font-size: 0.9rem; color: var(--green); }
.tech-strip {
  display: flex;
  justify-content: center;
  gap: 2rem;
  padding: 3rem 2rem;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
.tech-strip span { display: flex; align-items: center; gap: 0.4rem; }
footer {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  border-top: 1px solid var(--border-card);
}
footer a { color: var(--text-secondary); }
footer a:hover { color: var(--green); }
```

- [ ] **Step 8: Add focus indicator styles**

```css
a:focus-visible, .download-btn:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
```

### Task 3: Add HTML content for all sections

**Files:**
- Modify: `docs/index.html` (body content)

- [ ] **Step 9: Write hero section HTML**

Inside `<header id="hero" class="hero">`:
- Inline SVG lightning bolt icon (simple path, `aria-hidden="true"`)
- `<h1>DebridDownloader</h1>`
- `<p class="tagline">Blazing-fast desktop client for Real-Debrid</p>`
- `<p class="subtext">Manage torrents and downloads with a native app built on Rust + React</p>`
- `<a id="hero-download" class="download-btn" href="https://github.com/prjoni99/DebridDownloader/releases/latest">` containing:
  - 3 platform SVG icons (Apple, Windows, Linux) each with class `os-icon` and `data-os="mac|win|linux"`, all initially hidden via CSS (`display:none`)
  - A `<span id="hero-download-label">Download on GitHub</span>` (JS will update text and show the right icon)
- `<a class="other-platforms" href="#downloads">Other platforms ↓</a>`

Platform icon CSS (add to hero CSS):
```css
.download-btn .os-icon { display: none; width: 20px; height: 20px; fill: #0a0a0a; }
.download-btn .os-icon.visible { display: inline-block; }
```

Platform SVGs to include inside the button (simplified paths):
- **Apple**: `<svg class="os-icon" data-os="mac" aria-hidden="true" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83"/><path d="M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/></svg>`
- **Windows**: `<svg class="os-icon" data-os="win" aria-hidden="true" viewBox="0 0 24 24"><path fill="#0a0a0a" d="M3 12V6.5l8-1.1V12H3zm10 0V5.2l8-1.2V12h-8zM3 13h8v6.6l-8-1.1V13zm10 0h8v6l-8 1.2V13z"/></svg>`
- **Linux**: `<svg class="os-icon" data-os="linux" aria-hidden="true" viewBox="0 0 24 24"><path fill="#0a0a0a" d="M12.5 2c-1.6 0-2.9 1.5-3 3.4 0 .5.1 1.1.3 1.6-.6.5-1 1.2-1.1 2-.2 1.2.2 2.5.4 3.2-.5.6-1.2 1.7-1.5 3-.3 1.3 0 2.6.8 3.4.5.5.5 1 .2 1.8-.3.7-.4 1.5.3 2.2.5.5 1.3.8 2.2.4.7-.3 1.1-.3 1.8 0 .9.4 1.9.1 2.4-.5.6-.7.5-1.5.2-2.2-.3-.8-.3-1.3.2-1.8.8-.8 1.1-2.1.8-3.4-.3-1.3-1-2.4-1.5-3 .2-.7.6-2 .4-3.2-.1-.8-.5-1.5-1.1-2 .2-.5.3-1.1.3-1.6-.1-1.9-1.4-3.4-3-3.4z"/></svg>`

- [ ] **Step 10: Write features section HTML**

Inside `<section id="features" class="section">`:
- `<h2 class="section-title">Features</h2>`
- `<div class="features-grid">` with 6 `.feature-card` divs
- Each card: inline SVG icon (`aria-hidden="true"`, `fill="none" stroke="currentColor" stroke-width="2"`), `<h3>`, `<p>`
- Use simple 24x24 viewBox stroke icons (Lucide-style). Specific paths for each:
  1. **Torrent Management** (magnet/U-shape icon): `<path d="M6 15V9a6 6 0 0 1 12 0v6"/><path d="M6 15a3 3 0 0 0 6 0"/><path d="M12 15a3 3 0 0 0 6 0"/>` — "Add magnets or .torrent files, select specific files, and monitor progress in real time."
  2. **Tracker Search** (search/magnifying glass icon): `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>` — "Add your own tracker sources in settings and search across all of them in parallel."
  3. **Download Engine** (download-arrow icon): `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>` — "Multi-threaded downloads with real-time speed, ETA, and progress tracking."
  4. **Keyboard First** (keyboard icon): `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>` — "⌘K search, ⌘R refresh, arrow navigation, Enter to download. Full keyboard control."
  5. **Secure Storage** (lock icon): `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>` — "API tokens stored in OS keychain. macOS builds signed and notarized by Apple."
  6. **Themes** (palette icon): `<circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3 4h-1.3c-.8 0-1.5.7-1.5 1.5 0 .4.2.8.4 1.1.3.3.4.6.4 1 0 .8-.7 1.4-1.5 1.4H12z"/>` — "Dark and light mode with 6 accent colors. Runs quietly in your system tray."

- [ ] **Step 11: Write screenshots section HTML**

Inside `<section id="screenshots" class="section">`:
- `<h2 class="section-title">See It In Action</h2>`
- `<div class="screenshots-row">` with one `.screenshot-frame`:
  - `.window-chrome` with 3 `.window-dot` spans (red, yellow, green)
  - `.screenshot-placeholder` with text "Screenshots coming soon"

- [ ] **Step 12: Write downloads section HTML**

Inside `<section id="downloads" class="section">`:
- `<h2 class="section-title">Download</h2>`
- `<div class="downloads-grid">` with 3 `.download-row` anchors:
  1. macOS (Apple Silicon) row: Apple SVG icon, "macOS" name, "Apple Silicon (M1/M2/M3/M4)" arch, `.dmg` link, `data-os="mac"`
  2. macOS (Intel) row: Apple SVG icon, "macOS" name, "Intel" arch, `.dmg` link, `data-os="mac"`
  3. Windows row: Windows SVG icon, "Windows" name, "x64" arch, `.exe installer` link, `data-os="win"`
- Each row: `<a href="https://github.com/prjoni99/DebridDownloader/releases/latest" class="download-row" data-os="mac|win">`
- The `data-os` attribute is used by JS to add `.recommended` class and "Recommended for you" badge
- Use the same Apple/Windows SVG icons from the hero button (same simplified paths)

- [ ] **Step 13: Write tech strip and footer HTML**

Tech strip inside `<div class="tech-strip">`:
- 5 `<span>` elements: Tauri, React, Rust, TypeScript, Tailwind CSS (text only, no logos needed)

Footer:
- "Built by <a href="https://github.com/prjoni99">Jonathan Vargas</a> · <a href="https://github.com/prjoni99/DebridDownloader">GitHub</a> · MIT License"

### Task 4: Add JavaScript for platform detection

**Files:**
- Modify: `docs/index.html` (inline `<script>` block)

- [ ] **Step 14: Write platform detection and DOM updates**

```javascript
(function() {
  function detectOS() {
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      var p = navigator.userAgentData.platform.toLowerCase();
      if (p.includes('mac')) return 'mac';
      if (p.includes('win')) return 'win';
      if (p.includes('linux')) return 'linux';
    }
    var ua = (navigator.platform || navigator.userAgent || '').toLowerCase();
    if (ua.includes('mac')) return 'mac';
    if (ua.includes('win')) return 'win';
    if (ua.includes('linux')) return 'linux';
    return null;
  }

  var os = detectOS();
  var btn = document.getElementById('hero-download');
  var labels = { mac: 'Download for macOS', win: 'Download for Windows', linux: 'Download for Linux' };

  if (os && labels[os]) {
    document.getElementById('hero-download-label').textContent = labels[os];
    var icon = btn.querySelector('.os-icon[data-os="' + os + '"]');
    if (icon) icon.classList.add('visible');
  }

  // Highlight recommended download row
  var rows = document.querySelectorAll('.download-row[data-os]');
  rows.forEach(function(row) {
    if (row.getAttribute('data-os') === os) {
      row.classList.add('recommended');
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Recommended for you';
      row.querySelector('.platform-info').appendChild(badge);
    }
  });
})();
```

- [ ] **Step 15: Verify platform detection works**

Open `docs/index.html` in browser. Confirm:
- Hero button shows platform-specific text (e.g., "Download for macOS" on a Mac)
- The matching download row has green border highlight and "Recommended" badge
- All download links go to the GitHub Releases page

### Task 5: Final verification and commit

- [ ] **Step 16: Visual check — full page review**

Open `docs/index.html` in browser and verify:
- Hero: gradient background, pulsing green glow, title/tagline/button render correctly
- Features: 6 cards in 3-column grid, hover effects work
- Screenshots: window chrome with placeholder
- Downloads: 3 rows, recommended highlight works
- Tech strip and footer render
- Responsive: resize to mobile widths, grid collapses appropriately
- Favicon shows in browser tab

- [ ] **Step 17: Accessibility check**

- Tab through all interactive elements — focus indicators visible
- Check with `prefers-reduced-motion` enabled (System Preferences → Accessibility → Reduce motion on macOS) — glow animation should stop

- [ ] **Step 18: Commit**

```bash
git add docs/index.html
git commit -m "feat: add GitHub Pages landing page"
```

### Task 6: Enable GitHub Pages

- [ ] **Step 19: Configure GitHub Pages**

In the GitHub repo settings (Settings → Pages), set:
- Source: "Deploy from a branch"
- Branch: `main`
- Folder: `/docs`
- Save

Or via CLI:
```bash
gh api repos/prjoni99/DebridDownloader/pages -X POST -f source.branch=main -f source.path=/docs 2>/dev/null || gh api repos/prjoni99/DebridDownloader/pages -X PUT -f source.branch=main -f source.path=/docs
```

- [ ] **Step 20: Verify deployment**

After pushing, confirm the site is live at `https://prjoni99.github.io/DebridDownloader/`
