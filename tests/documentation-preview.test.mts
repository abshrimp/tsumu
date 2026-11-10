import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseJsonc, normalizeStorageConfig, storageBindings } from "../scripts/cloudflare.mjs";
import { isolatedPreviewConfig } from "../scripts/cloudflare-preview.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const previewEnv = {
  PREVIEW_D1_DATABASE_ID: "test-db",
  PREVIEW_KV_NAMESPACE_ID: "test-kv",
};

// Execute the operator's copyable example, rather than maintaining a second
// configuration fixture that could pass while the instructions remain broken.
for (const guide of ["docs/worker-previews.md", "docs/worker-previews.ja.md"]) {
  test(`${guide}: test-storage recipe supplies the complete document store`, () => {
    const examples = [...read(guide).matchAll(/```jsonc?\s*\n([\s\S]*?)\n```/g)]
      .map((match) => parseJsonc(match[1]));
    const recipe = examples.find((example) => example.previews);
    assert.ok(recipe, "The test-storage instructions need a copyable previews block");
    assert.deepEqual(Object.keys(recipe), ["previews"], "Keep production settings outside the replacement block");

    const production = parseJsonc(read("wrangler.jsonc"));
    const original = structuredClone(production);
    const source = { ...production, ...recipe };
    // The hosted-preview command first runs the production config normalizer.
    const prepared = normalizeStorageConfig(source).config;
    const generated = isolatedPreviewConfig(prepared, previewEnv);
    const effective = { ...generated, ...generated.previews };
    assert.deepEqual(storageBindings(effective), { db: true, kv: true, doc: true });
    assert.deepEqual(generated.previews.durable_objects.bindings, [
      { name: "COLLAB_ROOM", class_name: "CollaborationRoom" },
      { name: "DOC_STORE", class_name: "DocumentRoom" },
    ]);
    assert.equal(effective.d1_databases[0].database_id, previewEnv.PREVIEW_D1_DATABASE_ID);
    assert.equal(effective.kv_namespaces[0].id, previewEnv.PREVIEW_KV_NAMESPACE_ID);
    assert.deepEqual(effective.vars, {}, "Shared storage must not opt into anonymous access");
    assert.deepEqual(production, original);
    for (const key of ["durable_objects", "exports", "d1_databases", "kv_namespaces", "vars"]) {
      assert.deepEqual(generated[key], prepared[key], `Preview setup must preserve top-level ${key}`);
    }
  });
}

test("default browser-only previews and incomplete custom storage have different requirements", () => {
  const config = parseJsonc(read("wrangler.jsonc"));
  const defaults = isolatedPreviewConfig(config, previewEnv);
  assert.deepEqual(defaults.previews.d1_databases, []);
  assert.deepEqual(defaults.previews.kv_namespaces, []);
  assert.equal(defaults.previews.vars.ALLOW_ANONYMOUS, "true");

  // This was the old guide: remove the empty arrays and supply only D1/KV IDs.
  config.previews = { vars: {} };
  assert.throws(() => isolatedPreviewConfig(config, previewEnv), /DOC_STORE/);
});
