import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Input, SettingsField, SettingsGroup, SettingsRow, Toggle } from "../../components/ui";
import { useSettings } from "./useSettings";

type TestResult = Record<string, { ok: boolean; msg: string }>;

/** Path text input + "Choose…" button. Typing saves on every change, as before. */
function PathInput({ value, placeholder, label, onChange, onChoose }: {
  value: string; placeholder: string; label: string; onChange(v: string): void; onChoose(): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input className="flex-1" value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      <Button onClick={onChoose}>Choose…</Button>
    </div>
  );
}

function ServerFields({ type, label, placeholder, url, credential, credentialPlaceholder, onUrl, onCredential, result, onTest }: {
  type: string; label: string; placeholder: string; url: string; credential: string; credentialPlaceholder: string;
  onUrl(v: string): void; onCredential(v: string): void; result?: { ok: boolean; msg: string }; onTest(): void;
}) {
  return (
    <SettingsField label={label} description="Trigger library scan after downloads complete">
      <Input value={url} placeholder={placeholder} aria-label={`${label} URL`} onChange={(e) => onUrl(e.target.value)} />
      <div className="flex items-center gap-2">
        <Input className="flex-1 font-mono" value={credential} placeholder={credentialPlaceholder} aria-label={`${label} ${credentialPlaceholder}`} onChange={(e) => onCredential(e.target.value)} />
        <Button size="sm" onClick={onTest} disabled={!url || !credential} aria-label={`Test ${type}`}>
          Test
        </Button>
      </div>
      {result && <p className={result.ok ? "text-sm text-success" : "text-sm text-danger"} role="status">{result.msg}</p>}
    </SettingsField>
  );
}

export default function LibrarySettings() {
  const { settings, applyChange, savedField, markSaved } = useSettings();
  const [mountPath, setMountPath] = useState(settings?.symlink_mount_path ?? "");
  const [libraryPath, setLibraryPath] = useState(settings?.symlink_library_path ?? "");
  const [moviesFolder, setMoviesFolder] = useState(settings?.movies_folder ?? "");
  const [tvFolder, setTvFolder] = useState(settings?.tv_folder ?? "");
  const [tmdbApiKey, setTmdbApiKey] = useState(settings?.tmdb_api_key ?? "");
  const [plexUrl, setPlexUrl] = useState(settings?.plex_url ?? "");
  const [plexToken, setPlexToken] = useState(settings?.plex_token ?? "");
  const [jellyfinUrl, setJellyfinUrl] = useState(settings?.jellyfin_url ?? "");
  const [jellyfinApiKey, setJellyfinApiKey] = useState(settings?.jellyfin_api_key ?? "");
  const [embyUrl, setEmbyUrl] = useState(settings?.emby_url ?? "");
  const [embyApiKey, setEmbyApiKey] = useState(settings?.emby_api_key ?? "");
  const [testResult, setTestResult] = useState<TestResult>({});

  if (!settings) return <p className="text-sm text-danger">Failed to load settings.</p>;

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
      const { testMediaServer } = await import("../../api/media_servers");
      const name = await testMediaServer(type, url, credential);
      setTestResult((prev) => ({ ...prev, [type]: { ok: true, msg: name } }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [type]: { ok: false, msg: String(e) } }));
    }
  }

  return (
    <>
      <SettingsGroup title="Organize">
        <SettingsRow
          label="Auto-organize media"
          description="Sort downloads into Movies and TV folder structures using TMDb metadata"
          saved={savedField === "auto_organize"}
        >
          <Toggle
            label="Auto-organize media"
            checked={settings.auto_organize ?? false}
            onChange={async (v) => {
              await applyChange({ auto_organize: v });
              markSaved("auto_organize");
            }}
          />
        </SettingsRow>
        {settings.auto_organize && (
          <>
            <SettingsField label="Movies folder" description="Movies are organized as: Movie Name (Year)/filename" saved={savedField === "movies_folder"}>
              <PathInput
                label="Movies folder"
                value={moviesFolder}
                placeholder="/media/Movies"
                onChange={(v) => { setMoviesFolder(v); applyChange({ movies_folder: v || null }); }}
                onChoose={handleBrowseMovies}
              />
            </SettingsField>
            <SettingsField label="TV folder" description="TV shows are organized as: Show Name/Season XX/filename" saved={savedField === "tv_folder"}>
              <PathInput
                label="TV folder"
                value={tvFolder}
                placeholder="/media/TV"
                onChange={(v) => { setTvFolder(v); applyChange({ tv_folder: v || null }); }}
                onChoose={handleBrowseTv}
              />
            </SettingsField>
            <SettingsField label="TMDb API key" description="Optional — using default key. Get your own from themoviedb.org">
              <Input
                className="font-mono"
                value={tmdbApiKey}
                placeholder="Using default key"
                aria-label="TMDb API key"
                onChange={(e) => { setTmdbApiKey(e.target.value); applyChange({ tmdb_api_key: e.target.value || null }); }}
              />
            </SettingsField>
            {(!moviesFolder || !tvFolder) && (
              <p className="px-3 py-2 text-sm text-warning">Both Movies and TV folders must be configured for auto-organize to work</p>
            )}
            {settings.symlink_mode && (
              <p className="px-3 py-2 text-sm text-info">Symlink mode active — files will be symlinked to these folders instead of the library folder</p>
            )}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title="Media servers">
        <ServerFields
          type="plex"
          label="Plex"
          placeholder="http://localhost:32400"
          url={plexUrl}
          credential={plexToken}
          credentialPlaceholder="X-Plex-Token"
          onUrl={(v) => { setPlexUrl(v); applyChange({ plex_url: v || null }); }}
          onCredential={(v) => { setPlexToken(v); applyChange({ plex_token: v || null }); }}
          result={testResult.plex}
          onTest={() => handleTestServer("plex", plexUrl, plexToken)}
        />
        <ServerFields
          type="jellyfin"
          label="Jellyfin"
          placeholder="http://localhost:8096"
          url={jellyfinUrl}
          credential={jellyfinApiKey}
          credentialPlaceholder="API Key"
          onUrl={(v) => { setJellyfinUrl(v); applyChange({ jellyfin_url: v || null }); }}
          onCredential={(v) => { setJellyfinApiKey(v); applyChange({ jellyfin_api_key: v || null }); }}
          result={testResult.jellyfin}
          onTest={() => handleTestServer("jellyfin", jellyfinUrl, jellyfinApiKey)}
        />
        <ServerFields
          type="emby"
          label="Emby"
          placeholder="http://localhost:8096"
          url={embyUrl}
          credential={embyApiKey}
          credentialPlaceholder="API Key"
          onUrl={(v) => { setEmbyUrl(v); applyChange({ emby_url: v || null }); }}
          onCredential={(v) => { setEmbyApiKey(v); applyChange({ emby_api_key: v || null }); }}
          result={testResult.emby}
          onTest={() => handleTestServer("emby", embyUrl, embyApiKey)}
        />
      </SettingsGroup>

      <SettingsGroup title="Symlink mode">
        <SettingsRow
          label="Create symlinks instead of downloading"
          description="Link files from your debrid mount to your media library — zero transfer, instant availability"
          saved={savedField === "symlink_mode"}
        >
          <Toggle
            label="Create symlinks instead of downloading"
            checked={settings.symlink_mode ?? false}
            onChange={async (v) => {
              await applyChange({ symlink_mode: v });
              markSaved("symlink_mode");
            }}
          />
        </SettingsRow>
        {settings.symlink_mode && (
          <>
            <SettingsField label="Mount path" description="Where your debrid files appear on the rclone mount" saved={savedField === "symlink_mount_path"}>
              <PathInput
                label="Mount path"
                value={mountPath}
                placeholder="/Volumes/realdebrid/torrents"
                onChange={(v) => { setMountPath(v); applyChange({ symlink_mount_path: v || null }); }}
                onChoose={handleBrowseMount}
              />
            </SettingsField>
            <SettingsField label="Library folder" description="Where Plex/Jellyfin scans for media" saved={savedField === "symlink_library_path"}>
              <PathInput
                label="Library folder"
                value={libraryPath}
                placeholder="/media/Movies"
                onChange={(v) => { setLibraryPath(v); applyChange({ symlink_library_path: v || null }); }}
                onChoose={handleBrowseLibrary}
              />
            </SettingsField>
            {(!mountPath || !libraryPath) && (
              <p className="px-3 py-2 text-sm text-warning">Both mount path and library folder must be configured for symlink mode to work</p>
            )}
          </>
        )}
      </SettingsGroup>
    </>
  );
}
