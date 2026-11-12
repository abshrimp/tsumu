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
  const node = Object.values(next.nodes).find(n => n.text && typeof n.text.content === "string")!;
  assert.ok(node);
  node.text!.content += "x";
  const patch = createDocPatch(initial, next)!;
  assert.equal(patch.length, 1);
  queries.length = 0;
  assert.equal(store.patch(patch, "1").kind, "saved");
  assert.ok(queries.some(sql => sql.startsWith("UPDATE document_entries SET body")));
  assert.ok(!queries.some(sql => /^UPDATE document_meta .*props=/i.test(sql)));
  assert.ok(!queries.some(sql => sql.startsWith("SELECT bucket,entry_id,body FROM document_entries")));
  assert.ok(!queries.some(sql => sql === "DELETE FROM document_entries"));
  assert.equal(store.meta()?.rev, "2");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  queries.length = 0;
  assert.equal(store.patch(patch, "2").kind, "saved");
  assert.equal(entryWrites(queries).length, 0, "repeated node values only advance the revision");
  assert.equal(store.meta()?.rev, "3");
  sqlite.close();
});

test("UTF-8 row limits distinguish ASCII and multibyte content at the same string length", () => {
  const { store, sqlite } = database();
  try {
    const doc = createInitialDoc();
    doc.customHeadHtml = "a".repeat(2_400_000);
    assert.equal(store.replace(JSON.stringify(doc), null).kind, "saved");
    assert.throws(() => store.patch([
      { path: ["customHeadHtml"], value: "漢".repeat(2_400_000) },
    ], "1"), /1項目が大きすぎます/);
    assert.equal(store.meta()?.rev, "1");
  } finally { sqlite.close(); }
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
  doc.assets.asset1 = { id: "asset1", name: "a.png", path: "assets/a.png", mimeType: "image/png", width: 1, height: 1 };
  assert.equal(validSiteDoc(doc), true);
  store.replace(JSON.stringify(doc), null);
  assert.deepEqual(store.assetReferences(), [{ path: "assets/a.png", bytes: null }]);
  store.erase();
  assert.equal(store.snapshot(), null);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries").get()!.n), 0);
  sqlite.close();
});


test("daily backups preserve the previous day's final SiteDoc, in small SQLite chunks", () => {
  const { store, sqlite } = database();
  const original = createInitialDoc();
  // A single UTF-16 character flips the surrogate alignment between the
  // first and second chunks. The backup must preserve emoji on either side.
  original.customHeadHtml = "😀".repeat(150_000) + "x" +
    "😀".repeat(150_000) + "保存データ".repeat(150_000);
  store.replace(JSON.stringify(original), null);
  const yesterday = Date.now() - 86_400_000;
  sqlite.prepare("UPDATE document_meta SET saved_at=? WHERE id=1").run(yesterday);
  const edited = { ...original, siteName: "New day" };
  const patch = createDocPatch(original, edited)!;
  assert.equal(store.patch(patch, "1").kind, "saved");
  const entries = store.listBackups();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].day, new Date(yesterday).getUTCDay());
  assert.equal(entries[0].savedAt, yesterday);
  assert.deepEqual(JSON.parse(store.readBackup(entries[0].day)!), original);
  assert.ok(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM document_backup_chunks").get()!.count) > 1,
    "Large backups are chunked into separate rows");
  assert.equal(store.patch(createDocPatch(edited, { ...edited, siteName: "Same day" })!, "2").kind, "saved");
  assert.equal(store.listBackups().length, 1, "do not overwrite the previous day's snapshot");
  sqlite.close();
});

test("deletion seals the room permanently, even if an old RPC save arrives later", () => {
  const { store, sqlite } = database();
  const doc = createInitialDoc();
  store.replace(JSON.stringify(doc), null);
  store.erase();
  assert.equal(store.snapshot(), null);
  assert.equal(store.meta(), null);
  assert.equal(store.readBackup(0), null);
  assert.deepEqual(store.listBackups(), []);
  assert.deepEqual(store.assetReferences(), []);
  assert.deepEqual(store.replace(JSON.stringify(doc), null), { kind: "missing" });
  assert.deepEqual(store.patch([{ path: ["siteName"], value: "Resurrect" }], "1"), { kind: "missing" });
  store.erase(); // retries are idempotent
  assert.equal(store.snapshot(), null);
  sqlite.close();
});

test("invalid optional fields cannot bypass full saves or fast node PATCH", () => {
  const { store, sqlite } = database();
  const original = createInitialDoc();
  assert.equal(store.replace(JSON.stringify(original), null).kind, "saved");

  const invalidNode = structuredClone(Object.values(original.nodes)[0]!);
  (invalidNode as unknown as Record<string, unknown>).motions = [
    { id: "animation", trigger: "load", duration: "invalid", delay: 0, easing: "linear" },
  ];
  assert.throws(() => store.patch([
    { path: ["nodes", invalidNode.id], value: invalidNode },
  ], "1"), /不正な/);
  assert.equal(store.meta()?.rev, "1");

  const invalidDoc = structuredClone(original);
  (invalidDoc as unknown as Record<string, unknown>).baseWidth = "wide";
  assert.throws(() => store.replace(JSON.stringify(invalidDoc), "1"), /不正な/);
  assert.equal(store.meta()?.rev, "1");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), original);
  sqlite.close();
});

test("reopening an initialized room issues only reads so a write quota cannot block loading", () => {
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
      return fn();
    },
  };
  const first = new StructuredDocumentStore(storage);
  assert.equal(first.replace(JSON.stringify(createInitialDoc()), null).kind, "saved");
  queries.length = 0;
  const reopened = new StructuredDocumentStore(storage);
  assert.ok(reopened.snapshot());
  assert.ok(reopened.meta());
  assert.deepEqual(queries.filter((sql) => !/^\s*SELECT\b/i.test(sql)), []);
});

const entryWrites = (queries: string[]) =>
  queries.filter(sql => /^(INSERT|UPDATE|DELETE)\b[^;]*document_entries/i.test(sql.trim()));

test("full snapshot saves write only the entry rows that changed", () => {
  const { store, sqlite, queries } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  queries.length = 0;
  assert.equal(store.replace(JSON.stringify(initial), "1").kind, "saved");
  assert.deepEqual(entryWrites(queries), []);

  const next = structuredClone(initial);
  const node = Object.values(next.nodes).find(n => n.text && typeof n.text.content === "string")!;
  node.text!.content += "x";
  queries.length = 0;
  assert.equal(store.replace(JSON.stringify(next), "2").kind, "saved");
  assert.equal(entryWrites(queries).length, 1);
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  sqlite.close();
});

test("full snapshot saves delete removed entries and insert new ones", () => {
  const { store, sqlite } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const next = structuredClone(initial);
  const pageId = initial.pageOrder[1];
  const renamed = "page_renamed000001";
  next.pages[renamed] = { ...next.pages[pageId], id: renamed };
  delete next.pages[pageId];
  next.pageOrder = next.pageOrder.map(id => id === pageId ? renamed : id);
  assert.equal(validSiteDoc(next), true);
  assert.equal(store.replace(JSON.stringify(next), "1").kind, "saved");
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  const rows = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM document_entries").get()!.n);
  const expected = Object.keys(next.pages).length + Object.keys(next.nodes).length
    + Object.keys(next.assets).length + Object.keys(next.components ?? {}).length;
  assert.equal(rows, expected);
  sqlite.close();
});

test("bucket-level patches rewrite only the changed rows of that bucket", () => {
  const { store, sqlite, queries } = database();
  const initial = createInitialDoc();
  store.replace(JSON.stringify(initial), null);
  const next = structuredClone(initial);
  const node = Object.values(next.nodes).find(n => n.text && typeof n.text.content === "string")!;
  node.text!.content += "x";
  queries.length = 0;
  assert.equal(store.patch([{ path: ["nodes"], value: next.nodes }], "1").kind, "saved");
  assert.equal(entryWrites(queries).length, 1);
  assert.ok(!queries.some(sql => /^UPDATE document_meta .*props=/i.test(sql)));
  assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
  sqlite.close();
});

test("adding and removing an empty components bucket persists its presence", () => {
  const { store, sqlite } = database();
  try {
    const doc = createInitialDoc();
    delete doc.components;
    store.replace(JSON.stringify(doc), null);
    assert.equal(store.patch([{ path: ["components"], value: {} }], "1").kind, "saved");
    assert.deepEqual(JSON.parse(store.snapshot()!.body).components, {});
    assert.equal(store.patch([{ path: ["components"], remove: true }], "2").kind, "saved");
    assert.deepEqual(JSON.parse(store.snapshot()!.body), doc);
  } finally { sqlite.close(); }
});
