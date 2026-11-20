"use client";

import { attachMcpSiteInvite, connectExternalEdit, useExternalEdit } from "./bridge";
import { currentSiteId } from "../site";

/**
 * An explicit site-picker click opens an editor tab with a fragment-only
 * instruction. The OAuth one-time code is returned only to the Tsumu chooser
 * that opened this tab, never placed in a URL or persistent storage.
 */
const SELECT = /^#mcp-select=([01])$/;
const JOIN = /^#mcp-join=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})&edit=([01])$/;

export function hasMcpSiteApproval(): boolean {
  if (typeof window === "undefined") return false;
  return SELECT.test(window.location.hash) || JOIN.test(window.location.hash);
}

export function startMcpSiteApproval(readOnly: boolean): boolean {
  if (typeof window === "undefined") return false;
  const select = SELECT.exec(window.location.hash);
  const join = JOIN.exec(window.location.hash);
  if (!select && !join) return false;
  window.history.replaceState(window.history.state, "",
    window.location.pathname + window.location.search);
  // This must be an editor tab created by Tsumu's trusted chooser.
  if (!window.opener || window.opener.closed) return true;
  const origin = window.location.origin;
  const siteId = currentSiteId();
  const requestedEdit = (select?.[1] ?? join?.[3]) === "1";
  const canEdit = requestedEdit && !readOnly;
  let finished = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = (ok: boolean, code?: string, error?: string) => {
    if (finished) return;
    finished = true;
    unsubscribe?.();
    if (timer !== null) clearTimeout(timer);
    window.opener?.postMessage({
      type: "tsumu-mcp-site-ready", siteId, ok,
      ...(typeof code === "string" ? { code } : {}),
      ...(error ? { error } : {}),
    }, origin);
  };
  unsubscribe = useExternalEdit.subscribe((state) => {
    if (finished || currentSiteId() !== siteId) return;
    if (state.phase === "connected") {
      unsubscribe?.();
      unsubscribe = null;
      if (join) {
        void attachMcpSiteInvite(join[1] + "." + join[2]).then(
          () => finish(true),
          error => finish(false, undefined, error instanceof Error ? error.message : "Connection failed"),
        );
      } else if (state.code) {
        finish(true, state.code);
      } else {
        finish(false, undefined, "Connection code is unavailable");
      }
    } else if (state.phase === "disconnected" && state.error) {
      finish(false, undefined, state.error);
    }
  });
  timer = setTimeout(() => finish(false, undefined, "Connection timed out"), 30_000);
  void connectExternalEdit(canEdit);
  return true;
}
