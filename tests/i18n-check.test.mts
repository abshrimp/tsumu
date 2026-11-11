import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Exercise the production checker against an isolated source tree.
function check(source: string, dict: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "tsumu-i18n-check-"));
  try {
    for (const dir of ["scripts", "app", "components", "lib/locales"]) mkdirSync(join(root, dir), { recursive: true });
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
    copyFileSync(new URL("../scripts/i18n-check.mts", import.meta.url), join(root, "scripts/i18n-check.mts"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "app/page.tsx"), source);
    writeFileSync(join(root, "auth.ts"), "");
    writeFileSync(join(root, "middleware.ts"), "");
    writeFileSync(join(root, "lib/locales/ja.ts"), `export default ${JSON.stringify(dict)};`);
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/i18n-check.mts"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("i18n checker reports missing English source keys in all literal styles", () => {
  const result = check([
    'tr("Save");',
    "tr('Delete');",
    'tr(`Copy`);',
    'trNodes /* comment */ ("Move", {});',
    'const view = <div>{tr /* trivia */ ("Undo")}</div>;',
  ].join("\\n"));
  assert.equal(result.status, 1, result.output);
  for (const key of ["Save", "Delete", "Copy", "Move", "Undo"]) assert.ok(result.output.includes(JSON.stringify(key)), result.output);
  assert.match(result.output, /5 untranslated strings/);
});

test("i18n checker decodes JavaScript string escapes", () => {
  const result = check(String.raw`tr("\\u{0053}ave"); tr('Save');`);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /1 untranslated strings/);
});

test("i18n checker ignores source-like text inside comments, strings and JSX text", () => {
  const result = check([
    '// tr("Not a call")',
    '/* trNodes("Not a key", {}) */',
    `const example = 'tr("Not a call")';`,
    'const view = <div>tr("Not a call")</div>;',
  ].join("\\n"));
  assert.equal(result.status, 0, result.output);
});

test("i18n checker uses contextual English key in trc and tr", () => {
  const source = 'trc("navigation", "Back"); tr("End", "list_end"); trNodes("Run {cmd}", { cmd: "x" }, "guide");';
  const missing = check(source, { Back: "戻る", End: "終了", "Run {cmd}": "{cmd}を実行" });
  assert.equal(missing.status, 1, missing.output);
  for (const key of ["navigation\\u0004Back", "list_end\\u0004End", "guide\\u0004Run {cmd}"]) assert.ok(missing.output.includes(JSON.stringify(key)), missing.output);
  const complete = check(source, { "navigation\\u0004Back": "戻る", "list_end\\u0004End": "末尾", "guide\\u0004Run {cmd}": "{cmd}を実行" });
  assert.equal(complete.status, 0, complete.output);
});

test("i18n checker accepts member calls, rejects empty translations, and de-duplicates", () => {
  const source = 'r.tr("Save"); i18n.trNodes("Save", {}); r.trc("menu", "End");';
  assert.equal(check(source, { Save: "", "menu\\u0004End": "" }).status, 1);
  const missing = check('tr("Save"); tr("Save");');
  assert.match(missing.output, /1 untranslated strings/);
  assert.equal(check(source, { Save: "保存", "menu\\u0004End": "終了" }).status, 0);
});

test("i18n checker skips dynamically computed keys", () => {
  const result = check('tr(dynamicKey); tr(`Save ${value}`); trc(context, "Back"); tr("Save");', { Save: "保存" });
  assert.equal(result.status, 0, result.output);
});
