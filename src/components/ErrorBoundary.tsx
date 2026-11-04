import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

/** Shows the error and a Reload button instead of a blank window when rendering crashes. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg p-8 text-center text-fg">
        <p className="text-lg font-semibold">Something went wrong</p>
        <p className="max-w-140 break-words text-sm text-fg-muted">{error.message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
