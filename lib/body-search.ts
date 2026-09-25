import type { DocNode, SiteDoc } from "./types";

export interface BodySearchHit {
  pageId: string;
  pageName: string;
  nodeId: string | null;
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

/** Search actual page body text, not variable names, page metadata or the editor UI. */
export function searchSiteBody(doc: SiteDoc, query: string, max = 100): BodySearchHit[] {
  const needle = normalize(query.trim());
  if (!needle || max <= 0) return [];
  const hits: BodySearchHit[] = [];
  for (const pageId of doc.pageOrder) {
    const page = doc.pages[pageId];
    if (!page) continue;
    const seen = new Set<string>();
    const add = (nodeId: string | null, nodeName: string, content: string) => {
      if (hits.length >= max) return;
      const at = normalize(content).indexOf(needle);
      if (at < 0) return;
      hits.push({ pageId, pageName: page.name, nodeId, nodeName, excerpt: excerpt(content, at, needle.length) });
    };
    // Text-based HTML pages are also searchable, but do not have an editable element to select.
    if (page.rawHtml) {
      const plain = page.rawHtml
        .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ");
      add(null, page.name, plain);
    }
    const walk = (nodeId: string) => {
      if (seen.has(nodeId) || hits.length >= max) return;
      seen.add(nodeId);
      const node: DocNode | undefined = doc.nodes[nodeId];
      if (!node) return;
      if (node.type === "instance") {
        const rootId = doc.components?.[node.componentId ?? ""]?.rootId;
        if (rootId) walk(rootId);
      } else {
        if (node.text?.content) add(nodeId, node.name, node.text.content);
        node.children.forEach(walk);
      }
    };
    page.children.forEach(walk);
    if (hits.length >= max) break;
  }
  return hits;
}
