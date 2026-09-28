import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAllTrash } from "../lib/asset-trash-client";

test("select-all loads beyond the first 100 Trash entries", async () => {
  const paths = Array.from({ length: 205 }, (_, i) => ({ path: `assets/${i}.png` }));
  const offsets: number[] = [];
  const items = await loadAllTrash(async (offset) => {
    offsets.push(offset);
    return { items: paths.slice(offset, offset + 100), hasMore: offset + 100 < paths.length };
  });
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.deepEqual(items, paths);
});

test("repeated assets are selected once, and malformed pagination fails", async () => {
  const result = await loadAllTrash(async offset => offset
    ? { items: [{ path: "assets/a" }, { path: "assets/b" }], hasMore: false }
    : { items: [{ path: "assets/a" }], hasMore: true });
  assert.deepEqual(result, [{ path: "assets/a" }, { path: "assets/b" }]);
  await assert.rejects(loadAllTrash(async () => ({ items: [], hasMore: true })));
});
