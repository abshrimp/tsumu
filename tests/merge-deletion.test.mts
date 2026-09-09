import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Test", assets: {},
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["a", "outside"] },
      q: { id: "q", name: "Other", slug: "other", title: "", description: "", children: [] },
    },
    pageOrder: ["p", "q"],
    nodes: {
      a: { ...makeBox(), id: "a", children: ["b", "sibling"] },
      b: { ...makeBox(), id: "b", children: ["leaf"] },
      leaf: { ...makeBox(), id: "leaf", text: { content: "Original", heading: 0 } },
      sibling: { ...makeBox(), id: "sibling" },
      outside: { ...makeBox(), id: "outside" },
    },
  };
}

function deleted(base: SiteDoc, id: string): SiteDoc {
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [], editingComponentId: null });
  useEditor.getState().deleteNode(id);
  return structuredClone(useEditor.getState().doc);
}
function edited(base: SiteDoc): SiteDoc {
  const local = structuredClone(base);
  local.nodes.leaf.text!.content = "Unsaved edit";
  return local;
}
function assertTree(doc: SiteDoc) {
  const all = [...Object.values(doc.pages), ...Object.values(doc.nodes)];
  const owners = new Map<string, string>();
  for (const item of all) for (const child of item.children) {
    assert.ok(doc.nodes[child], "missing child " + child);
    assert.ok(!owners.has(child), "multiple parents for " + child);
    owners.set(child, item.id);
  }
  const walk = (id: string, ancestors: Set<string>) => {
    assert.ok(!ancestors.has(id), "cycle at " + id);
    for (const child of doc.nodes[id]?.children ?? []) walk(child, new Set([...ancestors, id]));
  };
  for (const id of Object.keys(doc.nodes)) walk(id, new Set());
}

for (const target of ["leaf", "b", "a"]) {
  test("local edit survives remote deletion of " + target + " with its necessary ancestors", () => {
    const base = fixture();
    const local = edited(base);
    const remote = deleted(base, target);
    const originals = structuredClone([base, local, remote]);
    const merged = mergeDocs(base, local, remote);
    assert.deepEqual(merged.pages.p.children, ["a", "outside"]);
    assert.deepEqual(merged.nodes.a.children, target === "a" ? ["b"] : ["b", "sibling"]);
    assert.deepEqual(merged.nodes.b.children, ["leaf"]);
    assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
    if (target === "a") assert.equal(merged.nodes.sibling, undefined);
    assert.deepEqual([base, local, remote], originals);
    assertTree(merged);
  });

  test("local deletion of " + target + " wins over the remote descendant edit", () => {
    const base = fixture();
    const merged = mergeDocs(base, deleted(base, target), edited(base));
    assert.equal(merged.nodes[target], undefined);
    assert.equal(merged.nodes.leaf, undefined);
    assertTree(merged);
  });
}

test("deletion alone does not restore an unchanged subtree", () => {
  const base = fixture();
  const remote = deleted(base, "a");
  const merged = mergeDocs(base, structuredClone(base), remote);
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assert.deepEqual(Object.keys(merged.nodes), ["outside"]);
  assertTree(merged);
});

test("editing a descendant of a deleted page restores only its necessary tree", () => {
  const base = fixture();
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [] });
  useEditor.getState().deletePage("p");
  const remote = structuredClone(useEditor.getState().doc);
  const merged = mergeDocs(base, edited(base), remote);
  assert.ok(merged.pageOrder.includes("p"));
  assert.deepEqual(merged.pages.p.children, ["a"]);
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.equal(merged.nodes.sibling, undefined);
  assert.equal(merged.nodes.outside, undefined);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assertTree(merged);
});

function componentFixture(): SiteDoc {
  const base = fixture();
  base.pages.p.children = ["instance", "outside"];
  base.components = { card: { id: "card", name: "Card", rootId: "a" } };
  base.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "card", styles: {} };
  return base;
}
function deleteComponent(base: SiteDoc): SiteDoc {
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [] });
  useEditor.getState().deleteComponent("card");
  return structuredClone(useEditor.getState().doc);
}

test("edited master descendants remain reachable through the restored component definition", () => {
  const base = componentFixture();
  const merged = mergeDocs(base, edited(base), deleteComponent(base));
  assert.equal(merged.components!.card.rootId, "a");
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assert.equal(merged.nodes.instance, undefined);
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("an edited instance keeps the master required to render it", () => {
  const base = componentFixture();
  const local = structuredClone(base);
  local.nodes.instance.hiddenOn = ["sm"];
  const merged = mergeDocs(base, local, deleteComponent(base));
  assert.deepEqual(merged.pages.p.children, ["instance", "outside"]);
  assert.deepEqual(merged.nodes.instance.hiddenOn, ["sm"]);
  assert.equal(merged.components!.card.rootId, "a");
  assert.deepEqual(merged.nodes.a.children, ["b", "sibling"]);
  assert.equal(merged.nodes.leaf.text!.content, "Original");
  assertTree(merged);
});

test("local component deletion still wins over a remote master edit", () => {
  const base = componentFixture();
  const merged = mergeDocs(base, deleteComponent(base), edited(base));
  assert.equal(merged.components!.card, undefined);
  assert.equal(merged.nodes.a, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assertTree(merged);
});

test("restoring ancestor paths does not interfere with conflicting move cycle repair", () => {
  const base = fixture();
  base.pages.p.children.push("other");
  base.nodes.other = { ...makeBox(), id: "other" };
  const local = edited(base);
  local.pages.p.children = ["a", "outside"];
  local.nodes.a.children.push("other");
  const remote = deleted(base, "b");
  remote.pages.p.children = ["outside", "other"];
  remote.nodes.other.children = ["a"];
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assert.ok(merged.nodes.a.children.includes("b"));
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assertTree(merged);
});

test("an existing ancestor follows its remote move without restoring its old deleted page", () => {
  const base = fixture();
  const local = edited(base);
  const remote = deleted(base, "b");
  remote.pages.q.children = ["a"];
  remote.pages.p.children = [];
  delete remote.pages.p;
  remote.pageOrder = ["q"];
  delete remote.nodes.outside;
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pages.p, undefined);
  assert.deepEqual(merged.pageOrder, ["q"]);
  assert.deepEqual(merged.pages.q.children, ["a"]);
  assert.deepEqual(merged.nodes.a.children, ["b", "sibling"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assertTree(merged);
});

test("a local addition inside a deleted subtree remains attached without restoring old siblings", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.nodes.b.children.push("new");
  local.nodes.new = { ...makeBox(), id: "new" };
  const merged = mergeDocs(base, local, deleted(base, "a"));
  assert.deepEqual(merged.pages.p.children, ["a", "outside"]);
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["new"]);
  assert.equal(merged.nodes.leaf, undefined);
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("local component metadata edits preserve the required root and honor locally deleted children", () => {
  const base = componentFixture();
  const local = structuredClone(base);
  local.components!.card.name = "Renamed";
  delete local.nodes.sibling;
  local.nodes.a.children = ["b"];
  const merged = mergeDocs(base, local, deleteComponent(base));
  assert.equal(merged.components!.card.name, "Renamed");
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.equal(merged.nodes.sibling, undefined);
  assert.equal(merged.nodes.leaf.text!.content, "Original");
  assertTree(merged);
});

function move(base: SiteDoc, id: string, parent: string): SiteDoc {
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [], editingComponentId: null });
  useEditor.getState().moveNode(id, { kind: "node", id: parent }, 0);
  return structuredClone(useEditor.getState().doc);
}

test("a move-only local leaf edit survives remote deletion at its new parent", () => {
  const base = fixture();
  const local = move(base, "leaf", "outside");
  assert.deepEqual(local.nodes.leaf, base.nodes.leaf, "a move changes only parent child lists");
  const remote = deleted(base, "leaf");
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.outside.children, ["leaf"]);
  assert.deepEqual(merged.nodes.b.children, []);
  assert.deepEqual(merged.nodes.leaf, base.nodes.leaf);
  assert.deepEqual([base, local, remote], originals);
  assertTree(merged);
});

test("moving a subtree preserves its unchanged contents after remote subtree deletion", () => {
  const base = fixture();
  const local = move(base, "b", "outside");
  const merged = mergeDocs(base, local, deleted(base, "a"));
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assert.equal(merged.nodes.a, undefined, "the emptied source parent stays deleted");
  assert.deepEqual(merged.nodes.outside.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Original");
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("local deletion wins over a move-only remote edit", () => {
  const base = fixture();
  const merged = mergeDocs(base, deleted(base, "b"), move(base, "b", "outside"));
  assert.equal(merged.nodes.b, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.nodes.outside.children, []);
  assertTree(merged);
});

test("restoring moved contents does not bring back locally deleted descendants", () => {
  const base = fixture();
  base.nodes.b.children.push("removed");
  base.nodes.removed = { ...makeBox(), id: "removed" };
  const local = move(deleted(base, "removed"), "b", "outside");
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.deepEqual(merged.nodes.outside.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.removed, undefined);
  assertTree(merged);
});

test("an untouched node is not resurrected merely because its sibling was moved", () => {
  const base = fixture();
  const local = move(base, "sibling", "outside");
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.equal(merged.nodes.b, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.nodes.outside.children, ["sibling"]);
  assertTree(merged);
});

test("local child deletion does not resurrect its remotely deleted empty parent", () => {
  const base = fixture();
  const local = deleted(base, "leaf");
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.equal(merged.nodes.b, undefined);
  assert.equal(merged.nodes.leaf, undefined);
  assert.deepEqual(merged.nodes.a.children, ["sibling"]);
  assertTree(merged);
});

test("local child removals do not restore a remotely deleted page", () => {
  const base = fixture();
  const local = deleted(deleted(base, "a"), "outside");
  useEditor.setState({ doc: structuredClone(base), activePageId: "p", past: [], future: [] });
  useEditor.getState().deletePage("p");
  const merged = mergeDocs(base, local, structuredClone(useEditor.getState().doc));
  assert.equal(merged.pages.p, undefined);
  assert.deepEqual(merged.pageOrder, ["q"]);
  assert.deepEqual(merged.nodes, {});
  assertTree(merged);
});

test("removal-only ancestors are restored when a surviving descendant actually needs them", () => {
  const base = fixture();
  const local = edited(deleted(base, "sibling"));
  const merged = mergeDocs(base, local, deleted(base, "a"));
  assert.deepEqual(merged.pages.p.children, ["a", "outside"]);
  assert.deepEqual(merged.nodes.a.children, ["b"]);
  assert.deepEqual(merged.nodes.b.children, ["leaf"]);
  assert.equal(merged.nodes.leaf.text!.content, "Unsaved edit");
  assert.equal(merged.nodes.sibling, undefined);
  assertTree(merged);
});

test("a real parent property edit survives even when its children were also removed", () => {
  const base = fixture();
  const local = deleted(base, "leaf");
  local.nodes.b.name = "Renamed";
  const merged = mergeDocs(base, local, deleted(base, "b"));
  assert.equal(merged.nodes.b.name, "Renamed");
  assert.deepEqual(merged.nodes.b.children, []);
  assert.ok(merged.nodes.a.children.includes("b"));
  assertTree(merged);
});

test("remote additions keep their relative order around locally reordered siblings", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.pages.p.children.reverse();
  const remote = structuredClone(base);
  for (const id of ["leading", "first", "second", "trailing"]) {
    remote.nodes[id] = { ...makeBox(), id };
  }
  remote.pages.p.children = ["leading", "a", "first", "second", "outside", "trailing"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.pages.p.children, ["first", "second", "outside", "leading", "a", "trailing"]);
  assertTree(merged);
});
