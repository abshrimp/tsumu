import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { createInitialDoc, makeBox } from "../lib/presets";
import { VarInput } from "../components/controls";

const require = createRequire(resolve("components/SettingsPanel.tsx"));
const mod = { exports: {} as any };
const source = transformSync(readFileSync("components/SettingsPanel.tsx", "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
new Function("require", "module", "exports", source)((id: string) => {
  if (id === "react") return { ...React, useState: (value: unknown) => [value, () => {}] };
  if (id === "../lib/store") return { ...require(id), useEditor: Object.assign((select: any) => select(useEditor.getState()), useEditor) };
  return require(id);
}, mod, mod.exports);
const findSource = (tree: any): any => {
  if (!tree || typeof tree !== "object") return undefined;
  if (String(tree.key).includes("-src-")) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = findSource(child);
    if (found) return found;
  }
};
for (const asset of [false, true]) test(`image source ${asset ? "preserves an untouched asset placeholder" : "can be cleared with undo and redo"}`, () => {
  const doc = createInitialDoc();
  const image = { src: asset ? "/api/assets/file?path=image" : "https://example.test/image.png", alt: "Keep alt", width: 40, height: 30,
    ...(asset ? { assetId: "image", assetSuffix: "#view" } : {}) };
  const node = { ...makeBox(), id: "image", type: "image" as const, image };
  doc.nodes.image = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  useEditor.getState().replaceDoc(doc);
  const field = findSource(mod.exports.default({ nodeId: "image" }));
  assert.ok(field);
  assert.equal(field.type, VarInput);
  field.props.onCommit("  ");
  if (asset) {
    assert.deepEqual(useEditor.getState().doc.nodes.image.image, image);
    assert.equal(useEditor.getState().past.length, 0);
  } else {
    assert.deepEqual(useEditor.getState().doc.nodes.image.image, { ...image, src: "", assetId: undefined, assetSuffix: undefined });
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc.nodes.image.image, image);
    useEditor.getState().redo();
    assert.equal(useEditor.getState().doc.nodes.image.image?.src, "");
  }
});
