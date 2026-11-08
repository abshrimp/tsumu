import { openImportZip } from "./zip-directory";
import { assetSrc, uploadStaticAsset } from "./assets";
import { resolveZipReference } from "./zip-references";
import { rewriteSrcsetUrls } from "./srcset";
import { CSS_ASSET_ATTRIBUTES, rewriteCssAssetUrls } from "./css-assets";
import { attachZipDependencies, zipCssUrl, zipStylesheet } from "./zip-css";
import { HTML_ZIP_LIMITS, inspectHtmlZip, readZipEntryLimited } from "./html-zip-guard";
import { genId } from "./presets";
import { tr } from "./i18n";
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

export function rewriteZipReferences(html: string, htmlPath: string, urls: Map<string, string>) {
  const resolve = (value: string) => resolveZipReference(value, htmlPath, urls);
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[src],[href],[poster],[xlink\\:href]"))) {
    for (const attr of ["src", "href", "poster", "xlink:href"]) {
      const value = el.getAttribute(attr);
      if (value) {
        const target = resolve(value);
        el.setAttribute(attr, target);
        if (attr === "href" && el.tagName.toLowerCase() === "link" && target.startsWith("tsumu-zip-css:")) {
          el.removeAttribute("integrity");
        }
      }
    }
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[srcset]"))) {
    el.setAttribute("srcset", rewriteSrcsetUrls(el.getAttribute("srcset") ?? "", resolve));
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


/** Preflight the archive before uploading anything; JavaScript dependencies are not resolved. */
async function prepareHtmlZip(file: File | Uint8Array, progress: (message: string) => void = () => {}) {
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
    htmlText.set(entry.name, new TextDecoder("utf-8").decode(bytes));
  }
  const stylesheets = new Map<string, { bytes: Uint8Array<ArrayBuffer>; source: string }>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const entry of assetEntries) {
    if (!/\.css$/i.test(entry.name)) continue;
    const bytes = await readZipEntryLimited(entry, HTML_ZIP_LIMITS.cssBytes);
    let source: string;
    try { source = decoder.decode(bytes); }
    catch { throw new Error(tr("ZIP内のCSSはUTF-8に対応しています。文字コードをUTF-8に変換して再読み込みしてください。")); }
    const charset = /^@charset\s+["']([^"']+)["'];/i.exec(source)?.[1];
    if (charset && !/^utf-8$/i.test(charset)) {
      throw new Error(tr("ZIP内のCSSはUTF-8に対応しています。文字コードをUTF-8に変換して再読み込みしてください。"));
    }
    stylesheets.set(entry.name, { bytes, source });
  }

  const assets: Asset[] = [];
  const urls = new Map<string, string>();
  const group = genId("zip");
  for (let index = 0; index < assetEntries.length; index++) {
    const entry = assetEntries[index];
    progress(tr("アセットをアップロード中… {p1} / {length}", { p1: index + 1, length: assetEntries.length }));
    const path = cleanZipPath(entry.name);
    const sheet = stylesheets.get(entry.name);
    const bytes = sheet?.bytes ?? await readZipEntryLimited(entry, HTML_ZIP_LIMITS.assetBytes);
    const mime = zipMime(path);
    // Preserve original bytes, including UTF-8 BOM; CSS references are metadata.
    const upload = new File([bytes], path.replace(/\//g, "-"), { type: mime });
    const asset = await uploadStaticAsset(upload);
    asset.zip = { version: 1, group, path,
      ...(sheet ? { stylesheet: { source: sheet.source, references: [] } } : {}) };
    assets.push(asset);
    urls.set(path, zipStylesheet(asset) ? zipCssUrl(asset.id) : assetSrc(asset));
  }
  attachZipDependencies(assets);
  return { assets, htmlEntries, htmlEntry, urls, htmlText };
}

/** Existing raw-HTML page import: keep its single index.html behavior unchanged. */
export async function readHtmlZip(file: File | Uint8Array, progress: (message: string) => void = () => {}) {
  const { assets, htmlEntry, urls, htmlText } = await prepareHtmlZip(file, progress);
  const html = rewriteZipReferences(htmlText.get(htmlEntry.name) ?? "", cleanZipPath(htmlEntry.name), urls);
  return { assets, html, name: htmlEntry.name };
}

/** Editable site import: import every HTML page while uploading assets only once. */
export async function readHtmlZipPages(file: File | Uint8Array, progress: (message: string) => void = () => {}) {
  const { assets, htmlEntries, htmlEntry, urls, htmlText } = await prepareHtmlZip(file, progress);
  const entries = [htmlEntry, ...htmlEntries.filter((entry) => entry !== htmlEntry)];
  const pages = entries.map((entry) => ({
    name: cleanZipPath(entry.name),
    html: rewriteZipReferences(htmlText.get(entry.name) ?? "", cleanZipPath(entry.name), urls),
  }));
  return { assets, pages };
}
