import type { ReactNode } from "react";

export function CountBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-raised px-1.5 text-xs font-semibold text-fg-secondary tabular">{children}</span>;
}
