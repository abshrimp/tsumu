import JSZip from "jszip";
import { assetSrc, uploadStaticAsset } from "./assets";
import { resolveZipReference } from "./zip-references";
import { rewriteSrcsetUrls } from "./srcset";
import { CSS_ASSET_ATTRIBUTES, rewriteCssAssetUrls } from "./css-assets";
import { attachZipDependencies, zipCssUrl, zipStylesheet, ZIP_CSS_LIMITS } from "./zip-css";
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


/** Prepare a complete import before committing anything to the document/history. JS dependencies are not resolved. */
export async function readHtmlZip(file: File | Uint8Array, progress: (message: string) => void = () => {}) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith(".DS_Store")
  );
  if (entries.length > 200) throw new Error(tr("ZIPに入れられるファイルは200個までです"));
  const htmlEntries = entries.filter((entry) => /\.html?$/i.test(entry.name));
  if (!htmlEntries.length) throw new Error(tr("ZIP内にHTMLファイルが見つかりません"));
  const htmlEntry = htmlEntries.find((entry) => /(^|\/)index\.html?$/i.test(entry.name)) ?? htmlEntries[0];
  const assets: Asset[] = [];
  const urls = new Map<string, string>();
  const group = genId("zip");
  const assetEntries = entries.filter((entry) => !/\.html?$/i.test(entry.name));
  let sourceBytes = 0;
  for (let index = 0; index < assetEntries.length; index++) {
    const entry = assetEntries[index];
    progress(tr("アセットをアップロード中… {p1} / {length}", { p1: index + 1, length: assetEntries.length }));
    const path = cleanZipPath(entry.name);
    const bytes = await entry.async("uint8array");
    const mime = zipMime(path);
    let source: string | undefined;
    if (mime === "text/css") {
      sourceBytes += bytes.byteLength;
      if (sourceBytes > ZIP_CSS_LIMITS.source) throw new Error(tr("ZIP内のCSSは合計2MBまでです"));
      try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error(tr("ZIP内のCSSはUTF-8に対応しています。文字コードをUTF-8に変換して再読み込みしてください。")); }
      const charset = /^@charset\s+["']([^"']+)["'];/i.exec(source)?.[1];
      if (charset && !/^utf-8$/i.test(charset)) throw new Error(tr("ZIP内のCSSはUTF-8に対応しています。文字コードをUTF-8に変換して再読み込みしてください。"));
    }
    // Upload the original bytes, including any UTF-8 BOM. The metadata is only a rendering recipe.
    const upload = new File([bytes as Uint8Array<ArrayBuffer>], path.replace(/\//g, "-"), { type: mime });
    const asset = await uploadStaticAsset(upload);
    asset.zip = { version: 1, group, path, ...(source !== undefined ? { stylesheet: { source, references: [] } } : {}) };
    assets.push(asset);
    urls.set(path, zipStylesheet(asset) ? zipCssUrl(asset.id) : assetSrc(asset));
  }
  attachZipDependencies(assets);
  const html = rewriteZipReferences(await htmlEntry.async("text"), cleanZipPath(htmlEntry.name), urls);
  return { assets, html, name: htmlEntry.name };
}
