import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitialDoc } from "../lib/presets";
import { createDocPatch } from "../lib/doc-patch";
import { readCurrentDoc, saveCurrentDoc, saveDocPatch } from "../lib/doc-storage";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";
import { getDbFromBinding } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";

function durableObjectFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const storage: DocumentSqlStorage = {
    sql: {
      exec(sql, ...args) {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length) {
          return { toArray: () => statement.all(...args) as Record<string, unknown>[] };
        }
        statement.run(...args);
        return { toArray: () => [] };
      },
    },
    transactionSync(callback) {
      sqlite.exec("BEGIN");
      try {
        const result = callback();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { store: new StructuredDocumentStore(storage), sqlite };
}

test("SQLite and Durable Objects preserve identical revisions and documents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-storage-parity-"));
  const old = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  const { store, sqlite } = durableObjectFixture();
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "parity", {
      name: "Parity", repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    });
    const original = createInitialDoc();
    const body = JSON.stringify(original);
    assert.equal((await saveCurrentDoc(db, "parity", body, null)).kind, "saved");
    assert.equal(store.replace(body, null).kind, "saved");

    const changed = structuredClone(original);
    changed.siteName = "Renamed";
    const node = Object.values(changed.nodes).find(value => value.text)!;
    node.text!.content += " update";
    const patch = createDocPatch(original, changed)!;
    assert.ok(patch.length);
    assert.equal((await saveDocPatch(db, "parity", patch, "1")).kind, "saved");
    assert.equal(store.patch(patch, "1").kind, "saved");

    const local = await readCurrentDoc(db, "parity");
    const remote = store.snapshot();
    assert.equal(local?.rev, "2");
    assert.equal(remote?.rev, "2");
    assert.deepEqual(JSON.parse(local!.body), changed);
    assert.deepEqual(JSON.parse(remote!.body), changed);

    const staleNode = await saveDocPatch(db, "parity", patch, "1");
    const staleDO = store.patch(patch, "1");
    assert.equal(staleNode.kind, "conflict");
    assert.equal(staleDO.kind, "conflict");

    const invalid = [{ path: ["baseWidth"], value: "wide" }];
    await assert.rejects(saveDocPatch(db, "parity", invalid, "2"), /不正な/);
    assert.throws(() => store.patch(invalid, "2"), /不正な/);
    assert.equal((await readCurrentDoc(db, "parity"))?.rev, "2");
    assert.equal(store.meta()?.rev, "2");
  } finally {
    sqlite.close();
    if (old === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
