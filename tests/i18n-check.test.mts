import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Run the actual CLI against an isolated source tree; never modify application files.
function check(source: string, dict: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "tsumu-i18n-check-"));
  try {
    for (const dir of ["scripts", "app", "components", "lib/locales"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
    copyFileSync(new URL("../scripts/i18n-check.mts", import.meta.url), join(root, "scripts/i18n-check.mts"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "app/page.tsx"), source);
    writeFileSync(join(root, "auth.ts"), "");
    writeFileSync(join(root, "middleware.ts"), "");
    writeFileSync(join(root, "lib/locales/en.ts"), `export default ${JSON.stringify(dict)};`);
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

test("i18n CLI rejects missing static translations across literal styles and call trivia", () => {
  const result = check([
    'tr("未訳一");',
    "tr('未訳二');",
    'tr(`未訳三`);',
    "trNodes /* call comment */ ('未訳四', {});",
    'const view = <div>{tr /* comment */ ("未訳五")}</div>;',
  ].join("\n"));
  assert.equal(result.status, 1, result.output);
  for (const key of ["未訳一", "未訳二", "未訳三", "未訳四", "未訳五"]) {
    assert.ok(result.output.includes(JSON.stringify(key)), result.output);
  }
  assert.match(result.output, /5 untranslated strings/);
});

test("i18n CLI decodes JavaScript string escapes instead of parsing them as JSON", () => {
  const result = check(String.raw`tr("\u{65E5}\x41\'本"); tr('日A\'本');`);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(JSON.stringify("日A'本")), result.output);
  assert.match(result.output, /1 untranslated strings/);
});

test("i18n CLI ignores translation-like text in comments, strings and JSX text", () => {
  const result = check([
    '// tr("コメント一")',
    '/* trNodes("コメント二", {}) */',
    'const example = \'tr("文字列")\';',
    'const template = `tr("テンプレート")`;',
    'const view = <div>tr("説明文")</div>;',
  ].join("\n"));
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /All strings are translated/);
});

test("i18n CLI requires the contextual key that trc actually looks up", () => {
  const result = check('trc("行間", "行");', { "行": "Line" });
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(JSON.stringify("行間\u0004行")), result.output);
});

test("i18n CLI checks member calls used by server translation helpers", () => {
  const source = 'r.tr("未訳"); r.tr(\'保存\'); i18n.trNodes(`説明`, {}); i18n.trc("行間", "行");';
  const missing = check(source);
  assert.equal(missing.status, 1, missing.output);
  for (const key of ["未訳", "保存", "説明", "行間\u0004行"]) {
    assert.ok(missing.output.includes(JSON.stringify(key)), missing.output);
  }
  assert.match(missing.output, /4 untranslated strings/);
  const translated = check(source, { "未訳": "Translated", "保存": "Save", "説明": "Description", "行間\u0004行": "Line" });
  assert.equal(translated.status, 0, translated.output);
});

test("i18n CLI recognizes contextual literals with comments and alternate quotes", () => {
  const result = check("trc('行間', /* source */ `行`); trc(`配置`, '列');");
  assert.equal(result.status, 1, result.output);
  for (const key of ["行間\u0004行", "配置\u0004列"]) {
    assert.ok(result.output.includes(JSON.stringify(key)), result.output);
  }
  assert.match(result.output, /2 untranslated strings/);
});

test("i18n CLI rejects empty translations that the runtime cannot use", () => {
  const result = check('tr("保存"); trc("行間", "行");', { "保存": "", "行間\u0004行": "" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /2 untranslated strings/);
});

test("i18n CLI accepts translated literals and deduplicates missing keys per file", () => {
  const result = check([
    'tr("保存"); trNodes(\'保存\', {});',
    'trc(`行間`, /* source */ "行");',
    'tr("English source");',
  ].join("\n"), { "保存": "Save", "行間\u0004行": "Line" });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /All strings are translated/);
  const missing = check('tr("未訳"); trNodes("未訳", {});');
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /1 untranslated strings/);
});

test("i18n CLI inspects calls inside expressions without treating dynamic arguments as keys", () => {
  const result = check('tr(dynamicKey); tr(`動的${value}`); trc(context, "行"); const text = `${tr("未訳")}`;');
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(JSON.stringify("未訳")), result.output);
  assert.match(result.output, /1 untranslated strings/);
});
