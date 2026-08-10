import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

function fixture() {
  const path = resolve("components/ImagePicker.tsx"), require = createRequire(path);
  let query = "", assets: any = {};
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code)(
    (id: string) => id === "react" ? { useState: () => [query, (v: string) => { query = v; }], useRef: () => ({ current: null }) } :
      id === "../lib/assets" ? { assetKind: () => "image", assetSrc: (a: any) => a.url } :
      id === "../lib/store" ? { useEditor: (select: any) => select({ doc: { assets } }) } :
      id === "../lib/use-pending-import" ? { usePendingImport: () => ({ busy: false, cancel() {} }) } : require(id), mod, mod.exports);
  const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
  return {
    input: (editTarget: string) => flatten(mod.exports.default({ editTarget, value: { url: "/same.png" }, onChange() {} })).find(x => x.type === "input"),
    grid: () => flatten(mod.exports.AssetGrid({ kind: "image", onPick() {} })),
    setAssets: (count: number) => { assets = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), { id: String(i), name: `photo${i}.png`, mimeType: "image/png", url: "/image.png" }])); },
  };
}
test("image URL drafts have separate React identities for different edit targets", () => {
  const f = fixture();
  assert.notEqual(f.input("page-a").key, f.input("page-b").key);
  assert.equal(f.input("page-a").props.defaultValue, "/same.png");
});
test("asset search remains clearable when deletion reduces the library below five items", () => {
  const f = fixture(); f.setAssets(5);
  f.grid().find(x => x.type === "input").props.onChange({ target: { value: "missing" } });
  f.setAssets(3);
  const input = f.grid().find(x => x.type === "input");
  assert.ok(input); assert.equal(input.props.value, "missing");
  f.grid().find(x => x.type === "button" && x.props["aria-label"] === "検索をクリア").props.onClick();
  assert.equal(f.grid().filter(x => x.type === "button" && x.props.className === "img-pick-cell").length, 3);
});
