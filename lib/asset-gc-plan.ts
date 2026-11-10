import { decodeHTML } from "entities/decode";
import { decodeCssEscapes } from "./css-escape";

/**
 * Conservative asset GC planning. This module never writes to storage.
 *
 * Tsumu's upload key starts with a base36 millisecond timestamp followed by
 * six hexadecimal characters from a UUID. Unknown/legacy formats are never
 * considered eligible for physical deletion.
 */
export type GcCandidate = {
  path: string;
  firstUnreferencedAt: number;
  lastSeenAt?: number;
  bytes?: number | null;
};

export type GcKey = { name: string; bytes?: number | null };

/** Valid timestamps are from a full upload path, not an arbitrary prefix. */
export function assetUploadedAt(path: string): number | null {
  const match = /^assets\/([0-9a-z]{7,11})([0-9a-f]{6})-[A-Za-z0-9._-]+$/.exec(path);
  if (!match) return null;
  const timestamp = Number.parseInt(match[1], 36);
  // Milliseconds since 2020; rejecting older/ambiguous keys is intentional.
  return Number.isSafeInteger(timestamp) && timestamp >= 1_577_836_800_000
    ? timestamp : null;
}

export interface GcPlanInput {
  kvKeys: readonly GcKey[];
  referenced: ReadonlySet<string>;
  candidates: ReadonlyMap<string, GcCandidate>;
  now: number;
  graceMs: number;
  maxDeletes: number;
}

export function planAssetGc(input: GcPlanInput) {
  const { kvKeys, referenced, candidates, now, graceMs, maxDeletes } = input;
  if (!Number.isSafeInteger(now) || !Number.isFinite(graceMs) || graceMs <= 0 ||
      !Number.isSafeInteger(maxDeletes) || maxDeletes < 0) {
    throw new RangeError("Invalid GC limits");
  }
  const present = new Set<string>();
  const add: GcCandidate[] = [];
  const release: string[] = [];
  const eligible: GcCandidate[] = [];
  for (const key of kvKeys) {
    if (!key.name.startsWith("assets/")) throw new Error("Unexpected KV key");
    if (present.has(key.name)) throw new Error("Duplicate KV key");
    present.add(key.name);
    const prior = candidates.get(key.name);
    if (referenced.has(key.name)) {
      if (prior) release.push(key.name);
      continue;
    }
    if (!prior) add.push({ path: key.name, firstUnreferencedAt: now, lastSeenAt: now, bytes: key.bytes ?? null });
    const first = prior?.firstUnreferencedAt ?? now;
    const uploadedAt = assetUploadedAt(key.name);
    if (uploadedAt === null || uploadedAt > now - graceMs ||
        first > now - graceMs || first > now) continue;
    eligible.push(prior!);
  }
  for (const path of candidates.keys()) {
    if (!present.has(path) && !release.includes(path)) release.push(path);
  }
  eligible.sort((a, b) => a.firstUnreferencedAt - b.firstUnreferencedAt || a.path.localeCompare(b.path));
  return { add, release, eligible: eligible.slice(0, maxDeletes),
    remainingEligible: Math.max(0, eligible.length - maxDeletes) };
}

/** Extract literal paths and HTML/CSS/URL-encoded paths from every JSON string.
 * Decode only when escape markers are present; never build an HTML document.
 * False positives retain data; omitted matches would put data at risk.
 */
export function extractAssetReferences(raw: string): Set<string> {
  const parsed: unknown = JSON.parse(raw);
  const paths = new Set<string>();
  const re = /assets\/[A-Za-z0-9._-]+/g;
  const pending: unknown[] = [parsed];
  let entries = 0;
  while (pending.length) {
    if (++entries > 2_000_000) throw new Error("Document too complex to scan");
    const value = pending.pop();
    if (typeof value === "string") {
      let text = value;
      for (let round = 0; round < 3; round++) {
        for (const match of text.matchAll(re)) paths.add(match[0]);
        // Preserve the literal match above, then also protect spellings that
        // browsers decode inside HTML attributes, CSS URLs and query values.
        let decoded = text;
        if (decoded.includes("&")) decoded = decodeHTML(decoded);
        if (decoded.includes("\\")) decoded = decodeCssEscapes(decoded);
        if (decoded.includes("%")) {
          try { decoded = decodeURIComponent(decoded); }
          catch {
            // Asset keys are ASCII. Recover each valid ASCII escape even when
            // unrelated text contains a stray percent sign or invalid UTF-8.
            decoded = decoded.replace(/%([0-7][0-9a-f])/gi,
              (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
          }
        }
        // URL parsing removes ASCII tabs and line breaks even in query values.
        decoded = decoded.replace(/[\t\r\n]/g, "");
        if (decoded === text) break;
        text = decoded;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value !== null && typeof value === "object") {
      // Paths in object keys (e.g. imported lookup maps) also retain objects.
      for (const key of Object.keys(value)) {
        pending.push(key, (value as Record<string, unknown>)[key]);
      }
    }
  }
  return paths;
}
