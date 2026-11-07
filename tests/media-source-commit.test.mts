import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { createInitialDoc, makeBox } from "../lib/presets";
import { CommitInput } from "../components/controls";

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
  if (String(tree.key).includes("-msrc-")) return tree;
  for (const child of React.Children.toArray(tree.props?.children)) {
    const found = findSource(child);
    if (found) return found;
  }
};
for (const kind of ["video", "audio"] as const) test(`${kind} source only commits deliberate edits and supports undo`, () => {
  const doc = createInitialDoc();
  const node = { ...makeBox(), id: "media", type: "media" as const, media: { kind, src: "/api/assets/file?path=movie", assetId: "movie", loop: true } };
  doc.nodes.media = node;
  doc.pages[doc.pageOrder[0]].children = [node.id];
  useEditor.getState().replaceDoc(doc);
  const field = findSource(mod.exports.default({ nodeId: "media" }));
  assert.ok(field);
  // CommitInput is covered by commit-fields.test.mts for idle blur, remote updates and history replay.
  field.props.onBlur?.({ target: { value: "" } });
  assert.deepEqual(useEditor.getState().doc.nodes.media.media, node.media, "untouched empty asset placeholder must preserve the selected asset");
  assert.equal(field.type, CommitInput);
  assert.equal(field.props.value, "");
  assert.equal(field.props.onBlur, undefined, "no unconditional blur write can detach the asset");
  field.props.onCommit(" https://example.test/media ");
  assert.deepEqual(useEditor.getState().doc.nodes.media.media, { kind, src: "https://example.test/media", assetId: undefined, loop: true });
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.nodes.media.media, node.media);
  useEditor.getState().redo();
  const changed = findSource(mod.exports.default({ nodeId: "media" }));
  assert.equal(changed.props.value, "https://example.test/media");
  changed.props.onCommit("");
  assert.equal(useEditor.getState().doc.nodes.media.media?.src, "");
});
