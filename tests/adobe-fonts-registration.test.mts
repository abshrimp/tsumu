import assert from "node:assert/strict";
import { test } from "node:test";
import { makeText } from "../lib/presets";
import { registerAdobeFont, removeAdobeWebProject } from "../lib/adobe-fonts-registration";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Adobe Project Removal", assets: {},
    pageOrder: ["p"],
    pages: { p: {
      id: "p", name: "Home", slug: "", title: "", description: "", children: ["a", "b", "c"],
      bodyStyles: { base: { default: { fontFamily: "poprumcute" } } },
    } },
    nodes: {
      a: { ...makeText("First"), id: "a", styles: {
        base: { default: { fontFamily: "poprumcute" } },
        sm: { hover: { fontFamily: "source-han-serif-japanese" } },
      } },
      b: { ...makeText("Second"), id: "b", styles: {
        base: { default: { fontFamily: "Lora" } },
      } },
      c: { ...makeText("Third"), id: "c", styles: {
        base: { default: { fontFamily: "acumin-pro" } },
      } },
    },
    adobeFonts: [
      { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" },
      { family: "source-han-serif-japanese", kitId: "jys5tkg", loading: "dynamic" },
      { family: "acumin-pro", kitId: "abc1234", loading: "css" },
    ],
  };
}

test("removing a Web Project deletes all its registered fonts and applied style references", () => {
  const doc = fixture();
  assert.equal(removeAdobeWebProject(doc, "jys5tkg"), 2);
  assert.deepEqual(doc.adobeFonts, [{ family: "acumin-pro", kitId: "abc1234", loading: "css" }]);
  assert.equal(doc.pages.p.bodyStyles?.base?.default?.fontFamily, undefined);
  assert.equal(doc.nodes.a.styles.base.default?.fontFamily, undefined);
  assert.equal(doc.nodes.a.styles.sm.hover?.fontFamily, undefined);
  assert.equal(doc.nodes.b.styles.base.default?.fontFamily, "Lora");
  assert.equal(doc.nodes.c.styles.base.default?.fontFamily, "acumin-pro");
});

test("removal of the last Web Project clears the optional registration field", () => {
  const doc = fixture();
  assert.equal(removeAdobeWebProject(doc, "jys5tkg"), 2);
  assert.equal(removeAdobeWebProject(doc, "abc1234"), 1);
  assert.equal(doc.adobeFonts, undefined);
  assert.equal(removeAdobeWebProject(doc, "notfound"), 0);
});

test("removing Adobe Fonts is one undoable editor change", () => {
  useEditor.getState().replaceDoc(fixture());
  const original = structuredClone(useEditor.getState().doc);
  useEditor.getState().updateDoc(doc => { removeAdobeWebProject(doc, "jys5tkg"); });
  const edited = structuredClone(useEditor.getState().doc);
  assert.equal(edited.adobeFonts?.length, 1);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, original);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, edited);
});

test("adding a dynamic family upgrades every font in its Web Project", () => {
  const doc = fixture();
  doc.adobeFonts = [
    { family: "acumin-pro", kitId: "jys5tkg", loading: "css" },
    { family: "other-kit-font", kitId: "abc1234", loading: "css" },
  ];
  registerAdobeFont(doc, { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" });
  assert.deepEqual(doc.adobeFonts, [
    { family: "acumin-pro", kitId: "jys5tkg", loading: "dynamic" },
    { family: "other-kit-font", kitId: "abc1234", loading: "css" },
    { family: "poprumcute", kitId: "jys5tkg", loading: "dynamic" },
  ]);
});

test("adding a CSS family to a dynamic Web Project preserves dynamic loading", () => {
  const doc = fixture();
  registerAdobeFont(doc, { family: "new-family", kitId: "jys5tkg", loading: "css" });
  assert.ok(doc.adobeFonts?.filter(font => font.kitId === "jys5tkg")
    .every(font => font.loading === "dynamic"));
  assert.ok(doc.adobeFonts?.some(font => font.family === "new-family" && font.loading === "dynamic"));
});
