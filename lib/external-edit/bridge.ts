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
import { currentSiteId } from "../site";
import { tr } from "../i18n";
import { resolveMcpEndpoint } from "./config";

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
const completed = new Map<string, unknown>();

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function revision(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function execute(action: string, rawArgs: unknown, siteId: string, canEdit: boolean): Promise<unknown> {
  if (currentSiteId() !== siteId) throw new Error(tr("The active Tsumu site changed"));
  const args = asObject(rawArgs);
  const s = useEditor.getState();
  if (action === "list_sites") return [{ id: siteId, name: s.doc.siteName, storage: "browser" }];
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
  if (action === "get_page" || action === "apply_operations") {
    const pageId = args.pageId;
    if (typeof pageId !== "string" || !s.doc.pages[pageId]) throw new Error(tr("Page not found"));
    const context = buildAiContext(s.doc, { pageId });
    const currentRevision = await revision(context.doc);
    if (action === "get_page") {
      return { siteId, pageId, revision: currentRevision, document: context.doc };
    }
    if (!canEdit) throw new Error(tr("This connection is read-only"));
    if (s.gestureActive || s.editingText !== null) throw new Error(tr("Finish the current editor gesture before using MCP"));
    if (args.expectedRevision !== currentRevision) {
      throw new Error(tr("The page changed. Call get_page to obtain the latest revision"));
    }
    const requestId = args.requestId;
    if (typeof requestId !== "string" || !/^[\w-]{8,80}$/.test(requestId)) {
      throw new Error(tr("A unique requestId is required"));
    }
    if (completed.has(requestId)) return completed.get(requestId);
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
    const result = {
      applied: verified.applied,
      savedToBrowser: true,
      cloudState: useEditor.getState().cloudState,
      revision: await revision(buildAiContext(useEditor.getState().doc, { pageId }).doc),
    };
    completed.set(requestId, result);
    if (completed.size > 100) completed.delete(completed.keys().next().value!);
    return result;
  }
  throw new Error(tr("Unknown external editing operation"));
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
  const siteId = currentSiteId();
  if (!siteId) {
    useExternalEdit.setState({ error: tr("No active site"), phase: "disconnected" });
    return;
  }
  useExternalEdit.setState({ phase: "connecting", error: null, canEdit });
  try {
    const response = await fetch(ENDPOINT + "/bridge/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, siteName: useEditor.getState().doc.siteName || "Tsumu site", canEdit }),
      credentials: "omit", cache: "no-store",
    });
    if (!response.ok) throw new Error(tr("MCP connection failed ({status})", { status: response.status }));
    const session = await response.json() as BridgeSession;
    if (!session.wsUrl || !session.connectToken || !session.pairingCode) throw new Error(tr("Invalid MCP session"));
    const ws = new WebSocket(session.wsUrl, ["tsumu-editor", session.connectToken]);
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
    useExternalEdit.setState({ phase: "disconnected", error: error instanceof Error ? error.message : tr("Connection failed") });
  }
}
