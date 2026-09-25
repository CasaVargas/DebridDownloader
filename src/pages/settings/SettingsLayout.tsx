import { NavLink, Navigate, Outlet, Route, useParams } from "react-router-dom";
import { cn, Spinner } from "../../components/ui";
import { SettingsProvider, useSettings } from "./useSettings";
import GeneralSettings from "./GeneralSettings";
import AccountSettings from "./AccountSettings";
import DownloadsSettings from "./DownloadsSettings";
import LibrarySettings from "./LibrarySettings";
import SearchSettings from "./SearchSettings";
import BackupSettings from "./BackupSettings";

export const SETTINGS_SECTIONS = [
  { id: "general", label: "General", el: <GeneralSettings /> },
  { id: "account", label: "Account", el: <AccountSettings /> },
  { id: "downloads", label: "Downloads", el: <DownloadsSettings /> },
  { id: "library", label: "Library", el: <LibrarySettings /> },
  { id: "search", label: "Search", el: <SearchSettings /> },
  { id: "backup", label: "About & Backup", el: <BackupSettings /> },
] as const;

function Section() {
  const { section } = useParams();
  const { loading } = useSettings();
  const found = SETTINGS_SECTIONS.find((s) => s.id === section);
  if (!found) return <Navigate to="/settings/general" replace />;
  if (loading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-160 px-6 py-5">
        <h1 className="mb-4 text-lg font-semibold text-fg">{found.label}</h1>
        {found.el}
      </div>
    </div>
  );
}

function SettingsLayout() {
  return (
    <SettingsProvider>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="w-44 shrink-0 border-r border-border px-2 py-3">
          {SETTINGS_SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              to={`/settings/${s.id}`}
              className={({ isActive }) =>
                cn("flex h-6.5 items-center rounded-md px-2 text-base", isActive ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg")
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </SettingsProvider>
  );
}

/** Route elements to place inside the authenticated <Route element={<Layout/>}>. */
export const settingsRoutes = (
  <>
    <Route path="/settings" element={<SettingsLayout />}>
      <Route index element={<Navigate to="/settings/general" replace />} />
      <Route path=":section" element={<Section />} />
    </Route>
    <Route path="/about" element={<Navigate to="/settings/backup" replace />} />
  </>
);
