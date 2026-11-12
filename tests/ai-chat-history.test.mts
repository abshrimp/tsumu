import assert from "node:assert/strict";
import { test } from "node:test";
import { useEditor } from "../lib/store";
import { AI_STREAM_TYPE } from "../lib/ai/progress";
import { buildAiContext } from "../lib/aiOps";
import { aiChatDoc, aiChatFixture } from "./helpers/ai-chat";

for (const interruption of ["undo", "redo", "undo-redo", "replace", "restore"] as const) {
  test(`AI response after ${interruption} during the request preserves the document and history`, async (t) => {
    const { askForTest, useAi } = aiChatFixture();
    useEditor.getState().replaceDoc(aiChatDoc());
    useEditor.getState().setActivePage("p");
    useEditor.getState().updateDoc(doc => { doc.nodes.b.text!.content = "Manual B"; });
    if (interruption === "redo") useEditor.getState().undo();
    const requestedContext = buildAiContext(useEditor.getState().doc, { pageId: "p" }).doc;
    let finish!: (response: Response) => void;
    t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { finish = resolve; }));
    const request = askForTest("Update A");
    if (interruption === "undo") useEditor.getState().undo();
    else if (interruption === "redo") useEditor.getState().redo();
    else if (interruption === "undo-redo") {
      useEditor.getState().undo();
      useEditor.getState().redo();
    } else if (interruption === "replace") {
      useEditor.getState().replaceDoc(structuredClone(useEditor.getState().doc));
    } else {
      const restored = structuredClone(useEditor.getState().doc);
      restored.nodes.b.text!.content = "Restored B";
      useEditor.getState().restoreDoc(restored);
    }
    const before = useEditor.getState();
    // 対象のページは変わっていない。内容の比較だけでは、この中断を見つけられない。
    assert.deepEqual(buildAiContext(before.doc, { pageId: "p" }).doc, requestedContext);
    finish(new Response(JSON.stringify({ type: "result", result: {
      reply: "Done", operations: [{ op: "set_text", id: "a", text: "AI A" }],
    } }) + "\n", { headers: { "content-type": AI_STREAM_TYPE } }));
    await request;
    assert.equal(useEditor.getState().future, before.future, "a stale AI response must not discard Redo");
    assert.equal(useEditor.getState().doc, before.doc);
    assert.equal(useEditor.getState().past, before.past);
    assert.equal(useAi.getState().messages.at(-1).error, true);
    assert.equal(useAi.getState().messages.at(-1).appliedDoc, undefined);
    assert.equal(useAi.getState().busy, false);
    if (interruption === "undo") {
      useEditor.getState().redo();
      assert.equal(useEditor.getState().doc.nodes.b.text!.content, "Manual B");
      assert.equal(useEditor.getState().doc.nodes.a.text!.content, "Original A");
    }
    // 中断が後のリクエストを損なってはならない。次の編集も、1回の「元に戻す」で戻せる。
    const retryBefore = useEditor.getState().doc;
    const retry = askForTest("Try again");
    finish(new Response(JSON.stringify({ type: "result", result: {
      reply: "Done", operations: [{ op: "set_text", id: "a", text: "New AI A" }],
    } }) + "\n", { headers: { "content-type": AI_STREAM_TYPE } }));
    await retry;
    assert.equal(useAi.getState().messages.at(-1).error, undefined);
    assert.equal(useEditor.getState().doc.nodes.a.text!.content, "New AI A");
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, retryBefore);
  });
}

for (const changes of [false, true]) {
  test(`AI ${changes ? "changes undo independently" : "no-op cannot undo manual edits"} after an unrelated-page edit`, async (t) => {
    const { askForTest, useAi } = aiChatFixture();
    useEditor.getState().replaceDoc(aiChatDoc());
    useEditor.getState().setActivePage("p");
    let finish!: (response: Response) => void;
    t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
    const request = askForTest("Update A");
    useEditor.getState().setActivePage("q");
    useEditor.getState().updateDoc((doc) => { doc.nodes.b.text!.content = "Manual B"; });
    const before = useEditor.getState().doc;
    finish(new Response(JSON.stringify({ type: "result", result: {
      reply: "Done", operations: [{ op: "set_text", id: "a", text: changes ? "AI A" : "Original A" }],
    } }) + "\n", { headers: { "content-type": AI_STREAM_TYPE } }));
    await request;
    const message = useAi.getState().messages.at(-1);
    assert.equal(message.error, undefined);
    assert.equal(useEditor.getState().doc.nodes.b.text!.content, "Manual B");
    if (changes) {
      assert.equal(message.appliedDoc, useEditor.getState().doc);
      useEditor.getState().undo();
      assert.deepEqual(useEditor.getState().doc, before);
      useEditor.getState().redo();
      assert.equal(useEditor.getState().doc.nodes.a.text!.content, "AI A");
      assert.equal(useEditor.getState().doc.nodes.b.text!.content, "Manual B");
    } else {
      assert.equal(useEditor.getState().doc, before);
      assert.equal(message.appliedDoc, undefined, "AI Undo must not point to the unrelated manual edit");
      assert.equal(useEditor.getState().past.length, 1);
    }
  });
}

for (const changes of [false, true]) {
  test(`AI ${changes ? "change" : "no-op"} waits for all gesture owners and preserves manual history`, async (t) => {
    const { askForTest, useAi } = aiChatFixture();
    useEditor.getState().replaceDoc(aiChatDoc());
    useEditor.getState().setActivePage("p");
    let finish!: (response: Response) => void;
    t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
    const request = askForTest("Update A");
    useEditor.getState().setActivePage("q");
    const end = useEditor.getState().beginGesture();
    const endOther = useEditor.getState().beginGesture();
    useEditor.getState().updateDoc((doc) => { doc.nodes.b.text!.content = "Manual B"; });
    finish(new Response(JSON.stringify({ type: "result", result: { reply: "Done", operations: [{ op: "set_text", id: "a", text: changes ? "AI A" : "Original A" }] } }) + "\n", { headers: { "content-type": AI_STREAM_TYPE } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(useAi.getState().busy, true);
    assert.equal(useEditor.getState().doc.nodes.a.text!.content, "Original A");
    end();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(useAi.getState().busy, true);
    useEditor.getState().updateDoc((doc) => { doc.nodes.b.text!.content = "Final B"; });
    const before = useEditor.getState().doc;
    endOther();
    await request;
    const message = useAi.getState().messages.at(-1);
    assert.equal(message.error, undefined);
    assert.equal(useEditor.getState().past.length, changes ? 2 : 1);
    if (changes) {
      assert.equal(message.appliedDoc, useEditor.getState().doc);
      useEditor.getState().undo();
      assert.deepEqual(useEditor.getState().doc, before);
    } else {
      assert.equal(message.appliedDoc, undefined);
      assert.equal(useEditor.getState().doc, before);
    }
    useEditor.getState().undo();
    assert.equal(useEditor.getState().doc.nodes.b.text!.content, "Original B");
    useEditor.getState().redo();
    assert.equal(useEditor.getState().doc.nodes.b.text!.content, "Final B");
    if (changes) {
      useEditor.getState().redo();
      assert.equal(useEditor.getState().doc.nodes.a.text!.content, "AI A");
    }
  });
}

for (const interruption of ["abort", "undo", "target-edit", "invalid-op"] as const) {
  test(`AI gesture wait handles ${interruption} without changing unrelated history`, async (t) => {
    const { askForTest, useAi, cancelForTest } = aiChatFixture();
    useEditor.getState().replaceDoc(aiChatDoc());
    useEditor.getState().setActivePage("p");
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    t.mock.method(globalThis, "fetch", (_url, init) => {
      signal = init!.signal as AbortSignal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const request = askForTest("Update A");
    useEditor.getState().setActivePage("q");
    const end = useEditor.getState().beginGesture();
    useEditor.getState().updateDoc((doc) => { doc.nodes.b.text!.content = "Manual B"; });
    finish(new Response(JSON.stringify({ type: "result", result: { reply: "Done", operations: [{ op: "set_text", id: interruption === "invalid-op" ? "missing" : "a", text: "AI A" }] } }) + "\n", { headers: { "content-type": AI_STREAM_TYPE } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(useAi.getState().busy, true);
    if (interruption === "abort") {
      // この準備は、UI の停止ボタンと同じ制御を公開する。
      cancelForTest();
      assert.equal(signal.aborted, true);
    } else if (interruption === "undo") useEditor.getState().undo();
    else {
      if (interruption === "target-edit") useEditor.getState().updateDoc((doc) => { doc.nodes.a.text!.content = "Manual A"; });
      end();
    }
    const before = useEditor.getState().doc;
    const past = useEditor.getState().past;
    await request;
    end();
    assert.equal(useAi.getState().busy, false);
    assert.equal(useAi.getState().messages.at(-1).error, true);
    assert.equal(useEditor.getState().doc, before);
    assert.equal(useEditor.getState().past, past);
    assert.equal(useAi.getState().messages.at(-1).appliedDoc, undefined);
    // 取り消された待機や拒否された待機で、次のリクエストが処理中や購読中のまま残ってはならない。
    const again = askForTest("Try again");
    finish(new Response(JSON.stringify({ type: "result", result: { reply: "Done", operations: [] } }) + "\n", {
      headers: { "content-type": AI_STREAM_TYPE },
    }));
    await again;
    assert.equal(useAi.getState().busy, false);
    assert.equal(useAi.getState().messages.at(-1).error, undefined);
    assert.equal(useEditor.getState().doc, before);
  });
}
