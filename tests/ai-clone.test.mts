import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAiOps, buildAiContext, type AiOp } from "../lib/aiOps";
import { applyAiEdits, AiEditConflict } from "../lib/ai/client";
import { parseAiRequest } from "../lib/ai/request";
import { makeBox } from "../lib/presets";
import { walkSteps } from "../lib/script";
import { useEditor } from "../lib/store";
import { SELF_TARGET, type DocNode, type SiteDoc } from "../lib/types";
import { aiCloneDoc } from "./helpers/ai-clone";

const target = { pageId: "p" };
const duplicate: AiOp = { op: "duplicate", id: "group", newId: "copy", ref: "copied" };
const copied = (doc: SiteDoc, root = "copy") => doc.nodes[root].children.map((id) => doc.nodes[id]);
function identities(nodes: DocNode[]) {
  const ids: string[] = [];
  for (const node of nodes) for (const script of node.scripts ?? []) {
    ids.push(script.id);
    walkSteps(script.steps, (step) => { ids.push(step.id); });
  }
  return ids;
}

// サーバーの部分文書で確定し、ブラウザの全文書で同じ操作を再生する。
test("AI duplicate preserves isolated targets, field tokens and anchors with exact replay and one undo", () => {
  const original = aiCloneDoc();
  const context = buildAiContext(original, target);
  const parsed = parseAiRequest(JSON.parse(JSON.stringify({ messages: [{ role: "user", text: "Duplicate the group" }], context })));
  const server = parsed.context.doc;
  const result = applyAiOps(server, [duplicate], parsed.context.target);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.applied, [{ op: "duplicate", id: "group", newId: "copy" }]);
  const [button, menu, entry, readout, jump] = copied(server);
  assert.notEqual(menu.attrId, "menu");
  assert.notEqual(entry.attrId, "entry");
  assert.deepEqual(button.scripts![0].steps.map((s) => "target" in s && s.target), [menu.attrId, entry.attrId]);
  assert.equal(readout.text!.content, `{${entry.attrId}}`);
  assert.equal(jump.link!.url, `#${menu.attrId}`);
  const beforeIds = identities(Object.values(original.nodes));
  const afterIds = identities(copied(server));
  assert.equal(new Set(afterIds).size, afterIds.length);
  assert.ok(afterIds.every((id) => !beforeIds.includes(id)));
  for (const [id, node] of Object.entries(original.nodes)) assert.deepEqual(server.nodes[id], node);
  useEditor.getState().replaceDoc(original);
  useEditor.getState().updateDoc((doc) => applyAiEdits(doc, context, result.applied));
  assert.deepEqual(buildAiContext(useEditor.getState().doc, target).doc, server);
  assert.equal(useEditor.getState().past.length, 1);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
  useEditor.getState().redo();
  assert.deepEqual(buildAiContext(useEditor.getState().doc, target).doc, server);
});

test("nested if/repeat/for-each references are remapped while external targets and self remain intact", () => {
  const original = aiCloneDoc();
  original.nodes.button.scripts![0].steps.push({
    id: "condition", kind: "if", cond: { subject: "value", target: "entry", left: "{menu.text}", value: "{outside}" },
    then: [{ id: "repeat", kind: "repeat", times: 2, then: [
      { id: "each", kind: "for-each", array: "menu.items", then: [
        { id: "value", kind: "set-value", target: "entry", value: "{menu.text}|{outside}|{entry}" },
        { id: "anchor", kind: "open-url", url: "#menu" },
        { id: "external", kind: "hide", target: "outside" },
      ] },
    ] }],
    else: [{ id: "self", kind: "show", target: SELF_TARGET }, { id: "external-link", kind: "open-url", url: "#outside" }],
  });
  original.nodes.entry.field = { kind: "select", defaultValue: "{menu.text}", placeholder: "{outside}", options: ["{entry}", "{outside}"].map(value => ({label:value,value})) };
  original.nodes.readout.text!.content = "{menu.text} / {outside}";
  original.nodes.jump.link!.url = "https://example.test/{entry}/{outside}";
  original.nodes.readout.image = { src: "{entry}", alt: "", width: 1, height: 1 };
  const before = structuredClone(original);
  assert.deepEqual(applyAiOps(original, [duplicate], target).errors, []);
  const [button, menu, entry, readout, jump] = copied(original);
  const nested = button.scripts![0].steps[2];
  assert.equal(nested.kind, "if");
  if (nested.kind !== "if") return;
  assert.deepEqual(nested.cond, { subject: "value", target: entry.attrId, left: `{${menu.attrId}.text}`, value: "{outside}" });
  const steps = new Map<string, any>();
  walkSteps(nested.then, (step) => { steps.set(step.kind, step); });
  assert.equal(steps.get("for-each").array, `${menu.attrId}.items`);
  assert.equal(steps.get("set-value").target, entry.attrId);
  assert.equal(steps.get("set-value").value, `{${menu.attrId}.text}|{outside}|{${entry.attrId}}`);
  assert.equal(steps.get("open-url").url, `#${menu.attrId}`);
  assert.equal(steps.get("hide").target, "outside");
  assert.deepEqual(nested.else!.map(({ id: _, ...step }) => step), [
    { kind: "show", target: SELF_TARGET }, { kind: "open-url", url: "#outside" },
  ]);
  assert.equal(readout.text!.content, `{${menu.attrId}.text} / {outside}`);
  assert.equal(readout.image!.src, `{${entry.attrId}}`);
  assert.equal(jump.link!.url, `https://example.test/{${entry.attrId}}/{outside}`);
  assert.deepEqual(entry.field, { kind: "select", defaultValue: `{${menu.attrId}.text}`, placeholder: "{outside}", options: [`{${entry.attrId}}`, "{outside}"].map(value => ({label:value,value})) });
  const ids = identities(copied(original));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => !identities(Object.values(before.nodes)).includes(id)));
  for (const [id, node] of Object.entries(before.nodes)) assert.deepEqual(original.nodes[id], node);
});

test("script-only duplicates receive fresh identities even without any ID attributes", () => {
  const doc = aiCloneDoc();
  delete doc.nodes.button.attrId;
  const original = structuredClone(doc.nodes.button);
  const result = applyAiOps(doc, [{ op: "duplicate", id: "button", newId: "copy" }], target);
  assert.deepEqual(result.errors, []);
  assert.equal(doc.nodes.copy.attrId, undefined);
  const originalIds = identities([original]);
  assert.ok(identities([doc.nodes.copy]).every((id) => !originalIds.includes(id)));
  assert.deepEqual(doc.nodes.copy.scripts![0].steps.map(({ id: _, ...step }) => step), original.scripts![0].steps.map(({ id: _, ...step }) => step));
  assert.deepEqual(doc.nodes.button, original);
});

test("refs survive tool calls and duplicating a duplicate produces independent replayable identities", () => {
  const original = aiCloneDoc();
  const context = buildAiContext(original, target);
  const server = structuredClone(context.doc);
  const refs = new Map<string, string>();
  const first = applyAiOps(server, [duplicate], target, refs);
  const second = applyAiOps(server, [
    { op: "duplicate", id: "copied", newId: "copy2", ref: "second" },
    { op: "rename", id: "second", name: "Second copy" },
  ], target, refs);
  assert.deepEqual([...first.errors, ...second.errors], []);
  assert.equal(server.nodes.copy2.name, "Second copy");
  const ids1 = identities(copied(server));
  assert.ok(identities(copied(server, "copy2")).every((id) => !ids1.includes(id)));
  const [button, menu] = copied(server, "copy2");
  assert.equal((button.scripts![0].steps[0] as any).target, menu.attrId);
  assert.notEqual(menu.attrId, copied(server)[1].attrId);
  applyAiEdits(original, context, [...first.applied, ...second.applied]);
  assert.deepEqual(buildAiContext(original, target).doc, server);
});

function withMaster() {
  const doc = aiCloneDoc();
  doc.components = { cmp: { id: "cmp", name: "Component", rootId: "master" } };
  doc.nodes.master = { ...makeBox(), id: "master", children: ["private"] };
  doc.nodes.private = { ...makeBox(), id: "private", attrId: "menu-2" };
  doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "cmp" };
  doc.pages.p.children.push("instance");
  return doc;
}

test("omitted component masters cannot change the server's chosen identities", () => {
  const original = withMaster();
  const before = structuredClone(original);
  const context = buildAiContext(original, target);
  assert.equal(context.doc.nodes.private, undefined);
  assert.equal(context.doc.components, undefined);
  const server = structuredClone(context.doc);
  const result = applyAiOps(server, [duplicate], target);
  assert.deepEqual(result.errors, []);
  applyAiEdits(original, context, result.applied);
  assert.deepEqual(buildAiContext(original, target).doc, server);
  assert.deepEqual(original.nodes.private, before.nodes.private);
});

test("component editing isolates duplicates and preserves root and outside-page scope", () => {
  const original = withMaster();
  original.nodes.master.children = ["group"];
  original.pages.p.children = ["instance", "outside"];
  const context = buildAiContext(original, { ...target, componentId: "cmp" });
  const parsed = parseAiRequest(JSON.parse(JSON.stringify({ messages: [{ role: "user", text: "Duplicate the group" }], context })));
  const server = parsed.context.doc;
  const result = applyAiOps(server, [duplicate], parsed.context.target);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(server.nodes.master.children, ["group", "copy"]);
  assert.deepEqual(applyAiOps(server, [{ op: "duplicate", id: "master" }, { op: "duplicate", id: "outside" }], context.target).applied, []);
  const beforeOutside = structuredClone(original.nodes.outside);
  applyAiEdits(original, context, result.applied);
  assert.deepEqual(buildAiContext(original, { ...target, componentId: "cmp" }).doc, server);
  assert.deepEqual(original.nodes.outside, beforeOutside);
  const [button, menu] = copied(original);
  assert.equal((button.scripts![0].steps[0] as any).target, menu.attrId);
});

for (const kind of ["node", "attr", "radio", "script", "step", "page-script", "page-step"] as const) {
  test(`a hidden ${kind} identity collision rejects the whole client batch without history or partial clones`, () => {
    const original = withMaster();
    const context = buildAiContext(original, target);
    const server = structuredClone(context.doc);
    const result = applyAiOps(server, [duplicate], target);
    assert.deepEqual(result.errors, []);
    const [button, menu] = copied(server);
    const hidden = original.nodes.private;
    if (kind === "node") original.nodes.copy_2 = { ...makeBox(), id: "copy_2" };
    if (kind === "attr") hidden.attrId = menu.attrId;
    if (kind === "radio") { hidden.type = "field"; hidden.field = { kind: "radio", group: menu.attrId }; }
    const script = { id: kind.includes("script") ? button.scripts![0].id : "hidden-script", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [
      { id: kind.includes("step") ? button.scripts![0].steps[0].id : "hidden-step", kind: "wait" as const, seconds: 1 },
    ] };
    if (kind === "script" || kind === "step") hidden.scripts = [script];
    if (kind.startsWith("page-")) {
      original.pages.q = { ...original.pages.p, id: "q", children: [], pageScripts: [script] };
      // 別ページのスクリプトはコンテキストに含まれない。
      context.doc.pages.q = { ...original.pages.q, scripts: undefined, pageScripts: undefined, rawHtml: undefined };
    }
    const before = structuredClone(original);
    assert.deepEqual(buildAiContext(original, target).doc, context.doc);
    useEditor.getState().replaceDoc(original);
    assert.throws(() => useEditor.getState().updateDoc((doc) => applyAiEdits(doc, context, [
      { op: "rename", id: "group", name: "Must roll back" }, ...result.applied,
    ])), AiEditConflict);
    assert.deepEqual(useEditor.getState().doc, before);
    assert.equal(useEditor.getState().past.length, 0);
    const refs = new Map<string, string>();
    const rejected = applyAiOps(original, [duplicate], target, refs);
    assert.equal(rejected.errors.length, 1);
    assert.equal(rejected.applied.length, 0);
    assert.equal(refs.size, 0);
    assert.deepEqual(original, before);
  });
}
