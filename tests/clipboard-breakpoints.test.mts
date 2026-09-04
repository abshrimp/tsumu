import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload, parseClipPayload } from "../lib/clip-transfer";
import { closeDialog, useDialogs } from "../lib/dialog";
import { validSiteDoc } from "../lib/doc-tree";
import { isHiddenAt, resolveStyles } from "../lib/style";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

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

test("legacy clipboard without responsive references still pastes", () => {
  const original = source();
  delete original.breakpoints;
  original.nodes.box.styles = { base: { default: { color: "red" } } };
  delete original.nodes.box.hiddenOn;
  const payload = buildClipPayload(original, { nodes: [original.nodes.box], rootIds: ["box"] });
  delete payload.breakpoints;
  state().replaceDoc(original);
  state().setActivePage("p");
  state().select(null);
  state().pasteClipboard(parseClipPayload(JSON.stringify(payload))!);
  assert.notEqual(state().selection, "box");
  assert.deepEqual(state().doc.nodes[state().selection!].styles, original.nodes.box.styles);
});

test("legacy responsive clipboard requires a new copy rather than guessing widths from IDs", () => {
  const original = source();
  const payload = buildClipPayload(original, { nodes: [original.nodes.box], rootIds: ["box"] });
  delete payload.breakpoints;
  state().replaceDoc(original);
  state().setActivePage("p");
  const before = state();
  state().pasteClipboard(payload);
  assert.strictEqual(state().doc, before.doc);
  assert.strictEqual(state().past, before.past);
  const alert = useDialogs.getState().queue.at(-1)!;
  assert.equal(alert.kind, "alert");
  closeDialog(alert.id);
});

for (const metadata of [false, true]) {
  for (const hiddenOn of ["phone", { phone: true }, [42]]) {
    test(`malformed visibility is rejected without mutation (metadata: ${metadata}, value: ${JSON.stringify(hiddenOn)})`, () => {
      const original = source();
      const raw = buildClipPayload(original, { nodes: [structuredClone(original.nodes.box)], rootIds: ["box"] });
      if (!metadata) delete raw.breakpoints;
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
