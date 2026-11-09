import type { DefaultTreeAdapterTypes as Html } from "parse5";
import type { GeneratedProject } from "../generator";
import { fetchWithRetry } from "../assets";
import { CSS_ASSET_ATTRIBUTES, escapeStyleContent } from "../css-assets";
import { rewriteSrcsetUrls } from "../srcset";
import { EXPORT_BASE, SINGLE_HTML_LIMIT, HtmlOutput, singleHtmlResources, textBytes, type ResourceRequest } from "./single-html-resources";

const HTML = "http://www.w3.org/1999/xhtml";

function attributes(element: Html.Element) {
  return new Map(element.attrs.map(a => [a.prefix ? a.prefix + ":" + a.name : a.name, a.value]));
}

function startTag(name: string, attrs: Map<string, string>, selfClosing = false) {
  let tag = "<" + name;
  for (const [key, value] of attrs) {
    const escaped = value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    tag += " " + key + '="' + escaped + '"';
  }
  return tag + (selfClosing ? "/>" : ">");
}

export async function toSingleHtmlProject(
  source: GeneratedProject,
  request: ResourceRequest = (url, init) => fetchWithRetry(url, 3, init),
): Promise<GeneratedProject> {
  const html = source.files["index.html"];
  if (!html || Object.keys(source.files).filter(path => /\.html?$/i.test(path)).length !== 1) {
    throw new Error("Single HTML requires one fixed page. Export the current page or a selected component.");
  }
  if (textBytes(html) > SINGLE_HTML_LIMIT) throw new Error("The embedded HTML exceeds 48 MB.");
  const { parse, defaultTreeAdapter } = await import("parse5");
  let elementsCreated = 0;
  const doc = parse(html, {
    sourceCodeLocationInfo: true,
    treeAdapter: {
      ...defaultTreeAdapter,
      createElement(...args) {
        if (++elementsCreated > 100000) throw new Error("Too many elements for single HTML export.");
        return defaultTreeAdapter.createElement(...args);
      },
    },
  });
  // Source offsets let us copy unmodified comments, script bodies, quoted text,
  // and other authored markup verbatim, even when HTML parsing reparents nodes.
  const elements: Html.Element[] = [];
  const pending: { node: Html.Node; inert: boolean }[] = [{ node: doc, inert: false }];
  let base = EXPORT_BASE;
  let foundBase = false;
  let hasImportMap = false;
  while (pending.length) {
    const { node, inert } = pending.pop()!;
    if ("tagName" in node) {
      if (node.sourceCodeLocation?.startTag) elements.push(node);
      if (!inert && !foundBase && node.namespaceURI === HTML && node.tagName === "base") {
        const href = node.attrs.find(a => a.name === "href");
        if (href) {
          foundBase = true;
          try {
            const url = new URL(href.value, EXPORT_BASE);
            if (url.protocol === "https:" || url.protocol === "http:") base = url;
          } catch { /* Invalid base uses the document URL. */ }
        }
      }
      if (!inert && node.namespaceURI === HTML && node.tagName === "script" &&
          node.attrs.some(attr => attr.name === "type" && attr.value.trim().toLowerCase() === "importmap")) {
        hasImportMap = true;
      }
      if ("content" in node) pending.push({ node: (node as Html.Template).content, inert: true });
    }
    if ("childNodes" in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push({ node: node.childNodes[i], inert });
    }
  }

  const resources = singleHtmlResources(source, request, hasImportMap);
  const result = new HtmlOutput();
  let cursor = 0, srcsetCandidates = 0;
  for (const node of elements.sort((a, b) => a.sourceCodeLocation!.startOffset - b.sourceCodeLocation!.startOffset)) {
    const loc = node.sourceCodeLocation!, start = loc.startTag!;
    if (start.startOffset < cursor) continue;
    const original = html.slice(start.startOffset, start.endOffset);
    const name = node.tagName;
    const htmlTag = node.namespaceURI === HTML;
    const attrs = attributes(node);
    const get = (key: string) => attrs.get(key) ?? "";
    let modified = false;
    const set = (key: string, value: string) => {
      if (value !== get(key)) { attrs.set(key, value); modified = true; }
    };
    let replacement: string | undefined;
    let end = start.endOffset;
    for (const key of CSS_ASSET_ATTRIBUTES) {
      if (attrs.has(key)) set(key, await resources.css(get(key), base));
    }
    if (htmlTag && name === "link") {
      const rel = get("rel").toLowerCase().split(/\s+/);
      const href = get("href");
      if (rel.includes("manifest")) replacement = "";
      else if (href && rel.includes("stylesheet") && !/^data:/i.test(href) &&
               (!get("type") || get("type").toLowerCase() === "text/css")) {
        const css = await resources.stylesheet(new URL(href, base), new Set(), get("integrity"));
        if (rel.includes("alternate") || attrs.has("disabled") || attrs.has("title")) {
          set("href", resources.cssUrl(css));
          attrs.delete("integrity"); // The original bytes were verified before rewriting CSS.
        } else {
          for (const key of ["rel", "href", "integrity", "crossorigin", "referrerpolicy"]) attrs.delete(key);
          replacement = startTag("style", attrs) + "\n" + escapeStyleContent(css) + "\n</style>";
        }
      } else if (href && rel.includes("icon")) set("href", await resources.embed(href, base));
    } else if (htmlTag && name === "script" && get("src")) {
      const url = new URL(get("src"), base);
      if (url.origin === EXPORT_BASE.origin && url.pathname === "/pwa.js" && Object.hasOwn(source.files, "pwa.js")) {
        replacement = ""; end = loc.endOffset;
      } else if (get("type").trim().toLowerCase() === "module" && url.protocol !== "data:") {
        set("src", await resources.embedModule(url, get("integrity")));
        attrs.delete("integrity"); // The original bytes were verified before rewriting module specifiers.
      } else if (!get("type") || /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i.test(get("type").trim())) {
        // A data URL retains external-script parsing, defer/async, and any native
        // integrity enforcement without introducing a network dependency.
        set("src", await resources.embed(get("src"), base, get("integrity"), true));
      }
    } else if (htmlTag && ["img", "source", "video", "audio", "input", "track"].includes(name)) {
      for (const key of ["src", "poster"]) {
        if (key === "poster" && name !== "video") continue;
        if (name === "input" && get("type").toLowerCase() !== "image") continue;
        if (get(key)) set(key, await resources.embed(get(key), base));
      }
      if ((name === "img" || name === "source") && get("srcset")) {
        const urls = new Map<string, string>();
        rewriteSrcsetUrls(get("srcset"), ref => {
          if (++srcsetCandidates > 100000) throw new Error("Too many single HTML srcset candidates.");
          urls.set(ref, ref);
          return ref;
        });
        for (const ref of urls.keys()) urls.set(ref, await resources.embed(ref, base));
        set("srcset", rewriteSrcsetUrls(get("srcset"), ref => urls.get(ref)!, SINGLE_HTML_LIMIT));
      }
    } else if (name === "style") {
      const stop = loc.endTag?.startOffset ?? loc.endOffset;
      const content = html.slice(start.endOffset, stop);
      const css = await resources.css(content, base);
      if (css !== content) {
        replacement = (modified ? startTag(name, attrs) : original) + escapeStyleContent(css);
        end = stop;
      }
    }
    if (replacement === undefined && !modified) continue;
    result.append(html.slice(cursor, start.startOffset));
    result.append(replacement ?? startTag(name, attrs, !htmlTag && original.endsWith("/>")));
    cursor = end;
  }
  result.append(html.slice(cursor));
  return { files: { "index.html": result.join() }, binaries: {}, remoteAssets: {} };
}
