import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import Sidebar from "./Sidebar";
import Toast from "./Toast";
import { DownloadTasksProvider } from "../hooks/useDownloadTasks";
import { useAppearance } from "../hooks/useAppearance";
import { useShortcut } from "../hooks/useShortcut";
import type { WatchMatch } from "../types";

export default function Layout() {
  useAppearance();
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

  const go = (path: string) => () => navigate(path);
  const fire = (name: string) => () => window.dispatchEvent(new Event(name));
  useShortcut("1", go("/torrents"));
  useShortcut("2", go("/downloads"));
  useShortcut("3", go("/completed"));
  useShortcut("4", go("/watchlist"));
  useShortcut("Mod+K", go("/search"));
  useShortcut("Mod+,", go("/settings"));
  useShortcut("Mod+N", fire("open-add-torrent"));
  useShortcut("Mod+R", fire("refresh-list"));
  useShortcut("Mod+I", fire("toggle-inspector"));
  useShortcut("/", fire("focus-filter"));
  // Esc inside an open menu/dialog closes that layer only (Radix handles it), not the selection.
  useShortcut("Escape", (e) => {
    if (e.target instanceof Element && e.target.closest('[role="menu"],[role="dialog"],[role="listbox"]')) return;
    fire("deselect-item")();
  }, { allowInInputs: true });
  useShortcut(["Delete", "Backspace"], fire("delete-selected"));
  useShortcut("Enter", fire("action-selected"));
  useShortcut("Space", fire("toggle-selected"));
  useShortcut("ArrowDown", fire("select-next"));
  useShortcut("ArrowUp", fire("select-prev"));

  return (
    <DownloadTasksProvider>
      <div className="flex h-screen overflow-hidden bg-bg text-fg">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          onSearchOpen={() => navigate("/search")}
          onSettingsOpen={() => navigate("/settings")}
          onAboutOpen={() => navigate("/about")}
          unreadWatchCount={unreadWatchCount}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
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
