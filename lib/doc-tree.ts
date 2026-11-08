// The editor and generators recursively render child IDs from a flat map.
// Detached nodes are valid, but every node must belong to a finite tree.
export const MAX_NODE_DEPTH = 256;

export function hasValidChildren(value: unknown): value is { children: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const children = (value as { children?: unknown }).children;
  return Array.isArray(children) && children.every(id => typeof id === "string") &&
    new Set(children).size === children.length;
}

export function validNodeForest(pages: Record<string, unknown>, nodes: Record<string, unknown>): boolean {
  const parents = new Set<string>();
  const edges = new Map<string, string[]>();
  for (const [id, node] of Object.entries(nodes)) {
    if (!hasValidChildren(node) || !("id" in node) || node.id !== id) return false;
    edges.set(id, node.children);
    for (const child of node.children) {
      if (parents.has(child) || !Object.hasOwn(nodes, child)) return false;
      parents.add(child);
    }
  }
  for (const page of Object.values(pages)) {
    if (!hasValidChildren(page) || !page.children.every(id => edges.has(id))) return false;
  }
  let layer = [...edges.keys()].filter(id => !parents.has(id));
  let visited = 0;
  for (let depth = 1; layer.length; depth++) {
    if (depth > MAX_NODE_DEPTH) return false;
    visited += layer.length;
    const next: string[] = [];
    for (const id of layer) for (const child of edges.get(id)!) next.push(child);
    layer = next;
  }
  return visited === edges.size;
}
