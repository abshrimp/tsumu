import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { Asset, HtmlZipPage } from "./types";
import { CSS_ASSET_ATTRIBUTES, rewriteCssAssetUrls } from "./css-assets";
import { rewriteSrcsetUrls } from "./srcset";
import { archiveBaseUrl, archiveResolver } from "./zip-references";

export function htmlZipElements(source: string) {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const elements: Html.Element[] = [];
  const pending: Html.Node[] = [doc];
  const templates: Html.Node[] = [];
  let inTemplate = false;
  let baseElement: Html.Element | undefined;
  while (pending.length || templates.length) {
    if (!pending.length) inTemplate = true;
    const node = pending.pop() ?? templates.pop()!;
    if ("tagName" in node) {
      elements.push(node);
      if (!baseElement && !inTemplate && node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
          node.tagName === "base" && node.attrs.some(attr => attr.name === "href")) baseElement = node;
      if ("content" in node) templates.push((node as Html.Template).content);
    }
    if ("childNodes" in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  return { elements, baseElement };
}

/**
 * 派生したプレビュー・書き出しの写しで、リソースの参照だけを書き換える。
 * ソース上の位置を使い、書かれたマークアップ、コメント（<html> の前のものも含む）、
 * 空白、doctype、スクリプト、無関係な属性は、1バイトも変えずに残す。
 */
export function rewriteHtmlZipSource(source: string, htmlPath: string, urls: Map<string, string>): string {
  if (!urls.size) return source;
  const { elements, baseElement } = htmlZipElements(source);
  const href = baseElement?.attrs.find(a => a.name === "href")?.value;
  const base = archiveBaseUrl(htmlPath, href);
  const resolve = archiveResolver(htmlPath, base, urls);
  const edits: { start: number; end: number; value: string }[] = [];
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
      if (el.tagName === "link" && key === "href" && next.startsWith("tsumu-zip-css:")) stylesheetChanged = true;
    }
    // プレビューや書き出しでは CSS のバイト列が変わることがあるため、元の SRI はもう当てはまらない。
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
