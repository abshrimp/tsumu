import assert from "node:assert/strict";
import { test } from "node:test";
import { readAssetForm } from "../lib/asset-upload";

test("multipart parsing counts all bytes, including fields and undeclared or understated bodies", async () => {
  const form = new FormData();
  form.append("file", new File(["ok"], "a.txt", { type: "text/plain" }));
  form.append("other", "x".repeat(1000));
  const request = () => new Request("https://editor.example/upload", { method: "POST", body: form });
  const good = await readAssetForm(request(), 4096);
  assert.equal(await (good!.get("file") as File).text(), "ok");
  for (const length of [null, "1", "4000"]) {
    const req = request();
    if (length !== null) req.headers.set("content-length", length);
    await assert.rejects(readAssetForm(req, 500), RangeError);
  }
});

async function timely<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("upload waited for body cancellation")), 500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

test("a declared oversized cloned upload rejects without consuming the other branch", async () => {
  const form = new FormData();
  form.set("file", new File(["preserved"], "a.txt", { type: "text/plain" }));
  const original = new Request("https://editor.example/upload", { method: "POST", body: form });
  original.headers.set("content-length", "4000");
  const clone = original.clone();
  try {
    await assert.rejects(timely(readAssetForm(clone, 500)), RangeError);
    assert.equal(original.bodyUsed, false);
    assert.equal(await ((await original.formData()).get("file") as File).text(), "preserved");
  } finally {
    void original.body?.cancel().catch(() => {});
  }
});

test("declared oversized uploads do not wait for an unresolved cleanup promise", async () => {
  let cancelled = false;
  const req = new Request("https://editor.example/upload", {
    method: "POST",
    headers: { "content-length": "4000", "content-type": "multipart/form-data; boundary=test" },
    body: new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(timely(readAssetForm(req, 500)), RangeError);
  assert.equal(cancelled, true);
});

test("streamed oversized cloned uploads reject while the other branch remains readable", async () => {
  const form = new FormData();
  form.set("file", new File(["x".repeat(1000)], "a.txt", { type: "text/plain" }));
  const original = new Request("https://editor.example/upload", { method: "POST", body: form });
  const clone = original.clone();
  try {
    await assert.rejects(timely(readAssetForm(clone, 500)), RangeError);
    assert.equal(original.bodyUsed, false);
    assert.equal(await ((await original.formData()).get("file") as File).text(), "x".repeat(1000));
  } finally {
    void original.body?.cancel().catch(() => {});
  }
});
