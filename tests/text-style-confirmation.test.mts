import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { makeText } from "../lib/presets";
import { importCallbacks } from "./helpers/pending-import";
import { textStyleConfirmationDoc } from "./helpers/text-style-confirmation";

const state = () => useEditor.getState();
const selected = () => ({ nodeId: "a", start: 5, end: 9, text: "echo" });
function fixture() {
  state().replaceDoc(textStyleConfirmationDoc());
  state().setActivePage("p"); state().setMode("design"); state().setBreakpoint("base");
  state().select("a"); state().setRightTab("style"); state().setTextSel(selected());
  const ui = importCallbacks("style");
  const render = () => ui.render({ nodeId: state().selection ?? "a" });
  const change = (props = { fontStyle: "italic" }) => render().props.value.set(props);
  return { ui, render, change };
}
const snapshot = () => {
  const { doc, past, future, selection, selectedIds, textSel } = state();
  return structuredClone({ doc, past, future, selection, selectedIds, textSel });
};
async function resolve(f: ReturnType<typeof fixture>, ok: boolean, index = 0) {
  f.ui.confirmations[index].resolve(ok);
  await Promise.resolve();
}

for (const ok of [true, false]) {
  for (const interruption of [
    "remote-text", "remote-move-match", "remote-unrelated", "local-text", "children", "delete",
    "undo", "undo-redo", "replace", "restore", "page", "page-return", "selection", "selection-return",
    "breakpoint", "breakpoint-return", "state", "state-return", "new-range", "unmount",
  ]) test(`${ok ? "split" : "whole-text"} approval ignores obsolete ${interruption}`, async () => {
    const f = fixture();
    try {
      // 「元に戻す」の前後で本文が同じでも、前の確認を復活させない。
      state().updateNode("a", { name: "Undo this" });
      f.change();
      assert.equal(f.ui.confirmations.length, 1);
      if (interruption.startsWith("remote")) {
        const remote = structuredClone(state().doc);
        if (interruption === "remote-text") remote.nodes.a.text!.content = "echo gone";
        if (interruption === "remote-move-match") remote.nodes.a.text!.content = "new echo echo";
        if (interruption === "remote-unrelated") remote.nodes.b.name = "Collaborator renamed this";
        state().applyRemoteDoc(remote);
      }
      if (interruption === "local-text") state().updateNode("a", { text: { content: "echo gone", heading: 0 } });
      if (interruption === "children") state().updateDoc(d => {
        d.nodes.child = { ...makeText("Keep this child"), id: "child", semantic: "span" };
        d.nodes.a.children = ["child"];
      });
      if (interruption === "delete") state().deleteNodes(["a"]);
      if (interruption.startsWith("undo")) state().undo();
      if (interruption === "undo-redo") state().redo();
      if (interruption === "replace") state().replaceDoc(structuredClone(state().doc));
      if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
      if (interruption.startsWith("page")) state().setActivePage("q");
      if (interruption === "page-return") { f.render(); state().setActivePage("p"); state().select("a"); }
      if (interruption.startsWith("selection")) state().select("b");
      if (interruption === "selection-return") { f.render(); state().select("a"); }
      if (interruption.startsWith("breakpoint")) state().setBreakpoint("sm");
      if (interruption === "breakpoint-return") { f.render(); state().setBreakpoint("base"); }
      if (interruption.startsWith("state")) state().setStyleState("hover");
      if (interruption === "state-return") { f.render(); state().setStyleState("default"); }
      if (interruption === "new-range") state().setTextSel({ nodeId: "a", start: 0, end: 4, text: "echo" });
      if (interruption === "unmount") f.ui.unmount();
      const before = snapshot();
      // 最新のストアを確かめるため、上の一部は再描画の前に解決する。
      await resolve(f, ok);
      assert.deepEqual(snapshot(), before);
    } finally { f.ui.unmount(); }
  });

  test(`${ok ? "split" : "whole-text"} approval preserves unrelated local edits and one undo step`, async () => {
    const f = fixture();
    try {
      f.change();
      state().updateDoc(d => {
        d.nodes.a.name = "Renamed while waiting";
        d.nodes.a.styles.base!.default!.padding = "8px";
        d.nodes.b.text!.content = "Other updated text";
      });
      f.render();
      const before = structuredClone(state().doc);
      const past = state().past.length;
      await resolve(f, ok);
      const after = structuredClone(state().doc);
      assert.equal(after.nodes.a.name, before.nodes.a.name);
      assert.equal(after.nodes.a.styles.base!.default!.padding, "8px");
      assert.deepEqual(after.nodes.b, before.nodes.b);
      if (ok) {
        const parts = after.nodes.a.children.map(id => after.nodes[id]);
        assert.deepEqual(parts.map(n => n.text!.content), ["echo ", "echo"]);
        assert.deepEqual(parts.map(n => n.styles.base?.default?.fontStyle), [undefined, "italic"]);
        assert.equal(after.nodes.a.styles.base!.default!.fontStyle, undefined);
      } else {
        assert.equal(after.nodes.a.text!.content, "echo echo");
        assert.deepEqual(after.nodes.a.children, []);
        assert.equal(after.nodes.a.styles.base!.default!.fontStyle, "italic");
      }
      assert.equal(state().past.length, past + 1);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, after);
    } finally { f.ui.unmount(); }
  });
}

test("a new formatting request supersedes an older pending confirmation", async () => {
  const f = fixture();
  try {
    f.change(); f.change({ fontStyle: "oblique" });
    const before = snapshot();
    await resolve(f, true, 0);
    assert.deepEqual(snapshot(), before);
    await resolve(f, true, 1);
    assert.equal(state().doc.nodes[state().selection!].styles.base!.default!.fontStyle, "oblique");
    assert.equal(state().past.length, 1);
  } finally { f.ui.unmount(); }
});

test("a failed split never falls back to styling the whole text", async () => {
  const f = fixture();
  try {
    state().setTextSel({ nodeId: "a", start: 5, end: 9, text: "missing" });
    f.change();
    const before = snapshot();
    await resolve(f, true);
    assert.deepEqual(snapshot(), before);
  } finally { f.ui.unmount(); }
});

for (const [content, start, end, text] of [
  ["echo gone", 5, 9, "echo"], ["new echo echo", 5, 9, "echo"], ["echo echo", -4, 9, "echo"],
  ["echo echo", 5, 20, "echo"], ["echo echo", 0, 9, "echo echo"], ["echo echo", 0, 0, ""],
] as const) test(`the store refuses invalid split ${JSON.stringify([content, start, end, text])}`, () => {
  const f = fixture();
  try {
    state().updateNode("a", { text: { content, heading: 0 } });
    const before = snapshot();
    assert.equal(state().splitTextSpan("a", start, end, text, { fontStyle: "italic" }), null);
    assert.deepEqual(snapshot(), before);
  } finally { f.ui.unmount(); }
});

test("an identical selection notification does not invalidate an unchanged request", async () => {
  const f = fixture();
  try {
    f.change(); state().setTextSel(selected()); f.render();
    await resolve(f, true);
    const parts = state().doc.nodes.a.children.map(id => state().doc.nodes[id]);
    assert.deepEqual(parts.map(n => n.text!.content), ["echo ", "echo"]);
    assert.equal(parts[1].styles.base!.default!.fontStyle, "italic");
  } finally { f.ui.unmount(); }
});
