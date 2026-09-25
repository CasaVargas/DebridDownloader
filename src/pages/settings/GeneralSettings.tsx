import { useEffect, useState } from "react";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { setMagnetHandler } from "../../api/magnet";
import { Button, cn, Select, SettingsGroup, SettingsRow, Toggle } from "../../components/ui";
import { useAppearance, type ThemePref } from "../../hooks/useAppearance";
import { ACCENTS, ACCENT_NAMES } from "../../theme/accents";
import { useSettings } from "./useSettings";

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export default function GeneralSettings() {
  const { frontend, applyFrontend } = useSettings();
  const appearance = useAppearance();
  // The OS is the source of truth for autostart; show its state like the old page did.
  const [launchAtLogin, setLaunchAtLogin] = useState(frontend.launch_at_login);

  useEffect(() => {
    isAutostartEnabled().then(setLaunchAtLogin).catch(() => {});
  }, []);

  return (
    <>
      <SettingsGroup title="Startup">
        <SettingsRow label="Launch at login" description="Start DebridDownloader when you log in to your computer">
          <Toggle
            label="Launch at login"
            checked={launchAtLogin}
            onChange={async (v) => {
              try {
                if (v) await enableAutostart();
                else await disableAutostart();
                setLaunchAtLogin(v);
                applyFrontend({ launch_at_login: v });
              } catch (e) {
                console.error("Autostart error:", e);
              }
            }}
          />
        </SettingsRow>
        <SettingsRow label="Set as default magnet link handler" description="Open magnet links from your browser directly in DebridDownloader">
          <Toggle
            label="Set as default magnet link handler"
            checked={frontend.handle_magnet_links}
            onChange={async (v) => {
              try {
                await setMagnetHandler(v);
                applyFrontend({ handle_magnet_links: v });
              } catch (e) {
                console.error("Failed to set magnet handler:", e);
              }
            }}
          />
        </SettingsRow>
        <SettingsRow label="Notify when download completes" description="Show a system notification when a file finishes downloading">
          <Toggle
            label="Notify when download completes"
            checked={frontend.notify_on_complete}
            onChange={(v) => applyFrontend({ notify_on_complete: v })}
          />
        </SettingsRow>
        <SettingsRow label="Default sort order" description="How torrents are sorted when you open the app">
          <Select
            ariaLabel="Default sort key"
            value={frontend.default_sort_key}
            onValueChange={(v) => applyFrontend({ default_sort_key: v })}
            options={[
              { value: "added", label: "Date Added" },
              { value: "filename", label: "Name" },
              { value: "bytes", label: "Size" },
            ]}
          />
          <Select
            ariaLabel="Default sort direction"
            value={frontend.default_sort_direction}
            onValueChange={(v) => applyFrontend({ default_sort_direction: v })}
            options={[
              { value: "desc", label: "Newest first" },
              { value: "asc", label: "Oldest first" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme" description="System follows your OS light/dark setting">
          <div role="radiogroup" aria-label="Theme" className="inline-flex gap-0.5 rounded-md border border-border p-0.5">
            {THEMES.map((t) => (
              <Button
                key={t.id}
                size="sm"
                role="radio"
                aria-checked={appearance.theme === t.id}
                variant={appearance.theme === t.id ? "primary" : "ghost"}
                onClick={() => appearance.setTheme(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="Accent color" description="Used for the primary action, selection, progress, and focus">
          <div className="flex items-center gap-2.5">
            {ACCENT_NAMES.map((a) => (
              <button
                key={a}
                type="button"
                aria-label={ACCENTS[a].label}
                aria-pressed={appearance.accent === a}
                onClick={() => appearance.setAccent(a)}
                className={cn(
                  "size-5 rounded-full transition-transform duration-120 hover:scale-110",
                  appearance.accent === a && "outline-2 outline-offset-2 outline-fg",
                )}
                style={{ background: ACCENTS[a][appearance.resolvedTheme] }}
              />
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
