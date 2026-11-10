import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { applyAiOps, buildAiContext } from "../lib/aiOps";
import { applyAiEdits } from "../lib/ai/client";
import { validSiteDoc } from "../lib/doc-tree";
import { makeBox } from "../lib/presets";
import { compileScripts, walkSteps } from "../lib/script";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { useEditor } from "../lib/store";
import { SELF_TARGET, type ScriptStep, type SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  const nodes = Object.fromEntries(["group", "button", "first", "second", "result", "outside"].map(id =>
    [id, { ...makeBox(), id, attrId: id }],
  ));
  nodes.group.children = ["button", "first", "second", "result"];
  for (const id of ["first", "second"]) {
    nodes[id].type = "field";
    nodes[id].field = { kind: "checkbox" };
  }
  nodes.button.scripts = [{ id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps: [{
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

// Execute the shared preview runtime and the feature-pruned published runtime.
// Only DOM lookup/event plumbing is replaced; conditions and actions are real.
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
