import assert from "node:assert/strict";
import { test } from "node:test";
import { readJsonLimited } from "../lib/api-json";

const encoder = new TextEncoder();

function request(chunks: Uint8Array[], length?: string, onCancel?: () => void): Request {
  let position = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position < chunks.length) controller.enqueue(chunks[position++]);
      else controller.close();
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

test("shared JSON reader preserves UTF-8 across chunk boundaries", async () => {
  const data = { name: "日本語", nested: { list: [1, true, null] } };
  const bytes = encoder.encode(JSON.stringify(data));
  const chunks = [...bytes].map((_, i) => bytes.slice(i, i + 1));
  assert.deepEqual(await readJsonLimited(request(chunks), bytes.length), data);
  assert.deepEqual(await readJsonLimited(request([bytes], String(bytes.length)), bytes.length), data);
});

test("shared JSON reader rejects oversized chunked bodies before JSON parsing", async () => {
  const bytes = encoder.encode(JSON.stringify({ message: "x".repeat(5000) }));
  let cancelled = false;
  await assert.rejects(readJsonLimited(request([
    bytes.slice(0, 1000), bytes.slice(1000),
  ], undefined, () => { cancelled = true; }), 4096), RangeError);
  assert.equal(cancelled, true);
  await assert.rejects(readJsonLimited(request([bytes], String(bytes.length)), 4096), RangeError);
  await assert.rejects(readJsonLimited(request([bytes], "invalid"), 4096), SyntaxError);
});

test("shared JSON reader rejects invalid JSON, invalid UTF-8 and missing bodies", async () => {
  await assert.rejects(readJsonLimited(request([encoder.encode("{broken")]), 1024), SyntaxError);
  await assert.rejects(readJsonLimited(request([new Uint8Array([0xff])]), 1024), TypeError);
  const empty = new Request("https://example.test/api/ai", { method: "POST" });
  await assert.rejects(readJsonLimited(empty, 1024), /Missing request body/);
});
