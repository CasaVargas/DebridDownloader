import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { AuthContext, type AuthState } from "./hooks/useAuth";
import { useMagnetLinkListener } from "./hooks/useMagnetLinkListener";
import * as authApi from "./api/auth";
import * as torrentsApi from "./api/torrents";
import type { User } from "./types";

import { MiniPlayerProvider, useMiniPlayer } from "./contexts/MiniPlayerContext";
import MiniPlayer from "./components/MiniPlayer";
import Toast from "./components/Toast";
import Layout from "./components/Layout";
import AuthPage from "./pages/AuthPage";
import TorrentsPage from "./pages/TorrentsPage";
import DownloadsPage from "./pages/DownloadsPage";
import CompletedPage from "./pages/CompletedPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import AboutPage from "./pages/AboutPage";

const navigateRef: { current: ReturnType<typeof useNavigate> | null } = { current: null };

function NavigateRefSetter() {
  navigateRef.current = useNavigate();
  return null;
}

function MiniPlayerToast() {
  const { toastMessage, dismissToast } = useMiniPlayer();
  if (!toastMessage) return null;
  return <Toast message={toastMessage} onDismiss={dismissToast} />;
}

function MiniPlayerLogoutCleanup() {
  const auth = useContext(AuthContext);
  const { closePreview } = useMiniPlayer();
  const prevAuth = useRef(auth?.isAuthenticated);

  useEffect(() => {
    if (prevAuth.current && !auth?.isAuthenticated) {
      closePreview();
    }
    prevAuth.current = auth?.isAuthenticated;
  }, [auth?.isAuthenticated, closePreview]);

  return null;
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const clearCurrentUriRef = { current: () => {} };

  const handleMagnetLink = useCallback(
    (event: { uri: string; displayName: string | null }) => {
      torrentsApi.addMagnet(event.uri).then(async (response) => {
        clearCurrentUriRef.current();
        // Auto-select all files so the torrent starts processing immediately
        try {
          await torrentsApi.selectTorrentFiles(response.id, "all");
        } catch (e) {
          console.error("Failed to auto-select files:", e);
        }
        navigateRef.current?.("/torrents");
      }).catch((e) => {
        console.error("Failed to add magnet:", e);
      });
    },
    []
  );

  const { clearCurrentUri } = useMagnetLinkListener(
    handleMagnetLink,
    isAuthenticated
  );
  clearCurrentUriRef.current = clearCurrentUri;

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
      <div className="flex items-center justify-center h-screen bg-[var(--theme-bg)]">
        <div className="text-zinc-400 text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <MiniPlayerProvider>
      <AuthContext.Provider value={authState}>
        <BrowserRouter>
        <NavigateRefSetter />
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
                <Route path="/about" element={<AboutPage />} />
                <Route path="*" element={<Navigate to="/torrents" replace />} />
              </Route>
            </>
          )}
        </Routes>
        </BrowserRouter>
        <MiniPlayer />
        <MiniPlayerToast />
        <MiniPlayerLogoutCleanup />
      </AuthContext.Provider>
    </MiniPlayerProvider>
  );
}

export default App;
