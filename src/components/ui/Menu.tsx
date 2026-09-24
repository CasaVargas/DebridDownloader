import * as DM from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { formatCombo } from "../../lib/platform";

export type MenuItem = { label: string; onSelect(): void; danger?: boolean; shortcut?: string; disabled?: boolean } | "separator";

export const menuContentClass = "z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-panel animate-[fade-in_120ms_ease-out]";
export const menuItemClass =
  "flex h-7 cursor-default select-none items-center justify-between gap-6 rounded-md px-2 text-base text-fg outline-none data-[highlighted]:bg-selected data-[disabled]:opacity-50";

export function renderItemContent(item: Exclude<MenuItem, "separator">) {
  return (
    <>
      <span className={item.danger ? "text-danger" : undefined}>{item.label}</span>
      {item.shortcut && <span className="text-sm text-fg-muted">{formatCombo(item.shortcut)}</span>}
    </>
  );
}

export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className={menuContentClass}>
          {items.map((item, i) =>
            item === "separator" ? (
              <DM.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <DM.Item key={item.label} disabled={item.disabled} onSelect={item.onSelect} className={menuItemClass}>
                {renderItemContent(item)}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
