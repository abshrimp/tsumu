import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload, parseClipPayload, type ClipPayload } from "../lib/clip-transfer";
import { createInitialDoc, makeBox } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { useEditor } from "../lib/store";

function payload(): ClipPayload {
  const doc = createInitialDoc();
  const node = { ...makeBox(), id: "copied" };
  node.image = { src: "", alt: "", width: 10, height: 10, assetId: "picture" };
  doc.nodes[node.id] = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  doc.assets.picture = { id: "picture", name: "picture.png", path: "assets/picture.png", width: 10, height: 10 };
  return buildClipPayload(doc, { nodes: [node], rootIds: [node.id] });
}

test("clipboard rejects invalid render and script values before they can enter the document", () => {
  const invalidNodes = [
    { name: { unexpected: true } },
    { type: "unknown" },
    { styles: { base: { default: { color: [] } } } },
    { text: { content: { html: "text" }, heading: 0 } },
    { field: { kind: "select", options: "not-an-array" } },
    { scripts: [{ id: "script", trigger: "click", steps: [{ id: "if", kind: "if", then: {} }] }] },
  ];
  for (const patch of invalidNodes) {
    const p = payload();
    Object.assign(p.nodes[0], patch);
    assert.equal(parseClipPayload(JSON.stringify(p)), null, JSON.stringify(patch));
  }
  const p = payload();
  p.components.card = { id: "card", name: "Card", rootId: "master" };
  p.componentNodes = [{ ...makeBox(), id: "master", text: { content: 42 as any, heading: 0 } }];
  assert.equal(parseClipPayload(JSON.stringify(p)), null, "component masters use the same value validation");
});

test("clipboard rejects malformed asset maps, identities and values", () => {
  for (const change of [
    (p: any) => { p.assets = []; },
    (p: any) => { p.assets.picture.id = "different"; },
    (p: any) => { p.assets.picture.mimeType = {}; },
    (p: any) => { p.assets.picture.width = -1; },
    (p: any) => { p.assets.picture.zip = { version: 1, group: "zip", path: "picture.png", stylesheet: { source: "", references: {} } }; },
    (p: any) => { p.assets = JSON.parse('{"__proto__":{"id":"__proto__","name":"x.png","path":"assets/x.png","width":1,"height":1}}'); },
    (p: any) => { p.customFonts = [{ family: "Font", weights: [400] }]; },
  ]) {
    const p = payload();
    change(p);
    assert.equal(parseClipPayload(JSON.stringify(p)), null);
  }
});

test("clipboard rejects unresolved or discarded dependencies before paste", () => {
  for (const change of [
    (p: ClipPayload) => { p.assets = {}; },
    (p: ClipPayload) => { p.nodes[0].image!.assetId = "missing"; },
    (p: ClipPayload) => { p.assets.picture.name = "document.html"; p.assets.picture.mimeType = "text/html"; },
    (p: ClipPayload) => { p.nodes[0].media = { kind: "video", src: "", sources: [{ src: "", assetId: "missing" }] }; },
    (p: ClipPayload) => { p.nodes[0].type = "instance"; p.nodes[0].componentId = "missing"; },
    (p: ClipPayload) => {
      p.components.card = { id: "card", name: "Card", rootId: "master" };
      p.componentNodes = [{ ...makeBox(), id: "master", image: { src: "", alt: "", width: 1, height: 1, assetId: "missing" } }];
    },
  ]) {
    const p = payload();
    change(p);
    const doc = createInitialDoc();
    useEditor.getState().replaceDoc(doc);
    const before = useEditor.getState();
    const parsed = parseClipPayload(JSON.stringify(p));
    if (parsed) useEditor.getState().pasteClipboard(parsed);
    assert.equal(parsed, null);
    assert.equal(useEditor.getState().doc, before.doc);
    assert.equal(useEditor.getState().past, before.past);
    assert.equal(useEditor.getState().selectedIds, before.selectedIds);
  }
});

test("a valid external clipboard remains editable, saveable and undoable", () => {
  const p = payload();
  const parsed = parseClipPayload(JSON.stringify(p));
  assert.deepEqual(parsed, p);
  const doc = createInitialDoc();
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage(doc.pageOrder[0]);
  useEditor.getState().select(null);
  useEditor.getState().pasteClipboard(parsed!);
  const pasted = useEditor.getState().doc;
  const selected = pasted.nodes[useEditor.getState().selection!];
  assert.equal(selected.image?.assetId, "picture");
  assert.deepEqual(pasted.assets.picture, p.assets.picture);
  assert.equal(validSiteDoc(pasted), true);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, doc);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, pasted);
});
