import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}
const ROOT = resolve(__dirname, "../..");

/** Every file under src/pages and src/components must use tokens + primitives only. */
export const CLEAN_FILES = [...walk(`${ROOT}/src/pages`), ...walk(`${ROOT}/src/components`), `${ROOT}/src/lib/platform.ts`, `${ROOT}/src/lib/providers.ts`, `${ROOT}/src/lib/downloadStatus.ts`, `${ROOT}/src/hooks/useShortcut.ts`].map((p) =>
  p.slice(ROOT.length + 1),
);

const RULES: { name: string; re: RegExp }[] = [
  { name: "hex color", re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb()/rgba()", re: /\brgba?\(/ },
  { name: "pixel value", re: /\b\d+(\.\d+)?px\b/ },
  { name: "old --theme-* variable", re: /--theme-/ },
  { name: "old --accent-bg-* variable", re: /--accent-bg-/ },
  { name: "accent as text color (use text-accent-text)", re: /\btext-accent(?![-\w])/ },
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
    expect(findLiterals(`className="text-sm text-accent"`)).toHaveLength(1);
    expect(findLiterals(`className="hover:text-accent underline"`)).toHaveLength(1);
    expect(findLiterals(`className="bg-accent text-accent-fg text-accent-text"`)).toHaveLength(0);
    expect(findLiterals(`<path d="M21 15v4a2" /> // style-literal-ok`)).toHaveLength(0);
  });

  for (const file of CLEAN_FILES) {
    it(file, () => {
      const hits = findLiterals(readFileSync(resolve(__dirname, "../..", file), "utf8"));
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }
});
