import type { DocNode, SiteDoc } from "./types";

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
      const plain = page.rawHtml
        .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ");
      add(null, page.name, plain);
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
