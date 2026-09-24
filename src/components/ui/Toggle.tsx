import { cn } from "./cn";

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full transition-colors duration-120 disabled:opacity-50",
        checked ? "bg-accent" : "bg-border",
      )}
    >
      <span className={cn("absolute size-3.5 rounded-full bg-white shadow-sm transition-transform duration-120", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
