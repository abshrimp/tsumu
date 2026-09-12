import { parse, defaultTreeAdapter, type DefaultTreeAdapterTypes as Html } from "parse5";
import { assetSrc, nodeAssetSrc } from "./assets";
import { CSS_ASSET_ATTRIBUTES, rewriteCssAssetUrls } from "./css-assets";
import { IMPORT_LIMITS } from "./site-import-format";
import { rewriteSrcsetUrls } from "./srcset";
import type { SiteDoc } from "./types";

/** 復元したアセットは ID を保つが、古いエディタの URL は、取り込み元の環境のもの。 */
export function rebindImportedAssetUrls(original: SiteDoc, doc: SiteDoc) {
  const sources = new Map<string, string>();
  let growth = 0, elements = 0;
  for (const [id, old] of Object.entries(original.assets)) {
    const fresh = assetSrc(doc.assets[id]);
    for (const source of [assetSrc(old), old.dataUrl]) {
      if (source && (!sources.has(source) || (!sources.get(source) && fresh))) sources.set(source, fresh);
    }
  }
  for (const [source, target] of sources) if (source === target) sources.delete(source);
  if (!sources.size) return;
  function resolve(value: string): string {
    if (typeof value !== "string") return value;
    const at = value.indexOf("#");
    let key = at < 0 ? value : value.slice(0, at);
    let query = "";
    if (key.startsWith("/api/assets/file?")) {
      const params = new URLSearchParams(key.slice(key.indexOf("?") + 1));
      const path = params.get("path");
      if (!path) return value;
      key = "/api/assets/file?path=" + encodeURIComponent(path);
      for (const name of ["path", "exp", "sig"]) params.delete(name);
      query = params.toString();
    }
    const target = sources.get(key);
    if (target === undefined) return value;
    if (!target) return "";
    let next = target;
    if (query && !target.startsWith("data:")) next += "&" + query;
    if (at >= 0) next += value.slice(at);
    next = next.replace(/[<>]/g, c => c === "<" ? "%3C" : "%3E");
    growth += Math.max(0, next.length - value.length);
    if (growth > IMPORT_LIMITS.docBytes) throw new Error("編集データが容量上限を超えています。");
    return next;
  }
  const css = (text: string) => rewriteCssAssetUrls(text, resolve, IMPORT_LIMITS.docBytes);
  const attr = (name: string, value: string) => {
    if (name === "srcset" || name === "imagesrcset") return rewriteSrcsetUrls(value, resolve, IMPORT_LIMITS.docBytes);
    if (CSS_ASSET_ATTRIBUTES.includes(name)) return css(value);
    return ["src", "href", "poster", "xlink:href", "data"].includes(name) ? resolve(value) : value;
  };
  function markup(text: string): string {
    const tree = parse(text, { sourceCodeLocationInfo: true, treeAdapter: {
      ...defaultTreeAdapter,
      createElement(...args) {
        if (++elements > 100000) throw new Error("編集データが複雑すぎます。");
        return defaultTreeAdapter.createElement(...args);
      },
    } });
    const edits: { start: number; end: number; value: string }[] = [];
    const pending: Html.Node[] = [tree];
    while (pending.length) {
      const node = pending.pop()!;
      if ("childNodes" in node) for (const child of node.childNodes) pending.push(child);
      if (!("tagName" in node)) continue;
      if ("content" in node) pending.push((node as Html.Template).content);
      const loc = node.sourceCodeLocation;
      for (const a of node.attrs) {
        const key = a.prefix ? a.prefix + ":" + a.name : a.name;
        const pos = loc?.attrs?.[key];
        if (!pos) continue;
        const next = attr(key, a.value);
        if (next !== a.value) edits.push({ start: pos.startOffset, end: pos.endOffset, value: next ?
          key + '="' + next.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;") + '"' : "" });
      }
      if (node.tagName === "style" && loc?.startTag) {
        const start = loc.startTag.endOffset, end = loc.endTag?.startOffset ?? loc.endOffset;
        const old = text.slice(start, end), next = css(old);
        if (next !== old) edits.push({ start, end, value: next });
      }
    }
    if (!edits.length) return text;
    let cursor = 0;
    const parts: string[] = [];
    for (const edit of edits.sort((a, b) => a.start - b.start)) {
      parts.push(text.slice(cursor, edit.start), edit.value);
      cursor = edit.end;
    }
    parts.push(text.slice(cursor));
    return parts.join("");
  }

  function styles(values: SiteDoc["nodes"][string]["styles"] | undefined) {
    for (const bp of Object.values(values ?? {})) for (const state of Object.values(bp ?? {})) {
      if (!state || typeof state !== "object") continue;
      for (const [key, value] of Object.entries(state)) if (typeof value === "string") state[key] = css(value);
    }
  }
  for (const node of Object.values(doc.nodes)) {
    for (const media of [node.image, node.media, ...(node.media?.sources ?? [])]) {
      if (!media) continue;
      if (!media.src) continue;
      const id = media.assetId;
      media.src = id && Object.hasOwn(original.assets, id) && media.src === assetSrc(original.assets[id])
        ? nodeAssetSrc(doc.assets[id]) : resolve(media.src);
    }
    if (node.link?.url) node.link.url = resolve(node.link.url);
    if (node.embed?.src) node.embed.src = resolve(node.embed.src);
    if (node.customCss) node.customCss = css(node.customCss);
    if (node.code?.html) node.code.html = markup(node.code.html);
    if (node.icon?.svg) node.icon.svg = markup(node.icon.svg);
    if (node.htmlAttrs) for (const [key, value] of Object.entries(node.htmlAttrs)) node.htmlAttrs[key] = attr(key.toLowerCase(), value);
    styles(node.styles);
  }
  for (const page of Object.values(doc.pages)) {
    styles(page.bodyStyles);
    if (page.rawHtml) page.rawHtml = markup(page.rawHtml);
    if (page.customTopHtml) page.customTopHtml = markup(page.customTopHtml);
    if (page.customEndHtml) page.customEndHtml = markup(page.customEndHtml);
    if (page.ogImage?.url) page.ogImage.url = resolve(page.ogImage.url);
  }
  for (const image of [doc.favicon, doc.appleTouchIcon, doc.ogImage, doc.pwa?.icon]) {
    if (image?.url) image.url = resolve(image.url);
  }
  if (doc.customHeadHtml) doc.customHeadHtml = markup(doc.customHeadHtml);
  if (doc.customBodyEndHtml) doc.customBodyEndHtml = markup(doc.customBodyEndHtml);
}
