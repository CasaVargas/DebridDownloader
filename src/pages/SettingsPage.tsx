import { useState, useEffect, useRef } from "react";
import { getSettings, updateSettings } from "../api/settings";
import type { AppSettings } from "../types";
import { open } from "@tauri-apps/plugin-dialog";

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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-6" style={{ paddingRight: "80px", maxWidth: "800px" }}>
        <h2 className="text-[22px] font-bold text-[#f1f5f9] tracking-[-0.3px] mb-1">
          Settings
        </h2>
        <p className="text-[13px] text-[#475569] mb-8">
          Configure downloads, behavior, and appearance
        </p>

        {settings && (
          <>
            {/* ── Downloads ── */}
            <div className="mb-10">
              <h3 className="text-[13px] text-[#475569] uppercase tracking-[1px] mb-5 flex items-center gap-2">
                Downloads
              </h3>

              {/* Download folder */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[15px] text-[#94a3b8]">Download Folder</span>
                  {savedField === "download_folder" && (
                    <span className="text-[#10b981] text-[13px]">Saved</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-3.5 text-[15px] truncate flex-1 min-w-0">
                    {settings.download_folder ? (
                      <span className="text-[#94a3b8]">{settings.download_folder}</span>
                    ) : (
                      <span className="text-[#374151]">Not set — you'll be asked each time</span>
                    )}
                  </div>
                  <button
                    onClick={handleBrowse}
                    className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[rgba(255,255,255,0.1)] rounded-lg px-5 py-3 text-[14px] font-medium transition-colors shrink-0"
                  >
                    Browse
                  </button>
                </div>
              </div>

              {/* Max concurrent */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[15px] text-[#94a3b8]">Max Concurrent Downloads</span>
                  {savedField === "max_concurrent_downloads" && (
                    <span className="text-[#10b981] text-[13px]">Saved</span>
                  )}
                </div>
                <select
                  value={settings.max_concurrent_downloads}
                  onChange={async (e) => {
                    await applyChange({ max_concurrent_downloads: Number(e.target.value) });
                    markSaved("max_concurrent_downloads");
                  }}
                  className="w-full bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-3.5 text-[15px] text-[#f1f5f9] focus:outline-none focus:border-[rgba(16,185,129,0.3)] transition-colors"
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
                onChange={(v) => applyFrontend({ auto_start_downloads: v })}
              />
            </div>

            {/* ── Behavior ── */}
            <div className="mb-10">
              <h3 className="text-[13px] text-[#475569] uppercase tracking-[1px] mb-5">
                Behavior
              </h3>

              {/* Launch at login */}
              <ToggleRow
                label="Launch at login"
                description="Start DebridDownloader when you log in to your computer"
                checked={frontend.launch_at_login}
                onChange={(v) => applyFrontend({ launch_at_login: v })}
              />

              {/* Notify on complete */}
              <ToggleRow
                label="Notify when download completes"
                description="Show a system notification when a file finishes downloading"
                checked={frontend.notify_on_complete}
                onChange={(v) => applyFrontend({ notify_on_complete: v })}
              />

              {/* Default sort */}
              <div className="mb-6">
                <span className="text-[15px] text-[#f1f5f9] block mb-1">Default sort order</span>
                <p className="text-[14px] text-[#475569] mb-3">
                  How torrents are sorted when you open the app
                </p>
                <div className="flex gap-3">
                  <select
                    value={frontend.default_sort_key}
                    onChange={(e) => applyFrontend({ default_sort_key: e.target.value })}
                    className="flex-1 bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-3.5 text-[15px] text-[#f1f5f9] focus:outline-none focus:border-[rgba(16,185,129,0.3)] transition-colors"
                  >
                    <option value="added">Date Added</option>
                    <option value="filename">Name</option>
                    <option value="bytes">Size</option>
                  </select>
                  <select
                    value={frontend.default_sort_direction}
                    onChange={(e) => applyFrontend({ default_sort_direction: e.target.value as "asc" | "desc" })}
                    className="w-[160px] bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-lg p-3.5 text-[15px] text-[#f1f5f9] focus:outline-none focus:border-[rgba(16,185,129,0.3)] transition-colors"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── Appearance ── */}
            <div className="mb-10">
              <h3 className="text-[13px] text-[#475569] uppercase tracking-[1px] mb-5">
                Appearance
              </h3>

              <div className="mb-6">
                <span className="text-[15px] text-[#f1f5f9] block mb-1">Accent Color</span>
                <p className="text-[14px] text-[#475569] mb-3">
                  Highlight color used for active states and buttons
                </p>
                <div className="flex gap-3">
                  {[
                    { id: "emerald", color: "#10b981", label: "Emerald" },
                    { id: "blue", color: "#3b82f6", label: "Blue" },
                    { id: "violet", color: "#8b5cf6", label: "Violet" },
                    { id: "rose", color: "#f43f5e", label: "Rose" },
                    { id: "amber", color: "#f59e0b", label: "Amber" },
                    { id: "cyan", color: "#06b6d4", label: "Cyan" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => applyFrontend({ accent_color: opt.id })}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                      style={{
                        background: frontend.accent_color === opt.id ? "rgba(255,255,255,0.04)" : "transparent",
                        border: frontend.accent_color === opt.id ? `1px solid ${opt.color}40` : "1px solid transparent",
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-full"
                        style={{
                          background: opt.color,
                          boxShadow: frontend.accent_color === opt.id ? `0 0 12px ${opt.color}40` : "none",
                        }}
                      />
                      <span className="text-[12px] text-[#64748b]">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── About ── */}
            <div className="mb-10">
              <h3 className="text-[13px] text-[#475569] uppercase tracking-[1px] mb-5">
                About
              </h3>
              <div className="bg-[#08080f] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                  >
                    <span className="text-white font-bold text-[18px]">D</span>
                  </div>
                  <div>
                    <div className="text-[16px] text-[#f1f5f9] font-semibold">DebridDownloader</div>
                    <div className="text-[13px] text-[#475569]">Version 0.1.0</div>
                  </div>
                </div>
                <p className="text-[14px] text-[#475569] leading-relaxed">
                  Desktop client for managing torrents and downloads via the Real-Debrid API.
                  Built with Tauri, React, and Rust.
                </p>
              </div>
            </div>
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
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  saved?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-[#f1f5f9]">{label}</span>
          {saved && <span className="text-[#10b981] text-[13px]">Saved</span>}
        </div>
        <p className="text-[14px] text-[#475569] mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="shrink-0 mt-0.5 w-11 h-6 rounded-full transition-colors duration-200 relative"
        style={{
          backgroundColor: checked ? "#10b981" : "rgba(255,255,255,0.08)",
        }}
      >
        <div
          className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all duration-200"
          style={{
            left: checked ? "22px" : "2px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </button>
    </div>
  );
}
