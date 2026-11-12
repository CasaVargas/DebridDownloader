import { useState } from "react";
import { serverLogin } from "../api/transport";
import { useAppearance } from "../hooks/useAppearance";
import { Button, Input } from "../components/ui";

/**
 * Browser-only sign-in to the headless server: exchanges the server token (`server.auth_token`
 * in the data dir's secrets.json, or `DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN`) for the session
 * cookie. Not the debrid-provider sign-in, which is `AuthPage`.
 */
export default function ServerLoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  useAppearance();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!token.trim()) {
      setError("Enter the server token");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await serverLogin(token.trim());
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <form
        className="flex w-96 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-panel"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <img src="/app-icon.png" alt="" className="mb-2 size-10 rounded-lg" />
          <h1 className="text-xl font-semibold text-fg">DebridDownloader</h1>
          <p className="text-sm text-fg-secondary">Sign in to this server</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Server token</span>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the server's API token"
            aria-label="Server token"
            autoComplete="current-password"
            autoFocus
          />
          <p className="text-sm text-fg-muted">
            It's server.auth_token in the server's secrets.json, or the value of DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN.
          </p>
        </div>
        {error && <p className="text-center text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={loading} className="w-full">
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
