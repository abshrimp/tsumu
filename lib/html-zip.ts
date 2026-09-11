import { withImportUploads } from "./import-uploads";
import { openImportZip } from "./zip-directory";
import { assetSrc, uploadStaticAsset } from "./assets";
import { resolveZipReference } from "./zip-references";
import { rewriteSrcsetUrls } from "./srcset";
import { CSS_ASSET_ATTRIBUTES, rewriteCssAssetUrls } from "./css-assets";
import { attachZipDependencies, zipCssUrl, zipStylesheet } from "./zip-css";
import { HTML_ZIP_LIMITS, inspectHtmlZip, readZipEntryLimited } from "./html-zip-guard";
import { genId } from "./presets";
import { tr } from "./i18n";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { verifyZipEntry } from "./zip-stream";
import { createIntegrityVerifier } from "./resource-integrity";
import type { Asset } from "./types";

const ZIP_MIME: Record<string, string> = {
  css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
};

const zipMime = (name: string) =>
  ZIP_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const cleanZipPath = (value: string) =>
  value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

// Keep externally based references external. Resolve a local base inside the
// archive without interpreting relative URLs against the editor origin.
function archiveResolver(htmlPath: string, href: string | undefined | null, urls: Map<string, string>) {
  let base: URL | undefined;
  if (href) {
    try {
      const text = href.trim();
      const value = new URL(/^[\\/]{2}/.test(text) ? "https:" + text : text, new URL(htmlPath, "file:///"));
      if (["http:", "https:"].includes(value.protocol) ||
          (value.protocol === "file:" && !/^[a-z][a-z0-9+.-]*:/i.test(href.trim()))) base = value;
    } catch { /* Invalid bases use the HTML entry's directory. */ }
  }
  return (raw: string): string => {
    const ref = raw.trim();
    if (!base || !ref || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return resolveZipReference(ref, htmlPath, urls);
    let url: URL;
    try { url = new URL(ref, base); } catch { return raw; }
    if (url.protocol !== "file:") return url.href;
    const path = url.pathname + url.search + url.hash;
    const target = resolveZipReference(path, htmlPath, urls);
    return target === path ? raw : target;
  };
}

export function rewriteZipReferences(html: string, htmlPath: string, urls: Map<string, string>) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = Array.from(doc.querySelectorAll("base[href]")).find(el => el.namespaceURI === "http://www.w3.org/1999/xhtml");
  const resolve = archiveResolver(htmlPath, base?.getAttribute("href"), urls);
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[src],[href],[poster],[xlink\\:href]"))) {
    for (const attr of ["src", "href", "poster", "xlink:href"]) {
      const value = el.getAttribute(attr);
      if (value && !(el === base && attr === "href")) {
        el.setAttribute(attr, resolve(value));
      }
    }
  }
  for (const attr of ["srcset", "imagesrcset"]) {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`[${attr}]`))) {
      el.setAttribute(attr, rewriteSrcsetUrls(el.getAttribute(attr) ?? "", resolve));
    }
  }
  for (const attr of CSS_ASSET_ATTRIBUTES) {
    for (const el of Array.from(doc.querySelectorAll(`[${attr}]`))) {
      el.setAttribute(attr, rewriteCssAssetUrls(el.getAttribute(attr) ?? "", resolve));
    }
  }
  for (const el of Array.from(doc.querySelectorAll("style"))) {
    el.textContent = rewriteCssAssetUrls(el.textContent ?? "", resolve);
  }
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}


/** Verify each archive-local resource before its bytes are uploaded or its CSS transformed. */
async function verifyZipIntegrity(htmlText: Map<string, string>, assetEntries: import("jszip").JSZipObject[],
    sourceBytes: Map<string, Uint8Array<ArrayBuffer>>) {
  const verify = createIntegrityVerifier();
  const indices = new Map(assetEntries.map((entry, index) => [entry.name, "zip-member:" + index]));
  for (const [path, html] of htmlText) {
    if (!/integrity/i.test(html)) continue;
    const { parse, defaultTreeAdapter } = await import("parse5");
    let elements = 0;
    const doc = parse(html, { sourceCodeLocationInfo: true, treeAdapter: {
      ...defaultTreeAdapter,
      createElement(...args) {
        if (++elements > 100000) throw new Error("Too many HTML elements in the imported page.");
        return defaultTreeAdapter.createElement(...args);
      },
    } });
    const pending: Html.Node[] = [doc];
    const protectedTags: Html.Element[] = [];
    let baseHref: string | undefined;
    while (pending.length) {
      const node = pending.pop()!;
      if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
      if (!("tagName" in node)) continue;
      if (baseHref === undefined && node.tagName === "base" && node.namespaceURI === "http://www.w3.org/1999/xhtml") {
        baseHref = node.attrs.find(attr => attr.name === "href")?.value;
      }
      if (node.tagName === "link" || node.tagName === "script") protectedTags.push(node);
    }
    const resolve = archiveResolver(path, baseHref, indices);
    const remove: { startOffset: number; endOffset: number }[] = [];
    for (const node of protectedTags) {
      const metadata = node.attrs.find(attr => attr.name === "integrity")?.value;
      const ref = node.attrs.find(attr => attr.name === (node.tagName === "link" ? "href" : "src"))?.value;
      if (!metadata || !ref) continue;
      // An authored URL with this scheme is never an archive reference.
      const target = /^zip-member:(\d+)(?:[?#]|$)/.exec(resolve(ref));
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(ref.trim())) continue;
      const entry = assetEntries[Number(target[1])];
      const bytes = sourceBytes.get(entry.name) ?? await readZipEntryLimited(entry, HTML_ZIP_LIMITS.assetBytes);
      sourceBytes.set(entry.name, bytes);
      await verify(bytes, metadata);
      const attribute = node.sourceCodeLocation?.attrs?.integrity;
      if (node.tagName === "link" && attribute && /\.css$/i.test(entry.name)) remove.push(attribute);
    }
    if (remove.length) {
      const parts: string[] = [];
      let start = 0;
      for (const attr of remove.sort((a, b) => a.startOffset - b.startOffset)) {
        parts.push(html.slice(start, attr.startOffset));
        start = attr.endOffset;
      }
      parts.push(html.slice(start));
      htmlText.set(path, parts.join(""));
    }
  }
}

/** Preflight the archive before uploading anything; JavaScript dependencies are not resolved. */
async function prepareHtmlZip(
  file: File | Uint8Array, progress: (message: string) => void, paths: string[],
  existing: Asset[] = [],
) {
  const compressedBytes = file instanceof Uint8Array ? file.byteLength : file.size;
  if (compressedBytes > HTML_ZIP_LIMITS.zipBytes) {
    throw new Error("インポートするファイルが大きすぎます。");
  }
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  const zip = await openImportZip(bytes, HTML_ZIP_LIMITS.entries);
  const { htmlEntries, htmlEntry, assetEntries } = inspectHtmlZip(zip);

  // Verify HTML and CSS bytes before starting an upload. A malformed stylesheet
  // must not leave behind assets uploaded earlier in the same import.
  const htmlText = new Map<string, string>();
  for (const entry of htmlEntries) {
    const bytes = await readZipEntryLimited(entry, HTML_ZIP_LIMITS.htmlBytes);
    htmlText.set(entry.name, new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
  }
  const stylesheets = new Map<string, { bytes: Uint8Array<ArrayBuffer>; source: string }>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const entry of assetEntries) {
    if (!/\.css$/i.test(entry.name)) continue;
    const bytes = await readZipEntryLimited(entry, HTML_ZIP_LIMITS.cssBytes);
    let source: string;
    try { source = decoder.decode(bytes); }
    catch { throw new Error(tr("ZIP stylesheets must use UTF-8. Convert the CSS files to UTF-8 and reimport the ZIP.")); }
    const charset = /^@charset\s+["']([^"']+)["'];/i.exec(source)?.[1];
    if (charset && !/^utf-8$/i.test(charset)) {
      throw new Error(tr("ZIP stylesheets must use UTF-8. Convert the CSS files to UTF-8 and reimport the ZIP."));
    }
    stylesheets.set(entry.name, { bytes, source });
  }

  // Integrity validation may remove CSS SRI for a converted page. The raw HTML
  // editor must keep the original source, including SRI, comments and formatting.
  const pristineHtmlText = new Map(htmlText);
  const checkedBytes = new Map([...stylesheets].map(([path, sheet]) => [path, sheet.bytes]));
  await verifyZipIntegrity(htmlText, assetEntries, checkedBytes);
  for (const entry of assetEntries) {
    // Prove the remaining members are intact before the first upload without
    // retaining up to the whole expanded archive in the editor's memory.
    if (!checkedBytes.has(entry.name)) await verifyZipEntry(entry, HTML_ZIP_LIMITS.assetBytes);
  }

  const assets: Asset[] = [];
  const urls = new Map<string, string>();
  const group = existing.find(a => a.zip?.group)?.zip?.group ?? genId("zip");
  for (let index = 0; index < assetEntries.length; index++) {
    const entry = assetEntries[index];
    progress(tr("Uploading assets… {p1} / {length}", { p1: index + 1, length: assetEntries.length }));
    const path = cleanZipPath(entry.name);
    const sheet = stylesheets.get(entry.name);
    const bytes = checkedBytes.get(entry.name) ?? await readZipEntryLimited(entry, HTML_ZIP_LIMITS.assetBytes);
    const mime = zipMime(path);
    // Preserve original bytes, including UTF-8 BOM; CSS references are metadata.
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
    const previous = existing.find(asset => asset.zip?.path === path && asset.zip.sha256 === sha256);
    const asset = previous
      ? { ...previous }
      : await uploadStaticAsset(new File([bytes], path.replace(/\//g, "-"), { type: mime }));
    if (!previous && asset.path) paths.push(asset.path);
    asset.zip = { version: 1, group, path, sha256,
      ...(sheet ? { stylesheet: { source: sheet.source, references: [] } } : {}) };
    assets.push(asset);
    urls.set(path, zipStylesheet(asset) ? zipCssUrl(asset.id) : assetSrc(asset));
  }
  attachZipDependencies(assets);
  return { assets, htmlEntries, htmlEntry, urls, htmlText, pristineHtmlText };
}

/** Existing raw-HTML page import: keep its single index.html behavior unchanged. */
export async function readHtmlZip(
  file: File | Uint8Array, progress: (message: string) => void = () => {},
  uploaded?: string[], existing: Asset[] = [], sourceOnly = false,
) {
  return withImportUploads(async paths => {
    const { assets, htmlEntry, urls, htmlText, pristineHtmlText } =
      await prepareHtmlZip(file, progress, paths, existing);
    const path = cleanZipPath(htmlEntry.name);
    const source = pristineHtmlText.get(htmlEntry.name) ?? "";
    if (!source.trim()) throw new Error(tr("The HTML file in the ZIP is empty. The existing page has not been replaced."));
    // HTML-mode imports never parse/serialize the authored source.
    // Visual-node imports still need resolved references for conversion.
    const html = sourceOnly ? source : rewriteZipReferences(htmlText.get(htmlEntry.name) ?? "", path, urls);
    return {
      assets, html, source,
      zip: { path, assetIds: assets.map(a => a.id) }, name: htmlEntry.name,
    };
  }, uploaded);
}

/** Editable site import: import every HTML page while uploading assets only once. */
export async function readHtmlZipPages(file: File | Uint8Array, progress: (message: string) => void = () => {}, uploaded?: string[]) {
  return withImportUploads(async paths => {
    const { assets, htmlEntries, htmlEntry, urls, htmlText } = await prepareHtmlZip(file, progress, paths);
    const entries = [htmlEntry, ...htmlEntries.filter((entry) => entry !== htmlEntry)];
    const pages = entries.map((entry) => ({
      name: cleanZipPath(entry.name),
      html: rewriteZipReferences(htmlText.get(entry.name) ?? "", cleanZipPath(entry.name), urls),
    }));
    return { assets, pages };
  }, uploaded);
}
