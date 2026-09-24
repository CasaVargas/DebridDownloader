import type { ReactNode, Ref } from "react";
import { Input } from "./Input";

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function Toolbar({ title, subtitle, filter, actions }: {
  title: string;
  subtitle?: string;
  filter?: { value: string; onChange(v: string): void; placeholder?: string; inputRef?: Ref<HTMLInputElement> };
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="shrink-0 text-lg font-semibold text-fg">{title}</h1>
      {subtitle && <span className="min-w-0 truncate text-sm text-fg-muted tabular">{subtitle}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {filter && (
          <Input
            ref={filter.inputRef}
            className="w-40 xl:w-56"
            icon={<SearchIcon />}
            kbd="/"
            value={filter.value}
            onChange={(e) => filter.onChange(e.target.value)}
            placeholder={filter.placeholder ?? "Filter"}
            aria-label={filter.placeholder ?? "Filter"}
          />
        )}
        {actions}
      </div>
    </div>
  );
}
