import { build, transformSync } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import { makeBox, makeText } from "../../lib/presets";
import type { DocNode, SiteDoc } from "../../lib/types";

/** ラジオボタンの値になるラベルを、クエリか JSON から差し込む。 */
export function previewDynamicRadioDoc(source: "query" | "data" | "literal" = "query"): SiteDoc {
  const prefix = source === "data" ? "response." : "";
  const radio = (id: string, label: string, checked = false): DocNode => ({
    ...makeBox(), id, attrId: id, type: "field", field: { kind: "radio", label, group: "size", checked },
  });
  const sequence = (id: string, assignments: [string, string][]): DocNode => ({
    ...makeText(id), id, semantic: "button", scripts: [{
      id: `${id}-script`, trigger: "click", pos: { x: 0, y: 0 },
      steps: assignments.map(([target, value], index) => ({ id: `${id}-set-${index}`, kind: "set-value", target, value })),
    }],
  });
  const button = (id: string, target: string, value: string) => sequence(id, [[target, value]]);
  const small = source === "literal" ? "S" : `{${prefix}smallLabel}`;
  const medium = source === "literal" ? "M" : `{${prefix}mediumLabel}`;
  const nodes = [
    radio("small", small),
    radio("medium", medium, true),
    radio("large", "L"),
    { ...makeBox(), id: "refresh", type: "field" as const, field: { kind: "submit" as const, label: "Reload labels" } },
    button("select-small", "small", "true"),
    button("clear-small", "small", "false"),
    button("select-medium", "size", medium),
    button("clear-medium", "medium", "false"),
    button("select-large", "large", "true"),
    button("clear-large", "large", "false"),
    button("clear-group", "size", ""),
    sequence("select-clear-small", [["small", "true"], ["small", "false"]]),
    sequence("clear-select-small", [["small", "false"], ["small", "true"]]),
    sequence("small-medium", [["small", "true"], ["medium", "true"]]),
    sequence("medium-small", [["medium", "true"], ["small", "true"]]),
    sequence("small-medium-clear", [["small", "true"], ["medium", "true"], ["medium", "false"]]),
    sequence("small-medium-clear-small", [["small", "true"], ["medium", "true"], ["small", "false"]]),
    sequence("group-small-clear", [["size", medium], ["small", "true"], ["small", "false"]]),
    sequence("small-group-clear", [["small", "true"], ["size", ""]]),
    { ...makeText("size={size}; small={small}; medium={medium}; large={large}; index={size.index}"), id: "result" },
  ];
  return {
    schemaVersion: 1, siteName: "Preview dynamic radio", assets: {}, pageOrder: ["home"],
    pages: { home: {
      id: "home", name: "Home", title: "Home", description: "", slug: "",
      query: source === "query" ? "smallLabel=S&mediumLabel=M" : "",
      children: nodes.map((node) => node.id),
      ...(source === "data" ? { pageScripts: [{
        id: "load", trigger: "load" as const, pos: { x: 0, y: 0 }, steps: [{
          id: "fetch", kind: "fetch" as const, url: "https://example.test/sizes", as: "response",
          preview: { sample: { smallLabel: "S", mediumLabel: "M" } },
        }],
      }] } : {}),
    } },
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  };
}

/** 実際の Canvas と store を使い、プレビュー中の変更が、保存する文書や履歴を汚さないかも確かめる。 */
export async function previewDynamicRadioBundle(source: "query" | "data" | "literal") {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";

import { useEditor } from "./lib/store";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: Canvas } = await import("./components/Canvas");
useEditor.getState().replaceDoc(${JSON.stringify(previewDynamicRadioDoc(source))});
useEditor.getState().setMode("preview");
window.radioEditor = useEditor;
createRoot(document.getElementById("app")).render(<Canvas />);

});
`, loader: "tsx", sourcefile: "preview-dynamic-radio-browser.tsx", resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** 公開用の React のページを実行する。取得する JSON だけを置き換え、外部へは通信しない。 */
export async function publishedDynamicRadio(source: "query" | "data", labels = { smallLabel: "S", mediumLabel: "M" }) {
  const doc = previewDynamicRadioDoc(source);
  const { files } = generateProject(doc);
  const require = createRequire(resolve("package.json"));
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "@/lib/safe-fetch") return {
        fetchPublic: async () => new Response(JSON.stringify(labels)),
        readTextLimited: async (response: Response) => response.text(),
      };
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  };
  const tree = await load("app/page.tsx").default({ searchParams: Promise.resolve(labels) });
  return { doc, html: renderToStaticMarkup(tree) };
}
