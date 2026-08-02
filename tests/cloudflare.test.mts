import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseJsonc, assertSafeDeployArgs, normalizeStorageConfig, assertNoStorageDowngrade } from "../scripts/cloudflare.mjs";

const scriptUrl = new URL("../scripts/cloudflare.mjs", import.meta.url).href;

function generatedConfig(src: string) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-cloudflare-"));
  const env = { ...process.env };
  delete env.WRANGLER_CONFIG;
  delete env.D1_DATABASE_ID;
  delete env.KV_NAMESPACE_ID;
  try {
    writeFileSync(join(dir, "wrangler.jsonc"), src);
    // CLI の引数や作業ディレクトリをテスト本体と分離する。
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
  assert.deepEqual(generatedConfig(JSON.stringify(config)), config);
});

test("Cloudflare 設定のコメントと末尾カンマを除き、文字列を保持する", () => {
  const src = `{
    // オブジェクトと配列の両方に末尾カンマを含む
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
  assert.deepEqual(generatedConfig(src), {
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
  assert.deepEqual(generatedConfig(JSON.stringify(config)), config);
});

const completeStorage = {
  d1_databases: [{ binding: "DB", database_id: "valid-db" }],
  kv_namespaces: [{ binding: "ASSETS_KV", id: "valid-kv" }],
  durable_objects: { bindings: [{ name: "DOC_STORE", class_name: "DocumentRoom" }] },
  migrations: [{ tag: "v2", new_sqlite_classes: ["DocumentRoom"] }],
};

test("complete storage keeps the server configuration intact", () => {
  const result = normalizeStorageConfig(completeStorage);
  assert.equal(result.mode, "server");
  assert.deepEqual(result.config, completeStorage);
});

test("missing either resource selects browser storage with neither DB nor assets KV", () => {
  const options = [
    { ...completeStorage, d1_databases: [] },
    { ...completeStorage, kv_namespaces: [] },
    { ...completeStorage, durable_objects: { bindings: [] } },
    { ...completeStorage, migrations: [] },
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
