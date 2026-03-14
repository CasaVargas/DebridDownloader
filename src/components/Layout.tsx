import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import IconRail from "./IconRail";
import CommandPalette from "./CommandPalette";
import SettingsModal from "./SettingsModal";

export default function Layout() {
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const activeView = location.pathname.startsWith("/downloads")
    ? "downloads"
    : "torrents";

  const handleViewChange = (view: string) => {
    navigate("/" + view);
  };

  const handleSelectTorrent = (id: string) => {
    navigate("/torrents");
    window.dispatchEvent(new CustomEvent("torrent-select", { detail: id }));
    setShowSearch(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
        return;
      }

      if (e.metaKey && e.key === "r") {
        e.preventDefault();
        window.dispatchEvent(new Event("refresh-list"));
        return;
      }

      if (e.key === "Escape") {
        if (showSearch) {
          setShowSearch(false);
        } else if (showSettings) {
          setShowSettings(false);
        } else {
          window.dispatchEvent(new Event("deselect-item"));
        }
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
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSearch, showSettings]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#08080f]">
      <IconRail
        activeView={activeView}
        onViewChange={handleViewChange}
        onSearchOpen={() => setShowSearch(true)}
        onSettingsOpen={() => setShowSettings(true)}
      />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      {showSearch && (
        <CommandPalette
          onClose={() => setShowSearch(false)}
          onSelectTorrent={handleSelectTorrent}
        />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
