import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Sidebar from "./Sidebar";
import { DownloadTasksProvider } from "../hooks/useDownloadTasks";

export default function Layout() {
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
    : "torrents";

  const handleNavigate = (view: string) => {
    navigate("/" + view);
  };

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
      <div className="flex h-screen overflow-hidden bg-[#08080f]">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          onSearchOpen={() => navigate("/search")}
          onSettingsOpen={() => navigate("/settings")}
        />
        <main className="flex-1 overflow-hidden flex flex-col" style={{ background: "#0a0a12" }}>
          <Outlet />
        </main>
      </div>
    </DownloadTasksProvider>
  );
}
