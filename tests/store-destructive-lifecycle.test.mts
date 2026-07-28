import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { createInitialDoc, makeText } from "../lib/presets";
import { useDialogs, closeDialog } from "../lib/dialog";

function fixture() {
  const d = createInitialDoc();
  d.nodes.master = { ...makeText("selected words"), id: "master" };
  d.components = { reusable: { id: "reusable", name: "Reusable", rootId: "master" } };
  useEditor.getState().replaceDoc(d);
  return d;
}

for (const change of ["unchanged", "remote", "replace", "undo", "decline"] as const) {
  test(`master-root Delete confirmation handles ${change}`, async () => {
    const original = fixture();
    useEditor.getState().deleteNodes(["master"]);
    const dialog = useDialogs.getState().queue.at(-1)!;
    assert.equal(dialog.kind, "confirm");
    if (change === "remote") useEditor.getState().applyRemoteDoc({ ...original, siteName: "Remote changes" });
    if (change === "replace") useEditor.getState().replaceDoc(structuredClone(original));
    if (change === "undo") {
      useEditor.getState().updateDoc(d => { d.siteName = "changed"; });
      useEditor.getState().undo();
      assert.equal(useEditor.getState().doc, original);
    }
    const before = useEditor.getState().doc;
    if (dialog.kind === "confirm") dialog.resolve(change !== "decline");
    closeDialog(dialog.id);
    await new Promise(resolve => setImmediate(resolve));
    if (change === "unchanged") {
      assert.equal(useEditor.getState().doc.components!.reusable, undefined);
      useEditor.getState().undo();
      assert.deepEqual(useEditor.getState().doc, original);
    } else assert.equal(useEditor.getState().doc, before);
  });
}

test("document replacement keeps valid node selection but discards old text ranges", () => {
  const doc = fixture();
  useEditor.getState().select("master");
  useEditor.getState().setTextSel({ nodeId: "master", start: 0, end: 8, text: "selected" });
  useEditor.getState().replaceDoc(structuredClone(doc));
  assert.equal(useEditor.getState().selection, "master");
  assert.equal(useEditor.getState().textSel, null);
  assert.deepEqual(useEditor.getState().doc, doc);
});
