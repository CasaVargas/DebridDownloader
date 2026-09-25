import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Dialog({ open, onOpenChange, title, description, footer, children, width = "md" }: {
  open: boolean; onOpenChange(o: boolean): void; title: string; description?: string; footer?: ReactNode; children: ReactNode; width?: "sm" | "md";
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 animate-[fade-in_120ms_ease-out]" />
        <D.Content
          className={`fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-panel animate-[scale-in_120ms_ease-out] ${width === "sm" ? "w-96" : "w-140"}`}
        >
          <div className="px-5 pt-4">
            <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
