import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAiOps, buildAiContext, type AiOp } from "../lib/aiOps";
import { applyAiEdits, AiEditConflict } from "../lib/ai/client";
import { useEditor } from "../lib/store";
import { BODY_NODE_ID } from "../lib/types";
import { aiChatDoc, aiChatFixture } from "./helpers/ai-chat";
import { AI_STREAM_TYPE } from "../lib/ai/progress";

const target = { pageId: "p" };

for (const ref of ["page", "body", BODY_NODE_ID, "a"]) {
  for (const kind of ["insert", "duplicate"] as const) {
    test(`AI ${kind} rejects ambiguous ref ${ref} without changing the document or refs`, () => {
      const doc = aiChatDoc();
      const before = structuredClone(doc);
      const refs = new Map([["existing", "a"]]);
      const op: AiOp = kind === "insert"
        ? { op: "insert", parent: "page", node: { type: "box", ref } }
        : { op: "duplicate", id: "a", ref };
      const result = applyAiOps(doc, [op], target, refs);
      assert.equal(result.applied.length, 0);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /ref/);
      assert.deepEqual(doc, before);
      assert.deepEqual(refs, new Map([["existing", "a"]]));
    });
  }
}

for (const id of ["page", "body", BODY_NODE_ID, "alias"]) {
  for (const kind of ["insert", "duplicate"] as const) {
    test(`AI ${kind} cannot create a node ID that shadows target ${id}`, () => {
      const doc = aiChatDoc();
      const before = structuredClone(doc);
      const refs = new Map([["alias", "a"]]);
      const op: AiOp = kind === "insert"
        ? { op: "insert", node: { type: "box", id } }
        : { op: "duplicate", id: "a", newId: id };
      const result = applyAiOps(doc, [op], target, refs);
      assert.equal(result.applied.length, 0);
      assert.equal(result.errors.length, 1);
      assert.deepEqual(doc, before);
      assert.deepEqual(refs, new Map([["alias", "a"]]));
    });
  }
}

test("a rejected nested ref rolls back the whole insert and leaves its refs reusable", () => {
  const doc = aiChatDoc();
  const before = structuredClone(doc);
  const refs = new Map<string, string>();
  const result = applyAiOps(doc, [{ op: "insert", node: {
    type: "box", ref: "hero", children: [{ type: "text", ref: "body", text: "Title" }],
  } }], target, refs);
  assert.equal(result.applied.length, 0);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(doc, before);
  assert.equal(refs.size, 0);
  assert.deepEqual(applyAiOps(doc, [{ op: "insert", node: { type: "box", ref: "hero" } }], target, refs).errors, []);
});

for (const op of [
  { op: "insert", node: { type: "box", id: "hero", ref: "hero" } },
  { op: "insert", node: { type: "box", ref: "hero", children: [{ type: "box", id: "hero" }] } },
  { op: "duplicate", id: "a", newId: "copy", ref: "copy_1" },
] satisfies AiOp[]) {
  test(`AI rejects internal tree identity collisions: ${JSON.stringify(op)}`, () => {
    const doc = aiChatDoc();
    doc.nodes.a.children = ["child"];
    doc.nodes.child = { ...structuredClone(doc.nodes.b), id: "child" };
    const before = structuredClone(doc);
    const refs = new Map<string, string>();
    const result = applyAiOps(doc, [op], target, refs);
    assert.equal(result.applied.length, 0);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(doc, before);
    assert.equal(refs.size, 0);
  });
}

for (const ref of ["", 42]) {
  test(`AI rejects malformed duplicate ref ${JSON.stringify(ref)}`, () => {
    const doc = aiChatDoc();
    const before = structuredClone(doc);
    const refs = new Map<string, string>();
    const result = applyAiOps(doc, [{ op: "duplicate", id: "a", ref } as AiOp], target, refs);
    assert.equal(result.applied.length, 0);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(doc, before);
    assert.equal(refs.size, 0);
  });
}

test("invalid AI identities reject a later replay chunk without consuming Undo or Redo", () => {
  useEditor.getState().replaceDoc(aiChatDoc());
  useEditor.getState().updateDoc(doc => { doc.nodes.b.name = "Manual B"; });
  useEditor.getState().updateDoc(doc => { doc.nodes.b.name = "Later B"; });
  useEditor.getState().undo();
  const before = useEditor.getState();
  const context = buildAiContext(before.doc, target);
  const ops: AiOp[] = [
    ...Array.from({ length: 200 }, (_, i): AiOp => ({ op: "rename", id: "a", name: `AI ${i}` })),
    { op: "insert", node: { type: "box", id: "body" } },
  ];
  assert.throws(() => useEditor.getState().updateDoc(doc => applyAiEdits(doc, context, ops)), AiEditConflict);
  assert.equal(useEditor.getState().doc, before.doc);
  assert.equal(useEditor.getState().past, before.past);
  assert.equal(useEditor.getState().future, before.future);
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.nodes.b.name, "Later B");
});

test("repaired AI refs replay across tool calls and chunks as one independently undoable chat edit", async (t) => {
  const { askForTest, useAi } = aiChatFixture();
  useEditor.getState().replaceDoc(aiChatDoc());
  useEditor.getState().setActivePage("p");
  useEditor.getState().updateDoc(doc => { doc.nodes.b.name = "Manual B"; });
  const before = useEditor.getState().doc;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { context } = JSON.parse(init!.body as string);
    const refs = new Map<string, string>();
    const invalid = applyAiOps(context.doc, [{ op: "insert", node: { type: "box", ref: "body" } }], context.target, refs);
    assert.equal(invalid.errors.length, 1);
    const created = applyAiOps(context.doc, [{ op: "insert", parent: "page", node: { type: "box", ref: "hero" } }], context.target, refs);
    const styled = applyAiOps(context.doc, [
      { op: "set_style", id: "body", styles: { backgroundColor: "navy" } },
      { op: "insert", parent: "hero", node: { type: "heading", text: "Hello", ref: "title" } },
      { op: "duplicate", id: "title", ref: "subtitle" },
      { op: "set_text", id: "subtitle", text: "Welcome" },
    ], context.target, refs);
    const renamed = applyAiOps(context.doc, Array.from({ length: 200 }, (_, i): AiOp => ({
      op: "rename", id: "hero", name: `Hero ${i}`,
    })), context.target, refs);
    assert.deepEqual([...created.errors, ...styled.errors, ...renamed.errors], []);
    expected = buildAiContext(context.doc, context.target).doc;
    return new Response(JSON.stringify({ type: "result", result: {
      reply: "Done", operations: [...created.applied, ...styled.applied, ...renamed.applied],
    } }) + "\n", { headers: { "content-type": AI_STREAM_TYPE } });
  });
  let expected: ReturnType<typeof buildAiContext>["doc"];
  await askForTest("Create a hero");
  assert.equal(useAi.getState().messages.at(-1).error, undefined);
  assert.deepEqual(buildAiContext(useEditor.getState().doc, target).doc, expected!);
  assert.equal(useEditor.getState().past.length, 2);
  const after = useEditor.getState().doc;
  assert.equal(useAi.getState().messages.at(-1).appliedDoc, after);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
  useEditor.getState().undo();
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, aiChatDoc());
});
