import type { SiteDoc } from "./types";

/**
 * Public, self-contained representation of a Tsumu document.
 * Raw SiteDoc JSON is always accepted. A compact document is a small JSON
 * envelope containing gzip-compressed UTF-8 SiteDoc bytes encoded as Base64.
 * This is a transport format, not a replacement for the editor's object model.
 */
export const PORTABLE_DOC_FORMAT = "tsumu-doc";
export const PORTABLE_DOC_VERSION = 1;

type PackedDoc = {
  format: typeof PORTABLE_DOC_FORMAT;
  version: typeof PORTABLE_DOC_VERSION;
  encoding: "gzip+base64";
  payload: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function base64(bytes: Uint8Array): string {
  let text = "";
  // Avoid spreading huge arrays into a single function call.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function fromBase64(value: string, maxBytes: number): Uint8Array {
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error("Compressed document exceeds the size limit.");
  }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Invalid compressed document payload.");
  }
  const raw = atob(value);
  if (raw.length > maxBytes) throw new Error("Compressed document exceeds the size limit.");
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * Encode a document without information loss. Return plain, minified SiteDoc
 * when it takes fewer bytes than the gzip+Base64 envelope. Do not mutate doc.
 * For ZIP archives keep the plain JSON and DEFLATE the archive instead.
 */
export async function serializePortableDoc(doc: SiteDoc, maxBytes: number): Promise<string> {
  const plain = JSON.stringify(doc);
  const input = new TextEncoder().encode(plain);
  if (input.byteLength > maxBytes) throw new Error("Document exceeds the size limit.");
  if (typeof CompressionStream === "undefined") return plain;
  const compressed = new Uint8Array(await new Response(
    new Blob([input as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());
  const packed: PackedDoc = {
    format: PORTABLE_DOC_FORMAT,
    version: PORTABLE_DOC_VERSION,
    encoding: "gzip+base64",
    payload: base64(compressed),
  };
  const compact = JSON.stringify(packed);
  return new TextEncoder().encode(compact).byteLength < input.byteLength ? compact : plain;
}

/**
 * Decode a compact envelope, or return an ordinary SiteDoc unchanged.
 * The maximum *decompressed* size is enforced while streaming; malformed or
 * unsupported envelopes never fall through as a SiteDoc.
 */
export async function decodePortableDoc(value: unknown, maxBytes: number): Promise<unknown> {
  if (!isRecord(value) || value.format !== PORTABLE_DOC_FORMAT) return value;
  if (value.version !== PORTABLE_DOC_VERSION || value.encoding !== "gzip+base64" ||
      typeof value.payload !== "string") {
    throw new Error("Unsupported Tsumu document format.");
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open compressed Tsumu documents.");
  }
  const compressed = fromBase64(value.payload, maxBytes);
  const reader = new Blob([compressed as Uint8Array<ArrayBuffer>]).stream()
    .pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let result = "";
  try {
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      length += chunk.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("Uncompressed document exceeds the size limit.");
      }
      result += decoder.decode(chunk, { stream: true });
    }
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(result) as unknown;
  } catch {
    throw new Error("Could not parse the compressed Tsumu document.");
  }
}
