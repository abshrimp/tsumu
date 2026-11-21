"use client";

import { storageKey } from "../storage-keys";

/**
 * Non-sensitive hint for sites that have opted in to MCP reconnection.
 * The actual long-lived grant remains in an HttpOnly cookie at the relay.
 * Keeping the hint separate avoids loading the optional bridge during
 * ordinary editor startup and browser tests.
 */
const KEY = storageKey("mcp-reconnect-known-v1");
function siteHintKey(siteId: string): string {
  return KEY + ":" + siteId;
}

export function rememberReconnectSite(siteId: string): void {
  try { window.localStorage.setItem(siteHintKey(siteId), "1"); }
  catch { /* Storage can be disabled; the current live session still works. */ }
}

export function knownReconnectSite(siteId: string): boolean {
  try { return window.localStorage.getItem(siteHintKey(siteId)) === "1"; }
  catch { return false; }
}

export function markRevocationPending(siteId: string): void {
  try { window.localStorage.setItem(siteHintKey(siteId), "revoke"); }
  catch { forgetReconnectSite(siteId); }
}

export function hasRevocationMarker(siteId: string): boolean {
  try { return window.localStorage.getItem(siteHintKey(siteId)) === "revoke"; }
  catch { return false; }
}

export function forgetReconnectSite(siteId: string): void {
  try { window.localStorage.removeItem(siteHintKey(siteId)); }
  catch { /* Server-side revocation still applies. */ }
}
