import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { parseSiteImport, validateImportedDoc } from "../lib/site-import";

const encoder = new TextEncoder();

test("imported node settings must have usable shape before the document is persisted", async () => {
  const corruptions: { name: string; patch: Record<string, unknown> }[] = [
    { name: "missing styles", patch: { styles: null } },
    { name: "array styles", patch: { styles: [] } },
    { name: "non-string CSS property", patch: { styles: { base: { default: { color: 1 } } } } },
    { name: "unknown node type", patch: { type: "unknown-element" } },
    { name: "unknown node semantic", patch: { semantic: "script" } },
    { name: "non-string text", patch: { text: { content: 42, heading: 0 } } },
    { name: "non-string link", patch: { link: { kind: "url", url: 5 } } },
    { name: "invalid image source", patch: { image: { src: {}, alt: "", width: 10, height: 10 } } },
    { name: "malformed field options", patch: { field: { kind: "select", options: [false] } } },
    { name: "non-array scripts", patch: { scripts: { steps: [] } } },
    { name: "invalid icon SVG", patch: { icon: { name: "imported", svg: 3 } } },
  ];
  for (const { name, patch } of corruptions) {
    const doc = createInitialDoc();
    const node = Object.values(doc.nodes)[0];
    Object.assign(node, patch);
    assert.throws(() => validateImportedDoc(doc), /要素の設定/, name);
    await assert.rejects(parseSiteImport(encoder.encode(JSON.stringify(doc)), "doc"), /要素の設定/, name);
  }
});

test("imported page style maps cannot contain malformed declarations", () => {
  const doc = createInitialDoc();
  Object.assign(doc.pages[doc.pageOrder[0]], {
    bodyStyles: { base: { default: { backgroundColor: ["red"] } } },
  });
  assert.throws(() => validateImportedDoc(doc), /ページの構造/);
});

test("valid documents retain editable node styles after validation", () => {
  const doc = createInitialDoc();
  assert.equal(validateImportedDoc(doc), doc);
});
