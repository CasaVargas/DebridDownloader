import * as CM from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import { type MenuItem, menuContentClass, menuItemClass, renderItemContent } from "./Menu";

export function ContextMenu({ items, children }: { items: MenuItem[]; children: ReactNode }) {
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={menuContentClass}>
          {items.map((item, i) =>
            item === "separator" ? (
              <CM.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <CM.Item key={item.label} disabled={item.disabled} onSelect={item.onSelect} className={menuItemClass}>
                {renderItemContent(item)}
              </CM.Item>
            ),
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
