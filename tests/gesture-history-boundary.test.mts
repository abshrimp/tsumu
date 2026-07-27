import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

const state = () => useEditor.getState();
function open() {
  state().endGesture();
  const doc: SiteDoc = {
    siteName: "Gesture history", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", name: "Original" } },
  };
  state().replaceDoc(doc);
}

for (const action of ["undo", "redo"] as const) {
  test(`${action} ends the previous gesture and subsequent changes remain undoable`, () => {
    open();
    const finish = state().beginGesture();
    state().updateNode("a", { name: "First" });
    if (action === "redo") {
      finish();
      state().undo();
      state().beginGesture();
    }
    state()[action]();
    const boundary = state().doc.nodes.a.name;
    assert.equal(state().gestureActive, false);
    state().updateNode("a", { name: "Second" });
    finish();
    assert.equal(state().future.length, 0, "a new edit must discard stale redo history");
    state().undo();
    assert.equal(state().doc.nodes.a.name, boundary);
    state().redo();
    assert.equal(state().doc.nodes.a.name, "Second");
  });

  test(`${action} invalidates old release callbacks without ending a newer gesture`, () => {
    open();
    state().updateNode("a", { name: "First" });
    if (action === "redo") state().undo();
    const oldFinish = state().beginGesture();
    const overlappingFinish = state().beginGesture();
    state()[action]();
    const boundary = state().doc.nodes.a.name;
    const newFinish = state().beginGesture();
    state().updateNode("a", { name: "Second" });
    oldFinish();
    overlappingFinish();
    assert.equal(state().gestureActive, true);
    state().updateNode("a", { name: "Third" });
    newFinish();
    assert.equal(state().gestureActive, false);
    state().undo();
    assert.equal(state().doc.nodes.a.name, boundary, "the new gesture is one undo step");
    state().redo();
    assert.equal(state().doc.nodes.a.name, "Third");
  });

  test(`${action} with no history still ends the gesture before the next edit`, () => {
    open();
    const finish = state().beginGesture();
    state()[action]();
    assert.equal(state().gestureActive, false);
    state().updateNode("a", { name: "Changed" });
    finish();
    state().undo();
    assert.equal(state().doc.nodes.a.name, "Original");
  });
}
