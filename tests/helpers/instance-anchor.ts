import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import { makeBox } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

const loadDependency = createRequire(resolve("package.json"));
export function anchorFixture(): SiteDoc {
  return {
    siteName: "Anchors", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["jump", "show", "first", "second"] } },
    components: { card: { id: "card", name: "Card", rootId: "root" } },
    nodes: {
      jump: { ...makeBox(), id: "jump", attrId: "jump", text: { content: "Jump", heading: 0 }, link: { kind: "url", url: "#first-card" } },
      show: { ...makeBox(), id: "show", attrId: "show", semantic: "button", text: { content: "Show", heading: 0 }, scripts: [{ id: "show-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: "show-step", kind: "show", target: "first-card" }] }] },
      first: { ...makeBox(), id: "first", type: "instance", componentId: "card", attrId: "first-card" },
      second: { ...makeBox(), id: "second", type: "instance", componentId: "card", attrId: "second-card" },
      root: { ...makeBox(), id: "root", semantic: "div", text: { content: "Card content", heading: 0 }, styles: { base: { default: { display: "none", flexDirection: "column" } } } },
    },
  };
}

/** ソースの文字列比較だけでなく、生成したReactコンポーネントを実行する。 */
export function renderAnchorExport(doc: SiteDoc) {
  const { files } = generateProject(doc);
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as { default: any } };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id.startsWith("@/components/")) return load(id.replace("@/", "") + ".tsx");
      if (id.startsWith("./")) return load("components/" + id.slice(2) + ".tsx");
      return loadDependency(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  };
  return { files, html: renderToStaticMarkup(createElement(load("app/page.tsx").default)), css: files["styles/site.css"] };
}
