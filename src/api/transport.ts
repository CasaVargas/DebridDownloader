/**
 * The one way the UI talks to the backend.
 *
 * Inside the Tauri desktop app, `call` is `invoke()` and `subscribe` is `listen()`. In a plain
 * browser (the headless server serving this UI), `call` is a `fetch` against the HTTP routes in
 * `src-tauri/src/server.rs` and `subscribe` reads the `GET /api/events` Server-Sent Events stream.
 * The browser authenticates with the `dd_token` cookie that `POST /login` sets.
 *
 * Every `src/api/*.ts` wrapper goes through `call`, and every event listener through `subscribe`;
 * `transport.test.ts` fails on a direct `invoke(` / `listen(` anywhere else.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Args = Record<string, unknown>;
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** How one Tauri command maps onto a headless HTTP route. */
export interface Route {
  method: HttpMethod;
  /** Path as written in `server.rs`; `{name}` segments are filled from the command's args. */
  path: string;
  /** Path segment name → command arg name, when they differ (default: the same name). */
  params?: Record<string, string>;
  /** Args sent as the query string (null/undefined ones are left out). */
  query?: string[];
  /** Args sent as the JSON body (null/undefined ones are left out). */
  body?: string[];
  /** Field of the JSON response the command returns, when the route answers more than one. */
  pick?: string;
}

/**
 * Command → route. Must match `router()` in `src-tauri/src/server.rs` (checked by
 * `transport.test.ts`). A command missing here is desktop-only and throws in browser mode.
 */
export const HTTP_ROUTES: Record<string, Route> = {
  // Downloads
  get_download_tasks: { method: "GET", path: "/api/downloads" },
  start_downloads: { method: "POST", path: "/api/downloads", body: ["links", "destinationFolder", "torrentName"] },
  get_download_history: { method: "GET", path: "/api/downloads/history", query: ["page", "limit"] },
  cancel_all_downloads: { method: "POST", path: "/api/downloads/cancel-all" },
  pause_all_downloads: { method: "POST", path: "/api/downloads/pause-all" },
  resume_all_downloads: { method: "POST", path: "/api/downloads/resume-all" },
  retry_failed_downloads: { method: "POST", path: "/api/downloads/retry-failed" },
  clear_completed_downloads: { method: "POST", path: "/api/downloads/clear-completed" },
  remove_download: { method: "DELETE", path: "/api/downloads/{id}" },
  cancel_download: { method: "POST", path: "/api/downloads/{id}/cancel" },
  pause_download: { method: "POST", path: "/api/downloads/{id}/pause" },
  resume_download: { method: "POST", path: "/api/downloads/{id}/resume" },
  retry_download: { method: "POST", path: "/api/downloads/{id}/retry" },
  cancel_batch: { method: "POST", path: "/api/batches/{batch_id}/cancel", params: { batch_id: "batchId" } },
  pause_batch: { method: "POST", path: "/api/batches/{batch_id}/pause", params: { batch_id: "batchId" } },
  resume_batch: { method: "POST", path: "/api/batches/{batch_id}/resume", params: { batch_id: "batchId" } },
  retry_batch: { method: "POST", path: "/api/batches/{batch_id}/retry", params: { batch_id: "batchId" } },
  // Torrents
  list_torrents: { method: "GET", path: "/api/torrents", query: ["page", "limit"] },
  add_magnet: { method: "POST", path: "/api/torrents/magnet", body: ["magnet"] },
  add_torrent_file: { method: "POST", path: "/api/torrents/file", body: ["fileBytes"] },
  get_torrent_info: { method: "GET", path: "/api/torrents/{id}" },
  delete_torrent: { method: "DELETE", path: "/api/torrents/{id}" },
  select_torrent_files: { method: "POST", path: "/api/torrents/{id}/select", body: ["fileIds"] },
  unrestrict_torrent_links: {
    method: "POST",
    path: "/api/torrents/{id}/links",
    params: { id: "torrentId" },
    body: ["fileIds"],
  },
  // Auth and providers
  is_authenticated: { method: "GET", path: "/api/auth/status", pick: "authenticated" },
  get_active_provider: { method: "GET", path: "/api/auth/status", pick: "provider" },
  set_api_token: { method: "POST", path: "/api/auth/token", body: ["token"] },
  load_saved_token: { method: "POST", path: "/api/auth/load-saved-token" },
  logout: { method: "POST", path: "/api/auth/logout" },
  get_user: { method: "GET", path: "/api/auth/user" },
  get_auth_method: { method: "GET", path: "/api/auth/method" },
  switch_provider: { method: "POST", path: "/api/auth/provider", body: ["providerId"] },
  oauth_start: { method: "POST", path: "/api/auth/oauth/start" },
  oauth_poll_credentials: { method: "POST", path: "/api/auth/oauth/credentials", body: ["deviceCode"] },
  oauth_get_token: {
    method: "POST",
    path: "/api/auth/oauth/token",
    body: ["clientId", "clientSecret", "deviceCode"],
  },
  get_available_providers: { method: "GET", path: "/api/providers" },
  // Search and trackers
  search_torrents: { method: "GET", path: "/api/search", query: ["query", "category", "sortBy", "page"] },
  get_tracker_configs: { method: "GET", path: "/api/trackers" },
  save_tracker_configs: { method: "PUT", path: "/api/trackers", body: ["configs"] },
  test_tracker: { method: "POST", path: "/api/trackers/test", body: ["trackerType", "url", "apiKey"] },
  check_cache_availability: { method: "POST", path: "/api/cache/check", body: ["hashes"] },
  // Settings and backup
  get_settings: { method: "GET", path: "/api/settings" },
  update_settings: { method: "PUT", path: "/api/settings", body: ["settings"] },
  export_settings: {
    method: "POST",
    path: "/api/settings/export",
    body: ["includeCredentials", "frontendSettingsJson"],
  },
  import_settings: { method: "POST", path: "/api/settings/import", body: ["json"] },
  // Watchlist
  get_watch_rules: { method: "GET", path: "/api/watch/rules" },
  add_watch_rule: { method: "POST", path: "/api/watch/rules", body: ["rule"] },
  update_watch_rule: { method: "PUT", path: "/api/watch/rules", body: ["rule"] },
  delete_watch_rule: { method: "DELETE", path: "/api/watch/rules/{id}" },
  run_watch_rule_now: { method: "POST", path: "/api/watch/rules/{id}/run" },
  get_watch_matches: { method: "GET", path: "/api/watch/matches", query: ["ruleId"] },
  clear_watch_matches: { method: "DELETE", path: "/api/watch/matches", query: ["ruleId"] },
  // Tools
  check_rclone: { method: "GET", path: "/api/rclone" },
  list_rclone_remotes: { method: "GET", path: "/api/rclone/remotes" },
  validate_rclone_remote: { method: "POST", path: "/api/rclone/remotes/validate", body: ["remoteName"] },
  detect_rar_tool: { method: "GET", path: "/api/extractor/rar-tool" },
  test_media_server: { method: "POST", path: "/api/media-servers/test", body: ["serverType", "url", "credential"] },
};

/** The SSE stream of app events (`server.rs` `event_stream`). */
export const EVENTS_PATH = "/api/events";

/**
 * True inside the Tauri WebView (Tauri v2 always injects `__TAURI_INTERNALS__`). The web build
 * (`npm run build:web`, Vite mode `web`) is browser-only, so it always takes the HTTP path.
 */
export function isTauri(): boolean {
  if (import.meta.env.MODE === "web") return false;
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

// ── Browser session (headless server only) ───────────────────────────

/** Window event fired when the server answers 401: the session cookie is missing or stale. */
export const UNAUTHORIZED_EVENT = "dd-server-unauthorized";

/** Whether this browser has a valid server session (the `dd_token` cookie). */
export async function hasServerSession(): Promise<boolean> {
  const resp = await fetch("/api/auth/status", { credentials: "same-origin", headers: { Accept: "application/json" } });
  return resp.status !== 401;
}

/**
 * `POST /login` with the server token; on success the server sets the `dd_token` cookie every
 * later call relies on. Rejects with a readable message on a wrong token or a server error.
 */
export async function serverLogin(token: string): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    throw new Error("Couldn't reach the server");
  }
  if (resp.status === 401) throw new Error("Wrong token");
  if (!resp.ok) throw new Error(`Login failed (${resp.status} ${resp.statusText})`.trim());
}

/**
 * Arg names differ from what the desktop sends in one place: `searchTorrents` passes `sort_by`,
 * while the HTTP route reads `sortBy`.
 */
function argValue(args: Args, name: string): unknown {
  if (name === "sortBy" && args.sortBy == null) return args.sort_by;
  return args[name];
}

/** The URL and `fetch` init for `cmd`, or a thrown error if the headless server has no route for it. */
export function httpRequest(cmd: string, args: Args = {}): { url: string; init: RequestInit; pick?: string } {
  const route = HTTP_ROUTES[cmd];
  if (!route) {
    throw new Error(`"${cmd}" is not available in the browser UI (no headless HTTP route for it)`);
  }
  let path = route.path.replace(/\{(\w+)\}/g, (_, seg: string) => {
    const value = argValue(args, route.params?.[seg] ?? seg);
    if (value == null || value === "") throw new Error(`"${cmd}": missing "${route.params?.[seg] ?? seg}"`);
    return encodeURIComponent(String(value));
  });
  if (route.query) {
    const q = new URLSearchParams();
    for (const name of route.query) {
      const value = argValue(args, name);
      if (value != null) q.set(name, String(value));
    }
    const qs = q.toString();
    if (qs) path += `?${qs}`;
  }
  const init: RequestInit = { method: route.method, credentials: "same-origin", headers: { Accept: "application/json" } };
  if (route.body) {
    const body: Args = {};
    for (const name of route.body) {
      const value = argValue(args, name);
      if (value != null) body[name] = value;
    }
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  return { url: path, init, pick: route.pick };
}

async function httpCall<T>(cmd: string, args?: Args): Promise<T> {
  const { url, init, pick } = httpRequest(cmd, args);
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (resp.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!resp.ok) {
    // Reject with the message string, as `invoke()` does with a command's `Err(String)`.
    const message =
      data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : text;
    throw message || `${resp.status} ${resp.statusText}`;
  }
  if (pick) return (data as Record<string, unknown> | null)?.[pick] as T;
  return data as T;
}

/** Run backend command `cmd` (a Tauri command name) with its `invoke()` args. */
export function call<T>(cmd: string, args?: Args): Promise<T> {
  if (isTauri()) return invoke<T>(cmd, args);
  return httpCall<T>(cmd, args);
}

// ── Events ────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;

/** One `EventSource` for the page, shared by every subscriber; closed when the last one leaves. */
let source: EventSource | null = null;
const subscribers = new Map<string, { handlers: Set<(payload: unknown) => void>; listener: (e: Event) => void }>();

function sseSubscribe<T>(event: string, handler: (payload: T) => void): Unsubscribe {
  if (!source) source = new EventSource(EVENTS_PATH, { withCredentials: true });
  let entry = subscribers.get(event);
  if (!entry) {
    const handlers = new Set<(payload: unknown) => void>();
    const listener = (e: Event) => {
      const raw = (e as MessageEvent).data;
      let payload: unknown = raw;
      try {
        payload = JSON.parse(raw);
      } catch {
        // not JSON: hand over the raw string
      }
      handlers.forEach((h) => h(payload));
    };
    entry = { handlers, listener };
    subscribers.set(event, entry);
    source.addEventListener(event, listener);
  }
  const h = handler as (payload: unknown) => void;
  entry.handlers.add(h);
  return () => {
    const current = subscribers.get(event);
    if (!current || !current.handlers.delete(h) || current.handlers.size > 0) return;
    subscribers.delete(event);
    source?.removeEventListener(event, current.listener);
    if (subscribers.size === 0) {
      source?.close();
      source = null;
    }
  };
}

/**
 * Call `handler` with the payload of every `event` the backend emits. Resolves to the function
 * that stops listening (same shape as Tauri's `listen()`).
 */
export function subscribe<T>(event: string, handler: (payload: T) => void): Promise<Unsubscribe> {
  if (isTauri()) return listen<T>(event, (e) => handler(e.payload));
  return Promise.resolve(sseSubscribe(event, handler));
}
