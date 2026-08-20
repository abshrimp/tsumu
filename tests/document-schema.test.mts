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

test("runtime validation rejects malformed optional node, page, asset and site fields", () => {
  const fail = (mutate: (doc: Record<string, unknown>) => void) => {
    const doc = structuredClone(createInitialDoc()) as unknown as Record<string, unknown>;
    mutate(doc);
    assert.equal(validSiteDoc(doc), false);
  };
  const node = (doc: Record<string, unknown>) =>
    Object.values(doc.nodes as Record<string, Record<string, unknown>>)[0]!;
  const page = (doc: Record<string, unknown>) =>
    Object.values(doc.pages as Record<string, Record<string, unknown>>)[0]!;

  fail(doc => { node(doc).embed = { kind: "youtube", src: 42 }; });
  fail(doc => { node(doc).list = { from: "items", limit: "3" }; });
  fail(doc => { node(doc).field = { kind: "input", disabled: "false" }; });
  fail(doc => { node(doc).motions = [{ id: "m", trigger: "load", duration: "1", delay: 0, easing: "linear" }]; });
  fail(doc => { node(doc).htmlAttrs = { title: 123 }; });
  fail(doc => { node(doc).hiddenOn = ["sm", 123]; });
  fail(doc => { node(doc).link = { kind: "url", url: "/", newTab: "true" }; });
  fail(doc => { page(doc).rawHtml = 123; });
  fail(doc => { page(doc).noindex = "false"; });
  fail(doc => { doc.baseWidth = "1280"; });
  fail(doc => { doc.dataRevalidate = -1; });
  fail(doc => { doc.pwa = { enabled: true, display: "unrecognized" }; });
  fail(doc => { doc.customFonts = [{ family: "Example", weights: [400] }]; });
  fail(doc => { doc.assets = { a: { id: "a", name: "test.svg", width: "100", height: 100 } }; });
  fail(doc => { doc.assets = { a: { id: "a", name: "test.svg", width: 100 } }; });
  fail(doc => { doc.assets = { a: { id: "a", name: "test.svg", width: 100, height: 100, bytes: "10" } }; });
});

test("valid optional shapes survive the same runtime validators", () => {
  const doc = createInitialDoc();
  doc.baseWidth = 1280;
  doc.dataRevalidate = 0;
  doc.customFonts = [{ family: "Example", weights: ["400", "700"] }];
  doc.pwa = { enabled: true, display: "standalone", icon: { url: "/icon.png" } };
  const node = Object.values(doc.nodes)[0]!;
  node.motions = [{ id: "fade", trigger: "load", duration: 0.5, delay: 0, easing: "linear" }];
  node.htmlAttrs = { title: "example" };
  node.list = { from: "items", limit: 10 };
  assert.equal(validSiteDoc(doc), true);
});

test("patches cannot add unknown root fields or modify schemaVersion", () => {
  assert.equal(isDocPatch([{ path: ["arbitrary"], value: true }]), false);
  assert.equal(isDocPatch([{ path: ["schemaVersion"], value: 1 }]), false);
  assert.equal(isDocPatch([{ path: ["siteName"], value: "Site" }]), true);
  assert.equal(isDocPatch([{ path: ["nodes", "node_1"], value: {} }]), true);
});
