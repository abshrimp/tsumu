import { storageKey } from "../storage-keys";

const HANDOFF = storageKey("import-after-sign-in");
export const DRAFT_RESUME_PARAM = "resume-import";
const DRAFT_FRAGMENT = /^#tsumu-import=([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,64})$/;

export interface DraftLink {
  id: string;
  secret: string;
}

/** The marker may travel through OAuth. The credential stays in this tab. */
export function draftFromLocation(): DraftLink | null {
  if (typeof window === "undefined") return null;
  let hash = window.location.hash ?? "";
  const params = new URLSearchParams(window.location.search);
  // Auth.js returns only the error code when Google sign-in fails.
  const retryingSignIn = window.location.pathname === "/login" && !!params.get("error");
  if (!hash && (params.get(DRAFT_RESUME_PARAM) === "1" || retryingSignIn)) {
    try { hash = window.sessionStorage.getItem(HANDOFF) ?? ""; } catch { return null; }
  }
  const match = DRAFT_FRAGMENT.exec(hash);
  return match ? { id: match[1], secret: match[2] } : null;
}

export function prepareDraftSignIn(draft: DraftLink | null, storageError: string): string {
  if (!draft) {
    // A fresh sign-in must not revive a previously abandoned import on its error page.
    try { window.sessionStorage.removeItem(HANDOFF); } catch { /* Storage is optional. */ }
    return "";
  }
  try {
    window.sessionStorage.setItem(HANDOFF, `#tsumu-import=${draft.id}.${draft.secret}`);
    const marker = "?" + DRAFT_RESUME_PARAM + "=1";
    window.history.replaceState(window.history.state, "", window.location.pathname + marker);
    return marker;
  } catch {
    window.alert(storageError);
    return "";
  }
}

/** Remove the credential and the OAuth marker when the Home component takes over. */
export function clearDraftLink(): void {
  const params = new URLSearchParams(window.location.search);
  const hadMarker = params.has(DRAFT_RESUME_PARAM);
  const hadDraft = DRAFT_FRAGMENT.test(window.location.hash);
  try { window.sessionStorage.removeItem(HANDOFF); } catch { /* The fragment also works without storage. */ }
  if (!hadDraft && !hadMarker) return;
  params.delete(DRAFT_RESUME_PARAM);
  const search = params.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname +
    (search ? "?" + search : "") + (hadDraft ? "" : window.location.hash));
}
