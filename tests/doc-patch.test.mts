import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocPatch, applyDocPatch, applyDocPatchAtRevision, isDocPatch, MAX_PATCH_OPS } from "../lib/doc-patch";
import {
  DocTooLargeError, docLimit, MAX_DOC_BYTES, readCurrentDoc, saveCurrentDoc, saveDocPatch, validateDocBody,
} from "../lib/doc-storage";
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
    assert.equal(statements.length, 2, "one conditional database-side backup plus one update");
    assert.ok(statements.every((s) => s.args.length <= 100));
    assert.equal(statements.some((s) => s.args.includes(JSON.stringify(base))), false);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
    assert.deepEqual(applyDocPatch(base, patch), next);
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
    assert.ok(statements.every((s) => s.args.length <= 100));
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});

test("the first save of a day keeps the previous day's final content as that day's backup", async () => {
  await database(async (db) => {
    const backups = async () => (await db.execute("SELECT day, saved_at, body FROM site_backups WHERE site_id = 's1'")).rows;
    const base = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const evening = { ...base, siteName: "End of the first day" };
    assert.equal((await saveCurrentDoc(db, "s1", JSON.stringify(evening), "1")).kind, "saved");
    assert.equal((await backups()).length, 0, "the day has not ended yet");

    const yesterday = Date.now() - 86_400_000;
    await db.execute({ sql: "UPDATE docs SET saved_at = ? WHERE id = 's1'", args: [yesterday] });
    // 翌日最初の保存で壊しても、前日の最後の内容が残る
    const broken = { ...evening, nodes: {}, pages: { home: { ...evening.pages.home, children: [] } } };
    assert.equal((await saveDocPatch(db, "s1", createDocPatch(evening, broken)!, "2")).kind, "saved");
    let rows = await backups();
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].day), new Date(yesterday).getUTCDay());
    assert.equal(Number(rows[0].saved_at), yesterday);
    assert.deepEqual(JSON.parse(String(rows[0].body)), evening);

    // 同じ日の2回目以降の保存では書き換えない
    assert.equal((await saveCurrentDoc(db, "s1", JSON.stringify({ ...broken, siteName: "Later" }), "3")).kind, "saved");
    rows = await backups();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(String(rows[0].body)), evening);
  });
});

test("documents larger than the storage allows are rejected as too large", async () => {
  await database(async (real) => {
    const base = doc();
    await saveCurrentDoc(real, "s1", JSON.stringify(base), null);
    // D1 は1つの値が約2MBまで。保存先の上限が小さければ、10MBより手前で止める
    const db: Db = { ...real, maxValueBytes: 2_000 };
    assert.equal(docLimit(db), 2_000);
    assert.equal(docLimit(real), MAX_DOC_BYTES);
    const big = structuredClone(base);
    big.nodes["node-1"].text = "x".repeat(3_000) as any;
    await assert.rejects(saveCurrentDoc(db, "s1", JSON.stringify(big), "1"), DocTooLargeError);
    await assert.rejects(saveDocPatch(db, "s1", createDocPatch(base, big)!, "1"), DocTooLargeError);
    // 差分は小さくても、反映後の本文が上限を超えるなら保存しない
    const large = structuredClone(base);
    large.nodes["node-1"].text = "z".repeat(1_500) as any;
    assert.equal((await saveCurrentDoc(real, "s1", JSON.stringify(large), "1")).kind, "saved");
    const grown = { ...large, siteName: "y".repeat(100) };
    const patchDb: Db = { ...real, maxValueBytes: JSON.stringify(large).length + 50 };
    await assert.rejects(saveDocPatch(patchDb, "s1", createDocPatch(large, grown)!, "2"), DocTooLargeError);
    assert.equal((await readCurrentDoc(real, "s1"))!.rev, "2");
    // 上限の見込みが外れて D1 が拒んだ場合も、大きさのエラーとして返す
    const d1: Db = { ...real, maxValueBytes: 2_000_000, execute: async (stmt) => {
      if (typeof stmt !== "string" && /^UPDATE docs/.test(stmt.sql)) throw new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG");
      return real.execute(stmt);
    } };
    await assert.rejects(saveCurrentDoc(d1, "s1", JSON.stringify(base), "2"), DocTooLargeError);
    assert.equal(new DocTooLargeError(docLimit(d1)).message, "ドキュメントが大きすぎます（2MBまで）");
  });
});

test("documents without any page are rejected, because the editor cannot open them", () => {
  const empty = { ...doc(), pages: {}, pageOrder: [] };
  assert.equal(validateDocBody(JSON.stringify(empty)), "不正なリクエスト");
  assert.equal(validateDocBody(JSON.stringify(doc())), null);
  assert.equal(isDocPatch([{ path: ["pageOrder"], value: [] }]), false);
  assert.equal(createDocPatch(doc(), empty), null, "falls back to a full save, which is rejected");
});
