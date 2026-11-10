import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { createInitialDoc } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";

const quotaError = new Error("Exceeded allowed rows written in Durable Objects free tier.");
const tables = ["document_meta", "document_entries", "document_schema", "document_state",
  "document_backup_meta", "document_backup_chunks"];

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const queries: string[] = [];
  let rejectWrite = Infinity;
  let writes = 0;
  let entryChanges = 0;
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      queries.push(sql);
      if (!/^SELECT\b/i.test(sql.trim()) && ++writes >= rejectWrite) throw quotaError;
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      const result = stmt.run(...args);
      if (/^(INSERT|UPDATE|DELETE)\b[^;]*document_entries/i.test(sql.trim())) entryChanges += Number(result.changes);
      return { toArray: () => [] };
    } },
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
  return {
    sqlite, storage, queries,
    reset(failAt = Infinity) { queries.length = 0; writes = 0; entryChanges = 0; rejectWrite = failAt; },
    get writes() { return writes; },
    get entryChanges() { return entryChanges; },
    dump() { return tables.map(name => sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()); },
  };
}

// Cloudflare の基底クラスだけを置き換え、実際の DocumentRoom のフィールド初期化も実行する。
function roomClass() {
  const url = new URL("../document-room.ts", import.meta.url);
  const require = createRequire(url);
  const code = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const module = { exports: {} as { DocumentRoom: new (ctx: { storage: DocumentSqlStorage }) => {
    getSnapshot(): ReturnType<StructuredDocumentStore["snapshot"]>;
    getMetadata(): ReturnType<StructuredDocumentStore["meta"]>;
    listAssetReferences(): ReturnType<StructuredDocumentStore["assetReferences"]>;
    listBackups(): ReturnType<StructuredDocumentStore["listBackups"]>;
    readBackup(day: number): string | null;
  } } };
  new Function("require", "module", "exports", code)(
    (name: string) => name === "cloudflare:workers"
      ? { DurableObject: class { constructor(public ctx: unknown) {} } }
      : name === "./lib/structured-document-store" ? { StructuredDocumentStore } : require(name),
    module, module.exports,
  );
  return module.exports.DocumentRoom;
}

test("DocumentRoom startup and every read RPC work when all SQL writes are rejected", () => {
  const f = database();
  try {
    const store = new StructuredDocumentStore(f.storage);
    const original = createInitialDoc();
    original.assets.quota_asset = { id: "quota_asset", name: "quota.png", path: "assets/quota.png", mimeType: "image/png", width: 1, height: 1 };
    store.replace(JSON.stringify(original), null);
    const yesterday = Date.now() - 86_400_000;
    f.sqlite.prepare("UPDATE document_meta SET saved_at=? WHERE id=1").run(yesterday);
    const next = { ...original, siteName: "Next day" };
    store.replace(JSON.stringify(next), "1");
    const before = f.dump();
    f.reset(1);
    const room = new (roomClass())({ storage: f.storage });
    assert.deepEqual(JSON.parse(room.getSnapshot()!.body), next);
    assert.equal(room.getMetadata()!.rev, "2");
    assert.deepEqual(room.listAssetReferences(), [{ path: "assets/quota.png", bytes: null }]);
    assert.equal(room.listBackups().length, 1);
    assert.deepEqual(JSON.parse(room.readBackup(new Date(yesterday).getUTCDay())!), original);
    assert.equal(room.readBackup(-1), null);
    assert.equal(f.writes, 0);
    assert.deepEqual(f.dump(), before);
  } finally { f.sqlite.close(); }
});

for (const sealed of [false, true]) {
  test(`${sealed ? "sealed" : "empty"} initialized rooms reopen with no writes`, () => {
    const f = database();
    try {
      const store = new StructuredDocumentStore(f.storage);
      if (sealed) {
        store.replace(JSON.stringify(createInitialDoc()), null);
        store.erase();
      }
      f.reset(1);
      const reopened = new StructuredDocumentStore(f.storage);
      assert.equal(reopened.snapshot(), null);
      assert.equal(reopened.meta(), null);
      assert.deepEqual(reopened.listBackups(), []);
      assert.deepEqual(reopened.assetReferences(), []);
      if (sealed) {
        assert.deepEqual(reopened.replace(JSON.stringify(createInitialDoc()), null), { kind: "missing" });
        assert.deepEqual(reopened.patch([{ path: ["siteName"], value: "stale" }], "1"), { kind: "missing" });
      }
      assert.equal(f.writes, 0);
    } finally { f.sqlite.close(); }
  });
}

test("every interrupted initialization prefix can finish without losing seed state", () => {
  const source = database();
  try {
    new StructuredDocumentStore(source.storage);
    const schemaWrites = source.queries.filter(sql => !/^SELECT\b/i.test(sql));
    for (let prefix = 0; prefix <= schemaWrites.length; prefix++) {
      const f = database();
      try {
        for (const sql of schemaWrites.slice(0, prefix)) f.sqlite.exec(sql);
        const store = new StructuredDocumentStore(f.storage);
        assert.equal(store.snapshot(), null);
        assert.equal(store.replace(JSON.stringify(createInitialDoc()), null).kind, "saved");
        assert.equal(store.meta()?.rev, "1");
      } finally { f.sqlite.close(); }
    }
  } finally { source.sqlite.close(); }
});

for (const damage of ["DROP TABLE document_backup_chunks", "DELETE FROM document_schema", "DELETE FROM document_state"]) {
  test(`repair initialized schema after ${damage}`, () => {
    const f = database();
    try {
      const store = new StructuredDocumentStore(f.storage);
      const original = createInitialDoc();
      store.replace(JSON.stringify(original), null);
      f.sqlite.exec(damage);
      const reopened = new StructuredDocumentStore(f.storage);
      assert.deepEqual(JSON.parse(reopened.snapshot()!.body), original);
      assert.equal(reopened.meta()?.rev, "1");
      f.reset(1);
      assert.ok(new StructuredDocumentStore(f.storage).snapshot());
      assert.equal(f.writes, 0);
    } finally { f.sqlite.close(); }
  });
}

test("repairing missing backup tables does not unseal a deleted generation", () => {
  const f = database();
  try {
    const store = new StructuredDocumentStore(f.storage);
    store.replace(JSON.stringify(createInitialDoc()), null);
    store.erase();
    f.sqlite.exec("DROP TABLE document_backup_chunks");
    const reopened = new StructuredDocumentStore(f.storage);
    assert.deepEqual(reopened.replace(JSON.stringify(createInitialDoc()), null), { kind: "missing" });
    assert.equal(reopened.snapshot(), null);
  } finally { f.sqlite.close(); }
});

test("unsupported partial schemas are rejected before repairing or reseeding them", () => {
  const f = database();
  try {
    new StructuredDocumentStore(f.storage);
    f.sqlite.exec("UPDATE document_schema SET version=2; DROP TABLE document_backup_chunks; DELETE FROM document_state");
    f.reset();
    assert.throws(() => new StructuredDocumentStore(f.storage), /Unsupported document storage schema/);
    assert.equal(f.writes, 0);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='document_backup_chunks'").all().length, 0);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM document_state").all().length, 0);
  } finally { f.sqlite.close(); }
});

for (const mode of ["replace", "patch"] as const) {
  test(`${mode} adds, removes and changes only affected rows and keeps same-value saves minimal`, () => {
    const f = database();
    try {
      const store = new StructuredDocumentStore(f.storage);
      const initial = createInitialDoc();
      const leaf = Object.values(initial.nodes).find(node => node.children.length === 0 && node.text)!;
      initial.nodes.removed_quota_node = { ...structuredClone(leaf), id: "removed_quota_node" };
      store.replace(JSON.stringify(initial), null);
      const next = structuredClone(initial);
      delete next.nodes.removed_quota_node;
      next.nodes.added_quota_node = { ...structuredClone(leaf), id: "added_quota_node" };
      next.nodes[leaf.id].text!.content += "changed";
      assert.ok(validSiteDoc(next));
      const save = (base: string) => mode === "replace"
        ? store.replace(JSON.stringify(next), base)
        : store.patch([{ path: ["nodes"], value: next.nodes }], base);
      f.reset();
      assert.equal(save("1").kind, "saved");
      assert.equal(f.entryChanges, 3);
      assert.equal(f.writes, 4);
      assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
      f.reset();
      assert.equal(save("2").kind, "saved");
      assert.equal(store.meta()?.rev, "3");
      assert.equal(f.entryChanges, 0);
      assert.equal(f.writes, 1);
      f.reset(1);
      assert.equal(save("2").kind, "conflict");
      assert.equal(f.writes, 0);
      assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
    } finally { f.sqlite.close(); }
  });
}

for (const mode of ["replace", "patch", "erase"] as const) {
  test(`${mode} rolls back every intermediate write failure, including backups and revisions`, () => {
    let totalWrites = 0;
    for (let failure = 0; failure <= totalWrites; failure++) {
      const f = database();
      try {
        const store = new StructuredDocumentStore(f.storage);
        const initial = createInitialDoc();
        const leaf = Object.values(initial.nodes).find(node => node.children.length === 0 && node.text)!;
        initial.nodes.removed_quota_node = { ...structuredClone(leaf), id: "removed_quota_node" };
        store.replace(JSON.stringify(initial), null);
        f.sqlite.prepare("UPDATE document_meta SET saved_at=? WHERE id=1").run(Date.now() - 86_400_000);
        const next = structuredClone(initial);
        delete next.nodes.removed_quota_node;
        next.nodes.added_quota_node = { ...structuredClone(leaf), id: "added_quota_node" };
        next.nodes[leaf.id].text!.content += "changed";
        const before = f.dump();
        const mutate = () => mode === "replace" ? store.replace(JSON.stringify(next), "1")
          : mode === "patch" ? store.patch([{ path: ["nodes"], value: next.nodes }], "1") : store.erase();
        f.reset(failure || Infinity);
        if (!failure) {
          mutate();
          totalWrites = f.writes;
          assert.ok(totalWrites > 3);
        } else {
          assert.throws(mutate, error => error === quotaError);
          assert.deepEqual(f.dump(), before, `failure at write ${failure} of ${totalWrites}`);
          assert.equal(store.meta()?.rev, "1");
          assert.deepEqual(JSON.parse(new StructuredDocumentStore(f.storage).snapshot()!.body), initial);
          f.reset();
          mutate();
          assert.equal(store.meta()?.rev, mode === "erase" ? undefined : "2");
          if (mode !== "erase") {
            assert.deepEqual(JSON.parse(store.snapshot()!.body), next);
            assert.deepEqual(JSON.parse(store.readBackup(store.listBackups()[0].day)!), initial);
          }
        }
      } finally { f.sqlite.close(); }
    }
  });
}
