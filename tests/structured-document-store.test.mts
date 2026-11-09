import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createInitialDoc } from "../lib/presets";
import { createDocPatch } from "../lib/doc-patch";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";
import { validSiteDoc } from "../lib/doc-tree";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const queries: string[] = [];
  const storage: DocumentSqlStorage = {
    sql: {
      exec(sql, ...args) {
        queries.push(sql);
        const stmt = sqlite.prepare(sql);
        if (stmt.columns().length) {
          return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
        }
        stmt.run(...args);
        return { toArray: () => [] };
      },
    },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try {
        const result = fn();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { store: new StructuredDocumentStore(storage), sqlite, queries };
}

test("initial snapshot is stored in separate site, page, node and asset rows", () => {
  const { store, sqlite } = database();
  const doc = createInitialDoc();
  assert.equal(validSiteDoc(doc), true);
  assert.equal(store.replace(JSON.stringify(doc), null).kind, "saved");
  const persisted = store.snapshot()!;
  assert.equal(persisted.rev, "1");
  assert.deepEqual(JSON.parse(persisted.body), doc);
  const count = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries WHERE bucket='nodes'").get()!.n);
  assert.equal(count, Object.keys(doc.nodes).length);
  const meta = sqlite.prepare("SELECT props FROM document_meta WHERE id=1").get()!;
  assert.equal(Object.hasOwn(JSON.parse(String(meta.props)), "nodes"), false);
  sqlite.close();
});

test("one-character edits touch one element row and rev, not 7,000 rows", () => {
  const { store, sqlite, queries } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const next = structuredClone(initial);
  const node = Object.values(next.nodes).find(n => n.text !== undefined)!;
  assert.ok(node);
  node.text!.content += "x";
  const patch = createDocPatch(initial, next)!;
  assert.equal(patch.length, 1);
  queries.length = 0;
  assert.equal(store.patch(patch, "1").kind, "saved");
  assert.ok(queries.some(sql => sql.startsWith("UPDATE document_entries SET body")));
  assert.ok(!queries.some(sql => sql.startsWith("SELECT bucket,entry_id,body FROM document_entries")));
  assert.ok(!queries.some(sql => sql === "DELETE FROM document_entries"));
  assert.equal(store.meta()?.rev, "2");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  sqlite.close();
});

test("stale revisions conflict without applying a partial document update", () => {
  const { store, sqlite } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const changed = { ...initial, siteName: "Updated" };
  const patch = createDocPatch(initial, changed)!;
  assert.equal(store.patch(patch, "1").kind, "saved");
  const conflict = store.patch(patch, "1");
  assert.equal(conflict.kind, "conflict");
  assert.equal(store.meta()?.rev, "2");
  assert.equal(JSON.parse(store.snapshot()!.body).siteName, "Updated");
  sqlite.close();
});

test("broken node ownership fails atomically and preserves document revision", () => {
  const { store, sqlite } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const changed = structuredClone(initial);
  const page = changed.pages[changed.pageOrder[0]];
  const root = page.children[0];
  page.children.push(root);
  const patch = createDocPatch(initial, changed)!;
  assert.ok(patch);
  assert.throws(() => store.patch(patch, "1"), /不正な/);
  assert.equal(store.meta()?.rev, "1");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), initial);
  sqlite.close();
});

test("an actual multi-megabyte SiteDoc can initialize and change one node without a full rewrite", () => {
  const { store, sqlite, queries } = database();
  const doc = createInitialDoc();
  const leaf = Object.values(doc.nodes).find(n => n.children.length === 0 && n.text)!;
  assert.ok(leaf);
  for (let i = 0; i < 7_000; i++) {
    const id = "test_detached_" + i;
    doc.nodes[id] = { ...structuredClone(leaf), id, text: {
      ...leaf.text!, content: "L".repeat(800) + i,
    } };
  }
  assert.equal(validSiteDoc(doc), true);
  assert.ok(Buffer.byteLength(JSON.stringify(doc), "utf8") > 5_000_000);
  assert.equal(store.replace(JSON.stringify(doc), null).kind, "saved");
  assert.equal(Object.keys(JSON.parse(store.snapshot()!.body).nodes).length, Object.keys(doc.nodes).length);
  const edited = structuredClone(doc);
  edited.nodes.test_detached_4000.text!.content += "!";
  const patch = createDocPatch(doc, edited)!;
  queries.length = 0;
  assert.equal(store.patch(patch, "1").kind, "saved");
  const writes = queries.filter(q => q.startsWith("UPDATE document_entries SET body") || q.startsWith("DELETE FROM document_entries"));
  assert.equal(writes.length, 1, "one changed node row only");
  assert.deepEqual(JSON.parse(store.snapshot()!.body).nodes.test_detached_4000, edited.nodes.test_detached_4000);
  sqlite.close();
});

test("asset references are read directly from asset rows and erase clears both tables", () => {
  const { store, sqlite } = database();
  const doc = createInitialDoc();
  doc.assets.asset1 = { id: "asset1", name: "a.png", path: "assets/a.png", mimeType: "image/png" };
  assert.equal(validSiteDoc(doc), true);
  store.replace(JSON.stringify(doc), null);
  assert.deepEqual(store.assetReferences(), [{ path: "assets/a.png", bytes: null }]);
  store.erase();
  assert.equal(store.snapshot(), null);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries").get()!.n), 0);
  sqlite.close();
});
