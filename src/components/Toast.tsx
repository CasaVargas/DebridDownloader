import { useEffect, useState } from "react";
import { cn } from "./ui";

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({ message, onDismiss, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    let inner: ReturnType<typeof setTimeout>;
    const outer = setTimeout(() => {
      setVisible(false);
      inner = setTimeout(onDismiss, 200);
    }, duration);
    return () => {
      clearTimeout(outer);
      clearTimeout(inner);
    };
  }, [duration, onDismiss]);

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-fg shadow-panel transition-all duration-120",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      {message}
    </div>
  );
}
