import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { clearDraftLink, draftFromLocation, hasDraftResumeMarker, prepareDraftSignIn, resumeDraftAfterSignIn } from "../lib/external-edit/draft-link";
import { DEFAULT_MCP_ENDPOINT, resolveMcpEndpoint } from "../lib/external-edit/config";
import { OFFICIAL_EDITOR_HOST, OFFICIAL_EDITOR_ORIGIN, OFFICIAL_MCP_ORIGIN, isOfficialEditorHost, isOfficialEditorOrigin } from "../lib/external-edit/official.mjs";
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

describe("hosted-mcp-integration", () => {
test("official OAuth features are enabled only for the exact hosted editor", () => {
  assert.equal(OFFICIAL_EDITOR_HOST, "tsumu.ebii.net");
  assert.equal(OFFICIAL_EDITOR_ORIGIN, "https://tsumu.ebii.net");
  assert.equal(OFFICIAL_MCP_ORIGIN, DEFAULT_MCP_ENDPOINT);
  for (const host of ["tsumu.ebii.net", "TSUMU.EBII.NET", "tsumu.ebii.net:443"]) {
    assert.equal(isOfficialEditorHost(host), true, host);
  }
  for (const host of ["", "localhost:3000", "editor.example.org", "mcp.tsumu.ebii.net",
    "tsumu.ebii.net.evil.example", "fake-tsumu.ebii.net"]) {
    assert.equal(isOfficialEditorHost(host), false, host);
  }
  assert.equal(isOfficialEditorOrigin("https://tsumu.ebii.net"), true);
  assert.equal(isOfficialEditorOrigin("http://tsumu.ebii.net"), false);
  assert.equal(isOfficialEditorOrigin("https://editor.example.org"), false);
});
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

  const waitForReply = async (requestId: string): Promise<{
    requestId: string; ok: boolean; result: any;
  }> => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const reply = recovered.sent.map(message => JSON.parse(message))
        .find(message => message.requestId === requestId);
      if (reply) return reply;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`MCP response not received: ${requestId}`);
  };

  recovered.onmessage?.({ data: JSON.stringify({ type: "request", requestId: "req-list-1", action: "list_sites", args: {} }) });
  const listReply = await waitForReply("req-list-1");
  assert.equal(listReply.ok, true);
  assert.equal(listReply.result[0].storage, "browser");

  recovered.onmessage?.({
    data: JSON.stringify({
      type: "request", requestId: "msg-page-1", action: "create_page",
      args: { requestId: "shared_req_12345", name: "Pricing" },
    }),
  });
  const pageReply = await waitForReply("msg-page-1");
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
  const siteReply = await waitForReply("msg-site-1");
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

  const successfulFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await disconnectExternalEdit();
  assert.ok(useExternalEdit.getState().error);
  assert.equal(useExternalEdit.getState().revoking, false);
  assert.equal(useExternalEdit.getState().phase, "connected", "failed revocation remains available to retry");
  assert.equal(values.get("tsumu-mcp-reconnect-known-v1:site-a"), "1");
  globalThis.fetch = successfulFetch;

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

test("a concurrent cookie rotation retries restoration without discarding the site grant", async t => {
  const { resumeExternalEdit, disconnectExternalEdit, useExternalEdit } =
    await import("../lib/external-edit/bridge");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldSocket = globalThis.WebSocket;
  const oldFetch = globalThis.fetch;
  const siteId = "site-race";
  const local = new Map([["tsumu-mcp-reconnect-known-v1:" + siteId, "1"]]);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/sites/" + siteId, hostname: "localhost" },
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, val: string) => { local.set(key, val); },
      removeItem: (key: string) => { local.delete(key); },
    },
  } });
  let socketCount = 0;
  class FakeWebSocket {
    readyState = 1;
    constructor() { socketCount++; }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const sessionId = "12345678-1234-4234-8234-123456789abc";
  let restores = 0;
  globalThis.fetch = (async input => {
    if (String(input).endsWith("/bridge/restore")) {
      restores++;
      if (restores === 1) return Response.json({ error: "Rotated by another tab" }, { status: 409 });
      return Response.json({
        sessionId, pairingCode: null, connectToken: "r".repeat(43),
        wsUrl: "wss://mcp.tsumu.ebii.net/bridge/connect?session=" + sessionId,
        expiresAt: Date.now() + 60_000, canEdit: false,
      });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  t.after(async () => {
    await disconnectExternalEdit();
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldSocket;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  await resumeExternalEdit();
  assert.equal(restores, 1);
  assert.equal(local.get("tsumu-mcp-reconnect-known-v1:" + siteId), "1");
  await new Promise<void>(resolve => setTimeout(resolve, 1100));
  assert.equal(restores, 2, "a conflicting rotation is retried automatically");
  assert.equal(socketCount, 1);
  assert.equal(useExternalEdit.getState().phase, "connecting");
});

test("site authorization uses fragment-only requests and does not expose connection tokens", async t => {
  const { hasMcpSiteApproval, startMcpSiteApproval } = await import("../lib/external-edit/site-approval");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { origin: "https://tsumu.ebii.net", hash: "#mcp-select=1" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(hasMcpSiteApproval(), true);
  location.hash = "#mcp-join=12345678-1234-4234-8234-123456789abc." + "a".repeat(43) + "&edit=0&site=site-a";
  assert.equal(hasMcpSiteApproval(), true);
  location.hash = "#mcp-join=12345678-1234-4234-8234-123456789abc." + "a".repeat(43) + "&edit=0";
  assert.equal(hasMcpSiteApproval(), false, "site-bound invitation cannot omit the selected site");
  location.hash = "#mcp-join=malformed";
  assert.equal(hasMcpSiteApproval(), false);
  location.hash = "#mcp-select=1";
  location.origin = "https://selfhost.example.org";
  assert.equal(hasMcpSiteApproval(), false, "self-hosted editors must not accept the hosted OAuth fragment");
  assert.equal(startMcpSiteApproval(true), false, "no connection attempt is started on self-hosted domains");
  location.origin = "http://tsumu.ebii.net";
  assert.equal(hasMcpSiteApproval(), false, "insecure origin must not receive official-site approval");
});
});

test("a changed invitation target never attempts to connect the unintended editor", async t => {
  const { startMcpSiteApproval } = await import("../lib/external-edit/site-approval");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const messages: Array<{ data: unknown; target: string }> = [];
  const location = {
    origin: "https://tsumu.ebii.net",
    pathname: "/sites/site-b",
    search: "",
    hash: "#mcp-join=12345678-1234-4234-8234-123456789abc." + "a".repeat(43) +
      "&edit=1&site=site-a",
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    history: { state: null, replaceState() {} },
    opener: { closed: false, postMessage(data: unknown, target: string) { messages.push({ data, target }); } },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(startMcpSiteApproval(false), true);
  assert.deepEqual(messages, [{
    data: { type: "tsumu-mcp-site-ready", siteId: "site-b", ok: false,
      error: "Selected site mismatch" },
    target: "https://tsumu.ebii.net",
  }]);
});

describe("mcp-site-permissions", () => {
test("viewer access cannot silently become editing access through a stored MCP grant", async () => {
  const { externalEditSiteRole } = await import("../lib/external-edit/site-permission");
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const getRole = (role: string, status = 200) => (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return Response.json({ site: { accessRole: role } }, { status });
  }) as typeof fetch;
  assert.equal(await externalEditSiteRole("site-a", { db: true, auth: false }, getRole("viewer")), "viewer");
  assert.deepEqual(requests[0], {
    url: "/api/sites/site-a",
    init: { method: "GET", cache: "no-store", credentials: "same-origin" },
  });
  assert.equal(await externalEditSiteRole("site-a", { db: true, auth: false }, getRole("editor")), "editor");
  assert.equal(await externalEditSiteRole("site-a", { db: true, auth: false }, getRole("owner")), "owner");
  await assert.rejects(
    externalEditSiteRole("site-a", { db: true, auth: false }, getRole("viewer", 403)),
    /no longer authorized/,
  );
  await assert.rejects(
    externalEditSiteRole("site-a", { db: true, auth: false }, getRole("unknown")),
    /no longer authorized/,
  );
  const user = { email: "member@example.test", name: null, image: null };
  for (const db of [true, false]) {
    const currentPermissions: typeof fetch = async url => String(url) === "/api/status"
      ? Response.json({ auth: true, db, role: "viewer", user })
      : Response.json({ site: { accessRole: "owner" } });
    assert.equal(await externalEditSiteRole("site-a", { auth: true, db, user }, currentPermissions), "viewer");
  }
  assert.equal(await externalEditSiteRole("local-site", { db: false, auth: false }, (() => {
    throw new Error("browser-only permissions should not call a server");
  }) as typeof fetch), null);
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
