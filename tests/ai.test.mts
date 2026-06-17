import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAiOps, buildAiContext, type AiOp } from "../lib/aiOps";
import { applyAiEdits, AiEditConflict } from "../lib/ai/client";
import { parseAiRequest, readAiRequest, MAX_REQUEST_BYTES } from "../lib/ai/request";
import { runAi, AiApiError } from "../lib/ai/run";
import { aiConfig, type AiConfig } from "../lib/ai/config";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return { siteName: "Test", pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    pageOrder: ["p"], nodes: { a: { ...makeBox(), id: "a" } }, assets: {} };
}
const target = { pageId: "p" };
const config: AiConfig = { enabled: true, provider: "gemini", apiKey: "test-key", model: "gemini-test", baseUrl: "https://example.test/v1", effort: "medium", reason: null };
const turns = [{ role: "user" as const, text: "ヒーローを作って" }];
const tool = (args: unknown, id = "call1", extra = {}) => ({ id, type: "function", function: { name: "edit_site", arguments: JSON.stringify(args) }, ...extra });
const completion = (message: unknown, finish_reason = "stop") => Response.json({ choices: [{ message, finish_reason }] });

// Use complete request/response contracts; no external keys or network required.
test("Gemini keeps thought signatures, repairs tool errors, and replays exact node IDs with one undo", async (t) => {
  const original = fixture();
  const context = buildAiContext(original, target);
  const serverDoc = structuredClone(context.doc);
  const refs = new Map<string, string>();
  const applied: AiOp[] = [];
  const signature = { extra_content: { google: { thought_signature: "opaque-signature" } } };
  const sent: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent.push(JSON.parse(init.body));
    if (sent.length === 1) return completion({ role: "assistant", content: null, tool_calls: [tool({ operations: [
      { op: "insert", node: { type: "box", ref: "hero" } },
      { op: "insert", parent: "missing", node: { type: "text", text: "broken" } },
    ] }, "call1", signature)] }, "tool_calls");
    if (sent.length === 2) {
      assert.deepEqual(sent[1].messages.at(-2).tool_calls[0].extra_content, signature.extra_content);
      assert.match(sent[1].messages.at(-1).content, /Error:/);
      return completion({ role: "assistant", content: "修正します", tool_calls: [tool({ operations: [
        { op: "insert", parent: "hero", node: { type: "heading", ref: "title", text: "Hello" } },
      ] }, "call2")] }, "tool_calls");
    }
    return completion({ role: "assistant", content: "ヒーローを作りました。" });
  });
  const reply = await runAi(config, turns, (input: any) => {
    const result = applyAiOps(serverDoc, input.operations, target, refs);
    applied.push(...result.applied);
    return { content: JSON.stringify(result), isError: result.errors.length > 0 };
  });
  assert.equal(reply, "ヒーローを作りました。");
  assert.equal(sent.length, 3);
  useEditor.getState().replaceDoc(original);
  useEditor.getState().updateDoc((doc) => applyAiEdits(doc, context, applied));
  assert.deepEqual(buildAiContext(useEditor.getState().doc, target).doc, serverDoc);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
  useEditor.getState().redo();
  assert.deepEqual(buildAiContext(useEditor.getState().doc, target).doc, serverDoc);
});

test("a failed nested insert leaves no orphan nodes or refs", () => {
  const doc = fixture();
  const refs = new Map<string, string>();
  const result = applyAiOps(doc, [{ op: "insert", node: { type: "box", ref: "hero", children: [null as any] } }], target, refs);
  assert.equal(result.applied.length, 0);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(doc, fixture());
  assert.equal(refs.size, 0);
});

test("replay never silently changes an occupied node ID", () => {
  const doc = fixture();
  assert.equal(applyAiOps(doc, [{ op: "insert", node: { type: "box", id: "a" } }], target).errors.length, 1);
  assert.deepEqual(doc, fixture());
});

test("AI cannot move a component root into its descendants or edit outside its scope", () => {
  const doc = fixture();
  doc.nodes.b = { ...makeBox(), id: "b" };
  doc.nodes.a.children = ["b"];
  doc.nodes.outside = { ...makeBox(), id: "outside" };
  const before = structuredClone(doc);
  const result = applyAiOps(doc, [
    { op: "move", id: "a", parent: "page" },
    { op: "rename", id: "outside", name: "wrong" },
    { op: "insert", after: "a", node: { type: "box" } },
  ], { pageId: "p", rootId: "a" });
  assert.equal(result.errors.length, 3);
  assert.deepEqual(doc, before);
});

test("manual edits made while waiting are preserved", () => {
  const doc = fixture();
  const context = buildAiContext(structuredClone(doc), target);
  doc.nodes.a.name = "Manual edit";
  assert.throws(() => applyAiEdits(doc, context, [{ op: "rename", id: "a", name: "AI edit" }]), AiEditConflict);
  assert.equal(doc.nodes.a.name, "Manual edit");
});

test("client replay is all-or-nothing when a later operation is invalid", () => {
  const doc = fixture();
  const context = buildAiContext(structuredClone(doc), target);
  assert.throws(() => applyAiEdits(doc, context, [
    { op: "rename", id: "a", name: "Changed" }, { op: "delete", id: "missing" },
  ]), AiEditConflict);
  assert.deepEqual(doc, fixture());
});

test("request validation rejects malformed and cyclic documents and ignores supplied summary", () => {
  for (const body of [null, [], {}, { messages: [null], context: {} }]) assert.throws(() => parseAiRequest(body));
  const context = buildAiContext(fixture(), { ...target, selection: "a", breakpoint: "sm" });
  const parsed = parseAiRequest({ messages: turns, context: { ...context, summary: "MADE UP STATE" } });
  assert.doesNotMatch(parsed.turns[0].text, /MADE UP STATE/);
  assert.match(parsed.turns[0].text, /selectedElementId.*a/);
  context.doc.nodes.a.children.push("a");
  assert.throws(() => parseAiRequest({ messages: turns, context }));
});

test("request limits count UTF-8 bytes, including chunked requests", async () => {
  const text = JSON.stringify({ text: "あ".repeat(Math.floor(MAX_REQUEST_BYTES / 3)) });
  assert.ok(text.length < MAX_REQUEST_BYTES);
  await assert.rejects(readAiRequest(new Request("https://example.test", { method: "POST", body: text })), RangeError);
  assert.deepEqual(await readAiRequest(new Request("https://example.test", { method: "POST", body: '{"ok":true}' })), { ok: true });
});

test("empty and truncated responses never report success", async (t) => {
  for (const response of [Response.json({ choices: [] }), completion({ content: "" }), completion({ content: "Changed" }, "length")]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(runAi(config, turns, () => ({ content: "ok", isError: false })), AiApiError);
    t.mock.restoreAll();
  }
});

test("unrepaired errors and exhausted tool loops fail without a stale success message", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => ++count === 1
    ? completion({ content: "Changed", tool_calls: [tool({ operations: [] })] }, "tool_calls")
    : completion({ content: "All done" }));
  await assert.rejects(runAi(config, turns, () => ({ content: "Missing node", isError: true })), (e: AiApiError) => e.kind === "incomplete");
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => completion({ content: "Changed", tool_calls: [tool({ operations: [] })] }, "tool_calls"));
  await assert.rejects(runAi(config, turns, () => ({ content: "ok", isError: false })), (e: AiApiError) => e.kind === "incomplete");
});

test("unsupported reasoning effort is retried once and auth/rate failures stay distinct", async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return requests.length === 1 ? new Response('Unsupported parameter: reasoning_effort', { status: 400 }) : completion({ content: "OK" });
  });
  assert.equal(await runAi({ ...config, provider: "openai" }, turns, () => ({ content: "ok", isError: false })), "OK");
  assert.equal(requests[0].reasoning_effort, "medium");
  assert.equal(requests[1].reasoning_effort, undefined);
  t.mock.restoreAll();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? new Response("high demand", { status: 503 }) : completion({ content: "OK" }));
  assert.equal(await runAi(config, turns, () => ({ content: "ok", isError: false })), "OK");
  assert.equal(calls, 2);
  t.mock.restoreAll();
  for (const [status, kind] of [[401, "auth"], [403, "auth"], [429, "rate"], [503, "rate"], [400, "other"]] as const) {
    t.mock.method(globalThis, "fetch", async () => new Response("Upstream error", { status }));
    await assert.rejects(runAi(config, turns, () => ({ content: "", isError: false })), (e: AiApiError) => e.kind === kind && e.status === status);
    t.mock.restoreAll();
  }
});

test("unknown tools and invalid JSON receive results before a repair turn", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (++count === 1) return completion({ content: null, tool_calls: [
      { id: "bad", type: "function", function: { name: "edit_site", arguments: "{" } },
      { id: "unknown", type: "function", function: { name: "other_tool", arguments: "{}" } },
    ] }, "tool_calls");
    if (count === 2) {
      const messages = JSON.parse(init.body).messages;
      assert.deepEqual(messages.slice(-2).map((m: any) => m.tool_call_id), ["bad", "unknown"]);
      return completion({ content: null, tool_calls: [tool({ operations: [] })] }, "tool_calls");
    }
    return completion({ content: "OK" });
  });
  assert.equal(await runAi(config, turns, () => ({ content: "ok", isError: false })), "OK");
});

test("abort cancels the upstream request", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    controller.abort();
  }));
  await assert.rejects(runAi(config, turns, () => ({ content: "", isError: false }), controller.signal), (e: AiApiError) => e.kind === "timeout");
});

test("Anthropic uses standard messages and returns tool results before finishing", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const req = new Request(input, init);
    const body = await req.json();
    assert.equal(req.headers.get("anthropic-beta"), null);
    assert.equal(body.fallbacks, undefined);
    assert.equal(body.model, "claude-test");
    if (++count === 1) return Response.json({ id: "msg1", type: "message", role: "assistant", content: [{ type: "tool_use", id: "call1", name: "edit_site", input: { operations: [] } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
    assert.equal(body.messages.at(-1).content[0].type, "tool_result");
    return Response.json({ id: "msg2", type: "message", role: "assistant", content: [{ type: "text", text: "Done" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  });
  assert.equal(await runAi({ ...config, provider: "anthropic", model: "claude-test" }, turns, () => ({ content: "ok", isError: false })), "Done");
});

test("provider config trims values, uses Gemini defaults, and validates custom URLs", () => {
  const keys = ["AI_ENABLED", "AI_PROVIDER", "AI_API_KEY", "GEMINI_API_KEY", "AI_MODEL", "AI_BASE_URL", "AI_EFFORT"];
  const previous = new Map(keys.map((k) => [k, process.env[k]]));
  try {
    keys.forEach((k) => delete process.env[k]);
    Object.assign(process.env, { AI_ENABLED: " true ", AI_PROVIDER: " GEMINI ", GEMINI_API_KEY: " test-key " });
    let conf = aiConfig();
    assert.equal(conf.enabled, true);
    assert.equal(conf.model, "gemini-3.8-flash");
    assert.equal(conf.apiKey, "test-key");
    process.env.AI_BASE_URL = "not a url";
    assert.equal(aiConfig().enabled, false);
    process.env.AI_BASE_URL = "https://example.test/v1/";
    assert.equal(aiConfig().baseUrl, "https://example.test/v1");
  } finally {
    previous.forEach((value, key) => value === undefined ? delete process.env[key] : process.env[key] = value);
  }
});

test("malformed model fields cannot clear text, hide content, or insert invalid images", () => {
  const doc = fixture();
  const result = applyAiOps(doc, [
    { op: "set_text", id: "a" },
    { op: "set_hidden", id: "a", breakpoints: ["not-a-breakpoint"] },
    { op: "insert", node: { type: "image", src: 123 } },
    { op: "insert", node: { type: "box", id: "__proto__" } },
    { op: "set_link", id: "a", link: { url: {} } },
  ] as any, target);
  assert.equal(result.errors.length, 5);
  assert.deepEqual(doc, fixture());
});

test("custom compatible providers do not require reasoning extensions", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(JSON.parse(init.body).reasoning_effort, undefined);
    return completion({ content: "OK" });
  });
  assert.equal(await runAi({ ...config, provider: "openai-compatible" }, turns, () => ({ content: "", isError: false })), "OK");
});
