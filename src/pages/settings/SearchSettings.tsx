import { useEffect, useState } from "react";
import { getTrackerConfigs, saveTrackerConfigs, testTracker } from "../../api/search";
import { getActiveProvider } from "../../api/providers";
import type { TrackerConfig } from "../../types";
import { Button, Dialog, IconButton, Input, Select, SettingsGroup, SettingsRow, Spinner, Toggle } from "../../components/ui";
import { useSettings } from "./useSettings";

const TRACKER_TYPES = [
  { value: "piratebay_api", label: "API (TPB-style)" },
  { value: "torznab", label: "Torznab" },
  { value: "prowlarr", label: "Prowlarr" },
  { value: "jackett", label: "Jackett" },
];

function typeLabel(t: string): string {
  return t === "piratebay_api" ? "API" : t === "torznab" ? "Torznab" : t === "prowlarr" ? "Prowlarr" : t === "jackett" ? "Jackett" : t;
}

export default function SearchSettings() {
  const { settings, applyChange, savedField, markSaved } = useSettings();
  const [trackers, setTrackers] = useState<TrackerConfig[]>([]);
  const [activeProvider, setActiveProvider] = useState("real-debrid");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Add/edit tracker form
  const [newTrackerName, setNewTrackerName] = useState("");
  const [newTrackerUrl, setNewTrackerUrl] = useState("");
  const [newTrackerType, setNewTrackerType] = useState("piratebay_api");
  const [newTrackerApiKey, setNewTrackerApiKey] = useState("");
  const [editingTrackerId, setEditingTrackerId] = useState<string | null>(null);
  const [trackerTestResult, setTrackerTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [trackerTesting, setTrackerTesting] = useState(false);

  useEffect(() => {
    getTrackerConfigs().catch(() => [] as TrackerConfig[]).then(setTrackers);
    getActiveProvider().then(setActiveProvider).catch(() => {});
  }, []);

  async function handleAddTracker() {
    if (!newTrackerName.trim() || !newTrackerUrl.trim()) return;
    let url = newTrackerUrl.trim().replace(/\/+$/, "");
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    if (newTrackerType === "jackett" && !url.includes("/api/")) {
      url = url.replace(/\/UI.*$/, "");
      url = url.replace(/\/+$/, "");
      url += "/api/v2.0/indexers/all/results/torznab";
    }
    if (newTrackerType === "torznab") {
      url = url.replace(/\/api\/?$/, "");
    }
    if (newTrackerType === "prowlarr") {
      url = url.replace(/\/api\/v1(?:\/search|\/health|\/indexer)?\/?$/, "");
    }
    if (newTrackerType === "piratebay_api") {
      url = url.replace(/\/q\.php.*$/, "");
    }
    url = url.replace(/\/+$/, "");
    const config: TrackerConfig = {
      id: editingTrackerId ?? crypto.randomUUID(),
      name: newTrackerName.trim(),
      url,
      tracker_type: newTrackerType,
      enabled: true,
      api_key: newTrackerApiKey.trim() || undefined,
    };
    const next = editingTrackerId
      ? trackers.map((t) => t.id === editingTrackerId ? config : t)
      : [...trackers, config];
    setTrackers(next);
    try {
      await saveTrackerConfigs(next);
      markSaved("trackers");
    } catch (e) {
      console.error("Failed to save tracker configs:", e);
    }
    handleCancelEdit();
  }

  function handleEditTracker(tracker: TrackerConfig) {
    setEditingTrackerId(tracker.id);
    setNewTrackerName(tracker.name);
    setNewTrackerUrl(tracker.url);
    setNewTrackerType(tracker.tracker_type);
    setNewTrackerApiKey(tracker.api_key ?? "");
    setTrackerTestResult(null);
    setDialogOpen(true);
  }

  function handleCancelEdit() {
    setEditingTrackerId(null);
    setNewTrackerName("");
    setNewTrackerUrl("");
    setNewTrackerType("piratebay_api");
    setNewTrackerApiKey("");
    setTrackerTestResult(null);
    setDialogOpen(false);
  }

  async function handleTestTracker() {
    if (!newTrackerUrl.trim()) return;
    setTrackerTesting(true);
    setTrackerTestResult(null);
    let url = newTrackerUrl.trim().replace(/\/+$/, "");
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    try {
      const msg = await testTracker(newTrackerType, url, newTrackerApiKey.trim() || undefined);
      setTrackerTestResult({ ok: true, msg });
    } catch (e) {
      setTrackerTestResult({ ok: false, msg: String(e) });
    } finally {
      setTrackerTesting(false);
    }
  }

  async function handleRemoveTracker(id: string) {
    if (editingTrackerId === id) handleCancelEdit();
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

  const needsKey = newTrackerType === "torznab" || newTrackerType === "prowlarr" || newTrackerType === "jackett" || !!newTrackerApiKey;

  return (
    <>
      <SettingsGroup title="Trackers">
        <SettingsRow label="Search sources" description="Trackers and indexers used by Search" saved={savedField === "trackers"}>
          <Button variant="primary" size="sm" onClick={() => { handleCancelEdit(); setDialogOpen(true); }}>
            Add tracker
          </Button>
        </SettingsRow>
        {trackers.length === 0 && (
          <SettingsRow label="No trackers configured" description="Add a tracker to enable search" />
        )}
        {trackers.map((tracker) => (
          <div key={tracker.id} className="flex items-center gap-3 px-3 py-2.5">
            <Toggle label={`Enable ${tracker.name}`} checked={tracker.enabled} onChange={() => handleToggleTracker(tracker.id)} />
            <div className={tracker.enabled ? "min-w-0 flex-1" : "min-w-0 flex-1 opacity-60"}>
              <div className="flex items-baseline gap-2">
                <span className="truncate text-base text-fg">{tracker.name}</span>
                <span className="shrink-0 text-sm text-fg-muted">{typeLabel(tracker.tracker_type)}</span>
              </div>
              <div className="truncate text-sm text-fg-muted">{tracker.url}</div>
            </div>
            <IconButton label={`Edit ${tracker.name}`} onClick={() => handleEditTracker(tracker)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </IconButton>
            <IconButton label={`Delete ${tracker.name}`} variant="danger" onClick={() => handleRemoveTracker(tracker.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </IconButton>
          </div>
        ))}
      </SettingsGroup>

      {activeProvider === "torbox" && settings && (
        <SettingsGroup title="Built-in">
          <SettingsRow
            label="TorBox Search"
            description="Search torrents using the TorBox Search API with your existing API key"
            saved={savedField === "torbox_search_enabled"}
          >
            <Toggle
              label="TorBox Search"
              checked={settings.torbox_search_enabled ?? false}
              onChange={async (v) => {
                await applyChange({ torbox_search_enabled: v });
                markSaved("torbox_search_enabled");
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => { if (!o) handleCancelEdit(); }}
        title={editingTrackerId ? "Edit Tracker" : "Add Tracker"}
        description={
          newTrackerType === "torznab"
            ? "Connect to a Torznab-compatible indexer"
            : newTrackerType === "prowlarr"
            ? "Connect to Prowlarr to search all configured indexers"
            : newTrackerType === "jackett"
            ? "Connect to Jackett — paste the base URL and it will be auto-corrected"
            : "Connect to a site with a TPB-compatible JSON API"
        }
        footer={
          <>
            <Button onClick={handleTestTracker} disabled={!newTrackerUrl.trim() || trackerTesting} className="mr-auto">
              {trackerTesting ? <><Spinner size="sm" /> Testing</> : "Test"}
            </Button>
            <Button variant="ghost" onClick={handleCancelEdit}>Cancel</Button>
            <Button variant="primary" onClick={handleAddTracker} disabled={!newTrackerName.trim() || !newTrackerUrl.trim()}>
              {editingTrackerId ? "Save Changes" : "Add Tracker"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              className="flex-1"
              value={newTrackerName}
              onChange={(e) => setNewTrackerName(e.target.value)}
              placeholder="Tracker name"
              aria-label="Tracker name"
              autoFocus
            />
            <Select
              ariaLabel="Tracker type"
              value={newTrackerType}
              onValueChange={(v) => { setNewTrackerType(v); setTrackerTestResult(null); }}
              options={TRACKER_TYPES}
              className="w-44"
            />
          </div>
          <Input
            className="font-mono"
            value={newTrackerUrl}
            onChange={(e) => { setNewTrackerUrl(e.target.value); setTrackerTestResult(null); }}
            placeholder={newTrackerType === "prowlarr" ? "http://localhost:9696" : newTrackerType === "torznab" ? "http://localhost:9696/1/api" : newTrackerType === "jackett" ? "http://localhost:9117" : "https://example.org"}
            aria-label="Tracker URL"
            onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
          />
          {needsKey && (
            <Input
              className="font-mono"
              value={newTrackerApiKey}
              onChange={(e) => { setNewTrackerApiKey(e.target.value); setTrackerTestResult(null); }}
              placeholder={newTrackerType === "torznab" || newTrackerType === "jackett" ? "API Key (required)" : "API Key (optional)"}
              aria-label="API key"
              onKeyDown={(e) => e.key === "Enter" && handleAddTracker()}
            />
          )}
          {(newTrackerType === "torznab" || newTrackerType === "jackett") && !newTrackerApiKey.trim() && (
            <p className="text-sm text-warning">{newTrackerType === "jackett" ? "Jackett" : "Torznab"} trackers require an API key</p>
          )}
          {trackerTestResult && (
            <p className={trackerTestResult.ok ? "text-sm text-success" : "text-sm text-danger"} role="status">
              {trackerTestResult.msg}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
