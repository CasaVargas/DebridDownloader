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
