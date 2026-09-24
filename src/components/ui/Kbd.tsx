import { formatCombo } from "../../lib/platform";

export function Kbd({ combo }: { combo: string }) {
  return (
    <kbd className="inline-flex h-4.5 items-center rounded-sm border border-border bg-raised px-1 font-sans text-xs font-normal normal-case tracking-normal text-fg-secondary">
      {formatCombo(combo)}
    </kbd>
  );
}
