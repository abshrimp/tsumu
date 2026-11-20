import { storageKey } from "../storage-keys";

/**
 * A reconnectable MCP browser-session credential is kept only in this tab's
 * sessionStorage. Never write it to localStorage, a URL, or a shared cookie.
 * Server-side expiry and explicit revocation remain authoritative.
 */
const KEY = storageKey("mcp-reconnect-v1");

export interface ReconnectSession {
  sessionId: string;
  pairingCode: string;
  connectToken: string;
  wsUrl: string;
  expiresAt: number;
}

export interface SavedMcpConnection {
  siteId: string;
  canEdit: boolean;
  session: ReconnectSession;
}

export function forgetMcpConnection(): void {
  try { window.sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
}

export function rememberMcpConnection(value: SavedMcpConnection): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Live connection remains usable. */ }
}

/** Corrupt or expired values must never be reused for a connection. */
export function readMcpConnection(): SavedMcpConnection | null {
  let raw: string | null = null;
  try { raw = window.sessionStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stored connection");
    const stored = value as Partial<SavedMcpConnection>;
    const session = stored.session;
    if (typeof stored.siteId !== "string" || !stored.siteId ||
        typeof stored.canEdit !== "boolean" || !session ||
        typeof session.sessionId !== "string" || typeof session.pairingCode !== "string" ||
        typeof session.connectToken !== "string" || typeof session.wsUrl !== "string" ||
        !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now()) {
      throw new Error("Expired or malformed connection");
    }
    return stored as SavedMcpConnection;
  } catch {
    forgetMcpConnection();
    return null;
  }
}
