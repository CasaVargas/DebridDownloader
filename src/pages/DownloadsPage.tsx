import { useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import DataTable, { type Column } from "../components/DataTable";
import { Button, IconButton, Inspector, Menu, StatusDot, Toolbar } from "../components/ui";
import { useDownloadTasks } from "../hooks/useDownloadTasks";
import * as downloadsApi from "../api/downloads";
import { getSettings } from "../api/settings";
import type { AppSettings, DownloadTask } from "../types";
import { formatBytes, formatSpeed, formatEta } from "../utils";
import { downloadStatusView, isActiveStatus as isActive, isFailedStatus, postProcessingSteps } from "../lib/downloadStatus";

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
  const filterRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);

  // Only show non-completed tasks
  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "Completed"), [tasks]);

  const filtered = useMemo(() => {
    let result = activeTasks;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter((t) => t.filename.toLowerCase().includes(q));
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "filename") cmp = a.filename.localeCompare(b.filename);
        else if (sortKey === "total_bytes") cmp = a.total_bytes - b.total_bytes;
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [activeTasks, filter, sortKey, sortDirection]);

  const selectedTask = filtered.find((t) => t.id === selectedId) ?? null;

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
      if (task && isActive(task.status)) {
        downloadsApi.cancelDownload(selectedId).catch(() => {});
      } else {
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

  const rowActions = (t: DownloadTask) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {(t.status === "Downloading" || t.status === "Pending") && (
        <IconButton label="Pause" onClick={() => handlePause(t.id)}><PauseIcon /></IconButton>
      )}
      {t.status === "Paused" && (
        <IconButton label="Resume" onClick={() => handleResume(t.id)}><PlayIcon /></IconButton>
      )}
      {(isFailedStatus(t.status) || t.status === "Cancelled") && (
        <IconButton label="Retry" onClick={() => handleRetry(t.id)}><RetryIcon /></IconButton>
      )}
      {isActive(t.status) || t.status === "Paused" ? (
        <IconButton label="Cancel" variant="danger" onClick={() => handleCancel(t.id)}><CancelIcon /></IconButton>
      ) : (
        <IconButton label="Remove" variant="danger" onClick={() => handleRemove(t.id)}><TrashIcon /></IconButton>
      )}
    </div>
  );

  const columns: Column<DownloadTask>[] = [
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

  const runningCount = activeTasks.filter((t) => isActive(t.status)).length;
  const totalSpeed = activeTasks.reduce((s, t) => s + (t.status === "Downloading" ? t.speed : 0), 0);
  const then = postProcessingSteps(settings);

  const inspector = selectedTask && (() => {
    const task = selectedTask;
    const view = downloadStatusView(task, now);
    const active = isActive(task.status);
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
            {(task.status === "Downloading" || task.status === "Pending") && <Button onClick={() => handlePause(task.id)}>Pause</Button>}
            {task.status === "Paused" && <Button onClick={() => handleResume(task.id)}>Resume</Button>}
            {(isFailedStatus(task.status) || task.status === "Cancelled") && <Button onClick={() => handleRetry(task.id)}>Retry</Button>}
            {canReveal && <Button onClick={() => revealItemInDir(task.destination).catch(() => {})}>Show in Folder</Button>}
            {active || task.status === "Paused" ? (
              <Button variant="danger" onClick={() => handleCancel(task.id)}>Cancel</Button>
            ) : (
              <Button variant="danger" onClick={() => handleRemove(task.id)}>Remove</Button>
            )}
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
            data={filtered}
            rowKey={(t) => t.id}
            onRowClick={selectRow}
            onKeyboardSelect={selectRow}
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
