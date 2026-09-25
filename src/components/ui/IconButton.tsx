import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "default" | "danger";
  size?: "md" | "sm";
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, variant = "default", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-120 disabled:opacity-50",
          size === "md" ? "size-7" : "size-6",
          variant === "danger" ? "text-danger hover:bg-danger/10" : "text-fg-secondary hover:bg-raised hover:text-fg",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
