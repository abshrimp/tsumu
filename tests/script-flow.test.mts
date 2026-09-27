import assert from "node:assert/strict";
import test from "node:test";
import { copyScriptBlocks, pasteScriptBlocks } from "../components/script-editor/clipboard";
import { scriptStatus, stepIssue } from "../components/script-editor/issues";
import {
  findStepLoc, listInsideLoop, moveSteps, nudgeStep,
} from "../components/script-editor/step-tree";
import { pageScriptsOf, withPageScripts, type PageScript } from "../lib/script";
import { makeBox } from "../lib/presets";
import { PAGE_TARGET, type ScriptStep, type SiteDoc } from "../lib/types";

const wait = (id: string): ScriptStep => ({ id, kind: "wait", seconds: 1 });
const script = (): PageScript => ({
  id: "s", trigger: "click", nodeId: "button",
  steps: [
    wait("a"),
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{x}", op: "eq", value: "1" }, then: [wait("b"), wait("c")], else: [] },
    { id: "loop", kind: "repeat", times: 2, then: [wait("d")] },
    wait("e"),
  ],
});
const ids = (steps: ScriptStep[]): unknown[] => steps.map((step) =>
  "then" in step ? [step.id, ids(step.then), ...(step.kind === "if" && step.else ? [ids(step.else)] : [])] : step.id);

test("moving a step keeps the rest in order and can cross into a branch", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "e")!;
  const moved = moveSteps(scripts, from, new Set(["e"]), { list: "if:then", beforeId: "c" });
  assert.deepEqual(ids(moved[0].steps), ["a", ["if", ["b", "e", "c"], []], ["loop", ["d"]]]);
  const intoEmptyElse = moveSteps(scripts, from, new Set(["e"]), { list: "if:else", beforeId: null });
  assert.deepEqual(ids(intoEmptyElse[0].steps), ["a", ["if", ["b", "c"], ["e"]], ["loop", ["d"]]]);
  assert.deepEqual(ids(scripts[0].steps), ["a", ["if", ["b", "c"], []], ["loop", ["d"]], "e"], "the source is not mutated");
});

test("a drop that changes nothing returns the same array, so no history entry is made", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "a")!;
  assert.equal(moveSteps(scripts, from, new Set(["a"]), { list: "root", beforeId: "if" }), scripts);
  const last = findStepLoc(scripts[0], "e")!;
  assert.equal(moveSteps(scripts, last, new Set(["e"]), { list: "root", beforeId: null }), scripts);
});

test("a container cannot be dropped inside itself", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "if")!;
  assert.equal(moveSteps(scripts, from, new Set(["if"]), { list: "if:then", beforeId: null }), scripts);
});

test("several selected steps move together and keep their relative order", () => {
  const scripts = [script()];
  const from = findStepLoc(scripts[0], "a")!;
  const moved = moveSteps(scripts, from, new Set(["a", "e"]), { list: "loop:then", beforeId: null });
  assert.deepEqual(ids(moved[0].steps), [["if", ["b", "c"], []], ["loop", ["d", "a", "e"]]]);
});

test("keyboard reordering moves one position within the same list and stops at the ends", () => {
  const scripts = [script()];
  const down = nudgeStep(scripts, findStepLoc(scripts[0], "a")!, 1);
  assert.deepEqual(ids(down[0].steps).slice(0, 2), [["if", ["b", "c"], []], "a"]);
  assert.equal(nudgeStep(scripts, findStepLoc(scripts[0], "a")!, -1), scripts);
  assert.equal(nudgeStep(scripts, findStepLoc(scripts[0], "d")!, 1), scripts);
});

test("only lists inside a repeat accept the action that stops repeating", () => {
  const item = script();
  assert.equal(listInsideLoop(item, "root"), false);
  assert.equal(listInsideLoop(item, "if:then"), false);
  assert.equal(listInsideLoop(item, "loop:then"), true);
});

test("unfinished actions are reported with what to do next, and finished ones are not", () => {
  assert.ok(stepIssue({ id: "x", kind: "show", target: "" }));
  assert.equal(stepIssue({ id: "x", kind: "show", target: "menu" }), null);
  assert.ok(stepIssue({ id: "x", kind: "open-page", pageId: "" }));
  assert.ok(stepIssue({ id: "x", kind: "set-var", into: "", value: "1" }));
  assert.equal(stepIssue(wait("x")), null);
  assert.equal(scriptStatus({ id: "s", trigger: "load", nodeId: PAGE_TARGET, steps: [] }).ready, false);
  assert.equal(scriptStatus({ id: "s", trigger: "load", nodeId: PAGE_TARGET, steps: [wait("x")] }).ready, true);
  const pending = scriptStatus({ id: "s", trigger: "click", nodeId: "b", steps: [wait("x"), { id: "y", kind: "hide", target: "" }] });
  assert.deepEqual([pending.ready, pending.pending], [false, 1]);
});

test("pasted actions get new IDs and land after the selection, or at the end of the open script", () => {
  const scripts = [script()];
  const copied = copyScriptBlocks(scripts, ["step:if"])!;
  assert.deepEqual(ids(copied.steps), [["if", ["b", "c"], []]]);
  const afterA = pasteScriptBlocks(scripts, ["step:a"], copied, "s")!;
  assert.equal(afterA.scripts[0].steps.length, 5);
  assert.equal(afterA.scripts[0].steps[1].kind, "if");
  assert.notEqual(afterA.scripts[0].steps[1].id, "if");
  const atEnd = pasteScriptBlocks(scripts, [], copied, "s")!;
  assert.equal(atEnd.scripts[0].steps.at(-1)!.kind, "if");
  assert.equal(pasteScriptBlocks(scripts, [], copied, null), null, "nothing is open, so there is nowhere to paste");
});

test("pasting uses document order even when actions were selected in reverse order", () => {
  const scripts = [script()];
  const copied = copyScriptBlocks(scripts, ["step:a"])!;
  const result = pasteScriptBlocks(scripts, ["step:e", "step:a"], copied, "s")!;
  assert.equal(result.scripts[0].steps.at(-1)?.kind, "wait");
  assert.equal(result.selection.length, 1);
  assert.equal(result.scripts[0].steps.at(-1)?.id, result.selection[0].slice(5));
  assert.notEqual(result.scripts[0].steps.at(-1)?.id, "a");
});

test("pasting after a selected parent stays outside its nested branch", () => {
  const scripts = [script()];
  const copied = copyScriptBlocks(scripts, ["step:a"])!;
  const result = pasteScriptBlocks(scripts, ["step:if", "step:c"], copied, "s")!;
  assert.equal(result.scripts[0].steps[2].id, result.selection[0].slice(5));
  assert.deepEqual(ids(scripts[0].steps), ["a", ["if", ["b", "c"], []], ["loop", ["d"]], "e"]);
});

test("pasting does not use a selection from another script", () => {
  const scripts = [script(), { ...script(), id: "other", steps: [wait("only")] }];
  const copied = copyScriptBlocks(scripts, ["step:a"])!;
  const result = pasteScriptBlocks(scripts, ["step:e"], copied, "other")!;
  assert.deepEqual(ids(result.scripts[0].steps), ids(scripts[0].steps));
  assert.equal(result.scripts[1].steps.length, 2);
  assert.equal(result.scripts[1].steps[1].id, result.selection[0].slice(5));
});

test("scripts are stored on their trigger element or on the page, without layout data", () => {
  const pageId = "home";
  const doc = {
    siteName: "Test",
    pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["button"] } },
    pageOrder: ["home"],
    nodes: { button: { ...makeBox(), id: "button" } },
  } as unknown as SiteDoc;
  const views: PageScript[] = [
    { id: "load", trigger: "load", nodeId: PAGE_TARGET, steps: [wait("w")] },
    { id: "hide", trigger: "click", nodeId: "button", steps: [{ id: "h", kind: "hide", target: "x" }] },
    { id: "gone", trigger: "click", nodeId: "missing", steps: [wait("z")] },
  ];
  const next = withPageScripts(doc, pageId, ["button"], views);
  assert.deepEqual(next.pages[pageId].pageScripts, [{ id: "load", trigger: "load", steps: [wait("w")] }]);
  assert.deepEqual(next.nodes.button.scripts, [{ id: "hide", trigger: "click", steps: [{ id: "h", kind: "hide", target: "x" }] }]);
  assert.deepEqual(pageScriptsOf(next, ["button"], pageId).map((item) => [item.id, item.nodeId]),
    [["load", PAGE_TARGET], ["hide", "button"]], "the page's scripts come first, then elements in page order");
  // 「クリックしたとき → 開く」だけのスクリプトは、ボックスではリンクとして保存する
  const linked = withPageScripts(doc, pageId, ["button"], [
    { id: "open", trigger: "click", nodeId: "button", steps: [{ id: "o", kind: "open-url", url: "https://example.com" }] },
  ]);
  assert.deepEqual(linked.nodes.button.link, { kind: "url", url: "https://example.com", newTab: false });
  assert.equal(linked.nodes.button.scripts, undefined);
});
