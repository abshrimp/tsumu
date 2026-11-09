import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as editorRuntime from "../lib/safe-fetch";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";

const generated = transformSync(SAFE_FETCH_SOURCE, { loader: "ts", format: "esm" }).code;
const exportedRuntime = await import("data:text/javascript;base64," + Buffer.from(generated).toString("base64")) as typeof editorRuntime;

for (const [name, { readTextLimited, TooLargeError }] of [
  ["editor", editorRuntime], ["exported", exportedRuntime],
] as const) {
  for (const cancelFails of [false, true]) {
    test(`${name}: invalid UTF-8 cancels an unfinished body even if cancellation fails (${cancelFails})`, async () => {
      let cancellations = 0;
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([0xff])); },
        cancel() {
          cancellations++;
          if (cancelFails) throw new Error("cancel failed");
        },
      }));

      await assert.rejects(readTextLimited(response, 1024), TypeError);
      assert.equal(cancellations, 1, "stop the upstream body on decode failure");
      assert.equal(response.body!.locked, false);
    });
  }

  test(`${name}: exceeding the byte budget cancels the body and releases its lock`, async () => {
    let cancellations = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(5)); },
      cancel() { cancellations++; },
    }));

    await assert.rejects(readTextLimited(response, 4), TooLargeError);
    assert.equal(cancellations, 1);
    assert.equal(response.body!.locked, false);
  });

  test(`${name}: transport errors retain their identity and release the body lock`, async () => {
    const failure = new Error("upstream disconnected");
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(failure); },
    }));

    await assert.rejects(readTextLimited(response, 1024), (error) => error === failure);
    assert.equal(response.body!.locked, false);
  });

  test(`${name}: incomplete UTF-8 at EOF is rejected and releases the body lock`, async () => {
    const response = new Response(new Uint8Array([0xe6, 0x97]));

    await assert.rejects(readTextLimited(response, 1024), TypeError);
    assert.equal(response.body!.locked, false);
  });

  test(`${name}: split UTF-8 at the exact byte budget succeeds and releases the body lock`, async () => {
    const bytes = new TextEncoder().encode("日本語");
    let cancellations = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
      cancel() { cancellations++; },
    }));

    assert.equal(await readTextLimited(response, bytes.byteLength), "日本語");
    assert.equal(cancellations, 0);
    assert.equal(response.body!.locked, false);
    assert.equal(await readTextLimited(new Response(null), 0), "");
  });
}
