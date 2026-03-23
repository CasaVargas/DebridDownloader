import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings } from "../api/settings";
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
      setFrontend((prev) => ({ ...prev, launch_at_login: autostart }));
      setTrackers(configs);
    }).finally(() => setLoading(false));
    getAvailableProviders().then(setProviders).catch(() => {});
    getActiveProvider().then(setActiveProvider).catch(() => {});
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
      await applyChange({ download_folder: selected });
      markSaved("download_folder");
    }
  }

  async function handlePathChange(newPath: string) {
    setPathError(null);
    if (isRclonePath(newPath)) {
      if (!rcloneInfo?.available) {
        setPathError("This looks like an rclone remote but rclone is not installed");
        return;
      }
      const remoteName = newPath.split(":")[0];
      const valid = await validateRcloneRemote(remoteName);
      if (!valid) {
        setPathError(`Remote "${remoteName}" not found in rclone config`);
        return;
      }
    }
    await applyChange({ download_folder: newPath || null });
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
                      value={settings.download_folder ?? ""}
                      onChange={(e) => handlePathChange(e.target.value)}
                      placeholder="Not set — you'll be asked each time"
                      className="flex-1 bg-transparent p-4 text-[15px] text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-ghost)] outline-none min-w-0"
                    />
                    {isRclonePath(settings.download_folder ?? "") && (
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
            </section>

            {/* ── rclone ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                rclone
              </h3>
              {rcloneInfo?.available ? (
                <div className="mb-12">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[15px] text-[var(--theme-text-primary)]">Status</span>
                    <span className="text-[13px]" style={{ color: accentColor }}>Detected</span>
                  </div>
                  <p className="text-[14px] text-[var(--theme-text-muted)] mb-4">
                    {rcloneInfo.version}
                  </p>
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={refreshRemotes}
                      className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg text-[14px] font-medium transition-colors"
                      style={{ padding: "10px 20px" }}
                    >
                      List Remotes
                    </button>
                  </div>
                  {remotes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {remotes.map((remote) => (
                        <button
                          key={remote}
                          onClick={() => handlePathChange(remote)}
                          className="text-[13px] px-3 py-1.5 rounded-lg transition-colors"
                          style={{
                            background: "var(--theme-bg)",
                            border: "1px solid var(--theme-border)",
                            color: "var(--theme-text-secondary)",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
                            (e.currentTarget as HTMLElement).style.color = "var(--accent)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border)";
                            (e.currentTarget as HTMLElement).style.color = "var(--theme-text-secondary)";
                          }}
                        >
                          {remote}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-12">
                  <span className="text-[15px] text-[var(--theme-text-primary)] block mb-1.5">Status</span>
                  <p className="text-[14px] text-[var(--theme-text-muted)]">
                    rclone not installed — install from{" "}
                    <a
                      href="https://rclone.org"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent)", textDecoration: "underline" }}
                    >
                      rclone.org
                    </a>
                    {" "}to enable remote downloads
                  </p>
                </div>
              )}
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
              <div className="p-5 rounded-xl" style={{ background: "var(--theme-bg)", border: "1px solid var(--theme-border)" }}>
                <div className="text-[14px] text-[var(--theme-text-primary)] font-medium mb-4">Add Tracker</div>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newTrackerName}
                      onChange={(e) => setNewTrackerName(e.target.value)}
                      placeholder="Tracker name"
                      className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                    />
                    <select
                      value={newTrackerType}
                      onChange={(e) => setNewTrackerType(e.target.value)}
                      className="w-[160px] bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[14px] text-[var(--theme-text-primary)] outline-none"
                    >
                      <option value="piratebay_api">API (TPB-style)</option>
                      <option value="torznab">Torznab (Prowlarr/Jackett)</option>
                      <option value="prowlarr">Prowlarr (All Indexers)</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newTrackerUrl}
                      onChange={(e) => setNewTrackerUrl(e.target.value)}
                      placeholder={newTrackerType === "prowlarr" ? "Prowlarr URL (e.g., http://localhost:9696)" : newTrackerType === "torznab" ? "Base URL (e.g., http://localhost:9696/1/api)" : "Base URL (e.g., https://example.org)"}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
                      className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                    <button
                      onClick={handleAddTracker}
                      disabled={!newTrackerName.trim() || !newTrackerUrl.trim()}
                      className="rounded-lg text-white text-[14px] font-medium disabled:opacity-30 transition-colors shrink-0"
                      style={{ background: "var(--accent)", padding: "12px 28px" }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newTrackerApiKey}
                      onChange={(e) => setNewTrackerApiKey(e.target.value)}
                      placeholder={newTrackerType === "torznab" ? "API Key (required for Torznab)" : "API Key (optional)"}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
                      className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                  </div>
                  {newTrackerType === "torznab" && !newTrackerApiKey.trim() && (
                    <p className="text-[13px] text-[#f59e0b]">Torznab trackers require an API key to authenticate</p>
                  )}
                </div>
                <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--theme-border-subtle)" }}>
                  <div className="text-[13px] text-[var(--theme-text-muted)] font-medium mb-3">How it works</div>
                  <div className="text-[13px] text-[var(--theme-text-ghost)]">
                    <div className="p-3 rounded-lg" style={{ background: "var(--theme-bg-content)" }}>
                      {newTrackerType === "torznab" ? (
                        <>
                          <p>Connect to a Torznab-compatible indexer (Prowlarr, Jackett, etc.). Enter the API endpoint URL and your API key. The app queries the Torznab API and parses the XML response for search results.</p>
                          <p className="mt-2 text-[var(--theme-text-muted)]">Find your API URL and key in your indexer manager's settings. For Prowlarr, it's typically <code className="text-[var(--theme-text-muted)] px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>http://localhost:9696/&#123;indexer_id&#125;/api</code>.</p>
                        </>
                      ) : (
                        <>
                          <p>Enter the base URL of a site with a TPB-compatible JSON API. The app queries <code className="text-[var(--theme-text-muted)] px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>/q.php?q=search_term</code> and expects a JSON array of results with fields: name, info_hash, seeders, leechers, size, added, category.</p>
                          <p className="mt-2 text-[var(--theme-text-muted)]">Need help finding compatible sources? Check the <a href="https://github.com/CasaVargas/DebridDownloader/discussions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>community discussions</a>.</p>
                        </>
                      )}
                    </div>
                  </div>
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
