export function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-border border-t-accent ${size === "sm" ? "size-4" : "size-6"}`}
    />
  );
}
