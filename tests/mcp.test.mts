import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { clearDraftLink, draftFromLocation, hasDraftResumeMarker, prepareDraftSignIn, resumeDraftAfterSignIn } from "../lib/external-edit/draft-link";
import { DEFAULT_MCP_ENDPOINT, resolveMcpEndpoint } from "../lib/external-edit/config";
import { MCP_PAIRING_HISTORY_COOKIE, rememberMcpPairingCodeIssued } from "../lib/external-edit/pairing-history";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { createLocalBrowserSite } from "../lib/browser-site-create";
import { readBrowserDoc } from "../lib/browser-doc-storage";
import { loadLocalSites } from "../lib/site";

test("Google OAuth resumes drafts without storing their secrets in Web Storage or callback URLs", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const secret = "s".repeat(43);
  const id = "12345678-1234-4234-8234-123456789abc";
  const location = new URL(`https://tsumu.test/login#tsumu-import=${id}.${secret}`);
  const requests: Array<{ method: string; body?: unknown }> = [];
  let pending: unknown = null;
  let alerts = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    history: { replaceState(_state: unknown, _title: string, url: string) { location.href = new URL(url, location).href; } },
    sessionStorage: {
      setItem: () => { throw new Error("Session storage must not receive credentials"); },
      getItem: () => { throw new Error("Session storage must not be read"); },
      removeItem: () => { throw new Error("Session storage must not be used"); },
    },
    alert: () => { alerts++; },
  } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, "/api/external-edit/draft-handoff");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, body });
    if (method === "POST") pending = body;
    if (method === "DELETE") pending = null;
    if (method === "PATCH") {
      const draft = pending;
      pending = null;
      return Response.json({ draft });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const callback = "/" + await prepareDraftSignIn(draftFromLocation(), "Storage unavailable");
    assert.equal(callback, "/?resume-import=1");
    assert.equal(location.hash, "");
    assert.equal(requests[0].method, "POST");
    assert.deepEqual(requests[0].body, { id, secret });
    assert.equal(alerts, 0);
    location.href = "https://tsumu.test/login?error=AccessDenied";
    const retry = "/" + await prepareDraftSignIn(draftFromLocation(), "Storage unavailable", true);
    assert.equal(retry, callback, "a failed Google sign-in may retry the same pending import");
    location.href = "https://tsumu.test/?error=AccessDenied";
    assert.equal(hasDraftResumeMarker(), false, "unrelated navigation cannot import a pending draft");
    assert.equal(draftFromLocation(), null);
    location.href = new URL(callback + "&lang=en", location).href;
    assert.equal(hasDraftResumeMarker(), true);
    assert.deepEqual(await resumeDraftAfterSignIn(), { id, secret });
    assert.equal(await resumeDraftAfterSignIn(), null, "handoff is consumed after first retrieval");
    clearDraftLink();
    assert.equal(location.search, "?lang=en");
    assert.equal(draftFromLocation(), null);
    assert.equal(hasDraftResumeMarker(), false);
    await prepareDraftSignIn({ id, secret }, "Storage unavailable");
    location.href = "https://tsumu.test/login";
    assert.equal(await prepareDraftSignIn(draftFromLocation(), "Storage unavailable"), "");
    assert.equal(requests.at(-1)?.method, "DELETE");
    location.search = "?error=OAuthCallbackError";
    assert.equal(await prepareDraftSignIn(draftFromLocation(), "Storage unavailable", false), "",
      "a new sign-in cannot reuse a previous handoff");
    assert.equal(alerts, 0);
    assert.doesNotMatch(JSON.stringify(requests.map(({ method }) => method)), new RegExp(secret));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

describe("mcp-config", () => {
test("MCP relay defaults to the official endpoint", () => {
  assert.equal(DEFAULT_MCP_ENDPOINT, "https://mcp.tsumu.ebii.net");
  assert.equal(resolveMcpEndpoint(undefined), DEFAULT_MCP_ENDPOINT);
  assert.equal(resolveMcpEndpoint(""), DEFAULT_MCP_ENDPOINT);
  assert.equal(resolveMcpEndpoint("  "), DEFAULT_MCP_ENDPOINT);
});

test("MCP relay uses the configured base URL without trailing slashes", () => {
  assert.equal(resolveMcpEndpoint("https://mcp.example.com"), "https://mcp.example.com");
  assert.equal(resolveMcpEndpoint(" https://mcp.example.com/// "), "https://mcp.example.com");
  assert.equal(resolveMcpEndpoint("http://localhost:8787/"), "http://localhost:8787");
});
});

describe("mcp-pairing-history", () => {
test("remember a successful pairing code on official Tsumu domains", () => {
  const written: string[] = [];
  assert.equal(rememberMcpPairingCodeIssued("tsumu.ebii.net", (cookie) => written.push(cookie)), true);
  assert.equal(rememberMcpPairingCodeIssued("EDITOR.TSUMU.EBII.NET", (cookie) => written.push(cookie)), true);
  assert.equal(rememberMcpPairingCodeIssued("tsumu.ebii.net.", (cookie) => written.push(cookie)), true);
  assert.equal(rememberMcpPairingCodeIssued("mcp.tsumu.ebii.net", (cookie) => written.push(cookie)), true);
  assert.equal(written.length, 4);
  for (const cookie of written) {
    assert.match(cookie, new RegExp(`^${MCP_PAIRING_HISTORY_COOKIE}=1;`));
    assert.match(cookie, /Domain=tsumu\.ebii\.net; Path=\/; Max-Age=31536000; SameSite=Lax; Secure/);
    assert.doesNotMatch(cookie, /pairingCode|sessionId|connectToken/);
  }
});

test("do not set a parent-domain cookie on self-hosted or unrelated origins", () => {
  let written = false;
  for (const hostname of ["localhost", "example.org", "tsumu.ebii.net.evil.test", "nottsumu.ebii.net", "ebii.net"]) {
    assert.equal(rememberMcpPairingCodeIssued(hostname, () => { written = true; }), false, hostname);
  }
  assert.equal(written, false);
});

test("a rejected cookie write must not block connecting", () => {
  assert.equal(rememberMcpPairingCodeIssued("tsumu.ebii.net", () => { throw new Error("Cookies disabled"); }), false);
});
});

describe("mcp-site-creation", () => {
const sharedIndexedDB = fakeIndexedDB();

test("MCP and Home share an atomic browser-site creation path", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const entries = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { indexedDB: sharedIndexedDB, localStorage, navigator: null },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const site = await createLocalBrowserSite({ name: "Coffee & Space" });
  assert.equal(site.name, "Coffee & Space");
  assert.equal(loadLocalSites({ strict: true }).length, 1);
  const raw = await readBrowserDoc(site.id);
  assert.equal(JSON.parse(raw!).siteName, site.name);

  await assert.rejects(createLocalBrowserSite({ name: "   " }));
  assert.equal(loadLocalSites({ strict: true }).length, 1, "invalid input must not add a site");
});

test("MCP bridge aborts in-flight session fetches on disconnect and scopes idempotency by action", async (t) => {
  const { connectExternalEdit, disconnectExternalEdit, useExternalEdit } = await import("../lib/external-edit/bridge");
  const { hydrateBrowserDoc } = await import("../lib/store");

  const origWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const origWebSocket = globalThis.WebSocket;
  const origFetch = globalThis.fetch;

  const entries = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
  const location = { pathname: "/", search: "", hostname: "localhost", origin: "http://localhost:3000" };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { indexedDB: sharedIndexedDB, localStorage, navigator: null, location },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "" },
  });

  const activeSite = await createLocalBrowserSite({ name: "Bridge Site" });
  location.pathname = "/sites/" + activeSite.id;
  await hydrateBrowserDoc();

  const sockets: Array<{
    sent: string[];
    readyState: number;
    onopen?: () => void;
    onmessage?: (ev: { data: string }) => void;
    onclose?: (ev?: { code?: number; reason?: string }) => void;
    close: () => void;
    send: (msg: string) => void;
  }> = [];
  class FakeWebSocket {
    static OPEN = 1;
    sent: string[] = [];
    readyState = 1;
    onopen?: () => void;
    onmessage?: (ev: { data: string }) => void;
    onerror?: () => void;
    onclose?: (ev?: { code?: number; reason?: string }) => void;
    constructor() { sockets.push(this); }
    send(msg: string) { this.sent.push(msg); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  t.after(async () => {
    await disconnectExternalEdit();
    globalThis.WebSocket = origWebSocket;
    globalThis.fetch = origFetch;
    if (origWindow) Object.defineProperty(globalThis, "window", origWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (origDoc) Object.defineProperty(globalThis, "document", origDoc);
    else Reflect.deleteProperty(globalThis, "document");
  });

  // 1. In-flight /bridge/sessions is aborted on disconnectExternalEdit() without opening a stale socket.
  let aborted = false;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  let resolveSlowFetch!: () => void;
  globalThis.fetch = (async (_input, init) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; });
    markFetchStarted();
    await new Promise<void>((resolve) => { resolveSlowFetch = resolve; });
    return new Response(JSON.stringify({
      sessionId: firstSession, pairingCode: "ABCDE-FGHJK-LMNPQ-RSTUV", connectToken: "a".repeat(43),
      wsUrl: relaySocket(firstSession), mcpUrl: "https://mcp.tsumu.ebii.net/mcp", expiresAt: Date.now() + 60_000,
    }), { status: 200 });
  }) as typeof fetch;

  const firstSession = "12345678-1234-4234-8234-123456789abc";
  const secondSession = "abcdef01-1234-4234-8234-abcdef012345";
  const relaySocket = (id: string) =>
    "wss://mcp.tsumu.ebii.net/bridge/connect?session=" + id;

  const pendingConnect = connectExternalEdit(true);
  await fetchStarted;
  await disconnectExternalEdit();
  resolveSlowFetch();
  await pendingConnect;
  assert.equal(aborted, true);
  assert.equal(sockets.length, 0);
  assert.equal(useExternalEdit.getState().phase, "disconnected");
  assert.equal(useExternalEdit.getState().error, null);

  // 2. Connect cleanly, verify list_sites storage reflects db status, and verify action-scoped idempotency.
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/api/status")) {
      return new Response(JSON.stringify({ db: false, collabTransport: "none", assets: false, auth: false, role: "editor" }), { status: 200 });
    }
    return new Response(JSON.stringify({
      sessionId: secondSession, pairingCode: "ABCDE-FGHJK-LMNPQ-RSTUV", connectToken: "b".repeat(43),
      wsUrl: relaySocket(secondSession), mcpUrl: "https://mcp.tsumu.ebii.net/mcp", expiresAt: Date.now() + 60_000,
    }), { status: 200 });
  }) as typeof fetch;

  await connectExternalEdit(true);
  assert.equal(sockets.length, 1);
  const ws = sockets[0]!;
  ws.onopen?.();
  assert.equal(useExternalEdit.getState().phase, "connected");

  // A temporary disconnection should re-open the same authorized session.
  ws.readyState = 3;
  ws.onclose?.();
  assert.equal(useExternalEdit.getState().phase, "connecting");
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(sockets.length, 2);
  const recovered = sockets[1]!;
  recovered.onopen?.();
  assert.equal(useExternalEdit.getState().phase, "connected");
  assert.equal(useExternalEdit.getState().code, "ABCDE-FGHJK-LMNPQ-RSTUV");

  recovered.onmessage?.({ data: JSON.stringify({ type: "request", requestId: "req-list-1", action: "list_sites", args: {} }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const listReply = JSON.parse(recovered.sent.at(-1)!);
  assert.equal(listReply.ok, true);
  assert.equal(listReply.result[0].storage, "browser");

  recovered.onmessage?.({
    data: JSON.stringify({
      type: "request", requestId: "msg-page-1", action: "create_page",
      args: { requestId: "shared_req_12345", name: "Pricing" },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const pageReply = JSON.parse(recovered.sent.at(-1)!);
  assert.equal(pageReply.ok, true);
  assert.equal(pageReply.result.savedToBrowser, true);
  assert.equal(pageReply.result.name, "Pricing");

  // Reusing the same args.requestId on a different action (create_site) must NOT return the cached create_page result.
  recovered.onmessage?.({
    data: JSON.stringify({
      type: "request", requestId: "msg-site-1", action: "create_site",
      args: { requestId: "shared_req_12345", name: "Separate Site" },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const siteReply = JSON.parse(recovered.sent.at(-1)!);
  assert.equal(siteReply.ok, true);
  assert.equal(siteReply.result.name, "Separate Site");
  assert.equal(siteReply.result.requiresReconnect, true);

  // A deliberate relay replacement must not fight the new owner of the socket.
  recovered.readyState = 3;
  recovered.onclose?.({ code: 1000, reason: "Replaced" });
  assert.equal(useExternalEdit.getState().phase, "disconnected");
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(sockets.length, 2, "replaced sockets must not reconnect");
});
});

describe("mcp-browser-reconnect", () => {
test("reload restores an unexpired grant using credentialed cookies, without re-pairing", async t => {
  const { resumeExternalEdit, disconnectExternalEdit, useExternalEdit } =
    await import("../lib/external-edit/bridge");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldSocket = globalThis.WebSocket;
  const oldFetch = globalThis.fetch;
  const location = { pathname: "/sites/site-a", hostname: "localhost", origin: "http://localhost:3000" };
  const values = new Map<string, string>([["tsumu-mcp-reconnect-known-v1:site-a", "1"]]);
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, localStorage } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  const sockets: Array<{ url: string; protocols: string[]; onopen?: () => void }> = [];
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    constructor(url: string, protocols: string[]) {
      sockets.push({ url, protocols, onopen: () => this.onopen?.() });
    }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const requests: Array<{ url: string; method?: string; credentials?: RequestCredentials; body?: unknown }> = [];
  const sessionId = "12345678-1234-4234-8234-123456789abc";
  const wsUrl = "wss://mcp.tsumu.ebii.net/bridge/connect?session=" + sessionId;
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    requests.push({ url: path, method: init?.method, credentials: init?.credentials,
      body: init?.body && JSON.parse(String(init.body)) });
    if (path.endsWith("/bridge/restore") && location.pathname.endsWith("site-a")) {
      return Response.json({ sessionId, pairingCode: null, connectToken: "s".repeat(43),
        wsUrl, canEdit: false, expiresAt: Date.now() + 60_000 });
    }
    if (path.endsWith("/bridge/restore")) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  }) as typeof fetch;
  t.after(async () => {
    await disconnectExternalEdit();
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldSocket;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  await resumeExternalEdit();
  await resumeExternalEdit();
  assert.equal(sockets.length, 1, "one editor tab must not resume the same grant twice");
  assert.equal(requests[0]?.url, "https://mcp.tsumu.ebii.net/bridge/restore");
  assert.equal(requests[0]?.credentials, "include");
  assert.deepEqual(requests[0]?.body, { siteId: "site-a" });
  assert.equal(useExternalEdit.getState().phase, "connecting");
  sockets[0]!.onopen?.();
  assert.equal(useExternalEdit.getState().phase, "connected");
  assert.equal(useExternalEdit.getState().code, null, "no reusable pairing code is exposed");
  assert.equal(useExternalEdit.getState().canEdit, false);

  location.pathname = "/sites/site-b";
  await resumeExternalEdit();
  assert.equal(sockets.length, 1, "a cookie for site A must never authorize site B");
  assert.equal(requests.filter(r => r.url.endsWith("/bridge/restore")).length, 1,
    "an unpaired site must not attempt a credentialed network restore");
  assert.equal(useExternalEdit.getState().phase, "disconnected");

  await disconnectExternalEdit();
  assert.equal(requests.at(-1)?.url, "https://mcp.tsumu.ebii.net/bridge/restore",
    "an unpaired site must not revoke the prior site's separate grant");
  assert.ok(requests.every(request => !request.url.endsWith("/bridge/sessions")),
    "automatic restoration must never silently issue new pairing codes");
});

test("site authorization uses fragment-only requests and does not expose connection tokens", async t => {
  const { hasMcpSiteApproval } = await import("../lib/external-edit/site-approval");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { hash: "#mcp-select=1" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(hasMcpSiteApproval(), true);
  location.hash = "#mcp-join=12345678-1234-4234-8234-123456789abc." + "a".repeat(43) + "&edit=0";
  assert.equal(hasMcpSiteApproval(), true);
  location.hash = "#mcp-join=malformed";
  assert.equal(hasMcpSiteApproval(), false);
});
});

describe("mcp-plugin-catalog", () => {
test("plugin links come from the relay and only published https listings are kept", async () => {
  const { parsePluginCatalog } = await import("../lib/external-edit/plugins");
  const catalog = parsePluginCatalog({
    guideUrl: "https://mcp.tsumu.ebii.net/",
    plugins: [
      { id: "claude", name: "Claude", icon: "https://mcp.tsumu.ebii.net/plugin-icons/claude.svg", url: "https://claude.ai/directory/tsumu" },
      { id: "cursor", name: "Cursor", icon: "https://mcp.tsumu.ebii.net/plugin-icons/cursor.svg", url: null },
      { id: "evil", name: "Evil", icon: "https://mcp.tsumu.ebii.net/x.svg", url: "javascript:alert(1)" },
      { id: "plain", name: "Plain", icon: "https://mcp.tsumu.ebii.net/x.svg", url: "http://plain.example" },
      { id: "noicon", name: "No icon", icon: "data:image/svg+xml,<svg/>", url: "https://example.com" },
      { id: "BAD ID", name: "Bad", icon: "https://mcp.tsumu.ebii.net/x.svg", url: "https://example.com" },
    ],
  }, "https://fallback.example/");
  assert.deepEqual(catalog.plugins, [
    { id: "claude", name: "Claude", icon: "https://mcp.tsumu.ebii.net/plugin-icons/claude.svg", url: "https://claude.ai/directory/tsumu" },
  ]);
  assert.equal(catalog.guideUrl, "https://mcp.tsumu.ebii.net/");
});

test("an unavailable catalog still links to the connection guide", async () => {
  const { parsePluginCatalog } = await import("../lib/external-edit/plugins");
  assert.deepEqual(parsePluginCatalog(null, "https://mcp.example.org/"), { guideUrl: "https://mcp.example.org/", plugins: [] });
  assert.equal(parsePluginCatalog({ guideUrl: "http://localhost:8787/" }).guideUrl, "http://localhost:8787/");
  assert.equal(parsePluginCatalog({ guideUrl: "javascript:alert(1)" }, "https://mcp.example.org/").guideUrl, "https://mcp.example.org/");
});
});
