import type { ReactNode } from "react";

const colors = { success: "bg-success", info: "bg-info", warning: "bg-warning", danger: "bg-danger", idle: "bg-idle" };

export function StatusDot({ status, children }: { status: keyof typeof colors; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-base">
      <span className={`size-1.75 shrink-0 rounded-full ${colors[status]}`} aria-hidden />
      {children}
    </span>
  );
}
