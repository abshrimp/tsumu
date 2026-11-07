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
import { rememberMcpPairingCodeIssued } from "./pairing-history";

const ENDPOINT = resolveMcpEndpoint(process.env.NEXT_PUBLIC_TSUMU_MCP_URL);
const MAX_REPLY_BYTES = 1024 * 1024;

type Phase = "disconnected" | "connecting" | "connected";
interface ExternalEditState {
  phase: Phase;
  code: string | null;
  mcpUrl: string;
  error: string | null;
  expiresAt: number | null;
  canEdit: boolean;
}
interface BridgeSession {
  sessionId: string;
  pairingCode: string;
  connectToken: string;
  wsUrl: string;
  mcpUrl: string;
  expiresAt: number;
}
interface BridgeRequest {
  type: "request";
  requestId: string;
  action: string;
  args: Record<string, unknown>;
}

export const useExternalEdit = create<ExternalEditState>(() => ({
  phase: "disconnected", code: null, mcpUrl: ENDPOINT + "/mcp",
  error: null, expiresAt: null, canEdit: true,
}));

let active: { ws: WebSocket; session: BridgeSession; siteId: string; canEdit: boolean } | null = null;
let connectAttempt = 0;
let pendingAbort: AbortController | null = null;
const completed = new Map<string, unknown>();

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
  const s = useEditor.getState();
  const status = serverStatusSnapshot() ?? await loadServerStatus();
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
    if (typeof id !== "string" || !s.doc.nodes[id]) throw new Error(tr("Element not found"));
    return { id, element: s.doc.nodes[id] };
  }
  if (action === "get_page") {
    const pageId = args.pageId;
    if (typeof pageId !== "string" || !s.doc.pages[pageId]) throw new Error(tr("Page not found"));
    const context = buildAiContext(s.doc, { pageId });
    return { siteId, pageId, revision: await revision(context.doc), document: context.doc };
  }
  if (!MUTATING_ACTIONS.has(action)) throw new Error(tr("Unknown external editing operation"));
  if (!canEdit) throw new Error(tr("This connection is read-only"));
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
      if (typeof pageId !== "string" || !s.doc.pages[pageId]) throw new Error(tr("Page not found"));
      const context = buildAiContext(s.doc, { pageId });
      const currentRevision = await revision(context.doc);
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
  if (typeof data !== "string" || data.length > 128 * 1024) return;
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

export async function disconnectExternalEdit(): Promise<void> {
  connectAttempt++;
  pendingAbort?.abort();
  pendingAbort = null;
  const session = active;
  active = null;
  completed.clear();
  useExternalEdit.setState({ phase: "disconnected", code: null, expiresAt: null, error: null });
  if (!session) return;
  session.ws.close(1000, "Disconnected");
  try {
    await fetch(ENDPOINT + "/bridge/revoke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.session.sessionId, connectToken: session.session.connectToken }),
      credentials: "omit", cache: "no-store",
    });
  } catch { /* The local connection is already closed. Server expiry is the fallback. */ }
}

export async function connectExternalEdit(canEdit: boolean): Promise<void> {
  await disconnectExternalEdit();
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
      credentials: "omit", cache: "no-store", signal: abort.signal,
    });
    if (attempt !== connectAttempt || abort.signal.aborted) return;
    if (!response.ok) throw new Error(tr("MCP connection failed ({status})", { status: response.status }));
    const session = await response.json() as BridgeSession;
    if (attempt !== connectAttempt || abort.signal.aborted) return;
    if (!session.wsUrl || !session.connectToken || !session.pairingCode) throw new Error(tr("Invalid MCP session"));
    if (pendingAbort === abort) pendingAbort = null;
    const ws = new WebSocket(session.wsUrl, ["tsumu-editor", session.connectToken]);
    rememberMcpPairingCodeIssued(window.location.hostname, (cookie) => { document.cookie = cookie; });
    active = { ws, session, siteId, canEdit };
    ws.onopen = () => {
      if (active?.ws === ws) useExternalEdit.setState({
        phase: "connected", code: session.pairingCode, mcpUrl: session.mcpUrl,
        expiresAt: session.expiresAt, error: null, canEdit,
      });
    };
    ws.onmessage = (event) => { if (active?.ws === ws) void onMessage(ws, siteId, canEdit, event.data); };
    ws.onerror = () => {
      if (active?.ws === ws) useExternalEdit.setState({ error: tr("WebSocket connection failed") });
    };
    ws.onclose = () => {
      if (active?.ws === ws) {
        active = null;
        useExternalEdit.setState({ phase: "disconnected", code: null, expiresAt: null });
      }
    };
  } catch (error) {
    if (pendingAbort === abort) pendingAbort = null;
    if (attempt !== connectAttempt || abort.signal.aborted) return;
    useExternalEdit.setState({ phase: "disconnected", error: error instanceof Error ? error.message : tr("Connection failed") });
  }
}
