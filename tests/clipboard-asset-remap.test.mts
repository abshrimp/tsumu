import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload, parseClipPayload, remapAssetIds } from "../lib/clip-transfer";
import { validSiteDoc } from "../lib/doc-tree";
import { createInitialDoc, makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";

test("asset remapping preserves structural identities, text, keys and stored file URLs", () => {
  const original = {
    id: "node_copy", children: ["node_child"], componentId: "node_component",
    name: "node name", text: { content: "node", heading: 0 },
    htmlAttrs: { node: "node", "data-node": "node" },
    image: { assetId: "node", src: "/api/assets/file?path=assets%2Fnode.png", alt: "node", assetSuffix: "#node" },
    media: { assetId: "node", sources: [{ assetId: "node", src: "data:video/mp4;base64,node", assetSuffix: "?name=node" }] },
    scripts: [{ id: "node_script", steps: [{ id: "node_step", kind: "set-var", value: "node", into: "node" }] }],
  };
  const before = structuredClone(original);
  const expected = structuredClone(original);
  expected.image.assetId = "asset-copy";
  expected.media.assetId = "asset-copy";
  expected.media.sources[0].assetId = "asset-copy";
  const result = remapAssetIds(original, new Map([["node", "asset-copy"]]));
  assert.deepEqual(result, expected);
  assert.deepEqual(original, before);
});

test("ZIP CSS URLs remap complete decoded IDs once and retain query and fragment text", () => {
  const input = {
    image: { assetId: "asset-alpha" },
    other: { assetId: "asset-bravo" },
    html: '<link href="tsumu-zip-css:%61sset-alpha?name=asset-alpha#asset-alpha">' +
      '<link href="tsumu-zip-css:asset-bravo">' +
      '<link href="tsumu-zip-css:asset-alpha-long">' +
      '<link href="tsumu-zip-css:%zz">',
    text: "asset-alpha asset-bravo",
  };
  const result = remapAssetIds(input, new Map([
    ["asset-alpha", "asset-bravo"], ["asset-bravo", "asset-charlie"],
  ]));
  assert.equal(result.image.assetId, "asset-bravo");
  assert.equal(result.other.assetId, "asset-charlie");
  assert.equal(result.html,
    '<link href="tsumu-zip-css:asset-bravo?name=asset-alpha#asset-alpha">' +
    '<link href="tsumu-zip-css:asset-charlie">' +
    '<link href="tsumu-zip-css:asset-alpha-long">' +
    '<link href="tsumu-zip-css:%zz">');
  assert.equal(result.text, input.text);
});

test("pasting an asset named node preserves generated node IDs and supports saving and Undo", () => {
  const source = createInitialDoc();
  const root = { ...makeBox(), id: "source", children: ["child"] };
  const child = { ...makeBox(), id: "child", name: "node" };
  child.image = { src: "", assetId: "node", alt: "node", width: 10, height: 10 };
  source.nodes = { source: root, child };
  source.pages[source.pageOrder[0]].children = [root.id];
  source.assets.node = { id: "node", name: "source.png", path: "assets/source.png", width: 10, height: 10 };
  const payload = buildClipPayload(source, { nodes: [root, child], rootIds: [root.id] });
  payload.site = "other-site";
  const destination = createInitialDoc();
  destination.assets.node = { id: "node", name: "destination.png", path: "assets/destination.png", width: 10, height: 10 };
  const before = structuredClone(destination);
  useEditor.getState().replaceDoc(destination);
  useEditor.getState().setActivePage(destination.pageOrder[0]);
  useEditor.getState().select(null);
  const parsed = parseClipPayload(JSON.stringify(payload));
  assert.ok(parsed);
  useEditor.getState().pasteClipboard(parsed);
  const state = useEditor.getState();
  const pasted = state.doc;
  const copied = pasted.nodes[state.selection!];
  assert.equal(copied.id, state.selection);
  const copiedChild = pasted.nodes[copied.children[0]];
  assert.equal(copiedChild.id, copied.children[0]);
  assert.equal(copiedChild.name, "node");
  assert.equal(copiedChild.image?.alt, "node");
  assert.notEqual(copiedChild.image?.assetId, "node");
  assert.equal(pasted.assets[copiedChild.image!.assetId!].path, source.assets.node.path);
  assert.deepEqual(pasted.assets.node, before.assets.node);
  assert.equal(validSiteDoc(pasted), true);
  state.undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, pasted);
  assert.deepEqual(destination, before);
});
