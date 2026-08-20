import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitialDoc, makeBox } from "../lib/presets";
import { createDocPatch } from "../lib/doc-patch";
import { readCurrentDoc, saveCurrentDoc, saveDocPatch } from "../lib/doc-storage";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";
import { getDbFromBinding } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

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

test("reconnecting during a pending gesture preserves Undo/Redo through conflict retries on both backends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-history-parity-"));
  const old = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  const { store, sqlite } = durableObjectFixture();
  const editor = () => useEditor.getState();
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "history", {
      name: "History", repo: null, branch: "main", previewBranch: "preview",
      siteUrl: null, previewUrl: null,
    });
    const original = createInitialDoc();
    original.components ??= {};
    original.nodes.deleted = { ...makeBox(), id: "deleted" };
    original.pages[original.pageOrder[0]].children.push("deleted");
    assert.equal((await saveCurrentDoc(db, "history", JSON.stringify(original), null)).kind, "saved");
    assert.equal(store.replace(JSON.stringify(original), null).kind, "saved");
    const persist = async (before: SiteDoc, after: SiteDoc, base: string) => {
      const patch = createDocPatch(before, after);
      assert.ok(patch?.length);
      const nodeResult = await saveDocPatch(db, "history", patch, base);
      const doResult = store.patch(patch, base);
      assert.equal(nodeResult.kind, "saved");
      assert.equal(doResult.kind, "saved");
      const rev = String(Number(base) + 1);
      if (nodeResult.kind === "saved" && doResult.kind === "saved") {
        assert.equal(nodeResult.rev, rev);
        assert.equal(doResult.rev, rev);
      }
      for (const snapshot of [await readCurrentDoc(db, "history"), store.snapshot()]) {
        assert.equal(snapshot?.rev, rev);
        assert.deepEqual(JSON.parse(snapshot!.body), after);
        assert.equal(JSON.parse(snapshot!.body).schemaVersion, 1);
      }
    };

    editor().endGesture();
    editor().replaceDoc(original);
    const finish = editor().beginGesture();
    const remote = structuredClone(original);
    remote.siteName = "Collaborator's site name";
    delete remote.nodes.deleted;
    remote.pages[remote.pageOrder[0]].children.pop();
    await persist(original, remote, "1");

    // A reconnecting client still carrying revision 1 receives revision 2
    // without partially applying its stale write on either backend.
    const stale = createDocPatch(original, { ...original, siteName: "Stale write" })!;
    const conflicts = [await saveDocPatch(db, "history", stale, "1"), store.patch(stale, "1")];
    for (const conflict of conflicts) {
      assert.equal(conflict.kind, "conflict");
      if (conflict.kind === "conflict") {
        assert.equal(conflict.current.rev, "2");
        assert.deepEqual(JSON.parse(conflict.current.body), remote);
      }
    }
    assert.equal((await readCurrentDoc(db, "history"))?.rev, "2");
    assert.equal(store.meta()?.rev, "2");
    editor().applyRemoteDoc(JSON.parse(store.snapshot()!.body));
    const node = Object.values(remote.nodes).find(value => value.text)!;
    editor().updateNode(node.id, { name: "First gesture update" });
    editor().updateNode(node.id, { name: "Final gesture update" });
    finish();
    const changed = structuredClone(editor().doc);
    await persist(remote, changed, "2");
    editor().undo();
    assert.deepEqual(editor().doc, remote);
    await persist(changed, editor().doc, "3");
    editor().redo();
    assert.deepEqual(editor().doc, changed);
    await persist(remote, editor().doc, "4");
  } finally {
    editor().endGesture();
    sqlite.close();
    if (old === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
