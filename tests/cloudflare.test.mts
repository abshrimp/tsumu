import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
