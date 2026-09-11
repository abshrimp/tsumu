import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { Asset, HtmlZipPage } from "./types";
import { CSS_ASSET_ATTRIBUTES, rewriteCssAssetUrls } from "./css-assets";
import { rewriteSrcsetUrls } from "./srcset";
import { resolveZipReference } from "./zip-references";

/**
 * Rewrite only resource references in a derived preview/export copy.
 * Source offsets keep authored markup, comments (including before <html>),
 * whitespace, doctype, scripts, and unrelated attributes byte-for-byte.
 */
export function rewriteHtmlZipSource(source: string, htmlPath: string, urls: Map<string, string>): string {
  if (!urls.size) return source;
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const edits: { start: number; end: number; value: string }[] = [];
  const elements: Html.Element[] = [];
  const pending: Html.Node[] = [doc];
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node) {
      elements.push(node);
      if ("content" in node) pending.push((node as Html.Template).content);
    }
    if ("childNodes" in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  const baseElement = elements.find((el) => el.namespaceURI === "http://www.w3.org/1999/xhtml" && el.tagName === "base" && el.attrs.some(a => a.name === "href"));
  const href = baseElement?.attrs.find(a => a.name === "href")?.value;
  let base: URL | undefined;
  if (href) {
    try {
      const value = new URL(/^\/\//.test(href.trim()) ? "https:" + href.trim() : href.trim(), new URL(htmlPath, "file:///"));
      if (["http:", "https:"].includes(value.protocol) ||
          (value.protocol === "file:" && !/^[a-z][a-z0-9+.-]*:/i.test(href.trim()))) base = value;
    } catch { /* An invalid base uses the HTML entry directory. */ }
  }
  const resolve = (raw: string) => {
    const ref = raw.trim();
    if (!base || !ref || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return resolveZipReference(ref, htmlPath, urls);
    let url: URL;
    try { url = new URL(ref, base); } catch { return raw; }
    if (url.protocol !== "file:") return url.href;
    const path = url.pathname + url.search + url.hash;
    const mapped = resolveZipReference(path, "", urls);
    return mapped === path ? raw : mapped;
  };
  const escapeAttribute = (value: string) => value
    .replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const attrs = new Set(["src", "href", "poster", "xlink:href"]);
  const srcsets = new Set(["srcset", "imagesrcset"]);
  const styles = new Set<string>(CSS_ASSET_ATTRIBUTES);

  for (const el of elements) {
    const location = el.sourceCodeLocation;
    if (!location?.startTag) continue;
    let stylesheetChanged = false;
    for (const attr of el.attrs) {
      const key = attr.prefix ? attr.prefix + ":" + attr.name : attr.name;
      const loc = location.attrs?.[key];
      if (!loc || (el === baseElement && key === "href")) continue;
      let next: string;
      if (attrs.has(key)) next = resolve(attr.value);
      else if (srcsets.has(key)) next = rewriteSrcsetUrls(attr.value, resolve);
      else if (styles.has(key)) next = rewriteCssAssetUrls(attr.value, resolve);
      else continue;
      if (next === attr.value) continue;
      edits.push({ start: loc.startOffset, end: loc.endOffset, value: key + '="' + escapeAttribute(next) + '"' });
      if (el.tagName === "link" && key === "href" &&
          el.attrs.some(a => a.name === "rel" && /(?:^|\s)stylesheet(?:\s|$)/i.test(a.value))) stylesheetChanged = true;
    }
    // CSS bytes can differ in preview/export, so its original SRI no longer applies.
    if (stylesheetChanged) {
      const integrity = location.attrs?.integrity;
      if (integrity) edits.push({ start: integrity.startOffset, end: integrity.endOffset, value: "" });
    }
    if (el.tagName === "style" && location.endTag) {
      const start = location.startTag.endOffset;
      const end = location.endTag.startOffset;
      const old = source.slice(start, end);
      const next = rewriteCssAssetUrls(old, resolve);
      if (next !== old) edits.push({ start, end, value: next });
    }
  }
  if (!edits.length) return source;
  let cursor = 0;
  const pieces: string[] = [];
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    if (edit.start < cursor) continue;
    pieces.push(source.slice(cursor, edit.start), edit.value);
    cursor = edit.end;
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

export function htmlZipSource(
  source: string, zip: HtmlZipPage | undefined, assets: Record<string, Asset>,
  resourceUrl: (asset: Asset) => string,
): string {
  if (!zip) return source;
  const urls = new Map<string, string>();
  for (const id of zip.assetIds) {
    const asset = assets[id];
    if (asset?.zip?.path) urls.set(asset.zip.path, resourceUrl(asset));
  }
  return rewriteHtmlZipSource(source, zip.path, urls);
}
