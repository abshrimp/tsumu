import assert from "node:assert/strict";
import { test } from "node:test";
import { previewDataVars } from "../lib/data";
import type { ScriptStep, SiteDoc } from "../lib/types";

function preview(copies: [string, string][], initial: Record<string, unknown>) {
  let sourceReads = 0;
  const vars = {
    source: { get value() {
      assert.ok(++sourceReads <= 20, "preview retried the same copy without making progress");
      return 7;
    } },
  };
  const steps: ScriptStep[] = copies.map(([into, src], i) => ({
    id: "copy-" + i, kind: "set-var", into, value: "{" + src + "}",
  }));
  const doc: SiteDoc = {
    siteName: "", pages: { p: {
      id: "p", name: "", title: "", description: "", slug: "", children: [],
      pageScripts: [
        { id: "load", pos: { x: 0, y: 0 }, trigger: "load", steps: Object.entries(initial).map(([into, value]) => ({
          id: "init-" + into, kind: "fetch", as: into, method: "GET", url: "/data", preview: { sample: value },
        })) },
        { id: "click", pos: { x: 0, y: 100 }, trigger: "click", steps },
      ],
    } }, pageOrder: ["p"], nodes: {}, assets: {},
  };
  return previewDataVars(doc, "p", { vars });
}

test("nested preview copies resolve downstream samples and preserve existing fields", () => {
  const result = preview([
    ["last", "article.title"], ["article.title", "source.value"],
    ["article.flag", "source.value"], ["constructor", "source.value"],
  ], { article: { flag: false } });
  assert.deepEqual(result, { article: { title: 7, flag: false }, last: 7, constructor: 7 });
});

test("unwritable or cyclic preview copies finish without inventing sample values", () => {
  const result = preview([
    ["rows.4", "source.value"], ["loopA", "loopB"], ["loopB", "loopA"],
  ], { rows: [] });
  assert.deepEqual(result, { rows: [] });
});
