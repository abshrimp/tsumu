import assert from "node:assert/strict";
import { test } from "node:test";
import { validNodeForest } from "../lib/doc-tree";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

const SEED = 0x4a202611;
function random(seed: number) {
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
    siteName: "Editor history fixture",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home",
        description: "", children: ["original"],
      },
    },
    nodes: {
      original: {
        ...makeBox(), id: "original", name: "Original",
        attrId: "original-element",
      },
    },
    assets: {},
  };
}
function assertTree(doc: SiteDoc, caseIndex: number): void {
  const page = doc.pages.home;
  assert.equal(validNodeForest(doc.pages, doc.nodes, doc.components), true,
    "invalid node forest: seed=" + SEED + " case=" + caseIndex);
  assert.equal(new Set(page.children).size, page.children.length,
    "duplicate child ID: seed=" + SEED + " case=" + caseIndex);
  const ids = Object.keys(doc.nodes);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of page.children) {
    assert.ok(Object.hasOwn(doc.nodes, id), "dangling child: " + id);
    assert.equal(doc.nodes[id].id, id);
  }
}

test("duplicated nodes keep unique IDs through undo, redo and deletion", () => {
  const next = random(SEED ^ 0x1717);
  const state = () => useEditor.getState();
  for (let caseIndex = 0; caseIndex < 32; caseIndex++) {
    state().replaceDoc(fixture());
    const original = structuredClone(state().doc);
    const steps = 1 + next() % 9;
    for (let step = 0; step < steps; step++) {
      const existing = state().doc.pages.home.children;
      const id = existing[next() % existing.length];
      const beforeCount = Object.keys(state().doc.nodes).length;
      state().duplicateNode(id);
      assert.equal(Object.keys(state().doc.nodes).length, beforeCount + 1,
        "duplicate did not add exactly one node: case=" + caseIndex + " step=" + step);
      assertTree(state().doc, caseIndex);
    }
    const duplicated = structuredClone(state().doc);
    for (let step = 0; step < steps; step++) {
      state().undo();
      assertTree(state().doc, caseIndex);
    }
    assert.deepEqual(state().doc, original, "undo lost the original: case=" + caseIndex);
    for (let step = 0; step < steps; step++) {
      state().redo();
      assertTree(state().doc, caseIndex);
    }
    assert.deepEqual(state().doc, duplicated, "redo lost a duplicate: case=" + caseIndex);

    const children = state().doc.pages.home.children;
    const removedId = children[1 + next() % (children.length - 1)];
    state().deleteNode(removedId);
    const afterDelete = structuredClone(state().doc);
    assert.equal(Object.hasOwn(afterDelete.nodes, removedId), false,
      "deleted node remained in map: case=" + caseIndex);
    assert.equal(afterDelete.pages.home.children.includes(removedId), false,
      "deleted node remained in page: case=" + caseIndex);
    assertTree(afterDelete, caseIndex);

    state().undo();
    assert.deepEqual(state().doc, duplicated, "undo did not restore removed node");
    state().redo();
    assert.deepEqual(state().doc, afterDelete, "redo resurrected removed node");
    assertTree(state().doc, caseIndex);
  }
});
