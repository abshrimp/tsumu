import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { DocNode, Page, SiteDoc } from "./types";

export interface BodySearchHit {
  pageId: string;
  pageName: string;
  nodeId: string | null;
  componentId?: string;
  nodeName: string;
  excerpt: string;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase();
}

function excerpt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 32);
  const end = Math.min(text.length, at + length + 84);
  return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

const skipTags = new Set(["head", "title", "script", "style", "template", "noscript", "iframe"]);
const separatedTags = new Set([
  "address", "article", "aside", "blockquote", "br", "caption", "dd", "details", "dialog", "div",
  "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hgroup", "hr", "legend", "li", "main", "menu", "nav", "ol", "option", "p", "pre", "search", "section",
  "summary", "table", "td", "th", "ul",
]);
const htmlTextCache = new WeakMap<Page, { source: string; text: string }>();

function htmlBodyText(page: Page, source: string): string {
  if (!source) return "";
  const cached = htmlTextCache.get(page);
  if (cached?.source === source) return cached.text;

  // Inline elements can split a word. Keep their text adjacent, but separate paragraphs and line breaks.
  const parts: string[] = [];
  const pending: (Html.Node | " ")[] = [parse(source)];
  while (pending.length) {
    const node = pending.pop()!;
    if (node === " ") {
      parts.push(" ");
    } else if ("value" in node) {
      parts.push(node.value);
    } else if ("childNodes" in node) {
      if ("tagName" in node) {
        if (skipTags.has(node.tagName) || node.attrs.some(attr => attr.name === "hidden")) continue;
        if (separatedTags.has(node.tagName)) {
          parts.push(" ");
          pending.push(" ");
        }
      }
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  const text = parts.join("").replace(/\s+/g, " ").trim();
  htmlTextCache.set(page, { source, text });
  return text;
}

/** Search actual page body text, not variable names, page metadata or the editor UI. */
export function searchSiteBody(doc: SiteDoc, query: string, max = 100): BodySearchHit[] {
  const needle = normalize(query.trim());
  if (!needle || max <= 0) return [];
  const hits: BodySearchHit[] = [];
  for (const pageId of doc.pageOrder) {
    const page = doc.pages[pageId];
    if (!page || page.redirectTo !== undefined || page.rewriteTo !== undefined) continue;
    const add = (nodeId: string | null, nodeName: string, content: string, componentId?: string) => {
      const at = normalize(content).indexOf(needle);
      if (at < 0) return;
      hits.push({ pageId, pageName: page.name, nodeId, nodeName, componentId, excerpt: excerpt(content, at, needle.length) });
    };
    // Text-based HTML pages are also searchable, but do not have an editable element to select.
    if (page.rawHtml != null) {
      add(null, page.name, htmlBodyText(page, page.rawHtml));
    } else {
      const seen = new Set<string>();
      const walk = (nodeId: string, componentId?: string) => {
        if (seen.has(nodeId) || hits.length >= max) return;
        seen.add(nodeId);
        const node: DocNode | undefined = doc.nodes[nodeId];
        if (!node) return;
        if (node.type === "instance") {
          const component = node.componentId && doc.components?.[node.componentId];
          if (component) walk(component.rootId, component.id);
        } else {
          if (node.text?.content) add(nodeId, node.name, node.text.content, componentId);
          node.children.forEach(id => walk(id, componentId));
        }
      };
      page.children.forEach(id => walk(id));
    }
    if (hits.length >= max) break;
  }
  return hits;
}
