import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings } from "../api/settings";
import type { AppSettings } from "../types";
import { open } from "@tauri-apps/plugin-dialog";
import { ACCENT_COLORS } from "../hooks/useAccentColor";

interface FrontendSettings {
  auto_start_downloads: boolean;
  launch_at_login: boolean;
  accent_color: string;
  default_sort_key: string;
  default_sort_direction: "asc" | "desc";
  notify_on_complete: boolean;
}

const DEFAULT_FRONTEND: FrontendSettings = {
  auto_start_downloads: false,
  launch_at_login: false,
  accent_color: "emerald",
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
  const [loading, setLoading] = useState(true);
  const [savedField, setSavedField] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setSettings(s))
      .finally(() => setLoading(false));
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
      <div className="px-10 py-8" style={{ paddingRight: "100px", maxWidth: "860px" }}>
        <h2 className="text-[24px] font-bold text-[#f1f5f9] tracking-[-0.3px] mb-2">
          Settings
        </h2>
        <p className="text-[14px] text-[#475569] mb-12">
          Configure downloads, behavior, and appearance
        </p>

        {settings && (
          <>
            {/* ── Downloads ── */}
            <section className="mb-14">
              <h3 className="text-[12px] text-[#475569] uppercase tracking-[1.5px] mb-7 pb-3 border-b border-[rgba(255,255,255,0.04)]">
                Downloads
              </h3>

              {/* Download folder */}
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] text-[#f1f5f9]">Download Folder</span>
                  {savedField === "download_folder" && (
                    <span style={{ color: accentColor }} className="text-[13px]">Saved</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-[15px] truncate flex-1 min-w-0">
                    {settings.download_folder ? (
                      <span className="text-[#94a3b8]">{settings.download_folder}</span>
                    ) : (
                      <span className="text-[#374151]">Not set — you'll be asked each time</span>
                    )}
                  </div>
                  <button
                    onClick={handleBrowse}
                    className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[rgba(255,255,255,0.1)] rounded-lg px-6 py-3.5 text-[14px] font-medium transition-colors shrink-0"
                  >
                    Browse
                  </button>
                </div>
              </div>

              {/* Max concurrent */}
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] text-[#f1f5f9]">Max Concurrent Downloads</span>
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
                  className="w-full bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-[15px] text-[#f1f5f9] focus:outline-none transition-colors"
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

            {/* ── Behavior ── */}
            <section className="mb-14">
              <h3 className="text-[12px] text-[#475569] uppercase tracking-[1.5px] mb-7 pb-3 border-b border-[rgba(255,255,255,0.04)]">
                Behavior
              </h3>

              {/* Launch at login */}
              <ToggleRow
                label="Launch at login"
                description="Start DebridDownloader when you log in to your computer"
                checked={frontend.launch_at_login}
                accentColor={accentColor}
                onChange={(v) => applyFrontend({ launch_at_login: v })}
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
              <div className="mb-8">
                <span className="text-[15px] text-[#f1f5f9] block mb-1.5">Default sort order</span>
                <p className="text-[14px] text-[#475569] mb-4">
                  How torrents are sorted when you open the app
                </p>
                <div className="flex gap-4">
                  <select
                    value={frontend.default_sort_key}
                    onChange={(e) => applyFrontend({ default_sort_key: e.target.value })}
                    className="flex-1 bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-[15px] text-[#f1f5f9] focus:outline-none transition-colors"
                  >
                    <option value="added">Date Added</option>
                    <option value="filename">Name</option>
                    <option value="bytes">Size</option>
                  </select>
                  <select
                    value={frontend.default_sort_direction}
                    onChange={(e) => applyFrontend({ default_sort_direction: e.target.value as "asc" | "desc" })}
                    className="w-[180px] bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-[15px] text-[#f1f5f9] focus:outline-none transition-colors"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
              </div>
            </section>

            {/* ── Appearance ── */}
            <section className="mb-14">
              <h3 className="text-[12px] text-[#475569] uppercase tracking-[1.5px] mb-7 pb-3 border-b border-[rgba(255,255,255,0.04)]">
                Appearance
              </h3>

              <div className="mb-8">
                <span className="text-[15px] text-[#f1f5f9] block mb-1.5">Accent Color</span>
                <p className="text-[14px] text-[#475569] mb-5">
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
                          background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
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
                          style={{ color: isSelected ? color : "#64748b" }}
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
            <section className="mb-14">
              <h3 className="text-[12px] text-[#475569] uppercase tracking-[1.5px] mb-7 pb-3 border-b border-[rgba(255,255,255,0.04)]">
                About
              </h3>
              <div className="bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-xl p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}
                  >
                    <span className="text-white font-bold text-[20px]">D</span>
                  </div>
                  <div>
                    <div className="text-[17px] text-[#f1f5f9] font-semibold">DebridDownloader</div>
                    <div className="text-[14px] text-[#475569]">Version 0.1.0</div>
                  </div>
                </div>
                <p className="text-[14px] text-[#475569] leading-relaxed">
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
    <div className="mb-8 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-[#f1f5f9]">{label}</span>
          {saved && <span style={{ color: accentColor }} className="text-[13px]">Saved</span>}
        </div>
        <p className="text-[14px] text-[#475569] mt-1">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="shrink-0 mt-0.5 w-12 h-7 rounded-full transition-colors duration-200 relative"
        style={{
          backgroundColor: checked ? accentColor : "rgba(255,255,255,0.08)",
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
