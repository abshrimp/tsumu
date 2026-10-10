import assert from "node:assert/strict";
import { test } from "node:test";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { usedAdobeFonts } from "../lib/generator/css";
import { adobeFontHead } from "../lib/generator/adobe-fonts";
import { generateExportProject } from "../lib/export-formats";

function fixture() {
  const doc: SiteDoc = {
    schemaVersion: 1,
    siteName: "Adobe Fonts",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["adobeText"],
      },
    },
    nodes: {
      adobeText: {
        ...makeText("Font preview"),
        id: "adobeText",
        styles: { base: { default: { fontFamily: "acumin-pro" } } },
      },
    },
    assets: {},
  };
  doc.adobeFonts = [
    { family: "acumin-pro", kitId: "abc1234", loading: "css" },
    { family: "source-han-sans-japanese", kitId: "def5678", loading: "dynamic" },
  ];
  return doc;
}

test("Adobe Fonts are only embedded when referenced by node or body styles", () => {
  const doc = fixture();
  assert.deepEqual(usedAdobeFonts(doc).map(font => font.family), ["acumin-pro"]);
  assert.match(adobeFontHead(doc), /https:\/\/use\.typekit\.net\/abc1234\.css/);
  assert.doesNotMatch(adobeFontHead(doc), /def5678/);
  doc.pages[doc.pageOrder[0]].bodyStyles = { base: { default: { fontFamily: "source-han-sans-japanese" } } };
  assert.match(adobeFontHead(doc), /use\.typekit\.net\/def5678\.js/);
  assert.match(adobeFontHead(doc), /Typekit\.load/);
});

test("all export targets carry the correct Adobe CSS and dynamic embed", () => {
  const doc = fixture();
  doc.nodes.adobeText.styles.base.default!.fontFamily = "source-han-sans-japanese";
  doc.pages[doc.pageOrder[0]].bodyStyles = { base: { default: { fontFamily: "acumin-pro" } } };
  for (const framework of ["nextjs", "html", "single-html", "react", "vue", "nuxt", "sveltekit"] as const) {
    const generated = generateExportProject(doc, framework);
    const content = Object.values(generated.files).join("\n");
    assert.match(content, /use\.typekit\.net\/abc1234\.css/, framework);
    assert.match(content, /use\.typekit\.net\/def5678\.js/, framework);
    assert.match(content, /source-han-sans-japanese/, framework);
    assert.doesNotMatch(content, /use\.typekit\.net\/abc1234\.js/, framework);
  }
});

test("unused Adobe projects are omitted from exported files", () => {
  const doc = fixture();
  doc.nodes.adobeText.styles.base.default!.fontFamily = "system-ui";
  const content = Object.values(generateExportProject(doc, "html").files).join("\n");
  assert.doesNotMatch(content, /use\.typekit\.net/);
});
