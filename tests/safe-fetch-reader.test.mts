import assert from "node:assert/strict";
import { test } from "node:test";
import { readTextLimited, TooLargeError } from "../lib/safe-fetch";

test("invalid UTF-8 cancels an unfinished response body and releases its reader", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([0xff])); },
    cancel() { cancelled = true; },
  });

  await assert.rejects(readTextLimited(new Response(body), 100), TypeError);
  assert.equal(cancelled, true, "rejected responses must stop the upstream producer");
  assert.equal(body.locked, false);
});

test("a cancellation failure does not hide the UTF-8 decoding error", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([0xff])); },
    cancel() {
      cancelled = true;
      throw new Error("upstream cleanup failed");
    },
  });

  await assert.rejects(readTextLimited(new Response(body), 100), TypeError);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("streamed byte overflow cancels the body and releases its reader", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array([65, 66]));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });

  await assert.rejects(readTextLimited(new Response(body), 3), TooLargeError);
  assert.equal(cancelled, true);
  assert.equal(pulls, 2, "must stop reading as soon as the byte budget is exceeded");
  assert.equal(body.locked, false);
});

test("a cancellation failure does not hide the byte limit error", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4)); },
    cancel() { return Promise.reject(new Error("upstream cleanup failed")); },
  });

  await assert.rejects(readTextLimited(new Response(body), 3), TooLargeError);
  assert.equal(body.locked, false);
});

test("upstream read errors are preserved and release the reader", async () => {
  const failure = new Error("upstream connection failed");
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.error(failure); },
  });

  await assert.rejects(readTextLimited(new Response(body), 100), (error) => error === failure);
  assert.equal(body.locked, false);
});

test("truncated UTF-8 at end of stream rejects and releases the reader", async () => {
  const response = new Response(new Uint8Array([0xe3, 0x81]));
  await assert.rejects(readTextLimited(response, 100), TypeError);
  assert.equal(response.body!.locked, false);
});

test("valid split UTF-8 at the exact byte limit is decoded and releases the reader", async () => {
  const bytes = new TextEncoder().encode("日本語");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
    cancel() { assert.fail("a successfully consumed body does not need cancellation"); },
  });

  assert.equal(await readTextLimited(new Response(body), bytes.length), "日本語");
  assert.equal(body.locked, false);
});

test("an oversized Content-Length cancels without reading or locking the body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { assert.fail("the advertised size already exceeds the limit"); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });

  await assert.rejects(readTextLimited(new Response(body, {
    headers: { "Content-Length": "4" },
  }), 3), TooLargeError);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("empty and absent response bodies remain valid at a zero byte limit", async () => {
  for (const response of [new Response(""), new Response(null)]) {
    assert.equal(await readTextLimited(response, 0), "");
    assert.equal(response.body?.locked ?? false, false);
  }
});
