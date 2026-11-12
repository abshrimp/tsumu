import assert from "node:assert/strict";
import { test } from "node:test";
import { componentOf } from "../lib/store";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });

function fixture(): SiteDoc {
  return {
    schemaVersion: 1,
    siteName: "Component ownership",
    assets: {},
    pageOrder: ["p"],
    pages: {
      p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["ordinary"] },
    },
    nodes: {
      ordinary: node("ordinary"),
      outer: node("outer", ["middle"]),
      middle: node("middle", ["inner"]),
      inner: node("inner", ["leaf"]),
      leaf: node("leaf"),
      unattached: node("unattached"),
    },
    components: {
      outerComponent: { id: "outerComponent", name: "Outer", rootId: "outer" },
      innerComponent: { id: "innerComponent", name: "Inner", rootId: "inner" },
    },
  };
}

test("component ownership keeps the original component-order precedence", () => {
  const doc = fixture();
  assert.equal(componentOf(doc, "outer"), "outerComponent");
  assert.equal(componentOf(doc, "middle"), "outerComponent");
  assert.equal(componentOf(doc, "inner"), "outerComponent");
  assert.equal(componentOf(doc, "leaf"), "outerComponent");
  assert.equal(componentOf(doc, "ordinary"), null);
  assert.equal(componentOf(doc, "unattached"), null);
  assert.equal(componentOf(doc, "missing"), null);

  // コンポーネントのルートは、近いマスターから順ではなく、保存されている順に調べる。
  // 順序を入れ替えても、この動作を保つ。
  doc.components = {
    innerComponent: doc.components!.innerComponent,
    outerComponent: doc.components!.outerComponent,
  };
  assert.equal(componentOf(doc, "leaf"), "innerComponent");
  assert.equal(componentOf(doc, "middle"), "outerComponent");
});

test("page-level parent selection takes precedence over node parents", () => {
  const doc = fixture();
  doc.pages.p.children.push("leaf");
  assert.equal(componentOf(doc, "leaf"), null);
  assert.equal(componentOf(doc, "inner"), "outerComponent");
});

test("ownership resolution remains bounded when malformed nodes form a cycle", () => {
  const doc = fixture();
  doc.nodes.outer.children = ["middle"];
  doc.nodes.middle.children = ["outer"];
  doc.components = {
    unrelated: { id: "unrelated", name: "Unrelated", rootId: "unattached" },
    outerComponent: doc.components!.outerComponent,
  };
  assert.equal(componentOf(doc, "outer"), "outerComponent");
  assert.equal(componentOf(doc, "middle"), "outerComponent");
});

test("large documents with many masters retain correct ownership and no mutation", () => {
  const doc = fixture();
  const original = doc.nodes.ordinary;
  for (let i = 0; i < 600; i++) {
    const root = "master-" + i;
    doc.nodes[root] = node(root, ["child-" + i]);
    doc.nodes["child-" + i] = node("child-" + i);
    doc.components!["component-" + i] = { id: "component-" + i, name: "Master", rootId: root };
  }
  for (let i = 0; i < 40; i++) {
    assert.equal(componentOf(doc, "child-599"), "component-599");
  }
  assert.strictEqual(doc.nodes.ordinary, original);
});
