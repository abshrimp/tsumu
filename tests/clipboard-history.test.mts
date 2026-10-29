import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { assetSrc, mediaSrc } from "../lib/assets";
import { makeBox, makeImage, makeText, createInitialDoc } from "../lib/presets";
import { useEditor } from "../lib/store";
import { type SiteDoc } from "../lib/types";
import { renderAnchorExport } from "./helpers/instance-anchor";
import { buildClipPayload, parseClipPayload, remapAssetIds, type ClipPayload } from "../lib/clip-transfer";
import { validSiteDoc, MAX_NODE_DEPTH } from "../lib/doc-tree";
import { useDialogs } from "../lib/dialog";
import { validateDocValue } from "../lib/doc-storage";

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
