import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocPatch, type DocPatch } from "../lib/doc-patch";
import { mergeDocs, rebaseNodePatch } from "../lib/merge";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(count = 64): SiteDoc {
  const ids = Array.from({ length: count }, (_, i) => `node-${i}`);
  return {
    schemaVersion: 1,
    siteName: "History performance",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home",
        description: "", children: ids },
    },
    pageOrder: ["home"],
    nodes: Object.fromEntries(ids.map((id) => [
      id, { ...makeBox(), id, name: id,
        styles: { base: { default: { color: "red" } } } },
    ])),
    assets: {},
    components: {},
  };
}

function remoteRename(base: SiteDoc, id = "node-0", name = "Remote") {
  const updated: SiteDoc = {
    ...base,
    nodes: { ...base.nodes, [id]: { ...base.nodes[id], name } },
  };
  const patch = createDocPatch(base, updated);
  assert.ok(patch?.length, "a node change produces a nonempty patch");
  return { updated, patch };
}

test("a collaborator's node edit rebases checkpoints without cloning unrelated nodes", () => {
  const base = fixture(128);
  const { updated, patch } = remoteRename(base);
  const checkpoint = {
    ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"],
        styles: { base: { default: { color: "green" } } } },
      "node-4": { ...base.nodes["node-4"], name: "Older local name" },
    },
  };
  const originals = structuredClone([base, updated, checkpoint]);
  const rebased = rebaseNodePatch(base, updated, checkpoint, patch!);
  assert.ok(rebased);
  assert.deepEqual(rebased, mergeDocs(base, updated, checkpoint));
  assert.equal(rebased.nodes["node-0"].name, "Remote");
  assert.equal(rebased.nodes["node-0"].styles.base?.default?.color, "green");
  assert.equal(rebased.nodes["node-4"], checkpoint.nodes["node-4"]);
  assert.equal(rebased.nodes["node-64"], checkpoint.nodes["node-64"]);
  assert.equal(rebased.pages, checkpoint.pages);
  assert.deepEqual([base, updated, checkpoint], originals);
});

test("multiple node property patches preserve edits to different nested properties", () => {
  const base = fixture();
  const updated = {
    ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"],
        styles: { base: { default: { color: "blue" } } } },
      "node-1": { ...base.nodes["node-1"], name: "Collaborator" },
    },
  };
  const checkpoint = {
    ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"], name: "Local name" },
      "node-1": { ...base.nodes["node-1"],
        styles: { base: { default: { color: "purple" } } } },
    },
  };
  const patch = createDocPatch(base, updated)!;
  assert.equal(patch.length, 2);
  const result = rebaseNodePatch(base, updated, checkpoint, patch);
  assert.ok(result);
  assert.deepEqual(result, mergeDocs(base, updated, checkpoint));
  assert.equal(result.nodes["node-0"].name, "Local name");
  assert.equal(result.nodes["node-0"].styles.base?.default?.color, "blue");
  assert.equal(result.nodes["node-1"].name, "Collaborator");
  assert.equal(result.nodes["node-1"].styles.base?.default?.color, "purple");
});

test("structural edits and incomplete checkpoints retain the full-merge fallback", () => {
  const base = fixture(3);
  const { updated, patch } = remoteRename(base);
  assert.equal(rebaseNodePatch(base, updated, { ...base,
    nodes: { ...base.nodes, "node-0": undefined },
  } as unknown as SiteDoc, patch!), null);
  const moved = { ...base,
    nodes: { ...base.nodes,
      "node-0": { ...base.nodes["node-0"], children: ["node-2"] },
    },
  };
  assert.equal(rebaseNodePatch(base, moved, base, createDocPatch(base, moved)!), null);
  assert.equal(rebaseNodePatch(base, { ...base, siteName: "Different" }, base,
    [{ path: ["siteName"], value: "Different" }] as DocPatch), null);
  assert.equal(rebaseNodePatch(base, updated, base,
    [{ path: ["nodes", "node-0"], remove: true }] as DocPatch), null);
  assert.equal(rebaseNodePatch(base, updated, base, []), null);
});

test("Undo keeps collaborative edits while sharing unchanged history data", () => {
  useEditor.getState().replaceDoc(fixture(80));
  useEditor.getState().updateNode("node-0", { name: "Local name" });
  useEditor.getState().setStyleProps("node-0", { color: "green" });
  const before = useEditor.getState();
  const checkpoint = before.past.at(-1)!;
  const { updated, patch } = remoteRename(before.doc);
  before.applyRemoteDoc(updated, { baseDoc: before.doc, patch: patch! });
  const after = useEditor.getState();
  assert.equal(after.past.at(-1)!.nodes["node-70"], checkpoint.nodes["node-70"]);
  after.undo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "Remote");
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, "red");
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes["node-0"].name, "Remote");
  assert.equal(useEditor.getState().doc.nodes["node-0"].styles.base?.default?.color, "green");
});
