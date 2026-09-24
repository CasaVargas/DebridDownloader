import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS, ACCENT_NAMES, THEME_BASE, accentText, contrastRatio, pickAccentFg } from "../theme/accents";

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

  it("THEME_BASE mirrors tokens.css (accent-text is derived from it)", () => {
    expect(THEME_BASE[theme]).toEqual({ bg: p.bg, surface: p.surface, text: p.text });
  });

  it("every accent: accent-text ≥ 4.5:1 on bg and surface", () => {
    for (const name of ACCENT_NAMES) {
      const t = accentText(ACCENTS[name][theme], theme);
      expect(t, name).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(t, p.bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t, p.surface), `${name} on surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every accent: fg ≥ 4.5:1 on the accent and focus ring ≥ 3:1 on bg", () => {
    for (const name of ACCENT_NAMES) {
      const a = ACCENTS[name][theme];
      expect(contrastRatio(pickAccentFg(a), a), `${name} fg`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(a, p.bg), `${name} ring`).toBeGreaterThanOrEqual(3);
    }
  });
});
