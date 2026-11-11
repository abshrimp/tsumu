import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssetNames, buildClassNames, buildComponentNames } from "../lib/generator/names";
import type { SiteDoc } from "../lib/types";

function fixture(names: string[]): SiteDoc {
  return {
    siteName: "Names", pages: {}, pageOrder: [],
    nodes: Object.fromEntries(names.map((name, i) => [String(i), {
      id: String(i), name, type: "box", semantic: "div", children: [], styles: {},
    }])),
    assets: Object.fromEntries(names.map((name, i) => [String(i), {
      id: String(i), name, width: 1, height: 1,
    }])),
    components: Object.fromEntries(names.map((name, i) => [String(i), {
      id: String(i), name, rootId: String(i),
    }])),
  };
}

test("class names preserve ordered collisions with authored numeric suffixes", () => {
  const names = ["Box", "Box", "Box-2", "BOX", "Box-3", "Box", "ボックス", "Box-4", "Box"];
  const doc = fixture(names), before = structuredClone(doc);
  assert.deepEqual([...buildClassNames(doc).values()], [
    "box", "box-2", "box-2-2", "box-3", "box-3-2", "box-4", "box-5", "box-4-2", "box-6",
  ]);
  assert.deepEqual(doc, before);
});

test("asset names preserve case, extensions and authored suffix collisions", () => {
  assert.deepEqual([...buildAssetNames(fixture([
    "logo.png", "LOGO.png", "logo-2.png", "logo.png", "logo.PNG", "logo-3.PNG", "logo.jpg",
  ])).values()], [
    "logo.png", "LOGO-2.png", "logo-2-2.png", "logo-3.png", "logo-4.PNG", "logo-3-2.PNG", "logo.jpg",
  ]);
});

test("component names preserve reserved names and numeric suffix precedence", () => {
  assert.deepEqual([...buildComponentNames(fixture([
    "Hero", "Hero", "Hero2", "HERO", "Hero3", "Hero", "Image", "Image", "Image2", "CON", "con", "Con2",
  ])).values()], [
    "Hero", "Hero2", "Hero22", "HERO3", "Hero32", "Hero4", "Image2", "Image3", "Image22", "CON2", "Con3", "Con22",
  ]);
});

test("document-size repeated labels receive distinct readable output names", () => {
  const doc = fixture(Array<string>(25000).fill("ボックス"));
  const classes = buildClassNames(doc);
  assert.equal(classes.size, 25000);
  assert.equal(new Set(classes.values()).size, 25000);
  assert.equal(classes.get("0"), "box");
  assert.equal(classes.get("24999"), "box-25000");
  const assets = buildAssetNames(fixture(Array<string>(1000).fill("logo.png")));
  assert.equal(new Set(assets.values()).size, 1000);
  assert.equal(assets.get("999"), "logo-1000.png");
  const components = buildComponentNames(fixture(Array<string>(1000).fill("Hero")));
  assert.equal(new Set(components.values()).size, 1000);
  assert.equal(components.get("999"), "Hero1000");
});
