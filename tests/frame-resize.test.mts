import assert from "node:assert/strict";
import { test } from "node:test";
import { frameResizeBundle } from "./helpers/frame-resize-browser";

test("frame resize browser regressions bundle the real Canvas and FrameStage", async () => {
  const bundle = await frameResizeBundle();
  assert.match(bundle, /function Canvas/);
  assert.match(bundle, /function FrameStage/);
  assert.match(bundle, /sameDocument/);
});
