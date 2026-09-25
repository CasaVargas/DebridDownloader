export type AccentName = "emerald" | "blue" | "violet" | "rose" | "amber" | "cyan";

export const ACCENTS: Record<AccentName, { label: string; dark: string; darkHover: string; light: string; lightHover: string }> = {
  emerald: { label: "Emerald", dark: "#10b981", darkHover: "#34d399", light: "#059669", lightHover: "#047857" },
  blue: { label: "Blue", dark: "#3b82f6", darkHover: "#60a5fa", light: "#2563eb", lightHover: "#1d4ed8" },
  violet: { label: "Violet", dark: "#8f62f7", darkHover: "#a78bfa", light: "#7c3aed", lightHover: "#6d28d9" },
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

/** The theme colors accent-text is checked against. Mirrors tokens.css (contrast.test.ts pins them equal). */
export const THEME_BASE: Record<"dark" | "light", { bg: string; surface: string; text: string }> = {
  dark: { bg: "#1e1e1e", surface: "#252526", text: "#e8e8e8" },
  light: { bg: "#ffffff", surface: "#f5f5f5", text: "#1f1f1f" },
};

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Accent color for TEXT (links, "Saved", selected labels): the accent itself if it already reaches
 * 4.5:1 on both bg and surface, otherwise mixed toward the theme's text color in 5% steps until it does.
 */
export function accentText(accentHex: string, theme: "dark" | "light"): string {
  const { bg, surface, text } = THEME_BASE[theme];
  const base = accentHex.toLowerCase();
  for (let i = 0; i <= 20; i++) {
    const c = mix(base, text, i * 0.05);
    if (contrastRatio(c, bg) >= 4.5 && contrastRatio(c, surface) >= 4.5) return c;
  }
  return text;
}

/** Text color for content on a filled accent surface. */
export function pickAccentFg(accentHex: string): "#ffffff" | "#111111" {
  return contrastRatio("#ffffff", accentHex) >= contrastRatio("#111111", accentHex) ? "#ffffff" : "#111111";
}
