import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, listen, unlisten } = vi.hoisted(() => {
  const unlisten = vi.fn();
  return {
    invoke: vi.fn().mockResolvedValue("from-invoke"),
    listen: vi.fn().mockResolvedValue(unlisten),
    unlisten,
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { call, DOWNLOAD_FILE_PATH, downloadFileUrl, httpRequest, HTTP_ROUTES, subscribe } from "../api/transport";
import { getDownloadTasks, pauseBatch } from "../api/downloads";

const ROOT = resolve(__dirname, "../..");
const win = window as unknown as Record<string, unknown>;

/** A stand-in `EventSource` that records listeners so the test can fire SSE events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;
  constructor(
    public url: string,
    public init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(name)?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: string) {
    this.listeners.get(name)?.forEach((fn) => fn(new MessageEvent(name, { data })));
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

function browserMode() {
  delete win.__TAURI_INTERNALS__;
  delete win.__TAURI__;
}

beforeEach(() => {
  invoke.mockClear();
  listen.mockClear();
  unlisten.mockClear();
  FakeEventSource.instances = [];
  fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore what setup.ts installs for every other test.
  delete win.__TAURI__;
  win.__TAURI_INTERNALS__ = {};
});

describe("call", () => {
  it("uses invoke() when window.__TAURI__ is present", async () => {
    delete win.__TAURI_INTERNALS__;
    win.__TAURI__ = {};
    await expect(call("get_download_tasks")).resolves.toBe("from-invoke");
    expect(invoke).toHaveBeenCalledWith("get_download_tasks", undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses invoke() when only __TAURI_INTERNALS__ is present (Tauri v2 without withGlobalTauri)", async () => {
    await pauseBatch("b1");
    expect(invoke).toHaveBeenCalledWith("pause_batch", { batchId: "b1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses fetch() against the headless route otherwise", async () => {
    browserMode();
    fetchMock.mockResolvedValue(jsonResponse([{ id: "j1" }]));
    await expect(getDownloadTasks()).resolves.toEqual([{ id: "j1" }]);
    expect(invoke).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/downloads");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeUndefined();
  });

  it("fills path params, the query string and the JSON body from the command args", async () => {
    browserMode();
    fetchMock.mockResolvedValue(jsonResponse(null));
    await pauseBatch("a b/c");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/batches/a%20b%2Fc/pause");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");

    const links = httpRequest("unrestrict_torrent_links", { torrentId: "t1", fileIds: [1, 2] });
    expect(links.url).toBe("/api/torrents/t1/links");
    expect(JSON.parse(links.init.body as string)).toEqual({ fileIds: [1, 2] });
    expect((links.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const search = httpRequest("search_torrents", { query: "ubuntu iso", category: null, sort_by: "seeders", page: 2 });
    expect(search.url).toBe("/api/search?query=ubuntu+iso&sortBy=seeders&page=2");

    const history = httpRequest("get_download_history", { page: null, limit: null });
    expect(history.url).toBe("/api/downloads/history");

    const clear = httpRequest("clear_watch_matches", { ruleId: "r1" });
    expect(clear.url).toBe("/api/watch/matches?ruleId=r1");
    expect(clear.init.method).toBe("DELETE");
  });

  it("picks one field when a route answers for two commands", async () => {
    browserMode();
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: true, provider: "torbox" }));
    await expect(call("is_authenticated")).resolves.toBe(true);
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: true, provider: "torbox" }));
    await expect(call("get_active_provider")).resolves.toBe("torbox");
  });

  it("rejects with the server's error message, like invoke() does", async () => {
    browserMode();
    fetchMock.mockResolvedValue(jsonResponse({ error: "Not authenticated" }, 500));
    await expect(call("get_user")).rejects.toBe("Not authenticated");
  });

  it("fails loudly in a browser for a command with no HTTP route", async () => {
    browserMode();
    await expect(call("get_stream_url", { torrentId: "t", fileId: 1 })).rejects.toThrow(/get_stream_url.*not available/);
    await expect(call("no_such_command")).rejects.toThrow(/no_such_command/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("subscribe", () => {
  it("uses listen() under Tauri and hands the handler the payload", async () => {
    const handler = vi.fn();
    const stop = await subscribe("download-progress", handler);
    expect(listen).toHaveBeenCalledWith("download-progress", expect.any(Function));
    expect(FakeEventSource.instances).toHaveLength(0);
    listen.mock.calls[0][1]({ event: "download-progress", id: 1, payload: { id: "j1" } });
    expect(handler).toHaveBeenCalledWith({ id: "j1" });
    stop();
    expect(unlisten).toHaveBeenCalled();
  });

  it("uses an EventSource on /api/events otherwise, shared by subscribers", async () => {
    browserMode();
    const progress = vi.fn();
    const changed = vi.fn();
    const stopProgress = await subscribe("download-progress", progress);
    const stopChanged = await subscribe("downloads-changed", changed);
    expect(listen).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe("/api/events");
    expect(es.init?.withCredentials).toBe(true);

    es.emit("download-progress", JSON.stringify({ id: "j1", downloaded_bytes: 5 }));
    es.emit("downloads-changed", "null");
    expect(progress).toHaveBeenCalledWith({ id: "j1", downloaded_bytes: 5 });
    expect(changed).toHaveBeenCalledWith(null);

    stopProgress();
    es.emit("download-progress", "{}");
    expect(progress).toHaveBeenCalledTimes(1);
    expect(es.closed).toBe(false);
    stopChanged();
    expect(es.closed).toBe(true);

    // A later subscriber opens a fresh stream.
    const stop = await subscribe("watchlist-match", vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
    stop();
  });
});

describe("route map", () => {
  const server = readFileSync(`${ROOT}/src-tauri/src/server.rs`, "utf8");
  const routerSrc = server.slice(server.indexOf("pub fn router("), server.indexOf("// ── Auth"));
  const serverRoutes = new Set(
    [...routerSrc.matchAll(/\.route\("([^"]+)",\s*(get|post|put|delete)\(/g)].map((m) => `${m[2].toUpperCase()} ${m[1]}`),
  );
  const lib = readFileSync(`${ROOT}/src-tauri/src/lib.rs`, "utf8");
  const handlerSrc = lib.slice(lib.indexOf("generate_handler!["));
  const tauriCommands = new Set(
    [...handlerSrc.slice(0, handlerSrc.indexOf("]")).matchAll(/commands::\w+::(\w+)/g)].map((m) => m[1]),
  );

  it("reads the router and command list", () => {
    expect(serverRoutes.size).toBeGreaterThan(50);
    expect(tauriCommands.size).toBeGreaterThan(50);
  });

  it("every mapped command is a Tauri command and maps onto a route server.rs registers", () => {
    for (const [cmd, route] of Object.entries(HTTP_ROUTES)) {
      expect(tauriCommands, cmd).toContain(cmd);
      expect(serverRoutes, `${cmd} → ${route.method} ${route.path}`).toContain(`${route.method} ${route.path}`);
    }
  });

  it("every server.rs API route is reached by some command", () => {
    const mapped = new Set(Object.values(HTTP_ROUTES).map((r) => `${r.method} ${r.path}`));
    // `/health` and `/login` aren't commands; `/api/events` is what `subscribe` reads, and the
    // file route is opened as a link by `saveToDevice`.
    const unreached = [...serverRoutes].filter(
      (r) => r.includes(" /api/") && r !== "GET /api/events" && r !== `GET ${DOWNLOAD_FILE_PATH}` && !mapped.has(r),
    );
    expect(unreached).toEqual([]);
  });

  it("the file link is a route server.rs registers, with the id escaped", () => {
    expect(serverRoutes).toContain(`GET ${DOWNLOAD_FILE_PATH}`);
    expect(downloadFileUrl("a b/c")).toBe("/api/downloads/a%20b%2Fc/file");
  });

  it("every path param is filled from a command arg", () => {
    for (const [cmd, route] of Object.entries(HTTP_ROUTES)) {
      const segs = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const args = Object.fromEntries(segs.map((s) => [route.params?.[s] ?? s, "x"]));
      expect(() => httpRequest(cmd, args), cmd).not.toThrow();
      expect(httpRequest(cmd, args).url, cmd).not.toMatch(/[{}]/);
    }
  });
});

describe("no direct invoke()/listen() outside the transport", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  }
  const files = walk(`${ROOT}/src`)
    .map((p) => p.slice(ROOT.length + 1))
    .filter((p) => !p.startsWith("src/test/") && p !== "src/api/transport.ts");
  const RULES = [
    { name: "invoke() call", re: /\binvoke\s*[(<]/ },
    { name: "listen() call", re: /\blisten\s*[(<]/ },
    { name: "@tauri-apps/api/core import", re: /["']@tauri-apps\/api\/core["']/ },
    { name: "@tauri-apps/api/event import", re: /["']@tauri-apps\/api\/event["']/ },
  ];

  it("the guard catches what it should", () => {
    expect(RULES.some((r) => r.re.test(`return invoke("x")`))).toBe(true);
    expect(RULES.some((r) => r.re.test(`const u = listen<T>("e", f)`))).toBe(true);
    expect(RULES.some((r) => r.re.test(`window.addEventListener("x", f)`))).toBe(false);
  });

  it.each(files)("%s", (file) => {
    const hits: string[] = [];
    readFileSync(`${ROOT}/${file}`, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const r of RULES) if (r.re.test(line)) hits.push(`line ${i + 1}: ${r.name}: ${line.trim()}`);
      });
    expect(hits).toEqual([]);
  });
});
