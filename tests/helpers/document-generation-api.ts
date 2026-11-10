import assert from "node:assert/strict";
import { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";
import { getDbFromBinding, type Db, type D1LikeDatabase } from "../../lib/db";
import * as sites from "../../lib/sites";
import * as docStorage from "../../lib/doc-storage";
import { recordActivity } from "../../lib/activity";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../../lib/structured-document-store";
import { createInitialDoc } from "../../lib/presets";
import { isDocPatch } from "../../lib/doc-patch";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../lib/api-json";
import { IMPORT_LIMITS, validateImportedDoc } from "../../lib/site-import-format";
import { readTextLimited, TooLargeError } from "../../lib/safe-fetch";
import { userMessage } from "../../lib/errors";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
}
type Statement = Parameters<Db["execute"]>[0];
export const sqlOf = (stmt: Statement) => typeof stmt === "string" ? stmt : stmt.sql;
export const argOf = (stmt: Statement, index = 0) => typeof stmt === "string" ? undefined : stmt.args[index];
export const isRoomLookup = (stmt: Statement, id: string) => /SELECT room_key FROM site_document_rooms WHERE site_id/.test(sqlOf(stmt)) && argOf(stmt) === id;
const dest = { name: "Synthetic site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
export const original = createInitialDoc(); original.siteName = "Synthetic original";
export const replacement = createInitialDoc(); replacement.siteName = "Synthetic replacement content";
export const edit = { ...original, siteName: "Synthetic edited content" };

function load(path: string, injected: Record<string, unknown>) {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const code = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(injected, name) ? injected[name] : require(name), module, module.exports,
  );
  return module.exports;
}
function sqliteStorage(t: TestContext) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      stmt.run(...args); return { toArray: () => [] };
    } },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return new StructuredDocumentStore(storage);
}
export async function setup(t: TestContext) {
  t.mock.method(console, "error", () => {});
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  type Bound = { sql: string; args: Array<string | number | null> };
  const run = ({ sql, args }: Bound) => {
    const stmt = sqlite.prepare(sql);
    if (stmt.columns().length) return { results: stmt.all(...args) as Record<string, unknown>[], meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(stmt.run(...args).changes) } };
  };
  const prepare = (sql: string, args: Bound["args"] = []) => Object.assign({ sql, args }, {
    bind: (...args: unknown[]) => prepare(sql, args as Bound["args"]), all: async () => run({ sql, args }),
  });
  const binding: D1LikeDatabase = {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try { const result = statements.map(stmt => run(stmt as unknown as Bound)); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const rawDb = await getDbFromBinding(binding);
  assert.equal(rawDb.backend, "d1");
  const rooms = new Map<string, StructuredDocumentStore>();
  const room = (key: string) => {
    if (!rooms.has(key)) rooms.set(key, sqliteStorage(t));
    return rooms.get(key)!;
  };
  const hooks: {
    beforeExecute?: (stmt: Statement) => Promise<void>;
    afterExecute?: (stmt: Statement) => Promise<void>;
    beforeBatch?: (stmts: Statement[]) => Promise<void>;
    afterBatch?: (stmts: Statement[]) => Promise<void>;
    beforeRoomWrite?: (key: string) => Promise<void>;
    afterRoomWrite?: (key: string) => Promise<void>;
    beforeErase?: (key: string) => Promise<void>;
  } = {};
  const services = load("../../lib/site-document-service.ts", {
    "@opennextjs/cloudflare": { getCloudflareContext: () => ({ env: { DB: binding, DOC_STORE: {
      idFromName: (key: string) => key,
      get: (key: string) => ({
        getSnapshot: async () => room(key).snapshot(),
        getMetadata: async () => room(key).meta(),
        replaceDocument: async (raw: string, base: string | null) => {
          await hooks.beforeRoomWrite?.(key);
          const result = room(key).replace(raw, base);
          await hooks.afterRoomWrite?.(key);
          return result;
        },
        patchDocument: async (patch: any, base: string) => {
          await hooks.beforeRoomWrite?.(key);
          const result = room(key).patch(patch, base);
          await hooks.afterRoomWrite?.(key);
          return result;
        },
        eraseDocument: async () => { await hooks.beforeErase?.(key); room(key).erase(); },
      }),
    } } }) },
  });
  const db: Db = {
    backend: "d1",
    execute: async stmt => { await hooks.beforeExecute?.(stmt); const result = await rawDb.execute(stmt); await hooks.afterExecute?.(stmt); return result; },
    batch: async stmts => { await hooks.beforeBatch?.(stmts); const result = await rawDb.batch(stmts); await hooks.afterBatch?.(stmts); return result; },
  };
  const notifications: Array<{ id: string; message: unknown; roomKey: unknown }> = [];
  const shared = {
    ...sites, ...docStorage, ...services, NextResponse, recordActivity, isDocPatch,
    JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited,
    IMPORT_LIMITS, validateImportedDoc, readTextLimited, TooLargeError, userMessage,
    newSiteId: () => "destination",
    getDb: async () => db, dbConfigured: () => true, requireAuth: async () => null, sessionUser: async () => null,
    serverTr: async () => (value: string) => value,
    siteIdOf: async (value: unknown) => sites.isSiteId(value) ? value : NextResponse.json({}, { status: 400 }),
    notifyDocUpdated: (id: string, message: unknown, roomKey: unknown) => { notifications.push({ id, message, roomKey }); },
  };
  const route = (name: string) => {
    const source = readFileSync(new URL(`../../app/api/${name}/route.ts`, import.meta.url), "utf8");
    const code = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
    const module = { exports: {} as Record<string, (req: Request) => Promise<Response>> };
    new Function("require", "module", "exports", code)(
      () => shared, module, module.exports,
    );
    return module.exports;
  };
  const create = async (id: string, name = "Synthetic site", doc = original) => {
    await sites.insertSite(rawDb, id, { ...dest, name });
    const key = (await sites.getSiteRoomKey(rawDb, id))!;
    if (doc) assert.equal((await services.saveSiteDocument(rawDb, id, JSON.stringify(doc), null)).kind, "saved");
    return key;
  };
  const replace = async (id: string, doc: typeof original | null) => {
    const old = (await sites.getSiteRoomKey(rawDb, id))!;
    await sites.deleteSite(rawDb, id, old);
    await sites.insertSite(rawDb, id, { ...dest, name: "Replacement owner" });
    const key = (await sites.getSiteRoomKey(rawDb, id))!;
    if (doc) assert.equal((await services.saveSiteDocument(rawDb, id, JSON.stringify(doc), null)).kind, "saved");
    return key;
  };
  return { rawDb, db, hooks, room, rooms, services, notifications, create, replace, doc: route("doc"), sites: route("sites") };
}
