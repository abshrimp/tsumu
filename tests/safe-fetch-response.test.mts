import assert from "node:assert/strict";
import { test } from "node:test";
import { readTextLimited, TooLargeError } from "../lib/safe-fetch";

const encoder = new TextEncoder();

/** Keep the upstream open so rejecting a chunk must cancel unread data. */
function openResponse(chunk: Uint8Array, cancel: () => void, headers?: HeadersInit) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(chunk); },
    cancel,
  }), { headers });
}

test("invalid UTF-8 cancels the unread response and releases its reader", async () => {
  let cancellations = 0;
  const response = openResponse(Uint8Array.of(0x22, 0xff), () => { cancellations++; });
  await assert.rejects(readTextLimited(response, 1024), TypeError);
  assert.equal(cancellations, 1, "the upstream must stop after decoding fails");
  assert.equal(response.body!.locked, false);
});

test("cleanup failures do not replace the original decoding or size error", async () => {
  for (const [chunk, limit, expected] of [
    [Uint8Array.of(0xff), 1024, TypeError],
    [encoder.encode("too large"), 1, TooLargeError],
  ] as const) {
    let cancellations = 0;
    const response = openResponse(chunk, () => {
      cancellations++;
      throw new Error("upstream cancellation failed");
    });
    await assert.rejects(readTextLimited(response, limit), expected);
    assert.equal(cancellations, 1);
    assert.equal(response.body!.locked, false);
  }
});

test("streamed size limits count UTF-8 bytes and cancel with missing or understated lengths", async () => {
  for (const headers of [undefined, { "content-length": "1" }]) {
    let cancellations = 0;
    const response = openResponse(encoder.encode("日本"), () => { cancellations++; }, headers);
    await assert.rejects(readTextLimited(response, 5), TooLargeError);
    assert.equal(cancellations, 1);
    assert.equal(response.body!.locked, false);
  }
});

test("oversized declared lengths cancel before acquiring a reader", async () => {
  let cancellations = 0;
  const response = openResponse(encoder.encode("{}"), () => { cancellations++; }, { "content-length": "100" });
  await assert.rejects(readTextLimited(response, 10), TooLargeError);
  assert.equal(cancellations, 1);
  assert.equal(response.body!.locked, false);
});

test("successful reads preserve split UTF-8 at the exact byte limit and release the reader", async () => {
  const text = '{"message":"日本語🌱"}';
  const bytes = encoder.encode(text);
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
    cancel() { cancellations++; },
  }));
  assert.equal(await readTextLimited(response, bytes.length), text);
  assert.equal(cancellations, 0, "completed responses do not need cancellation");
  assert.equal(response.body!.locked, false);
});

test("truncated UTF-8 at EOF rejects and releases the reader", async () => {
  const response = new Response(Uint8Array.of(0xe6, 0x97));
  await assert.rejects(readTextLimited(response, 1024), TypeError);
  assert.equal(response.body!.locked, false);
});

test("upstream read failures preserve their error and release the reader", async () => {
  const failure = new Error("upstream disconnected");
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.error(failure); },
  }));
  await assert.rejects(readTextLimited(response, 1024), (error) => error === failure);
  assert.equal(response.body!.locked, false);
});

test("empty and absent response bodies still return empty text", async () => {
  for (const response of [new Response(""), new Response(null)]) {
    assert.equal(await readTextLimited(response, 0), "");
    assert.ok(!response.body?.locked);
  }
});
