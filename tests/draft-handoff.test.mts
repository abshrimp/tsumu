import { test } from "node:test";
import assert from "node:assert/strict";
import { openDraftHandoff, sealDraftHandoff } from "../lib/external-edit/draft-handoff";

const draft = {
  id: "12345678-1234-4234-8234-123456789abc",
  secret: "s".repeat(43),
};

test("draft handoff uses randomized authenticated encryption", async () => {
  const token1 = await sealDraftHandoff(draft, "sign-in-secret-for-tests");
  const token2 = await sealDraftHandoff(draft, "sign-in-secret-for-tests");
  assert.notEqual(token1, token2, "AES-GCM must use a fresh nonce");
  assert.doesNotMatch(token1, /tsumu-import|12345678|ssss/);
  assert.deepEqual(await openDraftHandoff(token1, "sign-in-secret-for-tests"), draft);
  assert.equal(await openDraftHandoff(token1, "wrong-secret"), null);
  const [nonce, cipher] = token1.split(".");
  const tampered = (cipher[0] === "A" ? "B" : "A") + cipher.slice(1);
  assert.equal(await openDraftHandoff(nonce + "." + tampered, "sign-in-secret-for-tests"), null);
  assert.equal(await openDraftHandoff("invalid", "sign-in-secret-for-tests"), null);
});

test("reject malformed draft credentials before encryption", async () => {
  await assert.rejects(() => sealDraftHandoff({ ...draft, secret: "short" }, "sign-in-secret-for-tests"));
  await assert.rejects(() => sealDraftHandoff(draft, ""));
});
