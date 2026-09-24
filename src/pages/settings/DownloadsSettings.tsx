import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { detectRarTool } from "../../api/settings";
import { validateRcloneRemote } from "../../api/rclone";
import { useRclone, isRclonePath } from "../../hooks/useRclone";
import { Button, cn, Input, Select, SettingsField, SettingsGroup, SettingsRow, Toggle } from "../../components/ui";
import { useSettings } from "./useSettings";

const CloudIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);

const SPEED_LIMITS = [
  { value: "0", label: "Unlimited" },
  { value: "1048576", label: "1 MB/s" },
  { value: "5242880", label: "5 MB/s" },
  { value: "10485760", label: "10 MB/s" },
  { value: "26214400", label: "25 MB/s" },
  { value: "52428800", label: "50 MB/s" },
  { value: "104857600", label: "100 MB/s" },
];

export default function DownloadsSettings() {
  const { settings, applyChange, frontend, applyFrontend, savedField, markSaved } = useSettings();
  const { rcloneInfo, remotes, refreshRemotes } = useRclone();
  const [pathInput, setPathInput] = useState(settings?.download_folder ?? "");
  const [pathError, setPathError] = useState<string | null>(null);
  const [rarTool, setRarTool] = useState<string | null>(null);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    detectRarTool().then(setRarTool).catch(() => setRarTool(null));
    return () => { if (validateTimerRef.current) clearTimeout(validateTimerRef.current); };
  }, []);

  if (!settings) return <p className="text-sm text-danger">Failed to load settings.</p>;

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

  async function handleBrowse() {
    const selected = await open({ directory: true, title: "Select download folder" });
    if (selected && typeof selected === "string") {
      handlePathSet(selected);
    }
  }

  return (
    <>
      <SettingsGroup>
        <SettingsField
          label="Download folder"
          description="Local path or rclone remote (e.g. gdrive:Media/Movies)"
          saved={savedField === "download_folder"}
        >
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={pathInput}
              onChange={(e) => handlePathInput(e.target.value)}
              placeholder="Not set — you'll be asked each time"
              aria-label="Download folder"
              icon={isRclonePath(pathInput) ? <CloudIcon /> : undefined}
            />
            <Button onClick={handleBrowse}>Choose…</Button>
          </div>
          {pathError && <p className="text-sm text-danger" role="alert">{pathError}</p>}
        </SettingsField>
        <SettingsRow
          label="Create a folder per torrent"
          description="Organize downloads into folders named after each torrent"
          saved={savedField === "create_torrent_subfolders"}
        >
          <Toggle
            label="Create a folder per torrent"
            checked={settings.create_torrent_subfolders}
            onChange={async (v) => {
              await applyChange({ create_torrent_subfolders: v });
              markSaved("create_torrent_subfolders");
            }}
          />
        </SettingsRow>
        <SettingsRow label="Start downloads automatically" description="Automatically download torrents when they finish processing on the provider">
          <Toggle
            label="Start downloads automatically"
            checked={frontend.auto_start_downloads}
            onChange={(v) => applyFrontend({ auto_start_downloads: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Speed">
        <SettingsRow label="Simultaneous downloads" saved={savedField === "max_concurrent_downloads"}>
          <Select
            ariaLabel="Simultaneous downloads"
            value={String(settings.max_concurrent_downloads)}
            onValueChange={async (v) => {
              await applyChange({ max_concurrent_downloads: Number(v) });
              markSaved("max_concurrent_downloads");
            }}
            options={[1, 2, 3, 4, 5, 8, 10].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Connections per file"
          description="Lower this if your provider limits connections"
          saved={savedField === "segments_per_file"}
        >
          <Select
            ariaLabel="Connections per file"
            value={String(settings.segments_per_file ?? 4)}
            onValueChange={async (v) => {
              await applyChange({ segments_per_file: Number(v) });
              markSaved("segments_per_file");
            }}
            options={[1, 2, 4, 8, 16].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </SettingsRow>
        <SettingsRow label="Speed limit" saved={savedField === "speed_limit_bytes"}>
          <Select
            ariaLabel="Speed limit"
            value={String(settings.speed_limit_bytes ?? 0)}
            onValueChange={async (v) => {
              const val = Number(v);
              await applyChange({ speed_limit_bytes: val === 0 ? null : val });
              markSaved("speed_limit_bytes");
            }}
            options={SPEED_LIMITS}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="After download">
        <SettingsRow
          label="Auto-extract downloaded archives"
          description="After download, automatically unpack .rar / .zip / .7z / .tar.gz archives into a subfolder"
          saved={savedField === "auto_extract_archives"}
        >
          <Toggle
            label="Auto-extract downloaded archives"
            checked={settings.auto_extract_archives ?? false}
            onChange={async (v) => {
              await applyChange({ auto_extract_archives: v });
              markSaved("auto_extract_archives");
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="Delete archive files after successful extract"
          description="Remove the original .rar / .zip / .7z parts once extraction completes"
          saved={savedField === "delete_archives_after_extract"}
        >
          <Toggle
            label="Delete archive files after successful extract"
            checked={settings.delete_archives_after_extract ?? false}
            disabled={!settings.auto_extract_archives}
            onChange={async (v) => {
              await applyChange({ delete_archives_after_extract: v });
              markSaved("delete_archives_after_extract");
            }}
          />
        </SettingsRow>
        <p className={cn("px-3 py-2 text-sm", rarTool ? "text-success" : "text-warning")}>
          {rarTool
            ? `✓ RAR support: ${rarTool} detected`
            : "⚠ RAR support: install 7-Zip (macOS/Windows), p7zip-full (Linux), or unar to extract .rar archives"}
        </p>
      </SettingsGroup>

      <SettingsGroup title="Remote (rclone)">
        {rcloneInfo?.available ? (
          <>
            <SettingsRow label="rclone" description={`${rcloneInfo.version} — download directly to cloud storage without using local disk`} />
            <SettingsField label="Your remotes" description="Pick a remote to use it as the download folder">
              <div className="flex flex-wrap items-center gap-2">
                {remotes.map((remote) => (
                  <Button
                    key={remote}
                    size="sm"
                    variant={pathInput === remote ? "primary" : "secondary"}
                    aria-pressed={pathInput === remote}
                    onClick={() => handlePathSet(remote)}
                  >
                    <CloudIcon /> {remote}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={refreshRemotes}>
                  {remotes.length > 0 ? "Refresh" : "Load Remotes"}
                </Button>
              </div>
              {remotes.length === 0 && (
                <p className="text-sm text-fg-muted">
                  Set up remotes with <code className="rounded-sm bg-raised px-1 font-mono">rclone config</code> in your terminal
                </p>
              )}
            </SettingsField>
          </>
        ) : (
          <SettingsRow
            label="rclone not detected"
            description="Stream downloads directly to Google Drive, OneDrive, S3, or any cloud storage — no local disk needed"
          >
            <a href="https://rclone.org/install/" target="_blank" rel="noopener noreferrer" className="text-sm text-accent-text hover:underline">
              Install rclone
            </a>
          </SettingsRow>
        )}
      </SettingsGroup>
    </>
  );
}
