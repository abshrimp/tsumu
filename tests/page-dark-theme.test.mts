import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { getProp, clearedValue, resolveStyles, resolveThemeStyleMap, applyBreakpoints } from "../lib/style";
import { buildCanvasCss, previewHtmlWithBodyStyles } from "../components/canvas/css";
import { generateSiteCss, rawHtmlWithBodyStyles } from "../lib/generator/css";
import { buildClassNames } from "../lib/generator/names";
import { canvasMoveDoc } from "./helpers/canvas-move";

test("light styles remain the fallback until a dark value is explicitly edited", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  const node = doc.nodes.a;
  node.styles = {
    base: { default: { color: "#111111", backgroundColor: "#ffffff" }, hover: { color: "#222222" } },
    sm: { default: { fontSize: "13px" } },
  };
  assert.equal(resolveStyles(node, "base", "default", "dark").color, "#111111");
  node.darkStyles = {
    base: { default: { color: "#eeeeee" }, hover: { color: "#cccccc" } },
    sm: { default: { backgroundColor: "#202020" } },
  };
  assert.deepEqual(resolveStyles(node, "base", "default", "light"), {
    color: "#111111", backgroundColor: "#ffffff",
  });
  assert.deepEqual(resolveStyles(node, "base", "default", "dark"), {
    backgroundColor: "#ffffff", color: "#eeeeee",
  });
  assert.equal(resolveStyles(node, "sm", "default", "dark").backgroundColor, "#202020");
  assert.equal(resolveStyles(node, "sm", "default", "dark").fontSize, "13px");
  assert.equal(resolveStyles(node, "sm", "hover", "light").color, "#222222");
  assert.equal(resolveStyles(node, "sm", "hover", "dark").color, "#cccccc");
  assert.equal(getProp(node, "base", "default", "color", undefined, "light").setHere, true);
  assert.equal(getProp(node, "base", "default", "color", undefined, "dark").setHere, true);
  assert.equal(getProp(node, "sm", "default", "fontSize", undefined, "dark").setHere, false);
  assert.equal(clearedValue(node, "sm", "default", "backgroundColor", "dark"), null);
});

test("dark page style preview remains separate from the light canvas and HTML page", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  const page = doc.pages.p;
  doc.nodes.a.styles = { base: { default: { color: "#111111" } } };
  doc.nodes.a.darkStyles = { base: { default: { color: "#eeeeee" } } };
  page.bodyStyles = { base: { default: { backgroundColor: "white" } } };
  page.bodyDarkStyles = { base: { default: { backgroundColor: "#101010" } } };
  const view = (theme: "light" | "dark") => buildCanvasCss(
    doc, ["a"], "base", "preview", null, "default", page.bodyStyles, undefined, theme, page.bodyDarkStyles
  );
  assert.match(view("light"), /color: #111111;/);
  assert.doesNotMatch(view("light"), /#eeeeee|#101010/);
  assert.match(view("dark"), /color: #eeeeee;/);
  assert.match(view("dark"), /background-color: #101010;/);
  const html = "<html><head></head><body><p>Hello</p></body></html>";
  const lightHtml = previewHtmlWithBodyStyles(html, page.bodyStyles, "base", "light", page.bodyDarkStyles);
  const darkHtml = previewHtmlWithBodyStyles(html, page.bodyStyles, "base", "dark", page.bodyDarkStyles);
  assert.match(lightHtml, /background-color: white;/);
  assert.doesNotMatch(lightHtml, /#101010/);
  assert.match(darkHtml, /background-color: #101010;/);
  assert.match(darkHtml, /color-scheme: dark/);
});

test("published CSS uses the OS dark-mode preference and preserves responsive overrides", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  doc.nodes.a.styles = { base: { default: { color: "#111111" } } };
  doc.nodes.a.darkStyles = {
    base: { default: { color: "#eeeeee" }, hover: { color: "#dddddd" } },
    sm: { default: { color: "#bbbbbb" } },
  };
  doc.pages.p.bodyDarkStyles = { base: { default: { backgroundColor: "#101010" } } };
  const css = generateSiteCss(doc, buildClassNames(doc), new Map());
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /background-color: #101010;/);
  assert.match(css, /color: #eeeeee;/);
  assert.match(css, /:hover \{\n[^}]*color: #dddddd;/);
  assert.match(css, /@media \(max-width: 478px\)/);
  assert.match(css, /color: #bbbbbb;/);
  const rawHtml = rawHtmlWithBodyStyles(doc, doc.pages.p,
    "<html><head></head><body>Page</body></html>", new Map(), "production");
  assert.match(rawHtml, /prefers-color-scheme: dark/);
  assert.match(rawHtml, /background-color: #101010;/);
});

test("documents accept valid dark styles and reject malformed dark style maps", () => {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes)[0]!;
  const page = doc.pages[doc.pageOrder[0]];
  node.darkStyles = { base: { default: { color: "#ffffff" } } };
  page.bodyDarkStyles = { base: { default: { backgroundColor: "#181818" } } };
  assert.equal(validSiteDoc(doc), true);
  const invalidNode = structuredClone(doc);
  (Object.values(invalidNode.nodes)[0]!.darkStyles as unknown as Record<string, unknown>).base =
    { default: { color: 5 } };
  assert.equal(validSiteDoc(invalidNode), false);
  const invalidBody = structuredClone(doc);
  (invalidBody.pages[invalidBody.pageOrder[0]].bodyDarkStyles as unknown as Record<string, unknown>).base =
    { default: { backgroundColor: null } };
  assert.equal(validSiteDoc(invalidBody), false);
});


test("dark-only absolute positioning gives the parent the same containing block in export", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  doc.nodes.a.children = ["b"];
  doc.pages.p.children = ["a", "c"];
  doc.nodes.a.styles = {};
  doc.nodes.b.styles = {};
  doc.nodes.b.darkStyles = { base: { default: { position: "absolute" } } };
  const classNames = buildClassNames(doc);
  const lightCss = generateSiteCss(canvasMoveDoc(), buildClassNames(canvasMoveDoc()), new Map());
  assert.doesNotMatch(lightCss, /prefers-color-scheme: dark/);
  const css = generateSiteCss(doc, classNames, new Map());
  const darkSection = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(darkSection, new RegExp("\\." + classNames.get("a") + " \\{[^}]*position: relative;"));
});

test("legacy light-only documents do not emit dark media styles", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  const css = generateSiteCss(doc, buildClassNames(doc), new Map());
  assert.doesNotMatch(css, /prefers-color-scheme: dark/);
  assert.deepEqual(resolveThemeStyleMap(undefined, undefined, "base", "default", "dark"), {});
});
