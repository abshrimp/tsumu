import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { startImageDrop, type ImageDropPoint } from "../lib/image-drop";
import { useEditor } from "../lib/store";
import { makeBox } from "../lib/presets";
import { useDialogs } from "../lib/dialog";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Image drop", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: ["c"] },
    },
    nodes: Object.fromEntries(["a", "b", "c", "root"].map((id) => [id, { ...makeBox(), id }])),
    components: { comp: { id: "comp", name: "Component", rootId: "root" } },
  };
}
const state = () => useEditor.getState();
const originalFetch = globalThis.fetch;
const originalImage = globalThis.Image;
const pending: ((ok?: boolean) => void)[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const files = (...names: string[]) => names.map((name) => new File(["fixture"], name, { type: name.endsWith(".txt") ? "text/plain" : "image/png" }));
const point = { parent: { kind: "page" as const, id: "p" } };

beforeEach(() => {
  state().endGesture();
  state().replaceDoc(fixture());
  state().setActivePage("p");
  state().setMode("design");
  state().select("a");
  useDialogs.setState({ queue: [] });
  pending.length = 0;
  globalThis.Image = class {
    naturalWidth = 10; naturalHeight = 20; onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  } as unknown as typeof Image;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/assets");
    return new Promise<Response>((resolve) => {
      const index = pending.length;
      pending.push((ok = true) => resolve(ok
        ? Response.json({ path: `assets/drop-${index}.png` })
        : Response.json({ error: "upload failed" }, { status: 400 })));
    });
  };
});
afterEach(() => { state().endGesture(); globalThis.fetch = originalFetch; globalThis.Image = originalImage; });
async function begin(names = ["new.png"], target: ImageDropPoint = point) {
  const task = startImageDrop(files(...names), target);
  await tick();
  return task;
}
function nodeNames(ids: string[]) { return ids.map((id) => state().doc.nodes[id].name); }
function withoutAssets(doc: SiteDoc) { return { ...doc, assets: {} }; }

test("one drop inserts every image in order and is one complete Undo/Redo action", async () => {
  const before = structuredClone(state().doc);
  const task = await begin(["one.png", "ignore.txt", "two.png"], { ...point, index: 1 });
  pending[0](); await tick();
  assert.deepEqual(state().doc, before, "do not expose half a batch while the next upload is pending");
  assert.equal(pending.length, 2);
  pending[1](); await task.done;
  assert.deepEqual(nodeNames(state().doc.pages.p.children), ["ボックス", "one.png", "two.png", "ボックス"]);
  assert.equal(Object.keys(state().doc.assets).length, 2);
  assert.equal(state().past.length, 1);
  const after = structuredClone(state().doc);
  state().undo(); assert.deepEqual(state().doc, before);
  state().redo(); assert.deepEqual(state().doc, after);
});

for (const change of ["page", "selection", "component", "away-and-back", "multi-selection", "preview"] as const) {
  test(`a later ${change} never loses its selection to an old completed drop`, async () => {
    const task = await begin();
    if (change === "page") { state().setActivePage("q"); state().select("c"); }
    if (change === "selection") state().select("b");
    if (change === "component") state().setEditingComponent("comp");
    if (change === "away-and-back") { state().select("b"); state().select("a"); }
    if (change === "multi-selection") state().selectMany(["a", "b"], "a");
    if (change === "preview") state().setMode("preview");
    const selection = state().selection; const selectedIds = [...state().selectedIds];
    pending[0](); await task.done;
    assert.equal(state().doc.pages.p.children.length, 3, "keep the original valid drop destination");
    assert.deepEqual(state().doc.pages.q.children, ["c"]);
    assert.equal(state().selection, selection);
    assert.deepEqual(state().selectedIds, selectedIds);
  });
}

test("leaving a component preserves the destination and the page's newer selection", async () => {
  state().setEditingComponent("comp");
  const task = await begin(["component.png"], { parent: { kind: "node", id: "root" } });
  state().setActivePage("q"); state().select("c");
  pending[0](); await task.done;
  assert.deepEqual(nodeNames(state().doc.nodes.root.children), ["component.png"]);
  assert.deepEqual(state().doc.pages.q.children, ["c"]);
  assert.equal(state().selection, "c");
});

test("site name and unrelated node edits do not cancel a valid drop or get overwritten", async () => {
  const task = await begin();
  state().updateDoc((doc) => { doc.siteName = "Renamed"; doc.nodes.b.name = "Edited"; });
  const edited = structuredClone(state().doc);
  pending[0](); await task.done;
  assert.equal(state().doc.siteName, "Renamed");
  assert.equal(state().doc.nodes.b.name, "Edited");
  assert.equal(state().doc.pages.p.children.length, 3);
  state().undo(); assert.deepEqual(state().doc, edited);
});

test("a pending sibling insertion follows its anchor when unrelated siblings change", async () => {
  const task = await begin(["new.png"], { ...point, index: 1 });
  state().updateDoc((doc) => {
    doc.nodes.extra = { ...makeBox(), id: "extra", name: "Extra" };
    doc.pages.p.children.unshift("extra");
  });
  pending[0](); await task.done;
  assert.deepEqual(nodeNames(state().doc.pages.p.children), ["Extra", "ボックス", "new.png", "ボックス"]);
});

for (const destination of ["page", "node", "component"] as const) {
  test(`deleted ${destination} retains the successful upload without inserting orphan nodes`, async () => {
    if (destination === "component") state().setEditingComponent("comp");
    const task = await begin(["new.png"], destination === "page" ? point : { parent: { kind: "node", id: destination === "node" ? "a" : "root" } });
    if (destination === "page") state().deletePage("p");
    if (destination === "node") state().deleteNode("a");
    if (destination === "component") state().deleteComponent("comp");
    const before = structuredClone(state().doc);
    pending[0](); await task.done;
    assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
    assert.equal(Object.keys(state().doc.assets).length, 1);
    assert.equal(useDialogs.getState().queue.length, 0);
    state().undo(); assert.equal(Object.keys(state().doc.assets).length, 1, "the uploaded file also survives undoing deletion");
  });
}

test("Undo during a batch cancels placement, retains successful files and preserves Redo", async () => {
  state().updateNode("b", { name: "Edited" });
  const edited = structuredClone(state().doc);
  const task = await begin(["one.png", "two.png", "three.png"]);
  pending[0](); await tick();
  assert.equal(pending.length, 2);
  state().undo();
  const undone = structuredClone(state().doc);
  assert.equal(state().future.length, 1);
  pending[1](); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(undone));
  assert.equal(pending.length, 2, "do not start further uploads after cancellation");
  assert.equal(Object.keys(state().doc.assets).length, 2);
  assert.equal(state().future.length, 1);
  state().redo(); assert.deepEqual(withoutAssets(state().doc), withoutAssets(edited));
  assert.equal(Object.keys(state().doc.assets).length, 2);
});

test("a failed second upload keeps only completed files in Assets and leaves the drop atomic", async () => {
  const before = structuredClone(state().doc);
  const task = await begin(["one.png", "two.png", "three.png"]);
  pending[0](); await tick(); pending[1](false); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
  assert.equal(Object.keys(state().doc.assets).length, 1);
  assert.equal(state().past.length, 0);
  assert.equal(useDialogs.getState().queue.length, 1);
  const retry = await begin(["retry.png"]);
  pending[2](); await retry.done;
  assert.equal(state().doc.pages.p.children.length, 3);
});

test("cancel and unmount retain an in-flight success without placing or starting remaining files", async () => {
  const before = structuredClone(state().doc);
  const task = await begin(["one.png", "two.png"]);
  task.cancel(); pending[0](); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
  assert.equal(Object.keys(state().doc.assets).length, 1);
  assert.equal(pending.length, 1);
});

test("a canceled failed upload is quiet", async () => {
  const task = await begin(); task.cancel(); pending[0](false); await task.done;
  assert.equal(useDialogs.getState().queue.length, 0);
  assert.equal(Object.keys(state().doc.assets).length, 0);
});

for (const olderFirst of [true, false]) {
  test(`overlapping drops preserve both batches and the newer selection (${olderFirst ? "old" : "new"} finishes first)`, async () => {
    const older = await begin(["old.png"]);
    const newer = await begin(["new.png"]);
    pending[olderFirst ? 0 : 1](); await (olderFirst ? older : newer).done;
    const firstSelection = state().selection;
    if (olderFirst) assert.equal(firstSelection, "a");
    pending[olderFirst ? 1 : 0](); await (olderFirst ? newer : older).done;
    assert.equal(state().doc.pages.p.children.length, 4);
    assert.equal(state().doc.nodes[state().selection!].name, "new.png");
    state().undo(); assert.equal(state().doc.pages.p.children.length, 3);
    state().undo(); assert.equal(state().doc.pages.p.children.length, 2);
  });
}

test("unsupported files do not mutate the document or upload anything", async () => {
  const before = structuredClone(state().doc);
  await startImageDrop(files("ignore.txt"), point).done;
  assert.deepEqual(state().doc, before);
  assert.equal(pending.length, 0);
});

for (const change of ["undo-redo", "redo", "replace", "restore"] as const) {
  test(`${change} while uploading never revives a pending placement`, async () => {
    state().updateNode("b", { name: "Edited" });
    if (change === "redo") state().undo();
    const task = await begin();
    if (change === "undo-redo") { state().undo(); state().redo(); }
    if (change === "redo") state().redo();
    if (change === "replace") state().replaceDoc(structuredClone(state().doc));
    if (change === "restore") { const doc = structuredClone(state().doc); doc.siteName = "Restored"; state().restoreDoc(doc); }
    const before = structuredClone(state().doc); const future = state().future.length;
    pending[0](); await task.done;
    assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
    assert.equal(Object.keys(state().doc.assets).length, 1);
    assert.equal(state().future.length, future);
  });
}

test("no-op Undo does not cancel a valid pending placement", async () => {
  const task = await begin(); state().undo(); pending[0](); await task.done;
  assert.equal(state().doc.pages.p.children.length, 3);
});

test("a destination moved to a different page no longer receives a delayed drop", async () => {
  const task = await begin(["new.png"], { parent: { kind: "node", id: "a" } });
  state().moveNodes(["a"], { kind: "page", id: "q" }, 1);
  const before = structuredClone(state().doc);
  pending[0](); await task.done;
  assert.deepEqual(withoutAssets(state().doc), withoutAssets(before));
  assert.equal(Object.keys(state().doc.assets).length, 1);
});

test("invalid files or destinations do not steal selection from an earlier valid drop", async () => {
  const task = await begin();
  await startImageDrop(files("ignore.txt"), point).done;
  await startImageDrop(files("orphan.png"), { parent: { kind: "node", id: "missing" } }).done;
  pending[0](); await task.done;
  assert.equal(state().doc.nodes[state().selection!].name, "new.png");
  assert.equal(pending.length, 1);
});

test("browser fixture bundles the actual Canvas, layer panel and drop implementation", async () => {
  const { imageDropBundle } = await import("./helpers/image-drop");
  const bundle = await imageDropBundle();
  assert.match(bundle, /function Canvas/);
  assert.match(bundle, /function LayersTab/);
  assert.match(bundle, /function startImageDrop/);
});

for (const reason of ["unmount", "undo", "deleted target"] as const) {
  test(`${reason} releases the pending store subscription before the network completes`, async () => {
    const subscribe = useEditor.subscribe;
    let subscriptions = 0;
    useEditor.subscribe = (listener) => {
      subscriptions++;
      const unsubscribe = subscribe(listener);
      let listening = true;
      return () => {
        unsubscribe();
        if (listening) { listening = false; subscriptions--; }
      };
    };
    try {
      if (reason === "undo") state().updateNode("b", { name: "Edited" });
      const task = await begin();
      assert.equal(subscriptions, 1);
      if (reason === "unmount") task.cancel();
      if (reason === "undo") state().undo();
      if (reason === "deleted target") state().deletePage("p");
      assert.equal(subscriptions, 0, "do not wait for a slow or stalled response to unsubscribe");
      pending[0](); await task.done;
      task.cancel();
      assert.equal(subscriptions, 0, "settling and repeated cancellation are safe");
      assert.equal(Object.keys(state().doc.assets).length, 1, "completed upload is retained without a live subscription");
    } finally { useEditor.subscribe = subscribe; }
  });
}

for (const transient of [false, true]) {
  test(`a completed upload waits for the active ${transient ? "transient" : "ordinary"} gesture and gets its own Undo`, async () => {
    const before = structuredClone(state().doc);
    const task = await begin();
    state().beginGesture();
    state().setStyleProps("a", { paddingLeft: "10px" }, { transient });
    pending[0](); await tick();
    assert.equal(state().doc.pages.p.children.length, 2, "do not insert while the control still owns a gesture");
    assert.equal(state().gestureActive, true);
    state().setStyleProps("a", { paddingLeft: "20px" }, { transient });
    const edited = structuredClone(state().doc);
    state().endGesture();
    assert.equal(state().doc.pages.p.children.length, 2, "endGesture does not synchronously change the control's selection");
    await task.done;
    const after = structuredClone(state().doc);
    assert.equal(after.pages.p.children.length, 3);
    assert.equal(state().past.length, 2);
    state().undo(); assert.deepEqual(state().doc, edited);
    state().undo(); assert.deepEqual(state().doc, before);
    state().redo(); assert.deepEqual(state().doc, edited);
    state().redo(); assert.deepEqual(state().doc, after);
  });
}

test("a new gesture started before the release microtask keeps placement waiting", async () => {
  const task = await begin();
  state().beginGesture(); state().updateNode("a", { name: "First" });
  pending[0](); await tick();
  state().endGesture(); state().beginGesture();
  await tick(); assert.equal(state().doc.pages.p.children.length, 2);
  state().updateNode("a", { name: "Second" });
  const edited = structuredClone(state().doc);
  state().endGesture(); await task.done;
  state().undo(); assert.deepEqual(state().doc, edited);
});

for (const reason of ["unmount", "undo", "delete"] as const) {
  test(`${reason} releases an already uploaded batch without waiting for gesture end`, async () => {
    const task = await begin();
    state().beginGesture(); state().updateNode("b", { name: "Edited" });
    pending[0](); await tick();
    assert.equal(Object.keys(state().doc.assets).length, 0);
    if (reason === "unmount") task.cancel();
    if (reason === "undo") state().undo();
    if (reason === "delete") state().deletePage("p");
    await task.done;
    assert.equal(state().gestureActive, reason !== "undo",
      "only Undo ends the gesture; cancelling the drop itself must not end another control's gesture");
    assert.equal(Object.keys(state().doc.assets).length, 1);
    assert.equal(Object.values(state().doc.nodes).filter((node) => node.type === "image").length, 0);
    if (reason === "undo") assert.equal(state().future.length, 1);
    state().endGesture(); await tick();
    assert.equal(Object.values(state().doc.nodes).filter((node) => node.type === "image").length, 0);
  });
}

test("an empty gesture adds no history entry when the waiting drop resumes", async () => {
  const task = await begin(); state().beginGesture(); pending[0](); await tick();
  state().endGesture(); await task.done;
  assert.equal(state().past.length, 1);
  state().undo(); assert.equal(state().doc.pages.p.children.length, 2);
});

test("overlapping gesture owners share the original checkpoint and all must finish before placement", async () => {
  const before = structuredClone(state().doc);
  const task = await begin();
  const first = state().beginGesture(); state().setStyleProps("a", { paddingLeft: "10px" });
  const second = state().beginGesture(); state().setStyleProps("a", { borderRadius: "10px" }, { transient: true });
  pending[0](); await tick();
  first(); first(); await tick();
  assert.equal(state().gestureActive, true);
  assert.equal(state().doc.pages.p.children.length, 2);
  state().setStyleProps("a", { borderRadius: "20px" }, { transient: true });
  const edited = structuredClone(state().doc);
  second(); await task.done;
  assert.equal(state().past.length, 2);
  state().undo(); assert.deepEqual(state().doc, edited);
  state().undo(); assert.deepEqual(state().doc, before);
});

test("stale owner endings cannot release a new gesture after endGesture clears all owners", async () => {
  const first = state().beginGesture();
  const second = state().beginGesture();
  state().endGesture();
  const current = state().beginGesture();
  const task = await begin(); pending[0](); await tick();
  first(); second(); await tick();
  assert.equal(state().gestureActive, true);
  assert.equal(state().doc.pages.p.children.length, 2);
  current(); await task.done;
  assert.equal(state().gestureActive, false);
  assert.equal(state().doc.pages.p.children.length, 3);
});

test("endGesture explicitly releases all owners and resumes the pending drop once", async () => {
  const task = await begin();
  const first = state().beginGesture(); state().updateNode("a", { name: "Changed" });
  const second = state().beginGesture();
  pending[0](); await tick();
  state().endGesture(); await task.done;
  assert.equal(state().gestureActive, false);
  assert.equal(state().doc.pages.p.children.length, 3);
  first(); second(); state().endGesture();
  assert.equal(state().doc.pages.p.children.length, 3);
  state().undo(); assert.equal(state().doc.nodes.a.name, "Changed");
});

for (const change of ["page", "undo", "delete", "unmount"] as const) {
  test(`deferred clipboard decoding captures intent before ${change}`, async () => {
    const { startImageInsertion } = await import("../lib/image-drop");
    let decoded!: (files: File[]) => void;
    if (change === "undo") state().updateNode("b", { name: "Edited" });
    const task = startImageInsertion(() => new Promise<File[]>((resolve) => { decoded = resolve; }), point, { quiet: true });
    if (change === "page") { state().setActivePage("q"); state().select("c"); }
    if (change === "undo") state().undo();
    if (change === "delete") state().deletePage("p");
    if (change === "unmount") task.cancel();
    decoded(files("decoded.png")); await tick();
    if (change === "page") { pending[0](); } else assert.equal(pending.length, 0, "cancel before starting an upload");
    const result = await task.done;
    assert.equal(result.inserted, change === "page");
    if (change === "page") { assert.equal(state().doc.pages.p.children.length, 3); assert.equal(state().selection, "c"); }
    if (change === "undo") assert.equal(state().future.length, 1);
  });
}

test("a rejected clipboard decoder is returned without a drop alert or history entry", async () => {
  const { startImageInsertion } = await import("../lib/image-drop");
  const error = new Error("cannot decode");
  const task = startImageInsertion(async () => { throw error; }, point, { quiet: true });
  assert.equal((await task.done).error, error);
  assert.equal(pending.length, 0);
  assert.equal(state().past.length, 0);
  assert.equal(useDialogs.getState().queue.length, 0);
});

function deepDropTarget(depth: number) {
  const doc = fixture();
  for (let i = 1; i <= depth; i++) {
    const id = `deep-${i}`;
    doc.nodes[id] = { ...makeBox(), id, children: i < depth ? [`deep-${i + 1}`] : [] };
  }
  doc.pages.p.children = ["deep-1"];
  state().replaceDoc(doc);
  return { parent: { kind: "node" as const, id: `deep-${depth}` } };
}

test("image drops reject an already maximal-depth destination before upload", async () => {
  const target = deepDropTarget(256);
  const before = state().doc;
  const task = await begin(["too-deep.png"], target);
  assert.equal(pending.length, 0);
  await task.done;
  assert.equal(state().doc, before);
});

test("image drops preserve exact-depth placement and undo", async () => {
  const target = deepDropTarget(255);
  const before = state().doc;
  const task = await begin(["valid.png"], target);
  pending[0]();
  await task.done;
  assert.equal(state().doc.nodes[target.parent.id].children.length, 1);
  state().undo();
  assert.deepEqual(state().doc, before);
});

test("a destination deepened during upload retains the asset without inserting an invalid tree", async () => {
  const target = deepDropTarget(255);
  const task = await begin(["pending.png"], target);
  state().updateDoc(doc => {
    doc.nodes.wrapper = { ...makeBox(), id: "wrapper", children: ["deep-1"] };
    doc.pages.p.children = ["wrapper"];
  });
  const before = withoutAssets(state().doc);
  pending[0]();
  const result = await task.done;
  assert.equal(result?.inserted, false);
  assert.deepEqual(withoutAssets(state().doc), before);
  assert.equal(Object.keys(state().doc.assets).length, 1);
});
