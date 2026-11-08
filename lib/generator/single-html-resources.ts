import type { GeneratedProject } from "../generator";
import { cssAssetReferences, escapeCssAssetUrl } from "../css-assets";

export const EXPORT_BASE = new URL("https://export.invalid/index.html");
export const SINGLE_HTML_LIMIT = 48 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const types: Record<string, string> = {
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml",
  webp: "image/webp", apng: "image/apng", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  json: "application/json", webmanifest: "application/manifest+json",
  css: "text/css", js: "text/javascript", mjs: "text/javascript", txt: "text/plain",
};

function check(size: number) {
  if (size > SINGLE_HTML_LIMIT) throw new Error("The embedded HTML exceeds 48 MB. Reduce embedded assets or use the HTML ZIP format.");
}

export function textBytes(text: string): number {
  check(text.length);
  return /[^\x00-\x7f]/.test(text) ? encoder.encode(text).length : text.length;
}

/** Check before joining repeated replacements into a potentially much larger string. */
export class HtmlOutput {
  private parts: string[] = [];
  private size = 0;
  append(part: string) {
    this.size += textBytes(part);
    check(this.size);
    this.parts.push(part);
  }
  join() { return this.parts.join(""); }
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(""));
}

function dataUrl(bytes: Uint8Array, mime: string) {
  check(4 * Math.ceil(bytes.length / 3) + mime.length + 13);
  return "data:" + mime + ";base64," + base64(bytes);
}

function isEditorApi(url: URL): boolean {
  if (url.origin !== globalThis.location?.origin) return false;
  const path = decodeURIComponent(url.pathname).replaceAll("\\", "/").replace(/^\/+/, "");
  return /^\/api(?:\/|$)/i.test(new URL("/" + path, EXPORT_BASE).pathname);
}

async function verifyIntegrity(bytes: Uint8Array<ArrayBuffer>, metadata: string) {
  if (!metadata.trim()) return;
  const hashes = metadata.trim().split(/\s+/).map(token =>
    /^sha(256|384|512)-([A-Za-z0-9+/=_-]+)(?:\?.*)?$/.exec(token)).filter(hash => hash !== null);
  const strongest = hashes.reduce((best, hash) => Math.max(best, Number(hash[1])), 0);
  if (hashes.length && globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-" + strongest, bytes);
    const expected = base64(new Uint8Array(digest)).replace(/=+$/, "");
    if (hashes.some(hash => Number(hash[1]) === strongest &&
        hash[2].replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "") === expected)) return;
  }
  throw new Error("Cannot embed resource: integrity metadata could not be verified.");
}

export type ResourceRequest = (url: string, init: RequestInit) => Promise<Response>;
type Resource = { bytes: Uint8Array<ArrayBuffer>; mime: string; base: URL };

export function singleHtmlResources(source: GeneratedProject, request: ResourceRequest, hasImportMap: boolean) {
  const resources = new Map<string, Resource>();
  const embedded = new Map<string, string>();
  const sheets = new Map<string, string>();
  const modules = new Map<string, string>();
  let inputBytes = 0, cacheBytes = 0, cssReferences = 0, moduleReferences = 0;
  const keyOf = (url: URL) => {
    if (url.origin === EXPORT_BASE.origin) return url.origin + url.pathname;
    if (!["http:", "https:", "blob:"].includes(url.protocol) || url.username || url.password || isEditorApi(url)) {
      throw new Error("Cannot embed this resource URL: " + url.href);
    }
    return url.href.split("#")[0];
  };

  async function load(url: URL): Promise<Resource> {
    const key = keyOf(url);
    const cached = resources.get(key);
    if (cached) return cached;
    if (resources.size >= 2048) throw new Error("Too many single HTML resources.");
    const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
    let mime = Object.hasOwn(types, ext) ? types[ext] : "application/octet-stream";
    let base = url;
    let bytes: Uint8Array<ArrayBuffer>;
    const local = url.origin === EXPORT_BASE.origin;
    const path = local ? decodeURIComponent(url.pathname).replace(/^\/+/, "") : key;
    if (local && Object.hasOwn(source.files, path)) {
      const text = source.files[path];
      check(inputBytes + textBytes(text));
      bytes = encoder.encode(text);
    } else if (local && Object.hasOwn(source.binaries, path)) {
      const encoded = source.binaries[path];
      check(inputBytes + Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
      bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    } else {
      if (local && (!Object.hasOwn(source.remoteAssets, path) || !source.remoteAssets[path].startsWith("assets/"))) {
        throw new Error("Referenced asset was not found: " + key);
      }
      const address = local ? "/api/assets/file?path=" + encodeURIComponent(source.remoteAssets[path]) : key;
      let response: Response;
      try {
        response = await request(address, local
          ? { credentials: "same-origin", redirect: "error" }
          : { credentials: "omit", referrerPolicy: "no-referrer" });
      } catch {
        throw new Error("Could not embed the resource (check CORS or import it as a local asset): " + key);
      }
      if (!response.ok || (!local && response.url && isEditorApi(new URL(response.url)))) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Could not embed the resource (" + response.status + "): " + key);
      }
      if (!local && response.url) base = new URL(response.url);
      if (Number(response.headers.get("content-length")) > SINGLE_HTML_LIMIT - inputBytes) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Resource exceeds single HTML size limit: " + key);
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (reader) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > SINGLE_HTML_LIMIT - inputBytes) {
            await reader.cancel().catch(() => {});
            throw new Error("Resource exceeds single HTML size limit: " + key);
          }
          chunks.push(part.value);
        }
      } finally { reader?.releaseLock(); }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (type && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type)) mime = type;
      else if (mime === "text/css" || mime === "text/javascript") mime = "application/octet-stream";
    }
    inputBytes += bytes.length;
    const result = { bytes, mime, base };
    resources.set(key, result);
    return result;
  }

  function remember(cache: Map<string, string>, key: string, value: string) {
    cacheBytes += textBytes(value);
    // Bound all cached derivatives even when they never reach the final markup.
    if (cacheBytes > 2 * SINGLE_HTML_LIMIT) throw new Error("Single HTML resource cache exceeds the size limit.");
    cache.set(key, value);
    return value;
  }

  function checkScriptType(item: Resource) {
    if (!/^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:jscript|livescript))$/i.test(item.mime)) {
      throw new Error("Cannot embed script with media type " + item.mime);
    }
  }

  async function embed(ref: string, base: URL, integrity = "", script = false): Promise<string> {
    if (/^(?:data:|#|mailto:|tel:)/i.test(ref)) return ref;
    const url = new URL(ref, base);
    const item = await load(url);
    await verifyIntegrity(item.bytes, integrity);
    if (script) checkScriptType(item);
    const key = keyOf(url);
    const value = embedded.get(key) ?? remember(embedded, key, dataUrl(item.bytes, item.mime));
    return value + url.hash;
  }

  async function embedModule(url: URL, integrity = "", parents = new Set<string>()): Promise<string> {
    const item = await load(url);
    await verifyIntegrity(item.bytes, integrity);
    checkScriptType(item);
    const cached = modules.get(url.href);
    if (cached) return cached;
    if (parents.has(url.href) || parents.size >= 32 || modules.size >= 2048) {
      throw new Error("Cannot embed a circular or oversized module graph. Use the HTML ZIP format.");
    }
    if (item.bytes.length > 4 * 1024 * 1024) throw new Error("Module exceeds 4 MB. Use the HTML ZIP format.");
    const sourceText = decoder.decode(item.bytes);
    const { parse } = await import("es-module-lexer/minimal/js");
    const [imports] = parse(sourceText);
    moduleReferences += imports.length;
    if (moduleReferences > 100000) throw new Error("Too many module references. Use the HTML ZIP format.");
    if (hasImportMap && imports.length) {
      throw new Error("This module graph uses an authored import map. Use the HTML ZIP format.");
    }
    const output = new HtmlOutput();
    let cursor = 0;
    for (const ref of imports) {
      if (ref.d === -2 || ref.n === undefined || ref.a !== -1 || ref.t === 4 || ref.t === 5) {
        throw new Error("This module uses runtime resolution or import attributes. Use the HTML ZIP format.");
      }
      if (/^data:/i.test(ref.n)) continue;
      if (!/^(?:\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(ref.n)) {
        throw new Error("Cannot resolve a bare module specifier. Use the HTML ZIP format.");
      }
      const child = await embedModule(new URL(ref.n, item.base), "", new Set([...parents, url.href]));
      // Static offsets exclude quotes. Dynamic offsets include the entire string literal.
      const quoted = JSON.stringify(child).replaceAll("'", "\\u0027");
      output.append(sourceText.slice(cursor, ref.s));
      output.append(ref.d === -1 ? quoted.slice(1, -1) : quoted);
      cursor = ref.e;
    }
    output.append(sourceText.slice(cursor));
    // Distinguish equal source bytes without publishing the original URL or its signed query.
    const result = dataUrl(encoder.encode(output.join()), item.mime) + "#" + modules.size;
    return remember(modules, url.href, result);
  }

  async function stylesheet(url: URL, parents: Set<string>, integrity = ""): Promise<string> {
    const key = keyOf(url);
    if (parents.size >= 32 || parents.has(key)) throw new Error("Recursive CSS imports or excessive stylesheet depth: " + key);
    const item = await load(url);
    await verifyIntegrity(item.bytes, integrity);
    if (item.mime !== "text/css") throw new Error("Cannot embed stylesheet with media type " + item.mime);
    const cached = sheets.get(key);
    if (cached !== undefined) return cached;
    const result = await css(decoder.decode(item.bytes), item.base, new Set([...parents, key]));
    return remember(sheets, key, result);
  }

  const cssUrls = new Map<string, string>();
  async function css(text: string, base: URL, parents = new Set<string>()): Promise<string> {
    const result = new HtmlOutput();
    let from = 0;
    for (const ref of cssAssetReferences(text)) {
      if (++cssReferences > 100000) throw new Error("Too many CSS resource references.");
      if (!ref.url || /^(?:data:|#)/i.test(ref.url)) continue;
      let value: string;
      if (ref.isImport) {
        const url = new URL(ref.url, base);
        const key = keyOf(url);
        const content = await stylesheet(url, parents);
        value = cssUrls.get(key) ?? remember(cssUrls, key, dataUrl(encoder.encode(content), "text/css"));
      } else {
        value = await embed(ref.url, base);
      }
      result.append(text.slice(from, ref.start));
      result.append(escapeCssAssetUrl(value, ref.quote));
      from = ref.end;
    }
    result.append(text.slice(from));
    return result.join();
  }

  return { css, stylesheet, embed, embedModule, cssUrl: (text: string) => dataUrl(encoder.encode(text), "text/css") };
}
