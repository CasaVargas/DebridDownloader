import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { Kbd } from "./Kbd";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  kbd?: string;
};

const variants = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-border bg-raised text-fg hover:bg-selected",
  ghost: "text-fg-secondary hover:bg-raised hover:text-fg",
  danger: "border border-danger/40 bg-raised text-danger hover:bg-danger/10",
};
const sizes = { md: "h-7 px-3 text-base", sm: "h-6 px-2 text-sm" };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", kbd, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-120",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && <Kbd combo={kbd} />}
    </button>
  );
});
