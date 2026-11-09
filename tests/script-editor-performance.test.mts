import assert from "node:assert/strict";
import { test } from "node:test";
import { SlotIndex, type SlotPoint } from "../components/script-editor/slot-index";
import { filterNumbersOf, mapStep, numberFilters, removeKeys } from "../components/script-editor/step-tree";
import { dataVarNames, firstListItem, ITEM_VALUE, pageVariableIndex, scriptInputDoc, toListItems } from "../lib/data";
import { PAGE_TARGET, type ScriptStep, type SiteDoc } from "../lib/types";
import { applyPageScripts, pageScriptsOf, type PageScript } from "../lib/script";

function brute(slots: SlotPoint[], kind: SlotPoint["kind"], x: number, y: number) {
  let best: string | null = null;
  let distance = Infinity;
  slots.forEach((s) => {
    if (s.kind !== kind) return;
    const dx = x - s.x;
    const dy = y - s.y;
    if (Math.abs(dx) > 80 || Math.abs(dy) > 28) return;
    const score = Math.hypot(dx, dy * 2);
    if (score < distance) {
      best = s.key;
      distance = score;
    }
  });
  return best;
}

test("spatial hit testing agrees with the original full DOM slot scan", () => {
  const slots: SlotPoint[] = [];
  for (let row = 0; row < 110; row++) {
    for (let col = 0; col < 22; col++) {
      slots.push({ key: `s-${row}-${col}`, kind: row % 7 === 0 ? "head" : "step",
        x: col * 215 + 12, y: row * 41 + 9 });
    }
  }
  const index = new SlotIndex(slots);
  // Probe cell boundaries, negative coordinates, overlaps and near misses.
  for (let y = -60; y < 4600; y += 83) {
    for (let x = -100; x < 4700; x += 187) {
      for (const kind of ["step", "head"] as const) {
        assert.equal(index.nearest(kind, x, y), brute(slots, kind, x, y));
      }
    }
  }
});

test("spatial hit testing preserves DOM order for exactly tied slots", () => {
  const slots: SlotPoint[] = [
    { key: "first", kind: "step", x: 10, y: 20 },
    { key: "second", kind: "step", x: 10, y: 20 },
    { key: "head", kind: "head", x: 10, y: 20 },
  ];
  const index = new SlotIndex(slots);
  assert.equal(index.nearest("step", 10, 20), "first");
  assert.equal(index.nearest("head", 10, 20), "head");
  assert.equal(index.nearest("step", 500, 500), null);
});

test("editing a single deep block keeps unrelated blocks and scripts by reference", () => {
  const steps: ScriptStep[] = Array.from({ length: 4000 }, (_, i) => ({
    id: `wait-${i}`, kind: "wait", seconds: i + 1,
  }));
  const nested: ScriptStep = {
    id: "branch", kind: "if", cond: { subject: "var", target: "", left: "ready", op: "eq", value: "true" },
    then: [{ id: "nested", kind: "wait", seconds: 1 }],
  };
  const scripts = [
    { id: "a", nodeId: null, pos: { x: 10, y: 10 }, steps: [...steps, nested] },
    { id: "b", nodeId: null, pos: { x: 500, y: 500 }, steps: [{ id: "other", kind: "wait" as const, seconds: 2 }] },
  ];
  const result = mapStep(scripts, "nested", (s) => ({ ...s, seconds: 5 }) as ScriptStep);
  assert.notEqual(result[0], scripts[0]);
  assert.equal(result[1], scripts[1]);
  assert.equal(result[0].steps[0], scripts[0].steps[0]);
  assert.equal(result[0].steps[3999], scripts[0].steps[3999]);
  assert.equal(result[1].steps, scripts[1].steps);
  assert.equal(scripts[0].steps[4000], nested);
  assert.equal((result[0].steps[4000] as Extract<ScriptStep, { kind: "if" }>).then[0].kind, "wait");
  assert.equal(((result[0].steps[4000] as Extract<ScriptStep, { kind: "if" }>).then[0] as Extract<ScriptStep, { kind: "wait" }>).seconds, 5);
});

function filterStep(id: string, array: string, no?: number): ScriptStep {
  return { id, kind: "list-display", mode: "filter", array, field: "",
    op: "eq", value: "", dir: "asc", ...(no === undefined ? {} : { no }) };
}

test("filter numbering changes only affected subtrees in a 4000-block workspace", () => {
  const staticSteps: ScriptStep[] = Array.from({ length: 4000 }, (_, i) =>
    ({ id: "wait-" + i, kind: "wait", seconds: 1 }));
  const assigned = filterStep("assigned", "items", 1);
  const duplicate = filterStep("duplicate", "items", 1);
  const missing = filterStep("missing", "items");
  const branch: ScriptStep = {
    id: "branch", kind: "repeat", times: 1, then: [duplicate, missing],
  };
  const scripts = [
    { id: "a", nodeId: null, pos: { x: 0, y: 0 }, steps: [...staticSteps, assigned, branch] },
    { id: "b", nodeId: null, pos: { x: 500, y: 500 },
      steps: [{ id: "unrelated", kind: "wait" as const, seconds: 2 }] },
  ];
  const before = structuredClone(scripts);
  const next = numberFilters(scripts);
  assert.deepEqual(scripts, before, "the original snapshot must remain immutable");
  assert.equal(next[1], scripts[1], "unrelated scripts retain their identity");
  assert.equal(next[0].steps[0], staticSteps[0]);
  assert.equal(next[0].steps[4000], assigned);
  const nested = next[0].steps[4001];
  assert.equal(nested.kind, "repeat");
  if (nested.kind !== "repeat") return;
  assert.equal(nested.then[0].kind === "list-display" && nested.then[0].no, 2);
  assert.equal(nested.then[1].kind === "list-display" && nested.then[1].no, 3);
  assert.equal(numberFilters(next), next, "already numbered steps require no copy");
});

test("filter number index supports branches and separately updated script snapshots", () => {
  const scripts = [{
    id: "a", nodeId: null, pos: { x: 0, y: 0 }, steps: [
      filterStep("a1", "products", 3),
      { id: "if", kind: "if" as const,
        cond: { subject: "var" as const, target: "", left: "enabled", op: "eq" as const, value: "true" },
        then: [filterStep("a2", "products", 1)],
        else: [filterStep("b1", "other", 7), filterStep("a3", "products", 3)] },
    ],
  }];
  assert.deepEqual(filterNumbersOf(scripts, "products"), [1, 3]);
  assert.deepEqual(filterNumbersOf(scripts, "other"), [7]);
  const first = filterNumbersOf(scripts, "products");
  first.push(999);
  assert.deepEqual(filterNumbersOf(scripts, "products"), [1, 3]);
  const changed = mapStep(scripts, "a1", (s) => ({ ...s, no: 4 }) as ScriptStep);
  assert.deepEqual(filterNumbersOf(changed, "products"), [1, 3, 4]);
  assert.deepEqual(filterNumbersOf(scripts, "products"), [1, 3]);
});

test("preview excludes one step in a 3500-block document and shares unrelated data", () => {
  const steps: ScriptStep[] = Array.from({ length: 3500 }, (_, i) =>
    ({ id: "value-" + i, kind: "set-var", value: "1", into: "v" + i }));
  const doc = { pages: {
    p: { pageScripts: [{ id: "page", steps: [
      ...steps, { id: "nested", kind: "if",
        cond: { subject: "var", target: "", left: "ok", op: "eq", value: "true" },
        then: [{ id: "target", kind: "set-var", value: "2", into: "chosen" }] }] }] },
    other: { pageScripts: [{ id: "other", steps: [{ id: "keep", kind: "wait", seconds: 1 }] }] },
  }, nodes: {
    n: { scripts: [{ id: "node-script", steps: [{ id: "node-step", kind: "wait", seconds: 2 }] }] },
    untouched: { scripts: [{ id: "untouched", steps: [] }] },
  } } as unknown as SiteDoc;
  const before = JSON.stringify(doc);
  const preview = scriptInputDoc(doc, "target");
  assert.equal(JSON.stringify(doc), before);
  assert.equal(preview.pages.other, doc.pages.other);
  assert.equal(preview.nodes, doc.nodes);
  assert.equal(preview.pages.p.pageScripts![0].steps[0], steps[0]);
  const nested = preview.pages.p.pageScripts![0].steps.at(-1);
  assert.equal(nested?.kind, "if");
  if (nested?.kind === "if") assert.deepEqual(nested.then, []);
  assert.equal(scriptInputDoc(doc, "absent"), doc);
  const nodePreview = scriptInputDoc(doc, "node-step");
  assert.equal(nodePreview.pages, doc.pages);
  assert.equal(nodePreview.nodes.untouched, doc.nodes.untouched);
  assert.deepEqual(nodePreview.nodes.n.scripts![0].steps, []);
});

test("preview excludes duplicated step IDs from every containing script", () => {
  const doc = { pages: { p: { pageScripts: [
    { id: "a", steps: [{ id: "same", kind: "wait", seconds: 1 }] },
    { id: "b", steps: [{ id: "same", kind: "wait", seconds: 2 }] },
  ] } }, nodes: {
    c: { scripts: [{ id: "c", steps: [{ id: "same", kind: "wait", seconds: 3 }] }] },
  } } as unknown as SiteDoc;
  const preview = scriptInputDoc(doc, "same");
  assert.equal(preview.pages.p.pageScripts![0].steps.length, 0);
  assert.equal(preview.pages.p.pageScripts![1].steps.length, 0);
  assert.equal(preview.nodes.c.scripts![0].steps.length, 0);
  assert.equal(doc.pages.p.pageScripts![0].steps.length, 1);
});

test("shared variable index matches per-step exclusion including duplicate producer IDs", () => {
  const doc = {
    pages: { p: { children: [], pageScripts: [{ id: "script", steps: [
      { id: "unique", kind: "set-var", value: "1", into: "one" },
      { id: "repeated", kind: "set-var", value: "2", into: "two" },
      { id: "repeated", kind: "set-var", value: "3", into: "three" },
      { id: "another", kind: "set-var", value: "4", into: "two" },
      { id: "nested", kind: "repeat", times: 1, then: [
        { id: "inner", kind: "set-var", value: "5", into: "__proto__" },
      ] },
    ] }] } },
    nodes: {},
  } as unknown as SiteDoc;
  const index = pageVariableIndex(doc, "p");
  for (const stepId of ["unique", "repeated", "another", "inner", "missing"]) {
    const expected = dataVarNames(doc, "p", stepId);
    const fromIndex = new Set(index.names.filter((name) => index.hasOther(name, stepId)));
    assert.deepEqual(fromIndex, expected, "step " + stepId);
  }
  assert.equal(index.hasOther("one", "unique"), false);
  assert.equal(index.hasOther("two", "repeated"), true);
  assert.equal(index.hasOther("three", "repeated"), false);
  assert.equal(index.hasOther("__proto__", "inner"), false);
  assert.equal(index.hasOther("slug", "unique"), true);
});


test("deleting thousands of selected blocks prunes nested branches without cloning unrelated trees", () => {
  const wait = (id: string): ScriptStep => ({ id, kind: "wait", seconds: 1 });
  const ordinary = Array.from({ length: 4000 }, (_, i) => wait("step-" + i));
  const branch: ScriptStep = { id: "condition", kind: "if",
    cond: { subject: "var", target: "", left: "enabled", op: "eq", value: "true" },
    then: [wait("keep-then"), wait("remove-then")],
    else: [wait("remove-else"), wait("keep-else")] };
  const scripts: PageScript[] = [
    { id: "main", nodeId: null, pos: { x: 32, y: 32 }, steps: [...ordinary, branch, wait("last")] },
    { id: "detached", nodeId: null, pos: { x: 400, y: 40 }, steps: [wait("only")] },
    { id: "untouched", nodeId: null, pos: { x: 600, y: 40 }, steps: [wait("unrelated")] },
    { id: "whole", nodeId: null, pos: { x: 800, y: 40 }, trigger: "click", steps: [wait("whole-step")] },
  ];
  const before = structuredClone(scripts);
  const keys = [
    ...ordinary.slice(0, 3500).map((step) => `step:${step.id}`),
    "step:remove-then", "step:remove-else", "step:only", "script:whole",
  ];
  const next = removeKeys(scripts, keys);
  assert.deepEqual(scripts, before);
  assert.deepEqual(next.map((script) => script.id), ["main", "untouched"]);
  assert.equal(next[1], scripts[2], "unrelated scripts are reused");
  assert.equal(next[0].steps[0], ordinary[3500], "unselected blocks are reused");
  assert.equal(next[0].steps[499], ordinary[3999]);
  assert.equal(next[0].steps.at(-1), scripts[0].steps.at(-1));
  const nested = next[0].steps[500];
  assert.equal(nested.kind, "if");
  if (nested.kind === "if") {
    assert.deepEqual(nested.then.map((step) => step.id), ["keep-then"]);
    assert.deepEqual(nested.else?.map((step) => step.id), ["keep-else"]);
  }
  assert.equal(removeKeys(next, ["step:missing"]), next, "no-op keeps original identity");
  assert.equal(removeKeys(scripts, []), scripts);
});

test("thousands of scripts with an identical start position are placed in source order", () => {
  const original = Array.from({ length: 900 }, (_, i) => ({
    id: `script-${i}`, trigger: "load" as const, pos: { x: 24, y: 24 },
    steps: [{ id: `wait-${i}`, kind: "wait" as const, seconds: 1 }],
  }));
  const doc = { nodes: {}, pages: { page: { pageScripts: original } } } as unknown as SiteDoc;
  const views = pageScriptsOf(doc, [], "page");
  assert.equal(views.length, original.length);
  for (let i = 0; i < views.length; i++) {
    assert.deepEqual(views[i].pos, { x: 24, y: 24 + 150 * i });
  }
  assert.deepEqual(original[899].pos, { x: 24, y: 24 },
    "rendering the workspace must not change stored positions");
});

test("saving many scripts for one element retains their order and page-owned scripts", () => {
  const doc = { nodes: { box: { id: "box", type: "box", name: "Box",
    children: [], styles: {}, link: null } }, pages: { page: { id: "page", children: [] } } } as unknown as SiteDoc;
  const wait = (id: string): ScriptStep => ({ id, kind: "wait", seconds: 1 });
  const views: PageScript[] = Array.from({ length: 1200 }, (_, i) => ({
    id: `script-${i}`, nodeId: "box", trigger: "click", pos: { x: i, y: 0 },
    steps: [wait(`wait-${i}`)],
  }));
  views.push({ id: "page-script", nodeId: PAGE_TARGET, trigger: "load",
    pos: { x: 0, y: 0 }, steps: [wait("page-wait")] });
  views.push({ id: "loose", nodeId: "removed", trigger: "click",
    pos: { x: 1, y: 1 }, steps: [wait("loose-wait")] });
  applyPageScripts(doc, "page", ["box"], views);
  assert.equal(doc.nodes.box.scripts?.length, 1200);
  assert.equal(doc.nodes.box.scripts?.[0].id, "script-0");
  assert.equal(doc.nodes.box.scripts?.[1199].id, "script-1199");
  assert.equal(doc.pages.page.pageScripts?.[0].id, "page-script");
  assert.equal(doc.pages.page.scripts?.[0].id, "loose");
  assert.equal(views[0].nodeId, "box", "the display model remains intact");
});


test("editor list suggestions inspect the first item without materializing the remaining sample", () => {
  const large = Array.from({ length: 25000 }, (_, i) => i + 5);
  assert.deepEqual(firstListItem(large), { [ITEM_VALUE]: 5 });
  assert.deepEqual(firstListItem(large), toListItems(large)[0]);
  const nested = { initial: { label: "first" }, get unrelated() {
    throw new Error("Later sample entries must not be accessed");
  } };
  assert.deepEqual(firstListItem(nested), { label: "first" });
  const sparse: unknown[] = [];
  sparse[3] = false;
  assert.deepEqual(firstListItem(sparse), { [ITEM_VALUE]: false });
  assert.deepEqual(firstListItem(sparse), toListItems(sparse)[0]);
  assert.equal(firstListItem({}), undefined);
  assert.equal(firstListItem(null), undefined);
});
