import assert from "node:assert/strict";
import { test } from "node:test";
import { readJsonRequestLimited } from "../lib/read-json-request";

const encoder = new TextEncoder();

function request(chunks: Uint8Array[], length?: string, onCancel?: () => void): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() { onCancel?.(); },
  });
  return new Request("https://example.test/api/fetch-json", {
    method: "POST",
    ...(length === undefined ? {} : { headers: { "content-length": length } }),
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("bounded request reader preserves UTF-8 across chunk boundaries", async () => {
  const data = { name: "日本語", nested: { list: [1, true, null] } };
  const bytes = encoder.encode(JSON.stringify(data));
  const chunks = [...bytes].map((_, i) => bytes.slice(i, i + 1));
  assert.deepEqual(await readJsonRequestLimited(request(chunks), bytes.length), data);
  assert.deepEqual(await readJsonRequestLimited(request([bytes], String(bytes.length)), bytes.length), data);
});

test("bounded request reader rejects oversized chunked bodies before JSON parsing", async () => {
  const bytes = encoder.encode(JSON.stringify({ message: "x".repeat(5000) }));
  let cancelled = false;
  await assert.rejects(readJsonRequestLimited(request([
    bytes.slice(0, 1000), bytes.slice(1000),
  ], undefined, () => { cancelled = true; }), 4096), RangeError);
  assert.equal(cancelled, true);
  await assert.rejects(readJsonRequestLimited(request([bytes], String(bytes.length)), 4096), RangeError);
  await assert.rejects(readJsonRequestLimited(request([bytes], "invalid"), 4096), RangeError);
});

test("bounded request reader rejects invalid JSON, invalid UTF-8 and missing bodies", async () => {
  await assert.rejects(readJsonRequestLimited(request([encoder.encode("{broken")]), 1024), SyntaxError);
  await assert.rejects(readJsonRequestLimited(request([new Uint8Array([0xff])]), 1024), TypeError);
  const empty = new Request("https://example.test/api/ai", { method: "POST" });
  await assert.rejects(readJsonRequestLimited(empty, 1024), /Missing request body/);
});
