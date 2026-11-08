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
