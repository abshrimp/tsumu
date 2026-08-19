import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSiteCss } from "../lib/generator/css";
import { buildCanvasCss } from "../components/canvas/css";
import { makeBox } from "../lib/presets";
import type { SiteDoc, NodeStyles } from "../lib/types";
function css(styles: NodeStyles) {
  const doc: SiteDoc = { siteName: "Position", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["parent"] } },
    nodes: {
      parent: { ...makeBox(), id: "parent", children: ["child"], styles },
      child: { ...makeBox(), id: "child", styles: { base: { default: { position: "absolute", top: "0px" } } } },
    },
  };
  return {
    exported: generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map()),
    preview: buildCanvasCss(doc, ["parent"], "base", "preview", null, "default"),
  };
}
for (const position of ["relative", "absolute", "static", "fixed", "sticky"]) test(`narrow ${position} does not suppress desktop absolute-child containing block`, () => {
  const { exported, preview } = css({ sm: { default: { position } } });
  assert.match(preview, /position: relative/);
  const base = exported.slice(0, exported.indexOf("@media"));
  assert.match(base, /\.parent\s*\{[^}]*position: relative;/);
  assert.match(exported.slice(exported.indexOf("@media")), new RegExp(`position: ${position};`));
});
test("explicit base static remains intentional and is not replaced", () => {
  const { exported } = css({ base: { default: { position: "static" } }, sm: { default: { position: "relative" } } });
  assert.match(exported.slice(0, exported.indexOf("@media")), /\.parent\s*\{[^}]*position: static;/);
});
