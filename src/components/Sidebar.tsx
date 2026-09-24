import { useState, useEffect, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import { getActiveProvider } from "../api/providers";
import { check } from "@tauri-apps/plugin-updater";
import { providerName } from "../lib/providers";
import { cn, CountBadge, Kbd, Menu, StatusDot } from "./ui";

interface SidebarProps {
  activeView: string;
  onNavigate: (view: string) => void;
  onSearchOpen: () => void;
  onSettingsOpen: () => void;
  onAboutOpen: () => void;
  unreadWatchCount?: number;
}

type NavItem = { id: string; label: string; icon: ReactNode; onClick: () => void; badge?: number; kbd?: string };

const icon = (children: ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export default function Sidebar({
  activeView,
  onNavigate,
  onSearchOpen,
  onSettingsOpen,
  onAboutOpen,
  unreadWatchCount,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const { tasks } = useDownloadTasks();
  const [providerId, setProviderId] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  useEffect(() => {
    getActiveProvider().then(setProviderId).catch(() => {});
  }, []);

  // Check for updates on mount
  useEffect(() => {
    check().then((update) => {
      if (update) setUpdateAvailable(update.version);
    }).catch(() => {});
  }, []);

  const premiumDays = user?.expiration
    ? Math.ceil(
        (new Date(user.expiration).getTime() - Date.now()) / 86400000
      )
    : 0;

  const activeDownloads = tasks.filter((t) => t.status === "Downloading" || t.status === "Pending").length;

  const sections: { section: string; items: NavItem[] }[] = [
    {
      section: "Library",
      items: [
        {
          id: "torrents",
          label: "Torrents",
          kbd: "1",
          icon: icon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
          onClick: () => onNavigate("torrents"),
        },
        {
          id: "downloads",
          label: "Downloads",
          kbd: "2",
          badge: activeDownloads,
          icon: icon(<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
          onClick: () => onNavigate("downloads"),
        },
        {
          id: "completed",
          label: "Completed",
          kbd: "3",
          icon: icon(<polyline points="20 6 9 17 4 12" />),
          onClick: () => onNavigate("completed"),
        },
      ],
    },
    {
      section: "Find",
      items: [
        {
          id: "search",
          label: "Search",
          kbd: "Mod+K",
          icon: icon(<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>),
          onClick: onSearchOpen,
        },
        {
          id: "watchlist",
          label: "Watch List",
          kbd: "4",
          badge: unreadWatchCount ?? 0,
          icon: icon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>),
          onClick: () => onNavigate("watchlist"),
        },
      ],
    },
  ];

  const plan = user ? (user.premium ? "Premium" : "Free") : "";
  const accountLabel = [providerId ? providerName(providerId) : null, plan || null].filter(Boolean).join(" · ");

  return (
    <nav aria-label="Main" className="flex w-50 shrink-0 flex-col border-r border-border bg-surface px-2 py-2.5">
      <div className="flex-1 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.section}>
            <div className="px-2 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">{section.section}</div>
            {section.items.map((item) => {
              const active = item.id === activeView;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-6.5 w-full items-center gap-2 rounded-md px-2 text-base transition-colors duration-120",
                    active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg",
                  )}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="flex-1 truncate text-left">{item.label}</span>
                  {item.badge ? (
                    <CountBadge>{item.badge}</CountBadge>
                  ) : item.kbd ? (
                    // Key hints appear on hover/focus only; count badges above are always visible.
                    <span className="opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Kbd combo={item.kbd} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-border px-0 pt-2">
        <Menu
          trigger={
            <button
              type="button"
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-120 hover:bg-raised"
              aria-label={`Account: ${accountLabel || user?.username || "account"}`}
            >
              <span className="w-full truncate text-base font-medium text-fg">{accountLabel || user?.username}</span>
              <span className="text-sm text-fg-muted tabular">{premiumDays} days left</span>
              {updateAvailable && <StatusDot status="info"><span className="text-sm text-fg-secondary">Update {updateAvailable}</span></StatusDot>}
            </button>
          }
          items={[
            { label: "Settings", shortcut: "Mod+,", onSelect: onSettingsOpen },
            { label: "About & updates", onSelect: onAboutOpen },
            "separator",
            { label: "Sign out", danger: true, onSelect: () => { void logout(); } },
          ]}
        />
      </div>
    </nav>
  );
}
