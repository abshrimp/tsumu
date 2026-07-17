import assert from "node:assert/strict";
import { test } from "node:test";
import { assetSrc, mediaSrc } from "../lib/assets";
import { makeBox, makeImage, makeText } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";
import { renderAnchorExport } from "./helpers/instance-anchor";

const state = () => useEditor.getState();
function fixture(): SiteDoc {
  return {
    siteName: "Clipboard history", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["card"] } },
    nodes: {
      card: { ...makeBox(), id: "card", children: ["text"] },
      text: { ...makeText("Copied content"), id: "text" },
    },
  };
}
function open(doc = fixture()) {
  state().endGesture();
  state().replaceDoc(doc);
  state().setActivePage("p");
  state().select(null);
  state().setEditingComponent(null);
}
function copyComponent() {
  state().createComponent("card");
  const id = state().selection!;
  const componentId = state().doc.nodes[id].componentId!;
  state().copyNode(id);
  return componentId;
}

test("internal paste restores a copied component after undoing its creation", () => {
  open();
  const original = structuredClone(state().doc);
  const componentId = copyComponent();
  const clipboard = structuredClone(state().clipboard);
  state().undo();
  assert.deepEqual(state().doc, original);
  state().pasteClipboard();
  const pasted = structuredClone(state().doc);
  assert.ok(pasted.components?.[componentId]);
  assert.notEqual(pasted.components[componentId].rootId, "card");
  assert.deepEqual(pasted.nodes.card, original.nodes.card);
  assert.deepEqual(pasted.nodes.text, original.nodes.text);
  assert.equal((renderAnchorExport(pasted).html.match(/Copied content/g) ?? []).length, 2);
  assert.deepEqual(state().clipboard, clipboard);
  state().undo();
  assert.deepEqual(state().doc, original, "the restored dependencies and pasted instance form one undo step");
  state().redo();
  assert.deepEqual(state().doc, pasted);
});

test("internal paste restores deleted nested masters with their content", () => {
  open();
  const outer = copyComponent();
  state().createComponent("text");
  const inner = state().doc.nodes[state().selection!].componentId!;
  state().copyNode(state().doc.pages.p.children[0]);
  state().deleteComponent(outer);
  state().deleteComponent(inner);
  const empty = structuredClone(state().doc);
  state().pasteClipboard();
  const pasted = state().doc;
  assert.ok(pasted.components?.[outer]);
  assert.ok(pasted.components?.[inner]);
  assert.equal((renderAnchorExport(pasted).html.match(/Copied content/g) ?? []).length, 1);
  state().undo();
  assert.deepEqual(state().doc, empty);
  state().redo();
  assert.deepEqual(state().doc, pasted);
});

test("internal paste reuses current master edits instead of the copied snapshot", () => {
  open();
  const componentId = copyComponent();
  state().updateNode("text", { text: { content: "Current master", heading: 0 } });
  const before = structuredClone(state().doc);
  state().select(null);
  state().pasteClipboard();
  const pasted = state().doc;
  assert.equal(pasted.components![componentId].rootId, "card");
  assert.deepEqual(pasted.nodes.card, before.nodes.card);
  assert.deepEqual(pasted.nodes.text, before.nodes.text);
  assert.equal(Object.keys(pasted.nodes).length, Object.keys(before.nodes).length + 1);
  assert.equal((renderAnchorExport(pasted).html.match(/Current master/g) ?? []).length, 2);
  assert.doesNotMatch(renderAnchorExport(pasted).html, /Copied content/);
});

test("internal paste restores image, script and font dependencies removed by undo", () => {
  open();
  const before = structuredClone(state().doc);
  const image = { id: "image", name: "photo.png", dataUrl: "data:image/png;base64,AQID", width: 1, height: 1 };
  const scriptAsset = { id: "sound", name: "sound.mp3", path: "assets/sound.mp3", width: 0, height: 0 };
  state().updateDoc((doc) => {
    doc.assets.image = image;
    doc.assets.sound = scriptAsset;
    doc.customFonts = [{ family: "Lora", weights: ["400"] }];
    doc.nodes.photo = {
      ...makeImage(), id: "photo", styles: { base: { default: { fontFamily: "Lora" } } },
      image: { src: "", assetId: image.id, alt: "Copied photograph", width: 1, height: 1 },
      scripts: [{ id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps: [
        { id: "step", kind: "open-url", url: assetSrc(scriptAsset) },
      ] }],
    };
    doc.pages.p.children.push("photo");
  });
  state().copyNode("photo");
  const clipboard = structuredClone(state().clipboard);
  state().undo();
  state().pasteClipboard();
  const pasted = state().doc;
  const node = pasted.nodes[state().selection!];
  assert.deepEqual(pasted.assets.image, image);
  assert.deepEqual(pasted.assets.sound, scriptAsset);
  assert.deepEqual(pasted.customFonts, [{ family: "Lora", weights: ["400"] }]);
  assert.equal(mediaSrc(pasted, node.image!), image.dataUrl);
  assert.notEqual(node.scripts![0].id, "script");
  assert.notEqual(node.scripts![0].steps[0].id, "step");
  assert.equal(node.scripts![0].steps[0].kind, "open-url");
  assert.deepEqual(state().clipboard, clipboard);
  state().undo();
  assert.deepEqual(state().doc, before);
  state().redo();
  assert.deepEqual(state().doc, pasted);
});
