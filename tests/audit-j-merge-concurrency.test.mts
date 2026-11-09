import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import { validateImportedDoc } from "../lib/site-import";
import { validNodeForest } from "../lib/doc-tree";
import type { SiteDoc } from "../lib/types";

const SEED = 0x4a202611;
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}
function fixture(): SiteDoc {
  return {
    siteName: "Concurrent Site",
    pageOrder: ["home", "about"],
    pages: {
      home: { id: "home", name: "Home", slug: "", children: ["a"] },
      about: { id: "about", name: "About", slug: "about", children: ["b"] },
    },
    nodes: {
      a: { id: "a", type: "text", name: "A", children: [], text: "A", style: {} },
      b: { id: "b", type: "text", name: "B", children: [], text: "B", style: {} },
    },
    assets: {},
  } as SiteDoc;
}
const changes: ((doc: SiteDoc) => void)[] = [
  // Move across pages while the other user may move the sibling.
  doc => { doc.pages.home.children = []; doc.pages.about.children.push("a"); },
  doc => { doc.pages.about.children = []; doc.pages.home.children.push("b"); },
  // Opposing ancestor moves are individually valid but can form a cycle when merged.
  doc => { doc.pages.home.children = []; doc.nodes.b.children = ["a"]; },
  doc => { doc.pages.about.children = []; doc.nodes.a.children = ["b"]; },
  doc => { doc.nodes.a.text = "local update"; },
  doc => { doc.nodes.b.text = "remote update"; },
  doc => { doc.pages.home.children = []; delete doc.nodes.a; },
  doc => { doc.pages.about.children = []; delete doc.nodes.b; },
  doc => { delete doc.pages.home; doc.pageOrder = ["about"]; },
  doc => { delete doc.pages.about; doc.pageOrder = ["home"]; },
  doc => {
    doc.nodes.c = { ...doc.nodes.a, id: "c", children: [], text: "new node" };
    doc.pages.home.children.push("c");
  },
  doc => {
    doc.nodes.d = { ...doc.nodes.b, id: "d", children: [], text: "new node" };
    doc.pages.about.children.push("d");
  },
];

test("AUD-J-011: concurrent independent valid edits never produce a cyclic or invalid merged document", () => {
  const next = seeded(SEED ^ 0x1111);
  for (let i = 0; i < 240; i++) {
    const base = fixture();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    const first = next() % changes.length;
    const second = next() % changes.length;
    changes[first](local);
    changes[second](remote);
    assert.doesNotThrow(() => validateImportedDoc(local), "seed=" + SEED + " local=" + first);
    assert.doesNotThrow(() => validateImportedDoc(remote), "seed=" + SEED + " remote=" + second);
    const merged = mergeDocs(base, local, remote);
    assert.equal(merged.pageOrder.length > 0, true,
      "lost the last page; seed=" + SEED + " case=" + i + " ops=" + first + "," + second);
    assert.equal(validNodeForest(merged.pages, merged.nodes, merged.components), true,
      "invalid node forest; seed=" + SEED + " case=" + i + " ops=" + first + "," + second);
    assert.doesNotThrow(() => validateImportedDoc(merged),
      "invalid document; seed=" + SEED + " case=" + i + " ops=" + first + "," + second);
  }
});

test("AUD-J-012: opposing moves across parent trees cannot introduce a merge-only cycle", () => {
  const base = fixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  changes[2](local);
  changes[3](remote);
  assert.doesNotThrow(() => validateImportedDoc(local));
  assert.doesNotThrow(() => validateImportedDoc(remote));
  const merged = mergeDocs(base, local, remote);
  assert.equal(validNodeForest(merged.pages, merged.nodes, merged.components), true);
  assert.doesNotThrow(() => validateImportedDoc(merged));
});
