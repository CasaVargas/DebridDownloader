import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
}));

import App from "../App";
import ServerSessionGate, { AFTER_LOGIN_PATH } from "../components/ServerSessionGate";
import { hasServerSession, serverLogin, UNAUTHORIZED_EVENT } from "../api/transport";

const win = window as unknown as Record<string, unknown>;
const TOKEN = "right-token";

/** `EventSource` stand-in: jsdom has none, and DownloadsPage subscribes to `/api/events`. */
class FakeEventSource {
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A fake headless server: every `/api/*` call is 401 until `POST /login` gets the right token,
 * as with the real `dd_token` cookie. Records each request as "METHOD path".
 */
function fakeServer() {
  const state = { session: false, requests: [] as string[] };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    state.requests.push(`${method} ${url.pathname}`);
    if (url.pathname === "/login") {
      const { token } = JSON.parse(String(init?.body));
      if (token !== TOKEN) return json({ error: "Unauthorized" }, 401);
      state.session = true;
      return json({ ok: true });
    }
    if (!state.session) return json({ error: "Unauthorized" }, 401);
    switch (`${method} ${url.pathname}`) {
      case "POST /api/auth/load-saved-token":
        return json(true);
      case "GET /api/auth/user":
        return json({ username: "jon", email: "", premium: true, expiration: null, points: 0, avatar: "" });
      case "GET /api/auth/status":
        return json({ authenticated: true });
      case "GET /api/downloads":
      case "GET /api/torrents":
        return json([]);
      case "GET /api/settings":
        return json({});
      default:
        return json(null);
    }
  });
  return { state, fetchMock };
}

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  // A plain browser, not the Tauri WebView.
  delete win.__TAURI_INTERNALS__;
  delete win.__TAURI__;
  invoke.mockClear();
  server = fakeServer();
  vi.stubGlobal("fetch", server.fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  win.__TAURI_INTERNALS__ = {};
});

function renderApp() {
  render(
    <ServerSessionGate>
      <App />
    </ServerSessionGate>,
  );
}

async function signIn(token: string) {
  const input = await screen.findByLabelText("Server token");
  fireEvent.change(input, { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("browser login against the headless server", () => {
  it("an unauthenticated load shows the server login screen, not the app", async () => {
    renderApp();
    expect(await screen.findByLabelText("Server token")).toBeInTheDocument();
    expect(screen.getByText("Sign in to this server")).toBeInTheDocument();
    // Only the session probe ran; the app didn't start calling the API.
    expect(server.state.requests).toEqual(["GET /api/auth/status"]);
  });

  it("a wrong token shows an error and stays on the login screen", async () => {
    renderApp();
    await signIn("wrong-token");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong token");
    expect(screen.getByLabelText("Server token")).toBeInTheDocument();
    expect(server.state.requests).toContain("POST /login");
    expect(server.state.requests).not.toContain("POST /api/auth/load-saved-token");
  });

  it("an empty token is caught before calling the server", async () => {
    renderApp();
    await screen.findByLabelText("Server token");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the server token");
    expect(server.state.requests).not.toContain("POST /login");
  });

  it("the right token POSTs to /login, then lands on the downloads page", async () => {
    renderApp();
    await signIn(TOKEN);
    expect(await screen.findByRole("heading", { name: "Downloads" }, { timeout: 5000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe(AFTER_LOGIN_PATH);
    expect(screen.queryByLabelText("Server token")).not.toBeInTheDocument();
    const login = server.fetchMock.mock.calls.find(([url]) => String(url) === "/login")!;
    expect(login[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(login[1]!.body))).toEqual({ token: TOKEN });
    // The app then talks to the API on the cookie /login set.
    expect(server.state.requests).toContain("GET /api/downloads");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a browser that already has the cookie skips the login screen", async () => {
    server.state.session = true;
    window.history.replaceState(null, "", "/downloads");
    renderApp();
    expect(await screen.findByRole("heading", { name: "Downloads" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByLabelText("Server token")).not.toBeInTheDocument();
  });

  it("a later 401 (cookie gone) brings the login screen back", async () => {
    server.state.session = true;
    window.history.replaceState(null, "", "/downloads");
    renderApp();
    await screen.findByRole("heading", { name: "Downloads" }, { timeout: 5000 });
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(await screen.findByLabelText("Server token")).toBeInTheDocument();
  });

  it("the desktop app never shows the server login", async () => {
    win.__TAURI_INTERNALS__ = {};
    render(
      <ServerSessionGate>
        <p>desktop app</p>
      </ServerSessionGate>,
    );
    expect(screen.getByText("desktop app")).toBeInTheDocument();
    expect(server.fetchMock).not.toHaveBeenCalled();
  });
});

describe("session helpers", () => {
  it("hasServerSession is false only on 401", async () => {
    await expect(hasServerSession()).resolves.toBe(false);
    server.state.session = true;
    await expect(hasServerSession()).resolves.toBe(true);
  });

  it("serverLogin rejects with a readable message", async () => {
    await expect(serverLogin("nope")).rejects.toThrow("Wrong token");
    server.fetchMock.mockResolvedValueOnce(new Response("", { status: 500, statusText: "Internal Server Error" }));
    await expect(serverLogin(TOKEN)).rejects.toThrow("Login failed (500 Internal Server Error)");
    server.fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(serverLogin(TOKEN)).rejects.toThrow("Couldn't reach the server");
    await expect(serverLogin(TOKEN)).resolves.toBeUndefined();
  });

  it("any API call answered 401 announces it", async () => {
    const { getDownloadTasks } = await import("../api/downloads");
    const seen = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, seen);
    await expect(getDownloadTasks()).rejects.toBe("Unauthorized");
    window.removeEventListener(UNAUTHORIZED_EVENT, seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("web build transport", () => {
  it("the web build always uses the HTTP transport", async () => {
    vi.stubEnv("MODE", "web");
    win.__TAURI_INTERNALS__ = {};
    const { isTauri } = await import("../api/transport");
    expect(isTauri()).toBe(false);
    vi.unstubAllEnvs();
    expect(isTauri()).toBe(true);
  });
});
