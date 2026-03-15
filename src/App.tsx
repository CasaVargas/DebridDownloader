import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { AuthContext, type AuthState } from "./hooks/useAuth";
import * as authApi from "./api/auth";
import type { User } from "./types";

import Layout from "./components/Layout";
import AuthPage from "./pages/AuthPage";
import TorrentsPage from "./pages/TorrentsPage";
import DownloadsPage from "./pages/DownloadsPage";
import CompletedPage from "./pages/CompletedPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.getUser();
      setUser(u);
      setIsAuthenticated(true);
    } catch {
      setIsAuthenticated(false);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const hasToken = await authApi.loadSavedToken();
        if (hasToken) {
          await refresh();
        }
      } catch {
        // no saved token
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [refresh]);

  const login = async (token: string) => {
    await authApi.setApiToken(token);
    await refresh();
  };

  const loginOAuth = async () => {
    const deviceCode = await authApi.oauthStart();

    // Open browser for user to authorize
    window.open(deviceCode.verification_url, "_blank");

    // Poll for credentials
    let credentials = null;
    const maxAttempts = Math.floor(deviceCode.expires_in / deviceCode.interval);

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

    // Exchange for token
    await authApi.oauthGetToken(
      credentials.client_id,
      credentials.client_secret,
      deviceCode.device_code
    );

    await refresh();
  };

  const logout = async () => {
    await authApi.logout();
    setIsAuthenticated(false);
    setUser(null);
  };

  const authState: AuthState = {
    isAuthenticated,
    user,
    loading,
    login,
    loginOAuth,
    logout,
    refresh,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-rd-darker">
        <div className="text-zinc-400 text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={authState}>
      <BrowserRouter>
        <Routes>
          {!isAuthenticated ? (
            <>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="*" element={<Navigate to="/auth" replace />} />
            </>
          ) : (
            <>
              <Route element={<Layout />}>
                <Route path="/torrents" element={<TorrentsPage />} />
                <Route path="/downloads" element={<DownloadsPage />} />
                <Route path="/completed" element={<CompletedPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/torrents" replace />} />
              </Route>
            </>
          )}
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

export default App;
