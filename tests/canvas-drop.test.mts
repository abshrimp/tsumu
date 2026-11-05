import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasFallbackDrop } from "../lib/canvas-drop";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(master = true, children = ["a", "b", "c"]): SiteDoc {
  const doc: SiteDoc = {
    siteName: "Canvas drop",
    pages: {
      p: {
        id: "p", name: "Home", slug: "", title: "Home",
        description: "", children: master ? [] : [...children],
      },
    },
    pageOrder: ["p"],
    nodes: Object.fromEntries(
      children.map((id) => [id, { ...makeBox(), id }]),
    ),
    assets: {},
  };
  if (master) {
    doc.nodes.root = {
      ...makeBox(), id: "root", children: [...children],
    };
    doc.components = {
      comp: { id: "comp", name: "Component", rootId: "root" },
    };
  }
  return doc;
}

function moveOnBlank(ids: string[], master = true) {
  const state = useEditor.getState();
  const drop = canvasFallbackDrop(
    state.doc,
    master ? state.doc.components!.comp : null,
    "p",
  );
  state.moveNodes(ids, drop.parent, drop.index);
}

for (const children of [[], ["a"], ["a", "b", "c"]]) {
  test(`master fallback counts ${children.length} actual children`, () => {
    const doc = fixture(true, children);
    assert.deepEqual(canvasFallbackDrop(doc, doc.components!.comp, "p"), {
      parent: { kind: "node", id: "root" },
      index: children.length,
    });
  });
}

test("page fallback counts page children", () => {
  const doc = fixture(false);
  for (const component of [null, undefined]) {
    assert.deepEqual(canvasFallbackDrop(doc, component, "p"), {
      parent: { kind: "page", id: "p" },
      index: 3,
    });
  }
});

const cases = [
  { ids: ["a"], expected: ["b", "c", "a"] },
  { ids: ["b"], expected: ["a", "c", "b"] },
  { ids: ["c"], expected: ["a", "b", "c"] },
  { ids: ["c", "a"], expected: ["b", "a", "c"] },
  { ids: ["b", "a"], expected: ["c", "a", "b"] },
];

for (const { ids, expected } of cases) {
  test(`blank master drop appends ${ids.join(",")} in document order`, () => {
    useEditor.getState().replaceDoc(fixture());
    moveOnBlank(ids);
    assert.deepEqual(useEditor.getState().doc.nodes.root.children, expected);
    assert.deepEqual(useEditor.getState().doc.pages.p.children, []);
  });
}

test("blank master drop moves a nested child to the end and can undo", () => {
  const doc = fixture();
  doc.nodes.d = { ...makeBox(), id: "d" };
  doc.nodes.a.children = ["d"];
  useEditor.getState().replaceDoc(doc);
  const before = structuredClone(useEditor.getState().doc);
  moveOnBlank(["d"]);
  assert.deepEqual(useEditor.getState().doc.nodes.root.children, ["a", "b", "c", "d"]);
  assert.deepEqual(useEditor.getState().doc.nodes.a.children, []);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
});

test("blank page drop still appends", () => {
  useEditor.getState().replaceDoc(fixture(false));
  moveOnBlank(["a"], false);
  assert.deepEqual(useEditor.getState().doc.pages.p.children, ["b", "c", "a"]);
});

test("blank master drop cannot move the master root into itself", () => {
  useEditor.getState().replaceDoc(fixture());
  const before = structuredClone(useEditor.getState().doc);
  moveOnBlank(["root"]);
  assert.deepEqual(useEditor.getState().doc, before);
});

test("missing fallback destinations remain harmless", () => {
  const doc = fixture();
  const missing = { id: "missing", name: "Missing", rootId: "missing" };
  for (const component of [null, missing]) {
    const drop = canvasFallbackDrop(doc, component, "missing");
    assert.equal(drop.index, 0);
    useEditor.getState().replaceDoc(doc);
    const before = structuredClone(useEditor.getState().doc);
    useEditor.getState().moveNodes(["a"], drop.parent, drop.index);
    assert.deepEqual(useEditor.getState().doc, before);
  }
});
