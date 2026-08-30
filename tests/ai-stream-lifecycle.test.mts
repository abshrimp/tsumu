import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_STREAM_TYPE, MAX_AI_STREAM_BYTES, readAiResponse } from "../lib/ai/progress";
import { readCompletionStream } from "../lib/ai/completion-stream";

const encoder = new TextEncoder();
const result = { reply: "Completed", operations: [] };

async function beforeCleanup<T>(work: Promise<T>, cleanup: () => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = work.then(
    value => ({ kind: "value" as const, value }),
    error => ({ kind: "error" as const, error }),
  );
  try {
    const outcome = await Promise.race([
      settled,
      new Promise<{ kind: "pending" }>(resolve => {
        timer = setTimeout(() => resolve({ kind: "pending" }), 1000);
      }),
    ]);
    assert.notEqual(outcome.kind, "pending", "AI completion must not wait for upstream stream cleanup");
    if (outcome.kind === "error") throw outcome.error;
    assert.equal(outcome.kind, "value");
    return outcome.value;
  } finally {
    clearTimeout(timer);
    await cleanup();
    await settled;
  }
}

function clonedStream(bytes: Uint8Array, type = AI_STREAM_TYPE) {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); },
  }), { headers: { "content-type": type } });
  const other = response.clone();
  return { response, cleanup: () => other.body!.cancel() };
}

test("a terminal AI result completes while a response clone remains unread", async () => {
  const { response, cleanup } = clonedStream(encoder.encode(`${JSON.stringify({ type: "result", result })}\n`));
  assert.deepEqual(await beforeCleanup(readAiResponse(response, () => {}), cleanup), result);
  assert.equal(response.body!.locked, false);
});

test("AI stream errors surface while a response clone remains unread", async () => {
  const { response, cleanup } = clonedStream(encoder.encode('{"type":"error","error":"Retry later"}\n'));
  await assert.rejects(beforeCleanup(readAiResponse(response, () => {}), cleanup), /^Error: Retry later$/);
  assert.equal(response.body!.locked, false);
});

test("malformed AI event JSON rejects without waiting for cancellation", async () => {
  const { response, cleanup } = clonedStream(encoder.encode("{invalid}\n"));
  await assert.rejects(beforeCleanup(readAiResponse(response, () => {}), cleanup), SyntaxError);
  assert.equal(response.body!.locked, false);
});

test("oversized AI response rejects before a cloned stream is consumed", async () => {
  const { response, cleanup } = clonedStream(new Uint8Array(MAX_AI_STREAM_BYTES + 1));
  await assert.rejects(beforeCleanup(readAiResponse(response, () => {}), cleanup), /AI response is too large/);
  assert.equal(response.body!.locked, false);
});

test("AI completion releases its reader even if upstream cancellation never settles", async () => {
  let finish!: () => void;
  let cancelled = 0;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`${JSON.stringify({ type: "result", result })}\n`)); },
    cancel() { cancelled++; return pending; },
  }), { headers: { "content-type": AI_STREAM_TYPE } });
  assert.deepEqual(await beforeCleanup(readAiResponse(response, () => {}), async () => { finish(); }), result);
  assert.equal(cancelled, 1);
  assert.equal(response.body!.locked, false);
});

test("SSE completion does not wait for an unread response clone", async () => {
  const delta = { choices: [{ index: 0, delta: { content: "Completed" }, finish_reason: "stop" }] };
  const { response, cleanup } = clonedStream(encoder.encode(`data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`), "text/event-stream");
  const completion = await beforeCleanup(readCompletionStream(response, () => {}, () => {}), cleanup);
  assert.equal(completion.choices[0].message.content, "Completed");
  assert.equal(response.body!.locked, false);
});
