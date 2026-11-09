// The editor and generators recursively render child IDs from a flat map.
// Detached nodes are valid, but every node must belong to a finite tree.
export const MAX_NODE_DEPTH = 256;

/** Map IDs become object property names throughout the editor. */
function safeCollectionId(id: string): boolean {
  return !!id && id !== "constructor" && id !== "prototype" &&
    !Object.hasOwn(Object.prototype, id);
}

/** Height of the deepest root tree, counting a leaf as one node. Invalid input cannot fit. */
export function maxSubtreeDepth(
  nodes: Record<string, { children: string[] }>,
  rootIds: readonly string[],
): number {
  const heights = new Map<string, number>();
  const active = new Set<string>();
  let maximum = 0;
  for (const root of rootIds) {
    const stack: { id: string; exit: boolean }[] = [{ id: root, exit: false }];
    while (stack.length) {
      const { id, exit } = stack.pop()!;
      if (heights.has(id)) continue;
      const node = Object.hasOwn(nodes, id) ? nodes[id] : undefined;
      if (!node || !Array.isArray(node.children)) return Infinity;
      if (exit) {
        let height = 1;
        for (const child of node.children) height = Math.max(height, 1 + heights.get(child)!);
        heights.set(id, height);
        active.delete(id);
      } else {
        if (active.has(id)) return Infinity;
        active.add(id);
        stack.push({ id, exit: true });
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push({ id: node.children[i], exit: false });
        }
      }
    }
    maximum = Math.max(maximum, heights.get(root)!);
  }
  return maximum;
}

export function hasValidChildren(value: unknown): value is { children: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const children = (value as { children?: unknown }).children;
  return Array.isArray(children) && children.every(id => typeof id === "string") &&
    new Set(children).size === children.length;
}

function entryWithId(id: string, value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && "id" in value && value.id === id;
}

export function validAssetEntry(id: string, value: unknown): boolean {
  return safeCollectionId(id) && entryWithId(id, value) && typeof value.name === "string" &&
    (value.dataUrl == null || typeof value.dataUrl === "string") &&
    (value.path == null || typeof value.path === "string") &&
    (value.mimeType == null || typeof value.mimeType === "string");
}

export function validComponentEntry(id: string, value: unknown): value is { rootId: string } {
  return safeCollectionId(id) && entryWithId(id, value) && typeof value.name === "string" && typeof value.rootId === "string";
}

export function validNodeForest(pages: Record<string, unknown>, nodes: Record<string, unknown>, components?: unknown): boolean {
  const parents = new Set<string>();
  const parentOf = new Map<string, string>();
  const edges = new Map<string, string[]>();
  for (const [id, node] of Object.entries(nodes)) {
    if (!safeCollectionId(id) || !hasValidChildren(node) || !("id" in node) || node.id !== id) return false;
    edges.set(id, node.children);
    for (const child of node.children) {
      if (parents.has(child) || !Object.hasOwn(nodes, child)) return false;
      parents.add(child);
      parentOf.set(child, id);
    }
  }

  const owned = new Set(parents);
  for (const [id, page] of Object.entries(pages)) {
    if (!safeCollectionId(id) || !entryWithId(id, page) || typeof page.slug !== "string" || !hasValidChildren(page) || !page.children.every(id => edges.has(id))) return false;
    for (const child of page.children) {
      if (owned.has(child)) return false;
      owned.add(child);
    }
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
  if (visited !== edges.size) return false;

  // Clipboard fragments can be validated without their component definitions.
  // Complete documents pass an explicit component map, including an empty one.
  if (components == null) return true;
  if (typeof components !== "object" || Array.isArray(components)) return false;
  const definitions = components as Record<string, unknown>;
  const roots = new Map<string, string>();
  const dependencies = new Map<string, Set<string>>();
  for (const [id, value] of Object.entries(definitions)) {
    if (!safeCollectionId(id) || !validComponentEntry(id, value) || !edges.has(value.rootId) ||
        roots.has(value.rootId)) return false;
    roots.set(value.rootId, id);
    dependencies.set(id, new Set());
  }

  // A master tree belongs to exactly one component. In particular, a second
  // master must not be nested under the first (both would render the same nodes).
  for (const root of roots.keys()) {
    let ancestor = parentOf.get(root);
    while (ancestor) {
      if (roots.has(ancestor)) return false;
      ancestor = parentOf.get(ancestor);
    }
  }
  for (const node of Object.values(nodes)) {
    const value = node as Record<string, unknown>;
    if (value.type === "instance" &&
        (typeof value.componentId !== "string" || !Object.hasOwn(definitions, value.componentId))) {
      return false;
    }
  }

  // Component instances introduce a second directed graph, independent of the
  // ordinary parent/child tree. Walk it iteratively so deep, valid documents
  // do not exhaust the JS call stack.
  for (const [root, owner] of roots) {
    const pending = [root];
    while (pending.length) {
      const id = pending.pop()!;
      const node = nodes[id] as Record<string, unknown>;
      if (node.type === "instance") dependencies.get(owner)!.add(node.componentId as string);
      for (const child of edges.get(id)!) pending.push(child);
    }
  }
  const incoming = new Map<string, number>([...dependencies.keys()].map(id => [id, 0] as const));
  for (const targets of dependencies.values()) {
    for (const id of targets) incoming.set(id, incoming.get(id)! + 1);
  }
  const pending = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let processed = 0;
  while (pending.length) {
    processed++;
    for (const id of dependencies.get(pending.pop()!)!) {
      const next = incoming.get(id)! - 1;
      incoming.set(id, next);
      if (next === 0) pending.push(id);
    }
  }
  return processed === dependencies.size;
}

/** Shared integrity check for server saves and browser-cache reopening. */
export function validSiteDoc(parsed: unknown): boolean {
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (!record(parsed) || typeof parsed.siteName !== "string" ||
      !record(parsed.pages) || !record(parsed.nodes) || !record(parsed.assets) ||
      !Array.isArray(parsed.pageOrder) || !parsed.pageOrder.length) return false;
  if (!Object.entries(parsed.assets).every(([id, asset]) => validAssetEntry(id, asset)) ||
      !validNodeForest(parsed.pages, parsed.nodes, parsed.components ?? {})) return false;
  const order = parsed.pageOrder;
  if (new Set(order).size !== order.length ||
      !order.every(id => typeof id === "string" && Object.hasOwn(parsed.pages as object, id))) {
    return false;
  }
  return true;
}
