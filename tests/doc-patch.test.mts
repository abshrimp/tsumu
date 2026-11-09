import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocPatch, applyDocPatch, applyDocPatchAtRevision, isDocPatch, MAX_PATCH_OPS } from "../lib/doc-patch";
import {
  DocTooLargeError, readCurrentDoc, saveCurrentDoc, saveDocPatch, validateDocBody,
} from "../lib/doc-storage";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";
import type { SiteDoc } from "../lib/types";

const doc = (): SiteDoc => ({
  schemaVersion: 1, siteName: "Example", pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["node-1"] } },
  nodes: { "node-1": { id: "node-1", type: "box", name: "Text", semantic: "auto", children: [],
    text: { content: "Hello", heading: 0 }, link: null, styles: {} } },
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
  for (let n = 0; n < 1000; n++) base.nodes[`extra-${n}`] = { ...base.nodes["node-1"], id: `extra-${n}`, text: { content: "x".repeat(1000), heading: 0 } };
  const next = structuredClone(base);
  next.nodes["node-1"].text!.content = "Edited";
  const patch = createDocPatch(base, next)!;
  assert.deepEqual(patch.map((op) => op.path), [["nodes", "node-1"]]);
  assert.ok(JSON.stringify(patch).length < JSON.stringify(next).length / 1000);
  assert.deepEqual(applyDocPatch(base, patch), next);
  assert.equal(base.nodes["node-1"].text!.content, "Hello");
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
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = structuredClone(base);
    next.siteName = "Updated";
    delete next.nodes["node-1"];
    next.nodes["node-2"] = { ...base.nodes["node-1"], id: "node-2", text: { content: 'quote " and 日本語', heading: 0 }, field: { kind: "input", disabled: false, maxLength: 0 } };
    next.pages.home.children = ["node-2"];
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

for (const duplicates of ["site fields", "collections", "collection entries"]) {
  for (const replacing of [false, true]) {
    test(`SQL patches update the validated values after a ${replacing ? "replacement" : "first"} snapshot with duplicate ${duplicates}`, async () => {
      await database(async db => {
        const original = doc();
        let base: string | null = null;
        if (replacing) {
          await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
          base = "1";
        }
        // JSON.parse takes the last value, whereas SQLite JSON paths select the
        // first. Exercise each level independently so no duplicate masks another.
        const node = original.nodes["node-1"];
        const acceptedNode = { ...node, name: "Accepted node" };
        const raw = duplicates === "site fields"
          ? JSON.stringify(original).slice(0, -1) + ',"siteName":"Accepted snapshot"}'
          : duplicates === "collections"
            ? JSON.stringify(original).slice(0, -1) + `,"nodes":${JSON.stringify({ "node-1": acceptedNode })}}`
            : JSON.stringify(original).replace(
              `"nodes":${JSON.stringify(original.nodes)}`,
              `"nodes":{"node-1":${JSON.stringify(node)},"node-1":${JSON.stringify(acceptedNode)}}`);
        const accepted = JSON.parse(raw) as SiteDoc;
        assert.equal(validateDocBody(raw), null);
        const saved = await saveCurrentDoc(db, "s1", raw, base);
        assert.equal(saved.kind, "saved");
        if (saved.kind !== "saved") return;
        assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), accepted);

        const next = structuredClone(accepted);
        next.siteName = "Patched snapshot";
        next.nodes["node-1"].name = "Patched node";
        const patch = createDocPatch(accepted, next)!;
        const result = await saveDocPatch(db, "s1", patch, saved.rev);
        assert.equal(result.kind, "saved");
        const current = (await readCurrentDoc(db, "s1"))!;
        assert.equal(current.rev, String(Number(saved.rev) + 1));
        assert.deepEqual(JSON.parse(current.body), next);
        assert.deepEqual(JSON.parse(current.body), applyDocPatch(accepted, patch));
      });
    });
  }
}

test("the maximum patch size fits parameter limits and applies all chunks correctly", async () => {
  await database(async (db, statements) => {
    const base = doc();
    for (let n = 0; n < MAX_PATCH_OPS; n++) base.nodes[`item-${n}`] = { ...base.nodes["node-1"], id: `item-${n}`, text: structuredClone(base.nodes["node-1"].text) };
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = structuredClone(base);
    for (let n = 0; n < MAX_PATCH_OPS; n++) {
      if (n % 3 === 0) delete next.nodes[`item-${n}`];
      else next.nodes[`item-${n}`].text!.content = `Updated ${n}`;
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

test("large documents save until the storage itself rejects them as too large", async () => {
  await database(async (real) => {
    const base = doc();
    await saveCurrentDoc(real, "s1", JSON.stringify(base), null);
    // 大きさの上限は決め打ちしない。D1 の公称2MBも、以前の10MBも超えて保存できる
    const large = structuredClone(base);
    large.nodes["node-1"].text!.content = "z".repeat(12 * 1024 * 1024);
    assert.equal((await saveCurrentDoc(real, "s1", JSON.stringify(large), "1")).kind, "saved");
    const edited = { ...large, siteName: "Edited" };
    assert.equal((await saveDocPatch(real, "s1", createDocPatch(large, edited)!, "2")).kind, "saved");
    // 保存先（D1）が大きすぎると拒んだときは、大きさのエラーとして返す
    const d1: Db = { ...real, execute: async (stmt) => {
      if (typeof stmt !== "string" && /^(UPDATE docs|WITH patched)/.test(stmt.sql)) {
        throw new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG");
      }
      return real.execute(stmt);
    } };
    await assert.rejects(saveCurrentDoc(d1, "s1", JSON.stringify(base), "3"), DocTooLargeError);
    await assert.rejects(saveDocPatch(d1, "s1", createDocPatch(edited, { ...edited, siteName: "A" })!, "3"), DocTooLargeError);
    assert.equal((await readCurrentDoc(real, "s1"))!.rev, "3");
  });
});

test("documents without any page are rejected, because the editor cannot open them", () => {
  const empty = { ...doc(), pages: {}, pageOrder: [] };
  assert.equal(validateDocBody(JSON.stringify(empty)), "不正なリクエスト");
  assert.equal(validateDocBody(JSON.stringify(doc())), null);
  assert.equal(isDocPatch([{ path: ["pageOrder"], value: [] }]), false);
  assert.equal(createDocPatch(doc(), empty), null, "falls back to a full save, which is rejected");
});


test("full snapshots reject missing page references and malformed document containers", () => {
  const original = doc();
  const invalid = [
    { ...original, pageOrder: ["missing"] },
    { ...original, pages: null },
    { ...original, nodes: [] },
    { ...original, assets: "assets" },
    { ...original, siteName: null },
    { ...original, pages: { home: { id: "home", children: "not-an-array" } } },
  ];
  for (const bad of invalid) {
    assert.equal(validateDocBody(JSON.stringify(bad)), "不正なリクエスト",
      JSON.stringify(bad));
  }
  assert.equal(validateDocBody(JSON.stringify(original)), null);
});

test("database-side patching does not persist invalid page order or missing page records", async () => {
  await database(async (db) => {
    const original = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    const badPatches = [
      [{ path: ["pages", "home"], remove: true }],
      [{ path: ["pageOrder"], value: ["missing"] }],
      [{ path: ["pages", "home"], value: { id: "home", children: "broken" } }],
    ] as const;
    for (const patch of badPatches) {
      await assert.rejects(
        saveDocPatch(db, "s1", patch as any, "1"),
        /不正な|invalid/i,
      );
      const current = await readCurrentDoc(db, "s1");
      assert.equal(current?.rev, "1");
      assert.deepEqual(JSON.parse(current!.body), original);
    }
    const fixed = { ...original.pages.home, name: "Renamed" };
    const ok = await saveDocPatch(db, "s1",
      [{ path: ["pages", "home"], value: fixed }], "1");
    assert.equal(ok.kind, "saved");
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body).pages.home, fixed);
  });
});

test("snapshots and atomic patches reject broken node trees without advancing the revision", async () => {
  await database(async (db) => {
    const original = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    for (const changed of [
      { ...original, nodes: {} },
      { ...original, nodes: { "node-1": null } },
      { ...original, nodes: { "node-1": { ...original.nodes["node-1"], children: ["node-1"] } } },
      { ...original, nodes: { ...original.nodes,
        a: { ...original.nodes["node-1"], id: "a", children: ["b"] },
        b: { ...original.nodes["node-1"], id: "b", children: ["a"] } } },
    ]) {
      assert.equal(validateDocBody(JSON.stringify(changed)), "不正なリクエスト");
      const patch = createDocPatch(original, changed as SiteDoc)!;
      await assert.rejects(saveDocPatch(db, "s1", patch, "1"), /不正な/);
      assert.equal((await readCurrentDoc(db, "s1"))?.body, JSON.stringify(original));
      assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
    }
  });
});

test("component roots and asset definitions stay valid across snapshots and revisions", async () => {
  await database(async db => {
    const original = { ...doc(), components: { card: { id: "card", name: "Card", rootId: "node-1" } } };
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    for (const patch of [
      [{ path: ["assets", "bad"], value: null }],
      [{ path: ["components", "card"], value: { id: "card", name: "Card", rootId: "missing" } }],
      [{ path: ["pages", "home"], value: { ...original.pages.home, children: [] } },
       { path: ["nodes", "node-1"], remove: true }],
    ] as const) {
      assert.equal(validateDocBody(JSON.stringify(applyDocPatch(original, patch as any))), "不正なリクエスト");
      await assert.rejects(saveDocPatch(db, "s1", patch as any, "1"), /不正な/);
      assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
    }
  });
});

test("structural edits work when an optional component map is null", async () => {
  await database(async db => {
    const empty = { ...doc(), components: null };
    assert.equal(validateDocBody(JSON.stringify(empty)), null);
    await saveCurrentDoc(db, "s1", JSON.stringify(empty), null);
    const result = await saveDocPatch(db, "s1", [
      { path: ["nodes", "extra"], value: { ...empty.nodes["node-1"], id: "extra" } },
      { path: ["pages", "home"], value: { ...empty.pages.home, children: ["node-1", "extra"] } },
    ], "1");
    assert.equal(result.kind, "saved");
  });
});


test("page roots cannot share ownership with other pages or node children", async () => {
  await database(async db => {
    const original = doc();
    await saveCurrentDoc(db, "s1", JSON.stringify(original), null);
    for (const changed of [
      { ...original, pages: { ...original.pages, other: { ...original.pages.home, id: "other", slug: "other" } }, pageOrder: ["home", "other"] },
      { ...original, nodes: { ...original.nodes, parent: { ...original.nodes["node-1"], id: "parent", children: ["node-1"] } } },
      { ...original, pages: { home: { ...original.pages.home, children: ["node-1", "node-1"] } } },
    ]) {
      assert.notEqual(validateDocBody(JSON.stringify(changed)), null);
      await assert.rejects(saveDocPatch(db, "s1", createDocPatch(original, changed as SiteDoc)!, "1"), /不正な/);
      assert.equal((await readCurrentDoc(db, "s1"))?.body, JSON.stringify(original));
      assert.equal((await readCurrentDoc(db, "s1"))?.rev, "1");
    }
  });
});
