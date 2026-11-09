import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { createInitialDoc } from "../lib/presets";
import { elements, importCallbacks } from "./helpers/pending-import";
const state = () => useEditor.getState();
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  state().replaceDoc(createInitialDoc());
  const ui = importCallbacks("backup");
  const input = () => elements(ui.render()).find(e => e.type === "input" && e.props.type === "file");
  const start = (name: string) => {
    let resolve!: (value: ArrayBuffer) => void;
    const data = { ...createInitialDoc(), siteName: name };
    const file = { arrayBuffer: () => new Promise<ArrayBuffer>(r => { resolve = r; }) };
    input().props.onChange({ target: { files: [file], value: "file.json" } });
    return () => resolve(new TextEncoder().encode(JSON.stringify(data)).buffer);
  };
  return { ui, start, render: input };
}
for (const phase of ["read", "confirm"] as const) for (const invalidate of ["undo", "replace", "unmount"] as const) {
  test(`backup ${phase} is invalidated by ${invalidate}`, async () => {
    const f = fixture();
    state().updateDoc(d => { d.siteName = "Current"; });
    const finish = f.start("Old backup");
    if (phase === "confirm") { finish(); await tick(); assert.equal(f.ui.confirmations.length, 1); }
    if (invalidate === "undo") state().undo();
    if (invalidate === "replace") state().replaceDoc({ ...createInitialDoc(), siteName: "Replacement" });
    if (invalidate === "unmount") f.ui.unmount();
    const before = state().doc;
    if (phase === "read") { finish(); await tick(); assert.equal(f.ui.confirmations.length, 0); }
    else { f.ui.confirmations[0].resolve(true); await tick(); }
    assert.equal(state().doc, before);
    f.ui.unmount();
  });
}
test("a newer backup selection supersedes an earlier file read and restores with undo", async () => {
  const f = fixture(); const before = state().doc;
  const old = f.start("Old backup"); const latest = f.start("Chosen backup");
  latest(); await tick(); old(); await tick();
  assert.equal(f.ui.confirmations.length, 1);
  f.ui.confirmations[0].resolve(true); await tick();
  assert.equal(state().doc.siteName, "Chosen backup");
  state().undo(); assert.deepEqual(state().doc, before); f.ui.unmount();
});

test("oversized backup files are rejected before reading their bytes", async () => {
  const f = fixture(); const before = state().doc;
  let reads = 0;
  f.render().props.onChange({ target: { files: [{ size: 13 * 1024 * 1024, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }], value: "large.json" } });
  await tick();
  assert.equal(reads, 0);
  assert.equal(f.ui.alerts.length, 1);
  assert.equal(f.ui.confirmations.length, 0);
  assert.equal(state().doc, before); f.ui.unmount();
});
