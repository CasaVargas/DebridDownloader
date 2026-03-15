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
    <div className="flex items-center justify-center h-screen bg-[#08080f]">
      <div className="w-full max-w-lg px-12 py-14 bg-[#0f0f18] border border-[rgba(255,255,255,0.06)] rounded-2xl">
        {/* Logo + Header */}
        <div className="flex flex-col items-center mb-12 gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, var(--accent, #10b981), var(--accent, #10b981)cc)" }}
            >
              <span className="text-white text-[18px] font-bold">D</span>
            </div>
            <span className="text-[20px] font-semibold text-[#f1f5f9]">
              DebridDownloader
            </span>
          </div>
          <p className="text-[#94a3b8] text-[15px]">
            Connect your Real-Debrid account
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex mb-10 bg-[#08080f] rounded-lg p-1.5">
          <button
            className={`flex-1 py-2.5 text-[15px] rounded-lg transition-colors ${
              mode === "token"
                ? "bg-[rgba(16,185,129,0.12)] text-[#10b981] border border-[rgba(16,185,129,0.2)] font-semibold"
                : "text-[#475569] hover:text-[#94a3b8]"
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
            className={`flex-1 py-2.5 text-[15px] rounded-lg transition-colors ${
              mode === "oauth"
                ? "bg-[rgba(16,185,129,0.12)] text-[#10b981] border border-[rgba(16,185,129,0.2)] font-semibold"
                : "text-[#475569] hover:text-[#94a3b8]"
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
            <label className="block text-[15px] text-[#94a3b8] mb-3">
              API Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTokenLogin()}
              placeholder="Paste your token from real-debrid.com/apitoken"
              className="w-full px-4 py-3.5 bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg text-[#f1f5f9] placeholder-[#374151] text-[15px] focus:outline-none focus:border-[rgba(16,185,129,0.3)] transition-all duration-150"
            />
            <p className="text-[14px] text-[#475569] mt-3">
              Get your token at{" "}
              <span className="text-[#10b981]">real-debrid.com/apitoken</span>
            </p>
            <button
              onClick={handleTokenLogin}
              disabled={loading}
              className="w-full mt-8 py-3.5 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 text-[15px]"
              style={{ background: "linear-gradient(135deg, var(--accent, #10b981), var(--accent, #10b981)cc)" }}
            >
              {loading ? "Connecting..." : "Connect"}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-[15px] text-[#94a3b8] mb-7">
              Authenticate via Real-Debrid's device authorization. A browser
              will open for you to approve access.
            </p>

            {/* User code display */}
            {userCode && (
              <div className="mb-7 p-6 bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-xl text-center">
                <p className="text-[14px] text-[#475569] mb-3">
                  Enter this code on the Real-Debrid page:
                </p>
                <p className="text-[#10b981] text-3xl font-mono tracking-widest">
                  {userCode}
                </p>
              </div>
            )}

            {oauthStatus && (
              <p className="text-[#10b981] text-[15px] mb-7 text-center">
                {oauthStatus}
              </p>
            )}

            <button
              onClick={handleOAuthLogin}
              disabled={loading}
              className="w-full py-3.5 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 text-[15px]"
              style={{ background: "linear-gradient(135deg, var(--accent, #10b981), var(--accent, #10b981)cc)" }}
            >
              {loading ? "Waiting for authorization..." : "Start OAuth Login"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-8 text-[#ef4444] text-[15px] text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
