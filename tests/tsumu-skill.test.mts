import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "@typescript/typescript6";
import { validateImportedDoc } from "../lib/site-import";

const read = (relative: string) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");

test("the English AI Skill type reference matches the current SiteDoc model", () => {
  const snapshot = read("skills/tsumu-site/references/types.ts");
  const current = read("lib/types.ts");
  const normalized = (source: string) => {
    const file = ts.createSourceFile("site-doc.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal(file.parseDiagnostics.length, 0);
    return ts.createPrinter({ removeComments: true }).printFile(file);
  };
  assert.equal(normalized(snapshot), normalized(current),
    "Update the AI Skill TypeScript snapshot when lib/types.ts changes.");
  assert.doesNotMatch(snapshot, /[\u3040-\u30ff\u3400-\u9fff]/,
    "The AI Skill TypeScript documentation should be in English.");
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
