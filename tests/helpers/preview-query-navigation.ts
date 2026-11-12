import { build, transformSync } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { queryDispatcherFile } from "../../lib/generator/page";
import { makeText } from "../../lib/presets";
import type { DocNode, Page, SiteDoc } from "../../lib/types";

export function previewQueryDoc(slug = "blog", queries = ["", "tab=news", "tab=news&lang=ja", "tab=archive"]): SiteDoc {
  const doc: SiteDoc = { schemaVersion: 1, siteName: "Preview query navigation", pages: {}, pageOrder: [], nodes: {}, assets: {} };
  const addPage = (id: string, path: string, query = "") => {
    doc.pages[id] = { id, name: id, title: id, description: "", slug: path, query, children: [] };
    doc.pageOrder.push(id);
    const text = { ...makeText(`Page ${id}`), id: `${id}-text` };
    doc.nodes[text.id] = text;
    doc.pages[id].children.push(text.id);
  };
  addPage("home", "");
  queries.forEach((q, i) => addPage(`variant${i}`, slug, q));
  addPage("missing", "404");
  for (const [id, url, scripted] of [
    ["news-link", `/${slug.replace("[slug]", "article")}?tab=news`, false],
    ["specific-button", `/${slug.replace("[slug]", "article")}?lang=ja&tab=news#section`, true],
    ["archive-link", `/${slug.replace("[slug]", "article")}?tab=archive`, false],
    ["default-link", `/${slug.replace("[slug]", "article")}?tab=unknown`, false],
  ] as const) {
    const n: DocNode = { ...makeText(id), id };
    if (scripted) {
      n.semantic = "button";
      n.scripts = [{ id: `${id}-script`, trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: `${id}-open`, kind: "open-url", url }] }];
    } else n.link = { kind: "url", url };
    for (const page of Object.values(doc.pages)) {
      const copy = structuredClone(n);
      copy.id = `${page.id}-${id}`;
      if (copy.scripts) {
        copy.scripts[0].id = `${copy.id}-script`;
        copy.scripts[0].steps[0].id = `${copy.id}-open`;
      }
      doc.nodes[copy.id] = copy;
      page.children.push(copy.id);
    }
  }
  return doc;
}

/** React で実際のフックとストアを実行する。純粋な移動の確認のため、effect は意図的に入れない。 */
export async function previewNavigationFixture() {
  const result = await build({
    stdin: { contents: `export { useCanvasData } from './components/canvas/useCanvasData'; export { useEditor } from './lib/store';`, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(resolve("package.json")), module, module.exports);
  const { useCanvasData, useEditor } = module.exports;
  return (doc: SiteDoc, url: string, activePageId = "home") => {
    useEditor.getState().replaceDoc(doc);
    useEditor.getState().setActivePage(activePageId);
    let data: any;
    function Harness() {
      data = useCanvasData({ page: doc.pages[activePageId], doc, activePageId, previewIndex: 0, mode: "design", setPreviewIndex: () => {} });
      return null;
    }
    renderToString(createElement(Harness));
    data.navigateTo(url);
    return useEditor.getState().activePageId as string;
  };
}

/** 選び方のアルゴリズムの別の写しではなく、実際に生成したルートの振り分けと比べる。 */
export async function publishedQueryPage(pages: Page[], url: string): Promise<string> {
  const module = { exports: {} as any };
  const code = transformSync(queryDispatcherFile(pages.map((p) => p.query)), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)(
    (name: string) => ({ __esModule: true, default: () => pages[Number(name.match(/p(\d+)$/)![1])].id }), module, module.exports,
  );
  const query: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(url, "https://preview.test").searchParams) {
    query[k] = k in query ? [...(Array.isArray(query[k]) ? query[k] as string[] : [query[k] as string]), v] : v;
  }
  const tree = await module.exports.default({ searchParams: Promise.resolve(query), params: Promise.resolve({}) });
  return tree;
}
