import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { generateLocaleSources } from "../scripts/sync-locales.mjs";
import { LANGUAGES, isLang, pickLang } from "../lib/lang";
import { LOCALES } from "../lib/locales";
import { format, loadDicts, translate, type Catalog } from "../lib/i18n";

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
