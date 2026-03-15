import { useRef, useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  onSearchOpen: () => void;
  onSettingsOpen: () => void;
}

export default function Sidebar({
  activeView,
  onNavigate,
  onSearchOpen,
  onSettingsOpen,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        avatarRef.current &&
        !avatarRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [popoverOpen]);

  const premiumDays = user
    ? Math.ceil(
        (new Date(user.expiration).getTime() - Date.now()) / 86400000
      )
    : 0;

  const navItems = [
    {
      section: "Library",
      items: [
        {
          id: "torrents",
          label: "Torrents",
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          ),
          onClick: () => onNavigate("torrents"),
        },
        {
          id: "downloads",
          label: "Downloads",
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
          ),
          onClick: () => onNavigate("downloads"),
        },
        {
          id: "completed",
          label: "Completed",
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ),
          onClick: () => onNavigate("completed"),
        },
      ],
    },
    {
      section: "System",
      items: [
        {
          id: "search",
          label: "Search",
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          ),
          onClick: onSearchOpen,
        },
        {
          id: "settings",
          label: "Settings",
          icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ),
          onClick: onSettingsOpen,
        },
      ],
    },
  ];

  return (
    <aside
      className="w-[200px] h-full flex flex-col shrink-0"
      style={{
        backgroundColor: "var(--theme-bg-sidebar)",
        borderRight: "1px solid var(--theme-border)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--accent)cc)" }}
        >
          <span className="text-white font-bold text-[15px] leading-none">D</span>
        </div>
        <span className="text-[var(--theme-text-primary)] text-[15px] font-semibold">Debrid</span>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {navItems.map((section) => (
          <div key={section.section} className="mb-6">
            <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[1px] px-2 mb-2">
              {section.section}
            </div>
            {section.items.map((item) => {
              const isActive = item.id === activeView;
              return (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className="w-full flex items-center gap-2.5 rounded-lg text-left transition-colors duration-150 mb-0.5"
                  style={{
                    padding: "10px 12px",
                    fontSize: "14px",
                    fontWeight: isActive ? 500 : 400,
                    backgroundColor: isActive
                      ? "var(--accent-bg)0.08)"
                      : "transparent",
                    color: isActive ? "var(--accent)" : "var(--theme-text-muted)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "var(--theme-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "transparent";
                    }
                  }}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User section */}
      <div className="relative px-5 py-3.5 border-t border-[var(--theme-border-subtle)]">
        <button
          ref={avatarRef}
          onClick={() => setPopoverOpen((prev) => !prev)}
          className="flex items-center gap-2.5 w-full text-left"
        >
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user.username}
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-semibold"
              style={{
                backgroundColor: "rgba(16,185,129,0.15)",
                color: "#10b981",
                fontSize: "13px",
              }}
            >
              {user?.username?.charAt(0).toUpperCase() ?? "?"}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[14px] text-[var(--theme-text-primary)] font-medium truncate">
              {user?.username}
            </div>
            <div className="text-[12px] text-[var(--theme-text-muted)]">
              {premiumDays} days left
            </div>
          </div>
        </button>

        {popoverOpen && (
          <div
            ref={popoverRef}
            className="absolute rounded-lg p-4 w-48"
            style={{
              bottom: "100%",
              left: "12px",
              marginBottom: "8px",
              backgroundColor: "var(--theme-bg-surface)",
              border: "1px solid var(--theme-border)",
              zIndex: 50,
            }}
          >
            <p className="text-[15px] text-[var(--theme-text-primary)] font-medium truncate">
              {user?.username}
            </p>
            {user?.expiration && (
              <p className="text-[13px] text-[var(--theme-text-muted)]">
                Premium until{" "}
                {new Date(user.expiration).toLocaleDateString()}
              </p>
            )}
            <button
              onClick={async () => {
                setPopoverOpen(false);
                await logout();
              }}
              className="w-full text-left rounded-md px-2 py-2 mt-2 transition-colors duration-150 text-[14px] text-[#ef4444]"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "rgba(239,68,68,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  "transparent";
              }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
