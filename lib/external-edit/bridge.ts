"use client";

/**
 * Optional remote editing bridge. Tsumu never speaks MCP; it receives a small set of
 * edit requests from the independently deployed tsumu-mcp service while the editor
 * tab is open. The site's document never lives on the relay.
 */
import { create } from "zustand";
import { buildAiContext, applyAiOps, cloneDocWithoutAssets, type AiOp } from "../aiOps";
import { applyAiEdits } from "../ai/client";
import { persistDoc, useEditor } from "../store";
import { currentSiteId, sitePath } from "../site";
import { createLocalBrowserSite } from "../browser-site-create";
import { loadServerStatus, serverStatusSnapshot } from "../status";
import { tr } from "../i18n";
import { resolveMcpEndpoint } from "./config";
import { rememberReconnectSite, knownReconnectSite, forgetReconnectSite } from "./reconnect-hint";
import { externalEditSiteRole } from "./site-permission";

const ENDPOINT = resolveMcpEndpoint(process.env.NEXT_PUBLIC_TSUMU_MCP_URL);
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_REPLY_BYTES = 4 * 1024 * 1024;
type Phase = "disconnected" | "connecting" | "connected";
interface ExternalEditState {
  phase: Phase;
  code: string | null;
  error: string | null;
  expiresAt: number | null;
  canEdit: boolean;
}
interface BridgeSession {
  sessionId: string;
  pairingCode: string | null;
  connectToken: string;
  wsUrl: string;
  expiresAt: number;
}
interface BridgeRequest {
  type: "request";
  requestId: string;
  action: string;
  args: Record<string, unknown>;
}

export const useExternalEdit = create<ExternalEditState>(() => ({
  phase: "disconnected", code: null,
  error: null, expiresAt: null, canEdit: true,
}));

interface ActiveBridge {
  ws: WebSocket | null;
  session: BridgeSession;
  siteId: string;
  canEdit: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  renewTimer: ReturnType<typeof setInterval> | null;
  reconnects: number;
}

let active: ActiveBridge | null = null;
let connectAttempt = 0;
let pendingAbort: AbortController | null = null;
let restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
let restoreConflicts = 0;
const completed = new Map<string, unknown>();

function cancelRestoreRetry(): void {
  if (restoreRetryTimer !== null) clearTimeout(restoreRetryTimer);
  restoreRetryTimer = null;
  restoreConflicts = 0;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function revision(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const MUTATING_ACTIONS = new Set(["apply_operations", "create_page", "create_site"]);
let writeInProgress = false;

async function execute(action: string, rawArgs: unknown, siteId: string, canEdit: boolean): Promise<unknown> {
  if (currentSiteId() !== siteId) throw new Error(tr("The active Tsumu site changed"));
  const args = asObject(rawArgs);
  const status = serverStatusSnapshot() ?? await loadServerStatus();
  if (!status) throw new Error(tr("Connection failed"));
  // Current site membership must be checked for every MCP command, not just
  // when the long-lived browser pairing was first approved. This also prevents
  // local data disclosure after a user's server-side site access is revoked.
  const siteRole = await externalEditSiteRole(siteId, status);
  if (currentSiteId() !== siteId) throw new Error(tr("The active Tsumu site changed"));
  const s = useEditor.getState();
  const isServerBacked = Boolean(status?.db);

  if (action === "list_sites") {
    return [{ id: siteId, name: s.doc.siteName, storage: isServerBacked ? "server" : "browser" }];
  }
  if (action === "list_pages") {
    return s.doc.pageOrder.map((id) => {
      const page = s.doc.pages[id];
      return { id, name: page?.name ?? "", slug: page?.slug ?? "" };
    });
  }
  if (action === "get_element") {
    const id = args.elementId;
    if (typeof id !== "string" || !Object.hasOwn(s.doc.nodes, id) || !s.doc.nodes[id]) throw new Error(tr("Element not found"));
    return { id, element: s.doc.nodes[id] };
  }
  if (action === "get_page") {
    const pageId = args.pageId;
    if (typeof pageId !== "string" || !Object.hasOwn(s.doc.pages, pageId) || !s.doc.pages[pageId]) throw new Error(tr("Page not found"));
    const context = buildAiContext(s.doc, { pageId });
    return { siteId, pageId, revision: await revision(context.doc), document: context.doc };
  }
  if (!MUTATING_ACTIONS.has(action)) throw new Error(tr("Unknown external editing operation"));
  if (!canEdit || siteRole === "viewer") throw new Error(tr("This connection is read-only"));
  const requestId = args.requestId;
  if (typeof requestId !== "string" || !/^[\w-]{8,80}$/.test(requestId)) {
    throw new Error(tr("A unique requestId is required"));
  }
  const cacheKey = `${siteId}:${action}:${requestId}`;
  if (completed.has(cacheKey)) return completed.get(cacheKey);
  if (writeInProgress) throw new Error(tr("Another external edit is in progress. Try again after it finishes."));
  if (s.gestureActive || s.editingText !== null) throw new Error(tr("Finish the current editor gesture before using MCP"));

  writeInProgress = true;
  try {
    let result: unknown;
    if (action === "create_site") {
      const name = args.name;
      if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
        throw new Error(tr("Enter a site name"));
      }
      if (!status || status.db) {
        throw new Error(tr("MCP site creation currently requires browser-only storage. Create server-backed sites in Tsumu."));
      }
      const created = await createLocalBrowserSite({ name: name.trim() });
      result = {
        id: created.id,
        name: created.name,
        storage: "browser",
        url: new URL(sitePath(created.id), window.location.origin).toString(),
        requiresReconnect: true,
        note: "Open the new site in this browser and pair it separately before editing it with MCP.",
      };
    } else if (action === "create_page") {
      const name = args.name;
      if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
        throw new Error(tr("Enter a page name"));
      }
      const id = useEditor.getState().addPage(undefined, name.trim());
      const nextState = useEditor.getState();
      const page = nextState.doc.pages[id];
      if (!page) throw new Error(tr("Page not found"));
      const saved = await persistDoc(nextState.doc, true);
      if (saved !== "saved") throw new Error(tr("Page created but browser saving failed. Check Tsumu before retrying."));
      result = {
        siteId,
        pageId: id,
        name: page.name,
        slug: page.slug,
        savedToBrowser: !isServerBacked,
        revision: await revision(buildAiContext(useEditor.getState().doc, { pageId: id }).doc),
      };
    } else {
      const pageId = args.pageId;
      if (typeof pageId !== "string" || !Object.hasOwn(s.doc.pages, pageId) || !s.doc.pages[pageId]) throw new Error(tr("Page not found"));
      const context = buildAiContext(s.doc, { pageId });
      const currentRevision = await revision(context.doc);
      // Do not validate a revision against one document and then mutate a
      // different one if the user edits or navigates during the hash.
      if (currentSiteId() !== siteId || useEditor.getState().doc !== s.doc) {
        throw new Error(tr("The page changed. Call get_page to obtain the latest revision"));
      }
      if (args.expectedRevision !== currentRevision) {
        throw new Error(tr("The page changed. Call get_page to obtain the latest revision"));
      }
      const ops = args.operations;
      if (!Array.isArray(ops) || ops.length < 1 || ops.length > 100) {
        throw new Error(tr("Provide between 1 and 100 operations"));
      }
      const verified = applyAiOps(cloneDocWithoutAssets(context.doc), ops as AiOp[], context.target);
      if (verified.errors.length || verified.applied.length !== ops.length) {
        throw new Error(verified.errors.join("; ") || tr("Invalid operations"));
      }
      const before = useEditor.getState().doc;
      useEditor.getState().updateDoc((draft) => {
        applyAiEdits(draft, context, verified.applied);
      });
      const after = useEditor.getState().doc;
      if (after === before) throw new Error(tr("No changes were applied"));
      const saved = await persistDoc(after, true);
      if (saved !== "saved") {
        throw new Error(tr("Edits were applied but browser saving failed; inspect Tsumu before retrying"));
      }
      result = {
        applied: verified.applied,
        savedToBrowser: !isServerBacked,
        cloudState: useEditor.getState().cloudState,
        revision: await revision(buildAiContext(useEditor.getState().doc, { pageId }).doc),
      };
    }
    completed.set(cacheKey, result);
    if (completed.size > 100) completed.delete(completed.keys().next().value!);
    return result;
  } finally {
    writeInProgress = false;
  }
}

async function onMessage(socket: WebSocket, siteId: string, canEdit: boolean, data: unknown): Promise<void> {
  if (typeof data !== "string" || data.length > MAX_REQUEST_BYTES) return;
  let message: BridgeRequest;
  try { message = JSON.parse(data) as BridgeRequest; } catch { return; }
  if (!message || message.type !== "request" || !/^[\w-]{8,80}$/.test(message.requestId)) return;
  const reply: Record<string, unknown> = { type: "response", requestId: message.requestId };
  try {
    reply.result = await execute(message.action, message.args, siteId, canEdit);
    reply.ok = true;
    if (JSON.stringify(reply).length > MAX_REPLY_BYTES) {
      throw new Error(tr("The result is too large. Reduce the page or request scope"));
    }
  } catch (error) {
    delete reply.result;
    reply.ok = false;
    reply.error = error instanceof Error ? error.message : tr("Operation failed");
  }
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply));
}

/** Confirm that the relay has not returned a socket on another origin. */
function validSession(session: BridgeSession): boolean {
  try {
    const endpoint = new URL(ENDPOINT);
    const socket = new URL(session.wsUrl);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session.sessionId) &&
      (session.pairingCode === null || /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}$/.test(session.pairingCode)) &&
      /^[A-Za-z0-9_-]{40,64}$/.test(session.connectToken) &&
      Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now() &&
      socket.protocol === (endpoint.protocol === "https:" ? "wss:" : "ws:") &&
      socket.host === endpoint.host && socket.pathname === "/bridge/connect" &&
      socket.searchParams.get("session") === session.sessionId;
  } catch {
    return false;
  }
}

/** Keep a live editor tab paired across transient network and WebSocket outages. */
function scheduleSocketRetry(bridge: ActiveBridge): void {
  if (active !== bridge || bridge.retryTimer !== null) return;
  if (currentSiteId() !== bridge.siteId) {
    abandonLocalBridge(bridge);
    return;
  }
  if (Date.now() >= bridge.session.expiresAt) {
    abandonLocalBridge(bridge);
    void resumeExternalEdit();
    return;
  }
  useExternalEdit.setState({ phase: "connecting", code: null, error: null });
  const delay = Math.min(30_000, 750 * 2 ** Math.min(bridge.reconnects++, 6));
  bridge.retryTimer = setTimeout(() => {
    bridge.retryTimer = null;
    openSocket(bridge);
  }, delay);
}

function openSocket(bridge: ActiveBridge): void {
  if (active !== bridge) return;
  if (Date.now() >= bridge.session.expiresAt || currentSiteId() !== bridge.siteId) {
    scheduleSocketRetry(bridge);
    return;
  }
  let socket: WebSocket;
  try {
    socket = new WebSocket(bridge.session.wsUrl, ["tsumu-editor", bridge.session.connectToken]);
  } catch {
    scheduleSocketRetry(bridge);
    return;
  }
  bridge.ws = socket;
  socket.onopen = () => {
    if (active !== bridge || bridge.ws !== socket) return;
    if (currentSiteId() !== bridge.siteId) {
      abandonLocalBridge(bridge);
      return;
    }
    bridge.reconnects = 0;
    rememberReconnectSite(bridge.siteId);
    if (bridge.renewTimer !== null) clearInterval(bridge.renewTimer);
    bridge.renewTimer = setInterval(() => { void renewBridgeSession(bridge); }, 15 * 60_000);
    useExternalEdit.setState({
      phase: "connected", code: bridge.session.pairingCode,
      expiresAt: bridge.session.expiresAt, error: null, canEdit: bridge.canEdit,
    });
  };
  socket.onmessage = (event) => {
    if (active === bridge && bridge.ws === socket) {
      void onMessage(socket, bridge.siteId, bridge.canEdit, event.data);
    }
  };
  socket.onerror = () => {
    // Browsers follow an error event with close; retry from the close callback.
  };
  socket.onclose = (event) => {
    if (active !== bridge || bridge.ws !== socket) return;
    // Another socket has taken over, or the relay intentionally revoked the
    // grant. Reconnecting then would repeatedly evict the replacement socket.
    if (event?.code === 1000 && ["Disconnected", "Session expired", "Replaced"].includes(event.reason)) {
      abandonLocalBridge(bridge);
      if (event.reason === "Disconnected") forgetReconnectSite(bridge.siteId);
      if (event.reason === "Session expired") void resumeExternalEdit();
      return;
    }
    scheduleSocketRetry(bridge);
  };
}

/** Close this tab's transport without revoking the site's long-lived grant. */
function abandonLocalBridge(bridge: ActiveBridge): void {
  if (active === bridge) active = null;
  if (bridge.retryTimer !== null) clearTimeout(bridge.retryTimer);
  if (bridge.renewTimer !== null) clearInterval(bridge.renewTimer);
  bridge.retryTimer = null;
  bridge.renewTimer = null;
  try { bridge.ws?.close(1000, "Disconnected"); } catch { /* The old tab is already closed. */ }
  completed.clear();
  useExternalEdit.setState({ phase: "disconnected", code: null, expiresAt: null, error: null });
}

async function renewBridgeSession(bridge: ActiveBridge): Promise<void> {
  if (active !== bridge || currentSiteId() !== bridge.siteId) return;
  try {
    const response = await fetch(ENDPOINT + "/bridge/renew", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: bridge.siteId }),
      credentials: "include", cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        abandonLocalBridge(bridge);
        void resumeExternalEdit();
      }
      return;
    }
    const data = await response.json() as { expiresAt?: number };
    if (active !== bridge || currentSiteId() !== bridge.siteId) return;
    if (Number.isSafeInteger(data.expiresAt) && data.expiresAt! > Date.now()) {
      bridge.session.expiresAt = data.expiresAt!;
      useExternalEdit.setState({ expiresAt: data.expiresAt! });
    }
  } catch { /* Network interruptions are retried by the next renewal or WebSocket reconnect. */ }
}

/** Restore this site's authorized connection via its HttpOnly cookie after a reload or browser restart. */
export async function resumeExternalEdit(): Promise<void> {
  const siteId = currentSiteId();
  if (!siteId) return;
  if (active) {
    if (active.siteId !== siteId) abandonLocalBridge(active);
    else return;
  }
  if (!knownReconnectSite(siteId) || pendingAbort) return;
  const attempt = ++connectAttempt;
  const abort = new AbortController();
  pendingAbort = abort;
  try {
    const response = await fetch(ENDPOINT + "/bridge/restore", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId }), credentials: "include", cache: "no-store", signal: abort.signal,
    });
    if (attempt !== connectAttempt || abort.signal.aborted || currentSiteId() !== siteId) return;
    if (response.status === 409) {
      // Another tab has just rotated the shared HttpOnly cookie. Retry only
      // after its response can update the browser's cookie jar; never discard
      // the saved reconnect hint for a transient rotation conflict.
      if (restoreRetryTimer === null && restoreConflicts < 3) {
        const delay = 750 * 2 ** restoreConflicts++;
        restoreRetryTimer = setTimeout(() => {
          restoreRetryTimer = null;
          if (!active && currentSiteId() === siteId && knownReconnectSite(siteId)) {
            void resumeExternalEdit();
          }
        }, delay);
      }
      return;
    }
    if (response.status === 403 || response.status === 404) {
      cancelRestoreRetry();
      forgetReconnectSite(siteId);
      return;
    }
    if (!response.ok) throw new Error(tr("MCP connection failed ({status})", { status: response.status }));
    const session = await response.json() as BridgeSession & { canEdit: boolean };
    if (attempt !== connectAttempt || abort.signal.aborted || currentSiteId() !== siteId) return;
    if (!validSession(session) || typeof session.canEdit !== "boolean") throw new Error(tr("Invalid MCP session"));
    cancelRestoreRetry();
    const bridge: ActiveBridge = {
      ws: null, session, siteId, canEdit: session.canEdit,
      retryTimer: null, renewTimer: null, reconnects: 0,
    };
    active = bridge;
    useExternalEdit.setState({
      phase: "connecting", error: null, code: null,
      canEdit: bridge.canEdit, expiresAt: session.expiresAt,
    });
    openSocket(bridge);
  } catch (error) {
    if (attempt === connectAttempt && !abort.signal.aborted) {
      useExternalEdit.setState({ phase: "disconnected",
        error: error instanceof Error ? error.message : tr("Connection failed") });
    }
  } finally {
    if (pendingAbort === abort) pendingAbort = null;
  }
}

/** Revoke both the active transport and its server-side persistent grant. */
export async function disconnectExternalEdit(): Promise<void> {
  connectAttempt++;
  cancelRestoreRetry();
  pendingAbort?.abort();
  pendingAbort = null;
  const siteId = active?.siteId || currentSiteId();
  const wasConnected = !!active || (siteId && knownReconnectSite(siteId));
  if (siteId) forgetReconnectSite(siteId);
  const session = active?.session;
  if (active) abandonLocalBridge(active);
  else useExternalEdit.setState({ phase: "disconnected", code: null, expiresAt: null, error: null });
  if (!wasConnected) return;
  try {
    await fetch(ENDPOINT + "/bridge/revoke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, ...(session
        ? { sessionId: session.sessionId, connectToken: session.connectToken }
        : {}) }),
      credentials: "include", cache: "no-store",
    });
  } catch { /* A server-side grant is also bounded by its expiry. */ }
}

/** Associate an expressly selected site with a grant after verifying the live editor socket. */
export async function attachMcpSiteInvite(invite: string): Promise<void> {
  const parts = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(invite);
  const bridge = active;
  if (!parts || !bridge || useExternalEdit.getState().phase !== "connected" ||
      currentSiteId() !== bridge.siteId) throw new Error(tr("MCP connection failed"));
  const response = await fetch(ENDPOINT + "/bridge/attach", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantId: parts[1], ticket: parts[2],
      sessionId: bridge.session.sessionId, connectToken: bridge.session.connectToken }),
    credentials: "include", cache: "no-store",
  });
  if (!response.ok) throw new Error(tr("MCP connection failed ({status})", { status: response.status }));
}

export async function connectExternalEdit(canEdit: boolean): Promise<void> {
  // Disconnect updates the browser state synchronously. Do not delay a fresh
  // connection while an unavailable relay is still processing old revocation.
  cancelRestoreRetry();
  if (active) abandonLocalBridge(active);
  pendingAbort?.abort();
  const attempt = ++connectAttempt;
  const siteId = currentSiteId();
  if (!siteId) {
    useExternalEdit.setState({ error: tr("No active site"), phase: "disconnected" });
    return;
  }
  const abort = new AbortController();
  pendingAbort = abort;
  useExternalEdit.setState({ phase: "connecting", error: null, canEdit });
  try {
    const response = await fetch(ENDPOINT + "/bridge/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, siteName: useEditor.getState().doc.siteName || "Tsumu site", canEdit }),
      credentials: "include", cache: "no-store", signal: abort.signal,
    });
    if (attempt !== connectAttempt || abort.signal.aborted) return;
    if (!response.ok) throw new Error(tr("MCP connection failed ({status})", { status: response.status }));
    const session = await response.json() as BridgeSession;
    if (attempt !== connectAttempt || abort.signal.aborted) return;
    if (!validSession(session)) throw new Error(tr("Invalid MCP session"));
    if (pendingAbort === abort) pendingAbort = null;
    const bridge: ActiveBridge = {
      ws: null, session, siteId, canEdit, retryTimer: null, renewTimer: null, reconnects: 0,
    };
    active = bridge;
    openSocket(bridge);
  } catch (error) {
    if (pendingAbort === abort) pendingAbort = null;
    if (attempt !== connectAttempt || abort.signal.aborted) return;
    useExternalEdit.setState({ phase: "disconnected", error: error instanceof Error ? error.message : tr("Connection failed") });
  }
}
