import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocPatch } from "../lib/doc-patch";
import { InvalidDocPatchError, readCurrentDoc, saveCurrentDoc, saveDocPatch, validateDocValue } from "../lib/doc-storage";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { makeBox } from "../lib/presets";
import { insertSite } from "../lib/sites";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Component integrity",
    pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: ["use"] } },
    pageOrder: ["p"],
    nodes: {
      root: { ...makeBox(), id: "root" },
      use: { ...makeBox(), id: "use", type: "instance", componentId: "C" },
    },
    components: { C: { id: "C", name: "Card", rootId: "root" } },
    assets: {},
  };
}

async function withDatabase(testBody: (db: Db, statements: string[]) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-graph-patch-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const rawDb = await getDbFromBinding(nodeDatabase()!);
    await insertSite(rawDb, "audit", {
      name: "Audit", repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    });
    const statements: string[] = [];
    const db: Db = {
      ...rawDb,
      execute: async statement => {
        statements.push(typeof statement === "string" ? statement : statement.sql);
        return rawDb.execute(statement);
      },
    };
    await testBody(db, statements);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an atomic patch cannot introduce component cycles or dangling definitions", async () => {
  await withDatabase(async (db, statements) => {
    const original = fixture();
    assert.equal(validateDocValue(original), null);
    assert.equal((await saveCurrentDoc(db, "audit", JSON.stringify(original), null)).kind, "saved");
    const attempts = [
      { ...structuredClone(original),
        components: { C: { ...original.components!.C, rootId: "absent" } } },
      { ...structuredClone(original), components: {} },
      { ...structuredClone(original),
        nodes: { ...original.nodes,
          root: { ...original.nodes.root, children: ["nested"] },
          nested: { ...makeBox(), id: "nested", type: "instance" as const, componentId: "C" } } },
    ];
    for (const bad of attempts) {
      assert.notEqual(validateDocValue(bad), null);
      await assert.rejects(saveDocPatch(db, "audit", createDocPatch(original, bad as SiteDoc)!, "1"), InvalidDocPatchError);
      const current = await readCurrentDoc(db, "audit");
      assert.equal(current!.rev, "1", "invalid revisions never advance");
      assert.deepEqual(JSON.parse(current!.body), original);
    }
    assert.ok(statements.some(sql => sql.includes("SELECT rev, saved_at, body")), "graph changes use base-revision preflight");
  });
});

test("an ordinary leaf update avoids loading the complete document", async () => {
  await withDatabase(async (db, statements) => {
    const original = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const next = structuredClone(original);
    next.nodes.root.name = "Renamed";
    statements.length = 0;
    assert.equal((await saveDocPatch(db, "audit", createDocPatch(original, next)!, "1")).kind, "saved");
    assert.equal(statements.some(sql => sql.includes("SELECT rev, saved_at, body")), false);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "audit"))!.body), next);
  });
});

test("preflight rejects a stale base as a conflict rather than validating against a different revision", async () => {
  await withDatabase(async db => {
    const original = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const updated = { ...original, siteName: "Updated" };
    assert.equal((await saveCurrentDoc(db, "audit", JSON.stringify(updated), "1")).kind, "saved");
    const next = structuredClone(original);
    next.components!.C.name = "Another name";
    const result = await saveDocPatch(db, "audit", createDocPatch(original, next)!, "1");
    assert.equal(result.kind, "conflict");
    if (result.kind === "conflict") {
      assert.equal(result.current.rev, "2");
      assert.deepEqual(JSON.parse(result.current.body), updated);
    }
  });
});

test("page folders cannot disappear while assigned pages still reference them", async () => {
  await withDatabase(async db => {
    const original = fixture();
    original.pageFolders = [{ id: "folder", name: "Folder" }];
    original.pages.p.folderId = "folder";
    assert.equal(validateDocValue(original), null);
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const invalid = [
      { ...original, pageFolders: [] },
      { ...original, pageFolders: [{ id: "folder", name: "One" }, { id: "folder", name: "Two" }] },
      { ...original, pages: { p: { ...original.pages.p, folderId: "missing" } } },
    ];
    for (const bad of invalid) {
      assert.notEqual(validateDocValue(bad), null);
      await assert.rejects(saveDocPatch(db, "audit", createDocPatch(original, bad as SiteDoc)!, "1"), InvalidDocPatchError);
      assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");
    }
    const move = structuredClone(original);
    delete move.pages.p.folderId;
    move.pageFolders = [];
    assert.equal((await saveDocPatch(db, "audit", createDocPatch(original, move)!, "1")).kind, "saved");
    assert.equal(validateDocValue(JSON.parse((await readCurrentDoc(db, "audit"))!.body)), null);
  });
});

test("asset removal and references are checked together before advancing the revision", async () => {
  await withDatabase(async db => {
    const original = fixture();
    original.assets.picture = { id: "picture", name: "photo.png", width: 10, height: 10 };
    original.nodes.picture = {
      ...makeBox(), id: "picture", type: "image",
      image: { src: "", assetId: "picture", alt: "", width: 10, height: 10 },
    };
    original.pages.p.children.push("picture");
    original.favicon = { assetId: "picture" };
    assert.equal(validateDocValue(original), null);
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);

    const dangling = structuredClone(original);
    delete dangling.assets.picture;
    assert.notEqual(validateDocValue(dangling), null);
    await assert.rejects(
      saveDocPatch(db, "audit", createDocPatch(original, dangling)!, "1"), InvalidDocPatchError);
    assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");

    const fixed = structuredClone(dangling);
    fixed.nodes.picture.image!.assetId = undefined;
    fixed.favicon = null;
    assert.equal(validateDocValue(fixed), null);
    assert.equal((await saveDocPatch(db, "audit", createDocPatch(original, fixed)!, "1")).kind, "saved");
    assert.equal(validateDocValue(JSON.parse((await readCurrentDoc(db, "audit"))!.body)), null);
  });
});

test("new image and metadata references to nonexistent assets are rejected", async () => {
  await withDatabase(async db => {
    const original = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(original), null);
    const bad = structuredClone(original);
    bad.nodes.use.image = { src: "", assetId: "missing", alt: "", width: 1, height: 1 };
    assert.notEqual(validateDocValue(bad), null);
    await assert.rejects(saveDocPatch(db, "audit", createDocPatch(original, bad)!, "1"), InvalidDocPatchError);
    assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");
  });
});

test("API revisions reject invalid node and page shapes before accepting a PATCH", async () => {
  await withDatabase(async db => {
    const base = fixture();
    await saveCurrentDoc(db, "audit", JSON.stringify(base), null);
    const edits: SiteDoc[] = [];
    const mutate = (change: (d: SiteDoc) => void) => {
      const next = structuredClone(base);
      change(next);
      edits.push(next);
    };
    mutate(d => { (d.nodes.use as any).type = "unknown-element"; });
    mutate(d => { (d.nodes.use as any).semantic = "invalid"; });
    mutate(d => { (d.nodes.use as any).styles = null; });
    mutate(d => { (d.nodes.use.styles.base ??= {}).default = { color: 123 } as any; });
    mutate(d => { (d.nodes.use as any).text = { content: 5, heading: 0 }; });
    mutate(d => { (d.pages.p as any).name = null; });
    mutate(d => { (d.pages.p as any).title = []; });
    mutate(d => { (d.pages.p as any).description = 12; });
    mutate(d => { (d.pages.p as any).bodyStyles = { base: { default: { backgroundColor: false } } }; });
    for (const invalid of edits) {
      assert.notEqual(validateDocValue(invalid), null, JSON.stringify(invalid).slice(0,300));
      const patch = createDocPatch(base, invalid);
      assert.ok(patch?.length, "the malformed field still produces a delta");
      await assert.rejects(saveDocPatch(db, "audit", patch!, "1"), InvalidDocPatchError);
      assert.equal((await readCurrentDoc(db, "audit"))!.rev, "1");
    }
  });
});
