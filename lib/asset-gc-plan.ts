import { decodeHTML } from "entities/decode";
import { decodeCssEscapes } from "./css-escape";

/**
 * 安全側に倒したアセットの GC の計画。このモジュールは保存先に書き込まない。
 *
 * Tsumu のアップロードのキーは、36進数のミリ秒の時刻と、それに続く UUID の
 * 16進数6文字で始まる。形式の分からないキーは、物理的な削除の対象にしない。
 */
export type GcCandidate = {
  path: string;
  firstUnreferencedAt: number;
  lastSeenAt?: number;
  bytes?: number | null;
};

export type GcKey = { name: string; bytes?: number | null };

/** 有効な時刻は、任意の先頭部分ではなく、アップロードのパス全体から読み取ったものに限る。 */
export function assetUploadedAt(path: string): number | null {
  const match = /^assets\/([0-9a-z]{7,11})([0-9a-f]{6})-[A-Za-z0-9._-]+$/.exec(path);
  if (!match) return null;
  const timestamp = Number.parseInt(match[1], 36);
  // 2020年以降のミリ秒。それより古いキーや、どちらとも取れるキーは意図的に除外する。
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

/** すべての JSON の文字列から、そのままのパスと、HTML・CSS・URL のエンコードを施したパスを取り出す。
 * デコードするのはエスケープの印があるときだけで、HTML の文書は組み立てない。
 * 誤って一致してもデータが残るだけだが、一致を取りこぼすとデータが失われるおそれがある。
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
        // 上の文字どおりの一致は残したうえで、HTML の属性・CSS の URL・クエリの値の中で
        // ブラウザがデコードする書き方も保護する。
        let decoded = text;
        if (decoded.includes("&")) decoded = decodeHTML(decoded);
        if (decoded.includes("\\")) decoded = decodeCssEscapes(decoded);
        if (decoded.includes("%")) {
          try { decoded = decodeURIComponent(decoded); }
          catch {
            // アセットのキーは ASCII の文字だけで書かれている。関係の無い文字列に孤立した % や
            // 不正な UTF-8 が含まれていても、有効な ASCII のエスケープはそれぞれ元に戻す。
            decoded = decoded.replace(/%([0-7][0-9a-f])/gi,
              (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
          }
        }
        // URL の解析では、クエリの値の中でも ASCII のタブと改行が取り除かれる。
        decoded = decoded.replace(/[\t\r\n]/g, "");
        if (decoded === text) break;
        text = decoded;
      }
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value !== null && typeof value === "object") {
      // オブジェクトのキーにあるパス（取り込んだ対応表など）も、参照として扱う。
      for (const key of Object.keys(value)) {
        pending.push(key, (value as Record<string, unknown>)[key]);
      }
    }
  }
  return paths;
}
