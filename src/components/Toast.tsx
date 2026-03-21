import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({ message, onDismiss, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200); // Wait for exit animation
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      className="fixed bottom-6 z-[200] px-5 py-3 rounded-xl text-[14px] font-medium shadow-lg transition-all duration-200"
      style={{
        left: "50%",
        background: "var(--theme-bg-surface)",
        color: "var(--theme-text-primary)",
        border: "1px solid var(--theme-border)",
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? "0" : "12px"})`,
      }}
    >
      {message}
    </div>
  );
}
