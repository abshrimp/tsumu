import type { DraftLink } from "./draft-link";

export const DRAFT_HANDOFF_PATH = "/api/external-edit/draft-handoff";
export const DRAFT_HANDOFF_COOKIE = "tsumu-import-handoff";
export const DRAFT_HANDOFF_TTL = 10 * 60;

export function isDraftLink(value: unknown): value is DraftLink {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.id === "string" && /^[0-9a-f-]{36}$/.test(draft.id) &&
    typeof draft.secret === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(draft.secret);
}

async function encryptionKey(authSecret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode("tsumu-import-handoff:v1:" + authSecret));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** The browser receives only authenticated ciphertext, never a readable credential cookie. */
export async function sealDraftHandoff(draft: DraftLink, authSecret: string): Promise<string> {
  if (!isDraftLink(draft) || !authSecret) throw new Error("Invalid draft handoff");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(draft));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv },
    await encryptionKey(authSecret), plaintext);
  return Buffer.from(iv).toString("base64url") + "." +
    Buffer.from(encrypted).toString("base64url");
}

export async function openDraftHandoff(token: string, authSecret: string): Promise<DraftLink | null> {
  if (!authSecret || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const [nonce, encrypted] = token.split(".");
    const iv = new Uint8Array(Buffer.from(nonce, "base64url"));
    if (iv.byteLength !== 12) return null;
    const ciphertext = new Uint8Array(Buffer.from(encrypted, "base64url"));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv },
      await encryptionKey(authSecret), ciphertext);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return isDraftLink(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
