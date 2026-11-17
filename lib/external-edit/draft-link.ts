const DRAFT_HANDOFF_PATH = "/api/external-edit/draft-handoff";
export const DRAFT_RESUME_PARAM = "resume-import";
const DRAFT_FRAGMENT = /^#tsumu-import=([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,64})$/;

export interface DraftLink {
  id: string;
  secret: string;
}

/** The original import URL carries the credential in its fragment, not its query. */
export function draftFromLocation(): DraftLink | null {
  if (typeof window === "undefined") return null;
  const match = DRAFT_FRAGMENT.exec(window.location.hash ?? "");
  return match ? { id: match[1], secret: match[2] } : null;
}

export function hasDraftResumeMarker(): boolean {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(DRAFT_RESUME_PARAM) === "1";
}

/**
 * The credential is sealed server-side into a short-lived HttpOnly cookie before
 * redirecting to Google. Only the non-sensitive marker enters the OAuth callback.
 * Returns null if the handoff failed, so navigation can be stopped.
 */
export async function prepareDraftSignIn(
  draft: DraftLink | null, storageError: string, retryAfterError = false,
): Promise<string | null> {
  if (typeof window === "undefined") return "";
  const marker = "?" + DRAFT_RESUME_PARAM + "=1";
  if (!draft) {
    const params = new URLSearchParams(window.location.search);
    if (hasDraftResumeMarker() ||
      (window.location.pathname === "/login" && !!params.get("error") && retryAfterError)) {
      return marker;
    }
    // A normal sign-in abandons any previous import.
    try {
      await fetch(DRAFT_HANDOFF_PATH, { method: "DELETE", cache: "no-store", credentials: "same-origin" });
    } catch { /* The expired cookie cannot resume without the marker. */ }
    return "";
  }
  try {
    const response = await fetch(DRAFT_HANDOFF_PATH, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!response.ok) throw new Error("Could not preserve draft during sign-in");
    window.history.replaceState(window.history.state, "", window.location.pathname + marker);
    return marker;
  } catch {
    window.alert(storageError);
    return null;
  }
}

/** An authorized Home page may retrieve and consume the handoff exactly once. */
export async function resumeDraftAfterSignIn(): Promise<DraftLink | null> {
  if (!hasDraftResumeMarker()) return null;
  const response = await fetch(DRAFT_HANDOFF_PATH, { method: "PATCH", cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return null;
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object") return null;
  const draft = (data as { draft?: unknown }).draft;
  if (!draft || typeof draft !== "object") return null;
  const { id, secret } = draft as Record<string, unknown>;
  return typeof id === "string" && typeof secret === "string" &&
    DRAFT_FRAGMENT.test(`#tsumu-import=${id}.${secret}`) ? { id, secret } : null;
}

/** Remove the fragment and the OAuth marker when Home takes over. */
export function clearDraftLink(): void {
  const params = new URLSearchParams(window.location.search);
  const hadMarker = params.has(DRAFT_RESUME_PARAM);
  const hadDraft = DRAFT_FRAGMENT.test(window.location.hash);
  if (!hadDraft && !hadMarker) return;
  params.delete(DRAFT_RESUME_PARAM);
  const search = params.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname +
    (search ? "?" + search : "") + (hadDraft ? "" : window.location.hash));
}
