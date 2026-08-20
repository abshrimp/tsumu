import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { isDocPatch, docPatchSqlPath } from "../lib/doc-patch";

test("the persisted document requires its one canonical schema version", () => {
  const doc = createInitialDoc();
  assert.equal(doc.schemaVersion, 1);
  assert.equal(validSiteDoc(doc), true);
  const invalid: Record<string, unknown> = structuredClone(doc) as unknown as Record<string, unknown>;
  delete invalid.schemaVersion;
  assert.equal(validSiteDoc(invalid), false);
  invalid.schemaVersion = 2;
  assert.equal(validSiteDoc(invalid), false);
  assert.equal(isDocPatch([{ path: ["schemaVersion"], value: 2 }]), false);
});

test("malformed scripts cannot survive a round trip through document storage", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "s", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "a", kind: "set-var", into: "value", value: "1" }] }];
  assert.equal(validSiteDoc(doc), true);
  (page.pageScripts[0].steps[0] as unknown as Record<string, unknown>).kind = "unknown";
  assert.equal(validSiteDoc(doc), false);
});

test("document IDs and SQL patch paths use the same unambiguous grammar", () => {
  assert.equal(docPatchSqlPath(["nodes", "node-a_b"]), '$."nodes"."node-a_b"');
  assert.equal(isDocPatch([{ path: ["nodes", "node-a_b"], value: {} }]), true);
  assert.equal(isDocPatch([{ path: ["nodes", "a.b"], value: {} }]), false);
  assert.throws(() => docPatchSqlPath(["nodes", "a.b"]));
});
