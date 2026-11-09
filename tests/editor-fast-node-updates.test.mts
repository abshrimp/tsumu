import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";
import { pageScriptsOf } from "../lib/script";

function fixture(size = 128): SiteDoc {
  const ids = Array.from({ length: size }, (_, i) => `node-${i}`);
  return {
    siteName: "Fast editor updates",
    pageOrder: ["p"],
    pages: {
      p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ids },
    },
    nodes: Object.fromEntries(ids.map((id) => [id, { ...makeBox(), id, name: id }])),
    assets: {},
  };
}

function open() {
  useEditor.getState().endGesture();
  useEditor.getState().replaceDoc(fixture());
}

test("editing one node retains unchanged document branches and undo snapshots", () => {
  open();
  const before = useEditor.getState().doc;
  useEditor.getState().updateNode("node-0", { name: "Updated" });
  const after = useEditor.getState().doc;

  assert.notStrictEqual(after, before);
  assert.notStrictEqual(after.nodes, before.nodes);
  assert.notStrictEqual(after.nodes["node-0"], before.nodes["node-0"]);
  assert.strictEqual(after.nodes["node-1"], before.nodes["node-1"]);
  assert.strictEqual(after.pages, before.pages);
  assert.strictEqual(after.assets, before.assets);
  assert.equal(before.nodes["node-0"].name, "node-0");
  assert.equal(after.nodes["node-0"].name, "Updated");

  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "node-0");
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "Updated");
});

test("no-op node changes retain the existing document and history", () => {
  open();
  const before = useEditor.getState().doc;
  const history = useEditor.getState().past;
  useEditor.getState().updateNode("node-0", { name: "node-0" });
  useEditor.getState().updateNode("missing", { name: "New" });
  assert.strictEqual(useEditor.getState().doc, before);
  assert.strictEqual(useEditor.getState().past, history);
});

test("multi-selection edits only clone changed nodes without mutating siblings", () => {
  open();
  useEditor.getState().selectMany(["node-0", "node-1"], "node-1");
  const before = useEditor.getState().doc;
  useEditor.getState().updateTargets("node-0", (node) => {
    node.name = `Renamed ${node.name}`;
  });
  const after = useEditor.getState().doc;
  assert.equal(after.nodes["node-0"].name, "Renamed node-0");
  assert.equal(after.nodes["node-1"].name, "Renamed node-1");
  assert.strictEqual(after.nodes["node-2"], before.nodes["node-2"]);
  assert.equal(before.nodes["node-0"].name, "node-0");
  assert.equal(before.nodes["node-1"].name, "node-1");
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "node-0");
  assert.equal(useEditor.getState().doc.nodes["node-1"].name, "node-1");
});

test("transient style edits preserve one gesture-level undo checkpoint", () => {
  open();
  useEditor.getState().select("node-0");
  const before = useEditor.getState().doc;
  const finish = useEditor.getState().beginGesture();
  useEditor.getState().setStyleProps("node-0", { color: "#ff0000" }, { transient: true });
  const middle = useEditor.getState().doc;
  useEditor.getState().setStyleProps("node-0", { color: "#00ff00" }, { transient: true });
  finish();
  const after = useEditor.getState().doc;

  assert.strictEqual(middle.nodes["node-2"], before.nodes["node-2"]);
  assert.strictEqual(after.nodes["node-2"], before.nodes["node-2"]);
  assert.equal(before.nodes["node-0"].styles.base?.default?.color, undefined);
  assert.equal(after.nodes["node-0"].styles.base?.default?.color, "#00ff00");
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, undefined);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, "#00ff00");
});

test("script edits preserve undo/redo and do not create history for an unchanged workspace", () => {
  open();
  const nodeIds = ["node-0", "node-1"];
  const before = useEditor.getState().doc;
  const views = [{
    id: "script", nodeId: "node-0", trigger: "click" as const,
    pos: { x: 32, y: 32 }, steps: [{ id: "step", kind: "wait" as const, seconds: 1 }],
  }];
  useEditor.getState().updatePageScripts("p", nodeIds, views);
  const first = useEditor.getState().doc;
  assert.notStrictEqual(first, before);
  assert.strictEqual(first.nodes["node-1"], before.nodes["node-1"]);
  assert.strictEqual(first.assets, before.assets);
  assert.strictEqual(first.pages, before.pages);
  const history = useEditor.getState().past;
  const unchanged = pageScriptsOf(first, nodeIds, "p");
  useEditor.getState().updatePageScripts("p", nodeIds, unchanged);
  assert.strictEqual(useEditor.getState().doc, first);
  assert.strictEqual(useEditor.getState().past, history);

  const updated = unchanged.map((s) => s.id === "script"
    ? { ...s, steps: [{ ...s.steps[0], seconds: 2 }] } : s);
  useEditor.getState().updatePageScripts("p", nodeIds, updated);
  assert.equal(useEditor.getState().doc.nodes["node-0"].scripts?.[0].steps[0].kind, "wait");
  useEditor.getState().undo();
  assert.equal((useEditor.getState().doc.nodes["node-0"].scripts?.[0].steps[0] as { seconds: number }).seconds, 1);
  useEditor.getState().undo();
  assert.strictEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].scripts?.[0].id, "script");
  useEditor.getState().redo();
  assert.equal((useEditor.getState().doc.nodes["node-0"].scripts?.[0].steps[0] as { seconds: number }).seconds, 2);
});
