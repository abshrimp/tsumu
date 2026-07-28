import assert from "node:assert/strict";
import { test } from "node:test";
import { validNodeForest } from "../lib/doc-tree";
import { validateDocValue } from "../lib/doc-storage";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const node = (id: string) => ({ ...makeBox(), id });
function fixture(): SiteDoc {
  return {
    siteName: "Integrity",
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["home"],
    nodes: {},
    assets: {},
    components: {},
  };
}
function withMasters(): SiteDoc {
  const doc = fixture();
  doc.nodes.a = node("a");
  doc.nodes.b = node("b");
  doc.components = {
    A: { id: "A", name: "A", rootId: "a" },
    B: { id: "B", name: "B", rootId: "b" },
  };
  return doc;
}
function instance(id: string, componentId: string) {
  return { ...node(id), type: "instance" as const, componentId };
}

test("complete documents reject missing component references, including a missing component map", () => {
  const doc = fixture();
  doc.nodes.use = instance("use", "absent");
  doc.pages.home.children.push("use");
  assert.equal(validateDocValue(doc), "不正なリクエスト");
  delete doc.components;
  assert.equal(validateDocValue(doc), "不正なリクエスト");
  assert.equal(validNodeForest(doc.pages, doc.nodes), true, "clipboard fragments can lack definitions");
});

test("component definitions cannot share or nest their master trees", () => {
  const doc = withMasters();
  assert.equal(validateDocValue(doc), null);
  doc.components!.B.rootId = "a";
  assert.notEqual(validateDocValue(doc), null);
  doc.components!.B.rootId = "b";
  doc.nodes.a.children = ["b"];
  assert.notEqual(validateDocValue(doc), null);
});

test("component instances reject both direct and indirect reference cycles", () => {
  const doc = withMasters();
  doc.nodes.ab = instance("ab", "B");
  doc.nodes.a.children = ["ab"];
  assert.equal(validateDocValue(doc), null);
  const self = structuredClone(doc);
  self.nodes.ab.componentId = "A";
  assert.notEqual(validateDocValue(self), null);
  const mutual = structuredClone(doc);
  mutual.nodes.ba = instance("ba", "A");
  mutual.nodes.b.children = ["ba"];
  assert.notEqual(validateDocValue(mutual), null);
  const external = structuredClone(doc);
  external.nodes.use = instance("use", "A");
  external.pages.home.children.push("use");
  assert.equal(validateDocValue(external), null, "repeated use outside masters is valid");
});

test("structural collection IDs cannot shadow inherited object properties", () => {
  for (const collection of ["nodes", "pages", "assets", "components"] as const) {
    const doc = fixture() as any;
    const dangerous = "__proto__";
    if (collection === "nodes") doc.nodes = JSON.parse('{"__proto__":{"id":"__proto__","children":[]}}');
    if (collection === "pages") doc.pages = JSON.parse('{"home":{"id":"home","name":"Home","slug":"","children":[]},"__proto__":{"id":"__proto__","slug":"","children":[]}}');
    if (collection === "assets") doc.assets = JSON.parse('{"__proto__":{"id":"__proto__","name":"Asset"}}');
    if (collection === "components") {
      doc.nodes.root = node("root");
      doc.components = JSON.parse('{"__proto__":{"id":"__proto__","name":"C","rootId":"root"}}');
    }
    assert.notEqual(validateDocValue(doc), null, collection);
  }
});

test("long acyclic component dependency chains validate without recursive traversal", () => {
  const doc = fixture();
  for (let i = 0; i < 1500; i++) {
    const root = "r" + i;
    doc.nodes[root] = node(root);
    doc.components!["c" + i] = { id: "c" + i, name: "C", rootId: root };
    if (i) {
      const id = "i" + i;
      doc.nodes[id] = instance(id, "c" + i);
      doc.nodes["r" + (i - 1)].children.push(id);
    }
  }
  assert.equal(validateDocValue(doc), null);
});
