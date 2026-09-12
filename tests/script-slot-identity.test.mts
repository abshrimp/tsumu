import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import { validDocumentScripts } from "../lib/document-validation";
import { cloneSteps, type PageScript } from "../lib/script";
import { StackView } from "../components/script-editor/blocks";
import { Ctx, type EdCtx } from "../components/script-editor/context";
import { insertAt, listIn, parseSlot, slotKey, takeAt } from "../components/script-editor/step-tree";

// 取り込んだ文書は、これらの区切りを含む、空でない文字列の ID を受け付ける。
// エディタでの位置の指定で、ID の一部をスクリプト・リスト・インデックスとして読み替えてはならない。
for (const id of ["script|root|0", "a:b|c", 'quote"\\line\n', "日本語%7C", "\ud800"]) {
  test(`slot addresses preserve the accepted ID ${JSON.stringify(id)}`, () => {
    for (const list of ["root", "head", `${id}:then`, `${id}:else`]) {
      const loc = { scriptId: id, list, index: 12 };
      assert.deepEqual(parseSlot(slotKey(loc)), loc);
    }
  });
}

test("different script/list pairs cannot share a drop target key", () => {
  const a = { scriptId: "a|b", list: "c:then", index: 0 };
  const b = { scriptId: "a", list: "b|c:then", index: 0 };
  assert.notEqual(slotKey(a), slotKey(b));
});

test("rendered trigger and root slots address the same delimiter-containing stack", () => {
  const script = { id: "script|head|0", nodeId: null, pos: { x: 0, y: 0 }, steps: [] };
  const ctx = { readOnly: false, virtualizeStacks: false, selected: new Set(), zOrder: new Map() } as EdCtx;
  const html = renderToStaticMarkup(createElement(Ctx.Provider, { value: ctx }, createElement(StackView, { script })));
  const slots: string[] = [];
  const walk = (node: ReturnType<typeof parseFragment> | ReturnType<typeof parseFragment>["childNodes"][number]) => {
    if ("attrs" in node) {
      const slot = node.attrs.find(attr => attr.name === "data-slot");
      if (slot) slots.push(slot.value);
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parseFragment(html));
  assert.deepEqual(slots.map(parseSlot), [
    { scriptId: script.id, list: "head", index: 0 },
    { scriptId: script.id, list: "root", index: 0 },
  ]);
});

function fixture(): PageScript[] {
  return [{ id: "script", nodeId: null, pos: { x: 32, y: 32 }, steps: [
    { id: "branch", kind: "if", cond: { subject: "var", target: "", left: "x" },
      then: [{ id: "untouched-then", kind: "wait", seconds: 1 }],
      else: [{ id: "untouched-else", kind: "wait", seconds: 2 }] },
    { id: "branch:else", kind: "if", cond: { subject: "var", target: "", left: "y" },
      then: [{ id: "chosen-then", kind: "wait", seconds: 3 }],
      else: [{ id: "chosen-else", kind: "wait", seconds: 4 }] },
  ] }];
}

for (const branch of ["then", "else"]) {
  test(`${branch}: move the selected branch, not a prefix-ID sibling`, () => {
    const scripts = fixture();
    assert.equal(validDocumentScripts(scripts), true);
    const before = structuredClone(scripts);
    const loc = { scriptId: "script", list: `branch:else:${branch}`, index: 0 };
    assert.equal(listIn(scripts[0], loc.list)?.[0].id, `chosen-${branch}`);
    const [remaining, taken] = takeAt(scripts, loc);
    assert.deepEqual(taken.map(step => step.id), [`chosen-${branch}`]);
    assert.deepEqual(remaining[0].steps[0], before[0].steps[0]);
    assert.deepEqual(insertAt(remaining, loc, taken), before, "moving back restores the exact IDs and values");
    assert.deepEqual(scripts, before, "the source and history snapshots stay immutable");
  });

  test(`${branch}: duplicate into the chosen branch without editing a prefix-ID sibling`, () => {
    const scripts = fixture();
    const before = structuredClone(scripts);
    const loc = { scriptId: "script", list: `branch:else:${branch}`, index: 1 };
    const chosen = scripts[0].steps[1];
    assert.equal(chosen.kind, "if");
    if (chosen.kind !== "if") return;
    const copy = cloneSteps(chosen[branch]!, () => "copy");
    const next = insertAt(scripts, loc, copy);
    assert.deepEqual(next[0].steps[0], before[0].steps[0]);
    const changed = next[0].steps[1];
    assert.equal(changed.kind, "if");
    if (changed.kind === "if") assert.deepEqual(changed[branch]?.map(step => step.id), [`chosen-${branch}`, "copy"]);
    assert.deepEqual(scripts, before);
  });
}
