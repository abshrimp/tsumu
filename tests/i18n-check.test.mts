import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test, describe } from "node:test";
import { checkTranslations } from "../scripts/i18n-check.mts";
import { EXPORT_FRAMEWORK_OPTIONS } from "../lib/generator/export-options";
import { LOCALES } from "../lib/locales";
import { langOfRequest, parseAcceptLanguage, LANGUAGES, isLang, pickLang } from "../lib/lang";
import ts from "@typescript/typescript6";
import { generateLocaleSources } from "../scripts/sync-locales.mjs";
import { format, loadDicts, translate, type Catalog } from "../lib/i18n";

describe("i18n-check", () => {
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
});

describe("export-format-labels", () => {
  // 動的な形式の表示名は、静的な i18n の点検では見えない。
  test("all export format labels are English source text with Japanese translations", async () => {
    const ja = await LOCALES.ja!();
    for (const { label } of EXPORT_FRAMEWORK_OPTIONS) {
      assert.doesNotMatch(label, /[぀-ヿ㐀-鿿]/, label);
    }
    assert.equal(ja["Single HTML"], "単一のHTML");
  });
});

describe("help-labels", () => {
  test("Japanese help search terms keep their own keys and translations", async () => {
    const ja = await LOCALES.ja!();
    for (const [label, expected, term] of [
      ["Link", "リンク", "link"],
      ["Fetch data", "データ取得", "fetch data"],
      ["Paragraph", "文章", "text"],
    ]) {
      assert.equal(ja[label], expected);
      assert.equal(ja[term + " (help search)"], expected);
    }
  });
});

describe("request-language", () => {
  test("request language excludes explicitly refused and invalid preferences", () => {
    assert.deepEqual(parseAcceptLanguage("fr, ja;q=0, en;q=0.5"), ["fr", "en"]);
    assert.equal(langOfRequest(new Request("https://example.test", { headers: { "accept-language": "fr, ja;q=0" } })), "en");
    assert.deepEqual(parseAcceptLanguage("ja;q=broken, en;q=0.5"), ["en"]);
    assert.deepEqual(parseAcceptLanguage("ja;q=-1, en;q=0.5"), ["en"]);
    assert.deepEqual(parseAcceptLanguage("ja;q=2, en;q=0.5"), ["en"]);
  });

  test("request language retains positive preference order and explicit cookie", () => {
    assert.deepEqual(parseAcceptLanguage("en;q=0.8, ja;q=0.8, fr;q=0.9"), ["fr", "en", "ja"]);
    assert.equal(langOfRequest(new Request("https://example.test", { headers: { "accept-language": "en-US;q=0.7, ja;q=0.8" } })), "ja");
    assert.equal(langOfRequest(new Request("https://example.test", { headers: { cookie: "tsumu-lang=ja", "accept-language": "en, ja;q=0" } })), "ja");
  });
});

describe("font-picker-i18n", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));

  function source(path: string) {
    const text = readFileSync(root + path, "utf8");
    return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  }

  function translatedKeys(node: ts.Node): Set<string> {
    const keys = new Set<string>();
    function visit(child: ts.Node): void {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) &&
          child.expression.text === "tr" && child.arguments.length > 0 &&
          ts.isStringLiteralLike(child.arguments[0])) {
        keys.add(child.arguments[0].text);
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    return keys;
  }

  /** Read literal translations from the source AST to avoid ESM/CJS default-import wrappers. */
  const ja = new Map<string, string>();
  for (const statement of source("lib/locales/ja.ts").statements) {
    function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) &&
          ts.isStringLiteralLike(node.initializer)) {
        ja.set(node.name.text, node.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(statement);
  }

  function assertAllTranslated(keys: ReadonlySet<string>): void {
    const missing = [...keys].filter(key => !ja.get(key)?.trim());
    assert.deepEqual(missing, [], "Japanese translations missing for user-facing font strings");
  }

  test("font-add modal translations cover all static tr() strings", () => {
    const component = source("components/style-panel/FontPicker.tsx");
    const keys = translatedKeys(component);
    assert.ok(keys.size >= 35, "unexpectedly few font modal strings checked");
    assertAllTranslated(keys);
  });

  test("Google Fonts categories are displayed through the translation function", () => {
    const file = source("components/style-panel/FontPicker.tsx").getFullText();
    const names = ["Sans Serif", "Serif", "Display", "Handwriting", "Monospace"];
    for (const name of names) {
      assert.ok(file.includes(`>{tr("${name}")}</option>`), `Category must be localized: ${name}`);
      assert.ok(ja.get(name), `Category must have a Japanese value: ${name}`);
    }
  });

  test("Adobe Fonts help topic translations are complete", () => {
    const tree = source("lib/manual-topics/text.ts");
    let topic: ts.ObjectLiteralExpression | undefined;
    function visit(node: ts.Node) {
      if (ts.isObjectLiteralExpression(node) && node.properties.some(prop =>
        ts.isPropertyAssignment(prop) && prop.name.getText(tree) === "id" &&
        ts.isStringLiteralLike(prop.initializer) && prop.initializer.text === "text-adobe-fonts")) {
        topic = node;
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.ok(topic, "Adobe Fonts help topic missing");
    const keys = translatedKeys(topic);
    assert.ok(keys.size >= 10, "unexpectedly few Adobe help strings checked");
    assertAllTranslated(keys);
  });
});

describe("locale-discovery", () => {
  const localeDir = fileURLToPath(new URL("../lib/locales/", import.meta.url));

  test("generated language list and lazy dictionary imports match locale files", () => {
    const generated = generateLocaleSources(readdirSync(localeDir));
    assert.equal(readFileSync(localeDir + "languages.generated.ts", "utf8"), generated.languagesSource);
    assert.equal(readFileSync(localeDir + "loaders.generated.ts", "utf8"), generated.loadersSource);
    assert.equal(LANGUAGES.ja.label, "日本語");
    assert.equal(LANGUAGES.en.label, "English");
    assert.equal(typeof LOCALES.ja, "function");
    assert.equal(typeof LOCALES.en, "function");
    assert.equal(isLang("ja"), true);
    assert.equal(isLang("en"), true);
    assert.equal(pickLang(["ja-JP", "en-US"]), "ja");
    assert.equal(pickLang(["en-US"]), "en");
  });

  test("adding only a translation file registers its language and its on-demand loader", () => {
    const generated = generateLocaleSources(["ja.ts", "fr.ts", "pt-BR.ts"]);
    assert.match(generated.languagesSource, /"fr": \{ label: "Français" \}/);
    assert.match(generated.languagesSource, /"pt-br": \{ label: /);
    assert.match(generated.loadersSource, /"fr": \(\) => import\("\.\/fr"\)/);
    assert.match(generated.loadersSource, /"pt-br": \(\) => import\("\.\/pt-BR"\)/);
    assert.doesNotMatch(generated.loadersSource, /import\("\.\/en"\)/);
  });

  test("an optional en.ts is loaded for English without changing the language list", () => {
    const generated = generateLocaleSources(["ja.ts", "en.ts", "fr.ts"]);
    assert.match(generated.loadersSource, /"en": \(\) => import\("\.\/en"\)/);
    assert.match(generated.languagesSource, /"ja": \{ label: "日本語" \},\n  "en": \{ label: "English" \},\n  "fr": /);
    assert.equal(generated.languagesSource.match(/"en":/g)?.length, 1);
  });

  test("match browser preferences to the most specific registered locale", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "tsumu-locale-lookup-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "locales"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    const generated = generateLocaleSources(["ja.ts", "zh.ts", "zh-Hant.ts", "pt-BR.ts", "he.ts"]);
    writeFileSync(join(root, "locales", "languages.generated.ts"), generated.languagesSource);
    copyFileSync(new URL("../lib/lang.ts", import.meta.url), join(root, "lang.ts"));
    const { pickLang, langOfRequest } = await import(pathToFileURL(join(root, "lang.ts")).href);
    assert.equal(pickLang(["zh-Hant-TW", "en"]), "zh-hant");
    assert.equal(pickLang(["zh-Hans-CN"]), "zh");
    assert.equal(pickLang(["pt-BR-u-nu-latn"]), "pt-br");
    assert.equal(pickLang(["broken tag", "iw-IL"]), "he");
    assert.equal(langOfRequest(new Request("https://example.test", {
      headers: { "accept-language": "pt-BR-u-nu-latn, en;q=0.8" },
    })), "pt-br");
  });

  test("invalid and duplicate language files are rejected during discovery", () => {
    assert.throws(() => generateLocaleSources(["fr.ts"]), /ja\.ts is required/);
    assert.throws(() => generateLocaleSources(["ja.ts", "EN.ts"]), /en\.ts/);
    assert.throws(() => generateLocaleSources(["ja.ts", "fr.ts", "FR.ts"]), /Duplicate locale code/);
    assert.throws(() => generateLocaleSources(["ja.ts", "notes.ts"]), /Invalid locale filename/);
  });

  const ja = (messages: Record<string, string>): Catalog => ({ lang: "ja", messages });
  const en = (messages: Record<string, string>): Catalog => ({ lang: "en", messages });

  test("missing translations fall back to the English source text", () => {
    assert.equal(translate([ja({ Save: "保存" })], "Save"), "保存");
    assert.equal(translate([ja({ Save: "保存" })], "Not yet translated"), "Not yet translated");
    assert.equal(translate([ja({ Save: "" })], "Save"), "Save");
  });

  test("English overrides apply to English and act as the fallback for other languages", () => {
    const english = en({ "{n} pages": "{n, plural, one {# page} other {# pages}}", "Done (tutorial step)": "Done" });
    assert.equal(translate([english], "{n} pages", { n: 1 }), "1 page");
    assert.equal(translate([english], "{n} pages", { n: 3 }), "3 pages");
    assert.equal(translate([ja({ "{n} pages": "{n}ページ" }), english], "{n} pages", { n: 1 }), "1ページ");
    assert.equal(translate([ja({}), english], "{n} pages", { n: 1 }), "1 page");
    // 同じ英語でも、キーを分ければ、ほかの言語では別の訳にできる。
    const japanese = ja({ Done: "完了", "Done (tutorial step)": "操作完了" });
    assert.equal(translate([english], "Done"), "Done");
    assert.equal(translate([english], "Done (tutorial step)"), "Done");
    assert.equal(translate([japanese, english], "Done"), "完了");
    assert.equal(translate([japanese, english], "Done (tutorial step)"), "操作完了");
  });

  test("plural messages pick forms with the rules of the dictionary's language", () => {
    const message = "{n, plural, =0 {No files} one {# file} other {# files}}";
    assert.equal(format(message, { n: 0 }), "No files");
    assert.equal(format(message, { n: 1 }), "1 file");
    assert.equal(format(message, { n: 1.5 }), "1.5 files");
    assert.equal(format(message, { n: "2" }), "2 files");
    assert.equal(format(message, { n: "many" }), "many files");
    assert.equal(format("{n, plural, one {# zdjęcie} few {# zdjęcia} many {# zdjęć} other {# zdjęcia}}", { n: 5 }, "pl"), "5 zdjęć");
    // 日本語には単数形が無いので、英語の訳を日本語の規則で選ぶと other になる。
    assert.equal(translate([ja({ k: "{n, plural, one {one} other {other}}" })], "k", { n: 1 }), "other");
    assert.equal(
      format("{a, plural, one {# of them is {b, plural, one {# day} other {# days}} old} other {# of them are {b, plural, one {# day} other {# days}} old}} ({name})", { a: 1, b: 2, name: "x" }),
      "1 of them is 2 days old (x)"
    );
  });

  test("text that is not a complete plural message is shown as written", () => {
    assert.equal(format("{n, plural, one {# file}}", { n: 1 }), "{n, plural, one {# file}}");
    assert.equal(format("{n, plural, one {# file} other {# files}", { n: 1 }), "{n, plural, one {# file} other {# files}");
    assert.equal(format("{n, plural, one {# file} other {# files}}", { m: 1 }), "{n, plural, one {# file} other {# files}}");
    assert.equal(format("Use {ID} or {n}", { n: 2 }), "Use {ID} or 2");
  });

  test("every English override keeps the key's placeholders and has well-formed plurals", async () => {
    const [english] = await loadDicts("en");
    assert.equal(english?.lang, "en");
    const names = (s: string) => new Set([...s.matchAll(/\{(\w+)(?:\}|,\s*plural,)/g)].map((m) => m[1]));
    for (const [key, value] of Object.entries(english!.messages)) {
      const source = key;
      // 原文の差し込みはどれも残す。原文に無い差し込みは、下の表示で { } が残るので見つかる。
      for (const name of names(source)) assert.ok(names(value).has(name), `${key} lost {${name}}`);
      for (const n of [0, 1, 2, 1.5]) {
        const vars = Object.fromEntries([...names(source)].map((name) => [name, n]));
        const shown = format(value, vars, "en");
        assert.doesNotMatch(shown, /plural|[#{}]/, `${key} (${n}) → ${shown}`);
      }
    }
  });
});
