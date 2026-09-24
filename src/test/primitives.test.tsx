import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, Toggle, StatusDot, TooltipProvider } from "../components/ui";
import { formatCombo } from "../lib/platform";

describe("primitives", () => {
  it("Button applies variant and is a real button", () => {
    render(<Button variant="primary">Add</Button>);
    const b = screen.getByRole("button", { name: "Add" });
    expect(b).toHaveAttribute("type", "button");
    expect(b.className).toContain("bg-accent");
  });

  it("IconButton requires and exposes a label", () => {
    render(<TooltipProvider><IconButton label="Pause"><span>II</span></IconButton></TooltipProvider>);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("Toggle is an accessible switch", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Launch at login" />);
    const sw = screen.getByRole("switch", { name: "Launch at login" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("StatusDot renders its label", () => {
    render(<StatusDot status="danger">Failed</StatusDot>);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("formatCombo renders per platform", () => {
    expect(formatCombo("Mod+K", true)).toBe("⌘K");
    expect(formatCombo("Mod+K", false)).toBe("Ctrl K");
    expect(formatCombo("Mod+Shift+P", false)).toBe("Ctrl Shift P");
    expect(formatCombo("/", false)).toBe("/");
  });
});
