import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import * as clips from "../lib/clip-transfer";
import { buildClipPayload, parseClipPayload, remapAssetIds, type ClipPayload, clipboardPayload, clipHtml, readSystemClipPayload, writeClipPayload } from "../lib/clip-transfer";
import { closeDialog, useDialogs } from "../lib/dialog";
import { validSiteDoc, MAX_NODE_DEPTH } from "../lib/doc-tree";
import { isHiddenAt, resolveStyles } from "../lib/style";
import { makeBox, makeImage, makeText, createInitialDoc } from "../lib/presets";
import { useEditor, componentsReachable, componentOf } from "../lib/store";
import { type SiteDoc, SELF_TARGET, type ScriptStep, type DocNode } from "../lib/types";
import { assetSrc, mediaSrc } from "../lib/assets";
import { renderAnchorExport } from "./helpers/instance-anchor";
import { validateDocValue } from "../lib/doc-storage";
import { runInNewContext } from "node:vm";
import { applyAiOps, buildAiContext } from "../lib/aiOps";
import { applyAiEdits } from "../lib/ai/client";
import { compileScripts, walkSteps, applyPageScripts, pageNodeIds, pageScriptsOf } from "../lib/script";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import { mapStep, removeKeys } from "../components/script-editor/step-tree";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { transformSync } from "./helpers/bundle";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pagePlan, previewDataVars } from "../lib/data";
import { lookupVar, interpolate } from "../lib/vars";
import { generateProject } from "../lib/generator";
import { hasScriptsInside } from "../lib/generator/render-helpers";
import { buildClassNames } from "../lib/generator/names";
import { componentListDoc, publishedComponentList } from "./helpers/component-list-export";
import { dispatchTextPaste } from "../e2e/helpers/text-paste";

describe("clipboard-breakpoints", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function source(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Source", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["box"] } },
    breakpoints: [{ id: "phone", label: "Phone", maxWidth: 600 }],
    nodes: { box: { ...makeBox(), id: "box", styles: { phone: { default: { color: "red" } } }, hiddenOn: ["phone"] } },
  };
}

test("copy and paste maps responsive styles and visibility by width rather than source ID", () => {
  const original = source();
  state().replaceDoc(original);
  state().setActivePage("p");
  state().copyNode("box");
  const clipboard = structuredClone(state().clipboard!);
  const destination = source();
  destination.nodes = {};
  destination.pages.p.children = [];
  destination.breakpoints = [{ id: "mobile", label: "Mobile", maxWidth: 600 }];
  state().replaceDoc(destination);
  assert.ok(validSiteDoc(original));
  assert.ok(validSiteDoc(destination));
  state().pasteClipboard(parseClipPayload(JSON.stringify(clipboard))!);
  const copied = state().doc.nodes[state().selection!];
  assert.deepEqual(copied.styles, { mobile: { default: { color: "red" } } });
  assert.deepEqual(copied.hiddenOn, ["mobile"]);
  assert.equal(resolveStyles(copied, "mobile", "default").color, "red");
  assert.equal(isHiddenAt(copied, "mobile"), true);
  assert.deepEqual(clipboard.nodes[0], original.nodes.box);
  const pasted = state().doc;
  state().undo();
  assert.deepEqual(state().doc, destination);
  state().redo();
  assert.deepEqual(state().doc, pasted);
  state().select(null);
  state().pasteClipboard(clipboard);
  const second = state().doc.nodes[state().selection!];
  assert.deepEqual(second.styles, copied.styles);
  assert.deepEqual(second.hiddenOn, copied.hiddenOn);
  assert.notEqual(second.id, copied.id);
  assert.deepEqual(clipboard.nodes[0], original.nodes.box);
});

test("pasted nested masters map reversed breakpoint names without changing existing masters", () => {
  const original = source();
  original.breakpoints!.push({ id: "tablet", label: "Tablet", maxWidth: 900 });
  original.nodes.box.hiddenOn = ["tablet"];
  original.nodes.outer = { ...makeBox(), id: "outer", type: "instance", componentId: "inner" };
  original.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "outer" };
  original.components = {
    inner: { id: "inner", name: "Inner", rootId: "box" },
    outer: { id: "outer", name: "Outer", rootId: "outer" },
  };
  original.pages.p.children = ["instance"];
  assert.ok(validSiteDoc(original));
  const payload = buildClipPayload(original, { nodes: [original.nodes.instance], rootIds: ["instance"] });
  payload.site = "another-site";
  const snapshot = structuredClone(payload);
  const destination = structuredClone(original);
  destination.breakpoints = [
    { id: "tablet", label: "Small", maxWidth: 600 },
    { id: "phone", label: "Large", maxWidth: 900 },
  ];
  state().replaceDoc(destination);
  state().setActivePage("p");
  state().select(null);
  state().pasteClipboard(payload);
  const copied = state().doc;
  const outer = copied.components![copied.nodes[state().selection!].componentId!];
  const inner = copied.components![copied.nodes[outer.rootId].componentId!];
  assert.deepEqual(copied.nodes[inner.rootId].styles, { tablet: { default: { color: "red" } } });
  assert.deepEqual(copied.nodes[inner.rootId].hiddenOn, ["phone"]);
  assert.deepEqual(copied.nodes.box, destination.nodes.box);
  assert.deepEqual(payload, snapshot);
  assert.ok(validSiteDoc(copied));
  state().undo();
  assert.deepEqual(state().doc, destination);
});

for (const changed of ["different-width", "changed-after-copy"] as const) {
  test(`${changed} rejects paste before changing dependencies, selection or history`, () => {
    const original = source();
    original.assets.image = { id: "image", name: "image.png", path: "assets/image.png", width: 1, height: 1 };
    original.nodes.box.image = { src: "", assetId: "image", alt: "", width: 1, height: 1 };
    state().replaceDoc(original);
    state().setActivePage("p");
    state().copyNode("box");
    const payload = structuredClone(state().clipboard!);
    const destination = structuredClone(original);
    destination.breakpoints![0].maxWidth = 700;
    destination.assets = {};
    delete destination.nodes.box.image;
    assert.ok(validSiteDoc(original));
    assert.ok(validSiteDoc(destination));
    state().replaceDoc(destination);
    state().select("box");
    const before = state();
    state().pasteClipboard(changed === "different-width" ? payload : undefined);
    const after = state();
    assert.strictEqual(after.doc, before.doc);
    assert.strictEqual(after.past, before.past);
    assert.strictEqual(after.future, before.future);
    assert.deepEqual(after.selectedIds, before.selectedIds);
    assert.equal(after.selection, before.selection);
    const alert = useDialogs.getState().queue.at(-1)!;
    assert.equal(alert.kind, "alert");
    closeDialog(alert.id);
  });
}

test("clipboard without required breakpoint metadata is rejected without altering the document", () => {
  const original = source();
  original.nodes.box.styles = { base: { default: { color: "red" } } };
  delete original.nodes.box.hiddenOn;
  const payload = buildClipPayload(original, { nodes: [original.nodes.box], rootIds: ["box"] });
  const malformed = structuredClone(payload) as Partial<typeof payload>;
  delete malformed.breakpoints;
  assert.equal(parseClipPayload(JSON.stringify(malformed)), null);
  state().replaceDoc(original);
  state().setActivePage("p");
  const before = state();
  state().pasteClipboard(malformed as typeof payload);
  assert.strictEqual(state().doc, before.doc);
  assert.strictEqual(state().past, before.past);
  assert.strictEqual(state().future, before.future);
  const alert = useDialogs.getState().queue.at(-1)!;
  assert.equal(alert.kind, "alert");
  closeDialog(alert.id);
});

for (const metadata of [false, true]) {
  for (const hiddenOn of ["phone", { phone: true }, [42]]) {
    test(`malformed visibility is rejected without mutation (metadata: ${metadata}, value: ${JSON.stringify(hiddenOn)})`, () => {
      const original = source();
      const raw = buildClipPayload(original, { nodes: [structuredClone(original.nodes.box)], rootIds: ["box"] });
      if (!metadata) delete (raw as Partial<typeof raw>).breakpoints;
      Object.assign(raw.nodes[0], { hiddenOn });
      assert.equal(parseClipPayload(JSON.stringify(raw)), null);
      state().replaceDoc(original);
      state().setActivePage("p");
      const before = state();
      assert.doesNotThrow(() => state().pasteClipboard(raw));
      assert.strictEqual(state().doc, before.doc);
      assert.strictEqual(state().past, before.past);
      assert.strictEqual(state().selectedIds, before.selectedIds);
      const alert = useDialogs.getState().queue.at(-1)!;
      assert.equal(alert.kind, "alert");
      closeDialog(alert.id);
    });
  }
}

test("base-only clipboard can cross different width configurations without changing the destination", () => {
  const original = source();
  original.nodes.box.styles = { base: { default: { color: "red" } } };
  original.nodes.box.hiddenOn = ["base"];
  state().replaceDoc(original);
  state().setActivePage("p");
  state().copyNode("box");
  const payload = structuredClone(state().clipboard!);
  const destination = source();
  destination.nodes = {};
  destination.pages.p.children = [];
  destination.breakpoints![0].maxWidth = 700;
  state().replaceDoc(destination);
  state().pasteClipboard(payload);
  const copied = state().doc.nodes[state().selection!];
  assert.deepEqual(copied.styles, original.nodes.box.styles);
  assert.deepEqual(copied.hiddenOn, ["base"]);
  assert.deepEqual(state().doc.breakpoints, destination.breakpoints);
  assert.deepEqual(state().clipboard, payload);
  state().undo();
  assert.deepEqual(state().doc, destination);
});
});

describe("clipboard-history", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
describe("clipboard-history", () => {
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

  test("pasting a node into another site brings its Adobe Fonts Web Project in the same undo step", () => {
    const doc = fixture();
    doc.nodes.text.styles.base = { default: { fontFamily: "acumin-pro" } };
    doc.adobeFonts = [{ family: "acumin-pro", kitId: "abc1234", loading: "css" }];
    open(doc);
    state().copyNode("text");
    const payload = { ...state().clipboard!, site: "source" };
    const target = fixture();
    target.adobeFonts = [{ family: "source-han-sans-japanese", kitId: "def5678", loading: "dynamic" }];
    open(target);
    state().pasteClipboard(payload);
    const pasted = state().doc;
    assert.equal(pasted.nodes[state().selection!].styles.base.default?.fontFamily, "acumin-pro");
    assert.deepEqual(pasted.adobeFonts, [...target.adobeFonts, ...doc.adobeFonts]);
    state().undo();
    assert.deepEqual(state().doc, target);
    state().redo();
    assert.deepEqual(state().doc, pasted);
  });

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
        scripts: [{ id: "script", trigger: "click", steps: [
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
});

describe("clipboard-asset-remap", () => {
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
});

describe("clipboard-destination-safety", () => {
  const state = () => useEditor.getState();
  const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
  const doc = (): SiteDoc => ({
    schemaVersion: 1, siteName: "Test", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: [] } }, nodes: {}, components: {},
  });
  function open(d: SiteDoc) {
    state().endGesture(); state().replaceDoc(d); state().setActivePage("p"); state().setInsertMode("inside");
    useDialogs.setState({ queue: [] });
  }
  function source() {
    const d = doc();
    d.nodes = {
      am: node("am", ["bi"]), bi: { ...node("bi"), type: "instance", componentId: "B" },
      bm: node("bm"), ai: { ...node("ai"), type: "instance", componentId: "A" },
    };
    d.pages.p.children = ["ai"];
    d.components = { A: { id: "A", name: "A", rootId: "am" }, B: { id: "B", name: "B", rootId: "bm" } };
    const p = buildClipPayload(d, { nodes: [d.nodes.ai], rootIds: ["ai"] });
    p.assets.incoming = { id: "incoming", name: "image.png", path: "assets/image.png", width: 1, height: 1 };
    p.customFonts = [{ family: "Imported Font", weights: ["400"] }];
    return p;
  }
  function destination() {
    const d = doc(); d.nodes.bm = node("bm");
    d.components = { B: { id: "B", name: "B", rootId: "bm" } };
    return d;
  }

  test("cross-site component paste cannot create a cycle through a reused destination master", () => {
    const payload = source();
    assert.ok(parseClipPayload(JSON.stringify(payload)));
    open(destination()); state().setEditingComponent("B"); state().select("bm");
    state().updateNode("bm", { name: "Edited" }); state().undo();
    const before = state(), copied = structuredClone(payload);
    state().pasteClipboard(payload);
    assert.equal(state().doc, before.doc);
    assert.equal(state().past, before.past);
    assert.equal(state().future, before.future);
    assert.equal(state().selection, before.selection);
    assert.equal(state().editingComponentId, "B");
    assert.equal(useDialogs.getState().queue.length, 1);
    assert.deepEqual(payload, copied);
  });

  test("cycle check uses the existing master's content instead of the source master", () => {
    const d = destination();
    d.nodes.safe = node("safe");
    d.components!.A = { id: "A", name: "Local A", rootId: "safe" };
    open(d); state().setEditingComponent("B"); state().select("bm");
    const original = structuredClone(state().doc);
    state().pasteClipboard(source());
    const result = state().doc;
    assert.equal(useDialogs.getState().queue.length, 0);
    assert.equal(result.nodes.bm.children.length, 1);
    assert.equal(result.nodes[result.nodes.bm.children[0]].componentId, "A");
    assert.deepEqual(result.nodes.safe, original.nodes.safe);
    assert.equal(result.nodes.am, undefined);
    state().undo(); assert.deepEqual(state().doc, original);
    state().redo(); assert.deepEqual(state().doc, result);
  });

  function deepPayload(depth: number): ClipPayload {
    return { v: 1, site: "other", breakpoints: [{ id: "lg", label: "タブレット", maxWidth: 1024 }], nodes: Array.from({ length: depth }, (_, i) => node(`n${i}`, i < depth - 1 ? [`n${i + 1}`] : [])),
      rootIds: ["n0"], assets: {}, components: {}, componentNodes: [], customFonts: [], adobeFonts: [] };
  }
  for (const [depth, allowed] of [[MAX_NODE_DEPTH, false], [MAX_NODE_DEPTH - 1, true]] as const) {
    test(`paste ${depth}-deep tree into a parent ${allowed ? "preserves" : "rejects exceeding"} the depth limit`, () => {
      const d = doc(); d.nodes.parent = node("parent"); d.pages.p.children = ["parent"];
      const payload = deepPayload(depth);
      assert.ok(parseClipPayload(JSON.stringify(payload)));
      open(d); state().select("parent");
      const before = state();
      state().pasteClipboard(payload);
      assert.equal(validateDocValue(state().doc), null);
      if (allowed) {
        assert.equal(state().doc.nodes.parent.children.length, 1);
        state().undo(); assert.deepEqual(state().doc, before.doc);
      } else {
        assert.equal(state().doc, before.doc);
        assert.equal(state().past, before.past);
        assert.equal(state().future, before.future);
        assert.equal(state().selection, before.selection);
        assert.equal(useDialogs.getState().queue.length, 1);
      }
    });
  }
});

describe("clipboard-tree-validation", () => {
  const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
  const emptyDoc = (): SiteDoc => ({
    schemaVersion: 1, siteName: "Clipboard", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", children: [] } }, nodes: {},
  });
  function payload(): ClipPayload {
    return { v: 1, site: "other", breakpoints: [{ id: "lg", label: "タブレット", maxWidth: 1024 }], nodes: [node("a")], rootIds: ["a"], assets: {}, components: {}, componentNodes: [], customFonts: [], adobeFonts: [] };
  }

  for (const kind of ["self-cycle", "indirect-cycle", "shared-child", "duplicate-child", "duplicate-root", "nested-root", "too-deep", "component-cycle", "shared-master", "nested-master", "missing-master"] as const) {
    test(`clipboard rejects ${kind} without changing the destination`, () => {
      const p = payload();
      if (kind === "self-cycle") p.nodes[0].children = ["a"];
      if (kind === "indirect-cycle") p.nodes = [node("a", ["b"]), node("b", ["a"])];
      if (kind === "shared-child") { p.nodes = [node("a", ["c"]), node("b", ["c"]), node("c")]; p.rootIds = ["a", "b"]; }
      if (kind === "duplicate-child") p.nodes = [node("a", ["b", "b"]), node("b")];
      if (kind === "duplicate-root") p.rootIds = ["a", "a"];
      if (kind === "nested-root") { p.nodes = [node("a", ["b"]), node("b")]; p.rootIds = ["a", "b"]; }
      if (kind === "too-deep") { p.nodes = Array.from({ length: MAX_NODE_DEPTH + 1 }, (_, i) => node(`n${i}`, i < MAX_NODE_DEPTH ? [`n${i + 1}`] : [])); p.rootIds = ["n0"]; }
      if (kind === "component-cycle") { p.componentNodes = [node("master", ["master"])]; p.components.card = { id: "card", name: "Card", rootId: "master" }; }
      if (kind === "shared-master" || kind === "nested-master") {
        p.componentNodes = [node("master", kind === "nested-master" ? ["child"] : []), node("child")];
        p.components.first = { id: "first", name: "First", rootId: "master" };
        p.components.second = { id: "second", name: "Second", rootId: kind === "shared-master" ? "master" : "child" };
      }
      if (kind === "missing-master") p.components.card = { id: "card", name: "Card", rootId: "missing" };
      useEditor.getState().replaceDoc(emptyDoc());
      const before = useEditor.getState().doc;
      const parsed = parseClipPayload(JSON.stringify(p));
      if (parsed) useEditor.getState().pasteClipboard(parsed);
      assert.equal(parsed, null);
      assert.equal(useEditor.getState().doc, before);
    });
  }

  test("nested and repeatedly used components retain valid independent master trees", () => {
    const doc = emptyDoc();
    doc.nodes.outer = { ...node("outer"), type: "instance", componentId: "outer" };
    doc.nodes.outerMaster = node("outerMaster", ["inner1", "inner2"]);
    doc.nodes.inner1 = { ...node("inner1"), type: "instance", componentId: "inner" };
    doc.nodes.inner2 = { ...node("inner2"), type: "instance", componentId: "inner" };
    doc.nodes.innerMaster = node("innerMaster", ["leaf"]);
    doc.nodes.leaf = node("leaf");
    doc.components = {
      outer: { id: "outer", name: "Outer", rootId: "outerMaster" },
      inner: { id: "inner", name: "Inner", rootId: "innerMaster" },
    };
    const p = buildClipPayload(doc, { nodes: [doc.nodes.outer], rootIds: ["outer"] });
    assert.deepEqual(parseClipPayload(JSON.stringify(p)), p);
  });


  test("clipboard accepts the maximum supported tree depth", () => {
    const p = payload();
    p.nodes = Array.from({ length: MAX_NODE_DEPTH }, (_, i) => node(`n${i}`, i < MAX_NODE_DEPTH - 1 ? [`n${i + 1}`] : []));
    p.rootIds = ["n0"];
    assert.deepEqual(parseClipPayload(JSON.stringify(p)), p);
  });


  test("clipboard requires explicit root IDs and a string source site", () => {
    for (const field of ["rootIds", "site", "breakpoints"] as const) {
      const p = payload() as Partial<ClipPayload>;
      delete p[field];
      assert.equal(parseClipPayload(JSON.stringify(p)), null);
    }
    assert.equal(parseClipPayload(JSON.stringify({ ...payload(), rootIds: [] })), null);
    assert.equal(parseClipPayload(JSON.stringify({ ...payload(), site: 42 })), null);
  });
});

describe("clipboard-value-validation", () => {
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
      (p: any) => { p.adobeFonts = [{ family: "Bad", kitId: "../bad", loading: "css" }]; },
      (p: any) => { delete p.adobeFonts; },
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
});
});

describe("clipboard-modern", () => {
function fixture() {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "コピー", pageOrder: ["p"], assets: {},
    pages: { p: { id: "p", name: "Home", title: "", slug: "", description: "", children: ["n"] } },
    nodes: { n: { ...makeBox(), id: "n", text: { content: "  2 < 3 && 5 > 4\n<br> は文字です  ", heading: 0 } } },
  };
  return buildClipPayload(doc, { nodes: [doc.nodes.n], rootIds: ["n"] });
}

test("clipboard HTML round-trips structured content through a standard MIME type", () => {
  const payload = fixture();
  const html = clipHtml(JSON.stringify(payload), payload.nodes[0].text!.content);
  assert.match(html, /data-tsumu-clipboard=/);
  assert.match(html, /  2 &lt; 3 &amp;&amp; 5 &gt; 4\n&lt;br&gt; は文字です  <\/span>/);
  const data = { getData: (type: string) => type === "text/html" ? "<html><body>" + html + "</body></html>" : "" };
  assert.deepEqual(clipboardPayload(data)?.payload, payload);
  assert.equal(clipboardPayload(data)?.raw, JSON.stringify(payload));
  assert.equal(clipboardPayload({ getData: (type: string) => type === "text/html" ? '<span data-tsumu-clipboard="%invalid"></span>' : "" }), null);
  assert.equal(clipboardPayload({ getData: () => "<span>Ordinary HTML</span>" }), null);
  assert.equal(clipboardPayload({ getData: () => "a".repeat(48 * 1024 * 1024 + 1) }), null);
});

test("clipboard reads a valid explicitly supplied editor MIME payload", () => {
  const payload = fixture();
  assert.deepEqual(clipboardPayload({ getData: (type: string) =>
    type === "application/x-tsumu+json" ? JSON.stringify(payload) : "" })?.payload, payload);
  assert.equal(parseClipPayload(JSON.stringify({ ...payload, breakpoints: undefined })), null);
});

test("copy uses ClipboardItem without the deprecated DOM copy command", async () => {
  const payload = fixture();
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["navigator", "ClipboardItem", "window", "document"]) descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const storage = new Map<string, string>();
  let formats: Record<string, Blob> | null = null;
  let legacyCalled = false;
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: async (items: Array<{ formats: Record<string, Blob> }>) => {
        formats = items[0].formats;
      } } },
    });
    Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: class {
      formats: Record<string, Blob>;
      constructor(formats: Record<string, Blob>) { this.formats = formats; }
      static supports() { return false; }
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { setItem(key: string, value: string) { storage.set(key, value); } },
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      execCommand() { legacyCalled = true; },
    } });
    writeClipPayload(payload);
    await Promise.resolve();
    assert.equal(legacyCalled, false);
    assert.deepEqual(JSON.parse(storage.get("tsumu-clipboard-v1")!), payload);
    assert.ok(formats);
    assert.equal(await formats!["text/plain"].text(), payload.nodes[0].text!.content);
    const html = await formats!["text/html"].text();
    assert.deepEqual(clipboardPayload({ getData: (type: string) =>
      type === "text/html" ? "<body>" + html + "</body>" : "" })?.payload, payload);
    assert.equal(html, clipHtml(JSON.stringify(payload), payload.nodes[0].text!.content));
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("context menu reads the current system clipboard rather than an old saved copy", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copy = fixture();
  const newer = structuredClone(copy);
  newer.nodes[0].name = "New copy";
  let html = "<span>Ordinary HTML</span>";
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
      read: async () => [{ types: ["text/html"], getType: async () => new Blob([html], { type: "text/html" }) }],
    } } });
    assert.equal(await readSystemClipPayload(), null, "unrelated OS content is not replaced by the saved Tsumu copy");
    html = clipHtml(JSON.stringify(newer), "New copy");
    assert.deepEqual((await readSystemClipPayload())?.payload, newer);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("multiple asynchronous node copies finish in copy order before context paste reads", async () => {
  const descriptors = ["navigator", "ClipboardItem", "window"].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const first = fixture();
  const second = structuredClone(first);
  second.nodes[0].name = "Last copied";
  const writes: { formats: Record<string, Blob>; resolve: () => void }[] = [];
  let current: Record<string, Blob> | null = null;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { setItem() {} },
    } });
    Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: class {
      formats: Record<string, Blob>;
      constructor(formats: Record<string, Blob>) { this.formats = formats; }
      static supports() { return false; }
    } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
      write: (items: Array<{ formats: Record<string, Blob> }>) => new Promise<void>(resolve => {
        writes.push({ formats: items[0].formats, resolve: () => { current = items[0].formats; resolve(); } });
      }),
      read: async () => current ? [{
        types: ["text/html"], getType: async () => current!["text/html"],
      }] : [],
    } } });
    writeClipPayload(first);
    writeClipPayload(second);
    await Promise.resolve();
    assert.equal(writes.length, 1, "the second OS write must not overtake the first");
    writes[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(writes.length, 2);
    writes[1].resolve();
    assert.deepEqual((await readSystemClipPayload())?.payload, second);
    await Promise.resolve();
    writeClipPayload(first);
    assert.equal(writes.length, 3, "later independent copies should write immediately during user activation");
    writes[2].resolve();
    assert.deepEqual((await readSystemClipPayload())?.payload, first);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
});

describe("clone-condition-targets", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  const nodes = Object.fromEntries(["group", "button", "first", "second", "result", "outside"].map(id =>
    [id, { ...makeBox(), id, attrId: id }],
  ));
  nodes.group.children = ["button", "first", "second", "result"];
  for (const id of ["first", "second"]) {
    nodes[id].type = "field";
    nodes[id].field = { kind: "checkbox" };
  }
  nodes.button.scripts = [{ id: "script", trigger: "click", steps: [{
    id: "condition", kind: "if", cond: { subject: "checked", target: "first" },
    conditions: [{ subject: "checked", target: "second", and: true }],
    then: [{ id: "hide", kind: "hide", target: "result" }],
  }] }];
  return {
    schemaVersion: 1, siteName: "Clone conditions", assets: {}, nodes, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["group", "outside"] } },
  };
}

function children(doc: SiteDoc, root: string) {
  return doc.nodes[root].children.map(id => doc.nodes[id]);
}

function assertTargets(doc: SiteDoc, root: string) {
  const [button, first, second, result] = children(doc, root);
  const step = button.scripts![0].steps[0];
  assert.equal(step.kind, "if");
  if (step.kind !== "if") throw new Error("Missing condition");
  assert.equal(step.cond.target, first.attrId);
  assert.equal(step.conditions![0].target, second.attrId);
  assert.equal((step.then[0] as Extract<ScriptStep, { kind: "hide" }>).target, result.attrId);
  assert.ok(validSiteDoc(doc), "the cloned document remains valid for persistence");
}

for (const operation of ["duplicate", "paste", "insert", "detach"] as const) {
  test(`${operation} retargets joined conditions and restores them through undo/redo`, () => {
    const original = fixture();
    if (operation === "detach") {
      original.components = { card: { id: "card", name: "Card", rootId: "group" } };
      original.nodes.instance = { ...makeBox(), id: "instance", attrId: "placed-card", type: "instance", componentId: "card" };
      original.pages.p.children = ["instance", "outside"];
    }
    useEditor.getState().replaceDoc(original);
    useEditor.getState().setActivePage("p");
    if (operation === "duplicate") useEditor.getState().duplicateNode("group");
    else if (operation === "paste") {
      useEditor.getState().copyNode("group");
      useEditor.getState().select(null);
      useEditor.getState().pasteClipboard();
    } else if (operation === "insert") {
      const clones = structuredClone([original.nodes.group, ...children(original, "group")]);
      for (const node of clones) {
        node.id += "-insert";
        node.children = node.children.map(id => id + "-insert");
      }
      useEditor.getState().insertNodes(clones, "group-insert", { kind: "page", id: "p" });
    } else useEditor.getState().detachInstance("instance");
    const { doc, selection, past } = useEditor.getState();
    assert.equal(past.length, 1);
    assertTargets(doc, selection!);
    assert.deepEqual(doc.nodes.button, original.nodes.button, "the source script must remain unchanged");
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, original);
    useEditor.getState().redo();
    assert.deepEqual(useEditor.getState().doc, doc);
  });
}

test("AI clone replay rewrites nested joined targets while retaining external and self references", () => {
  const original = fixture();
  const branch = structuredClone(original.nodes.button.scripts![0].steps[0]);
  assert.ok(branch.kind === "if");
  branch.conditions!.push(
    { subject: "visible", target: "outside", and: false },
    { subject: "visible", target: SELF_TARGET, and: true },
  );
  original.nodes.button.scripts![0].steps = [{
    id: "outer", kind: "if", cond: { subject: "visible", target: "first" },
    then: [{ id: "repeat", kind: "repeat", times: 1, then: [branch] }],
    else: [{ id: "each", kind: "for-each", array: "items", then: [{ ...structuredClone(branch), id: "else-condition" }] }],
  }];
  const context = buildAiContext(original, { pageId: "p" });
  const server = structuredClone(context.doc);
  const result = applyAiOps(server, [{ op: "duplicate", id: "group", newId: "copy" }], context.target);
  assert.deepEqual(result.errors, []);
  const [button, , second] = children(server, "copy");
  let count = 0;
  walkSteps(button.scripts![0].steps, step => {
    if (step.kind !== "if" || !step.conditions) return;
    count++;
    assert.deepEqual(step.conditions.map(c => c.target), [second.attrId, "outside", SELF_TARGET]);
    assert.deepEqual(step.conditions.map(c => c.and), [true, false, true]);
  });
  assert.equal(count, 2);
  useEditor.getState().replaceDoc(original);
  useEditor.getState().updateDoc(doc => applyAiEdits(doc, context, result.applied));
  assert.deepEqual(buildAiContext(useEditor.getState().doc, context.target).doc, server);
  assert.deepEqual(useEditor.getState().doc.nodes.button, original.nodes.button);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
});

// 共有のプレビューのランタイムと、機能を削った公開用のランタイムを実行する。
// 置き換えるのは DOM の検索とイベントの配線だけで、条件と動作は実際のものを使う。
for (const published of [false, true]) {
  test(`${published ? "published" : "preview"} cloned condition reads the cloned checkbox`, () => {
    useEditor.getState().replaceDoc(fixture());
    useEditor.getState().setActivePage("p");
    useEditor.getState().duplicateNode("group");
    const { doc, selection } = useEditor.getState();
    const [button, first, second, result] = children(doc, selection!);
    const listeners = new Map<string, (event: unknown) => void>();
    const checkbox = (checked: boolean) => ({ checked, matches: () => true });
    const originalSecond = checkbox(false);
    const copiedSecond = checkbox(true);
    const originalResult = { style: { display: "" } };
    const copiedResult = { style: { display: "" } };
    const targets: Record<string, unknown> = {
      first: checkbox(true), second: originalSecond, result: originalResult,
      [first.attrId!]: checkbox(true), [second.attrId!]: copiedSecond, [result.attrId!]: copiedResult,
    };
    const element = {
      nodeType: 1, parentElement: null,
      getAttribute: () => JSON.stringify(compileScripts(button, () => "/")),
      closest: (selector: string): unknown => selector === "[data-scripts]" ? element : null,
    };
    const page = { getAttribute: () => "p" };
    const document = {
      querySelector: (selector: string) => selector === "[data-page-body]" ? page : null,
      querySelectorAll: (selector: string) => selector === "[data-scripts]" ? [element]
        : targets[selector.slice(1)] ? [targets[selector.slice(1)]] : [],
      contains: () => true,
      addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
      removeEventListener() {},
    };
    runInNewContext(published ? scriptsFile(doc) : `(${SCRIPT_RUNTIME})({}).install(document);`, {
      document, window: {}, CSS: { escape: (id: string) => id },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame() {}, setTimeout, clearTimeout,
    });
    listeners.get("click")!({ target: element });
    assert.equal(copiedResult.style.display, "none", "both copied checkboxes are checked");
    assert.equal(originalResult.style.display, "");
    copiedResult.style.display = "";
    copiedSecond.checked = false;
    originalSecond.checked = true;
    listeners.get("click")!({ target: element });
    assert.equal(copiedResult.style.display, "", "checking the original cannot satisfy the copied condition");
  });
}
});

describe("component-clone", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
function fixture(): SiteDoc {
  const child: DocNode = {
    ...makeBox(), id: "child", attrId: "target", text: { content: "{target}", heading: 0 },
    link: { kind: "url", url: "#target" },
    scripts: [{ id: "script", trigger: "click", steps: [
      { id: "step", kind: "open-url", url: "#target" },
    ] }],
  };
  return {
    siteName: "Components", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: [] } },
    nodes: { root: { ...makeBox(), id: "root", children: ["child"] }, child },
    components: { c: { id: "c", name: "Card", rootId: "root" } },
  };
}

for (const operation of ["duplicate", "paste", "insert"] as const) {
  test(`${operation} while editing an unused component avoids master ID collisions`, () => {
    useEditor.getState().replaceDoc(fixture());
    useEditor.getState().setActivePage("p");
    useEditor.getState().setEditingComponent("c");
    const original = structuredClone(useEditor.getState().doc);
    if (operation === "duplicate") useEditor.getState().duplicateNode("child");
    else if (operation === "paste") {
      useEditor.getState().copyNode("child");
      useEditor.getState().select("root");
      useEditor.getState().pasteClipboard();
    } else {
      const clone = { ...structuredClone(original.nodes.child), id: "new" };
      useEditor.getState().insertNodes([clone], "new", { kind: "node", id: "root" });
    }
    const state = useEditor.getState();
    const clone = state.doc.nodes[state.selection!];
    assert.equal(clone.attrId, "target-2");
    assert.equal(clone.text?.content, "{target-2}");
    assert.equal(clone.link?.url, "#target-2");
    assert.equal(clone.scripts?.[0].steps[0].kind === "open-url" ? clone.scripts[0].steps[0].url : undefined, "#target-2");
    assert.notEqual(clone.scripts?.[0].id, "script");
    assert.deepEqual(state.doc.nodes.child, original.nodes.child);
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, original);
    useEditor.getState().redo();
    assert.equal(useEditor.getState().doc.nodes[clone.id].attrId, "target-2");
  });
}

test("detaching a nested instance checks IDs against the edited component", () => {
  const doc = fixture();
  doc.components!.inner = { id: "inner", name: "Inner", rootId: "innerRoot" };
  doc.nodes.innerRoot = { ...makeBox(), id: "innerRoot", attrId: "inner", children: [] };
  doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "inner" };
  doc.nodes.root.children.push("instance");
  stateReset(doc);
  const original = structuredClone(useEditor.getState().doc);
  useEditor.getState().detachInstance("instance");
  const state = useEditor.getState();
  const detached = state.doc.nodes[state.selection!];
  assert.equal(detached.attrId, "inner-2");
  assert.equal(detached.type, "box");
  assert.ok(state.doc.nodes.root.children.includes(detached.id));
  assert.equal(state.doc.nodes.instance, undefined);
  assert.deepEqual(state.doc.nodes.innerRoot, original.nodes.innerRoot);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes[detached.id].attrId, "inner-2");
});

function stateReset(doc: SiteDoc) {
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage("p");
  useEditor.getState().setEditingComponent("c");
}
});

describe("component-cycle-placement", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
const instance = (id: string, componentId: string) => ({ ...node(id), type: "instance" as const, componentId });
function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Component moves",
    assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "",
      children: ["outside", "ordinary"] } },
    nodes: {
      a: node("a", ["ab"]),
      b: node("b"),
      ab: instance("ab", "B"),
      outside: instance("outside", "A"),
      ordinary: node("ordinary"),
    },
    components: {
      A: { id: "A", name: "A", rootId: "a" },
      B: { id: "B", name: "B", rootId: "b" },
    },
  };
}

test("moving an existing component instance into a dependent master cannot create a cycle", () => {
  const original = fixture();
  assert.equal(validateDocValue(original), null);
  useEditor.getState().replaceDoc(original);
  const before = useEditor.getState();
  useEditor.getState().moveNode("outside", { kind: "node", id: "b" }, 0);
  assert.equal(useEditor.getState().doc, original, "the invalid drag must not change the document");
  assert.deepEqual(useEditor.getState().past, before.past);
  assert.deepEqual(useEditor.getState().future, before.future);
});

test("inserting an instance that recursively references the destination master is rejected", () => {
  const original = fixture();
  useEditor.getState().replaceDoc(original);
  const added = instance("new-instance", "A");
  useEditor.getState().insertNodes([added], added.id, { kind: "node", id: "b" });
  assert.equal(useEditor.getState().doc, original);
  assert.ok(!useEditor.getState().doc.nodes[added.id]);
});

test("noncyclic moves and inserts remain undoable", () => {
  const original = fixture();
  useEditor.getState().replaceDoc(original);
  useEditor.getState().moveNode("ordinary", { kind: "node", id: "b" }, 0);
  assert.equal(validateDocValue(useEditor.getState().doc), null);
  assert.deepEqual(useEditor.getState().doc.nodes.b.children, ["ordinary"]);
  const next = instance("new-independent", "B");
  useEditor.getState().insertNodes([next], next.id, { kind: "page", id: "p" });
  assert.equal(validateDocValue(useEditor.getState().doc), null);
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.nodes[next.id], undefined);
});

test("long acyclic component chains are traversed iteratively", () => {
  const doc = fixture();
  doc.components = {};
  doc.nodes = {};
  for (let i = 0; i < 10000; i++) {
    const rootId = "root-" + i;
    doc.nodes[rootId] = node(rootId, i < 9999 ? ["use-" + i] : []);
    if (i < 9999) doc.nodes["use-" + i] = instance("use-" + i, "comp-" + (i + 1));
    doc.components["comp-" + i] = { id: "comp-" + i, name: "Component", rootId };
  }
  assert.equal(componentsReachable(doc, ["comp-0"]).size, 10000);
});

test("inserting an instance with no definition cannot corrupt an ordinary page", () => {
  const original = fixture();
  useEditor.getState().replaceDoc(original);
  const invalid = instance("missing-definition", "missing-component");
  useEditor.getState().insertNodes([invalid], invalid.id, { kind: "page", id: "p" });
  assert.equal(useEditor.getState().doc, original);
  assert.ok(!useEditor.getState().doc.nodes[invalid.id]);
});
});

describe("component-import-collisions", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
  source.nodes.shared.scripts = [{ id: "script", trigger: "click", steps: [{
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
    id: "shared-script", trigger: "click", steps: [{
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

  // スクリプトの画面が使う操作を通して、元のブロックが変更も削除もされないことを確かめる。
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
});

describe("component-list-export", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");
const compiledUi = new Map<string, string>();
function loadUi(file: string, direct = false) {
  const path = resolve(file), local = createRequire(path), mod = { exports: {} as any };
  let code = compiledUi.get(path);
  if (code === undefined) {
    code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    compiledUi.set(path, code);
  }
  new Function("require", "module", "exports", code)((id: string) => id.endsWith("/lib/store")
    ? { ...local(id), useEditor: (select: any) => select(useEditor.getState()) }
    : direct && id === "react" ? { ...React, useState: (value: unknown) => [value, () => {}] } : local(id), mod, mod.exports);
  return mod.exports;
}
function convert(doc: SiteDoc, nodeId = "card") {
  useEditor.getState().replaceDoc(doc); useEditor.getState().setActivePage("p"); useEditor.getState().select(nodeId);
  // 設定の画面の実際のボタンを取り出し、その onClick から store の操作を呼ぶ。
  const tree = loadUi("components/SettingsPanel.tsx", true).default({ nodeId });
  const find = (el: any): any => {
    if (el?.type === "button" && React.Children.toArray(el.props.children).includes("Create component")) return el;
    return React.Children.toArray(el?.props?.children).map(find).find(Boolean);
  };
  const button = find(tree); assert.ok(button, "SettingsPanel offers component conversion");
  button.props.onClick();
  return useEditor.getState().doc;
}
function canvas(doc: SiteDoc) {
  useEditor.getState().replaceDoc(doc);
  const { VarsCtx } = require("../components/canvas/render");
  const { NodeView } = loadUi("components/canvas/NodeView.tsx"), plan = pagePlan(doc, "p");
  return renderToStaticMarkup(React.createElement(VarsCtx.Provider, { value: {
    pageVars: previewDataVars(doc, "p"), preview: true, fieldValues: {}, clientVars: plan.clientVars, listOps: plan.listOps,
    setFieldValue() {}, refresh() {}, navigate() {},
  } }, doc.pages.p.children.map(id => React.createElement(NodeView, { id, key: id, isTop: true }))));
}
const details = (html: string) => parse(html).querySelectorAll('[id="detail"]').map((el: any) => el.textContent);

test("SettingsPanel component conversion retains nested list rows in Canvas and executed export, undo and reload", async () => {
  const before = componentListDoc(), original = structuredClone(before);
  assert.deepEqual(details(canvas(before)), details(await publishedComponentList(before)));
  const after = convert(before), instance = after.nodes[after.nodes.products.children[0]];
  assert.equal(instance.type, "instance");
  assert.equal(after.components![instance.componentId!].rootId, "card");
  assert.deepEqual(after.nodes.card, before.nodes.card);
  assert.deepEqual(after.nodes.tags, before.nodes.tags);
  assert.deepEqual(before, original, "conversion never mutates its input");
  assert.deepEqual(details(await publishedComponentList(after)), ["Detail First:red", "Detail First:blue", "Detail Second:green", "Detail Second:yellow"]);
  const past = useEditor.getState().past.length;
  useEditor.getState().undo(); assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo(); assert.deepEqual(useEditor.getState().doc, after);
  assert.equal(useEditor.getState().past.length, past);
  const reloaded = JSON.parse(JSON.stringify(after));
  assert.deepEqual(details(canvas(reloaded)), details(await publishedComponentList(reloaded)));
  const saved = structuredClone(after);
  assert.deepEqual(generateProject(after), generateProject(after), "deterministic generated output");
  assert.deepEqual(after, saved, "export does not change the saved document");
});

test("nested component instances retain per-item scripts, independent visibility and existing anchor rules", async () => {
  let doc = componentListDoc();
  // 2段の部品と、ルートが参照になっている部品も、store の変換で作る。
  doc.nodes.tagBox = { ...makeBox(), id: "tagBox", children: ["tags"] };
  doc.nodes.card.children = ["name", "tagBox"];
  doc = convert(doc, "tagBox");
  const inner = doc.nodes.card.children[1];
  doc.nodes[inner].hiddenOn = ["lg"]; doc.nodes[inner].attrId = "ignored-nested";
  doc = convert(doc);
  const outer = doc.nodes.products.children[0];
  doc.nodes[outer].hiddenOn = ["sm"]; doc.nodes[outer].attrId = "card-anchor";
  const names = buildClassNames(doc), html = await publishedComponentList(doc), root = parse(html);
  assert.equal(details(html).length, 4);
  assert.equal(root.querySelectorAll('[id="card-anchor"]').length, 2);
  assert.equal(root.querySelectorAll('[id="ignored-nested"]').length, 0);
  assert.equal(root.querySelectorAll(`[data-instance-hidden="${names.get(outer)}"]`).length, 2);
  assert.equal(root.querySelectorAll(`[data-instance-hidden="${names.get(inner)}"]`).length, 2);
  assert.equal(root.querySelectorAll("[data-row]").length, 6, "component-contained scripts retain both row scopes");
  doc.nodes.card.attrId = "master-card";
  const masterHtml = await publishedComponentList(doc);
  assert.match(masterHtml, /id="master-card"/); assert.doesNotMatch(masterHtml, /id="card-anchor"/);
  // ルートが参照の場合は ID を増やさず、2つの非表示の条件だけを引き継ぐ。
  doc.components!.alias = { id: "alias", name: "Alias", rootId: inner };
  doc.nodes.card.children = ["alias"];
  doc.nodes.alias = { ...makeBox(), id: "alias", type: "instance", componentId: "alias", hiddenOn: ["sm"], attrId: "ignored-alias" };
  const aliasHtml = await publishedComponentList(doc), aliasNames = buildClassNames(doc);
  assert.equal(details(aliasHtml).length, 4);
  assert.doesNotMatch(aliasHtml, /id="ignored-(?:nested|alias)"/);
  assert.ok(aliasHtml.includes(`data-instance-hidden="${aliasNames.get(inner)} ${aliasNames.get("alias")}"`));
});

test("shared list components resolve each page and each placement's own data and server operations", async () => {
  const doc = convert(componentListDoc()), instance = doc.nodes[doc.nodes.products.children[0]];
  doc.nodes.copy = { ...instance, id: "copy" };
  doc.nodes.products.children.push("copy");
  doc.nodes.secondUse = { ...instance, id: "secondUse" };
  doc.pages.second = { ...structuredClone(doc.pages.p), id: "second", slug: "second", children: ["secondUse"], pageScripts: [{
    id: "second-load", trigger: "load", steps: [
      { id: "second-fetch", kind: "fetch", url: "https://example.com/data", as: "tags", preview: { sample: [] } },
      { id: "second-sort", kind: "list-display", mode: "sort", array: "tags", field: "label", dir: "desc", op: "eq", value: "" },
    ],
  }] };
  doc.pageOrder.push("second");
  assert.deepEqual(details(await publishedComponentList(doc)), [
    "Detail First:red", "Detail First:blue", "Detail First:red", "Detail First:blue",
    "Detail Second:green", "Detail Second:yellow", "Detail Second:green", "Detail Second:yellow",
  ]);
  assert.deepEqual(details(await publishedComponentList(doc, "app/second/page.tsx", [{ label: "a" }, { label: "z" }])), ["Detail :z", "Detail :a"]);
  doc.nodes.tags.list!.limit = 1;
  doc.pages.second.pageScripts![0].steps.push({ id: "second-filter", kind: "list-display", mode: "filter", array: "tags", field: "label", op: "eq", not: true, value: "zz", dir: "asc" });
  assert.deepEqual(details(await publishedComponentList(doc, "app/second/page.tsx", [{ label: "a" }, { label: "z" }, { label: "zz" }])), ["Detail :z"]);
});

test("exported list template proxies preserve placeholders under own-only lookup", () => {
  const doc = componentListDoc();
  doc.pages.p.children = ["card"];
  doc.pages.p.pageScripts = [{
    id: "load", trigger: "load",    steps: [{ id: "load-tags", kind: "store-load", key: "tags", into: "tags" }],
  }];
  const source = generateProject(doc).files["app/page.tsx"];
  const helper = source.match(/^function templateVars\(vars: Vars\): Vars \{[\s\S]*?^\}/m)?.[0];
  assert.ok(helper, "client-list pages must include the templateVars helper");
  const code = transformSync(helper + "\nexport { templateVars };", {
    loader: "ts", format: "cjs",
  }).code;
  const output = { exports: {} as { templateVars?: (vars: Record<string, unknown>) => Record<string, unknown> } };
  new Function("module", "exports", code)(output, output.exports);
  const templateVars = output.exports.templateVars;
  assert.ok(templateVars);
  const scope = templateVars(Object.create(null));
  assert.equal(lookupVar(scope, "row.meta.name"), "{row.meta.name}");
  assert.equal(interpolate("Hello {row.meta.name}", scope), "Hello {row.meta.name}");
  const present = Object.assign(Object.create(null), { name: "real" });
  assert.equal(lookupVar(templateVars(present), "name"), "real");
  assert.equal(lookupVar({}, "constructor"), undefined,
    "plain JSON must still reject inherited properties");
});

test("client-list templates retain placeholders and raw content through conversion", async () => {
  const doc = componentListDoc();
  doc.pages.p.children = ["card"];
  doc.pages.p.pageScripts = [{ id: "load", trigger: "load", steps: [
    { id: "load-tags", kind: "store-load", key: "tags", into: "tags" },
  ] }];
  doc.nodes.row.children.push("raw");
  doc.nodes.raw = { ...makeBox(), id: "raw", type: "code", code: { html: "<b>{label}</b>" } };
  doc.nodes.hide.scripts![0].steps.push({ id: "template-url", kind: "open-url", url: "/tags/{label}?literal=\\{label}" });
  const before = await publishedComponentList(doc), after = await publishedComponentList(convert(doc));
  assert.deepEqual(details(after), details(before));
  assert.match(after, /data-client-list/); assert.match(after, /data-tpl/);
  assert.match(after, /data-raw/);
  assert.match(after, /<b>\{label\}<\/b>/, "custom code must remain literal");
  const templateDetail = parse(after).querySelector('[data-tpl] [id="detail"]');
  assert.ok(templateDetail, "the client-list template retains its detail node");
  const parts = JSON.parse(templateDetail.getAttribute("data-text-parts") ?? "[]") as Array<string | { name: string; fallback?: string }>;
  assert.deepEqual(parts.map((part) => typeof part === "string" ? part : { name: part.name }),
    ["Detail ", { name: "name" }, ":", { name: "label" }, ""],
    "text placeholders remain structured, with optional server-side fallback text");
  assert.ok(parts.every((part) =>
    typeof part === "string" || part.fallback === undefined || typeof part.fallback === "string"));
  const templateScripts = (html: string) => parse(html).querySelectorAll("[data-tpl] [data-scripts]")
    .map((el: any) => JSON.parse(el.getAttribute("data-scripts")));
  assert.deepEqual(templateScripts(after), templateScripts(before));
  assert.match(JSON.stringify(templateScripts(after)), /tags.*label.*literal/);
});

test("list-bearing component cycles terminate, while ordinary static component files stay unchanged", async () => {
  const doc = convert(componentListDoc()), instance = doc.nodes[doc.nodes.products.children[0]];
  doc.nodes.cycle = { ...instance, id: "cycle" };
  doc.nodes.card.children.push("cycle");
  const saved = structuredClone(doc);
  assert.equal(details(await publishedComponentList(doc)).length, 4);
  assert.deepEqual(doc, saved);
  doc.nodes.static = { ...makeText("Static content"), id: "static" };
  doc.components!.static = { id: "static", rootId: "static", name: "Static" };
  doc.nodes.staticUse = { ...makeBox(), id: "staticUse", type: "instance", componentId: "static", attrId: "static-anchor" };
  doc.pages.p.children.push("staticUse");
  const mixed = generateProject(doc).files;
  const plain = structuredClone(doc); plain.pages.p.children = ["staticUse"];
  assert.equal(mixed["components/Static.tsx"], generateProject(plain).files["components/Static.tsx"]);
  assert.match(mixed["app/page.tsx"], /<Static instanceId="static-anchor" \/>/);
});

test("static nested components and form boundaries keep their standalone behavior", async () => {
  const doc = convert(componentListDoc()), instance = doc.nodes[doc.nodes.products.children[0]];
  doc.nodes.static = { ...makeText("Static {name}"), id: "static" };
  doc.components!.static = { id: "static", rootId: "static", name: "Static" };
  doc.nodes.staticUse = { ...makeBox(), id: "staticUse", type: "instance", componentId: "static", attrId: "ignored-static-anchor", hiddenOn: ["lg"] };
  doc.nodes.card.children.push("staticUse", "inside-button");
  doc.nodes["inside-button"] = { ...makeText("Inside"), id: "inside-button", semantic: "button" };
  doc.nodes["outside-button"] = { ...makeText("Outside"), id: "outside-button", semantic: "button" };
  doc.nodes.form = { ...makeBox(), id: "form", semantic: "form", children: ["products", "outside-button"] };
  doc.pages.p.children = ["form"];
  instance.attrId = 'card"<&';
  const { files } = generateProject(doc), names = buildClassNames(doc);
  assert.ok(files["app/page.tsx"].includes(`className="${names.get("inside-button")}" type="button"`));
  assert.ok(files["app/page.tsx"].includes(`className="${names.get("outside-button")}" type="submit"`));
  // 検索のフォームのルーターは、この描画のテストの対象外。
  doc.nodes.form.semantic = "div";
  const html = await publishedComponentList(doc);
  assert.doesNotMatch(html, /ignored-static-anchor/);
  assert.match(html, /id="card&quot;&lt;&amp;"/);
  assert.match(html, /data-toggle-show="flex"/);
  assert.match(files["app/page.tsx"], /<Static hiddenClassName="[^"]+" \/>/);
  assert.match(files["components/Static.tsx"], /interpolate\("Static \{name\}", \{\}\)/);
  const standalone = structuredClone(doc); standalone.pages.p.children = ["staticUse"];
  assert.equal(files["components/Static.tsx"], generateProject(standalone).files["components/Static.tsx"]);
});

test("script discovery preserves an instance's own scripts without expanding static components", () => {
  const doc = componentListDoc();
  doc.nodes.staticUse = { ...makeBox(), id: "staticUse", type: "instance", componentId: "missing", scripts: structuredClone(doc.nodes.hide.scripts) };
  assert.equal(hasScriptsInside(doc, "staticUse", new Set()), true);
});

test("converted server and client list projects typecheck", () => {
  const doc = convert(componentListDoc());
  doc.nodes.clientUse = { ...doc.nodes[doc.nodes.products.children[0]], id: "clientUse" };
  doc.pages.client = { ...structuredClone(doc.pages.p), id: "client", slug: "client", children: ["clientUse"], pageScripts: [{
    id: "load", trigger: "load", steps: [
      { id: "load-raw", kind: "store-load", key: "raw-tags", into: "rawTags" },
      { id: "split-tags", kind: "transform", source: "rawTags", into: "tags", transform: { kind: "split", separator: "," } },
    ],
  }] };
  doc.pageOrder.push("client");
  const { files } = generateProject(doc), dir = mkdtempSync(join(tmpdir(), "tsumu-component-list-types-"));
  try {
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content);
    }
    execFileSync(resolve("node_modules/.bin/tsc"), ["--project", join(dir, "tsconfig.json"), "--noEmit", "--incremental", "false"], { cwd: dir, stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
});

describe("component-owner-lookup", () => {
const node = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });

function fixture(): SiteDoc {
  return {
    schemaVersion: 1,
    siteName: "Component ownership",
    assets: {},
    pageOrder: ["p"],
    pages: {
      p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["ordinary"] },
    },
    nodes: {
      ordinary: node("ordinary"),
      outer: node("outer", ["middle"]),
      middle: node("middle", ["inner"]),
      inner: node("inner", ["leaf"]),
      leaf: node("leaf"),
      unattached: node("unattached"),
    },
    components: {
      outerComponent: { id: "outerComponent", name: "Outer", rootId: "outer" },
      innerComponent: { id: "innerComponent", name: "Inner", rootId: "inner" },
    },
  };
}

test("component ownership keeps the original component-order precedence", () => {
  const doc = fixture();
  assert.equal(componentOf(doc, "outer"), "outerComponent");
  assert.equal(componentOf(doc, "middle"), "outerComponent");
  assert.equal(componentOf(doc, "inner"), "outerComponent");
  assert.equal(componentOf(doc, "leaf"), "outerComponent");
  assert.equal(componentOf(doc, "ordinary"), null);
  assert.equal(componentOf(doc, "unattached"), null);
  assert.equal(componentOf(doc, "missing"), null);

  // コンポーネントのルートは、近いマスターから順ではなく、保存されている順に調べる。
  // 順序を入れ替えても、この動作を保つ。
  doc.components = {
    innerComponent: doc.components!.innerComponent,
    outerComponent: doc.components!.outerComponent,
  };
  assert.equal(componentOf(doc, "leaf"), "innerComponent");
  assert.equal(componentOf(doc, "middle"), "outerComponent");
});

test("page-level parent selection takes precedence over node parents", () => {
  const doc = fixture();
  doc.pages.p.children.push("leaf");
  assert.equal(componentOf(doc, "leaf"), null);
  assert.equal(componentOf(doc, "inner"), "outerComponent");
});

test("ownership resolution remains bounded when malformed nodes form a cycle", () => {
  const doc = fixture();
  doc.nodes.outer.children = ["middle"];
  doc.nodes.middle.children = ["outer"];
  doc.components = {
    unrelated: { id: "unrelated", name: "Unrelated", rootId: "unattached" },
    outerComponent: doc.components!.outerComponent,
  };
  assert.equal(componentOf(doc, "outer"), "outerComponent");
  assert.equal(componentOf(doc, "middle"), "outerComponent");
});

test("large documents with many masters retain correct ownership and no mutation", () => {
  const doc = fixture();
  const original = doc.nodes.ordinary;
  for (let i = 0; i < 600; i++) {
    const root = "master-" + i;
    doc.nodes[root] = node(root, ["child-" + i]);
    doc.nodes["child-" + i] = node("child-" + i);
    doc.components!["component-" + i] = { id: "component-" + i, name: "Master", rootId: root };
  }
  for (let i = 0; i < 40; i++) {
    assert.equal(componentOf(doc, "child-599"), "component-599");
  }
  assert.strictEqual(doc.nodes.ordinary, original);
});
});

describe("component-preview", () => {
function renderRoot(patch: Partial<DocNode>, preview = true) {
  const filename = new URL("../components/canvas/NodeView.tsx", import.meta.url);
  const require = createRequire(filename);
  const { VarsCtx } = require("./render");
  const actions: string[] = [];
  const ctx = { preview, pageVars: { destination: "https://example.org/path" }, clientVars: new Set(), refresh: () => actions.push("refresh"), navigate: (url: string) => actions.push(url) };
  const root = { ...makeBox(), id: "root", text: { content: "Click", heading: 0 }, ...patch };
  const state = {
    doc: { nodes: { root, inst: { ...makeBox(), id: "inst", type: "instance", componentId: "c" } }, components: { c: { id: "c", rootId: "root" } }, pages: {} },
    mode: preview ? "preview" : "design", selectedIds: ["inst"], editingText: null,
    setActivePage: (id: string) => actions.push(`page:${id}`),
  };
  const mod = { exports: {} as { NodeView: (props: object) => any } };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "../../lib/store") return { useEditor: (select: any) => select(state) };
    if (id === "react") return { ...React, useContext: (context: unknown) => context === VarsCtx ? ctx : [] };
    return require(id);
  }, mod, mod.exports);
  const element = mod.exports.NodeView({ id: "inst", isTop: true }).props.children;
  const click = () => element.props.onClick({ preventDefault: () => actions.push("prevent"), currentTarget: { closest: () => ({}) } });
  return { element, actions, click };
}

test("component preview retains root IDs and click scripts on the instance element", () => {
  const { element } = renderRoot({ attrId: "menu", scripts: [{ id: "sc", trigger: "click", steps: [{ id: "st", kind: "open-url", url: "https://example.org" }] }] });
  assert.equal(element.props.id, "menu");
  assert.equal(element.props["data-node"], "inst");
  assert.equal(element.props["data-ghost"], "root");
  assert.equal(JSON.parse(element.props["data-scripts"])[0].steps[0].url, "https://example.org");
});

test("component root URL links navigate with interpolated and sanitized URLs", () => {
  const result = renderRoot({ link: { kind: "url", url: "{destination}" } });
  assert.equal(result.element.type, "a");
  assert.equal(result.element.props.href, "https://example.org/path");
  result.click();
  assert.deepEqual(result.actions, ["prevent", "https://example.org/path"]);
  assert.equal(renderRoot({ link: { kind: "url", url: "javascript:alert(1)" } }).element.props.href, "#");
});

test("component root page links switch pages and new-tab links retain protections", () => {
  const page = renderRoot({ link: { kind: "page", pageId: "about" } });
  page.click();
  assert.deepEqual(page.actions, ["prevent", "page:about"]);
  const tab = renderRoot({ link: { kind: "url", url: "https://example.org", newTab: true } });
  assert.equal(tab.element.props.target, "_blank");
  assert.equal(tab.element.props.rel, "noopener noreferrer");
});

test("component root buttons use preview submission behavior without overriding click scripts", () => {
  const button = renderRoot({ semantic: "button" });
  assert.equal(button.element.props.type, "button");
  button.click();
  assert.deepEqual(button.actions, ["refresh"]);
  const scripted = renderRoot({ semantic: "button", scripts: [{ id: "sc", trigger: "click", steps: [] }] });
  assert.equal(scripted.element.props.onClick, undefined);
});

test("component editing stays selectable without activating master links", () => {
  const { element } = renderRoot({ link: { kind: "url", url: "https://example.org" } }, false);
  assert.equal(element.type, "div");
  assert.equal(element.props.href, undefined);
  assert.equal(element.props.onClick, undefined);
  assert.equal(element.props["data-sel"], "true");
});
});

describe("detach-integrity", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
test('detaching preserves independently configured visibility and identity', () => {
  const doc: SiteDoc = {
    siteName: 'Detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: ['instance'] } },
    components: { c: { id: 'c', name: 'Card', rootId: 'master' } },
    nodes: {
      master: { ...makeBox(), id: 'master', name: 'Card', hiddenOn: ['lg'] },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'c', name: 'Footer card', hiddenOn: ['sm'], locked: true },
    },
  };
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  const detached = after.nodes[after.pages.p.children[0]];
  assert.deepEqual(new Set(detached.hiddenOn), new Set(['lg', 'sm']));
  assert.equal(detached.name, 'Footer card');
  assert.equal(detached.locked, true);
});

test('detach keeps the instance anchor and redirects master references without altering originals', () => {
  const doc: SiteDoc = {
    siteName: 'Detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: ['instance', 'other', 'external'] } },
    components: { c: { id: 'c', name: 'Card', rootId: 'master' } },
    nodes: {
      master: { ...makeBox(), id: 'master', attrId: 'master-card', children: ['child'], locked: true, text: { content: '{master-card}', heading: 0 } },
      child: { ...makeBox(), id: 'child', attrId: 'footer-card', link: { kind: 'url', url: '#master-card' }, scripts: [{ id: 'script', trigger: 'click', steps: [{ id: 'step', kind: 'hide', target: 'master-card' }] }] },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'c', attrId: 'footer-card', name: 'Footer' },
      other: { ...makeBox(), id: 'other', type: 'instance', componentId: 'c' },
      external: { ...makeBox(), id: 'external', link: { kind: 'url', url: '#footer-card' } },
    },
  };
  const before = structuredClone(doc);
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  const root = after.nodes[after.pages.p.children[0]];
  assert.equal(root.attrId, 'footer-card');
  assert.equal(root.text!.content, '{footer-card}');
  assert.equal(after.nodes[root.children[0]].link!.url, '#footer-card');
  assert.equal(after.nodes[root.children[0]].attrId, 'footer-card-2');
  const step = after.nodes[root.children[0]].scripts![0].steps[0];
  assert.ok('target' in step);
  assert.equal(step.target, 'footer-card');
  assert.equal(root.hiddenOn, undefined);
  assert.equal(root.locked, undefined, 'master locking must not lock an unlocked instance');
  assert.equal(after.nodes.external.link!.url, '#footer-card');
  assert.deepEqual(after.nodes.master, before.nodes.master);
  assert.deepEqual(after.nodes.other, before.nodes.other);
  assert.deepEqual(doc, before);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
});

test('detach without an instance anchor keeps normal clone ID collision handling', () => {
  const doc: SiteDoc = {
    siteName: 'Detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: ['instance', 'other'] } },
    components: { c: { id: 'c', name: 'Card', rootId: 'master' } },
    nodes: {
      master: { ...makeBox(), id: 'master', attrId: 'card' },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'c' },
      other: { ...makeBox(), id: 'other', type: 'instance', componentId: 'c' },
    },
  };
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  assert.equal(after.nodes[after.pages.p.children[0]].attrId, 'card-2');
});

test('detach in an unused component preserves instance settings and avoids edited-master collisions', () => {
  const doc: SiteDoc = {
    siteName: 'Nested detach', assets: {}, pageOrder: ['p'],
    pages: { p: { id: 'p', name: 'Home', slug: '', title: '', description: '', children: [] } },
    components: {
      outer: { id: 'outer', name: 'Outer', rootId: 'outerRoot' },
      inner: { id: 'inner', name: 'Inner', rootId: 'innerRoot' },
    },
    nodes: {
      outerRoot: { ...makeBox(), id: 'outerRoot', children: ['instance', 'sibling'] },
      sibling: { ...makeBox(), id: 'sibling', attrId: 'nested-anchor-2' },
      innerRoot: { ...makeBox(), id: 'innerRoot', attrId: 'master-anchor', hiddenOn: ['lg'], children: ['child'] },
      child: { ...makeBox(), id: 'child', attrId: 'nested-anchor', link: { kind: 'url', url: '#master-anchor' } },
      instance: { ...makeBox(), id: 'instance', type: 'instance', componentId: 'inner', attrId: 'nested-anchor', name: 'Nested card', locked: true, hiddenOn: ['sm'] },
    },
  };
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage('p');
  useEditor.getState().setEditingComponent('outer');
  const before = structuredClone(useEditor.getState().doc);
  useEditor.getState().detachInstance('instance');
  const after = useEditor.getState().doc;
  const root = after.nodes[after.nodes.outerRoot.children[0]];
  const child = after.nodes[root.children[0]];
  assert.equal(root.attrId, 'nested-anchor');
  assert.equal(root.name, 'Nested card');
  assert.equal(root.locked, true);
  assert.deepEqual(new Set(root.hiddenOn), new Set(['lg', 'sm']));
  assert.equal(child.attrId, 'nested-anchor-3');
  assert.equal(child.link?.url, '#nested-anchor');
  assert.deepEqual(after.nodes.innerRoot, before.nodes.innerRoot);
  assert.deepEqual(after.nodes.sibling, before.nodes.sibling);
  assert.equal(after.nodes.instance, undefined);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
});
});

describe("editor-paste-scope", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
// 実際の Editor の paste の effect を動かす。DOM への伝播とネイティブの貼り付けは、E2E でも確かめる。
function mount(context: "design" | "preview" | "modal" | "script" | "leaving" = "design", active = false) {
  const node = { ...makeText("Copied text"), id: "a", ...(active ? { type: "code" as const, code: { html: "<script>window.pasted = true</script>" } } : {}) };
  useEditor.getState().replaceDoc({ siteName: "Paste scope", assets: {}, pageOrder: ["p"], pages: {
    p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"] },
  }, nodes: { a: node } });
  useEditor.getState().select("a");
  useEditor.getState().setMode(context === "preview" ? "preview" : "design");
  const payload = JSON.stringify(clips.buildClipPayload(useEditor.getState().doc, { nodes: [node], rootIds: ["a"] }));
  const source = readFileSync("components/Editor.tsx", "utf8");
  const start = source.indexOf("    const pending = new Set<ReturnType<typeof startImageInsertion>>();");
  const end = source.indexOf("  }, [initialLoadComplete]);", start);
  assert.ok(start >= 0 && end > start);
  const code = transformSync(`export function attach() {${source.slice(start, end)}}`, { loader: "ts", format: "cjs" }).code;
  const handlers = new Map<string, (event: any) => void>();
  const notices: unknown[] = [];
  const confirmations: ((ok: boolean) => void)[] = [];
  let reads = 0, uploads = 0, cancelled = 0;
  const mod = { exports: {} as any };
  const globals = {
    useEditor: useEditor,
    window: { addEventListener: (type: string, fn: any) => handlers.set(type, fn), removeEventListener: (type: string) => handlers.delete(type) },
    document: { querySelector: (selector: string) => {
      assert.equal(selector, ".se-backdrop, .modal-backdrop:not(.is-leaving)");
      return context === "modal" || context === "script" ? {} : null;
    } },
    setPasteNotice: (notice: unknown) => notices.push(notice),
    // Editor は、この ref を paste の effect の外に持つ。取り出したハンドラーに渡す。
    internalClipboardOwned: { current: false },
    clipboardPayload: clips.clipboardPayload, isOwnClip: clips.isOwnClip, activeContentNames: clips.activeContentNames,
    currentSiteId: () => "default",
    hasClipboardArtwork: () => true,
    clipboardArtworkFile: async () => new File(["image"], "image.png", { type: "image/png" }),
    startImageInsertion: () => { uploads++; return { done: new Promise(() => {}), cancel: () => { cancelled++; } }; },
    insertPointFor: () => ({ parent: { kind: "page", id: "p" } }),
    tr: (s: string) => s,
    showConfirm: () => new Promise<boolean>(resolve => confirmations.push(resolve)),
    userMessage: () => "error",
  };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(
    createRequire(resolve("package.json")), mod, mod.exports, ...Object.values(globals),
  );
  const cleanup = mod.exports.attach();
  return {
    notices, cleanup, confirmations,
    counts: () => ({ reads, uploads, cancelled }),
    snapshot: () => structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future }),
    paste(kind: "elements" | "artwork", target = { tagName: "BODY", isContentEditable: false }) {
      let prevented = false;
      handlers.get("paste")!({ target, preventDefault: () => { prevented = true; }, clipboardData: {
        getData: () => { reads++; return kind === "elements" ? payload : ""; }, types: [], items: [],
      } });
      return prevented;
    },
  };
}

for (const context of ["preview", "modal", "script"] as const) for (const kind of ["elements", "artwork"] as const) {
  test(`${context}: ${kind} paste does not touch the hidden design or start an upload`, () => {
    const f = mount(context), before = f.snapshot();
    assert.equal(f.paste(kind), false);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.counts(), { reads: 0, uploads: 0, cancelled: 0 });
    assert.deepEqual(f.notices, []);
    f.cleanup();
  });
}
for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "DIV"]) test(`native ${tagName} paste is left alone`, () => {
  const f = mount(), before = f.snapshot();
  assert.equal(f.paste("elements", { tagName, isContentEditable: tagName === "DIV" }), false);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.counts().reads, 0);
  f.cleanup();
});
for (const context of ["design", "leaving"] as const) test(`${context}: normal element paste stays one Undo/Redo operation`, () => {
  const f = mount(context), before = f.snapshot();
  assert.equal(f.paste("elements"), true);
  const after = f.snapshot();
  assert.equal(Object.keys(after.doc.nodes).length, 2);
  assert.equal(after.past.length, before.past.length + 1);
  useEditor.getState().undo(); assert.deepEqual(useEditor.getState().doc, before.doc);
  useEditor.getState().redo(); assert.deepEqual(useEditor.getState().doc, after.doc);
  f.cleanup();
});
test("design artwork paste still starts an insertion and cancels it on unmount", () => {
  const f = mount();
  assert.equal(f.paste("artwork"), true);
  assert.equal(f.counts().uploads, 1);
  assert.equal(f.notices.length, 1);
  f.cleanup();
  assert.equal(f.counts().cancelled, 1);
});

for (const change of ["unchanged", "undo", "replace", "edit", "selection", "page", "preview", "script", "unmount", "newer", "decline"] as const) {
  test(`active clipboard confirmation does not outlive ${change}`, async () => {
    const f = mount("design", true);
    useEditor.getState().updateDoc(d => { d.siteName = "Edited"; });
    f.paste("elements");
    assert.equal(f.confirmations.length, 1);
    if (change === "undo") useEditor.getState().undo();
    if (change === "replace") useEditor.getState().replaceDoc(structuredClone(useEditor.getState().doc));
    if (change === "edit") useEditor.getState().updateDoc(d => { d.siteName = "Remote change"; });
    if (change === "selection") useEditor.getState().select(null);
    if (change === "page") useEditor.getState().setActivePage("other");
    if (change === "preview") useEditor.getState().setMode("preview");
    if (change === "script") useEditor.getState().openScriptEditor({ focusNodeId: "a" });
    if (change === "unmount") f.cleanup();
    if (change === "newer") f.paste("elements");
    const before = f.snapshot();
    f.confirmations[0](change !== "decline");
    await new Promise(resolve => setImmediate(resolve));
    if (change === "unchanged") {
      assert.equal(Object.keys(useEditor.getState().doc.nodes).length, 2);
      useEditor.getState().undo();
      assert.deepEqual(useEditor.getState().doc, before.doc);
    } else assert.deepEqual(f.snapshot(), before);
    f.cleanup();
    useEditor.getState().openScriptEditor(null);
  });
}
});

describe("text-paste-fixture", () => {
for (const ignoresConstructorData of [false, true]) {
  test(`synthetic paste preserves the handler payload when the constructor ignores data: ${ignoresConstructorData}`, () => {
    class Transfer {
      data = new Map<string, string>();
      setData(type: string, value: string) { this.data.set(type, value); }
      getData(type: string) { return this.data.get(type) ?? ""; }
    }
    class PasteEvent extends Event {
      #data: Transfer;
      constructor(type: string, init: EventInit & { clipboardData?: Transfer }) {
        super(type, init);
        this.#data = ignoresConstructorData ? new Transfer() : init.clipboardData ?? new Transfer();
      }
      get clipboardData() { return this.#data; }
    }
    const originals = new Map(["DataTransfer", "ClipboardEvent"].map(name =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    Object.assign(globalThis, { DataTransfer: Transfer, ClipboardEvent: PasteEvent });
    try {
      const target = new EventTarget();
      let received: string | undefined;
      target.addEventListener("paste", event => {
        received = (event as PasteEvent).clipboardData.getData("text/plain");
        event.preventDefault();
      });
      const text = "<&>\nHello {profile.name}\n\n";
      const result = dispatchTextPaste(target as HTMLElement, text);
      assert.equal(received, text);
      assert.deepEqual(result, { eventText: text, receivedText: text, canceled: true });
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
});
