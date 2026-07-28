import assert from "node:assert/strict";
import { test } from "node:test";
import { cssQuotedAttributeValue } from "../lib/css-selector";
import { buildCanvasCss } from "../components/canvas/css";
import { canvasMoveDoc } from "./helpers/canvas-move";

test("node selectors quote CSS punctuation, HTML terminators, and control characters", () => {
  for (const id of [
    "normal-123",
    'a"] { } body { display:none } /*',
    'x</style><script>alert(1)</script>',
    'a\nb',
    'unicode-漢字-😀',
    'closing\\bracket',
  ]) {
    const selector = cssQuotedAttributeValue(id);
    assert.ok(selector.startsWith('"') && selector.endsWith('"'));
    assert.equal(selector.includes("</style>"), false);
    assert.equal(selector.includes('"] {'), false);
    const rebuilt = selector.slice(1, -1).replace(/\\([0-9a-f]+) /gi,
      (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
    assert.equal(rebuilt, id);

    const doc = canvasMoveDoc();
    const node = doc.nodes.a;
    delete doc.nodes.a;
    doc.nodes[id] = { ...node, id };
    doc.pages.p.children = [id];
    const css = buildCanvasCss(doc, [id], "base", "preview", null, "default");
    assert.ok(css.includes("[data-node=" + selector + "]"));
    assert.doesNotMatch(css, /<\/style>|body \{ display:none \}/i);
  }
});

test("simple IDs retain the same valid CSS selectors", () => {
  assert.equal(cssQuotedAttributeValue("node_123-abc"), '"node_123-abc"');
  assert.equal(cssQuotedAttributeValue("a.b"), '"a\\2e b"');
  assert.equal(cssQuotedAttributeValue("a/b"), '"a\\2f b"');
});
