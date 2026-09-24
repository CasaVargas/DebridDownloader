import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Files that have been migrated to tokens + primitives. Each screen task appends its files.
 * Task 13 replaces this list with "every file under src/pages and src/components".
 */
export const CLEAN_FILES: string[] = [
  // Task 2: primitives
  "src/components/ui/cn.ts",
  "src/components/ui/Button.tsx",
  "src/components/ui/IconButton.tsx",
  "src/components/ui/Input.tsx",
  "src/components/ui/Toggle.tsx",
  "src/components/ui/StatusDot.tsx",
  "src/components/ui/CountBadge.tsx",
  "src/components/ui/Kbd.tsx",
  "src/components/ui/Spinner.tsx",
  "src/components/ui/EmptyState.tsx",
  "src/components/ui/Toolbar.tsx",
  "src/components/ui/Inspector.tsx",
  "src/components/ui/SettingsGroup.tsx",
  "src/components/ui/Dialog.tsx",
  "src/components/ui/Menu.tsx",
  "src/components/ui/ContextMenu.tsx",
  "src/components/ui/Select.tsx",
  "src/components/ui/Tooltip.tsx",
  "src/components/ui/index.ts",
  "src/lib/platform.ts",
];

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
