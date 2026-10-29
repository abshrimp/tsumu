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
  const queryKey = /[?&#](?:api[-_]?key|secret|access[-_]?token|auth[-_]?token|client[-_]?secret|password|passwd|token|key)=([^&#]+)/ig;
  const bodyKey = /"(?:api[-_]?key|secret|access[-_]?token|auth[-_]?token|client[-_]?secret|password|passwd|token)"\s*:\s*"([^"]+)"/ig;
  const reference = /^\{[^{}\s]+\}$/;

  function containsLiteral(src: string, pattern: RegExp): boolean {
    pattern.lastIndex = 0;
    for (const match of src.matchAll(pattern)) {
      const value = decodeURIComponentSafe(match[1]).trim();
      if (value && !reference.test(value)) return true;
    }
    return false;
  }
  function decodeURIComponentSafe(value: string): string {
    try { return decodeURIComponent(value); } catch { return value; }
  }
  function walk(value: unknown, depth: number): boolean {
    if (depth > 80 || !value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => walk(item, depth + 1));
    const object = value as Record<string, unknown>;
    if (object.kind === "fetch") {
      const url = String(object.url ?? "");
      try {
        const target = new URL(url);
        if (target.username || target.password) return true;
      } catch {
        if (/^https?:\/\/[^/\s@]+@/i.test(url)) return true;
      }
      if (containsLiteral(url, queryKey)) return true;
      const headers = Array.isArray(object.headers) ? object.headers : [];
      if (headers.some((item) => {
        if (!item || typeof item !== "object") return false;
        const h = item as Record<string, unknown>;
        return header.test(String(h.name ?? "")) && !!String(h.value ?? "").trim();
      })) return true;
      if (containsLiteral(String(object.body ?? ""), bodyKey)) return true;
    }
    return Object.values(object).some((item) => walk(item, depth + 1));
  }
  return walk(doc, 0);
}
