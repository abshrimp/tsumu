import type { GeneratedProject } from "../generator";
import { fetchWithRetry } from "../assets";

/**
 * Turn the direct HTML export into one file. All referenced images, fonts,
 * stylesheets, local browser scripts and other resolvable assets become inline
 * data URLs / style / script tags. External API requests and remote iframes
 * remain runtime services, not downloadable assets.
 */
const SITE_ORIGIN = "https://export.invalid/";
const LIMIT = 48 * 1024 * 1024;

const mimeTypes: Record<string, string> = {
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png",
  svg: "image/svg+xml", webp: "image/webp", apng: "image/apng",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
  m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  json: "application/json", webmanifest: "application/manifest+json",
  css: "text/css", js: "text/javascript", txt: "text/plain",
};

function mime(path: string): string {
  const ext = (path.split("?")[0].split(".").pop() || "").toLowerCase();
  return mimeTypes[ext] || "application/octet-stream";
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function utf8DataUrl(text: string, name: string): string {
  return "data:" + mime(name) + ";base64," + b64(new TextEncoder().encode(text));
}

function resolved(path: string, base: string): string {
  if (/^(?:data:|blob:|#|mailto:|tel:)/i.test(path)) return path;
  const url = new URL(path, new URL(base, SITE_ORIGIN));
  if (url.origin === new URL(SITE_ORIGIN).origin) {
    return decodeURIComponent(url.pathname).replace(/^\/+/, "");
  }
  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error("Cannot embed a resource with this URL scheme: " + path);
  }
  return url.href;
}

function isAlreadyInline(ref: string): boolean {
  return /^(?:data:|blob:|#|mailto:|tel:)/i.test(ref);
}

function escInlineJs(text: string): string {
  return text.replace(/<\/script/gi, "<\\/script");
}
function escInlineCss(text: string): string {
  return text.replace(/<\/style/gi, "<\\/style");
}

export async function toSingleHtmlProject(
  source: GeneratedProject,
  request: (url: string) => Promise<Response> = fetchWithRetry,
): Promise<GeneratedProject> {
  const htmlPaths = Object.keys(source.files).filter((path) => /\.html?$/i.test(path));
  // Only a single fixed path can be packed without changing browser navigation.
  if (htmlPaths.length !== 1 || !source.files["index.html"]) {
    throw new Error("Single HTML requires one fixed page. Export the current page or a selected component.");
  }
  let total = 0;
  const check = (size: number) => {
    total += size;
    if (total > LIMIT) throw new Error("The embedded HTML exceeds 48 MB. Reduce embedded assets or use the HTML ZIP format.");
  };
  const urlCache = new Map<string, Promise<string>>();
  const textCache = new Map<string, Promise<string>>();
  const readBytes = async (path: string): Promise<Uint8Array> => {
    if (Object.prototype.hasOwnProperty.call(source.binaries, path)) {
      const binary = atob(source.binaries[path]);
      return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    }
    let url: string | undefined;
    if (Object.prototype.hasOwnProperty.call(source.remoteAssets, path)) {
      url = "/api/assets/file?path=" + encodeURIComponent(source.remoteAssets[path]);
    } else if (/^https?:\/\//.test(path)) {
      url = path;
    }
    if (!url) throw new Error("Referenced asset was not found: " + path);
    let response: Response;
    try { response = await request(url); }
    catch { throw new Error("Could not embed the remote resource (check CORS or import it as a local asset): " + path); }
    if (!response.ok) throw new Error("Could not embed the resource (" + response.status + "): " + path);
    const len = Number(response.headers.get("content-length") || "0");
    if (len > LIMIT) throw new Error("Resource exceeds single HTML size limit: " + path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    check(bytes.length);
    return bytes;
  };
  const embed = async (ref: string, base: string): Promise<string> => {
    if (isAlreadyInline(ref)) return ref;
    const path = resolved(ref, base);
    if (isAlreadyInline(path)) return path;
    const old = urlCache.get(path);
    if (old) return old;
    const promise = (async () => {
      if (Object.prototype.hasOwnProperty.call(source.files, path)) {
        const contents = source.files[path];
        check(new TextEncoder().encode(contents).length);
        return utf8DataUrl(contents, path);
      }
      if (Object.prototype.hasOwnProperty.call(source.binaries, path)) {
        check(Math.ceil(source.binaries[path].length * 3 / 4));
        return "data:" + mime(path) + ";base64," + source.binaries[path];
      }
      const bytes = await readBytes(path);
      return "data:" + mime(path) + ";base64," + b64(bytes);
    })();
    urlCache.set(path, promise);
    return promise;
  };

  async function replaceAsync(text: string, regex: RegExp,
    fn: (whole: string, ...captures: string[]) => Promise<string>): Promise<string> {
    const matches = [...text.matchAll(regex)];
    let result = "", cursor = 0;
    for (const m of matches) {
      result += text.slice(cursor, m.index);
      result += await fn(m[0], ...m.slice(1));
      cursor = (m.index || 0) + m[0].length;
    }
    return result + text.slice(cursor);
  }

  const processCss = async (content: string, base: string, parents = new Set<string>()): Promise<string> => {
    let result = await replaceAsync(content,
      /@import\s+(?:url\(\s*)?(["']?)([^"')\s]+)\1\s*\)?\s*;/gi,
      async (whole, _quote, url) => {
        if (isAlreadyInline(url)) return whole;
        const path = resolved(url, base);
        if (parents.has(path)) throw new Error("Recursive CSS imports cannot be embedded: " + path);
        const child = await loadText(path);
        return processCss(child, path, new Set([...parents, path]));
      });
    if (/@import\s/i.test(result)) {
      throw new Error("Conditional CSS imports cannot be embedded into one HTML file.");
    }
    result = await replaceAsync(result, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      async (whole, _q, asset) => {
        const ref = asset.trim();
        if (isAlreadyInline(ref)) return whole;
        return 'url("' + await embed(ref, base) + '")';
      });
    return result;
  };

  async function loadText(path: string): Promise<string> {
    const old = textCache.get(path);
    if (old) return old;
    const promise = (async () => {
      if (Object.prototype.hasOwnProperty.call(source.files, path)) return source.files[path];
      if (!/^https?:\/\//i.test(path) &&
          !Object.prototype.hasOwnProperty.call(source.remoteAssets, path)) {
        throw new Error("Referenced stylesheet or script was not found: " + path);
      }
      const bytes = await readBytes(path);
      return new TextDecoder().decode(bytes);
    })();
    textCache.set(path, promise);
    return promise;
  }

  let html = source.files["index.html"];
  // In-place stylesheets, including CSS url() images and font data.
  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() || "";
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (rel.includes("manifest")) return ""; // service worker not supported in one file
    if (!href) return tag;
    if (rel.includes("stylesheet")) {
      const file = resolved(href, "index.html");
      const css = await processCss(await loadText(file), file);
      return "<style>\n" + escInlineCss(css) + "\n</style>";
    }
    if (rel.includes("icon")) {
      const data = await embed(href, "index.html");
      return tag.replace(href, data);
    }
    return tag;
  });

  // Inline styles authored directly in HTML also need their background assets.
  html = await replaceAsync(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    async (whole, css) => whole.replace(css, escInlineCss(await processCss(css, "index.html"))));

  // Embed source media and poster attributes. Keep ordinary navigation hrefs.
  html = await replaceAsync(html, /<(?:img|source|video|audio|input)\b[^>]*>/gi, async (tag) => {
    let updated = await replaceAsync(tag, /\b(src|poster)\s*=\s*(["'])([^"']+)\2/gi,
      async (whole, key, quote, ref) => key + "=" + quote + await embed(ref, "index.html") + quote);
    updated = await replaceAsync(updated, /\bsrcset\s*=\s*(["'])([^"']+)\1/gi,
      async (whole, quote, srcset) => {
        const candidates = srcset.split(",").map((x) => x.trim()).filter(Boolean);
        const result: string[] = [];
        for (const item of candidates) {
          const m = /^(\S+)(.*)$/.exec(item);
          if (m) result.push(await embed(m[1], "index.html") + m[2]);
        }
        return "srcset=" + quote + result.join(", ") + quote;
      });
    return updated;
  });

  // Browser runtime JS loads after the body is parsed, so inlining is safe.
  html = await replaceAsync(html, /<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)><\/script>/gi,
    async (whole, attrsBefore, _quote, ref, attrsAfter) => {
      if (/pwa\.js(?:[?#]|$)/i.test(ref)) return "";
      const file = resolved(ref, "index.html");
      const attrs = (attrsBefore + " " + attrsAfter)
        .replace(/\bdefer\b/g, "").replace(/\basync\b/g, "").trim();
      return "<script" + (attrs ? " " + attrs : "") +
        ">\n" + escInlineJs(await loadText(file)) + "\n</script>";
    });

  // Replace styles in inline style="background:url(...)" attributes.
  html = await replaceAsync(html, /\bstyle\s*=\s*(["'])([^"']*url\([^"']+\)[^"']*)\1/gi,
    async (whole, quote, css) => "style=" + quote +
      (await processCss(css, "index.html")).replaceAll(quote, quote === '"' ? "&quot;" : "&#39;") + quote);

  check(new TextEncoder().encode(html).length);
  return { files: { "index.html": html }, binaries: {}, remoteAssets: {} };
}
