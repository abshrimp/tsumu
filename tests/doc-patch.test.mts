import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocPatch, applyDocPatch, applyDocPatchAtRevision, isDocPatch, MAX_PATCH_OPS } from "../lib/doc-patch";
import { saveCurrentDoc, saveDocPatch, readCurrentDoc } from "../lib/doc-storage";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";
import type { SiteDoc } from "../lib/types";

const doc = (): SiteDoc => ({
  siteName: "Example", pages: { home: { id: "home", name: "Home", slug: "", children: ["node-1"] } },
  nodes: { "node-1": { id: "node-1", type: "text", name: "Text", children: [], text: "Hello", style: {} } },
  pageOrder: ["home"], assets: {},
} as SiteDoc);

async function database(run: (db: Db, statements: { sql: string; args: unknown[] }[]) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-delta-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const real = await getDbFromBinding(nodeDatabase()!);
    await insertSite(real, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const statements: { sql: string; args: unknown[] }[] = [];
    const db: Db = { ...real, execute: async (stmt) => {
      statements.push(typeof stmt === "string" ? { sql: stmt, args: [] } : stmt);
      return real.execute(stmt);
    } };
    await run(db, statements);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("one element edit sends only that element and leaves the base immutable", () => {
  const base = doc();
  for (let n = 0; n < 1000; n++) base.nodes[`extra-${n}`] = { ...base.nodes["node-1"], id: `extra-${n}`, text: "x".repeat(1000) };
  const next = structuredClone(base);
  next.nodes["node-1"].text = "Edited";
  const patch = createDocPatch(base, next)!;
  assert.deepEqual(patch.map((op) => op.path), [["nodes", "node-1"]]);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(next).length / 1000);
  assert.deepEqual(applyDocPatch(base, patch), next);
  assert.equal(base.nodes["node-1"].text, "Hello");
  assert.deepEqual(createDocPatch(base, structuredClone(base)), []);
});

test("invalid, overlapping and destructive paths are rejected", () => {
  for (const patch of [
    [{ path: [], value: {} }], [{ path: ["__proto__", "polluted"], value: true }],
    [{ path: ["nodes", "a.b"], value: {} }], [{ path: ["pages"], remove: true }],
    [{ path: ["pageOrder"], value: {} }], [{ path: ["nodes"], value: [] }],
    [{ path: ["siteName"], value: "A", remove: true }],
    [{ path: ["nodes"], value: {} }, { path: ["nodes", "a"], remove: true }],
  ]) assert.equal(isDocPatch(patch), false, JSON.stringify(patch));
  const base = doc();
  const next = structuredClone(base);
  for (let n = 0; n <= MAX_PATCH_OPS; n++) next.nodes[`extra-${n}`] = base.nodes["node-1"];
  assert.equal(createDocPatch(base, next), null, "bulk edits use a full snapshot");
});

test("missing and out-of-order revisions require a snapshot instead of applying a patch", () => {
  const base = doc();
  const next = { ...base, siteName: "Updated" };
  const patch = createDocPatch(base, next)!;
  assert.equal(applyDocPatchAtRevision(base, "1", "2", patch), null);
  assert.equal(applyDocPatchAtRevision(null, "1", "1", patch), null);
  assert.deepEqual(applyDocPatchAtRevision(base, "1", "1", patch), next);
});

test("SQL patches preserve nulls, arrays, additions and removals without fetching the body", async () => {
  await database(async (db, statements) => {
    const base = doc();
    base.description = "remove me";
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = structuredClone(base);
    next.siteName = "Updated";
    delete next.description;
    delete next.nodes["node-1"];
    next.nodes["node-2"] = { ...base.nodes["node-1"], id: "node-2", text: 'quote " and 日本語', custom: { nullable: null, flag: false, zero: 0 } } as any;
    next.pages.home.children = ["node-2"];
    next.components = {};
    const patch = createDocPatch(base, next)!;
    statements.length = 0;
    const result = await saveDocPatch(db, "s1", patch, "1");
    assert.equal(result.kind, "saved");
    assert.equal(statements.some((s) => /SELECT rev, saved_at, body/.test(s.sql)), false);
    assert.equal(statements.length, 2, "one update plus one conditional database-side backup");
    assert.ok(statements[0].args.length <= 100);
    assert.equal(statements.some((s) => s.args.includes(JSON.stringify(base))), false);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
    assert.deepEqual(applyDocPatch(base, patch), next);
    const backup = await db.execute("SELECT body FROM site_backups WHERE site_id = 's1'");
    assert.deepEqual(JSON.parse(String(backup.rows[0].body)), base, "same-day backup is preserved");
    const conflict = await saveDocPatch(db, "s1", patch, "1");
    assert.equal(conflict.kind, "conflict");
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});

test("the maximum patch size fits parameter limits and applies all chunks correctly", async () => {
  await database(async (db, statements) => {
    const base = doc();
    for (let n = 0; n < MAX_PATCH_OPS; n++) base.nodes[`item-${n}`] = { ...base.nodes["node-1"], id: `item-${n}` };
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = structuredClone(base);
    for (let n = 0; n < MAX_PATCH_OPS; n++) {
      if (n % 3 === 0) delete next.nodes[`item-${n}`];
      else next.nodes[`item-${n}`].text = `Updated ${n}`;
    }
    const patch = createDocPatch(base, next)!;
    assert.equal(patch.length, MAX_PATCH_OPS);
    statements.length = 0;
    assert.equal((await saveDocPatch(db, "s1", patch, "1")).kind, "saved");
    assert.ok(statements[0].args.length <= 100);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});
