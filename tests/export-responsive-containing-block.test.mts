import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSiteCss } from "../lib/generator/css";
import { buildCanvasCss } from "../components/canvas/css";
import { makeBox } from "../lib/presets";
import type { SiteDoc, NodeStyles } from "../lib/types";
function fixture(child: NodeStyles, parent: NodeStyles = {}) {
  const doc: SiteDoc = { siteName: "Position", assets: {}, pageOrder: [], pages: {}, nodes: {
    parent: { ...makeBox(), id: "parent", children: ["child"], styles: parent },
    child: { ...makeBox(), id: "child", styles: child },
  } };
  const exported = generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map());
  const at = exported.indexOf("@media");
  return { doc, exported, base: at < 0 ? exported : exported.slice(0, at), media: at < 0 ? "" : exported.slice(at) };
}
test("a mobile-only absolute child does not position its parent on desktop", () => {
  const { doc, base, media } = fixture({ sm: { default: { position: "absolute" } } });
  assert.doesNotMatch(buildCanvasCss(doc, ["parent"], "base", "preview", null, "default"), /position: relative/);
  assert.doesNotMatch(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  assert.match(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
});
test("automatic containing block ends when its last absolute child becomes static", () => {
  const { doc, base, media } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } });
  assert.doesNotMatch(buildCanvasCss(doc, ["parent"], "sm", "preview", null, "default"), /position: relative/);
  assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  assert.match(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
});
test("authored containing block remains when a child stops being absolute", () => {
  const { base, media } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } }, { base: { default: { position: "relative" } } });
  assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  assert.doesNotMatch(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
});
test("explicit static parent prevents automatic positioning at every breakpoint", () => {
  const { base, media } = fixture({ sm: { default: { position: "absolute" } } }, { base: { default: { position: "static" } } });
  assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
  assert.doesNotMatch(base + media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
});

test("custom CSS positioning is not overwritten by inferred media rules", () => {
  const { doc } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } });
  doc.nodes.parent.customCss = "position: absolute; top: 20px";
  const exported = generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map());
  assert.match(exported, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: absolute/);
  assert.doesNotMatch(exported, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: (relative|static)/);
});
