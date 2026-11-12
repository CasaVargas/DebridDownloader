import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { subscribe } from "../api/transport";
import * as downloadsApi from "../api/downloads";
import type { DownloadTask, DownloadProgress } from "../types";

interface DownloadTasksContextValue {
  tasks: DownloadTask[];
  refreshTasks: () => Promise<void>;
}

/** How often buffered progress events are applied. */
const FLUSH_MS = 250;

const DownloadTasksContext = createContext<DownloadTasksContextValue>({
  tasks: [],
  refreshTasks: async () => {},
});

export function DownloadTasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [progress, setProgress] = useState<Map<string, DownloadProgress>>(new Map());

  // Listen for real-time progress events. With thousands of jobs (e.g. a ZIP's contents) events
  // arrive hundreds of times a second, so buffer them and apply at most a few times a second;
  // re-rendering on every event starves the UI and clicks stop registering.
  const pending = useRef(new Map<string, DownloadProgress>());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = pending.current;
      if (batch.size === 0) return;
      pending.current = new Map();
      setProgress((prev) => {
        const next = new Map(prev);
        for (const [id, p] of batch) next.set(id, p);
        return next;
      });
    };
    const unlisten = subscribe<DownloadProgress>("download-progress", (p) => {
      pending.current.set(p.id, p);
      if (timer === null) timer = setTimeout(flush, FLUSH_MS);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Fetch once, then refetch whenever the engine adds/removes jobs
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        setTasks(await downloadsApi.getDownloadTasks());
      } catch {
        // ignore
      }
    };
    fetchTasks();
    const unlisten = subscribe("downloads-changed", fetchTasks);
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Listen for refresh-list events
  useEffect(() => {
    const handler = async () => {
      try {
        const data = await downloadsApi.getDownloadTasks();
        setTasks(data);
      } catch {
        // ignore
      }
    };
    window.addEventListener("refresh-list", handler);
    return () => window.removeEventListener("refresh-list", handler);
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const data = await downloadsApi.getDownloadTasks();
      setTasks(data);
    } catch {
      // ignore
    }
  }, []);

  // Merge real-time progress into tasks (progress events carry the newest state)
  const mergedTasks = useMemo(
    () =>
      tasks.map((task) => {
        const p = progress.get(task.id);
        return p ? { ...task, ...p } : task;
      }),
    [tasks, progress]
  );
  const value = useMemo(() => ({ tasks: mergedTasks, refreshTasks }), [mergedTasks, refreshTasks]);

  return (
    <DownloadTasksContext.Provider value={value}>
      {children}
    </DownloadTasksContext.Provider>
  );
}

export function useDownloadTasks() {
  return useContext(DownloadTasksContext);
}
