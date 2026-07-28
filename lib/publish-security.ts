import type { SiteDoc } from "./types";

/**
 * GitHub Push also commits the full editable doc.json. Do not silently put
 * credential-bearing fetch settings into a repository that may be public.
 *
 * This is deliberately a conservative high-confidence check, not a guarantee
 * that arbitrary user-authored HTML or scripts contain no secrets.
 */
export function hasPublishCredentials(doc: SiteDoc): boolean {
  const seen = new WeakSet<object>();
  const header = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|x-api[-_]?key|x-auth[-_]?token|x-client[-_]?secret|x[-_]?token|x[-_]?secret)$/i;
  const sensitiveKey = /^(?:api[-_]?key|secret|access[-_]?token|auth[-_]?token|client[-_]?secret|password|passwd|token)$/i;
  const bodyKey = /"(?:api[-_]?key|secret|access[-_]?token|auth[-_]?token|client[-_]?secret|password|passwd|token)"\s*:\s*"([^"]+)"/ig;
  const reference = /^\{[^{}\s]+\}$/;
  const literal = (value: string) => !!value.trim() && !reference.test(value.trim());

  function containsParam(source: string, includeKey: boolean): boolean {
    for (const [key, value] of new URLSearchParams(source)) {
      if ((sensitiveKey.test(key) || (includeKey && key.toLowerCase() === "key")) && literal(value)) return true;
    }
    return false;
  }
  function decodeURIComponentSafe(value: string): string {
    try { return decodeURIComponent(value); } catch { return value; }
  }
  const pending: unknown[] = [doc];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const object = value as Record<string, unknown>;
    if (object.kind === "fetch") {
      const url = String(object.url ?? "");
      try {
        const target = new URL(url);
        if (target.username || target.password) return true;
      } catch {
        if (/^https?:\/\/[^/\s@]+@/i.test(url)) return true;
      }
      if (url.split(/[?#]/).slice(1).some(part => containsParam(part, true))) return true;
      const headers = Array.isArray(object.headers) ? object.headers : [];
      if (headers.some((item) => {
        if (!item || typeof item !== "object") return false;
        const h = item as Record<string, unknown>;
        return header.test(String(h.name ?? "")) && !!String(h.value ?? "").trim();
      })) return true;
      const body = typeof object.body === "string" ? object.body : "";
      if (containsParam(body, false)) return true;
      // Keep inspecting templated or incomplete JSON that cannot yet be parsed.
      for (const match of body.matchAll(bodyKey)) {
        if (literal(decodeURIComponentSafe(match[1]))) return true;
      }
      if (/^\s*[\[{]/.test(body)) {
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { /* Template is not JSON yet. */ }
        const fields: unknown[] = [parsed];
        while (fields.length) {
          const current = fields.pop();
          if (!current || typeof current !== "object") continue;
          for (const [key, item] of Object.entries(current)) {
            if (sensitiveKey.test(key) && typeof item === "string" && literal(item)) return true;
            if (item && typeof item === "object") fields.push(item);
          }
        }
      }
    }
    for (const item of Object.values(object)) if (item && typeof item === "object") pending.push(item);
  }
  return false;
}

/**
 * History restores are fetched from a repository that can be edited outside
 * the application. Bound the response before JSON parsing or using it as a
 * SiteDoc. The stream limit applies even when Content-Length is missing.
 */
export async function readRestoreJson(response: Response, maxBytes: number): Promise<unknown> {
  const sizeHeader = response.headers.get("Content-Length");
  if (sizeHeader && Number(sizeHeader) > maxBytes) {
    throw new Error("編集データが大きすぎます。");
  }
  if (!response.body) throw new Error("編集データを読み込めませんでした");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("編集データが大きすぎます。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("編集データを読み込めませんでした");
  }
}
