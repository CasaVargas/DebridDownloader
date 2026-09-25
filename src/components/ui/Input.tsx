import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Kbd } from "./Kbd";

type Props = InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; kbd?: string };

export const Input = forwardRef<HTMLInputElement, Props>(function Input({ icon, kbd, className, ...rest }, ref) {
  return (
    <label
      className={cn(
        "flex h-7 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-base text-fg",
        "focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent/35",
        className,
      )}
    >
      {icon && <span className="shrink-0 text-fg-muted">{icon}</span>}
      <input ref={ref} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted" {...rest} />
      {kbd && <Kbd combo={kbd} />}
    </label>
  );
});
