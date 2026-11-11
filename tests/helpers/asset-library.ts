import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build, transformSync } from "esbuild";
import { useEditor } from "../../lib/store";
import * as assets from "../../lib/assets";
import type { SiteDoc } from "../../lib/types";

export function assetLibraryDoc(): SiteDoc {
  const dataUrl = "data:audio/wav;base64,b3JpZ2luYWw=";
  return {
    schemaVersion: 1, siteName: "Asset library", pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"], bodyStyles: { base: { default: { backgroundImage: `url("${dataUrl}")` } } } },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
    },
    assets: { embedded: { id: "embedded", name: "original.wav", dataUrl, width: 0, height: 0, mimeType: "audio/wav" } },
    nodes: { a: { id: "a", name: "Original", type: "media", semantic: "auto", text: null, link: null, media: { kind: "audio", src: "", assetId: "embedded" }, children: [], styles: { base: { default: { backgroundImage: `url("${dataUrl}")` } } } } },
  };
}

/** 実際のアセットタブとストアを使い、通信の完了順・再描画・終了だけを制御する。 */
export function assetLibraryCallbacks(upload = assets.uploadAsset, migrate = assets.uploadEmbeddedAsset) {
  const require = createRequire(resolve("package.json"));
  let cursor = 0;
  let effects: (() => void)[] = [];
  const cells: any[] = [];
  const hooks = {
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = { value: initial };
      return [cells[i].value, (value: any) => { cells[i].value = typeof value === "function" ? value(cells[i].value) : value; }];
    },
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useMemo(fn: () => unknown) { return fn(); },
    useEffect() {},
    useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const i = cursor++;
      if (!cells[i] || deps.some((dep, n) => !Object.is(dep, cells[i].deps[n]))) effects.push(() => {
        cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: effect() };
      });
    },
  };
  const path = "components/left-panel/AssetsTab.tsx";
  const code = transformSync(readFileSync(resolve(path), "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return hooks;
    if (name.endsWith("/store")) return { ...require(resolve("lib/store")), useEditor: Object.assign((select: (s: ReturnType<typeof useEditor.getState>) => unknown) => select(useEditor.getState()), { getState: useEditor.getState, subscribe: useEditor.subscribe }) };
    if (name.endsWith("/assets")) return { ...assets, uploadAsset: upload, uploadEmbeddedAsset: migrate };
    if (name.startsWith("@/")) return require(resolve(name.slice(2)));
    return name.startsWith(".") ? require(resolve(path, "..", name)) : require(name);
  }, module, module.exports);
  return {
    render() { cursor = 0; effects = []; const tree = module.exports.AssetsTab(); for (const effect of effects) effect(); return tree; },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

/** React StrictModeの実際のアセットタブとアップロード経路。通信のみE2Eで差し替える。 */
export async function assetLibraryBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
let AssetsTab;
let NumField, FillControl;
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(assetLibraryDoc())});
window.assetEditor = useEditor;
function Fixture() {
  const [visible, show] = useState(true);
  window.showAssets = show;
  const styles = useEditor((s) => s.doc.nodes.a?.styles.base?.default);
  return <><div id="controls"><NumField pre="W" value={styles?.width ?? "100px"} onChange={(value) => useEditor.getState().setStyleProps("a", { width: value })} /><FillControl value={styles?.backgroundColor ?? "#ff0000"} onChange={(value) => useEditor.getState().setStyleProps("a", { backgroundColor: value })} onChangeStart={() => useEditor.getState().beginGesture()} onChangeTransient={(value) => useEditor.getState().setStyleProps("a", { backgroundColor: value }, { transient: true })} /></div><button id="undo" onClick={() => useEditor.getState().undo()}>Undo</button><button id="redo" onClick={() => useEditor.getState().redo()}>Redo</button><div style={{ width: 320 }}>{visible && <AssetsTab />}</div></>;
}
void loadLocale().then(async () => {
  ({ AssetsTab } = await import("./components/left-panel/AssetsTab"));
    ({ NumField, FillControl } = await import("./components/controls"));
  createRoot(document.getElementById("app")).render(<React.StrictMode><Fixture /></React.StrictMode>);
});
`,
      loader: "tsx", sourcefile: "asset-library-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
