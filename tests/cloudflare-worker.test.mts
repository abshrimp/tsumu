import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseJsonc, assertSafeDeployArgs, normalizeStorageConfig, assertNoStorageDowngrade, resolveWorkerName } from "../scripts/cloudflare.mjs";
import { createRequire } from "node:module";
import { transformSync } from "./helpers/bundle";
import { type AssetGcDependencies } from "../lib/asset-gc";
import { isolatedPreviewConfig, previewArguments, assertSupportedOpenNextConfig, previewLaunch } from "../scripts/cloudflare-preview.mjs";
import { getDbFromBinding, type D1LikeDatabase, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, getSite, insertSite, recordSiteSavedAt, SITE_EDIT_METADATA_INTERVAL_MS } from "../lib/sites";
import { readActivity, recordActivity } from "../lib/activity";
import { DatabaseSync } from "node:sqlite";
import { createDocPatch } from "../lib/doc-patch";
import { createInitialDoc } from "../lib/presets";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";
import { validSiteDoc } from "../lib/doc-tree";
import { type SaveDocResult } from "../lib/doc-storage";

describe("cloudflare", () => {
const scriptUrl = new URL("../scripts/cloudflare.mjs", import.meta.url).href;

function generatedConfig(src: string, workersBuildsName?: string) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-cloudflare-"));
  const env = { ...process.env };
  delete env.WRANGLER_CONFIG;
  delete env.D1_DATABASE_ID;
  delete env.KV_NAMESPACE_ID;
  delete env.WRANGLER_CI_OVERRIDE_NAME;
  if (workersBuildsName !== undefined) env.WRANGLER_CI_OVERRIDE_NAME = workersBuildsName;
  try {
    writeFileSync(join(dir, "wrangler.jsonc"), src);
    // CLI の引数や作業ディレクトリを、テストの本体と分ける。
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e",
        `import { wranglerConfigPath } from ${JSON.stringify(scriptUrl)}; wranglerConfigPath();`],
      { cwd: dir, env, stdio: "pipe", timeout: 10_000 }
    );
    return JSON.parse(readFileSync(join(dir, "wrangler.generated.jsonc"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Cloudflare 設定の文字列内にあるカンマと閉じ括弧を保持する", () => {
  const config = {
    vars: {
      ARRAY: "a,]b",
      OBJECT: "a,}b",
      SPACES: "a, ]b,   }c",
      "key,]": "value,}",
      QUOTES: 'escaped quote: ",] and ", }',
      BACKSLASHES: 'backslash: \\,] and \\, }',
      MIXED: 'backslash and quote: \\",] and \\", }',
      COMMENTS: "https://example.com/path,] /*,}*/ //, ]",
      UNICODE: "日本語,] 終わり, }",
    },
  };
  assert.deepEqual(parseJsonc(JSON.stringify(config)), config);
});

test("Cloudflare 設定のコメントと末尾カンマを除き、文字列を保持する", () => {
  const src = `{
    // オブジェクトと配列の両方に、末尾のコンマを含む
    "vars": {
      "TEXT": "a,]b, }c",
      "COMMENT": "/* not a comment,} */ //,]",
    },
    "rules": [
      {"values": [1, 2, /* 配列の末尾 */ ],},
      {"values": ["x,]", "y,}",],},
      // 配列の末尾
    ],
    "enabled": true, /* オブジェクトの末尾 */
  }`;
  assert.deepEqual(parseJsonc(src), {
    vars: { TEXT: "a,]b, }c", COMMENT: "/* not a comment,} */ //,]" },
    rules: [{ values: [1, 2] }, { values: ["x,]", "y,}"] }],
    enabled: true,
  });
});

test("Cloudflare 設定のエスケープを含むキーと値を変更しない", () => {
  const chars = ["a", ",", "]", "}", " ", '"', "\\", "/", "*", "\n", "\t", "é"];
  const vars: Record<string, string> = {};
  for (const a of chars) for (const b of chars) for (const c of chars) {
    const value = a + b + c;
    vars[value] = value;
  }
  const config = { vars };
  assert.deepEqual(parseJsonc(JSON.stringify(config)), config);
});

const completeStorage = {
  d1_databases: [{ binding: "DB", database_id: "valid-db" }],
  kv_namespaces: [{ binding: "ASSETS_KV", id: "valid-kv" }],
  durable_objects: { bindings: [
    { name: "COLLAB_ROOM", class_name: "CollaborationRoom" },
    { name: "DOC_STORE", class_name: "DocumentRoom" },
  ] },
  exports: {
    CollaborationRoom: { type: "durable-object", storage: "sqlite" },
    DocumentRoom: { type: "durable-object", storage: "sqlite" },
  },
};

test("complete storage keeps the server configuration intact", () => {
  const result = normalizeStorageConfig(completeStorage);
  assert.equal(result.mode, "server");
  assert.deepEqual(result.config, completeStorage);
});

test("declarative SQLite Durable Object exports preserve production storage bindings", () => {
  const config = completeStorage;
  const normalized = normalizeStorageConfig(config);
  assert.equal(normalized.mode, "server");
  assert.deepEqual(normalized.config, config);
  assert.doesNotThrow(() => assertNoStorageDowngrade([
    { name: "DB", type: "d1" },
    { name: "ASSETS_KV", type: "kv_namespace" },
    { name: "DOC_STORE", type: "durable_object_namespace" },
  ], config));

  for (const invalid of [
    { ...config, exports: { ...config.exports, DocumentRoom: { type: "durable-object", storage: "memory" } } },
    { ...config, exports: { ...config.exports, DocumentRoom: { type: "ordinary-class", storage: "sqlite" } } },
    { ...config, exports: { ...config.exports, DocumentRoom: { type: "durable-object", storage: "sqlite", state: "deleted" } } },
  ]) {
    assert.equal(normalizeStorageConfig(invalid).mode, "browser");
  }
});

test("missing either resource selects browser storage with neither DB nor assets KV", () => {
  const options = [
    { ...completeStorage, d1_databases: [] },
    { ...completeStorage, kv_namespaces: [] },
    { ...completeStorage, durable_objects: { bindings: [] } },
    { ...completeStorage, exports: { CollaborationRoom: completeStorage.exports.CollaborationRoom } },
    { ...completeStorage, d1_databases: [{ binding: "DB", database_id: "<YOUR_D1_DATABASE_ID>" }] },
    { ...completeStorage, kv_namespaces: [{ binding: "ASSETS_KV", id: "<YOUR_KV_NAMESPACE_ID>" }] },
  ];
  for (const option of options) {
    const result = normalizeStorageConfig(option);
    assert.equal(result.mode, "browser");
    assert.equal((result.config.d1_databases ?? []).some(b => b.binding === "DB"), false);
    assert.equal((result.config.kv_namespaces ?? []).some(b => b.binding === "ASSETS_KV"), false);
  }
});

test("browser-only new deployments and unchanged existing browser-only workers are accepted", () => {
  const browser = normalizeStorageConfig({}).config;
  assert.doesNotThrow(() => assertNoStorageDowngrade([], browser));
  assert.doesNotThrow(() => assertNoStorageDowngrade([{ name: "ASSETS", type: "assets" }], browser));
});

test("deployment rejects loss of any existing server storage bindings", () => {
  const browser = normalizeStorageConfig({}).config;
  for (const binding of [
    { name: "DB", type: "d1" },
    { name: "ASSETS_KV", type: "kv_namespace" },
    { name: "DOC_STORE", type: "durable_object_namespace" },
  ]) assert.throws(() => assertNoStorageDowngrade([binding], browser), /Refusing deployment/);
  assert.throws(() => assertNoStorageDowngrade(undefined, browser), /Cannot inspect/);
  assert.doesNotThrow(() => assertNoStorageDowngrade([
    { name: "DB", type: "d1" },
    { name: "ASSETS_KV", type: "kv_namespace" },
    { name: "DOC_STORE", type: "durable_object_namespace" },
  ], completeStorage));
});


test("repository Worker config declares both SQLite Durable Object classes without unnecessary migrations", () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.main, "workers/custom-worker.ts");
  assert.equal(config.migrations, undefined);
  assert.deepEqual(config.exports, completeStorage.exports);
  assert.deepEqual(config.durable_objects.bindings, completeStorage.durable_objects.bindings);
});

test("Workers Builds generates a config for its connected Worker without changing local defaults", () => {
  const source = JSON.stringify({ ...completeStorage, name: "tsumu", main: "workers/custom-worker.ts" });
  const local = generatedConfig(source);
  const ci = generatedConfig(source, "site-editor");
  assert.equal(local.name, "tsumu");
  assert.equal(ci.name, "site-editor");
  assert.equal(ci.main, "workers/custom-worker.ts");
  assert.deepEqual(ci.exports, local.exports);
  assert.deepEqual(ci.durable_objects, local.durable_objects);
  assert.deepEqual(ci.d1_databases, local.d1_databases);
  assert.deepEqual(ci.kv_namespaces, local.kv_namespaces);
  assert.equal(resolveWorkerName("tsumu", {}), "tsumu");
});

test("Workers Builds rejects malformed Worker name overrides", () => {
  for (const name of ["other/worker", "../tsumu", "bad name", "site_editor", "Site-Editor", "-worker", "worker-"]) {
    assert.throws(() => resolveWorkerName("tsumu", { WRANGLER_CI_OVERRIDE_NAME: name }), /Invalid WRANGLER_CI_OVERRIDE_NAME/);
  }
});

test("Wrangler JSONC parsing rejects unterminated comments after otherwise valid JSON", () => {
  assert.throws(() => parseJsonc('{"name":"tsumu"} /* dangling'), /Unterminated block comment/);
  assert.deepEqual(parseJsonc('{"name":"tsumu"} /* complete */'), { name: "tsumu" });
});

test("production deployment rejects flags that could override the validated target or bindings", () => {
  for (const forbidden of ["--config", "--config=other.jsonc", "-c", "-cother.jsonc",
    "--env", "--env=production", "--environment=production", "-e", "--name=other",
    "-n", "--var", "--define", "--secrets-file", "--ignore-base-config",
    "--cwd", "--cwd=../other-app", "--env-file", "--env-file=.env.local",
    "--profile", "--profile=other-account", "--route", "--route=example.com/*",
    "--routes", "--zone-id", "--zone-ids", "--assets", "--site",
    "--compatibility-date", "--compatibility-date=2026-11-09",
    "--compatibility-flag", "--compatibility-flags", "--"]) {
    assert.throws(() => assertSafeDeployArgs([forbidden]), /Unsupported production deploy override/);
  }
  assert.doesNotThrow(() => assertSafeDeployArgs([]));
  assert.doesNotThrow(() => assertSafeDeployArgs(["--dry-run"]));
});
});

describe("cloudflare-cron-config", () => {
test("asset GC cron triggers use Cloudflare-supported weekday syntax", () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers?.crons, [
    "0 18 * * *", // 毎日 03:00 JST
    "0 19 * * SUN", // 毎週月曜 04:00 JST
  ]);
});

function scheduledGc() {
  const url = new URL("../workers/custom-worker.ts", import.meta.url);
  const require = createRequire(url);
  const calls: AssetGcDependencies[] = [];
  const db = { backend: "d1" };
  const mocks: Record<string, unknown> = {
    "cloudflare:workers": { DurableObject: class {} },
    "../.open-next/worker.js": {},
    "./document-room": {},
    "../lib/db": { getDbFromBinding: async () => db },
    "../lib/asset-gc": { runAssetGc: async (options: AssetGcDependencies) => { calls.push(options); } },
  };
  const { code } = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports,
  );
  return {
    calls, db,
    async run(cron: string, listing = true) {
      const work: Promise<unknown>[] = [];
      const env = { DB: {}, DOC_STORE: {}, ASSETS_KV: listing ? { list: async () => ({}) } : {}, ASSET_GC_ENABLED: "true" };
      mod.exports.default.scheduled({ cron }, env, { waitUntil: (task: Promise<unknown>) => work.push(task) });
      await Promise.all(work);
    },
  };
}

test("configured daily and weekly cron events select their respective GC modes", async () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const h = scheduledGc();
  for (const cron of config.triggers.crons) await h.run(cron);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(call => call.discoverUntracked), [false, true]);
  for (const call of h.calls) {
    assert.equal(call.db, h.db);
    assert.equal(call.dryRun, false);
  }
});

test("only weekly reconciliation requires the KV listing capability", async () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const h = scheduledGc();
  await h.run(config.triggers.crons[1], false);
  assert.equal(h.calls.length, 0);
  await h.run(config.triggers.crons[0], false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].discoverUntracked, false);
});
});

describe("cloudflare-preview", () => {
const production = {
  name: "tsumu", main: "workers/custom-worker.ts", compatibility_date: "2026-10-19",
  assets: { directory: ".open-next/assets", binding: "ASSETS" },
  durable_objects: { bindings: [{ name: "COLLAB_ROOM", class_name: "CollaborationRoom" }] },
  exports: {
    CollaborationRoom: { type: "durable-object", storage: "sqlite" },
    DocumentRoom: { type: "durable-object", storage: "sqlite" },
  },
  d1_databases: [{ binding: "DB", database_name: "tsumu", database_id: "prod-db" }],
  kv_namespaces: [{ binding: "ASSETS_KV", id: "prod-kv" }],
  vars: { AUTH_URL: "https://production.example", ALLOW_ANONYMOUS: "false" },
  env: { production: { vars: { ALLOW_ANONYMOUS: "true" } } },
};

test("hosted Preview has its own DO and no production storage or variables by default", () => {
  const snapshot = structuredClone(production);
  const result = isolatedPreviewConfig(production, { D1_DATABASE_ID: "prod-db", KV_NAMESPACE_ID: "prod-kv" });
  assert.deepEqual(production, snapshot);
  assert.deepEqual(result.previews, {
    durable_objects: production.durable_objects, d1_databases: [], kv_namespaces: [], vars: {},
  });
  assert.equal(result.env, undefined);
  assert.deepEqual(result.assets, production.assets);
  assert.deepEqual(result.exports, production.exports);
  assert.equal(result.main, production.main);
});

const previewRooms = { bindings: [
  ...production.durable_objects.bindings,
  { name: "DOC_STORE", class_name: "DocumentRoom" },
] };

test("Preview IDs are independent and explicit config wins over Preview environment defaults", () => {
  const result = isolatedPreviewConfig({ ...production, previews: { durable_objects: previewRooms } }, {
    PREVIEW_D1_DATABASE_ID: "test-db", PREVIEW_KV_NAMESPACE_ID: "test-kv",
  });
  assert.equal(result.previews.d1_databases[0].database_id, "test-db");
  assert.equal(result.previews.kv_namespaces[0].id, "test-kv");
  const explicit = isolatedPreviewConfig({ ...production, previews: {
    d1_databases: [], kv_namespaces: [{ binding: "ASSETS_KV", id: "specific-kv" }], vars: { APP_ENV: "preview" },
  } }, { PREVIEW_D1_DATABASE_ID: "test-db", PREVIEW_KV_NAMESPACE_ID: "test-kv" });
  assert.deepEqual(explicit.previews.d1_databases, []);
  assert.equal(explicit.previews.kv_namespaces[0].id, "specific-kv");
  assert.deepEqual(explicit.previews.vars, { APP_ENV: "preview" });
});

test("Preview D1 document storage requires the local SQLite DocumentRoom binding and export", () => {
  const previews = {
    d1_databases: [{ binding: "DB", database_id: "test-db" }],
    durable_objects: previewRooms,
  };
  assert.doesNotThrow(() => isolatedPreviewConfig({ ...production, previews }));
  for (const bindings of [production.durable_objects.bindings, [
    ...production.durable_objects.bindings, { name: "DOC_STORE", class_name: "CollaborationRoom" },
  ]]) {
    assert.throws(() => isolatedPreviewConfig({ ...production, previews: { ...previews, durable_objects: { bindings } } }), /DOC_STORE/);
  }
  for (const docExport of [undefined, { type: "durable-object", storage: "kv" }]) {
    assert.throws(() => isolatedPreviewConfig({
      ...production, exports: { ...production.exports, DocumentRoom: docExport }, previews,
    }), /DOC_STORE/);
  }
});

for (const [key, idKey, envKey, productionEnv, id] of [
  ["d1_databases", "database_id", "PREVIEW_D1_DATABASE_ID", "D1_DATABASE_ID", "prod-db"],
  ["kv_namespaces", "id", "PREVIEW_KV_NAMESPACE_ID", "KV_NAMESPACE_ID", "prod-kv"],
]) {
  test(`${key} refuses production ID through config or either environment source`, () => {
    assert.throws(() => isolatedPreviewConfig({ ...production, previews: { [key]: [{ binding: "DIFFERENT_NAME", [idKey]: id }] } }), /production resource/);
    assert.throws(() => isolatedPreviewConfig(production, { [envKey]: id }), /production resource/);
    assert.throws(() => isolatedPreviewConfig(production, { [envKey]: id.toUpperCase() }), /production resource/);
    assert.throws(() => isolatedPreviewConfig({ ...production, [key]: [] }, { [envKey]: "shared", [productionEnv]: "shared" }), /production resource/);
    assert.throws(() => isolatedPreviewConfig({ ...production, [key]: [], env: { production: { [key]: [{ [idKey]: id }] } } }, { [envKey]: id }), /production resource/);
  });
  test(`${key} refuses missing, blank and unresolved IDs`, () => {
    for (const id of [undefined, "", " ", "<YOUR_ID>", "<REPLACE_ME>"]) {
      assert.throws(() => isolatedPreviewConfig({ ...production, previews: { [key]: [{ binding: "TEST", [idKey]: id }] } }), /separate resource ID/);
    }
  });
}

test("Preview cannot use production/external DO or omit the editor's local binding", () => {
  for (const bindings of [[], [{ name: "OTHER", class_name: "CollaborationRoom" }],
    [{ ...production.durable_objects.bindings[0], script_name: "tsumu" }],
    [{ ...production.durable_objects.bindings[0], environment: "production" }]]) {
    assert.throws(() => isolatedPreviewConfig({ ...production, previews: { durable_objects: { bindings } } }), /Preview/);
  }
});

test("additional resource types require their own isolation review", () => {
  for (const key of ["services", "r2_buckets", "queues", "tail_consumers", "containers"]) {
    assert.throws(() => isolatedPreviewConfig({ ...production, previews: { [key]: [] } }), /separate isolation review/);
  }
});

test("Preview cannot change provisioned Durable Object class lifecycles", () => {
  for (const state of ["deleted", "renamed", "transferred", "expecting-transfer"]) {
    assert.throws(() => isolatedPreviewConfig({ ...production, exports: {
      ...production.exports,
      CollaborationRoom: { type: "durable-object", state },
    } }), /must not change Durable Object class lifecycle/);
  }
});

test("Preview CLI accepts only metadata and cannot override protected configuration", () => {
  assert.deepEqual(previewArguments(["--name", "review-preview", "--tag=review", "--message", "Review data UI", "--json"]),
    ["--name", "review-preview", "--tag", "review", "--message", "Review data UI", "--json"]);
  for (const args of [["--config", "prod.jsonc"], ["--env=production"], ["--var", "ALLOW_ANONYMOUS:true"],
    ["--secrets-file", ".env"], ["--worker-name", "other"], ["--ignore-base-config=false"],
    ["other-worker.js"], ["--name"], ["--name", "--json"]]) {
    assert.throws(() => previewArguments(args), /Preview argument|requires a value/);
  }
});

test("OpenNext cache and skew setups are not silently bypassed", () => {
  assert.doesNotThrow(() => assertSupportedOpenNextConfig({
    default: { override: { incrementalCache: "dummy", tagCache: "dummy", queue: "dummy", cdnInvalidation: "dummy" } },
  }));
  for (const section of ["default", "middleware"]) for (const key of ["incrementalCache", "tagCache", "queue", "cdnInvalidation"]) {
    assert.throws(() => assertSupportedOpenNextConfig({ [section]: { override: { [key]: () => ({ name: "custom-cache" }) } } }), /separate adapter setup/);
  }
  assert.throws(() => assertSupportedOpenNextConfig({ cloudflare: { skewProtection: { enabled: true } } }), /skew protection/);
  assert.throws(() => assertSupportedOpenNextConfig({ functions: { api: { override: { incrementalCache: "custom" } } } }), /named OpenNext functions/);
});

test("Preview pins the inspected top-level Worker even when dotenv or CI names an environment", () => {
  const result = previewLaunch("config.jsonc", "tsumu", ["--name", "feature"], { CLOUDFLARE_ENV: "production" });
  assert.deepEqual(result.args, ["preview", "--config", "config.jsonc", "--env", "", "--ignore-base-config", "--name", "feature"]);
  assert.equal(result.env.WRANGLER_CI_OVERRIDE_NAME, "tsumu");
  assert.doesNotThrow(() => previewLaunch("config.jsonc", "tsumu", [], { WRANGLER_CI_OVERRIDE_NAME: "tsumu" }));
  assert.throws(() => previewLaunch("config.jsonc", "tsumu", [], { WRANGLER_CI_OVERRIDE_NAME: "other" }), /different Worker/);
  assert.throws(() => previewLaunch("config.jsonc", undefined, []), /explicit Worker name/);
});


test("repository review configuration is anonymous and browser-only without changing production", () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const before = structuredClone(config);
  const preview = isolatedPreviewConfig(config, {
    D1_DATABASE_ID: "production-db", KV_NAMESPACE_ID: "production-kv",
    PREVIEW_D1_DATABASE_ID: "unexpected-test-db", PREVIEW_KV_NAMESPACE_ID: "unexpected-test-kv",
    AUTH_SECRET: "must-not-be-copied", GITHUB_TOKEN: "must-not-be-copied",
  });
  assert.deepEqual(config, before);
  assert.deepEqual(preview.previews, {
    vars: { ALLOW_ANONYMOUS: "true" }, d1_databases: [], kv_namespaces: [],
    durable_objects: { bindings: [{ name: "COLLAB_ROOM", class_name: "CollaborationRoom" }] },
  });
  assert.equal(config.vars?.ALLOW_ANONYMOUS, undefined);
  assert.deepEqual(preview.d1_databases, config.d1_databases);
  assert.deepEqual(preview.kv_namespaces, config.kv_namespaces);
  assert.deepEqual(preview.durable_objects, config.durable_objects);
  assert.deepEqual(preview.exports, config.exports);
});

test("public Worker Preview rejects credential-like plaintext variables", () => {
  for (const name of ["AUTH_SECRET", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "DATABASE_PASSWORD", "PRIVATE_KEY"]) {
    assert.throws(() => isolatedPreviewConfig({
      ...production, previews: { vars: { [name]: "must-never-publish" } },
    }), /must be configured as a secret/);
  }
  assert.deepEqual(
    isolatedPreviewConfig({ ...production, previews: { vars: { ALLOW_ANONYMOUS: "true" } } }).previews.vars,
    { ALLOW_ANONYMOUS: "true" },
  );
});
});

describe("cloudflare-write-budget", () => {
const siteConfig = {
  name: "Site", repo: null, branch: "main", previewBranch: "preview",
  siteUrl: null, previewUrl: null,
};

test("D1 metadata and edit activity write only once per minute per site/editor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-d1-write-budget-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    // 模擬した上限の処理を試すのではなく、実際の D1 の SQL を SQLite で実行する。
    const sqlite = nodeDatabase()!;
    const binding: D1LikeDatabase = {
      prepare: sql => sqlite.prepare(sql),
      batch: statements => sqlite.batch(statements),
    };
    const real = await getDbFromBinding(binding);
    assert.equal(real.backend, "d1");
    let metadataWrites = 0;
    let activityWrites = 0;
    const db: Db = {
      ...real,
      async execute(stmt) {
        const result = await real.execute(stmt);
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        if (/^INSERT INTO site_activity/.test(sql)) activityWrites += result.rowsAffected;
        return result;
      },
      async batch(statements) {
        const results = await real.batch(statements);
        statements.forEach((statement, i) => {
          if (/^UPDATE (?:site_document_rooms|sites) SET/.test(statement.sql)) {
            metadataWrites += results[i].rowsAffected;
          }
        });
        return results;
      },
    };
    const key = (await insertSite(db, "site", siteConfig))!;
    const editor = { email: "editor@example.test", name: "Editor", image: null };
    const start = Date.now() + 120_000;

    async function edit(at: number) {
      assert.equal(await recordSiteSavedAt(db, "site", key, at), true);
      await recordActivity(db, "site", "edit", editor, at, key);
    }

    await edit(start);
    assert.equal(metadataWrites, 2);
    assert.equal(activityWrites, 1);
    for (let i = 1; i < 60; i++) {
      await edit(start + i * 1000);
    }
    assert.equal(metadataWrites, 2, "rapid autosaves must not write site timestamps");
    assert.equal(activityWrites, 1, "rapid autosaves must not rewrite edit history");
    assert.equal((await getSite(db, "site"))?.savedAt, start);

    await edit(start + SITE_EDIT_METADATA_INTERVAL_MS);
    assert.equal(metadataWrites, 4);
    assert.equal(activityWrites, 2);
    assert.equal((await getSite(db, "site"))?.savedAt, start + SITE_EDIT_METADATA_INTERVAL_MS);
    assert.equal((await readActivity(db, "site", start + SITE_EDIT_METADATA_INTERVAL_MS))?.lastEdit?.at,
      start + SITE_EDIT_METADATA_INTERVAL_MS);

    // 遅れて届いた確認で、どちらの時刻も戻ってはならない。
    await edit(start + 1000);
    assert.equal(metadataWrites, 4);
    assert.equal(activityWrites, 2);

    // 別々の編集者は、引き続き別々に表示される。公開は間引かない。
    await recordActivity(db, "site", "edit", { ...editor, email: "second@example.test" }, start + 65_000, key);
    assert.equal(activityWrites, 3);
    await recordActivity(db, "site", "publish", editor, start);
    await recordActivity(db, "site", "publish", editor, start + 1000);
    assert.equal(activityWrites, 5);

    // サイトを削除した後に、古い世代を受け入れない。
    await deleteSite(db, "site", key);
    assert.equal(await recordSiteSavedAt(db, "site", key, start + 120_000), false);
    await recordActivity(db, "site", "edit", editor, start + 120_000, key);
    assert.equal((await readActivity(db, "site")).lastEdit, null);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
});

describe("custom-worker", () => {
// 実際の Worker のハンドラーと文書の保存先を動かし、ホストのバインディングだけを置き換える。
// D1 のバインディングがあると、本番の DOC_STORE の RPC の経路が選ばれる。
function fixture(initialize = true, allowGenerationClose = false) {
  const sqlite = new DatabaseSync(":memory:");
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) {
        return { toArray: () => statement.all(...args) as Record<string, unknown>[] };
      }
      statement.run(...args);
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
  const documents = new StructuredDocumentStore(storage);
  const original = createInitialDoc();
  if (initialize) documents.replace(JSON.stringify(original), null);
  let rpcCalls = 0;
  let snapshotReads = 0;
  let metadataReads = 0;
  let generation: string | null = "generation-1";
  let readStarted: (() => void) | undefined;
  let readGate: Promise<void> | undefined;
  const remote = {
    async getSnapshot() {
      rpcCalls++;
      snapshotReads++;
      const snapshot = documents.snapshot();
      readStarted?.();
      await readGate;
      return snapshot;
    },
    async getMetadata() {
      rpcCalls++;
      metadataReads++;
      const metadata = documents.meta();
      readStarted?.();
      await readGate;
      return metadata;
    },
    async replaceDocument(raw: string, base: string | null) { rpcCalls++; return documents.replace(raw, base); },
    async patchDocument(patch: Parameters<StructuredDocumentStore["patch"]>[0], base: string) {
      rpcCalls++;
      return documents.patch(patch, base);
    },
  };
  const url = new URL("../workers/custom-worker.ts", import.meta.url);
  const require = createRequire(url);
  const mocks: Record<string, unknown> = {
    "cloudflare:workers": { DurableObject: class {
      constructor(public ctx: unknown, public env: unknown) {}
    } },
    "../.open-next/worker.js": {},
    "./document-room": { DocumentRoom: class {} },
    "../lib/db": { getDbFromBinding: async () => ({ execute: async () => ({ rows: [{}] }) }) },
    "../lib/sites": { getSiteRoomKey: async () => generation },
  };
  const { code } = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
  );
  const socket = (clientId: string) => ({
    messages: [] as string[],
    closed: [] as Array<{ code: number; reason: string }>,
    deserializeAttachment: () => ({ clientId, siteId: "s1", roomKey: "generation-1", user: null }),
    send(raw: string) { this.messages.push(raw); },
    close(code: number, reason: string) {
      if (!allowGenerationClose) assert.fail("Valid site generation must stay connected");
      this.closed.push({ code, reason });
    },
  });
  const sender = socket("sender");
  const peer = socket("peer");
  const room = new module.exports.CollaborationRoom({ getWebSockets: () => [sender, peer] }, {
    ALLOW_ANONYMOUS: "true", DB: {}, DOC_STORE: { idFromName: (name: string) => name, get: () => remote },
  });
  return {
    documents, original, sender, peer,
    rpcCalls: () => rpcCalls, snapshotReads: () => snapshotReads, metadataReads: () => metadataReads,
    setGeneration(value: string | null) { generation = value; },
    pauseRead() {
      const started = new Promise<void>(resolve => { readStarted = resolve; });
      let release!: () => void;
      readGate = new Promise<void>(resolve => { release = resolve; });
      return { started, release };
    },
    send: (input: unknown) => room.webSocketMessage(sender, JSON.stringify(input)),
    close: () => sqlite.close(),
  };
}

for (const initialize of [true, false]) {
  for (const generation of [null, "generation-2", "generation-1"]) {
    test(`WebSocket load fences an in-flight ${initialize ? "snapshot" : "empty result"} against generation ${generation}`, async () => {
      const f = fixture(initialize, generation !== "generation-1");
      try {
        const before = f.documents.snapshot();
        const read = f.pauseRead();
        const pending = f.send({ type: "load", requestId: "delayed-load" });
        await read.started;
        // 先に受け取った DocumentRoom の応答が CollaborationRoom へ届く途中で、
        // D1 では削除や作り直しが確定することがある。
        f.setGeneration(generation);
        read.release();
        await pending;
        assert.equal(f.rpcCalls(), 1);
        assert.deepEqual(f.peer.messages, []);
        assert.deepEqual(f.documents.snapshot(), before, "loading must not write a revision");
        if (generation === "generation-1") {
          assert.deepEqual(f.sender.closed, []);
          assert.deepEqual(f.sender.messages.map(raw => JSON.parse(raw)), [{
            type: "snapshot", requestId: "delayed-load", exists: initialize,
            ...(before ? { rev: before.rev, savedAt: before.savedAt, doc: f.original } : {}),
          }]);
        } else {
          assert.equal(f.sender.messages.length, 0, "neither stale content nor a stale exists:false may escape");
          assert.deepEqual(f.sender.closed, [{ code: 1008, reason: "Site generation changed" }]);
        }
      } finally { f.close(); }
    });
  }
}

test("WebSocket reconnect with a current revision skips the full document snapshot", async () => {
  const f = fixture();
  try {
    const before = f.documents.snapshot();
    await f.send({ type: "load", requestId: "reconnect", knownRev: before!.rev });
    assert.deepEqual(JSON.parse(f.sender.messages.pop()!), {
      type: "snapshot", requestId: "reconnect", exists: true,
      rev: before!.rev, savedAt: before!.savedAt,
    });
    assert.equal(f.metadataReads(), 1);
    assert.equal(f.snapshotReads(), 0, "do not rebuild the large document just to compare revisions");
    assert.equal(f.rpcCalls(), 1);
    assert.deepEqual(f.peer.messages, []);

    await f.send({ type: "load", requestId: "catchup", knownRev: "0" });
    assert.deepEqual(JSON.parse(f.sender.messages.pop()!), {
      type: "snapshot", requestId: "catchup", exists: true,
      rev: before!.rev, savedAt: before!.savedAt, doc: f.original,
    });
    assert.equal(f.metadataReads(), 2);
    assert.equal(f.snapshotReads(), 1, "out-of-date editors still receive the full latest document");
    assert.deepEqual(f.documents.snapshot(), before);
  } finally { f.close(); }
});

test("metadata-only load refuses to acknowledge a deleted and recreated site", async () => {
  const f = fixture(true, true);
  try {
    const read = f.pauseRead();
    const pending = f.send({ type: "load", requestId: "stale-reconnect", knownRev: "1" });
    await read.started;
    f.setGeneration("generation-2");
    read.release();
    await pending;
    assert.equal(f.snapshotReads(), 0);
    assert.equal(f.metadataReads(), 1);
    assert.deepEqual(f.sender.messages, []);
    assert.deepEqual(f.sender.closed, [{ code: 1008, reason: "Site generation changed" }]);
  } finally { f.close(); }
});

for (const type of ["load", "save", "patch"] as const) {
  test(`WebSocket ${type} rejects non-string request IDs without invoking document RPC`, async () => {
    const f = fixture();
    try {
      const doc = { ...f.original, siteName: "Must not be saved" };
      const before = f.documents.snapshot();
      for (const requestId of [123, true, ["request"], { toString: null }, null, undefined, "", "bad id"]) {
        f.sender.messages.length = 0;
        await assert.doesNotReject(f.send({ type, requestId, base: "1", doc, patch: createDocPatch(f.original, doc) }));
        assert.equal(f.sender.messages.length, 1);
        assert.deepEqual(JSON.parse(f.sender.messages[0]), {
          type: "error", requestId: "", message: "不正なリクエストIDです",
        });
        assert.equal(f.rpcCalls(), 0);
        assert.deepEqual(f.documents.snapshot(), before);
        assert.deepEqual(f.peer.messages, []);
      }
    } finally { f.close(); }
  });
}

test("WebSocket saves reject non-string, non-null bases before document RPC", async () => {
  const f = fixture();
  try {
    const before = f.documents.snapshot();
    for (const base of [1, ["1"], true, {}, { toString: null }, undefined]) {
      f.sender.messages.length = 0;
      await assert.doesNotReject(f.send({ type: "save", requestId: "save", base,
        doc: { ...f.original, siteName: "Must not be saved" } }));
      assert.deepEqual(f.sender.messages.map(raw => JSON.parse(raw).type), ["error"]);
      assert.equal(JSON.parse(f.sender.messages[0]).requestId, "save");
      assert.equal(f.rpcCalls(), 0);
      assert.deepEqual(f.documents.snapshot(), before);
      assert.deepEqual(f.peer.messages, []);
    }
  } finally { f.close(); }
});

test("WebSocket string IDs and revision bases preserve load, save, patch and conflict behavior", async () => {
  const f = fixture();
  try {
    await f.send({ type: "load", requestId: "load_1" });
    assert.deepEqual(JSON.parse(f.sender.messages.pop()!), {
      type: "snapshot", requestId: "load_1", exists: true,
      rev: "1", savedAt: f.documents.meta()!.savedAt, doc: f.original,
    });
    const saved = { ...f.original, siteName: "Saved" };
    await f.send({ type: "save", requestId: "save-2", base: "1", doc: saved });
    assert.deepEqual(JSON.parse(f.sender.messages.pop()!), {
      type: "saved", requestId: "save-2", rev: "2", savedAt: f.documents.meta()!.savedAt,
    });
    assert.deepEqual(JSON.parse(f.peer.messages.pop()!).doc, saved);
    const patched = { ...saved, siteName: "Patched" };
    const patch = createDocPatch(saved, patched)!;
    await f.send({ type: "patch", requestId: "patch_3", base: "2", patch });
    assert.equal(JSON.parse(f.sender.messages.pop()!).rev, "3");
    assert.deepEqual(JSON.parse(f.peer.messages.pop()!), {
      type: "doc-patched", base: "2", rev: "3", savedAt: f.documents.meta()!.savedAt, patch,
    });
    for (const base of ["1", null]) {
      await f.send({ type: "save", requestId: "conflict", base, doc: saved });
      const response = JSON.parse(f.sender.messages.pop()!);
      assert.equal(response.type, "conflict");
      assert.equal(response.rev, "3");
      assert.deepEqual(response.doc, patched);
      assert.deepEqual(f.peer.messages, []);
    }
  } finally { f.close(); }
});

test("WebSocket null base creates an initial document", async () => {
  const f = fixture(false);
  try {
    await f.send({ type: "save", requestId: "create", base: null, doc: f.original });
    assert.equal(JSON.parse(f.sender.messages[0]).type, "saved");
    assert.equal(f.documents.meta()!.rev, "1");
    assert.deepEqual(JSON.parse(f.documents.snapshot()!.body), f.original);
    assert.deepEqual(JSON.parse(f.peer.messages[0]).doc, f.original);
  } finally { f.close(); }
});

test("WebSocket request IDs cannot throw through object coercion", async () => {
  const f = fixture();
  try {
    await assert.doesNotReject(f.send({ type: "load", requestId: { toString: null } }));
    assert.equal(JSON.parse(f.sender.messages[0]).type, "error");
    assert.equal(f.rpcCalls(), 0);
  } finally { f.close(); }
});
});

describe("document-room-quota", () => {
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

// Cloudflare の基底クラスだけを置き換え、実際の DocumentRoom のフィールドの初期化も実行する。
function roomClass() {
  const url = new URL("../workers/document-room.ts", import.meta.url);
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
      : name === "../lib/structured-document-store" ? { StructuredDocumentStore } : require(name),
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
});

describe("document-room-service", () => {
/** Worker を必要とせずに、実際の Cloudflare の振り分けのモジュールを動かす。 */
function fixture(options: { local?: boolean; missingBinding?: boolean } = {}) {
  const url = new URL("../lib/site-document-service.ts", import.meta.url);
  const require = createRequire(url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;

  let generation: string | null = "first-room";
  let saveResult: SaveDocResult = { kind: "saved", rev: "2", savedAt: 200 };
  let storageError: Error | null = null;
  let roomLookups = 0;
  let localCalls = 0;
  let timestampWrites = 0;
  const queue = ["old-room"];
  let erased = 0;
  let mutation: (() => void) | null = null;
  const save = async () => {
    mutation?.(); mutation = null;
    if (storageError) throw storageError;
    return saveResult;
  };
  const room = {
    getSnapshot: async () => {
      mutation?.(); mutation = null;
      return { rev: "1", savedAt: 100, body: '{"siteName":"Old"}' };
    },
    getMetadata: async () => ({ rev: "1", savedAt: 100 }),
    replaceDocument: save,
    patchDocument: save,
    listAssetReferences: async () => [],
    listBackups: async () => [],
    readBackup: async () => null,
    eraseDocument: async () => { erased++; },
  };
  const namespace = {
    idFromName: (key: string) => key,
    get: (_key: string) => { roomLookups++; return room; },
  };
  const local = async () => { localCalls++; return { kind: "missing" }; };
  const mocks: Record<string, unknown> = {
    "@opennextjs/cloudflare": {
      getCloudflareContext: () => {
        if (options.local) throw new Error("Not a Worker");
        return { env: { DB: {}, DOC_STORE: options.missingBinding ? undefined : namespace } };
      },
    },
    "./sites": { getSiteRoomKey: async () => generation, recordSiteSavedAt },
    "./doc-storage": {
      readCurrentDoc: async () => { localCalls++; return null; },
      saveCurrentDoc: local, saveDocPatch: local,
    },
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  const db = {
    backend: "d1" as const,
    async execute(statement: string | { sql: string; args: unknown[] }) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (sql.includes("FROM document_room_cleanup") && sql.startsWith("SELECT")) {
        return { rows: queue.map(room_key => ({ room_key })), rowsAffected: 0 };
      }
      if (sql.startsWith("DELETE FROM document_room_cleanup")) {
        queue.length = 0;
        return { rows: [], rowsAffected: 1 };
      }
      if (sql.includes("FROM site_document_rooms r JOIN sites s")) {
        const key = typeof statement === "string" ? null : statement.args[1];
        return {
          rows: key === generation ? [{ saved_at: null, updated_at: 0 }] : [],
          rowsAffected: 0,
        };
      }
      throw new Error("Unexpected D1 SQL: " + sql);
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      timestampWrites++;
      const key = String(stmts[0].args[2]);
      const match = key === generation;
      return [{ rows: [], rowsAffected: Number(match) }, { rows: [], rowsAffected: Number(match) }];
    },
  };
  return {
    store: module.exports,
    db, queue,
    get erased() { return erased; },
    get roomLookups() { return roomLookups; },
    get localCalls() { return localCalls; },
    get timestampWrites() { return timestampWrites; },
    setGeneration(to: string | null) { generation = to; },
    setSaveResult(result: SaveDocResult) { saveResult = result; },
    failSave(error: Error) { storageError = error; },
    changeOnNextCall(to: string | null) { mutation = () => { generation = to; }; },
  };
}

test("a document read in flight cannot expose a removed site generation", async () => {
  const f = fixture();
  f.changeOnNextCall("new-room");
  assert.equal(await f.store.readSiteDocument(f.db, "site"), null);
});

test("a save completing after the old site generation is deleted is not acknowledged", async () => {
  const f = fixture();
  f.changeOnNextCall("new-room");
  const result = await f.store.saveSiteDocument(f.db, "site", "{}", "1");
  assert.deepEqual(result, { kind: "missing" });
});

test("retired rooms are sealed and their deletion queue is drained", async () => {
  const f = fixture();
  await f.store.cleanupAbandonedDocuments(f.db, 2);
  assert.equal(f.erased, 1);
  assert.deepEqual(f.queue, []);
  await f.store.cleanupAbandonedDocuments(f.db, 2);
  assert.equal(f.erased, 1);
});

const conflict: SaveDocResult = {
  kind: "conflict", current: { rev: "3", savedAt: 300, body: '{"siteName":"Old generation"}' },
};
const saveMethods = ["saveSiteDocument", "patchSiteDocumentWithTarget"] as const;
/** 全体の保存と差分の保存を、同じ結果の形で呼ぶ。 */
const save = (f: ReturnType<typeof fixture>, method: typeof saveMethods[number]): Promise<SaveDocResult> =>
  method === "saveSiteDocument"
    ? f.store.saveSiteDocument(f.db, "site", "{}", "1")
    : f.store.patchSiteDocumentWithTarget(f.db, "site", [{ path: ["siteName"], value: "Edited" }], "1")
      .then((mutation: { result: SaveDocResult }) => mutation.result);

for (const method of saveMethods) {
  for (const generation of [null, "new-room"]) {
    test(`${method} hides conflict snapshots after deletion${generation ? " and recreation" : ""}`, async () => {
      const f = fixture();
      f.setSaveResult(conflict);
      f.changeOnNextCall(generation);
      assert.deepEqual(await save(f, method), { kind: "missing" });
      assert.equal(f.timestampWrites, 0);
      assert.equal(f.localCalls, 0);
    });
  }

  test(`${method} preserves a current-generation revision conflict`, async () => {
    const f = fixture();
    f.setSaveResult(conflict);
    assert.deepEqual(await save(f, method), conflict);
    assert.equal(f.timestampWrites, 0);
  });

  test(`${method} propagates storage failures instead of classifying them as missing`, async () => {
    const f = fixture();
    const error = new Error("RPC unavailable");
    f.failSave(error);
    await assert.rejects(save(f, method), error);
    assert.equal(f.timestampWrites, 0);
  });

  test(`${method} returns missing before calling storage for a deleted generation`, async () => {
    const f = fixture();
    f.setGeneration(null);
    assert.deepEqual(await save(f, method), { kind: "missing" });
    assert.equal(f.roomLookups, 0);
    assert.equal(f.localCalls, 0);
    assert.equal(f.timestampWrites, 0);
  });

  test(`${method} still routes Node saves to local storage`, async () => {
    const f = fixture({ local: true });
    assert.deepEqual(await save(f, method), { kind: "missing" });
    assert.equal(f.localCalls, 1);
    assert.equal(f.roomLookups, 0);
  });
}

for (const [method, expected] of [
  ["readSiteDocument", null], ["readSiteDocumentMeta", null],
  ["listSiteDocumentBackups", []], ["readSiteDocumentBackup", null],
  ["documentAssetReferences", []],
] as const) {
  test(`${method} treats an absent room generation as missing without a local fallback`, async () => {
    const f = fixture();
    f.setGeneration(null);
    assert.deepEqual(await f.store[method](f.db, "site", 0), expected);
    assert.equal(f.roomLookups, 0);
    assert.equal(f.localCalls, 0);
  });
}

test("missing Cloudflare bindings remain configuration errors", async () => {
  const f = fixture({ missingBinding: true });
  await assert.rejects(f.store.readSiteDocument(f.db, "site"), /DOC_STORE binding is required/);
  assert.equal(f.localCalls, 0);
});

test("initialization bound to a D1 generation never falls back to local storage", async () => {
  const f = fixture({ local: true });
  assert.deepEqual(await f.store.saveSiteDocument(f.db, "site", "{}", null, "required-room"), { kind: "missing" });
  assert.equal(f.localCalls, 0);
});

test("initialization refuses an empty or replaced required D1 generation before writing", async () => {
  for (const key of ["", "previous-room"]) {
    const f = fixture();
    assert.deepEqual(await f.store.saveSiteDocument(f.db, "site", "{}", null, key), { kind: "missing" });
    assert.equal(f.timestampWrites, 0);
  }
});

test("initialization bound to the current D1 generation retains the saved result shape", async () => {
  const f = fixture();
  assert.deepEqual(await f.store.saveSiteDocument(f.db, "site", "{}", null, "first-room"), { kind: "saved", rev: "2", savedAt: 200 });
});
});

describe("release-safety", () => {
const userGuide = readFileSync(new URL("../docs/user-guide.md", import.meta.url), "utf8");
const backupScript = [...userGuide.matchAll(/```bash\n([\s\S]*?)```/g)]
  .map((match) => match[1]).find((script) => script.includes("docker stop tsumu"));
assert.ok(backupScript, "user guide must provide the Docker backup procedure");
const runbook = readFileSync(new URL("../docs/releasing.md", import.meta.url), "utf8");
const integrityScript = runbook.match(/<!-- restore-integrity-check -->\n```sh\n([\s\S]*?)```/)?.[1];
assert.ok(integrityScript, "runbook must provide the disposable restore check");

// 文書に書いた実際のシェルのブロックを実行するが、Docker のデーモンには決して接続しない。
// 通常の対話的なシェルは、文書から `set -e` を引き継がない。
function dockerBackup(scenario: string, check: (result: ReturnType<typeof spawnSync>, calls: string[][]) => void) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-release-"));
  try {
    const log = join(dir, "docker-calls.bin");
    writeFileSync(join(dir, "docker"), `#!/bin/sh
for arg in "$@"; do
  printf '%s\\0' "$arg" >> "$TEST_DOCKER_LOG"
done
printf '\\1' >> "$TEST_DOCKER_LOG"
if [ "$1" = "stop" ] && [ "$TEST_DOCKER_SCENARIO" = "stop-failure" ]; then exit 41; fi
if [ "$1" = "run" ] && [ "$TEST_DOCKER_SCENARIO" = "archive-failure" ]; then exit 42; fi
if [ "$1" = "inspect" ]; then
  if [ "$TEST_DOCKER_SCENARIO" = "inspect-failure" ]; then exit 43; fi
  case "$*" in
    *.Mounts*)
      if [ "$TEST_DOCKER_SCENARIO" = "wrong-volume" ]; then echo "different-data"; else echo "tsumu-data"; fi
      if [ "$TEST_DOCKER_SCENARIO" = "volume-inspect-output-failure" ]; then exit 43; fi
      ;;
    *)
      if [ "$TEST_DOCKER_SCENARIO" = "still-running" ]; then echo "true"; else echo "false"; fi
      if [ "$TEST_DOCKER_SCENARIO" = "state-inspect-output-failure" ]; then exit 43; fi
      ;;
  esac
fi
`, { mode: 0o755 });
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", backupScript!], {
      cwd: dir,
      env: {
        PATH: `${dir}:/usr/bin:/bin`, HOME: dir,
        TEST_DOCKER_LOG: log, TEST_DOCKER_SCENARIO: scenario,
      },
      encoding: "utf8",
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, "utf8").split("\x01").filter(Boolean)
      .map((record) => record.split("\x00").slice(0, -1));
    check(result, calls);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of ["stop-failure", "inspect-failure", "still-running", "wrong-volume",
  "volume-inspect-output-failure", "state-inspect-output-failure"]) {
  test(`documented Docker backup refuses to copy when ${scenario}`, () => {
    dockerBackup(scenario, (result, calls) => {
      assert.notEqual(result.status, 0, "an unsafe backup attempt must report failure");
      assert.ok(!calls.some((args) => args[0] === "run"), "must not archive an unverified volume or live writer");
      assert.ok(!calls.some((args) => args[0] === "start"), "must not continue after a failed precondition");
    });
  });
}

test("documented Docker backup preserves archive failures instead of masking them with restart success", () => {
  dockerBackup("archive-failure", (result, calls) => {
    assert.notEqual(result.status, 0);
    assert.ok(calls.some((args) => args[0] === "stop"));
    assert.ok(calls.some((args) => args[0] === "run"));
    assert.ok(!calls.some((args) => args[0] === "start"));
  });
});

test("documented Docker backup reads the stopped volume without overwriting the previous archive", () => {
  dockerBackup("success", (result, calls) => {
    assert.equal(result.status, 0, String(result.stderr));
    const stop = calls.findIndex((args) => args[0] === "stop");
    const run = calls.findIndex((args) => args[0] === "run");
    const start = calls.findIndex((args) => args[0] === "start");
    assert.ok(stop >= 0 && stop < run && run < start);
    assert.ok(calls[run].includes("type=volume,src=tsumu-data,dst=/data,readonly"));
    const output = calls[run].find((arg) => arg.startsWith("type=bind,src="));
    assert.ok(output?.match(/\/tsumu-backup\.[^/]+,dst=\/backup$/), "each attempt needs its own output directory");
    assert.ok(calls[run].at(-1)?.includes("test -s /data/tsumu.db"), "an empty volume is not a backup");
    assert.ok(calls[run].at(-1)?.includes("tar tzf"), "verify archive readability before restarting");
  });
});

function checkIntegrity(dir: string, restoreDir?: string) {
  return spawnSync("/bin/sh", ["-c", integrityScript!], {
    cwd: dir,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      ...(restoreDir === undefined ? {} : { TSUMU_RESTORE_DIR: restoreDir }),
    },
    encoding: "utf8",
  });
}

for (const scenario of ["unset", "missing", "corrupt"]) {
  test(`documented restore check rejects ${scenario} input without creating or replacing data`, () => {
    const dir = mkdtempSync(join(tmpdir(), "tsumu-restore-"));
    const file = join(dir, "tsumu.db");
    const corrupt = "This is not a SQLite database";
    try {
      if (scenario === "corrupt") writeFileSync(file, corrupt);
      const result = checkIntegrity(dir, scenario === "unset" ? undefined : dir);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, result.stdout);
      assert.doesNotMatch(result.stdout, /SQLite integrity: ok/);
      if (scenario === "corrupt") assert.equal(readFileSync(file, "utf8"), corrupt);
      else assert.equal(existsSync(file), false, "must not create a new empty database");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("documented archive and restore check preserve a stopped SQLite fixture and asset metadata", () => {
  // Docker の操作は上で模擬した。ここでは、その実際のアーカイブの中身を、ホストの tar と
  // 使い捨てのパスで実行し、展開は新しいディレクトリの中だけで行う。
  let payload = "";
  dockerBackup("success", (result, calls) => {
    assert.equal(result.status, 0);
    payload = calls.find((args) => args[0] === "run")!.at(-1)!;
  });
  const dir = mkdtempSync(join(tmpdir(), "tsumu-roundtrip-"));
  try {
    const source = join(dir, "stopped data");
    const output = join(dir, "backup");
    const restored = join(dir, "restored");
    for (const path of [join(source, "assets/data"), join(source, "assets/meta"), output, restored]) {
      mkdirSync(path, { recursive: true });
    }
    const db = new DatabaseSync(join(source, "tsumu.db"));
    try {
      db.exec("PRAGMA journal_mode = WAL; CREATE TABLE docs (id TEXT PRIMARY KEY, rev INTEGER, body TEXT)");
      db.prepare("INSERT INTO docs VALUES (?, ?, ?)").run("fixture", 7, '{"siteName":"Release fixture"}');
    } finally {
      db.close(); // 文書に書いたコピーの前に、準備で書き込むものをすべて止める。
    }
    writeFileSync(join(source, "assets/data/fixture.svg"), "<svg/>");
    writeFileSync(join(source, "assets/meta/fixture.svg"), '{"contentType":"image/svg+xml"}');
    const localPayload = payload.replaceAll("/data/", '"$TEST_DATA"/')
      .replaceAll("-C /data .", '-C "$TEST_DATA" .')
      .replaceAll("/backup/", '"$TEST_BACKUP"/');
    const result = spawnSync("/bin/sh", ["-ec", localPayload], {
      env: { PATH: "/usr/bin:/bin", TEST_DATA: source, TEST_BACKUP: output }, encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    execFileSync("/usr/bin/tar", ["xzf", join(output, "tsumu-data.tgz"), "-C", restored]);
    for (const file of ["tsumu.db", "assets/data/fixture.svg", "assets/meta/fixture.svg"]) {
      assert.deepEqual(readFileSync(join(restored, file)), readFileSync(join(source, file)));
    }
    const before = readFileSync(join(restored, "tsumu.db"));
    const integrity = checkIntegrity(dir, restored);
    assert.ifError(integrity.error);
    assert.equal(integrity.status, 0, integrity.stderr);
    assert.match(integrity.stdout, /SQLite integrity: ok; application and asset checks still required/);
    assert.deepEqual(readFileSync(join(restored, "tsumu.db")), before, "validation must not change database bytes");
    const recovered = new DatabaseSync(join(restored, "tsumu.db"), { readOnly: true });
    try {
      assert.deepEqual({ ...recovered.prepare("SELECT * FROM docs").get() }, {
        id: "fixture", rev: 7, body: '{"siteName":"Release fixture"}',
      });
    } finally {
      recovered.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
});
