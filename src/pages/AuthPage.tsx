import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../hooks/useAuth";
import * as authApi from "../api/auth";

export default function AuthPage() {
  const { login } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"token" | "oauth">("token");

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

  return (
    <div className="flex items-center justify-center h-screen bg-rd-darker bg-[radial-gradient(ellipse_at_center,rgba(120,190,32,0.04)_0%,transparent_70%)]">
      <div className="w-full max-w-md p-8 card-base bg-gradient-to-b from-[#1a1a30] to-[#141428] shadow-[0_0_20px_rgba(120,190,32,0.15)] modal-content">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-rd-green mb-2">
            DebridDownloader
          </h1>
          <p className="text-zinc-400 text-sm">
            Connect your Real-Debrid account
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex mb-6 bg-rd-darker rounded-lg p-1">
          <button
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${
              mode === "token"
                ? "bg-rd-green/20 text-rd-green border border-rd-green/30 font-semibold"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
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
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${
              mode === "oauth"
                ? "bg-rd-green/20 text-rd-green border border-rd-green/30 font-semibold"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => {
              setMode("oauth");
              setError("");
            }}
          >
            OAuth Login
          </button>
        </div>

        {mode === "token" ? (
          <div>
            <label className="block text-sm text-zinc-300 mb-2">
              API Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTokenLogin()}
              placeholder="Paste your token from real-debrid.com/apitoken"
              className="w-full px-4 py-3 bg-rd-darker border border-rd-border rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-rd-green focus:shadow-[0_0_20px_rgba(120,190,32,0.15)] text-sm"
            />
            <p className="text-xs text-zinc-500 mt-2">
              Get your token at{" "}
              <span className="text-rd-green">real-debrid.com/apitoken</span>
            </p>
            <button
              onClick={handleTokenLogin}
              disabled={loading}
              className="w-full mt-4 py-3 bg-rd-green text-black font-semibold rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 shadow-lg shadow-rd-green/25"
            >
              {loading ? "Connecting..." : "Connect"}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-zinc-400 mb-4">
              Authenticate via Real-Debrid's device authorization. A browser
              will open for you to approve access.
            </p>

            {/* User code display */}
            {userCode && (
              <div className="mb-4 p-4 bg-rd-darker border border-rd-border rounded-lg text-center">
                <p className="text-xs text-zinc-400 mb-2">
                  Enter this code on the Real-Debrid page:
                </p>
                <p className="text-3xl font-mono font-bold text-rd-green tracking-widest">
                  {userCode}
                </p>
              </div>
            )}

            {oauthStatus && (
              <p className="text-sm text-cyan-400 mb-4 text-center">
                {oauthStatus}
              </p>
            )}

            <button
              onClick={handleOAuthLogin}
              disabled={loading}
              className="w-full py-3 bg-rd-green text-black font-semibold rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 shadow-lg shadow-rd-green/25"
            >
              {loading ? "Waiting for authorization..." : "Start OAuth Login"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400 text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
