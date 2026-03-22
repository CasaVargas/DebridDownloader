import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings } from "../api/settings";
import { getTrackerConfigs, saveTrackerConfigs } from "../api/search";
import { getAvailableProviders, switchProvider, getActiveProvider } from "../api/providers";
import type { AppSettings, TrackerConfig, ProviderInfo } from "../types";
import { open } from "@tauri-apps/plugin-dialog";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { setMagnetHandler } from "../api/magnet";
import { ACCENT_COLORS } from "../hooks/useAccentColor";

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

  // Add tracker form
  const [newTrackerName, setNewTrackerName] = useState("");
  const [newTrackerUrl, setNewTrackerUrl] = useState("");
  const [newTrackerType, setNewTrackerType] = useState("piratebay_api");
  const [newTrackerApiKey, setNewTrackerApiKey] = useState("");

  const [activeSection, setActiveSection] = useState("general");
  const [showAddTracker, setShowAddTracker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function handleAddTrackerAndCollapse() {
    if (!newTrackerName.trim() || !newTrackerUrl.trim()) return;
    await handleAddTracker();
    setShowAddTracker(false);
  }

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

  // Scroll spy — highlight active category as user scrolls
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const sectionIds = ["general", "downloads", "trackers", "behavior", "appearance"];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("section-", "");
            setActiveSection(id);
          }
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -80% 0px",
        threshold: 0,
      }
    );

    for (const id of sectionIds) {
      const el = document.getElementById(`section-${id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [!!settings]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="w-6 h-6 border-2 border-[rgba(16,185,129,0.3)] border-t-[#10b981] rounded-full animate-spin" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="text-[#ef4444] text-[15px]">Failed to load settings.</div>
      </div>
    );
  }

  const accentColor = ACCENT_COLORS[frontend.accent_color]?.primary ?? "#10b981";

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Category Nav */}
      <nav
        className="w-[200px] shrink-0 flex flex-col gap-0.5 overflow-y-auto"
        style={{ padding: "24px 12px", borderRight: "1px solid var(--theme-border)" }}
      >
        <div className="text-[13px] font-semibold text-[var(--theme-text-muted)] px-3 pb-4">Settings</div>
        {[
          { id: "general", label: "General", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> },
          { id: "downloads", label: "Downloads", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
          { id: "trackers", label: "Trackers", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
          { id: "behavior", label: "Behavior", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg> },
          { id: "appearance", label: "Appearance", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3 4h-1.3c-.8 0-1.5.7-1.5 1.5 0 .4.2.8.4 1.1.3.3.4.6.4 1 0 .8-.7 1.4-1.5 1.4H12z"/></svg> },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              document.getElementById(`section-${cat.id}`)?.scrollIntoView({ behavior: "smooth" });
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors w-full text-left"
            style={{
              background: activeSection === cat.id ? "var(--accent-bg-light)" : "transparent",
              color: activeSection === cat.id ? "var(--accent)" : "var(--theme-text-muted)",
            }}
          >
            <span className="shrink-0 opacity-70">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ padding: "32px 48px 80px" }}>
        {/* General */}
        <section id="section-general" className="mb-12">
          <h3 className="text-[18px] font-semibold text-[var(--theme-text-primary)] mb-1">General</h3>
          <p className="text-[13px] text-[var(--theme-text-muted)] mb-5">Debrid provider</p>
          <div className="flex gap-3">
            {providers.map((p) => {
              const isSelected = activeProvider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleSwitchProvider(p.id)}
                  disabled={switching}
                  className="flex-1 py-3 rounded-xl text-[14px] font-medium transition-all cursor-pointer"
                  style={{
                    background: isSelected ? "var(--accent-bg-medium)" : "var(--theme-bg)",
                    border: isSelected ? "2px solid var(--accent)" : "2px solid var(--theme-border)",
                    color: isSelected ? "var(--accent)" : "var(--theme-text-muted)",
                    opacity: switching ? 0.5 : 1,
                    textAlign: "center",
                  }}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </section>

        <div className="border-t border-[var(--theme-border-subtle)] my-8" />

        {/* Downloads */}
        <section id="section-downloads" className="mb-12">
          <h3 className="text-[18px] font-semibold text-[var(--theme-text-primary)] mb-1">Downloads</h3>
          <p className="text-[13px] text-[var(--theme-text-muted)] mb-5">Download location and file management</p>
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--theme-bg)", border: "1px solid var(--theme-border)" }}>
            {/* Download folder */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-[var(--theme-text-primary)]">Download Folder</span>
                  {savedField === "download_folder" && <span style={{ color: accentColor }} className="text-[12px]">Saved</span>}
                </div>
                <div className="text-[12px] text-[var(--theme-text-muted)] mt-0.5 truncate">
                  {settings.download_folder || "Not set — you'll be asked each time"}
                </div>
              </div>
              <button
                onClick={handleBrowse}
                className="shrink-0 px-5 py-2 rounded-lg text-[13px] text-[var(--theme-text-secondary)] transition-colors"
                style={{ background: "var(--theme-selected)", border: "1px solid var(--theme-border)" }}
              >
                Browse
              </button>
            </div>
            <div className="border-t border-[var(--theme-border-subtle)]" />
            {/* Max concurrent */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-[14px] text-[var(--theme-text-primary)]">Max Concurrent Downloads</span>
                {savedField === "max_concurrent_downloads" && <span style={{ color: accentColor }} className="text-[12px]">Saved</span>}
              </div>
              <select
                value={settings.max_concurrent_downloads}
                onChange={async (e) => {
                  await applyChange({ max_concurrent_downloads: Number(e.target.value) });
                  markSaved("max_concurrent_downloads");
                }}
                className="bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--theme-text-primary)] outline-none"
              >
                {[1, 2, 3, 4, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>{n} simultaneous</option>
                ))}
              </select>
            </div>
            <div className="border-t border-[var(--theme-border-subtle)]" />
            {/* Subfolders */}
            <ToggleRow
              label="Create subfolders per torrent"
              description="Organize into folders named after each torrent"
              checked={settings.create_torrent_subfolders}
              saved={savedField === "create_torrent_subfolders"}
              accentColor={accentColor}
              onChange={async (v) => {
                await applyChange({ create_torrent_subfolders: v });
                markSaved("create_torrent_subfolders");
              }}
            />
            <div className="border-t border-[var(--theme-border-subtle)]" />
            {/* Auto-start */}
            <ToggleRow
              label="Auto-start downloads"
              description="Download when torrents finish processing"
              checked={frontend.auto_start_downloads}
              accentColor={accentColor}
              onChange={(v) => applyFrontend({ auto_start_downloads: v })}
            />
          </div>
        </section>

        <div className="border-t border-[var(--theme-border-subtle)] my-8" />

        {/* Trackers */}
        <section id="section-trackers" className="mb-12">
          <h3 className="text-[18px] font-semibold text-[var(--theme-text-primary)] mb-1">
            Trackers
            {savedField === "trackers" && <span style={{ color: accentColor }} className="text-[13px] ml-2 font-normal">Saved</span>}
          </h3>
          <p className="text-[13px] text-[var(--theme-text-muted)] mb-5">Search sources for finding torrents</p>

          {trackers.length > 0 ? (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--theme-bg)", border: "1px solid var(--theme-border)" }}>
              {trackers.map((tracker, i) => (
                <div key={tracker.id}>
                  {i > 0 && <div className="border-t border-[var(--theme-border-subtle)]" />}
                  <div
                    className="flex items-center gap-3 px-5 py-3.5"
                    style={{ opacity: tracker.enabled ? 1 : 0.5 }}
                  >
                    <button
                      onClick={() => handleToggleTracker(tracker.id)}
                      className="shrink-0 w-10 h-6 rounded-full transition-colors duration-200 relative cursor-pointer"
                      style={{ backgroundColor: tracker.enabled ? accentColor : "var(--theme-border)" }}
                    >
                      <div
                        className="w-[18px] h-[18px] rounded-full bg-white absolute transition-all duration-200"
                        style={{ top: "3px", left: tracker.enabled ? "19px" : "3px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] text-[var(--theme-text-primary)] font-medium">{tracker.name}</div>
                      <div className="text-[12px] text-[var(--theme-text-muted)] truncate">{tracker.url}</div>
                    </div>
                    <span className="text-[11px] text-[var(--theme-text-ghost)] shrink-0 px-2 py-0.5 rounded-md" style={{ background: "var(--theme-selected)" }}>
                      {tracker.tracker_type === "piratebay_api" ? "API" : tracker.tracker_type === "torznab" ? "Torznab" : tracker.tracker_type === "prowlarr" ? "Prowlarr" : tracker.tracker_type}
                    </span>
                    <button
                      onClick={() => handleRemoveTracker(tracker.id)}
                      className="shrink-0 text-[#ef4444] text-[12px] px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.06)" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.06)"; }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-xl text-center" style={{ background: "var(--theme-bg)", border: "1px dashed var(--theme-border)" }}>
              <p className="text-[14px] text-[var(--theme-text-muted)]">No trackers configured</p>
              <p className="text-[13px] text-[var(--theme-text-ghost)] mt-1">Add a tracker below to enable search</p>
            </div>
          )}

          {/* Add tracker - collapsible */}
          {!showAddTracker ? (
            <button
              onClick={() => setShowAddTracker(true)}
              className="flex items-center justify-center gap-2 w-full py-3 mt-3 rounded-xl text-[13px] transition-colors cursor-pointer"
              style={{ border: "1px dashed var(--theme-border)", color: "var(--theme-text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.color = accentColor; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--theme-border)"; e.currentTarget.style.color = "var(--theme-text-muted)"; }}
            >
              <span style={{ color: accentColor }}>+</span> Add Tracker
            </button>
          ) : (
            <div className="mt-3 p-5 rounded-xl" style={{ background: "var(--theme-bg)", border: "1px solid var(--theme-border)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[14px] text-[var(--theme-text-primary)] font-medium">Add Tracker</div>
                <button
                  onClick={() => setShowAddTracker(false)}
                  className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] text-[18px] cursor-pointer"
                >
                  ×
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newTrackerName}
                    onChange={(e) => setNewTrackerName(e.target.value)}
                    placeholder="Tracker name"
                    className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[13px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors"
                  />
                  <select
                    value={newTrackerType}
                    onChange={(e) => setNewTrackerType(e.target.value)}
                    className="w-[150px] bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[13px] text-[var(--theme-text-primary)] outline-none"
                  >
                    <option value="piratebay_api">API (TPB-style)</option>
                    <option value="torznab">Torznab</option>
                    <option value="prowlarr">Prowlarr</option>
                  </select>
                </div>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newTrackerUrl}
                    onChange={(e) => setNewTrackerUrl(e.target.value)}
                    placeholder={newTrackerType === "prowlarr" ? "Prowlarr URL (e.g., http://localhost:9696)" : newTrackerType === "torznab" ? "Base URL (e.g., http://localhost:9696/1/api)" : "Base URL (e.g., https://example.org)"}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTrackerAndCollapse()}
                    className="flex-1 bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[13px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                  />
                  <button
                    onClick={handleAddTrackerAndCollapse}
                    disabled={!newTrackerName.trim() || !newTrackerUrl.trim()}
                    className="rounded-lg text-white text-[13px] font-medium disabled:opacity-30 transition-colors shrink-0 cursor-pointer"
                    style={{ background: "var(--accent)", padding: "10px 24px" }}
                  >
                    Add
                  </button>
                </div>
                <input
                  type="text"
                  value={newTrackerApiKey}
                  onChange={(e) => setNewTrackerApiKey(e.target.value)}
                  placeholder={newTrackerType === "torznab" ? "API Key (required for Torznab)" : "API Key (optional)"}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTrackerAndCollapse()}
                  className="bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg p-3 text-[13px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-ghost)] outline-none focus:border-[var(--theme-border-hover)] transition-colors font-mono"
                />
                {newTrackerType === "torznab" && !newTrackerApiKey.trim() && (
                  <p className="text-[12px] text-[#f59e0b]">Torznab trackers require an API key to authenticate</p>
                )}
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--theme-border-subtle)" }}>
                <div className="text-[12px] text-[var(--theme-text-muted)] font-medium mb-2">How it works</div>
                <div className="text-[12px] text-[var(--theme-text-ghost)] p-3 rounded-lg" style={{ background: "var(--theme-bg-content)" }}>
                  {newTrackerType === "prowlarr" ? (
                    <p>Connect to Prowlarr's native search API. Enter your Prowlarr base URL and API key (found in Settings → General → Security). Searches all configured indexers at once and returns results with per-indexer source names.</p>
                  ) : newTrackerType === "torznab" ? (
                    <>
                      <p>Connect to a Torznab-compatible indexer (Prowlarr, Jackett, etc.). Enter the API endpoint URL and your API key.</p>
                      <p className="mt-2 text-[var(--theme-text-muted)]">For Prowlarr, the URL is typically <code className="px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>http://localhost:9696/&#123;indexer_id&#125;/api</code>.</p>
                    </>
                  ) : (
                    <>
                      <p>Enter the base URL of a site with a TPB-compatible JSON API. The app queries <code className="px-1 py-0.5 rounded" style={{ background: "var(--theme-selected)" }}>/q.php?q=search_term</code> and expects a JSON array of results.</p>
                      <p className="mt-2 text-[var(--theme-text-muted)]">Need help? Check the <a href="https://github.com/CasaVargas/DebridDownloader/discussions" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>community discussions</a>.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="border-t border-[var(--theme-border-subtle)] my-8" />

        {/* Behavior */}
        <section id="section-behavior" className="mb-12">
          <h3 className="text-[18px] font-semibold text-[var(--theme-text-primary)] mb-1">Behavior</h3>
          <p className="text-[13px] text-[var(--theme-text-muted)] mb-5">Startup, integrations, and notifications</p>
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--theme-bg)", border: "1px solid var(--theme-border)" }}>
            <ToggleRow
              label="Launch at login"
              description="Start when you log in to your computer"
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
            <div className="border-t border-[var(--theme-border-subtle)]" />
            <ToggleRow
              label="Default magnet link handler"
              description="Open magnet links from your browser"
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
            <div className="border-t border-[var(--theme-border-subtle)]" />
            <ToggleRow
              label="Notify when download completes"
              description="Show a system notification"
              checked={frontend.notify_on_complete}
              accentColor={accentColor}
              onChange={(v) => applyFrontend({ notify_on_complete: v })}
            />
            <div className="border-t border-[var(--theme-border-subtle)]" />
            {/* Default sort */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <span className="text-[14px] text-[var(--theme-text-primary)]">Default sort order</span>
              <div className="flex gap-2">
                <select
                  value={frontend.default_sort_key}
                  onChange={(e) => applyFrontend({ default_sort_key: e.target.value })}
                  className="bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--theme-text-primary)] outline-none"
                >
                  <option value="added">Date Added</option>
                  <option value="filename">Name</option>
                  <option value="bytes">Size</option>
                </select>
                <select
                  value={frontend.default_sort_direction}
                  onChange={(e) => applyFrontend({ default_sort_direction: e.target.value as "asc" | "desc" })}
                  className="bg-[var(--theme-bg-content)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--theme-text-primary)] outline-none"
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <div className="border-t border-[var(--theme-border-subtle)] my-8" />

        {/* Appearance */}
        <section id="section-appearance" className="mb-12">
          <h3 className="text-[18px] font-semibold text-[var(--theme-text-primary)] mb-1">Appearance</h3>
          <p className="text-[13px] text-[var(--theme-text-muted)] mb-5">Theme and accent color</p>

          {/* Theme */}
          <div className="mb-5">
            <div className="text-[13px] text-[var(--theme-text-muted)] mb-2">Theme</div>
            <div className="flex gap-3">
              {[
                { id: "dark", label: "Dark", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> },
                { id: "light", label: "Light", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/></svg> },
              ].map((opt) => {
                const isSelected = frontend.app_theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => applyFrontend({ app_theme: opt.id })}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-medium transition-all cursor-pointer"
                    style={{
                      background: isSelected ? "var(--accent-bg-medium)" : "var(--theme-bg)",
                      border: isSelected ? "2px solid var(--accent)" : "2px solid var(--theme-border)",
                      color: isSelected ? "var(--accent)" : "var(--theme-text-muted)",
                    }}
                  >
                    {opt.icon} {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent color */}
          <div>
            <div className="text-[13px] text-[var(--theme-text-muted)] mb-2">Accent Color</div>
            <div className="grid grid-cols-3 gap-2">
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
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all cursor-pointer"
                    style={{
                      background: isSelected ? "var(--theme-bg)" : "transparent",
                      border: isSelected ? `2px solid ${color}` : "2px solid var(--theme-border)",
                    }}
                  >
                    <div
                      className="w-4 h-4 rounded-full shrink-0 transition-shadow"
                      style={{ background: color, boxShadow: isSelected ? `0 0 10px ${color}60` : "none" }}
                    />
                    <span className="text-[13px] font-medium" style={{ color: isSelected ? "var(--theme-text-primary)" : "var(--theme-text-muted)" }}>
                      {opt.label}
                    </span>
                    {isSelected && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
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
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-[var(--theme-text-primary)]">{label}</span>
          {saved && <span style={{ color: accentColor }} className="text-[12px]">Saved</span>}
        </div>
        <p className="text-[12px] text-[var(--theme-text-muted)] mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="shrink-0 w-10 h-6 rounded-full transition-colors duration-200 relative cursor-pointer"
        style={{ backgroundColor: checked ? accentColor : "var(--theme-border)" }}
      >
        <div
          className="w-[18px] h-[18px] rounded-full bg-white absolute transition-all duration-200"
          style={{ top: "3px", left: checked ? "19px" : "3px", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
        />
      </button>
    </div>
  );
}
