import { useEffect, useState, type ReactNode } from "react";
import { hasServerSession, isTauri, UNAUTHORIZED_EVENT } from "../api/transport";
import ServerLoginPage from "../pages/ServerLoginPage";

/** Where a fresh browser sign-in lands. */
export const AFTER_LOGIN_PATH = "/downloads";

/**
 * In a plain browser (the headless server's web UI), shows `ServerLoginPage` until the browser has
 * a session cookie, then renders the app. In the desktop app it renders the app straight away.
 * A 401 from any later call (cookie cleared, token rotated) brings the login back.
 */
export default function ServerSessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "login" | "ok">(() => (isTauri() ? "ok" : "checking"));

  useEffect(() => {
    if (isTauri()) return;
    let alive = true;
    hasServerSession()
      .then((ok) => alive && setState((s) => (s === "checking" ? (ok ? "ok" : "login") : s)))
      .catch(() => alive && setState((s) => (s === "checking" ? "login" : s)));
    const onUnauthorized = () => setState("login");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  if (state === "checking") return null;
  if (state === "login") {
    return (
      <ServerLoginPage
        onLoggedIn={() => {
          window.history.replaceState(null, "", AFTER_LOGIN_PATH);
          setState("ok");
        }}
      />
    );
  }
  return <>{children}</>;
}
