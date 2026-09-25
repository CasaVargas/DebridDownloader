import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../hooks/useAuth";
import * as authApi from "../api/auth";
import { getAuthMethod, getActiveProvider, getAvailableProviders, switchProvider } from "../api/providers";
import type { ProviderInfo } from "../types";
import { useAppearance } from "../hooks/useAppearance";
import { providerName as providerLabel } from "../lib/providers";
import { Button, cn, Input, Select, Spinner } from "../components/ui";

export default function AuthPage() {
  // Theme + accent must apply before sign-in too (Layout isn't mounted here).
  useAppearance();
  const { login } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"token" | "oauth">("token");
  const [authMethod, setAuthMethod] = useState<"api_key" | "oauth_device">("oauth_device");
  const [providerName, setProviderName] = useState("Real-Debrid");
  const [activeProviderId, setActiveProviderId] = useState("real-debrid");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [previousProvider, setPreviousProvider] = useState<string | null>(null);
  const [switchingProvider, setSwitchingProvider] = useState(false);

  useEffect(() => {
    Promise.all([getAuthMethod(), getActiveProvider()]).then(([method, id]) => {
      setAuthMethod(method);
      setActiveProviderId(id);
      setProviderName(providerLabel(id));
    }).catch(() => {});
    getAvailableProviders().then(setProviders).catch(() => {});
    const prev = localStorage.getItem("previous-provider");
    if (prev) setPreviousProvider(prev);
  }, []);

  const handleProviderSelect = async (id: string) => {
    if (id === activeProviderId || switchingProvider) return;
    setSwitchingProvider(true);
    setError("");
    setToken("");
    setUserCode("");
    setOauthStatus("");
    try {
      const hasCredentials = await switchProvider(id);
      if (hasCredentials) {
        // Provider already has saved credentials — reload to log in
        window.location.reload();
        return;
      }
      setActiveProviderId(id);
      const method = await getAuthMethod();
      setAuthMethod(method);
      setProviderName(providerLabel(id));
      setMode("token");
    } catch (e) {
      setError(String(e));
    } finally {
      setSwitchingProvider(false);
    }
  };

  // OAuth state
  const [userCode, setUserCode] = useState("");
  const [oauthStatus, setOauthStatus] = useState("");

  const handleTokenLogin = async () => {
    if (!token.trim()) {
      setError("Please enter your API token");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(token.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async () => {
    setLoading(true);
    setError("");
    setUserCode("");
    setOauthStatus("Requesting device code...");

    try {
      // Step 1: Get device code
      const deviceCode = await authApi.oauthStart();
      setUserCode(deviceCode.user_code);
      setOauthStatus("Opening browser...");

      // Step 2: Open browser for user to authorize
      await openUrl(deviceCode.verification_url);
      setOauthStatus(
        "Enter the code above on the Real-Debrid page, then wait..."
      );

      // Step 3: Poll for credentials
      let credentials = null;
      const maxAttempts = Math.floor(
        deviceCode.expires_in / deviceCode.interval
      );

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, deviceCode.interval * 1000));
        credentials = await authApi.oauthPollCredentials(
          deviceCode.device_code
        );
        if (credentials) break;
      }

      if (!credentials) {
        throw new Error("OAuth authorization timed out");
      }

      setOauthStatus("Getting access token...");

      // Step 4: Exchange for token
      await authApi.oauthGetToken(
        credentials.client_id,
        credentials.client_secret,
        deviceCode.device_code
      );

      // Step 5: Reload user
      setOauthStatus("Connected!");
      // Small delay so user sees "Connected!" before redirect
      await new Promise((r) => setTimeout(r, 500));
      window.location.reload();
    } catch (e) {
      setError(String(e));
      setOauthStatus("");
      setUserCode("");
    } finally {
      setLoading(false);
    }
  };

  const segClass = (active: boolean) =>
    cn(
      "h-6 flex-1 rounded-sm px-2.5 text-sm font-medium transition-colors duration-120",
      active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg",
    );
  const isRd = activeProviderId === "real-debrid";

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="flex w-96 flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-panel">
        {/* Header */}
        <div className="flex flex-col items-center gap-1 text-center">
          <img src="/app-icon.png" alt="" className="mb-2 size-10 rounded-lg" />
          <h1 className="text-xl font-semibold text-fg">DebridDownloader</h1>
          <p className="text-sm text-fg-secondary">Connect your {providerName} account</p>
        </div>

        {/* Provider picker */}
        {providers.length > 1 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-base text-fg">Provider</span>
            <div className="flex items-center gap-2">
              {switchingProvider && <Spinner size="sm" />}
              <Select
                ariaLabel="Provider"
                value={activeProviderId}
                onValueChange={(id) => handleProviderSelect(id)}
                options={providers.map((p) => ({ value: p.id, label: providerLabel(p.id) }))}
              />
            </div>
          </div>
        )}

        {/* Mode toggle */}
        {authMethod === "oauth_device" && (
          <div role="radiogroup" aria-label="Sign-in method" className="flex gap-0.5 rounded-md border border-border p-0.5">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "token"}
              className={segClass(mode === "token")}
              onClick={() => {
                setMode("token");
                setError("");
                setUserCode("");
                setOauthStatus("");
              }}
            >
              API Token
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "oauth"}
              className={segClass(mode === "oauth")}
              onClick={() => {
                setMode("oauth");
                setError("");
              }}
            >
              OAuth Login
            </button>
          </div>
        )}

        {(authMethod === "api_key" || mode === "token") ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => { e.preventDefault(); handleTokenLogin(); }}
          >
            <span className="text-sm text-fg-muted">{authMethod === "api_key" ? "API Key" : "API Token"}</span>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={authMethod === "api_key" ? "Paste your API key" : "Paste your token from real-debrid.com/apitoken"}
              aria-label={authMethod === "api_key" ? "API key" : "API token"}
              autoFocus
            />
            <p className="text-sm text-fg-muted">
              {authMethod === "api_key" ? (
                "Enter the API key from your account settings"
              ) : (
                <>
                  Get your token at{" "}
                  <button type="button" className="text-accent-text hover:underline" onClick={() => openUrl("https://real-debrid.com/apitoken").catch(() => {})}>
                    real-debrid.com/apitoken
                  </button>
                </>
              )}
            </p>
            <Button type="submit" variant="primary" disabled={loading} className="mt-2 w-full">
              {loading ? "Connecting..." : "Sign in"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-secondary">
              Authenticate via Real-Debrid's device authorization. A browser will open for you to approve access.
            </p>

            {/* User code display */}
            {userCode && (
              <div className="rounded-md border border-border bg-bg px-4 py-3 text-center">
                <p className="text-sm text-fg-muted">Enter this code on the Real-Debrid page:</p>
                <p className="mt-1 font-mono text-xl font-semibold tracking-widest text-fg">{userCode}</p>
              </div>
            )}

            {oauthStatus && (
              <p className="text-center text-sm text-fg-secondary" role="status">{oauthStatus}</p>
            )}

            <Button variant="primary" onClick={handleOAuthLogin} disabled={loading} className="w-full">
              {loading ? "Waiting for authorization..." : isRd ? "Sign in with Real-Debrid" : "Start OAuth Login"}
            </Button>
          </div>
        )}

        {error && <p className="text-center text-sm text-danger" role="alert">{error}</p>}

        {previousProvider && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              localStorage.removeItem("previous-provider");
              await switchProvider(previousProvider);
              window.location.href = "/settings";
            }}
          >
            Cancel and go back
          </Button>
        )}
      </div>
    </div>
  );
}
