import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build, transformSync } from "esbuild";
import * as store from "../../lib/store";
import { makeImage, makeMedia } from "../../lib/presets";
import type { Asset, SiteDoc } from "../../lib/types";

const require = createRequire(resolve("package.json"));
export const candidate: Asset = { id: "asset_candidate_a", name: "a.png", path: "assets/a.png", width: 10, height: 10 };
export const spare: Asset = { ...candidate, id: "asset_candidate_b", name: "b.png", path: "assets/b.png" };
export function assetConfirmationDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Asset confirmation", pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["image", "media"] } },
    assets: { [candidate.id]: { ...candidate }, [spare.id]: { ...spare } },
    nodes: {
      image: { ...makeImage(), id: "image", name: "Image", styles: {}, image: { src: "", alt: "", width: 10, height: 10 } },
      media: { ...makeMedia("video"), id: "media", name: "Media", styles: {} },
    },
  };
}

/** 実際のハンドラーとストアを使い、確認の完了と再描画の順序だけをテストで制御する。 */
export function assetConfirmationCallbacks() {
  let cursor = 0;
  let effects: (() => void)[] = [];
  const cells: any[] = [];
  const effect = (run: () => (() => void) | void, deps: unknown[]) => {
    const i = cursor++;
    if (!cells[i] || deps.some((v, j) => !Object.is(v, cells[i].deps[j]))) effects.push(() => {
      cells[i]?.cleanup?.();
      cells[i] = { deps, cleanup: run() };
    });
  };
  const hooks = {
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = { value: initial };
      return [cells[i].value, (value: unknown) => { cells[i].value = value; }];
    },
    useRef(initial: unknown) { const i = cursor++; return cells[i] ??= { current: initial }; },
    useMemo(compute: () => unknown) { return compute(); },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const path = resolve("components/left-panel/AssetsTab.tsx");
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return hooks;
    if (name.endsWith("/store")) return { ...store, useEditor: Object.assign((select: (s: ReturnType<typeof store.useEditor.getState>) => unknown) => select(store.useEditor.getState()), { getState: store.useEditor.getState }) };
    if (name.startsWith("@/")) return require(resolve(name.slice(2)));
    return name.startsWith(".") ? require(resolve(path, "..", name)) : require(name);
  }, module, module.exports);
  const elements = (tree: any): any[] => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
    ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
  return {
    render() {
      cursor = 0; effects = [];
      const tree = module.exports.AssetsTab();
      for (const run of effects) run();
      return elements(tree);
    },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

/** React・DialogHost・AssetsTab・削除APIの呼び出しをそのままブラウザで動かす。 */
export async function assetConfirmationBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssetsTab } from "./components/left-panel/AssetsTab";
import DialogHost from "./components/DialogHost";
import { useEditor } from "./lib/store";
useEditor.getState().replaceDoc(${JSON.stringify(assetConfirmationDoc())});
window.assetEditor = useEditor;
function App() {
  const [open, setOpen] = useState(true);
  window.closeAssetPanel = () => setOpen(false);
  return <>{open && <AssetsTab />}<DialogHost /></>;
}
createRoot(document.getElementById("app")).render(<React.StrictMode><App /></React.StrictMode>);
`,
      loader: "tsx", sourcefile: "asset-confirmation-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
