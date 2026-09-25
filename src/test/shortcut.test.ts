import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isTypingTarget, matchesCombo, useShortcut } from "../hooks/useShortcut";

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent("keydown", { key: k, ...mods });

describe("matchesCombo", () => {
  it("maps Mod per platform", () => {
    expect(matchesCombo(key("k", { metaKey: true }), "Mod+K", true)).toBe(true);
    expect(matchesCombo(key("k", { ctrlKey: true }), "Mod+K", true)).toBe(false);
    expect(matchesCombo(key("k", { ctrlKey: true }), "Mod+K", false)).toBe(true);
    expect(matchesCombo(key("k", { metaKey: true }), "Mod+K", false)).toBe(false);
  });
  it("requires exact modifiers", () => {
    expect(matchesCombo(key("k", { metaKey: true, shiftKey: true }), "Mod+K", true)).toBe(false);
    expect(matchesCombo(key("1"), "1", true)).toBe(true);
    expect(matchesCombo(key("1", { metaKey: true }), "1", true)).toBe(false);
  });
  it("matches named keys", () => {
    expect(matchesCombo(key(" "), "Space", true)).toBe(true);
    expect(matchesCombo(key("ArrowDown"), "ArrowDown", true)).toBe(true);
    expect(matchesCombo(key(","), "Mod+,", false)).toBe(false);
    expect(matchesCombo(key(",", { ctrlKey: true }), "Mod+,", false)).toBe(true);
  });
});

describe("useShortcut", () => {
  it("ignores single-key shortcuts while typing", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut("1", handler));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("modifier shortcuts still work while typing", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut(["Mod+K"], handler, { mac: true }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("Space/Enter on a focused button activate the button, not the shortcut", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut(["Space", "Enter"], handler));
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    btn.remove();
  });

  it("arrow keys inside an open menu or listbox are left to the widget", () => {
    const handler = vi.fn();
    renderHook(() => useShortcut("ArrowDown", handler));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    menu.appendChild(item);
    document.body.appendChild(menu);
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    menu.remove();
  });

  it("isTypingTarget", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    const div = document.createElement("div");
    div.contentEditable = "true";
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
  });
});
