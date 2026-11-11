import { build, transformSync } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeText } from "../../lib/presets";
import { generateProject } from "../../lib/generator";
import type { SiteDoc } from "../../lib/types";
import { nestedScopeDoc, nestedScopeItems } from "./nested-script-scope";

export function componentListDoc() {
  const doc = nestedScopeDoc();
  doc.siteName = "Component list conversion";
  doc.pages.p.children = ["products"];
  doc.nodes.card.name = "Product card";
  delete doc.nodes.other;
  doc.nodes.name.attrId = "product-name";
  doc.nodes.card.children.unshift("hide-product");
  doc.nodes["hide-product"] = { ...makeText("Hide {name}"), id: "hide-product", semantic: "button", scripts: [{
    id: "hide-product-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: "hide-product-step", kind: "hide", target: "product-name" }],
  }] };
  return doc;
}

/** 設定画面から変換し、実際のキャンバスで元に戻す・やり直す・保存後の再読み込みを確かめる。 */
export async function componentListBundle(doc = componentListDoc(), selectedNode = "card") {
  return (await build({ stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";


import { useEditor } from "./lib/store";
import css from "./app/globals.css";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: SettingsPanel } = await import("./components/SettingsPanel");
  const { default: Canvas } = await import("./components/Canvas");
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
useEditor.getState().setActivePage("p"); useEditor.getState().select(${JSON.stringify(selectedNode)});
window.componentListStore = useEditor;
function Example() {
  const selected = useEditor(s => s.selection), mode = useEditor(s => s.mode);
  return <><button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <button onClick={() => useEditor.getState().undo()}>Undo</button>
    <button onClick={() => useEditor.getState().redo()}>Redo</button>
    <button onClick={() => useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)))}>Reload saved</button>
    <aside>{selected && <SettingsPanel nodeId={selected} />}</aside><Canvas />
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);

});
`, resolveDir: resolve("."), sourcefile: "component-list-export-browser.tsx", loader: "tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** 生成したページと部品を実行する。データ取得だけを固定し、描画処理は置き換えない。 */
export async function publishedComponentList(doc: SiteDoc, page = "app/page.tsx", items: readonly unknown[] = nestedScopeItems) {
  const { files } = generateProject(doc), require = createRequire(resolve("package.json")), cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    cache.set(file, mod.exports);
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "@/lib/safe-fetch") return { fetchPublic: async () => Response.json(items), readTextLimited: (res: Response) => res.text() };
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      if (id.startsWith("@/components/")) return load(id.replace("@/", "") + ".tsx");
      if (id.startsWith("./")) return load("components/" + id.slice(2) + ".tsx");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  };
  // 生成サイトの設定をローカルな Context に渡す。ホストの既定値は変更しない。
  const config = { exports: {} as any };
  new Function("module", "exports", transformSync(files["next.config.mjs"], { format: "cjs" }).code)(config, config.exports);
  const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
  const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
  return renderToStaticMarkup(createElement(ImageConfigContext.Provider, {
    value: { ...imageConfigDefault, ...config.exports.default.images },
  }, await load(page).default({ searchParams: Promise.resolve({}) })));
}
