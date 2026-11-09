import { tokenizer, tokTypes } from "acorn";
import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { assetSrc } from "../assets";
import { CSS_ASSET_ATTRIBUTES, iterateCssAssetReferences } from "../css-assets";
import { rewriteSrcsetUrls } from "../srcset";
import type { Asset, SiteDoc } from "../types";
import { zipCssUrl } from "../zip-css";
import { importedAssetUrl } from "./imported-assets";

// A virtual file root distinguishes archive paths from every HTTP origin.
const root = new URL("file:///");
const absolute = /^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i;
const urlFields = new Set(["src", "href", "url", "poster", "action", "formaction", "cite", "background"]);

/** Match local asset identities only in fields or markup that can actually reference files. */
export function scopedAssetIds(doc: SiteDoc, assets: Record<string, Asset>): Set<string> {
  const ids = new Set<string>();
  if (!Object.keys(assets).length) return ids;
  const urls = new Set<string>();
  let references = 0;
  function record(raw: string, base = root) {
    raw = raw.trim();
    if (!raw || raw.startsWith("#")) return;
    if (++references > 100000) throw new Error("Too many asset references in this partial export.");
    if (/^(?:data:|tsumu-zip-css:)/i.test(raw)) { urls.add(raw.split("#", 1)[0]); return; }
    if (absolute.test(raw)) return;
    try {
      const url = new URL(raw, base);
      if (url.protocol !== "file:" || url.host) return;
      if (url.pathname === "/api/assets/file") {
        const path = url.searchParams.get("path");
        if (path?.startsWith("assets/")) urls.add("/api/assets/file?path=" + encodeURIComponent(path));
      } else if (url.pathname.startsWith("/assets/")) urls.add(decodeURIComponent(url.pathname));
    } catch { /* A malformed URL does not identify a registered file. */ }
  }
  function css(value: string, base = root) {
    for (const ref of iterateCssAssetReferences(value)) record(ref.url, base);
  }
  function attribute(name: string, value: string, base = root) {
    if (name === "srcset" || name === "imagesrcset") {
      rewriteSrcsetUrls(value, url => { record(url, base); return url; });
    } else if (urlFields.has(name)) record(value, base);
    else if (CSS_ASSET_ATTRIBUTES.includes(name)) css(value, base);
  }
  function walk(value: unknown, depth = 0, mode: "normal" | "css" | "script" = "normal") {
    if (!value || typeof value !== "object" || depth > 50) return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string") {
        if (key === "assetId" && Object.hasOwn(assets, child)) ids.add(child);
        else if (mode === "css" || key === "customCss") css(child);
        else if (mode === "script" && (key === "value" || key === "template")) record(child, base);
        else attribute(key.toLowerCase(), child, base);
      } else if (key !== "assets" && key !== "preview") {
        const context = key === "styles" || key === "bodyStyles" ? "css" :
          key === "scripts" || key === "pageScripts" ? "script" : mode;
        walk(child, depth + 1, context);
      }
    }
  }

  const pages = Object.values(doc.pages);
  const snippets = [
    doc.customHeadHtml, ...pages.flatMap(page => [page.rawHtml, page.customTopHtml]),
    ...Object.values(doc.nodes).flatMap(node => [node.code?.html, node.icon?.svg]),
    ...pages.map(page => page.customEndHtml), doc.customBodyEndHtml,
  ];
  let size = 0, elements = 0, foundBase = false, base = root;
  const tags: Html.Element[] = [];
  for (const snippet of snippets) {
    if (!snippet) continue;
    size += snippet.length;
    if (size > 48 * 1024 * 1024) throw new Error("Custom HTML exceeds the partial export size limit.");
    const fragment = parseFragment(snippet, { treeAdapter: {
      ...defaultTreeAdapter,
      createElement(...args) {
        if (++elements > 100000) throw new Error("Too many HTML elements in this partial export.");
        return defaultTreeAdapter.createElement(...args);
      },
    } });
    const pending: { node: Html.Node; inert: boolean }[] = [{ node: fragment, inert: false }];
    while (pending.length) {
      const { node, inert } = pending.pop()!;
      if ("tagName" in node) {
        tags.push(node);
        if (!inert && !foundBase && node.tagName === "base" && node.namespaceURI === "http://www.w3.org/1999/xhtml") {
          const href = node.attrs.find(a => a.name === "href");
          if (href) {
            foundBase = true;
            try {
              const next = new URL(href.value, root);
              if (next.protocol === "http:" || next.protocol === "https:" || !absolute.test(href.value.trim())) base = next;
            } catch { /* An invalid base falls back to the document URL. */ }
          }
        }
        if ("content" in node) pending.push({ node: (node as Html.Template).content, inert: true });
      }
      if ("childNodes" in node) {
        for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push({ node: node.childNodes[i], inert });
      }
    }
  }
  walk(doc);
  for (const tag of tags) {
    for (const attr of tag.attrs) {
      if (tag.tagName === "object" && attr.name === "data") record(attr.value, base);
      else if (tag.tagName !== "base") attribute(attr.name, attr.value, base);
    }
    if (tag.tagName !== "script" && tag.tagName !== "style") continue;
    const source = tag.childNodes.map(node => "value" in node ? node.value : "").join("");
    if (tag.tagName === "style") { css(source, base); continue; }
    if (tag.attrs.some(a => a.name === "src" || (a.name === "type" && a.value.trim() &&
        !/^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i.test(a.value.trim())))) continue;
    // Only literal JavaScript strings designate a static file. Comments, regular
    // expressions and the text portions of interpolated templates cannot do so.
    const module = tag.attrs.some(a => a.name === "type" && a.value.trim().toLowerCase() === "module");
    try {
      for (const token of tokenizer(source, { ecmaVersion: "latest", sourceType: module ? "module" : "script" })) {
        if ("value" in token && typeof token.value === "string" && (token.type === tokTypes.string ||
            (token.type === tokTypes.template && source[token.start - 1] === "`" && source[token.end] === "`"))) {
          record(token.value, base);
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Cannot inspect this custom script for a partial export. Export the whole project.");
      throw error;
    }
  }
  for (const [id, asset] of Object.entries(assets)) {
    if (urls.has(assetSrc(asset)) || urls.has("/assets/" + asset.name) ||
        (asset.path && urls.has("/" + asset.path)) || urls.has(zipCssUrl(id)) ||
        (asset.zip && urls.has(importedAssetUrl(asset) ?? ""))) ids.add(id);
  }
  return ids;
}
