import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload } from "../lib/clip-transfer";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import { makeBox, makeText } from "../lib/presets";
import { applyPageScripts, pageNodeIds, pageScriptsOf, walkSteps } from "../lib/script";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";
import { mapStep, removeKeys } from "../components/script-editor/step-tree";
import { renderAnchorExport } from "./helpers/instance-anchor";

function original(): SiteDoc {
  return {
    siteName: "Fork", assets: {}, pageOrder: ["home", "about"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["shared"] },
      about: { id: "about", name: "About", slug: "about", title: "About", description: "", children: [] },
    },
    nodes: {
      shared: { ...makeBox(), id: "shared", children: ["text"] },
      text: { ...makeText("Destination original"), id: "text" },
    },
  };
}
function open(doc: SiteDoc) {
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage("home");
  useEditor.getState().select(null);
  useEditor.getState().setEditingComponent(null);
}
function forkWithComponent() {
  const destination = original();
  open(structuredClone(destination));
  useEditor.getState().updateDoc((doc) => {
    doc.nodes.text.text!.content = "Imported master content";
    doc.nodes.shared.link = { kind: "page", pageId: "about" };
  });
  useEditor.getState().createComponent("shared");
  const source = useEditor.getState().doc;
  const instance = source.nodes[source.pages.home.children[0]];
  const payload = buildClipPayload(source, { nodes: [structuredClone(instance)], rootIds: [instance.id] });
  return { destination, source, payload, componentId: instance.componentId! };
}
const importedText = (doc: SiteDoc, componentId: string) =>
  doc.nodes[doc.nodes[doc.components![componentId].rootId].children[0]];

for (const operation of ["paste", "copy page"] as const) {
  test(`${operation} imports a new master without adopting forked destination nodes`, () => {
    const { destination, source, payload, componentId } = forkWithComponent();
    const originalNodes = structuredClone(destination.nodes);
    const sourceBefore = structuredClone(source);
    const payloadBefore = structuredClone(payload);
    open(destination);
    if (operation === "paste") useEditor.getState().pasteClipboard(payload);
    else useEditor.getState().updateDoc((doc) => { applyPagePayload(doc, buildPagePayload(source, ["home", "about"])); });
    const pasted = useEditor.getState().doc;
    const root = pasted.nodes[pasted.components![componentId].rootId];
    assert.notEqual(root.id, "shared");
    assert.notEqual(root.children[0], "text");
    assert.equal(importedText(pasted, componentId).text!.content, "Imported master content");
    assert.deepEqual(pasted.nodes.shared, originalNodes.shared);
    assert.deepEqual(pasted.nodes.text, originalNodes.text);
    if (operation === "paste") {
      const html = renderAnchorExport(pasted).html;
      assert.equal((html.match(/Destination original/g) ?? []).length, 1);
      assert.equal((html.match(/Imported master content/g) ?? []).length, 1);
    } else {
      const copiedAbout = pasted.pageOrder.at(-1)!;
      assert.equal(root.link!.pageId, copiedAbout, "relink the remapped imported master, not the destination node");
    }
    const snapshot = structuredClone(pasted);
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, destination);
    useEditor.getState().redo();
    assert.deepEqual(useEditor.getState().doc, snapshot);
    useEditor.getState().updateNode(importedText(snapshot, componentId).id, {
      text: { content: "Edit imported master", heading: 0 },
    });
    assert.equal(useEditor.getState().doc.nodes.text.text!.content, "Destination original");
    useEditor.getState().deleteComponent(componentId);
    const after = useEditor.getState().doc;
    assert.deepEqual(after.nodes.shared, originalNodes.shared);
    assert.deepEqual(after.nodes.text, originalNodes.text);
    assert.ok(after.pages.home.children.includes("shared"));
    assert.deepEqual(source, sourceBefore);
    assert.deepEqual(payload, payloadBefore);
  });
}

test("a colliding descendant is remapped even when its new master root does not collide", () => {
  const { destination, payload, componentId } = forkWithComponent();
  const root = payload.componentNodes.find((n) => n.id === "shared")!;
  root.id = "new-root";
  payload.components[componentId].rootId = "new-root";
  const image = payload.componentNodes.find((n) => n.id === "text")!;
  image.image = { assetId: "incoming-asset", src: "", alt: "", width: 1, height: 1 };
  payload.assets["incoming-asset"] = { id: "incoming-asset", name: "photo.png", path: "assets/photo.png", width: 1, height: 1 };
  destination.assets["existing-asset"] = { ...payload.assets["incoming-asset"], id: "existing-asset" };
  open(destination);
  useEditor.getState().pasteClipboard(payload);
  const pasted = useEditor.getState().doc;
  assert.equal(pasted.components![componentId].rootId, "new-root");
  assert.notEqual(pasted.nodes["new-root"].children[0], "text");
  assert.equal(importedText(pasted, componentId).text!.content, "Imported master content");
  assert.equal(importedText(pasted, componentId).image!.assetId, "existing-asset");
  assert.equal(pasted.nodes.text.text!.content, "Destination original");
  useEditor.getState().deleteComponent(componentId);
  assert.equal(useEditor.getState().doc.nodes.text.text!.content, "Destination original");
});

test("nested imported components isolate both masters and preserve instance references", () => {
  const { destination, source } = forkWithComponent();
  open(source);
  useEditor.getState().createComponent("text");
  const nestedSource = useEditor.getState().doc;
  const instance = nestedSource.nodes[nestedSource.pages.home.children[0]];
  const outerId = instance.componentId!;
  const payload = buildClipPayload(nestedSource, { nodes: [instance], rootIds: [instance.id] });
  open(destination);
  useEditor.getState().pasteClipboard(payload);
  const pasted = useEditor.getState().doc;
  const outerRoot = pasted.nodes[pasted.components![outerId].rootId];
  const innerInstance = pasted.nodes[outerRoot.children[0]];
  assert.equal(innerInstance.type, "instance");
  const innerRoot = pasted.nodes[pasted.components![innerInstance.componentId!].rootId];
  assert.notEqual(outerRoot.id, "shared");
  assert.notEqual(innerRoot.id, "text");
  assert.equal(innerRoot.text!.content, "Imported master content");
  useEditor.getState().deleteComponent(outerId);
  useEditor.getState().deleteComponent(innerInstance.componentId!);
  assert.deepEqual(useEditor.getState().doc.nodes.shared, destination.nodes.shared);
  assert.deepEqual(useEditor.getState().doc.nodes.text, destination.nodes.text);
});

test("an existing component is reused without replacing its master or importing orphan source nodes", () => {
  const { source, payload, componentId } = forkWithComponent();
  const destination = structuredClone(source);
  destination.nodes.text.text!.content = "Keep destination master";
  payload.componentNodes.push({ ...makeText("Unused source edit"), id: "source-only" });
  payload.componentNodes.find((n) => n.id === "shared")!.children.push("source-only");
  const before = structuredClone(destination);
  open(destination);
  useEditor.getState().pasteClipboard(payload);
  const pasted = useEditor.getState().doc;
  assert.equal(pasted.nodes[useEditor.getState().selection!].componentId, componentId);
  assert.deepEqual(pasted.components, before.components);
  for (const [id, node] of Object.entries(before.nodes)) assert.deepEqual(pasted.nodes[id], node);
  assert.equal(pasted.nodes["source-only"], undefined);
});

test("a new outer component reuses an existing nested master without importing its source edits", () => {
  const { source } = forkWithComponent();
  open(source);
  useEditor.getState().createComponent("text");
  const nestedSource = useEditor.getState().doc;
  const instance = nestedSource.nodes[nestedSource.pages.home.children[0]];
  const outerId = instance.componentId!;
  const innerId = nestedSource.nodes[nestedSource.nodes.shared.children[0]].componentId!;
  const payload = buildClipPayload(nestedSource, { nodes: [instance], rootIds: [instance.id] });
  const destination = structuredClone(nestedSource);
  delete destination.components![outerId];
  delete destination.nodes[instance.id];
  destination.pages.home.children = ["shared"];
  destination.nodes.text.text!.content = "Keep destination nested master";
  const before = structuredClone(destination);
  open(destination);
  useEditor.getState().pasteClipboard(payload);
  const pasted = useEditor.getState().doc;
  const outer = pasted.nodes[pasted.components![outerId].rootId];
  assert.notEqual(outer.id, "shared");
  assert.notEqual(outer.children[0], destination.nodes.shared.children[0]);
  assert.equal(pasted.nodes[outer.children[0]].componentId, innerId);
  assert.deepEqual(pasted.components![innerId], before.components![innerId]);
  assert.equal(Object.keys(pasted.nodes).length, Object.keys(before.nodes).length + 3);
  for (const [id, node] of Object.entries(before.nodes)) assert.deepEqual(pasted.nodes[id], node);
  useEditor.getState().deleteComponent(outerId);
  assert.deepEqual(useEditor.getState().doc.nodes, before.nodes);
});

test("page copy relinks nested scripts on imported remapped masters only", () => {
  const { destination, source, componentId } = forkWithComponent();
  source.nodes.shared.scripts = [{ id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps: [{
    id: "condition", kind: "if", cond: { subject: "visible", target: "@self" },
    then: [{ id: "repeat", kind: "repeat", times: 2, then: [{ id: "open", kind: "open-page", pageId: "about" }] }],
    else: [{ id: "fallback", kind: "open-page", pageId: "about" }],
  }] }];
  const before = structuredClone(destination);
  const sourceBefore = structuredClone(source);
  applyPagePayload(destination, buildPagePayload(source, ["home", "about"]));
  const master = destination.nodes[destination.components![componentId].rootId];
  const pageIds: string[] = [];
  walkSteps(master.scripts![0].steps, (step) => {
    if (step.kind === "open-page") pageIds.push(step.pageId);
  });
  assert.deepEqual(pageIds, [destination.pageOrder.at(-1), destination.pageOrder.at(-1)]);
  assert.equal(master.link!.pageId, destination.pageOrder.at(-1));
  for (const [id, node] of Object.entries(before.nodes)) assert.deepEqual(destination.nodes[id], node);
  assert.deepEqual(source, sourceBefore);
});

test("editing or deleting an imported master's scripts cannot change the destination's scripts", () => {
  const { destination, payload, componentId } = forkWithComponent();
  const scripts: NonNullable<DocNode["scripts"]> = [{
    id: "shared-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [{
      id: "shared-repeat", kind: "repeat", times: 2, then: [{
        id: "shared-condition", kind: "if", cond: { subject: "visible", target: "@self" },
        then: [{ id: "shared-then", kind: "show", target: "@self" }],
        else: [{ id: "shared-else", kind: "hide", target: "@self" }],
      }],
    }],
  }];
  destination.nodes.text.scripts = structuredClone(scripts);
  payload.componentNodes.find((node) => node.id === "text")!.scripts = structuredClone(scripts);
  const payloadBefore = structuredClone(payload);
  open(destination);
  useEditor.getState().pasteClipboard(payload);
  const pasted = useEditor.getState().doc;
  const imported = importedText(pasted, componentId);
  const originalIds = new Set([scripts[0].id]);
  walkSteps(scripts[0].steps, (step) => originalIds.add(step.id));
  assert.ok(!originalIds.has(imported.scripts![0].id), "the imported script needs its own editor identity");
  walkSteps(imported.scripts![0].steps, (step) => assert.ok(!originalIds.has(step.id)));

  // スクリプト画面が使う操作を通して、元のブロックが変更・削除されないことを確かめる。
  const ids = pageNodeIds(pasted, "home");
  const importedScript = imported.scripts![0];
  useEditor.getState().updateDoc((doc) => applyPageScripts(doc, "home", ids,
    mapStep(pageScriptsOf(doc, ids, "home"), importedScript.steps[0].id,
      (step) => step.kind === "repeat" ? { ...step, times: 3 } : step)));
  assert.deepEqual(useEditor.getState().doc.nodes.text.scripts, scripts);
  useEditor.getState().updateDoc((doc) => applyPageScripts(doc, "home", ids,
    removeKeys(pageScriptsOf(doc, ids, "home"), [`script:${importedScript.id}`])));
  assert.deepEqual(useEditor.getState().doc.nodes.text.scripts, scripts);
  assert.equal(useEditor.getState().doc.nodes[imported.id].scripts, undefined);
  assert.deepEqual(payload, payloadBefore);
});


test("cross-site paste preserves a separately edited master despite colliding component IDs", () => {
  const { source, payload, componentId } = forkWithComponent();
  const destination = structuredClone(source);
  const masterRoot = destination.components![componentId].rootId;
  const textId = destination.nodes[masterRoot].children[0];
  destination.nodes[textId].text!.content = "Destination fork";
  const before = structuredClone(destination);
  payload.site = "different-site";
  const sourceBefore = structuredClone(payload);

  open(destination);
  useEditor.getState().pasteClipboard(payload);
  const pasted = useEditor.getState().doc;
  const instance = pasted.nodes[useEditor.getState().selection!];
  const importedComponentId = instance.componentId!;
  assert.notEqual(importedComponentId, componentId);
  assert.equal(importedText(pasted, componentId).text!.content, "Destination fork");
  assert.equal(importedText(pasted, importedComponentId).text!.content, "Imported master content");
  assert.deepEqual(pasted.components![componentId], before.components![componentId]);
  assert.deepEqual(pasted.nodes[masterRoot], before.nodes[masterRoot]);
  assert.deepEqual(payload, sourceBefore);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.equal(importedText(useEditor.getState().doc, importedComponentId).text!.content, "Imported master content");
});

test("page copy remaps conflicting components without changing destination masters", () => {
  const { source, componentId } = forkWithComponent();
  const destination = structuredClone(source);
  const originalRoot = destination.components![componentId].rootId;
  const originalTextId = destination.nodes[originalRoot].children[0];
  destination.nodes[originalTextId].text!.content = "Destination fork";
  const before = structuredClone(destination);
  const payload = buildPagePayload(source, ["home"]);

  applyPagePayload(destination, payload);
  const copiedPage = destination.pages[destination.pageOrder.at(-1)!];
  const pastedInstance = destination.nodes[copiedPage.children[0]];
  assert.notEqual(pastedInstance.componentId, componentId);
  assert.equal(importedText(destination, componentId).text!.content, "Destination fork");
  assert.equal(importedText(destination, pastedInstance.componentId!).text!.content, "Imported master content");
  assert.deepEqual(destination.components![componentId], before.components![componentId]);
  assert.deepEqual(destination.nodes[originalRoot], before.nodes[originalRoot]);
  assert.deepEqual(source, structuredClone(source));
});

test("page copy remaps nested conflicting components and their instance references", () => {
  const { source } = forkWithComponent();
  open(source);
  useEditor.getState().createComponent("text");
  const copiedSource = useEditor.getState().doc;
  const originalOuterId = copiedSource.nodes[copiedSource.pages.home.children[0]].componentId!;
  const originalOuterRoot = copiedSource.components![originalOuterId].rootId;
  const originalInnerId = copiedSource.nodes[copiedSource.nodes[originalOuterRoot].children[0]].componentId!;
  const destination = structuredClone(copiedSource);
  const innerRoot = destination.components![originalInnerId].rootId;
  destination.nodes[innerRoot].text!.content = "Destination nested edit";
  applyPagePayload(destination, buildPagePayload(copiedSource, ["home"]));
  const page = destination.pages[destination.pageOrder.at(-1)!];
  const outerInstance = destination.nodes[page.children[0]];
  assert.notEqual(outerInstance.componentId, originalOuterId);
  const outer = destination.nodes[destination.components![outerInstance.componentId!].rootId];
  const innerInstance = destination.nodes[outer.children[0]];
  assert.notEqual(innerInstance.componentId, originalInnerId);
  assert.equal(destination.nodes[destination.components![innerInstance.componentId!].rootId].text!.content, "Imported master content");
  assert.equal(destination.nodes[innerRoot].text!.content, "Destination nested edit");
});
