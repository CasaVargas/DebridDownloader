import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings, detectRarTool } from "../api/settings";
import { getTrackerConfigs, saveTrackerConfigs } from "../api/search";
import { getAvailableProviders, switchProvider, getActiveProvider } from "../api/providers";
import type { AppSettings, TrackerConfig, ProviderInfo } from "../types";
import { open } from "@tauri-apps/plugin-dialog";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { setMagnetHandler } from "../api/magnet";
import { ACCENT_COLORS } from "../hooks/useAccentColor";
import { useRclone, isRclonePath } from "../hooks/useRclone";
import { validateRcloneRemote } from "../api/rclone";

interface FrontendSettings {
  auto_start_downloads: boolean;
  launch_at_login: boolean;
  handle_magnet_links: boolean;
  accent_color: string;
  app_theme: string;
  default_sort_key: string;
  default_sort_direction: "asc" | "desc";
  notify_on_complete: boolean;
}

const DEFAULT_FRONTEND: FrontendSettings = {
  auto_start_downloads: false,
  launch_at_login: false,
  handle_magnet_links: false,
  accent_color: "emerald",
  app_theme: "dark",
  default_sort_key: "added",
  default_sort_direction: "desc",
  notify_on_complete: true,
};

function loadFrontendSettings(): FrontendSettings {
  try {
    const raw = localStorage.getItem("frontend-settings");
    if (raw) return { ...DEFAULT_FRONTEND, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_FRONTEND };
}

function saveFrontendSettings(s: FrontendSettings) {
  localStorage.setItem("frontend-settings", JSON.stringify(s));
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [frontend, setFrontend] = useState<FrontendSettings>(loadFrontendSettings);
  const [trackers, setTrackers] = useState<TrackerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedField, setSavedField] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState("real-debrid");
  const [switching, setSwitching] = useState(false);
  const { rcloneInfo, remotes, refreshRemotes } = useRclone();
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mountPath, setMountPath] = useState("");
  const [libraryPath, setLibraryPath] = useState("");
  const [moviesFolder, setMoviesFolder] = useState("");
  const [tvFolder, setTvFolder] = useState("");
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");
  const [jellyfinUrl, setJellyfinUrl] = useState("");
  const [jellyfinApiKey, setJellyfinApiKey] = useState("");
  const [embyUrl, setEmbyUrl] = useState("");
  const [embyApiKey, setEmbyApiKey] = useState("");
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [rarTool, setRarTool] = useState<string | null>(null);

  // Add tracker form
  const [newTrackerName, setNewTrackerName] = useState("");
  const [newTrackerUrl, setNewTrackerUrl] = useState("");
  const [newTrackerType, setNewTrackerType] = useState("piratebay_api");
  const [newTrackerApiKey, setNewTrackerApiKey] = useState("");

  // Load backend settings + autostart status + trackers
  useEffect(() => {
    Promise.all([
      getSettings(),
      isAutostartEnabled().catch(() => false),
      getTrackerConfigs().catch(() => [] as TrackerConfig[]),
    ]).then(([s, autostart, configs]) => {
      setSettings(s);
      setPathInput(s.download_folder ?? "");
      setMountPath(s.symlink_mount_path ?? "");
      setLibraryPath(s.symlink_library_path ?? "");
      setMoviesFolder(s.movies_folder ?? "");
      setTvFolder(s.tv_folder ?? "");
      setTmdbApiKey(s.tmdb_api_key ?? "");
      setPlexUrl(s.plex_url ?? "");
      setPlexToken(s.plex_token ?? "");
      setJellyfinUrl(s.jellyfin_url ?? "");
      setJellyfinApiKey(s.jellyfin_api_key ?? "");
      setEmbyUrl(s.emby_url ?? "");
      setEmbyApiKey(s.emby_api_key ?? "");
      setFrontend((prev) => ({ ...prev, launch_at_login: autostart }));
      setTrackers(configs);
    }).finally(() => setLoading(false));
    getAvailableProviders().then(setProviders).catch(() => {});
    getActiveProvider().then(setActiveProvider).catch(() => {});
    detectRarTool().then(setRarTool).catch(() => setRarTool(null));
  }, []);

  function markSaved(field: string) {
    setSavedField(field);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSavedField(null), 1500);
  }

  async function applyChange(patch: Partial<AppSettings>) {
    if (!settings) return;
    const next: AppSettings = { ...settings, ...patch };
    setSettings(next);
    await updateSettings(next);
  }

  function applyFrontend(patch: Partial<FrontendSettings>) {
    const next = { ...frontend, ...patch };
    setFrontend(next);
    saveFrontendSettings(next);
    if (patch.accent_color) {
      window.dispatchEvent(new Event("accent-changed"));
    }
    if (patch.app_theme) {
      window.dispatchEvent(new Event("theme-changed"));
    }
  }

  async function handleAddTracker() {
    if (!newTrackerName.trim() || !newTrackerUrl.trim()) return;
    let url = newTrackerUrl.trim().replace(/\/+$/, "");
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    if (newTrackerType === "torznab") {
      url = url.replace(/\/api\/?$/, "");
    }
    if (newTrackerType === "prowlarr") {
      url = url.replace(/\/api\/v1(?:\/search|\/health|\/indexer)?\/?$/, "");
    }
    if (newTrackerType === "piratebay_api") {
      url = url.replace(/\/q\.php.*$/, "");
    }
    url = url.replace(/\/+$/, "");
    const config: TrackerConfig = {
      id: crypto.randomUUID(),
      name: newTrackerName.trim(),
      url,
      tracker_type: newTrackerType,
      enabled: true,
      api_key: newTrackerApiKey.trim() || undefined,
    };
    const next = [...trackers, config];
    setTrackers(next);
    try {
      await saveTrackerConfigs(next);
      markSaved("trackers");
    } catch (e) {
      console.error("Failed to save tracker configs:", e);
    }
    setNewTrackerName("");
    setNewTrackerUrl("");
    setNewTrackerApiKey("");
  }

  async function handleRemoveTracker(id: string) {
    const next = trackers.filter((t) => t.id !== id);
    setTrackers(next);
    try {
      await saveTrackerConfigs(next);
      markSaved("trackers");
    } catch (e) {
      console.error("Failed to save tracker configs:", e);
    }
  }

  async function handleToggleTracker(id: string) {
    const next = trackers.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t);
    setTrackers(next);
    try {
      await saveTrackerConfigs(next);
    } catch (e) {
      console.error("Failed to save tracker configs:", e);
    }
  }

  async function handleSwitchProvider(id: string) {
    if (id === activeProvider) return;
    setSwitching(true);
    try {
      const previousProvider = activeProvider;
      const hasCredentials = await switchProvider(id);
      setActiveProvider(id);
      if (!hasCredentials) {
        localStorage.setItem("previous-provider", previousProvider);
        window.location.reload();
      }
    } catch (e) {
      console.error("Failed to switch provider:", e);
    } finally {
      setSwitching(false);
    }
  }

  async function handleBrowse() {
    const selected = await open({ directory: true, title: "Select download folder" });
    if (selected && typeof selected === "string") {
      handlePathSet(selected);
    }
  }

  async function handleBrowseMount() {
    const selected = await open({ directory: true, title: "Select mount path" });
    if (selected && typeof selected === "string") {
      setMountPath(selected);
      await applyChange({ symlink_mount_path: selected });
      markSaved("symlink_mount_path");
    }
  }

  async function handleBrowseLibrary() {
    const selected = await open({ directory: true, title: "Select library folder" });
    if (selected && typeof selected === "string") {
      setLibraryPath(selected);
      await applyChange({ symlink_library_path: selected });
      markSaved("symlink_library_path");
    }
  }

  async function handleBrowseMovies() {
    const selected = await open({ directory: true, title: "Select Movies folder" });
    if (selected && typeof selected === "string") {
      setMoviesFolder(selected);
      await applyChange({ movies_folder: selected });
      markSaved("movies_folder");
    }
  }

  async function handleBrowseTv() {
    const selected = await open({ directory: true, title: "Select TV folder" });
    if (selected && typeof selected === "string") {
      setTvFolder(selected);
      await applyChange({ tv_folder: selected });
      markSaved("tv_folder");
    }
  }

  async function handleTestServer(type: string, url: string, credential: string) {
    setTestResult((prev) => ({ ...prev, [type]: { ok: false, msg: "Testing..." } }));
    try {
      const { testMediaServer } = await import("../api/media_servers");
      const name = await testMediaServer(type, url, credential);
      setTestResult((prev) => ({ ...prev, [type]: { ok: true, msg: name } }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [type]: { ok: false, msg: String(e) } }));
    }
  }

  function handlePathInput(newPath: string) {
    setPathInput(newPath);
    setPathError(null);

    // Debounce: save + validate after 500ms of no typing
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    validateTimerRef.current = setTimeout(async () => {
      await applyChange({ download_folder: newPath || null });
      markSaved("download_folder");

      // Advisory validation for rclone paths
      if (isRclonePath(newPath)) {
        if (!rcloneInfo?.available) {
          setPathError("This looks like an rclone remote but rclone is not installed");
          return;
        }
        try {
          const remoteName = newPath.split(":")[0];
          const valid = await validateRcloneRemote(remoteName);
          if (!valid) {
            setPathError(`Remote "${remoteName}" not found in rclone config`);
          }
        } catch { /* ignore validation errors */ }
      }
    }, 500);
  }

  function handlePathSet(newPath: string) {
    // Immediate set (for browse button and remote clicks)
    setPathInput(newPath);
    setPathError(null);
    applyChange({ download_folder: newPath || null });
    markSaved("download_folder");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="w-6 h-6 border-2 border-[rgba(16,185,129,0.3)] border-t-[#10b981] rounded-full animate-spin" />
      </div>
    );
  }

  const accentColor = ACCENT_COLORS[frontend.accent_color]?.primary ?? "#10b981";

  return (
    <div className="flex-1 overflow-y-auto">
      <div style={{ paddingLeft: "60px", paddingRight: "120px", paddingTop: "40px", paddingBottom: "60px", maxWidth: "900px" }}>
        <h2 className="text-[24px] font-bold text-[var(--theme-text-primary)] tracking-[-0.3px] mb-2">
          Settings
        </h2>
        <p className="text-[14px] text-[var(--theme-text-muted)] mb-16">
          Configure downloads, behavior, and appearance
        </p>

        {settings && (
          <>
            {/* ── Debrid Provider ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Debrid Provider
              </h3>
              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Active Provider</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                  Select which debrid service to use
                </p>
                <div className="flex gap-4">
                  {providers.map((p) => {
                    const isSelected = activeProvider === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSwitchProvider(p.id)}
                        disabled={switching}
                        className="flex-1 flex items-center justify-center gap-3 py-4 rounded-xl transition-all text-[15px] font-medium cursor-pointer"
                        style={{
                          background: isSelected ? "var(--accent-bg-medium)" : "var(--theme-bg)",
                          border: isSelected ? "2px solid var(--accent)" : "2px solid var(--theme-border)",
                          color: isSelected ? "var(--accent)" : "var(--theme-text-muted)",
                          opacity: switching ? 0.5 : 1,
                        }}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ── Downloads ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Downloads
              </h3>

              {/* Download folder */}
              <div className="mb-12">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[15px] text-[var(--theme-text-primary)]">Download Folder</span>
                  {savedField === "download_folder" && (
                    <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                  )}
                </div>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                  Local path or rclone remote (e.g. gdrive:Media/Movies)
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg overflow-hidden">
                    <input
                      type="text"
                      value={pathInput}
                      onChange={(e) => handlePathInput(e.target.value)}
                      placeholder="Not set — you'll be asked each time"
                      className="flex-1 bg-transparent p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none min-w-0"
                    />
                    {isRclonePath(pathInput) && (
                      <svg className="w-5 h-5 shrink-0 mr-3" style={{ color: "var(--accent)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                      </svg>
                    )}
                  </div>
                  <button
                    onClick={handleBrowse}
                    className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                    style={{ padding: "0 28px" }}
                  >
                    Browse
                  </button>
                </div>
                {pathError && (
                  <p className="text-[#ef4444] text-[13px] mt-2">{pathError}</p>
                )}
              </div>

              {/* Max concurrent */}
              <div className="mb-12">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] text-[var(--theme-text-primary)]">Max Concurrent Downloads</span>
                  {savedField === "max_concurrent_downloads" && (
                    <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                  )}
                </div>
                <select
                  value={settings.max_concurrent_downloads}
                  onChange={async (e) => {
                    await applyChange({ max_concurrent_downloads: Number(e.target.value) });
                    markSaved("max_concurrent_downloads");
                  }}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] focus:outline-none transition-colors"
                >
                  {[1, 2, 3, 4, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} simultaneous download{n !== 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Speed limit */}
              <div className="mb-12">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] text-[var(--theme-text-primary)]">Speed Limit</span>
                  {savedField === "speed_limit_bytes" && (
                    <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                  )}
                </div>
                <select
                  value={settings.speed_limit_bytes ?? 0}
                  onChange={async (e) => {
                    const val = Number(e.target.value);
                    await applyChange({ speed_limit_bytes: val === 0 ? null : val });
                    markSaved("speed_limit_bytes");
                  }}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] focus:outline-none transition-colors"
                >
                  <option value={0}>Unlimited</option>
                  <option value={1048576}>1 MB/s</option>
                  <option value={5242880}>5 MB/s</option>
                  <option value={10485760}>10 MB/s</option>
                  <option value={26214400}>25 MB/s</option>
                  <option value={52428800}>50 MB/s</option>
                  <option value={104857600}>100 MB/s</option>
                </select>
              </div>

              {/* Subfolders toggle */}
              <ToggleRow
                label="Create subfolders per torrent"
                description="Organize downloads into folders named after each torrent"
                checked={settings.create_torrent_subfolders}
                saved={savedField === "create_torrent_subfolders"}
                accentColor={accentColor}
                onChange={async (v) => {
                  await applyChange({ create_torrent_subfolders: v });
                  markSaved("create_torrent_subfolders");
                }}
              />

              {/* Auto-start toggle */}
              <ToggleRow
                label="Auto-start downloads"
                description="Automatically download torrents when they finish processing on Real-Debrid"
                checked={frontend.auto_start_downloads}
                accentColor={accentColor}
                onChange={(v) => applyFrontend({ auto_start_downloads: v })}
              />

              {/* Auto-extract toggle */}
              <ToggleRow
                label="Auto-extract downloaded archives"
                description="After download, automatically unpack .rar / .zip / .7z / .tar.gz archives into a subfolder"
                checked={settings.auto_extract_archives ?? false}
                saved={savedField === "auto_extract_archives"}
                accentColor={accentColor}
                onChange={async (v) => {
                  await applyChange({ auto_extract_archives: v });
                  markSaved("auto_extract_archives");
                }}
              />

              {/* Delete-after-extract toggle */}
              <div className={settings.auto_extract_archives ? undefined : "opacity-40 pointer-events-none"}>
                <ToggleRow
                  label="Delete archive files after successful extract"
                  description="Remove the original .rar / .zip / .7z parts once extraction completes"
                  checked={settings.delete_archives_after_extract ?? false}
                  saved={savedField === "delete_archives_after_extract"}
                  accentColor={accentColor}
                  onChange={async (v) => {
                    await applyChange({ delete_archives_after_extract: v });
                    markSaved("delete_archives_after_extract");
                  }}
                />
              </div>

              {/* RAR tool detection status */}
              <p className="text-[13px] -mt-6 mb-12" style={{ color: rarTool ? "#10b981" : "#f59e0b" }}>
                {rarTool
                  ? `\u2713 RAR support: ${rarTool} detected`
                  : "\u26a0 RAR support: install 7-Zip (macOS/Windows), p7zip-full (Linux), or unar to extract .rar archives"}
              </p>
            </section>

            {/* ── Media Library ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Media Library
              </h3>

              <ToggleRow
                label="Auto-organize media"
                description="Sort downloads into Movies and TV folder structures using TMDb metadata"
                checked={settings.auto_organize ?? false}
                saved={savedField === "auto_organize"}
                accentColor={accentColor}
                onChange={async (v) => {
                  await applyChange({ auto_organize: v });
                  markSaved("auto_organize");
                }}
              />

              {settings.auto_organize && (
                <>
                  <div className="mb-12">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">Movies Folder</span>
                      {savedField === "movies_folder" && <span style={{ color: accentColor }} className="text-[13px]">Saved</span>}
                    </div>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">Movies are organized as: Movie Name (Year)/filename</p>
                    <div className="flex items-center gap-3">
                      <input type="text" value={moviesFolder}
                        onChange={(e) => { setMoviesFolder(e.target.value); applyChange({ movies_folder: e.target.value || null }); }}
                        placeholder="/media/Movies"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors min-w-0"
                      />
                      <button onClick={handleBrowseMovies}
                        className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                        style={{ padding: "0 28px" }}>Browse</button>
                    </div>
                  </div>

                  <div className="mb-12">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">TV Folder</span>
                      {savedField === "tv_folder" && <span style={{ color: accentColor }} className="text-[13px]">Saved</span>}
                    </div>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">TV shows are organized as: Show Name/Season XX/filename</p>
                    <div className="flex items-center gap-3">
                      <input type="text" value={tvFolder}
                        onChange={(e) => { setTvFolder(e.target.value); applyChange({ tv_folder: e.target.value || null }); }}
                        placeholder="/media/TV"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors min-w-0"
                      />
                      <button onClick={handleBrowseTv}
                        className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                        style={{ padding: "0 28px" }}>Browse</button>
                    </div>
                  </div>

                  <div className="mb-12">
                    <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">TMDb API Key</span>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">Optional — using default key. Get your own from themoviedb.org</p>
                    <input type="text" value={tmdbApiKey}
                      onChange={(e) => { setTmdbApiKey(e.target.value); applyChange({ tmdb_api_key: e.target.value || null }); }}
                      placeholder="Using default key"
                      className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                  </div>

                  {(!moviesFolder || !tvFolder) && (
                    <div className="p-4 rounded-xl mb-12" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                      <p className="text-[13px] text-[#f59e0b]">Both Movies and TV folders must be configured for auto-organize to work</p>
                    </div>
                  )}

                  {settings.symlink_mode && (
                    <div className="p-4 rounded-xl mb-12" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
                      <p className="text-[13px] text-[#3b82f6]">Symlink mode active — files will be symlinked to these folders instead of the library folder</p>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── rclone ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Remote Downloads
              </h3>
              {rcloneInfo?.available ? (
                <>
                  <div className="mb-12">
                    <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">rclone</span>
                    <p className="text-[14px] text-[var(--theme-text-muted)]">
                      {rcloneInfo.version} — download directly to cloud storage without using local disk
                    </p>
                  </div>

                  <div className="mb-12">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">Your Remotes</span>
                      <button
                        onClick={refreshRemotes}
                        className="text-[13px] font-medium transition-colors"
                        style={{ color: "var(--accent)" }}
                      >
                        {remotes.length > 0 ? "Refresh" : "Load Remotes"}
                      </button>
                    </div>
                    {remotes.length > 0 ? (
                      <div className="space-y-2">
                        {remotes.map((remote) => (
                          <button
                            key={remote}
                            onClick={() => handlePathSet(remote)}
                            className="w-full flex items-center gap-3 p-4 rounded-xl transition-all text-left"
                            style={{
                              background: "var(--theme-bg)",
                              border: pathInput === remote ? `2px solid var(--accent)` : "2px solid var(--theme-border)",
                            }}
                            onMouseEnter={(e) => {
                              if (pathInput !== remote) (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border-hover)";
                            }}
                            onMouseLeave={(e) => {
                              if (pathInput !== remote) (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border)";
                            }}
                          >
                            <svg className="w-5 h-5 shrink-0" style={{ color: pathInput === remote ? "var(--accent)" : "var(--theme-text-muted)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                            </svg>
                            <span
                              className="text-[15px] font-medium"
                              style={{ color: pathInput === remote ? "var(--accent)" : "var(--theme-text-primary)" }}
                            >
                              {remote}
                            </span>
                            {pathInput === remote && (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0" style={{ color: "var(--accent)" }}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-5 rounded-xl text-center" style={{ background: "var(--theme-bg)", border: "1px dashed var(--theme-border)" }}>
                        <p className="text-[14px] text-[var(--theme-text-muted)]">Click "Load Remotes" to see your configured rclone remotes</p>
                        <p className="text-[13px] text-[var(--theme-text-ghost)] mt-1">Set up remotes with <code className="px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>rclone config</code> in your terminal</p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="mb-12">
                  <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">rclone</span>
                  <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                    Stream downloads directly to Google Drive, OneDrive, S3, or any cloud storage — no local disk needed
                  </p>
                  <div className="p-5 rounded-xl" style={{ background: "var(--theme-bg)", border: "1px dashed var(--theme-border)" }}>
                    <p className="text-[14px] text-[var(--theme-text-muted)]">
                      rclone not detected — install from{" "}
                      <a
                        href="https://rclone.org/install/"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "underline" }}
                      >
                        rclone.org
                      </a>
                      {" "}to enable remote downloads
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* ── Symlink Mode ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Symlink Mode
              </h3>

              <ToggleRow
                label="Create symlinks instead of downloading"
                description="Link files from your debrid mount to your media library — zero transfer, instant availability"
                checked={settings.symlink_mode ?? false}
                saved={savedField === "symlink_mode"}
                accentColor={accentColor}
                onChange={async (v) => {
                  await applyChange({ symlink_mode: v });
                  markSaved("symlink_mode");
                }}
              />

              {settings.symlink_mode && (
                <>
                  {/* Mount Path */}
                  <div className="mb-12">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">Mount Path</span>
                      {savedField === "symlink_mount_path" && (
                        <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                      )}
                    </div>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                      Where your debrid files appear on the rclone mount
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={mountPath}
                        onChange={(e) => {
                          setMountPath(e.target.value);
                          applyChange({ symlink_mount_path: e.target.value || null });
                        }}
                        placeholder="/Volumes/realdebrid/torrents"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors min-w-0"
                      />
                      <button
                        onClick={handleBrowseMount}
                        className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                        style={{ padding: "0 28px" }}
                      >
                        Browse
                      </button>
                    </div>
                  </div>

                  {/* Library Folder */}
                  <div className="mb-12">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[15px] text-[var(--theme-text-primary)]">Library Folder</span>
                      {savedField === "symlink_library_path" && (
                        <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                      )}
                    </div>
                    <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                      Where Plex/Jellyfin scans for media
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={libraryPath}
                        onChange={(e) => {
                          setLibraryPath(e.target.value);
                          applyChange({ symlink_library_path: e.target.value || null });
                        }}
                        placeholder="/media/Movies"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors min-w-0"
                      />
                      <button
                        onClick={handleBrowseLibrary}
                        className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 self-stretch"
                        style={{ padding: "0 28px" }}
                      >
                        Browse
                      </button>
                    </div>
                  </div>

                  {/* Warning if paths not set */}
                  {(!mountPath || !libraryPath) && (
                    <div className="p-4 rounded-xl mb-12" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
                      <p className="text-[13px] text-[#f59e0b]">
                        Both mount path and library folder must be configured for symlink mode to work
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── Media Servers ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Media Servers
              </h3>

              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Plex</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">Trigger library scan after downloads complete</p>
                <div className="flex flex-col gap-3">
                  <input type="text" value={plexUrl}
                    onChange={(e) => { setPlexUrl(e.target.value); applyChange({ plex_url: e.target.value || null }); }}
                    placeholder="http://localhost:32400"
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                  />
                  <div className="flex gap-3">
                    <input type="text" value={plexToken}
                      onChange={(e) => { setPlexToken(e.target.value); applyChange({ plex_token: e.target.value || null }); }}
                      placeholder="X-Plex-Token"
                      className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                    <button onClick={() => handleTestServer("plex", plexUrl, plexToken)}
                      disabled={!plexUrl || !plexToken}
                      className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 disabled:opacity-30"
                      style={{ padding: "0 20px" }}>Test</button>
                  </div>
                  {testResult.plex && (
                    <p className={`text-[13px] ${testResult.plex.ok ? "text-[var(--accent)]" : "text-[#ef4444]"}`}>{testResult.plex.msg}</p>
                  )}
                </div>
              </div>

              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Jellyfin</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">Trigger library scan after downloads complete</p>
                <div className="flex flex-col gap-3">
                  <input type="text" value={jellyfinUrl}
                    onChange={(e) => { setJellyfinUrl(e.target.value); applyChange({ jellyfin_url: e.target.value || null }); }}
                    placeholder="http://localhost:8096"
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                  />
                  <div className="flex gap-3">
                    <input type="text" value={jellyfinApiKey}
                      onChange={(e) => { setJellyfinApiKey(e.target.value); applyChange({ jellyfin_api_key: e.target.value || null }); }}
                      placeholder="API Key"
                      className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                    <button onClick={() => handleTestServer("jellyfin", jellyfinUrl, jellyfinApiKey)}
                      disabled={!jellyfinUrl || !jellyfinApiKey}
                      className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 disabled:opacity-30"
                      style={{ padding: "0 20px" }}>Test</button>
                  </div>
                  {testResult.jellyfin && (
                    <p className={`text-[13px] ${testResult.jellyfin.ok ? "text-[var(--accent)]" : "text-[#ef4444]"}`}>{testResult.jellyfin.msg}</p>
                  )}
                </div>
              </div>

              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Emby</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">Trigger library scan after downloads complete</p>
                <div className="flex flex-col gap-3">
                  <input type="text" value={embyUrl}
                    onChange={(e) => { setEmbyUrl(e.target.value); applyChange({ emby_url: e.target.value || null }); }}
                    placeholder="http://localhost:8096"
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                  />
                  <div className="flex gap-3">
                    <input type="text" value={embyApiKey}
                      onChange={(e) => { setEmbyApiKey(e.target.value); applyChange({ emby_api_key: e.target.value || null }); }}
                      placeholder="API Key"
                      className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                    <button onClick={() => handleTestServer("emby", embyUrl, embyApiKey)}
                      disabled={!embyUrl || !embyApiKey}
                      className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors shrink-0 disabled:opacity-30"
                      style={{ padding: "0 20px" }}>Test</button>
                  </div>
                  {testResult.emby && (
                    <p className={`text-[13px] ${testResult.emby.ok ? "text-[var(--accent)]" : "text-[#ef4444]"}`}>{testResult.emby.msg}</p>
                  )}
                </div>
              </div>
            </section>

            {/* ── Trackers ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Trackers
                {savedField === "trackers" && <span style={{ color: accentColor }} className="ml-2 normal-case tracking-normal">Saved</span>}
              </h3>

              {/* Existing trackers */}
              {trackers.length > 0 && (
                <div className="mb-12 space-y-3">
                  {trackers.map((tracker) => (
                    <div
                      key={tracker.id}
                      className="flex items-center gap-4 p-4 rounded-xl border"
                      style={{
                        background: "var(--theme-bg)",
                        borderColor: tracker.enabled ? "var(--theme-border)" : "var(--theme-border-subtle)",
                        opacity: tracker.enabled ? 1 : 0.5,
                      }}
                    >
                      <button
                        onClick={() => handleToggleTracker(tracker.id)}
                        className="shrink-0 w-10 h-6 rounded-full transition-colors duration-200 relative"
                        style={{ backgroundColor: tracker.enabled ? accentColor : "var(--theme-border)" }}
                      >
                        <div
                          className="w-[18px] h-[18px] rounded-full bg-white absolute transition-all duration-200"
                          style={{
                            top: "3px",
                            left: tracker.enabled ? "21px" : "3px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                          }}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] text-[var(--theme-text-primary)] font-medium">{tracker.name}</div>
                        <div className="text-[13px] text-[var(--theme-text-muted)] truncate">{tracker.url}</div>
                      </div>
                      <span className="text-[12px] text-[var(--theme-text-ghost)] shrink-0 px-2 py-1 rounded-md" style={{ background: "var(--theme-selected)" }}>
                        {tracker.tracker_type === "piratebay_api" ? "API" : tracker.tracker_type === "torznab" ? "Torznab" : tracker.tracker_type === "prowlarr" ? "Prowlarr" : tracker.tracker_type}
                      </span>
                      <button
                        onClick={() => handleRemoveTracker(tracker.id)}
                        className="shrink-0 text-[#ef4444] text-[13px] px-5 py-2.5 rounded-lg transition-colors"
                        style={{ background: "rgba(239,68,68,0.06)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.06)"; }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {trackers.length === 0 && (
                <div className="mb-12 p-6 rounded-xl text-center" style={{ background: "var(--theme-bg)", border: "1px dashed var(--theme-border)" }}>
                  <p className="text-[15px] text-[var(--theme-text-muted)]">No trackers configured</p>
                  <p className="text-[14px] text-[var(--theme-text-ghost)] mt-1">Add a tracker below to enable search</p>
                </div>
              )}

              {/* Add new tracker */}
              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Add Tracker</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-5">
                  {newTrackerType === "torznab"
                    ? "Connect to a Torznab-compatible indexer (Prowlarr, Jackett)"
                    : newTrackerType === "prowlarr"
                    ? "Connect to Prowlarr to search all configured indexers"
                    : "Connect to a site with a TPB-compatible JSON API"}
                </p>

                <div className="flex flex-col gap-3">
                  {/* Row 1: Name + Type */}
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newTrackerName}
                      onChange={(e) => setNewTrackerName(e.target.value)}
                      placeholder="Tracker name"
                      className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                    />
                    <select
                      value={newTrackerType}
                      onChange={(e) => setNewTrackerType(e.target.value)}
                      className="w-[200px] bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                    >
                      <option value="piratebay_api">API (TPB-style)</option>
                      <option value="torznab">Torznab</option>
                      <option value="prowlarr">Prowlarr</option>
                    </select>
                  </div>

                  {/* Row 2: URL */}
                  <input
                    type="text"
                    value={newTrackerUrl}
                    onChange={(e) => setNewTrackerUrl(e.target.value)}
                    placeholder={newTrackerType === "prowlarr" ? "http://localhost:9696" : newTrackerType === "torznab" ? "http://localhost:9696/1/api" : "https://example.org"}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                  />

                  {/* Row 3: API Key (if needed) */}
                  {(newTrackerType === "torznab" || newTrackerType === "prowlarr" || newTrackerApiKey) && (
                    <input
                      type="text"
                      value={newTrackerApiKey}
                      onChange={(e) => setNewTrackerApiKey(e.target.value)}
                      placeholder={newTrackerType === "torznab" ? "API Key (required)" : "API Key (optional)"}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
                      className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                  )}

                  {newTrackerType === "torznab" && !newTrackerApiKey.trim() && (
                    <p className="text-[13px] text-[#f59e0b]">Torznab trackers require an API key</p>
                  )}

                  {/* Add button */}
                  <button
                    onClick={handleAddTracker}
                    disabled={!newTrackerName.trim() || !newTrackerUrl.trim()}
                    className="w-full rounded-lg text-white text-[15px] font-medium disabled:opacity-30 transition-colors py-4"
                    style={{ background: "var(--accent)" }}
                  >
                    Add Tracker
                  </button>
                </div>
              </div>
            </section>

            {/* ── Behavior ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Behavior
              </h3>

              {/* Launch at login */}
              <ToggleRow
                label="Launch at login"
                description="Start DebridDownloader when you log in to your computer"
                checked={frontend.launch_at_login}
                accentColor={accentColor}
                onChange={async (v) => {
                  try {
                    if (v) await enableAutostart();
                    else await disableAutostart();
                    applyFrontend({ launch_at_login: v });
                  } catch (e) {
                    console.error("Autostart error:", e);
                  }
                }}
              />

              {/* Handle magnet links */}
              <ToggleRow
                label="Set as default magnet link handler"
                description="Open magnet links from your browser directly in DebridDownloader"
                checked={frontend.handle_magnet_links}
                accentColor={accentColor}
                onChange={async (v) => {
                  try {
                    await setMagnetHandler(v);
                    applyFrontend({ handle_magnet_links: v });
                  } catch (e) {
                    console.error("Failed to set magnet handler:", e);
                  }
                }}
              />

              {/* Notify on complete */}
              <ToggleRow
                label="Notify when download completes"
                description="Show a system notification when a file finishes downloading"
                checked={frontend.notify_on_complete}
                accentColor={accentColor}
                onChange={(v) => applyFrontend({ notify_on_complete: v })}
              />

              {/* Default sort */}
              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Default sort order</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                  How torrents are sorted when you open the app
                </p>
                <div className="flex gap-4">
                  <select
                    value={frontend.default_sort_key}
                    onChange={(e) => applyFrontend({ default_sort_key: e.target.value })}
                    className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] focus:outline-none transition-colors"
                  >
                    <option value="added">Date Added</option>
                    <option value="filename">Name</option>
                    <option value="bytes">Size</option>
                  </select>
                  <select
                    value={frontend.default_sort_direction}
                    onChange={(e) => applyFrontend({ default_sort_direction: e.target.value as "asc" | "desc" })}
                    className="w-[180px] bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] text-[var(--theme-text-primary)] focus:outline-none transition-colors"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
              </div>
            </section>

            {/* ── Appearance ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Appearance
              </h3>

              {/* Theme mode */}
              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Theme</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-5">
                  Choose between dark and light appearance
                </p>
                <div className="flex gap-4">
                  {[
                    { id: "dark", label: "Dark" },
                    { id: "light", label: "Light" },
                  ].map((opt) => {
                    const isSelected = frontend.app_theme === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => applyFrontend({ app_theme: opt.id })}
                        className="flex-1 flex items-center justify-center gap-3 py-4 rounded-xl transition-all text-[15px] font-medium"
                        style={{
                          background: isSelected ? "var(--accent-bg-medium)" : "var(--theme-bg)",
                          border: isSelected ? `2px solid var(--accent)` : "2px solid var(--theme-border)",
                          color: isSelected ? "var(--accent)" : "var(--theme-text-muted)",
                        }}
                      >
                        {opt.id === "dark" ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5" />
                            <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                          </svg>
                        )}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Accent Color</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-5">
                  Highlight color used for active states and buttons
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: "emerald", label: "Emerald" },
                    { id: "blue", label: "Blue" },
                    { id: "violet", label: "Violet" },
                    { id: "rose", label: "Rose" },
                    { id: "amber", label: "Amber" },
                    { id: "cyan", label: "Cyan" },
                  ].map((opt) => {
                    const color = ACCENT_COLORS[opt.id]?.primary ?? "#10b981";
                    const isSelected = frontend.accent_color === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => applyFrontend({ accent_color: opt.id })}
                        className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all"
                        style={{
                          background: isSelected ? "var(--theme-bg)" : "transparent",
                          border: isSelected ? `2px solid ${color}` : "2px solid var(--theme-border)",
                        }}
                      >
                        <div
                          className="w-5 h-5 rounded-full shrink-0 transition-shadow"
                          style={{
                            background: color,
                            boxShadow: isSelected ? `0 0 12px ${color}60` : "none",
                          }}
                        />
                        <span
                          className="text-[14px] font-medium"
                          style={{ color: isSelected ? "var(--theme-text-primary)" : "var(--theme-text-muted)" }}
                        >
                          {opt.label}
                        </span>
                        {isSelected && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ── Backup & Restore ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Backup & Restore
              </h3>

              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Export Settings</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                  Save all settings, trackers, and watch rules to a file
                </p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={async () => {
                      try {
                        const { save } = await import("@tauri-apps/plugin-dialog");
                        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
                        const { exportSettings } = await import("../api/backup");
                        const includeKeys = (document.getElementById("include-credentials") as HTMLInputElement)?.checked ?? false;
                        const frontendJson = localStorage.getItem("frontend-settings") ?? "{}";
                        const json = await exportSettings(includeKeys, frontendJson);
                        const path = await save({
                          defaultPath: "debrid-settings.json",
                          filters: [{ name: "Settings", extensions: ["json"] }],
                        });
                        if (path) {
                          await writeTextFile(path, json);
                        }
                      } catch (e) {
                        console.error("Export failed:", e);
                      }
                    }}
                    className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors"
                    style={{ padding: "10px 24px" }}
                  >
                    Export
                  </button>
                  <label className="flex items-center gap-2 text-[14px] text-[var(--theme-text-muted)] cursor-pointer">
                    <input type="checkbox" id="include-credentials" className="rounded" />
                    Include API keys and tokens
                  </label>
                </div>
              </div>

              <div className="mb-12">
                <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Import Settings</span>
                <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                  Restore settings from a previously exported file
                </p>
                <button
                  onClick={async () => {
                    try {
                      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
                      const { readTextFile } = await import("@tauri-apps/plugin-fs");
                      const { importSettings } = await import("../api/backup");
                      const path = await openDialog({
                        filters: [{ name: "Settings", extensions: ["json"] }],
                      });
                      if (!path || typeof path !== "string") return;
                      const json = await readTextFile(path);
                      const result = await importSettings(json);
                      if (result.frontend_settings) {
                        localStorage.setItem("frontend-settings", result.frontend_settings);
                      }
                      window.location.reload();
                    } catch (e) {
                      console.error("Import failed:", e);
                    }
                  }}
                  className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors"
                  style={{ padding: "10px 24px" }}
                >
                  Import
                </button>
              </div>
            </section>

          </>
        )}

        {!settings && !loading && (
          <div className="text-[#ef4444] text-[15px]">Failed to load settings.</div>
        )}
      </div>
    </div>
  );
}

/* ── Toggle Row Component ── */

function ToggleRow({
  label,
  description,
  checked,
  saved,
  accentColor,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  saved?: boolean;
  accentColor: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="mb-12 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-[var(--theme-text-primary)]">{label}</span>
          {saved && <span style={{ color: accentColor }} className="text-[13px]">Saved</span>}
        </div>
        <p className="text-[14px] text-[var(--theme-text-muted)] mt-1">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="shrink-0 mt-0.5 w-12 h-7 rounded-full transition-colors duration-200 relative"
        style={{
          backgroundColor: checked ? accentColor : "var(--theme-border)",
        }}
      >
        <div
          className="w-[22px] h-[22px] rounded-full bg-white absolute transition-all duration-200"
          style={{
            top: "3px",
            left: checked ? "25px" : "3px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </button>
    </div>
  );
}
