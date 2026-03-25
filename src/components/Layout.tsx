import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import Sidebar from "./Sidebar";
import Toast from "./Toast";
import { DownloadTasksProvider } from "../hooks/useDownloadTasks";
import { useAccentColor } from "../hooks/useAccentColor";
import type { WatchMatch } from "../types";

export default function Layout() {
  useAccentColor();
  const navigate = useNavigate();
  const location = useLocation();

  const activeView = location.pathname.startsWith("/downloads")
    ? "downloads"
    : location.pathname.startsWith("/completed")
    ? "completed"
    : location.pathname.startsWith("/search")
    ? "search"
    : location.pathname.startsWith("/settings")
    ? "settings"
    : location.pathname.startsWith("/about")
    ? "about"
    : location.pathname.startsWith("/watchlist")
    ? "watchlist"
    : "torrents";

  const handleNavigate = (view: string) => {
    navigate("/" + view);
  };

  const [unreadWatchCount, setUnreadWatchCount] = useState(0);
  const [watchToast, setWatchToast] = useState<string | null>(null);

  useEffect(() => {
    if (activeView === "watchlist") {
      setUnreadWatchCount(0);
      localStorage.setItem("last_visited_watchlist", new Date().toISOString());
    }
  }, [activeView]);

  useEffect(() => {
    const unlisten = listen<WatchMatch>("watchlist-match", async (event) => {
      const match = event.payload;
      const statusText = match.status.type === "Failed" ? " (failed)" : "";

      if (activeView !== "watchlist") {
        setUnreadWatchCount((c) => c + 1);
        setWatchToast(`Watch match: ${match.title}${statusText}`);
      }

      // Send native OS notification regardless of which page is active
      try {
        let permitted = await isPermissionGranted();
        if (!permitted) {
          permitted = (await requestPermission()) === "granted";
        }
        if (permitted) {
          sendNotification({
            title: "Watch List Match",
            body: `${match.title}${statusText}`,
          });
        }
      } catch {
        // Notification API unavailable — fall back to in-app toast only
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [activeView]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        navigate("/search");
        return;
      }

      if (e.metaKey && e.key === "r") {
        e.preventDefault();
        window.dispatchEvent(new Event("refresh-list"));
        return;
      }

      if (e.key === "Escape") {
        window.dispatchEvent(new Event("deselect-item"));
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !e.metaKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          window.dispatchEvent(new Event("delete-selected"));
        }
        return;
      }

      if (e.key === "Enter") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          window.dispatchEvent(new Event("action-selected"));
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <DownloadTasksProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--theme-bg)]">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          onSearchOpen={() => navigate("/search")}
          onSettingsOpen={() => navigate("/settings")}
          onAboutOpen={() => navigate("/about")}
          unreadWatchCount={unreadWatchCount}
        />
        <main className="flex-1 overflow-hidden flex flex-col" style={{ background: "var(--theme-bg-content)" }}>
          <Outlet />
        </main>
      </div>
      {watchToast && (
        <Toast
          message={watchToast}
          onDismiss={() => setWatchToast(null)}
        />
      )}
    </DownloadTasksProvider>
  );
}
