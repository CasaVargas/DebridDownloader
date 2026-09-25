import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import * as watchlistApi from "../api/watchlist";
import type { WatchRule, WatchMatch } from "../types";
import DataTable, { type Column } from "../components/DataTable";
import { Button, cn, Dialog, EmptyState, IconButton, Input, Menu, Select, Spinner, StatusDot, Toggle, Toolbar } from "../components/ui";

/** Radix Select can't use "" as a value; "All" categories maps to this sentinel. */
const ALL = "__all__";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-sm text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function intervalLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${mins / 60}h`;
}

// ── Rule Modal ──────────────────────────────────────────────────────

interface RuleModalProps {
  rule: WatchRule | null;
  onClose: () => void;
  onSave: (rule: WatchRule) => Promise<void>;
}

function RuleModal({ rule, onClose, onSave }: RuleModalProps) {
  const isEdit = rule !== null;
  const [name, setName] = useState(rule?.name ?? "");
  const [ruleType, setRuleType] = useState<"Keyword" | "TvShow">(
    rule?.rule_type.type === "TvShow" ? "TvShow" : "Keyword"
  );
  const [query, setQuery] = useState(rule?.query ?? "");
  const [category, setCategory] = useState(rule?.category ?? "");
  const [action, setAction] = useState<"Notify" | "AutoAdd">(rule?.action ?? "Notify");
  const [intervalMinutes, setIntervalMinutes] = useState(rule?.interval_minutes ?? 30);
  const [regexFilter, setRegexFilter] = useState(rule?.regex_filter ?? "");
  const [minSeeders, setMinSeeders] = useState(rule?.min_seeders?.toString() ?? "");
  const [minSize, setMinSize] = useState(rule?.min_size_bytes?.toString() ?? "");
  const [maxSize, setMaxSize] = useState(rule?.max_size_bytes?.toString() ?? "");
  const [lastSeason, setLastSeason] = useState(
    rule?.rule_type.type === "TvShow" ? (rule.rule_type.last_season?.toString() ?? "") : ""
  );
  const [lastEpisode, setLastEpisode] = useState(
    rule?.rule_type.type === "TvShow" ? (rule.rule_type.last_episode?.toString() ?? "") : ""
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!name.trim() || !query.trim()) {
      setError("Name and query are required");
      return;
    }
    setSaving(true);
    setError("");

    const newRule: WatchRule = {
      id: rule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      rule_type:
        ruleType === "TvShow"
          ? {
              type: "TvShow",
              last_season: lastSeason ? parseInt(lastSeason) : null,
              last_episode: lastEpisode ? parseInt(lastEpisode) : null,
            }
          : { type: "Keyword" },
      query: query.trim(),
      category: category || null,
      regex_filter: regexFilter || null,
      min_seeders: minSeeders ? parseInt(minSeeders) : null,
      min_size_bytes: minSize ? parseInt(minSize) : null,
      max_size_bytes: maxSize ? parseInt(maxSize) : null,
      action,
      interval_minutes: intervalMinutes,
      enabled: rule?.enabled ?? true,
      created_at: rule?.created_at ?? new Date().toISOString(),
      last_checked: rule?.last_checked ?? null,
    };

    try {
      await onSave(newRule);
    } catch (e: any) {
      setError(e?.toString() ?? "Failed to save");
      setSaving(false);
    }
  };

  const categories = [
    { value: "", label: "All" },
    { value: "movies", label: "Movies" },
    { value: "tv", label: "TV" },
    { value: "music", label: "Music" },
    { value: "games", label: "Games" },
    { value: "software", label: "Software" },
  ];

  const intervals = [
    { value: 15, label: "15 minutes" },
    { value: 30, label: "30 minutes" },
    { value: 60, label: "1 hour" },
    { value: 120, label: "2 hours" },
    { value: 360, label: "6 hours" },
  ];

  const segClass = (active: boolean) =>
    cn(
      "h-6 rounded-sm px-2.5 text-sm font-medium transition-colors duration-120",
      active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-raised hover:text-fg",
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={isEdit ? "Edit Rule" : "Add Rule"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Update" : "Create"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Watch Rule" />
        </Field>

        <Field label="Type">
          <div role="radiogroup" aria-label="Type" className="inline-flex gap-0.5 self-start rounded-md border border-border p-0.5">
            {(["Keyword", "TvShow"] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={ruleType === t} onClick={() => setRuleType(t)} className={segClass(ruleType === t)}>
                {t === "TvShow" ? "TV Show" : "Keyword"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Search Query">
          <Input aria-label="Search Query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g., Breaking Bad 2160p" />
        </Field>

        <Field label="Category">
          <Select
            ariaLabel="Category"
            value={category || ALL}
            onValueChange={(v) => setCategory(v === ALL ? "" : v)}
            options={categories.map((c) => ({ value: c.value || ALL, label: c.label }))}
            className="self-start"
          />
        </Field>

        {ruleType === "TvShow" && (
          <div className="flex gap-3">
            <Field label="Start from Season (optional)">
              <Input aria-label="Start from Season" type="number" min="1" value={lastSeason} onChange={(e) => setLastSeason(e.target.value)} placeholder="Auto-detect" />
            </Field>
            <Field label="Start from Episode (optional)">
              <Input aria-label="Start from Episode" type="number" min="0" value={lastEpisode} onChange={(e) => setLastEpisode(e.target.value)} placeholder="Auto-detect" />
            </Field>
          </div>
        )}

        <Field label="Action">
          <div role="radiogroup" aria-label="Action" className="inline-flex gap-0.5 self-start rounded-md border border-border p-0.5">
            {(["Notify", "AutoAdd"] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={action === a} onClick={() => setAction(a)} className={segClass(action === a)}>
                {a === "AutoAdd" ? "Auto-Add" : "Notify"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Check Interval">
          <Select
            ariaLabel="Check Interval"
            value={String(intervalMinutes)}
            onValueChange={(v) => setIntervalMinutes(parseInt(v))}
            options={intervals.map((i) => ({ value: String(i.value), label: i.label }))}
            className="self-start"
          />
        </Field>

        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced}>
            {showAdvanced ? "Hide" : "Show"} Advanced Filters
          </Button>
        </div>

        {showAdvanced && (
          <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
            <Field label="Regex Filter (applied to title)">
              <Input aria-label="Regex Filter" value={regexFilter} onChange={(e) => setRegexFilter(e.target.value)} placeholder="e.g., (2160p|4K)" />
            </Field>
            <Field label="Min Seeders">
              <Input aria-label="Min Seeders" type="number" min="0" value={minSeeders} onChange={(e) => setMinSeeders(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Field label="Min Size (bytes)">
                <Input aria-label="Min Size (bytes)" type="number" min="0" value={minSize} onChange={(e) => setMinSize(e.target.value)} />
              </Field>
              <Field label="Max Size (bytes)">
                <Input aria-label="Max Size (bytes)" type="number" min="0" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

// ── Watch List Page ─────────────────────────────────────────────────

export default function WatchListPage() {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [matches, setMatches] = useState<WatchMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<WatchRule | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        watchlistApi.getWatchRules(),
        watchlistApi.getWatchMatches(),
      ]);
      setRules(r);
      setMatches(m);
    } catch (e) {
      console.error("Failed to load watch list data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unlisten = listen("watchlist-match", () => {
      loadData();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadData]);

  useEffect(() => {
    localStorage.setItem("last_visited_watchlist", new Date().toISOString());
  }, []);

  const handleToggle = async (rule: WatchRule) => {
    const updated = { ...rule, enabled: !rule.enabled };
    await watchlistApi.updateWatchRule(updated);
    loadData();
  };

  const handleDelete = async (id: string) => {
    await watchlistApi.deleteWatchRule(id);
    if (selectedRuleId === id) setSelectedRuleId(null);
    loadData();
  };

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      await watchlistApi.runWatchRuleNow(id);
      await loadData();
    } catch (e) {
      console.error("Run failed:", e);
    } finally {
      setRunningId(null);
    }
  };

  const handleClearMatches = async () => {
    await watchlistApi.clearWatchMatches(selectedRuleId ?? undefined);
    loadData();
  };

  const filteredMatches = selectedRuleId
    ? matches.filter((m) => m.rule_id === selectedRuleId)
    : matches;

  const ruleNameMap = Object.fromEntries(rules.map((r) => [r.id, r.name]));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Newest first, keyed by position like before (the same hash can match twice).
  const matchRows = [...filteredMatches].reverse().map((m, i) => ({ m, key: `${m.info_hash}-${i}` }));

  const matchColumns: Column<{ m: WatchMatch; key: string }>[] = [
    { key: "title", header: "Title", width: "minmax(0, 1fr)", render: ({ m }) => <div className="truncate text-base text-fg" title={m.title}>{m.title}</div> },
    ...(!selectedRuleId
      ? [{ key: "rule", header: "Rule", width: 32, render: ({ m }: { m: WatchMatch }) => <span className="block truncate text-sm text-fg-secondary">{ruleNameMap[m.rule_id] ?? "Unknown"}</span> }]
      : []),
    { key: "size", header: "Size", width: 20, render: ({ m }) => <span className="text-base text-fg-secondary tabular">{formatBytes(m.size_bytes)}</span> },
    { key: "matched", header: "Matched", width: 20, render: ({ m }) => <span className="text-sm text-fg-muted tabular">{formatRelativeTime(m.matched_at)}</span> },
    {
      key: "status",
      header: "Status",
      width: 22,
      render: ({ m }) => (
        <>
          {m.status.type === "Notified" && <StatusDot status="warning">Notified</StatusDot>}
          {m.status.type === "Added" && <StatusDot status="success">Added</StatusDot>}
          {m.status.type === "Failed" && <span title={m.status.reason}><StatusDot status="danger">Failed</StatusDot></span>}
        </>
      ),
    },
    {
      key: "add",
      header: "",
      width: 14,
      render: ({ m }) =>
        m.status.type === "Notified" ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const { addMagnet, selectTorrentFiles } = await import("../api/torrents");
                  const resp = await addMagnet(m.magnet);
                  await selectTorrentFiles(resp.id, "all").catch(() => {});
                } catch (e) {
                  console.error("Failed to add magnet:", e);
                }
              }}
            >
              Add
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Toolbar
        title="Watch List"
        subtitle={`${rules.length} ${rules.length === 1 ? "rule" : "rules"}`}
        actions={
          <Button variant="primary" onClick={() => { setEditingRule(null); setShowModal(true); }}>
            New Rule
          </Button>
        }
      />

      {/* Rules */}
      <div className="min-h-0 shrink-0 overflow-auto px-4 py-3" style={{ maxHeight: "50%" }}>
        {rules.length === 0 ? (
          <EmptyState title="No watch rules yet" hint="Create a rule to start monitoring your trackers" />
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((rule) => {
              const selected = selectedRuleId === rule.id;
              const typeLabel =
                rule.rule_type.type === "TvShow"
                  ? `TV${rule.rule_type.last_season != null ? ` S${String(rule.rule_type.last_season).padStart(2, "0")}E${String(rule.rule_type.last_episode ?? 0).padStart(2, "0")}` : ""}`
                  : "Keyword";
              return (
                <div
                  key={rule.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border px-3 py-2",
                    selected ? "bg-selected" : "bg-surface",
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedRuleId(selected ? null : rule.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-base font-medium text-fg">{rule.name}</span>
                      <span className="shrink-0 text-sm text-fg-muted">{typeLabel}</span>
                    </div>
                    <div className="truncate text-sm text-fg-muted tabular">
                      {rule.query} · {rule.action === "AutoAdd" ? "Auto-Add" : "Notify"} · every {intervalLabel(rule.interval_minutes)} · checked{" "}
                      {rule.last_checked ? formatRelativeTime(rule.last_checked) : "never"}
                    </div>
                  </button>
                  {runningId === rule.id && <Spinner size="sm" />}
                  <Toggle checked={rule.enabled} onChange={() => handleToggle(rule)} label={`Enable ${rule.name}`} />
                  <Menu
                    trigger={
                      <IconButton label={`Actions for ${rule.name}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </IconButton>
                    }
                    items={[
                      { label: "Edit", onSelect: () => { setEditingRule(rule); setShowModal(true); } },
                      { label: "Run now", onSelect: () => handleRunNow(rule.id), disabled: runningId === rule.id },
                      "separator",
                      { label: "Delete", danger: true, onSelect: () => handleDelete(rule.id) },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Matches */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div className="flex h-9 shrink-0 items-center justify-between px-4">
          <h2 className="text-md font-medium text-fg">
            Recent Matches
            {selectedRuleId && <span className="ml-2 font-normal text-fg-muted">— {ruleNameMap[selectedRuleId]}</span>}
          </h2>
          {filteredMatches.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearMatches}>
              Clear
            </Button>
          )}
        </div>
        <DataTable
          columns={matchColumns}
          data={matchRows}
          rowKey={(r) => r.key}
          emptyMessage="No matches yet"
        />
      </div>

      {/* Add/Edit Rule Modal */}
      {showModal && (
        <RuleModal
          rule={editingRule}
          onClose={() => { setShowModal(false); setEditingRule(null); }}
          onSave={async (rule) => {
            if (editingRule) {
              await watchlistApi.updateWatchRule(rule);
            } else {
              await watchlistApi.addWatchRule(rule);
            }
            setShowModal(false);
            setEditingRule(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
