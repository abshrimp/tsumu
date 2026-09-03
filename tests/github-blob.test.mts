import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { gitBlobRequestBody } from "../lib/github-blob";

test("blob body is the same JSON GitHub would get from JSON.stringify", () => {
  for (const size of [0, 1, 2, 3, 1000, 65_537]) {
    const bytes = randomBytes(size);
    const expected = JSON.stringify({ content: bytes.toString("base64"), encoding: "base64" });
    assert.equal(gitBlobRequestBody(bytes), expected);
  }
});

test("blob body encodes only the viewed bytes of a subarray", () => {
  const whole = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const parsed = JSON.parse(gitBlobRequestBody(whole.subarray(2, 5)));
  assert.deepEqual([...Buffer.from(parsed.content, "base64")], [3, 4, 5]);
  assert.equal(parsed.encoding, "base64");
});
