import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings } from "../api/settings";
import { getTrackerConfigs, saveTrackerConfigs } from "../api/search";
import type { AppSettings, TrackerConfig } from "../types";
import { open } from "@tauri-apps/plugin-dialog";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { ACCENT_COLORS } from "../hooks/useAccentColor";

interface FrontendSettings {
  auto_start_downloads: boolean;
  launch_at_login: boolean;
  accent_color: string;
  app_theme: string;
  default_sort_key: string;
  default_sort_direction: "asc" | "desc";
  notify_on_complete: boolean;
}

const DEFAULT_FRONTEND: FrontendSettings = {
  auto_start_downloads: false,
  launch_at_login: false,
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

  // Add tracker form
  const [newTrackerName, setNewTrackerName] = useState("");
  const [newTrackerUrl, setNewTrackerUrl] = useState("");
  const [newTrackerType, setNewTrackerType] = useState("piratebay_api");

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
    const config: TrackerConfig = {
      id: crypto.randomUUID(),
      name: newTrackerName.trim(),
      url: newTrackerUrl.trim().replace(/\/+$/, ""),
      tracker_type: newTrackerType,
      enabled: true,
    };
    const next = [...trackers, config];
    setTrackers(next);
    await saveTrackerConfigs(next).catch(() => {});
    setNewTrackerName("");
    setNewTrackerUrl("");
    markSaved("trackers");
  }

  async function handleRemoveTracker(id: string) {
    const next = trackers.filter((t) => t.id !== id);
    setTrackers(next);
    await saveTrackerConfigs(next).catch(() => {});
    markSaved("trackers");
  }

  async function handleToggleTracker(id: string) {
    const next = trackers.map((t) => t.id === id ? { ...t, enabled: !t.enabled } : t);
    setTrackers(next);
    await saveTrackerConfigs(next).catch(() => {});
  }

  async function handleBrowse() {
    const selected = await open({ directory: true, title: "Select download folder" });
    if (selected && typeof selected === "string") {
      await applyChange({ download_folder: selected });
      markSaved("download_folder");
    }
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
            {/* ── Downloads ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                Downloads
              </h3>

              {/* Download folder */}
              <div className="mb-12">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] text-[var(--theme-text-primary)]">Download Folder</span>
                  {savedField === "download_folder" && (
                    <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-4 text-[15px] truncate flex-1 min-w-0">
                    {settings.download_folder ? (
                      <span className="text-[var(--theme-text-secondary)]">{settings.download_folder}</span>
                    ) : (
                      <span className="text-[var(--theme-text-ghost)]">Not set — you'll be asked each time</span>
                    )}
                  </div>
                  <button
                    onClick={handleBrowse}
                    className="bg-[var(--theme-selected)] border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:border-[var(--theme-border-hover)] rounded-lg px-6 py-3.5 text-[14px] font-medium transition-colors shrink-0"
                  >
                    Browse
                  </button>
                </div>
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
                        {tracker.tracker_type === "piratebay_api" ? "API" : "HTML"}
                      </span>
                      <button
                        onClick={() => handleRemoveTracker(tracker.id)}
                        className="shrink-0 text-[#ef4444] text-[13px] px-3 py-1.5 rounded-lg transition-colors"
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
                      <option value="1337x">HTML (1337x-style)</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newTrackerUrl}
                      onChange={(e) => setNewTrackerUrl(e.target.value)}
                      placeholder="Base URL (e.g., https://example.org)"
                      onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
                      className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[14px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                    />
                    <button
                      onClick={handleAddTracker}
                      disabled={!newTrackerName.trim() || !newTrackerUrl.trim()}
                      className="px-6 py-3 rounded-lg text-white text-[14px] font-medium disabled:opacity-30 transition-colors shrink-0"
                      style={{ background: `linear-gradient(135deg, var(--accent), var(--accent)cc)` }}
                    >
                      Add
                    </button>
                  </div>
                </div>
                <p className="text-[13px] text-[var(--theme-text-ghost)] mt-3">
                  <strong>API</strong> — sites with a TPB-compatible JSON API &nbsp;·&nbsp; <strong>HTML</strong> — sites with 1337x-style HTML tables
                </p>
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
                <div className="flex gap-4">
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
                        className="flex flex-col items-center gap-3 p-4 rounded-xl transition-all"
                        style={{
                          background: isSelected ? "var(--theme-selected)" : "transparent",
                          border: isSelected ? `2px solid ${color}` : "2px solid transparent",
                        }}
                      >
                        <div
                          className="w-10 h-10 rounded-full transition-shadow"
                          style={{
                            background: color,
                            boxShadow: isSelected ? `0 0 20px ${color}50` : "none",
                          }}
                        />
                        <span
                          className="text-[13px] font-medium"
                          style={{ color: isSelected ? color : "var(--theme-text-muted)" }}
                        >
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ── About ── */}
            <section className="mb-20">
              <h3 className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[1.5px] mb-10 pb-4 border-b border-[var(--theme-border-subtle)]">
                About
              </h3>
              <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-xl p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}
                  >
                    <span className="text-white font-bold text-[20px]">D</span>
                  </div>
                  <div>
                    <div className="text-[17px] text-[var(--theme-text-primary)] font-semibold">DebridDownloader</div>
                    <div className="text-[14px] text-[var(--theme-text-muted)]">Version 0.1.0</div>
                  </div>
                </div>
                <p className="text-[14px] text-[var(--theme-text-muted)] leading-relaxed">
                  Desktop client for managing torrents and downloads via the Real-Debrid API.
                  Built with Tauri, React, and Rust.
                </p>
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
