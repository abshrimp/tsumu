import assert from "node:assert/strict";
import { test } from "node:test";
import { publishDocUpdate, subscribeDocUpdates } from "../lib/collab-events";
import type { DocUpdatedMessage } from "../lib/collab";

const message = (rev: string): DocUpdatedMessage => ({
  type: "doc-updated",
  rev,
  savedAt: 1,
  senderId: "a",
  doc: { siteName: "S", pages: {}, pageOrder: [], nodes: {}, assets: {} } as never,
});

test("保存の通知は、同じサイトの購読者だけに届く", () => {
  const got: string[] = [];
  const offA = subscribeDocUpdates("site-a", (m, raw) => {
    got.push(`a:${m.rev}`);
    assert.equal(JSON.parse(raw).rev, m.rev);
  });
  const offB = subscribeDocUpdates("site-b", (m) => got.push(`b:${m.rev}`));
  publishDocUpdate("site-a", message("1"));
  publishDocUpdate("site-c", message("2"));
  assert.deepEqual(got, ["a:1"]);
  offA();
  offB();
});

test("購読をやめたら届かず、1つの購読者の失敗はほかに影響しない", () => {
  const got: string[] = [];
  const off1 = subscribeDocUpdates("s", () => {
    throw new Error("closed");
  });
  const off2 = subscribeDocUpdates("s", (m) => got.push(m.rev));
  publishDocUpdate("s", message("1"));
  off2();
  publishDocUpdate("s", message("2"));
  off1();
  assert.deepEqual(got, ["1"]);
});
