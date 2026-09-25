import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button, SettingsGroup, SettingsRow, Spinner, Toggle } from "../../components/ui";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "available"; version: string }
  | { state: "downloading"; progress: number }
  | { state: "ready" }
  | { state: "error"; message: string };

const CHANGELOG: { version: string; title: string; items: string[] }[] = [
  {
    version: "1.7.0",
    title: "New Download Engine & Redesign",
    items: [
      "New download engine: multiple connections per file (up to 16)",
      "Downloads resume after connection drops, app restarts, and crashes instead of starting over",
      "Expired download links refresh automatically",
      "Pause and resume downloads one at a time or all at once; retry failed downloads",
      "Speed limit and simultaneous-download limit now apply app-wide and take effect instantly",
      "Waits for the network to come back instead of failing",
      "Redesigned interface: native look with System, Light, and Dark mode",
      "Keyboard shortcuts on every platform (⌘ on macOS, Ctrl on Windows and Linux)",
      "Details panel with per-connection progress; Settings reorganized into sections",
      "Plain-language error messages from Real-Debrid, TorBox, and Premiumize",
      "Closing the window keeps DebridDownloader running in the tray",
    ],
  },
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
];

const linkClass = "text-accent-text hover:underline";

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

export default function BackupSettings() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [version, setVersion] = useState("");
  const [changelogExpanded, setChangelogExpanded] = useState(false);
  const [includeCredentials, setIncludeCredentials] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
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

  const handleExport = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const { exportSettings } = await import("../../api/backup");
      const frontendJson = localStorage.getItem("frontend-settings") ?? "{}";
      const json = await exportSettings(includeCredentials, frontendJson);
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
  };

  const handleImport = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const { importSettings } = await import("../../api/backup");
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
  };

  const updateControl = () => {
    switch (status.state) {
      case "idle":
        return <Button size="sm" onClick={handleCheckForUpdates}>Check for Updates</Button>;
      case "checking":
        return <span className="flex items-center gap-2 text-sm text-fg-muted"><Spinner size="sm" /> Checking for updates...</span>;
      case "up-to-date":
        return <span className="text-sm text-fg-muted">You're on the latest version</span>;
      case "available":
        return <span className="flex items-center gap-2 text-sm text-fg-muted"><Spinner size="sm" /> Downloading v{status.version}...</span>;
      case "downloading":
        return (
          <div className="flex w-40 flex-col items-end gap-1">
            <div className="h-0.75 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={status.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-all duration-120" style={{ width: `${status.progress}%` }} />
            </div>
            <span className="text-sm text-fg-muted tabular">Downloading... {status.progress}%</span>
          </div>
        );
      case "ready":
        return <Button variant="primary" size="sm" onClick={handleRelaunch}>Restart to Update</Button>;
      case "error":
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm text-danger">{status.message}</span>
            <Button variant="ghost" size="sm" onClick={handleCheckForUpdates}>Try again</Button>
          </div>
        );
    }
  };

  return (
    <>
      <SettingsGroup title="About">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <img src="/app-icon.png" alt="" className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="text-md font-medium text-fg">DebridDownloader</div>
            <div className="text-sm text-fg-muted tabular">Version {version}</div>
          </div>
          {updateControl()}
        </div>
        <SettingsRow
          label="A fast, native desktop client for debrid services"
          description="Manage torrents and downloads through Real-Debrid, TorBox, and Premiumize. Built with Tauri, React, and Rust."
        />
        <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
          <ExtLink href="https://github.com/CasaVargas/DebridDownloader">GitHub</ExtLink>
          <span className="text-fg-muted">·</span>
          <ExtLink href="https://github.com/CasaVargas/DebridDownloader/discussions">Discussions</ExtLink>
          <span className="text-fg-muted">·</span>
          <ExtLink href="https://github.com/CasaVargas/DebridDownloader/releases">Releases</ExtLink>
        </div>
      </SettingsGroup>

      <SettingsGroup title="What's new">
        {CHANGELOG.filter((_, i) => changelogExpanded || i === 0).map((entry) => (
          <div key={entry.version} className="px-3 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-fg-secondary tabular">v{entry.version}</span>
              <span className="text-base font-medium text-fg">{entry.title}</span>
            </div>
            <ul className="ml-4 mt-1 list-disc">
              {entry.items.map((item) => (
                <li key={item} className="text-sm text-fg-muted">{item}</li>
              ))}
            </ul>
          </div>
        ))}
        <div className="px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setChangelogExpanded((v) => !v)} aria-expanded={changelogExpanded}>
            {changelogExpanded ? "Show less" : "Show older releases"}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Support">
        <SettingsRow
          label="Sponsor the developer"
          description="If you enjoy using DebridDownloader, consider sponsoring continued development of great apps and utilities."
        >
          <a
            href="https://github.com/sponsors/prjoni99"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-6 items-center rounded-md border border-border bg-raised px-2 text-sm font-medium text-fg hover:bg-selected"
          >
            Sponsor on GitHub
          </a>
        </SettingsRow>
        <SettingsRow label="More from CasaVargas" description="Check out my other projects">
          <ExtLink href="https://casavargas.app">casavargas.app</ExtLink>
        </SettingsRow>
        <SettingsRow label="Beltr" description="AI karaoke — turn any song into a karaoke track">
          <ExtLink href="https://beltr.app">beltr.app</ExtLink>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Backup">
        <SettingsRow label="Export settings" description="Save all settings, trackers, and watch rules to a file">
          <Button size="sm" onClick={handleExport}>Export</Button>
        </SettingsRow>
        <SettingsRow label="Include API keys and tokens" description="Adds your credentials to the exported file">
          <Toggle label="Include API keys and tokens" checked={includeCredentials} onChange={setIncludeCredentials} />
        </SettingsRow>
        <SettingsRow label="Import settings" description="Restore settings from a previously exported file">
          <Button size="sm" onClick={handleImport}>Import</Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
