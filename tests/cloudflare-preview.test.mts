import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonc } from "../scripts/cloudflare.mjs";
import { test } from "node:test";
import { isolatedPreviewConfig, previewArguments, assertSupportedOpenNextConfig, previewLaunch } from "../scripts/cloudflare-preview.mjs";

const production = {
  name: "tsumu", main: "custom-worker.ts", compatibility_date: "2026-10-19",
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
