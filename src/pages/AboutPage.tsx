import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "available"; version: string }
  | { state: "downloading"; progress: number }
  | { state: "ready" }
  | { state: "error"; message: string };

export default function AboutPage() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [version, setVersion] = useState("");
  const [changelogExpanded, setChangelogExpanded] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  const handleCheckForUpdates = async () => {
    setStatus({ state: "checking" });
    try {
      const update = await check();
      if (!update) {
        setStatus({ state: "up-to-date" });
        return;
      }

      setStatus({ state: "available", version: update.version });

      let totalLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLength = event.data.contentLength;
          setStatus({ state: "downloading", progress: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = totalLength > 0 ? Math.round((downloaded / totalLength) * 100) : 0;
          setStatus({ state: "downloading", progress });
        } else if (event.event === "Finished") {
          setStatus({ state: "ready" });
        }
      });

      setStatus({ state: "ready" });
    } catch (e) {
      setStatus({ state: "error", message: String(e) });
    }
  };

  const handleRelaunch = async () => {
    await relaunch();
  };

  const renderUpdateButton = () => {
    switch (status.state) {
      case "idle":
        return (
          <button
            onClick={handleCheckForUpdates}
            className="text-[var(--theme-text-secondary)] font-medium rounded-lg transition-colors hover:text-[var(--theme-text-primary)]"
            style={{
              marginTop: 16,
              padding: "10px 24px",
              background: "var(--theme-selected)",
              border: "1px solid var(--theme-border)",
              fontSize: 13,
            }}
          >
            Check for Updates
          </button>
        );
      case "checking":
        return (
          <div className="flex items-center gap-2" style={{ marginTop: 16 }}>
            <div className="w-4 h-4 border-2 border-[var(--theme-border)] border-t-[var(--accent)] rounded-full animate-spin" />
            <span className="text-[var(--theme-text-muted)]" style={{ fontSize: 13 }}>Checking for updates...</span>
          </div>
        );
      case "up-to-date":
        return (
          <span className="text-[var(--theme-text-muted)]" style={{ marginTop: 16, fontSize: 13 }}>
            You're on the latest version
          </span>
        );
      case "available":
        return (
          <div className="flex items-center gap-2" style={{ marginTop: 16 }}>
            <div className="w-4 h-4 border-2 border-[var(--theme-border)] border-t-[var(--accent)] rounded-full animate-spin" />
            <span className="text-[var(--theme-text-muted)]" style={{ fontSize: 13 }}>
              Downloading v{status.version}...
            </span>
          </div>
        );
      case "downloading":
        return (
          <div className="flex flex-col items-center gap-2 w-full" style={{ marginTop: 16 }}>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--theme-border)" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${status.progress}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="text-[var(--theme-text-muted)]" style={{ fontSize: 13 }}>
              Downloading... {status.progress}%
            </span>
          </div>
        );
      case "ready":
        return (
          <button
            onClick={handleRelaunch}
            className="text-white font-medium rounded-lg transition-opacity hover:opacity-90"
            style={{
              marginTop: 16,
              padding: "10px 24px",
              background: "var(--accent)",
              fontSize: 13,
            }}
          >
            Restart to Update
          </button>
        );
      case "error":
        return (
          <div className="flex flex-col items-center gap-2" style={{ marginTop: 16 }}>
            <span className="text-[#ef4444]" style={{ fontSize: 13 }}>{status.message}</span>
            <button
              onClick={handleCheckForUpdates}
              className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors"
              style={{ fontSize: 13 }}
            >
              Try again
            </button>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex justify-center">
      <div className="flex flex-col items-center text-center" style={{ maxWidth: 420, padding: "40px 32px" }}>
        <img
          src="/app-icon.png"
          alt="DebridDownloader"
          className="rounded-[16px]"
          style={{ width: 72, height: 72, boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}
        />

        <h1
          className="text-[var(--theme-text-primary)] font-bold tracking-[-0.5px]"
          style={{ fontSize: 22, marginTop: 16 }}
        >
          DebridDownloader
        </h1>

        <span
          className="text-[var(--theme-text-ghost)]"
          style={{ fontSize: 13, marginTop: 6 }}
        >
          Version {version}
        </span>

        {renderUpdateButton()}

        <p
          className="text-[var(--theme-text-muted)] leading-relaxed"
          style={{ fontSize: 15, marginTop: 24 }}
        >
          A fast, native desktop client for managing torrents and downloads through debrid services.
          Built with Tauri, React, and Rust.
        </p>

        {/* What's New */}
        <div
          className="w-full rounded-xl text-left"
          style={{
            marginTop: 32,
            padding: "20px 24px",
            background: "var(--theme-bg)",
            border: "1px solid var(--theme-border)",
          }}
        >
          <div className="text-[11px] text-[var(--theme-text-muted)] uppercase tracking-[1px] mb-4">What's New</div>
          {[
            {
              version: "1.6.3",
              title: "Auto-Extract Archives",
              items: [
                "Downloads that arrive as archives now extract automatically — .zip, .7z, .rar, and .tar.gz/.xz/.bz2",
                "Multi-part RAR5, legacy RAR, and split 7z are handled — waits for every part to finish before extracting",
                "Single-video extracts flow straight into the auto-organizer (Movies/TV folders)",
                "Optional: delete archive parts after a successful extract",
                "New \"Extracting…\" status in the Downloads view",
                "Settings → Downloads: toggles for auto-extract and delete-after, plus a status line for the detected RAR tool (7-Zip / p7zip / unar)",
              ],
            },
            {
              version: "1.6.2",
              title: "Bug Fixes",
              items: [
                "Login now works on Linux — secure token storage was missing a platform backend",
                "Settings (max concurrent downloads, speed limit, auto-organize folders, active provider) now persist across app restarts",
              ],
            },
            {
              version: "1.6.0",
              title: "Premiumize Support",
              items: [
                "Premiumize.me as a third debrid provider",
                "Full torrent management, download links, and streaming",
                "API key authentication",
              ],
            },
            {
              version: "1.5.0",
              title: "Export/Import & Speed Limiting",
              items: [
                "Export/Import settings for backup and migration",
                "Global download speed limiter",
              ],
            },
            {
              version: "1.4.0",
              title: "Media Intelligence",
              items: [
                "Auto-organize downloads into Movies/TV folder structures",
                "TMDb metadata lookup for correct titles and years",
                "Plex, Jellyfin, and Emby library scan triggers",
                "Test Connection for media server configuration",
              ],
            },
            {
              version: "1.3.0",
              title: "Watch List & Native Notifications",
              items: [
                "Watch list with automated search rules — auto-add new releases",
                "TV show tracking with season/episode awareness and quality filters",
                "Native OS notifications when watch list matches are found",
                "Sidebar badge for unread watch list matches",
              ],
            },
            {
              version: "1.2.0",
              title: "rclone Integration & Symlink Mode",
              items: [
                "Stream downloads directly to cloud remotes via rclone",
                "Symlink mode for instant Plex/Jellyfin availability",
                "Smart destination input with rclone remote paths",
                "rclone detection and remote listing in Settings",
              ],
            },
            {
              version: "1.1.9",
              title: "Prowlarr Integration & Polish",
              items: [
                "Native Prowlarr scraper — search all indexers in one query",
                "Better error messages for Torznab misconfiguration",
                "What's New section on About page",
                "Privacy policy page on website",
              ],
            },
            {
              version: "1.1.8",
              title: "Video Preview & Floating Mini-Player",
              items: [
                "One-click video preview button on every torrent row",
                "Floating mini-player with drag, resize, and fullscreen",
                "Streams from debrid providers without downloading first",
                "Update notification badge in sidebar",
              ],
            },
            {
              version: "1.1.5",
              title: "One-Click Magnet Links & Auto-Updater",
              items: [
                "Magnet links add instantly with all files auto-selected",
                "In-app auto-updater across macOS, Windows, and Linux",
                "Torznab scraper support for private trackers",
                "Streamlined completed downloads with inline actions",
              ],
            },
            {
              version: "1.1.0",
              title: "TorBox Support",
              items: [
                "Full TorBox provider with API key authentication",
                "Switch between Real-Debrid and TorBox at any time",
                "Video streaming with local proxy server",
                "6 accent color themes with dark and light mode",
              ],
            },
          ].filter((_, i) => changelogExpanded || i === 0).map((entry, i) => (
            <div
              key={entry.version}
              className={i > 0 ? "mt-4 pt-4" : ""}
              style={i > 0 ? { borderTop: "1px solid var(--theme-border-subtle)" } : {}}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                  style={{ background: "var(--accent-bg-light)", color: "var(--accent)" }}
                >
                  v{entry.version}
                </span>
                <span className="text-[13px] font-medium text-[var(--theme-text-primary)]">
                  {entry.title}
                </span>
              </div>
              <ul className="ml-4 mt-1.5">
                {entry.items.map((item) => (
                  <li
                    key={item}
                    className="text-[13px] text-[var(--theme-text-muted)] leading-relaxed list-disc"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button
            onClick={() => setChangelogExpanded((v) => !v)}
            className="text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors mt-3 cursor-pointer"
          >
            {changelogExpanded ? "Show less" : "Show older releases"}
          </button>
        </div>

        <div
          className="w-full rounded-xl"
          style={{
            marginTop: 24,
            padding: "24px",
            background: "var(--theme-bg)",
            border: "1px solid var(--theme-border)",
          }}
        >
          <p
            className="text-[var(--theme-text-secondary)] leading-relaxed"
            style={{ fontSize: 14 }}
          >
            If you enjoy using DebridDownloader, consider sponsoring the developer to support continued development of great apps and utilities.
          </p>
          <a
            href="https://github.com/sponsors/prjoni99"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-white font-medium rounded-lg transition-opacity hover:opacity-90"
            style={{
              marginTop: 16,
              padding: "12px 28px",
              background: "var(--accent)",
              fontSize: 14,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            Sponsor on GitHub
          </a>
        </div>

        {/* Casa Vargas */}
        <a
          href="https://casavargas.app"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-4 rounded-xl transition-colors"
          style={{
            marginTop: 24,
            padding: "16px 20px",
            background: "var(--theme-bg)",
            border: "1px solid var(--theme-border)",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border)"; }}
        >
          <img
            src="/casavargas-logo-orange.png"
            alt="Casa Vargas"
            className="shrink-0 rounded-lg"
            style={{ width: 36, height: 36 }}
          />
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[14px] font-semibold text-[var(--theme-text-primary)]">Casa Vargas</div>
            <div className="text-[12px] text-[var(--theme-text-muted)] mt-0.5">Check out my other projects</div>
          </div>
          <div className="text-[12px] text-[var(--theme-text-ghost)] shrink-0">casavargas.app →</div>
        </a>

        {/* Beltr */}
        <a
          href="https://beltr.app"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-4 rounded-xl transition-colors"
          style={{
            marginTop: 12,
            padding: "16px 20px",
            background: "var(--theme-bg)",
            border: "1px solid var(--theme-border)",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--theme-border)"; }}
        >
          <img
            src="/beltr-icon.png"
            alt="Beltr"
            className="shrink-0 rounded-lg"
            style={{ width: 36, height: 36 }}
          />
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[14px] font-semibold text-[var(--theme-text-primary)]">Beltr</div>
            <div className="text-[12px] text-[var(--theme-text-muted)] mt-0.5">AI karaoke — turn any song into a karaoke track</div>
          </div>
          <div className="text-[12px] text-[var(--theme-text-ghost)] shrink-0">beltr.app →</div>
        </a>

        <div
          className="flex items-center gap-4"
          style={{ marginTop: 24 }}
        >
          <a
            href="https://github.com/CasaVargas/DebridDownloader"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--theme-text-ghost)] hover:text-[var(--theme-text-secondary)] transition-colors"
            style={{ fontSize: 13 }}
          >
            GitHub
          </a>
          <span className="text-[var(--theme-border)]">·</span>
          <a
            href="https://github.com/CasaVargas/DebridDownloader/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--theme-text-ghost)] hover:text-[var(--theme-text-secondary)] transition-colors"
            style={{ fontSize: 13 }}
          >
            Discussions
          </a>
          <span className="text-[var(--theme-border)]">·</span>
          <a
            href="https://github.com/CasaVargas/DebridDownloader/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--theme-text-ghost)] hover:text-[var(--theme-text-secondary)] transition-colors"
            style={{ fontSize: 13 }}
          >
            Releases
          </a>
        </div>
      </div>
    </div>
  );
}
