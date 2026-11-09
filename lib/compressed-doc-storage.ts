/**
 * The only D1 persistence format for editable SiteDoc documents.
 * The plain assets index supports SQL-only reference accounting; the gzip payload
 * is the complete, unchanged SiteDoc JSON. This is not the portable doc.json format.
 */
import { gzipSync, gunzipSync } from "node:zlib";

declare const storedDocBrand: unique symbol;
/** Only the encoder may create a persisted D1 body. */
export type StoredDocBody = string & { readonly [storedDocBrand]: true };

const MARKER = "__tsumu_compressed_v1";
export const MAX_STORED_DOC_BYTES = 1_800_000;
export const MAX_EXPANDED_DOC_BYTES = 64 * 1024 * 1024;
export const STORED_DOC_GZIP_LEVEL = 3;

export class StoredDocTooLargeError extends Error {
  constructor() {
    super("Compressed document too big for D1 storage");
    this.name = "StoredDocTooLargeError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function documentShape(value: unknown): value is Record<string, unknown> {
  return object(value) && typeof value.siteName === "string" &&
    object(value.pages) && object(value.nodes) && object(value.assets) &&
    Array.isArray(value.pageOrder);
}

/** Compare JSON objects without depending on key insertion order. */
function jsonEqual(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];
  let visited = 0;
  while (pending.length) {
    if (++visited > 400_000) return false;
    const [a, b] = pending.pop()!;
    if (Object.is(a, b)) continue;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object")
      return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    if (Array.isArray(a) && (a as unknown[]).length !== (b as unknown[]).length) return false;
    for (const key of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      pending.push([
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ]);
    }
  }
  return true;
}

/** Standard RFC4648 Base64, including canonical padding; no decoding leniency. */
function fromBase64(value: string): Buffer {
  if (!value || value.length > MAX_STORED_DOC_BYTES ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("Invalid compressed D1 document payload");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw new Error("Invalid compressed D1 document payload");
  return bytes;
}

export async function encodeStoredDoc(rawSiteDoc: string): Promise<StoredDocBody> {
  if (Buffer.byteLength(rawSiteDoc, "utf8") > MAX_EXPANDED_DOC_BYTES)
    throw new StoredDocTooLargeError();
  let doc: unknown;
  try { doc = JSON.parse(rawSiteDoc); } catch {
    throw new Error("Invalid SiteDoc JSON for D1 storage");
  }
  if (!documentShape(doc)) throw new Error("Invalid SiteDoc for D1 storage");
  const gzip = gzipSync(Buffer.from(rawSiteDoc, "utf8"), { level: STORED_DOC_GZIP_LEVEL });
  if (gzip.byteLength > MAX_STORED_DOC_BYTES) throw new StoredDocTooLargeError();
  const stored = JSON.stringify({
    [MARKER]: true,
    assets: doc.assets,
    payload: gzip.toString("base64"),
  });
  if (Buffer.byteLength(stored, "utf8") > MAX_STORED_DOC_BYTES)
    throw new StoredDocTooLargeError();
  return stored as StoredDocBody;
}

export async function decodeStoredDoc(storedBody: string): Promise<string> {
  if (Buffer.byteLength(storedBody, "utf8") > MAX_STORED_DOC_BYTES)
    throw new Error("Compressed D1 document exceeds storage safety limit");
  let envelope: unknown;
  try { envelope = JSON.parse(storedBody); } catch {
    throw new Error("Invalid compressed D1 document envelope");
  }
  if (!object(envelope) || Object.keys(envelope).length !== 3 ||
      envelope[MARKER] !== true || !object(envelope.assets) ||
      typeof envelope.payload !== "string")
    throw new Error("Invalid compressed D1 document envelope");
  const gzip = fromBase64(envelope.payload);
  let inflated: Buffer;
  try {
    // maxOutputLength is enforced by zlib during decompression, before allocation
    // of an unbounded expanded document.
    inflated = gunzipSync(gzip, { maxOutputLength: MAX_EXPANDED_DOC_BYTES });
  } catch {
    throw new Error("Invalid or oversized compressed D1 document payload");
  }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(inflated); } catch {
    throw new Error("Invalid UTF-8 in compressed D1 document");
  }
  let doc: unknown;
  try { doc = JSON.parse(raw); } catch {
    throw new Error("Invalid JSON in compressed D1 document");
  }
  if (!documentShape(doc) || !jsonEqual(doc.assets, envelope.assets))
    throw new Error("Compressed D1 document asset index mismatch");
  return raw;
}
