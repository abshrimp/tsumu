import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkTranslations } from "../scripts/i18n-check.mts";

type Dicts = Record<string, Record<string, string>>;

/** 切り離したソースのツリーを作り、片付けまで行う。 */
async function withTree<T>(source: string, dict: Record<string, string>, extra: Dicts, run: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "tsumu-i18n-check-"));
  try {
    for (const dir of ["app", "components", "lib/locales"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "app/page.tsx"), source);
    writeFileSync(join(root, "auth.ts"), "");
    writeFileSync(join(root, "proxy.ts"), "");
    writeFileSync(join(root, "lib/locales/ja.ts"), `export default ${JSON.stringify(dict)};`);
    for (const [lang, translations] of Object.entries(extra)) {
      writeFileSync(join(root, `lib/locales/${lang}.ts`), `export default ${JSON.stringify(translations)};`);
    }
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// 本番の点検と同じ関数を、切り離したソースのツリーに対して動かす。
function check(source: string, dict: Record<string, string> = {}, args = ["--strict", "ja"], extra: Dicts = {}) {
  return withTree(source, dict, extra, async (root) => {
    const lines: string[] = [];
    const write = (...parts: unknown[]) => { lines.push(parts.join(" ")); };
    const failed = await checkTranslations(root, args, { log: write, warn: write, error: write });
    return { status: failed ? 1 : 0, output: lines.join("\n") };
  });
}

test("the command exits with a failure only when a strict check finds missing translations", async () => {
  await withTree('tr("Save");', {}, {}, (root) => {
    mkdirSync(join(root, "scripts"));
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
    copyFileSync(new URL("../scripts/i18n-check.mts", import.meta.url), join(root, "scripts/i18n-check.mts"));
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/i18n-check.mts", "--strict", "ja"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /"Save"/);
    assert.match(result.stderr, /ERROR: 1 untranslated strings for ja/);
  });
});

test("i18n checker reports missing English source keys in all literal styles", async () => {
  const result = await check([
    'tr("Save");',
    "tr('Delete');",
    'tr(`Copy`);',
    'trNodes /* comment */ ("Move", {});',
    'const view = <div>{tr /* trivia */ ("Undo")}</div>;',
  ].join("\n"));
  assert.equal(result.status, 1, result.output);
  for (const key of ["Save", "Delete", "Copy", "Move", "Undo"]) assert.ok(result.output.includes(JSON.stringify(key)), result.output);
  assert.match(result.output, /5 untranslated strings/);
});

test("i18n checker decodes JavaScript string escapes", async () => {
  const result = await check(String.raw`tr("\u{0053}ave"); tr('Save');`);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /1 untranslated strings/);
});

test("i18n checker ignores source-like text inside comments, strings and JSX text", async () => {
  const result = await check([
    '// tr("Not a call")',
    '/* trNodes("Not a key", {}) */',
    `const example = 'tr("Not a call")';`,
    'const view = <div>tr("Not a call")</div>;',
  ].join("\n"));
  assert.equal(result.status, 0, result.output);
});

test("i18n checker accepts member calls, rejects empty translations, and de-duplicates", async () => {
  const source = 'r.tr("Save"); i18n.trNodes("Save", {}); r.tr("End (menu)");';
  assert.equal((await check(source, { Save: "", "End (menu)": "" })).status, 1);
  const missing = await check('tr("Save"); tr("Save");');
  assert.match(missing.output, /1 untranslated strings/);
  assert.equal((await check(source, { Save: "保存", "End (menu)": "終了" })).status, 0);
});

test("i18n checker skips dynamically computed keys", async () => {
  const result = await check('tr(dynamicKey); tr(`Save ${value}`); tr(ok ? "Back" : "Next"); tr("Save");', { Save: "保存" });
  assert.equal(result.status, 0, result.output);
});

test("partial languages warn without failing, while strict mode fails", async () => {
  const source = 'tr("Save"); tr("Delete");';
  const partial = await check(source, { Save: "保存", Delete: "削除" }, ["fr"], { fr: { Save: "Enregistrer" } });
  assert.equal(partial.status, 0, partial.output);
  assert.match(partial.output, /WARNING: 1 untranslated strings for fr/);
  assert.match(partial.output, /"Delete"/);

  const strict = await check(source, { Save: "保存", Delete: "削除" }, ["--strict", "fr"], { fr: { Save: "Enregistrer" } });
  assert.equal(strict.status, 1, strict.output);
  assert.match(strict.output, /ERROR: 1 untranslated strings for fr/);

  const all = await check(source, { Save: "保存", Delete: "削除" }, ["--all"], { fr: { Save: "Enregistrer" } });
  assert.equal(all.status, 0, all.output);
  assert.match(all.output, /WARNING: 1 untranslated strings for fr/);
  assert.match(all.output, /All static strings are translated for ja/);
});

test("i18n checker accepts canonical region tags from the locale filename", async () => {
  const result = await check('tr("Save");', {}, ["--strict", "pt-BR"], { "pt-BR": { Save: "Salvar" } });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /All static strings are translated for pt-br/);
});

test("i18n checker audits static and conditional script-block phrases", async () => {
  const source = `const block = <><Phrase text="Wait {seconds} seconds" parts={{}} />
    <Phrase text={multiple ? "If {condition}" : "If {condition} then"} parts={{}} /></>;`;
  const result = await check(source, { "Wait {seconds} seconds": "{seconds}秒待つ" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /2 untranslated strings/);
  assert.match(result.output, /"If \{condition\} then"/);
});

test("English overrides are optional and unused ones are reported", async () => {
  const source = 'tr("{n} pages", { n }); tr("Close (menu)");';
  const none = await check(source, { "{n} pages": "{n}ページ", "Close (menu)": "閉じる" }, ["--strict", "en"]);
  assert.equal(none.status, 0, none.output);
  assert.match(none.output, /English is the source language/);

  const english = { "{n} pages": "{n, plural, one {# page} other {# pages}}", "Close (menu)": "Close" };
  const used = await check(source, {}, ["--strict", "en"], { en: english });
  assert.equal(used.status, 0, used.output);
  assert.match(used.output, /All English overrides are used in the source \(2 entries\)/);

  const stale = { ...english, "Old wording": "Old" };
  const warned = await check(source, {}, ["en"], { en: stale });
  assert.equal(warned.status, 0, warned.output);
  assert.match(warned.output, /"Old wording"/);
  assert.match(warned.output, /WARNING: 1 English overrides are not used/);
  assert.equal((await check(source, {}, ["--strict", "en"], { en: stale })).status, 1);
});
