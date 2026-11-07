import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateImportedDoc } from "../lib/site-import";

const read = (relative: string) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");

test("bundled AI skill type reference matches the current SiteDoc definitions", () => {
  assert.equal(read("skills/tsumu-site/references/types.ts"), read("lib/types.ts"),
    "Update the AI skill type snapshot whenever lib/types.ts changes.");
});

test("the AI skill example imports as a valid editable site with resolved references", () => {
  const doc = JSON.parse(read("skills/tsumu-site/references/minimal-site.json"));
  assert.equal(validateImportedDoc(doc), doc);
  assert.ok(doc.pageOrder.length > 0);
  for (const id of doc.pageOrder) {
    const page = doc.pages[id];
    assert.equal(page.id, id);
    for (const child of page.children) assert.ok(doc.nodes[child], "Missing page child " + child);
  }
  for (const [id, node] of Object.entries(doc.nodes) as [string, { id: string; children: string[] }][]) {
    assert.equal(node.id, id);
    for (const child of node.children) assert.ok(doc.nodes[child], "Missing node child " + child);
  }
});
