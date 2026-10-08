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

/** Find a source boundary by measuring complete prefixes, so adjacent characters can combine. */
function sourceOffset(text: string, normalizedOffset: number, guess: number): number {
  let low = 0;
  let high = text.length;
  let probe = Math.max(0, Math.min(guess, high));
  while (low < high) {
    const length = normalize(text.slice(0, probe)).length;
    if (length === normalizedOffset) return probe;
    if (length < normalizedOffset) low = probe + 1;
    else high = probe;
    probe = Math.floor((low + high) / 2);
  }
  return low;
}

function excerpt(text: string, normalized: string, at: number, needle: string): string {
  const length = needle.length;
  let start = Math.max(0, at - 32);
  let end = Math.min(text.length, at + length + 84);
  // Unchanged text and ASCII case folding preserve offsets. Only remap a cropped, transformed hit.
  if ((start > 0 || end < text.length) && normalized !== text && /[^\x00-\x7F]/.test(text)) {
    const remaining = normalized.length - at;
    const sourceStart = sourceOffset(text, at, at <= remaining ? at : text.length - remaining);
    start = Math.max(0, sourceStart - 32);
    end = Math.min(text.length, sourceOffset(text, at + length, sourceStart + length) + 84);
    // A mark can compose with its base across a run of other marks longer than the excerpt.
    if (!normalize(text.slice(start, end)).includes(needle)) {
      const graphemes = new Intl.Segmenter().segment(text);
      start = graphemes.containing(start)?.index ?? start;
      const last = graphemes.containing(end - 1);
      if (last) end = last.index + last.segment.length;
    }
  }
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
      const normalized = normalize(content);
      const at = normalized.indexOf(needle);
      if (at < 0) return;
      hits.push({ pageId, pageName: page.name, nodeId, nodeName, componentId, excerpt: excerpt(content, normalized, at, needle) });
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
