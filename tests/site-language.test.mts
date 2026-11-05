import assert from "node:assert/strict";
import { test } from "node:test";
import { generateProject } from "../lib/generator";
import { createInitialDoc } from "../lib/presets";
import { isSiteLang, pageLangOf, SITE_LANGS, siteLangOf } from "../lib/site-lang";
import { useEditor } from "../lib/store";

test("custom language codes use the same validation as existing saved documents", () => {
  for (const code of [...SITE_LANGS.map((lang) => lang.value), "en-US", "pt-BR", "zh-Hant-TW", "fil", "es-419"]) {
    assert.equal(isSiteLang(code), true, code);
  }
  for (const code of ["", " ", "en_US", "en--US", "English", "en US", '<script>', 'en"']) {
    assert.equal(isSiteLang(code), false, code);
  }
});

test("custom site and page languages survive editing, serialization and generated output", () => {
  useEditor.getState().replaceDoc(createInitialDoc());
  const pageId = useEditor.getState().doc.pageOrder[0];
  useEditor.getState().updateDoc((doc) => { doc.lang = "pt-BR"; doc.pwa = { enabled: true }; });
  useEditor.getState().updatePage(pageId, { lang: "en-US" });
  const doc = JSON.parse(JSON.stringify(useEditor.getState().doc));
  assert.equal(siteLangOf(doc), "pt-BR");
  assert.equal(pageLangOf(doc, doc.pages[pageId]), "en-US");
  const { files } = generateProject(doc);
  assert.match(files["app/layout.tsx"], /<html lang="pt-BR">/);
  assert.match(files["app/manifest.ts"], /"lang": "pt-BR"/);
  assert.match(files["app/page.tsx"], /lang="en-US"/);

  useEditor.getState().updatePage(pageId, { lang: undefined });
  const inherited = useEditor.getState().doc;
  assert.equal(pageLangOf(inherited, inherited.pages[pageId]), "pt-BR");
  assert.doesNotMatch(generateProject(inherited).files["app/page.tsx"], /lang=/);
});

test("existing custom codes keep their spelling and invalid values keep the existing fallback", () => {
  assert.equal(siteLangOf({ lang: "en-us" }), "en-us");
  assert.equal(pageLangOf({ lang: "pt-BR" }, { lang: "es-419" }), "es-419");
  assert.equal(siteLangOf({ lang: "not a language" }), "ja");
  assert.equal(pageLangOf({ lang: "pt-BR" }, { lang: "en_US" }), "pt-BR");
});
