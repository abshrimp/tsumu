import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

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

function deployConfigProbe(variables: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-deploy-probe-"));
  const env = { ...process.env };
  for (const name of ["WRANGLER_CONFIG", "D1_DATABASE_ID", "KV_NAMESPACE_ID", "TSUMU_ALLOW_BROWSER_ONLY_DEPLOY"]) {
    delete env[name];
  }
  Object.assign(env, variables);
  try {
    writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({
      name: "test",
      d1_databases: [{ binding: "DB", database_id: "<YOUR_D1_DATABASE_ID>" }],
      kv_namespaces: [{ binding: "ASSETS_KV", id: "<YOUR_KV_NAMESPACE_ID>" }],
    }));
    const expression = "import { wranglerConfigPath } from " +
      JSON.stringify(scriptUrl) + "; wranglerConfigPath({ deploy: true });";
    const proc = spawnSync(process.execPath, ["--input-type=module", "-e", expression], {
      cwd: dir, env, encoding: "utf8", timeout: 10_000,
    });
    return { status: proc.status, stderr: proc.stderr, generated: existsSync(join(dir, "wrangler.generated.jsonc")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("production deployment refuses missing storage bindings before writing config", () => {
  for (const variables of [{}, { D1_DATABASE_ID: "test-d1" }, { KV_NAMESPACE_ID: "test-kv" }]) {
    const result = deployConfigProbe(variables);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing deployment without/);
    assert.equal(result.generated, false);
  }
});

test("configured or explicitly browser-only deployment can generate config", () => {
  const configured = deployConfigProbe({ D1_DATABASE_ID: "test-d1", KV_NAMESPACE_ID: "test-kv" });
  assert.equal(configured.status, 0);
  assert.equal(configured.generated, true);
  const optedIn = deployConfigProbe({ TSUMU_ALLOW_BROWSER_ONLY_DEPLOY: "true" });
  assert.equal(optedIn.status, 0);
  assert.equal(optedIn.generated, true);
  const notOptedIn = deployConfigProbe({ TSUMU_ALLOW_BROWSER_ONLY_DEPLOY: "TRUE" });
  assert.notEqual(notOptedIn.status, 0);
  assert.equal(notOptedIn.generated, false);
});
