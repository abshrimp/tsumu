import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonBodyTooLargeError, readJsonLimited } from "../lib/api-json";

async function withoutCleanupWait<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("request is waiting for upstream cancellation")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const declared of [false, true]) {
  test(`JSON ${declared ? "declared" : "streamed"} limit rejects a cloned request without awaiting its unread sibling`, async (t) => {
    const original = new Request("https://editor.example.test/api/test", {
      method: "POST", body: '{"value":"too large"}',
      headers: {
        "Content-Type": "application/json",
        ...(declared ? { "Content-Length": "21" } : {}),
      },
    });
    const request = original.clone();
    // もう一方の読み手を待つキャンセル処理が、エラー応答を止めないことを確かめる。
    t.after(() => { void original.body?.cancel().catch(() => {}); });
    await assert.rejects(withoutCleanupWait(readJsonLimited(request, 4)), JsonBodyTooLargeError);
    assert.equal(request.bodyUsed, true);
    assert.equal(request.body!.locked, false);
  });
}

test("invalid JSON UTF-8 cancels remaining input and releases the reader without awaiting cleanup", async () => {
  let cancelled = false;
  let reason: unknown;
  const request = new Request("https://editor.example.test/api/test", {
    method: "POST", headers: { "Content-Type": "application/json" }, duplex: "half",
    body: new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(Uint8Array.of(0xff)); },
      cancel(error) { cancelled = true; reason = error; return new Promise<void>(() => {}); },
    }),
  } as RequestInit);
  await assert.rejects(withoutCleanupWait(readJsonLimited(request, 64)), TypeError);
  assert.equal(cancelled, true);
  assert.ok(reason instanceof TypeError);
  assert.equal(request.body!.locked, false);
});

test("JSON reads preserve original upstream errors and release successful readers", async () => {
  const good = new Request("https://editor.example.test/api/test", {
    method: "POST", body: '{"name":"日本"}', headers: { "Content-Type": "application/json" },
  });
  assert.deepEqual(await readJsonLimited(good, 64), { name: "日本" });
  assert.equal(good.body!.locked, false);
  const failure = new Error("client disconnected");
  const broken = new Request("https://editor.example.test/api/test", {
    method: "POST", headers: { "Content-Type": "application/json" }, duplex: "half",
    body: new ReadableStream({ start(controller) { controller.error(failure); } }),
  } as RequestInit);
  await assert.rejects(readJsonLimited(broken, 64), error => error === failure);
  assert.equal(broken.body!.locked, false);
});
