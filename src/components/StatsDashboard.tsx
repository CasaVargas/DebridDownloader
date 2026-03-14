import { formatSpeed } from "../utils";
import type { User, DownloadTask, AppSettings, DownloadStatus } from "../types/index";

interface StatsDashboardProps {
  user: User | null;
  downloadTasks: DownloadTask[];
  settings: AppSettings | null;
  completedCount: number;
}

function isDownloading(status: DownloadStatus): boolean {
  return status === "Downloading";
}

function isActive(status: DownloadStatus): boolean {
  return status === "Downloading" || status === "Pending";
}

export function StatsDashboard({
  user,
  downloadTasks,
  settings,
  completedCount,
}: StatsDashboardProps) {
  // Active Downloads
  const activeTasks = downloadTasks.filter((t) => isActive(t.status));
  const downloadingTasks = downloadTasks.filter((t) => isDownloading(t.status));
  const activeCount = activeTasks.length;
  const aggregateSpeed = downloadingTasks.reduce((sum, t) => sum + t.speed, 0);

  const activeValue =
    activeCount > 0
      ? `${activeCount} at ${formatSpeed(aggregateSpeed)}`
      : "0";
  const activeColor = activeCount > 0 ? "text-[#3b82f6]" : "text-[#475569]";

  // Premium days remaining
  let premiumValue = "--";
  let premiumColor = "text-[#475569]";
  if (user) {
    const days = Math.ceil(
      (new Date(user.expiration).getTime() - Date.now()) / 86400000
    );
    premiumValue = `${days} days`;
    if (days <= 7) {
      premiumColor = "text-[#ef4444]";
    } else if (days <= 30) {
      premiumColor = "text-[#eab308]";
    } else {
      premiumColor = "text-[#10b981]";
    }
  }

  // Download folder
  const folderValue = settings?.download_folder ?? null;

  return (
    <div className="p-6">
      {/* 2x2 stat grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Active Downloads */}
        <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-4">
          <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
            Active Downloads
          </div>
          <div className={`text-[14px] font-semibold ${activeColor}`}>
            {activeValue}
          </div>
        </div>

        {/* Completed */}
        <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-4">
          <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
            Completed (Session)
          </div>
          <div className="text-[14px] text-[#10b981] font-semibold">
            {completedCount}
          </div>
        </div>

        {/* Premium */}
        <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-4">
          <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
            Premium
          </div>
          <div className={`text-[14px] font-semibold ${premiumColor}`}>
            {premiumValue}
          </div>
        </div>

        {/* Download Folder */}
        <div className="bg-[#0f0f18] border border-[rgba(255,255,255,0.04)] rounded-lg p-4">
          <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-1">
            Download Folder
          </div>
          {folderValue ? (
            <div className="text-[13px] text-[#f1f5f9] font-semibold truncate">
              {folderValue}
            </div>
          ) : (
            <div className="text-[13px] text-[#475569] font-semibold">
              Not set
            </div>
          )}
        </div>
      </div>

      {/* Mini progress bars for active downloading tasks */}
      {downloadingTasks.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] text-[#475569] uppercase tracking-wider mb-2">
            Active
          </div>
          <div className="space-y-2">
            {downloadingTasks.map((task) => {
              const pct =
                task.total_bytes > 0
                  ? Math.round((task.downloaded_bytes / task.total_bytes) * 100)
                  : 0;
              return (
                <div key={task.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] text-[#94a3b8] truncate flex-1 min-w-0 mr-2">
                      {task.filename}
                    </span>
                    <span className="text-[12px] text-[#94a3b8] shrink-0">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-[2px] rounded-full bg-[rgba(59,130,246,0.08)]">
                    <div
                      className="h-full rounded-full bg-[#3b82f6]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Keyboard shortcuts reference */}
      <div className="mt-6 pt-4 border-t border-[rgba(255,255,255,0.04)]">
        <div className="text-[11px] text-[#374151]">
          ⌘K Search · ⌘R Refresh · ↑↓ Navigate · Enter Download
        </div>
      </div>
    </div>
  );
}
