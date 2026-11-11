import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { requireEditableHtmlContent } from "../lib/html-file-import";
import type { HtmlConversion } from "../lib/html-to-site";

test("a zero-element HTML conversion cannot replace a page", () => {
  const doc = createInitialDoc();
  const home = doc.pageOrder[0];
  doc.pages[home].children = [];
  const result: HtmlConversion = { doc, warnings: [] };
  assert.throws(() => requireEditableHtmlContent(result), /no editable elements/);
  doc.pages[home].children = ["existing"];
  assert.equal(requireEditableHtmlContent(result), result);
});

test("a multi-page conversion rejects an empty page even if an earlier page contains elements", () => {
  const doc = createInitialDoc();
  const home = doc.pageOrder[0];
  doc.pages[home].children = ["existing"];
  doc.pages.other = { id: "other", name: "Empty", slug: "other", title: "", description: "", children: [] };
  doc.pageOrder.push("other");
  assert.throws(() => requireEditableHtmlContent({ doc, warnings: [] }), /no editable elements/);
});
