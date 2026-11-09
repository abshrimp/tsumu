import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { clearDraftLink, draftFromLocation, prepareDraftSignIn } from "../lib/external-edit/draft-link";
import { DEFAULT_MCP_ENDPOINT, resolveMcpEndpoint } from "../lib/external-edit/config";
import { MCP_PAIRING_HISTORY_COOKIE, rememberMcpPairingCodeIssued } from "../lib/external-edit/pairing-history";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { createLocalBrowserSite } from "../lib/browser-site-create";
import { readBrowserDoc } from "../lib/browser-doc-storage";
import { loadLocalSites } from "../lib/site";

test("Google sign-in resumes the draft in the same tab without putting its credential in the callback", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const secret = "s".repeat(43);
  const id = "12345678-1234-4234-8234-123456789abc";
  const location = new URL(`https://tsumu.test/login#tsumu-import=${id}.${secret}`);
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    history: { replaceState(_state: unknown, _title: string, url: string) { location.href = new URL(url, location).href; } },
    sessionStorage: { setItem: (k: string, v: string) => items.set(k, v), getItem: (k: string) => items.get(k), removeItem: (k: string) => items.delete(k) },
  } });
  try {
    const callback = "/" + prepareDraftSignIn(draftFromLocation(), "Storage unavailable");
    assert.equal(callback, "/?resume-import=1");
    assert.equal(location.hash, "");
    location.href = "https://tsumu.test/login?error=AccessDenied";
    const retry = "/" + prepareDraftSignIn(draftFromLocation(), "Storage unavailable");
    assert.equal(retry, callback, "retrying with a permitted Google account resumes the same import");
    location.href = "https://tsumu.test/?error=AccessDenied";
    assert.equal(draftFromLocation(), null, "an error on Home cannot activate a pending draft");
    // Cancelled sign-in must not import a draft on an ordinary Home visit.
    location.pathname = "/";
    location.search = "";
    assert.equal(draftFromLocation(), null);
    location.href = new URL(callback + "&lang=en", location).href;
    assert.deepEqual(draftFromLocation(), { id, secret });
    clearDraftLink();
    assert.equal(location.search, "?lang=en");
    assert.equal(items.size, 0);
    assert.equal(draftFromLocation(), null);
    prepareDraftSignIn({ id, secret }, "Storage unavailable");
    location.href = "https://tsumu.test/login";
    assert.equal(prepareDraftSignIn(draftFromLocation(), "Storage unavailable"), "");
    location.search = "?error=OAuthCallbackError";
    assert.equal(draftFromLocation(), null, "a later unrelated sign-in cannot resume the abandoned draft");
  } finally {
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
