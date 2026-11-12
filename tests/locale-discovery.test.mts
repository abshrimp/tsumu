import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { generateLocaleSources } from "../scripts/sync-locales.mjs";
import { LANGUAGES, isLang, pickLang } from "../lib/lang";
import { LOCALES } from "../lib/locales";
import { translate } from "../lib/i18n";

const localeDir = fileURLToPath(new URL("../lib/locales/", import.meta.url));

test("generated language list and lazy dictionary imports match locale files", () => {
  const generated = generateLocaleSources(readdirSync(localeDir));
  assert.equal(readFileSync(localeDir + "languages.generated.ts", "utf8"), generated.languagesSource);
  assert.equal(readFileSync(localeDir + "loaders.generated.ts", "utf8"), generated.loadersSource);
  assert.equal(LANGUAGES.ja.label, "日本語");
  assert.equal(LANGUAGES.en.label, "English");
  assert.equal(typeof LOCALES.ja, "function");
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
  assert.throws(() => generateLocaleSources(["ja.ts", "en.ts"]), /English source language/);
  assert.throws(() => generateLocaleSources(["ja.ts", "fr.ts", "FR.ts"]), /Duplicate locale code/);
  assert.throws(() => generateLocaleSources(["ja.ts", "notes.ts"]), /Invalid locale filename/);
});

test("missing translations fall back to the English source text", () => {
  assert.equal(translate("ja", [{ Save: "保存" }], "Save"), "保存");
  assert.equal(translate("ja", [{ Save: "保存" }], "Not yet translated"), "Not yet translated");
  assert.equal(translate("ja", [{ Save: "" }], "Save"), "Save");
});
