import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import DataTable, { type Column } from "../components/DataTable";
import { Button, IconButton, Inspector, Menu, StatusDot, Toolbar } from "../components/ui";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import { getSettings } from "../api/settings";
import type { AppSettings, DownloadTask } from "../types";
import { formatBytes, formatSpeed, formatEta } from "../utils";
import { downloadActions, downloadStatusView, isActiveStatus as isActive, isFailedStatus, postProcessingSteps } from "../lib/downloadStatus";

const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
);
const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="6 4 20 12 6 20 6 4" /></svg>
);
const RetryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
);
const CancelIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

function pctOf(t: DownloadTask): number {
  return t.total_bytes > 0 ? (t.downloaded_bytes / t.total_bytes) * 100 : 0;
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "rotate-90 transition-transform" : "transition-transform"}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
const FolderIcon = () => (
  <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/** Every job of one torrent / archive's contents, summarised as one row. */
interface Group {
  id: string;
  name: string;
  /** Unfinished jobs (the ones listed under the group). */
  active: DownloadTask[];
  files: number;
  done: number;
  failed: number;
  running: number;
  queued: number;
  paused: number;
  totalBytes: number;
  doneBytes: number;
  speed: number;
}

type Row = { kind: "group"; group: Group } | { kind: "task"; task: DownloadTask; child: boolean };

const groupKey = (id: string) => `batch:${id}`;

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-0.75 rounded-full bg-border" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-all duration-120" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export default function DownloadsPage() {
  const { tasks } = useDownloadTasks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filterRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);

  // Only show non-completed tasks
  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "Completed"), [tasks]);

  // Jobs of one batch (a torrent or an archive's contents) are shown under one folder row.
  // Completed jobs count towards the group's progress but aren't listed.
  const groups = useMemo(() => {
    const all = new Map<string, DownloadTask[]>();
    for (const t of tasks) {
      if (!t.batch_id) continue;
      const list = all.get(t.batch_id);
      if (list) list.push(t);
      else all.set(t.batch_id, [t]);
    }
    const out = new Map<string, Group>();
    for (const [id, jobs] of all) {
      if (jobs.length < 2) continue;
      const active = jobs.filter((t) => t.status !== "Completed");
      if (active.length === 0) continue;
      let done = 0, failed = 0, running = 0, queued = 0, paused = 0, totalBytes = 0, doneBytes = 0, speed = 0;
      for (const t of jobs) {
        totalBytes += Math.max(0, t.total_bytes);
        if (t.status === "Completed") {
          done++;
          doneBytes += Math.max(0, t.total_bytes);
          continue;
        }
        doneBytes += Math.max(0, t.downloaded_bytes);
        if (isFailedStatus(t.status)) failed++;
        else if (t.status === "Paused") paused++;
        else if (t.status === "Pending") queued++;
        else if (isActive(t.status)) running++;
        if (t.status === "Downloading") speed += t.speed;
      }
      const name = jobs.find((t) => t.batch_name)?.batch_name || "Batch";
      out.set(id, { id, name, active, files: jobs.length, done, failed, running, queued, paused, totalBytes, doneBytes, speed });
    }
    return out;
  }, [tasks]);

  const rows = useMemo(() => {
    const q = filter.toLowerCase();
    const matches = (t: DownloadTask) => !q || t.filename.toLowerCase().includes(q);
    const sortTasks = (list: DownloadTask[]) => {
      if (!sortKey) return list;
      return [...list].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "filename") cmp = a.filename.localeCompare(b.filename);
        else if (sortKey === "total_bytes") cmp = a.total_bytes - b.total_bytes;
        return sortDirection === "asc" ? cmp : -cmp;
      });
    };
    // Top level: groups and loose jobs, in queue order unless sorted.
    type Top = { kind: "group"; group: Group } | { kind: "task"; task: DownloadTask };
    const top: Top[] = [];
    const seen = new Set<string>();
    for (const t of activeTasks) {
      const g = t.batch_id ? groups.get(t.batch_id) : undefined;
      if (g) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          if (!q || g.name.toLowerCase().includes(q) || g.active.some(matches)) top.push({ kind: "group", group: g });
        }
      } else if (matches(t)) {
        top.push({ kind: "task", task: t });
      }
    }
    if (sortKey) {
      const name = (r: Top) => (r.kind === "group" ? r.group.name : r.task.filename);
      const size = (r: Top) => (r.kind === "group" ? r.group.totalBytes : r.task.total_bytes);
      top.sort((a, b) => {
        const cmp = sortKey === "filename" ? name(a).localeCompare(name(b)) : sortKey === "total_bytes" ? size(a) - size(b) : 0;
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    const out: Row[] = [];
    for (const r of top) {
      if (r.kind === "task") {
        out.push({ kind: "task", task: r.task, child: false });
        continue;
      }
      out.push(r);
      // A filter shows the matching files of every group without expanding by hand.
      const nameHit = q && r.group.name.toLowerCase().includes(q);
      if (expanded.has(r.group.id) || (q && !nameHit)) {
        const kids = q && !nameHit ? r.group.active.filter(matches) : r.group.active;
        for (const t of sortTasks(kids)) out.push({ kind: "task", task: t, child: true });
      }
    }
    return out;
  }, [activeTasks, groups, expanded, filter, sortKey, sortDirection]);

  const selectedTask = activeTasks.find((t) => t.id === selectedId) ?? null;

  const handleCancel = async (id: string) => {
    try { await downloadsApi.cancelDownload(id); } catch { /* ignore */ }
  };

  const handleRemove = async (id: string) => {
    try { await downloadsApi.removeDownload(id); } catch { /* ignore */ }
  };

  const handlePause = (id: string) => downloadsApi.pauseDownload(id).catch(() => {});
  const handleResume = (id: string) => downloadsApi.resumeDownload(id).catch(() => {});
  const handleRetry = (id: string) => downloadsApi.retryDownload(id).catch(() => {});

  const handleCancelAll = async () => {
    try { await downloadsApi.cancelAllDownloads(); setSelectedId(null); } catch { /* ignore */ }
  };

  const handleClearInactive = async () => {
    try { await downloadsApi.clearCompletedDownloads(); setSelectedId(null); } catch { /* ignore */ }
  };

  // Window event listeners
  useEffect(() => {
    const onDeselect = () => setSelectedId(null);
    const onFocus = () => filterRef.current?.focus();
    const onToggleInspector = () => setInspectorOpen((o) => !o);
    window.addEventListener("deselect-item", onDeselect);
    window.addEventListener("focus-filter", onFocus);
    window.addEventListener("toggle-inspector", onToggleInspector);
    return () => {
      window.removeEventListener("deselect-item", onDeselect);
      window.removeEventListener("focus-filter", onFocus);
      window.removeEventListener("toggle-inspector", onToggleInspector);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (!selectedId) return;
      const task = activeTasks.find((t) => t.id === selectedId);
      if (!task) return;
      const can = downloadActions(task);
      if (can.cancel) {
        downloadsApi.cancelDownload(selectedId).catch(() => {});
      } else if (can.remove) {
        downloadsApi.removeDownload(selectedId).catch(() => {});
        setSelectedId(null);
      }
    };
    window.addEventListener("delete-selected", handler);
    return () => window.removeEventListener("delete-selected", handler);
  }, [selectedId, activeTasks]);

  // Space: pause the selected download if it's running or queued, resume it if paused.
  useEffect(() => {
    const handler = () => {
      const task = activeTasks.find((t) => t.id === selectedId);
      if (!task) return;
      if (task.status === "Downloading" || task.status === "Pending") handlePause(task.id);
      else if (task.status === "Paused") handleResume(task.id);
    };
    window.addEventListener("toggle-selected", handler);
    return () => window.removeEventListener("toggle-selected", handler);
  }, [selectedId, activeTasks]);

  const selectRow = (t: DownloadTask) => { setSelectedId(t.id); setInspectorOpen(true); };
  const clickRow = (r: Row) => {
    if (r.kind === "group") {
      setSelectedId(groupKey(r.group.id));
      toggleGroup(r.group.id);
    } else selectRow(r.task);
  };
  const keyboardRow = (r: Row) => {
    if (r.kind === "group") setSelectedId(groupKey(r.group.id));
    else selectRow(r.task);
  };

  const groupActions = (g: Group) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {g.running + g.queued > 0 && <IconButton label="Pause all in this folder" onClick={() => downloadsApi.pauseBatch(g.id).catch(() => {})}><PauseIcon /></IconButton>}
      {g.paused > 0 && <IconButton label="Resume all in this folder" onClick={() => downloadsApi.resumeBatch(g.id).catch(() => {})}><PlayIcon /></IconButton>}
      {g.failed > 0 && <IconButton label="Retry failed in this folder" onClick={() => downloadsApi.retryBatch(g.id).catch(() => {})}><RetryIcon /></IconButton>}
      {g.running + g.queued + g.paused > 0 && <IconButton label="Cancel all in this folder" variant="danger" onClick={() => downloadsApi.cancelBatch(g.id).catch(() => {})}><CancelIcon /></IconButton>}
    </div>
  );

  const groupSummary = (g: Group) => {
    const parts = [`${g.done.toLocaleString()} of ${g.files.toLocaleString()} files`];
    if (g.running) parts.push(`${g.running} downloading`);
    if (g.queued) parts.push(`${g.queued.toLocaleString()} queued`);
    if (g.paused) parts.push(`${g.paused} paused`);
    if (g.failed) parts.push(`${g.failed} failed`);
    return parts.join(" · ");
  };

  const renderGroupName = (g: Group) => {
    const pct = g.totalBytes > 0 ? (g.doneBytes / g.totalBytes) * 100 : 0;
    const open = expanded.has(g.id) || !!filter;
    return (
      <div className="min-w-0 py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-fg-muted"><ChevronIcon open={open} /></span>
          <FolderIcon />
          <span className="min-w-0 flex-1 truncate text-base font-medium text-fg" title={g.name}>{g.name}</span>
          <span className="shrink-0 text-sm text-fg-muted tabular">{groupSummary(g)}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1"><ProgressBar pct={pct} /></div>
          <span className="shrink-0 text-sm text-fg-muted tabular">{Math.floor(pct)}%</span>
        </div>
      </div>
    );
  };

  const rowActions = (t: DownloadTask) => {
    const can = downloadActions(t);
    return (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {can.pause && <IconButton label="Pause" onClick={() => handlePause(t.id)}><PauseIcon /></IconButton>}
        {can.resume && <IconButton label="Resume" onClick={() => handleResume(t.id)}><PlayIcon /></IconButton>}
        {can.retry && <IconButton label="Retry" onClick={() => handleRetry(t.id)}><RetryIcon /></IconButton>}
        {can.cancel && <IconButton label="Cancel" variant="danger" onClick={() => handleCancel(t.id)}><CancelIcon /></IconButton>}
        {can.remove && <IconButton label="Remove" variant="danger" onClick={() => handleRemove(t.id)}><TrashIcon /></IconButton>}
      </div>
    );
  };

  const taskColumns: Column<DownloadTask>[] = [
    {
      key: "filename",
      header: "Name",
      width: "minmax(0, 1fr)",
      sortable: true,
      render: (t) => {
        const view = downloadStatusView(t, now);
        const pct = pctOf(t);
        return (
          <div className="min-w-0 py-0.5">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-base text-fg">{t.filename}</span>
              {t.remote && t.remote !== "symlink" && (
                <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <title>{t.remote}</title>
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                </svg>
              )}
              {t.remote === "symlink" && (
                <svg className="size-3.5 shrink-0 text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <title>Symlinked</title>
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              )}
            </div>
            {view.showProgress ? (
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1"><ProgressBar pct={pct} /></div>
                {view.detail && <span className="shrink-0 text-sm text-fg-muted">{view.detail}</span>}
              </div>
            ) : (
              <div className="mt-0.5 truncate text-sm text-fg-muted">
                <StatusDot status={view.tone}><span className="text-sm">{view.label}</span></StatusDot>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "total_bytes",
      header: "Size",
      width: 20,
      sortable: true,
      render: (t) => <span className="text-base text-fg-secondary tabular">{formatBytes(t.total_bytes)}</span>,
    },
    {
      key: "speed",
      header: "Speed",
      width: 20,
      render: (t) => (
        <span className="text-base text-fg-secondary tabular">{isActive(t.status) && t.speed > 0 ? formatSpeed(t.speed) : "--"}</span>
      ),
    },
    { key: "actions", header: "", width: 18, render: rowActions },
  ];

  const groupCell: Record<string, (g: Group) => ReactNode> = {
    filename: renderGroupName,
    total_bytes: (g) => <span className="text-base text-fg-secondary tabular">{formatBytes(g.totalBytes)}</span>,
    speed: (g) => <span className="text-base text-fg-secondary tabular">{g.speed > 0 ? formatSpeed(g.speed) : "--"}</span>,
    actions: groupActions,
  };
  const columns: Column<Row>[] = taskColumns.map((c) => ({
    ...c,
    render: (r: Row) => {
      if (r.kind === "group") return groupCell[c.key]?.(r.group) ?? null;
      const cell = c.render(r.task);
      return r.child && c.key === "filename" ? <div className="pl-7">{cell}</div> : cell;
    },
  }));

  const runningCount = activeTasks.filter((t) => isActive(t.status)).length;
  const totalSpeed = activeTasks.reduce((s, t) => s + (t.status === "Downloading" ? t.speed : 0), 0);
  const then = postProcessingSteps(settings);

  const inspector = selectedTask && (() => {
    const task = selectedTask;
    const view = downloadStatusView(task, now);
    const active = isActive(task.status);
    const actions = downloadActions(task);
    const segments = task.status === "Downloading" ? task.segments_active ?? 0 : 0;
    const eta = task.speed > 0 ? formatEta(task.total_bytes, task.downloaded_bytes, task.speed) : null;
    const errorText = task.error || (isFailedStatus(task.status) ? task.status.Failed : null);
    const canReveal = !!task.destination && (!task.remote || task.remote === "symlink");
    return (
      <Inspector
        id="downloads"
        open={inspectorOpen}
        onClose={() => setSelectedId(null)}
        title={task.filename}
        subtitle={`${formatBytes(task.downloaded_bytes)} of ${formatBytes(task.total_bytes)}${eta ? ` · ${eta} left` : ""}`}
        footer={
          <>
            {actions.pause && <Button onClick={() => handlePause(task.id)}>Pause</Button>}
            {actions.resume && <Button onClick={() => handleResume(task.id)}>Resume</Button>}
            {actions.retry && <Button onClick={() => handleRetry(task.id)}>Retry</Button>}
            {canReveal && <Button onClick={() => revealItemInDir(task.destination).catch(() => {})}>Show in Folder</Button>}
            {actions.cancel && <Button variant="danger" onClick={() => handleCancel(task.id)}>Cancel</Button>}
            {actions.remove && <Button variant="danger" onClick={() => handleRemove(task.id)}>Remove</Button>}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {view.showProgress && <ProgressBar pct={pctOf(task)} />}
          {segments > 0 && (
            <div className="flex gap-0.5" aria-label={`${segments} active connections`}>
              {Array.from({ length: segments }, (_, i) => (
                <span key={i} className="h-1.5 flex-1 rounded-sm bg-accent" />
              ))}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-fg-muted">Status</dt>
            <dd><StatusDot status={view.tone}><span className="text-sm">{view.label}</span></StatusDot></dd>
            <dt className="text-fg-muted">Speed</dt>
            <dd className="text-fg tabular">{active && task.speed > 0 ? formatSpeed(task.speed) : "--"}</dd>
            <dt className="text-fg-muted">Connections</dt>
            <dd className="text-fg tabular">{segments > 0 ? segments : "--"}</dd>
            <dt className="text-fg-muted">Resumable</dt>
            <dd className="text-fg">{task.resumable === undefined ? "--" : task.resumable ? "Yes" : "No"}</dd>
            {(task.attempt ?? 0) > 0 && (
              <>
                <dt className="text-fg-muted">Attempt</dt>
                <dd className="text-fg tabular">{task.attempt}</dd>
              </>
            )}
            <dt className="text-fg-muted">Saves to</dt>
            <dd className="break-all text-fg">
              {task.destination || "--"}
              {task.remote === "symlink" ? " (symlink)" : task.remote ? ` (remote: ${task.remote})` : ""}
            </dd>
            <dt className="text-fg-muted">Then</dt>
            <dd className="text-fg">{then.length ? then.join(" → ") : "Nothing"}</dd>
            {errorText && (
              <>
                <dt className="text-fg-muted">Error</dt>
                <dd className="break-words text-danger">{errorText}</dd>
              </>
            )}
          </dl>
        </div>
      </Inspector>
    );
  })();

  return (
    <>
      <Toolbar
        title="Downloads"
        subtitle={`${runningCount} active · ${formatSpeed(totalSpeed)}`}
        filter={{ value: filter, onChange: setFilter, placeholder: "Filter downloads", inputRef: filterRef }}
        actions={
          activeTasks.length > 0 ? (
            <>
              {activeTasks.some((t) => t.status === "Downloading" || t.status === "Pending") && (
                <Button onClick={() => downloadsApi.pauseAllDownloads().catch(() => {})}>Pause All</Button>
              )}
              {activeTasks.some((t) => t.status === "Paused") && (
                <Button onClick={() => downloadsApi.resumeAllDownloads().catch(() => {})}>Resume All</Button>
              )}
              {activeTasks.some((t) => isFailedStatus(t.status)) && (
                <Button onClick={() => downloadsApi.retryFailedDownloads().catch(() => {})}>Retry Failed</Button>
              )}
              {/* Less frequent / destructive bulk actions live in a menu so the toolbar fits at the minimum window width. */}
              <Menu
                trigger={
                  <IconButton label="More download actions">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </IconButton>
                }
                items={[
                  { label: "Clear Inactive", onSelect: handleClearInactive, disabled: !activeTasks.some((t) => !isActive(t.status)) },
                  "separator",
                  { label: "Cancel All", danger: true, onSelect: handleCancelAll },
                ]}
              />
            </>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(r) => (r.kind === "group" ? groupKey(r.group.id) : r.task.id)}
            onRowClick={clickRow}
            onKeyboardSelect={keyboardRow}
            selectedId={selectedId}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key, dir) => { setSortKey(key); setSortDirection(dir); }}
            emptyMessage="No active downloads"
            emptySubtext="Download torrents from the Torrents page"
          />
        </div>
        {inspector}
      </div>
    </>
  );
}
