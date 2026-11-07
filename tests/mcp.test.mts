import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MCP_ENDPOINT, resolveMcpEndpoint } from "../lib/external-edit/config";
import { MCP_PAIRING_HISTORY_COOKIE, rememberMcpPairingCodeIssued } from "../lib/external-edit/pairing-history";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { createLocalBrowserSite } from "../lib/browser-site-create";
import { readBrowserDoc } from "../lib/browser-doc-storage";
import { loadLocalSites } from "../lib/site";

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
    onclose?: () => void;
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
    onclose?: () => void;
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
      sessionId: "s1", pairingCode: "111222", connectToken: "tok1",
      wsUrl: "wss://mcp.test/ws", mcpUrl: "https://mcp.test/mcp", expiresAt: Date.now() + 60_000,
    }), { status: 200 });
  }) as typeof fetch;

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
      sessionId: "s2", pairingCode: "333444", connectToken: "tok2",
      wsUrl: "wss://mcp.test/ws", mcpUrl: "https://mcp.test/mcp", expiresAt: Date.now() + 60_000,
    }), { status: 200 });
  }) as typeof fetch;

  await connectExternalEdit(true);
  assert.equal(sockets.length, 1);
  const ws = sockets[0]!;
  ws.onopen?.();
  assert.equal(useExternalEdit.getState().phase, "connected");

  ws.onmessage?.({ data: JSON.stringify({ type: "request", requestId: "req-list-1", action: "list_sites", args: {} }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const listReply = JSON.parse(ws.sent.at(-1)!);
  assert.equal(listReply.ok, true);
  assert.equal(listReply.result[0].storage, "browser");

  ws.onmessage?.({
    data: JSON.stringify({
      type: "request", requestId: "msg-page-1", action: "create_page",
      args: { requestId: "shared_req_12345", name: "Pricing" },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const pageReply = JSON.parse(ws.sent.at(-1)!);
  assert.equal(pageReply.ok, true);
  assert.equal(pageReply.result.savedToBrowser, true);
  assert.equal(pageReply.result.name, "Pricing");

  // Reusing the same args.requestId on a different action (create_site) must NOT return the cached create_page result.
  ws.onmessage?.({
    data: JSON.stringify({
      type: "request", requestId: "msg-site-1", action: "create_site",
      args: { requestId: "shared_req_12345", name: "Separate Site" },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const siteReply = JSON.parse(ws.sent.at(-1)!);
  assert.equal(siteReply.ok, true);
  assert.equal(siteReply.result.name, "Separate Site");
  assert.equal(siteReply.result.requiresReconnect, true);
});
});
