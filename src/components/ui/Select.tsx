import * as S from "@radix-ui/react-select";
import { cn } from "./cn";

export function Select<T extends string>({ value, onValueChange, options, ariaLabel, size = "md", className }: {
  value: T; onValueChange(v: T): void; options: { value: T; label: string }[]; ariaLabel: string; size?: "md" | "sm"; className?: string;
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-32 items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 text-fg",
          "data-[placeholder]:text-fg-muted",
          size === "md" ? "h-7 text-base" : "h-6 text-sm",
          className,
        )}
      >
        <S.Value />
        <S.Icon className="text-fg-muted">
          <svg width="10" height="10" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 1.5L6 6.5L11 1.5" /></svg>
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={4} className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-lg border border-border bg-surface p-1 shadow-panel">
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="flex h-7 cursor-default select-none items-center rounded-md px-2 text-base text-fg outline-none data-[highlighted]:bg-selected data-[state=checked]:font-medium"
              >
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
