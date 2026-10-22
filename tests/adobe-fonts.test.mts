import assert from "node:assert/strict";
import { test } from "node:test";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { usedAdobeFonts } from "../lib/generator/css";
import { adobeFontHead } from "../lib/generator/adobe-fonts";
import { generateExportProject } from "../lib/export-formats";
import { TOPICS } from "../lib/manualTopics";

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

test("Adobe Fonts help explains Web Project creation, ID lookup and font selection", () => {
  const topic = TOPICS.find((entry) => entry.id === "text-adobe-fonts");
  assert.ok(topic, "Adobe Fonts must have a dedicated help topic");
  assert.equal(topic.cat, "text");
  const steps = topic.body?.find((block) => "list" in block && block.ordered);
  assert.ok(steps && "list" in steps);
  assert.equal(steps.list.length, 4);
  assert.match(steps.list.join(" "), /Project ID/);
  assert.match(steps.list.join(" "), /Adobe Fonts/);
  const official = topic.body?.find((block) => "external" in block);
  assert.ok(official && "external" in official);
  assert.equal(official.external.url, "https://fonts.adobe.com/my_fonts#web_projects-section");
  const note = topic.body?.find((block) => "note" in block);
  assert.ok(note && "note" in note);
  assert.match(note.note, /adobeFonts\[\]\.kitId/);
  const warning = topic.body?.find((block) => "warn" in block);
  assert.ok(warning && "warn" in warning);
  assert.match(warning.warn, /expired/);
});

test("Google Fonts help links to the Adobe Fonts instructions", () => {
  const topic = TOPICS.find((entry) => entry.id === "text-font");
  assert.ok(topic);
  assert.ok(topic.see?.includes("text-adobe-fonts"));
});
