import assert from "node:assert/strict";
import { test } from "node:test";
import { aiStreamResponse, appendAiProgress, readAiResponse, type AiProgress } from "../lib/ai/progress";
import { readCompletionStream } from "../lib/ai/completion-stream";
import { runAi } from "../lib/ai/run";
import type { AiConfig } from "../lib/ai/config";

const encoder = new TextEncoder();
const config: AiConfig = { enabled: true, provider: "gemini", apiKey: "test", model: "test", baseUrl: "https://example.test", effort: "medium", reason: null };
const turns = [{ role: "user" as const, text: "見出しを大きくして" }];
const result = { reply: "完了しました", operations: [] };
function streamed(text: string, type = "text/event-stream") {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      // Deliberately split Japanese characters, JSON and SSE frame boundaries.
      controller.enqueue(bytes.slice(offset, offset += Math.min(7, bytes.length - offset)));
    },
  }), { headers: { "Content-Type": type } });
}
const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`;

test("progress is delivered before work completes, then exactly one result", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let started!: () => void;
  const observed = new Promise<void>((resolve) => { started = resolve; });
  const response = aiStreamResponse(async (emit) => {
    emit({ type: "text", text: "見出しを調整します", turn: 1 });
    await gate;
    return result;
  }, () => "failed", new AbortController().signal);
  const events: AiProgress[] = [];
  let complete = false;
  const reading = readAiResponse(response, (event) => {
    events.push(event);
    if (event.type === "text") started();
  }).then((r) => { complete = true; return r; });
  await observed;
  assert.equal(complete, false);
  assert.equal(events[0].type, "phase");
  finish();
  assert.deepEqual(await reading, result);
});

test("NDJSON handles split Japanese text, errors and EOF, and rejects other success formats", async () => {
  const events: AiProgress[] = [];
  const text = `${JSON.stringify({ type: "text", text: "余白を調整します", turn: 1 })}\n${JSON.stringify({ type: "result", result })}\n`;
  assert.deepEqual(await readAiResponse(streamed(text, "application/x-ndjson"), (e) => events.push(e)), result);
  assert.equal((events[0] as any).text, "余白を調整します");
  await assert.rejects(readAiResponse(streamed('{"type":"phase","phase":"planning"}\n', "application/x-ndjson"), () => {}), /before completion/);
  await assert.rejects(readAiResponse(streamed('{"type":"error","error":"Retry later"}\n', "application/x-ndjson"), () => {}), /Retry later/);
  await assert.rejects(readAiResponse(Response.json(result), () => {}), /Invalid AI response format/);
  await assert.rejects(readAiResponse(Response.json({ error: "No key" }, { status: 503 }), () => {}), /No key/);
});

test("canceling the browser response aborts upstream work", async () => {
  let signal!: AbortSignal;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const response = aiStreamResponse(async (_emit, upstream) => {
    signal = upstream;
    started();
    await new Promise<void>((resolve) => upstream.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("aborted");
  }, () => "failed", new AbortController().signal);
  const reader = response.body!.getReader();
  await reader.read();
  await ready;
  await reader.cancel();
  assert.equal(signal.aborted, true);
});

test("provider failures become stream errors rather than false completion", async () => {
  const response = aiStreamResponse(async (emit) => {
    emit({ type: "operations", counts: { insert: 2 }, total: 2, errors: 0 });
    throw new Error("upstream failed");
  }, () => "No changes were applied", new AbortController().signal);
  await assert.rejects(readAiResponse(response, () => {}), /No changes were applied/);
});

test("SSE reconstructs tool arguments and preserves thought signatures without displaying them", async () => {
  const visible: string[] = [];
  let building = false;
  const response = streamed(
    ': heartbeat\r\n\r\n' + frame({ content: "見出しを", reasoning_content: "PRIVATE" }) +
    frame({ content: "調整します" }) +
    frame({ tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "edit_site", arguments: '{"oper' }, extra_content: { google: { thought_signature: "SECRET_SIGNATURE" } } }] }) +
    frame({ tool_calls: [{ index: 0, function: { arguments: 'ations":[]}' } }] }) + frame({}, "tool_calls") + 'data: [DONE]\r\n\r\n'
  );
  const data = await readCompletionStream(response, (s) => visible.push(s), () => { building = true; });
  assert.equal(visible.join(""), "見出しを調整します");
  assert.equal(building, true);
  const call = data.choices[0].message.tool_calls![0];
  assert.deepEqual(JSON.parse(call.function.arguments), { operations: [] });
  assert.equal(call.extra_content.google.thought_signature, "SECRET_SIGNATURE");
  assert.equal(call.id, "call1");
});

test("truncated upstream streams cannot execute a partial tool call", async () => {
  await assert.rejects(readCompletionStream(streamed(frame({ tool_calls: [{ index: 0, function: { name: "edit_site", arguments: "{" } }] })), () => {}, () => {}), /before completion/);
});

test("Gemini streams explanations and actual phases across repair turns", async (t) => {
  let count = 0;
  let toolCount = 0;
  const events: AiProgress[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    count++;
    if (count <= 2) {
      if (count === 2) assert.equal(body.messages.at(-2).tool_calls[0].extra_content.google.thought_signature, "sig");
      return streamed(frame({ content: count === 1 ? "文字を変更します" : "対象を確認し直します" }) +
        frame({ tool_calls: [{ index: 0, id: `c${count}`, type: "function", function: { name: "edit_site", arguments: '{"operations":[]}' }, extra_content: { google: { thought_signature: "sig" } } }] }) + frame({}, "tool_calls"));
    }
    return streamed(frame({ content: "変更案ができました" }) + frame({}, "stop"));
  });
  const reply = await runAi(config, turns, () => ({ content: "result", isError: ++toolCount === 1 }), undefined, (e) => events.push(e));
  assert.equal(reply, "変更案ができました");
  assert.deepEqual(events.filter((e) => e.type === "phase").map((e: any) => e.phase), ["planning", "generating", "validating", "repairing", "generating", "validating", "reviewing"]);
  assert.equal(events.filter((e) => e.type === "text").length, 3);
  assert.doesNotMatch(JSON.stringify(events), /thought_signature/);
});

test("providers that reject streaming retain phase progress and fall back to JSON", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++count === 1) { assert.equal(body.stream, true); return new Response("stream is unsupported", { status: 400 }); }
    assert.equal(body.stream, undefined);
    return Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] });
  });
  const events: AiProgress[] = [];
  assert.equal(await runAi(config, turns, () => ({ content: "", isError: false }), undefined, (e) => events.push(e)), "OK");
  assert.equal(count, 2);
  assert.equal(events[0].type, "phase");
  assert.equal(events[1].type, "text");
});

test("activity coalesces text deltas and keeps turn boundaries and operation facts", () => {
  let events: AiProgress[] = [];
  events = appendAiProgress(events, { type: "text", text: "見出しを", turn: 1 });
  events = appendAiProgress(events, { type: "text", text: "変更します", turn: 1 });
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).text, "見出しを変更します");
  events = appendAiProgress(events, { type: "operations", counts: { set_text: 1 }, total: 1, errors: 0 });
  events = appendAiProgress(events, { type: "text", text: "完了", turn: 2 });
  assert.equal(events.length, 3);
});

test("Claude streams only public text and preserves private blocks for its own tool loop", async (t) => {
  const event = (type: string, fields: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
  let count = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json();
    assert.equal(body.stream, true);
    const start = event("message_start", { message: { id: "m", type: "message", role: "assistant", model: "test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    if (++count === 1) return streamed(start +
      event("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }) +
      event("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "PRIVATE_THOUGHT" } }) +
      event("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "PRIVATE_SIG" } }) +
      event("content_block_stop", { index: 0 }) +
      event("content_block_start", { index: 1, content_block: { type: "text", text: "" } }) +
      event("content_block_delta", { index: 1, delta: { type: "text_delta", text: "文字を調整します" } }) +
      event("content_block_stop", { index: 1 }) +
      event("content_block_start", { index: 2, content_block: { type: "tool_use", id: "c1", name: "edit_site", input: {} } }) +
      event("content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: '{"operations":[]}' } }) +
      event("content_block_stop", { index: 2 }) +
      event("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } }) + event("message_stop", {}));
    assert.equal(body.messages.at(-2).content[0].signature, "PRIVATE_SIG");
    return streamed(start + event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text: "完了" } }) + event("content_block_stop", { index: 0 }) +
      event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }) + event("message_stop", {}));
  });
  const events: AiProgress[] = [];
  assert.equal(await runAi({ ...config, provider: "anthropic" }, turns, () => ({ content: "ok", isError: false }), undefined, (e) => events.push(e)), "完了");
  assert.match(JSON.stringify(events), /文字を調整します/);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
});

test("errors reported inside the upstream stream keep their status", async () => {
  await assert.rejects(
    readCompletionStream(streamed('data: [{"error":{"code":503,"message":"The model is overloaded."}}]\n\n'), () => {}, () => {}),
    (e: any) => e.status === 503 && /overloaded/.test(e.message)
  );
});

test("tool calls streamed without an index are told apart by id", async () => {
  const response = streamed(
    frame({ tool_calls: [{ id: "a", type: "function", function: { name: "edit_site", arguments: '{"operations":[]}' } }] }) +
    frame({ tool_calls: [{ id: "b", type: "function", function: { name: "edit_site", arguments: '{"operations":[1]}' } }] }) +
    frame({}, "tool_calls") + 'data: [DONE]\n\n'
  );
  const data = await readCompletionStream(response, () => {}, () => {});
  assert.deepEqual(data.choices[0].message.tool_calls!.map((c: any) => [c.id, c.function.arguments]), [["a", '{"operations":[]}'], ["b", '{"operations":[1]}']]);
});
