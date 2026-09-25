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
