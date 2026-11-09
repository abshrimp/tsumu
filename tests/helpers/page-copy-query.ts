import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import { makeBox } from "../../lib/presets";
import type { Page, SiteDoc } from "../../lib/types";

const loadDependency = createRequire(resolve("package.json"));

export function queryCopyFixture() {
  const page = (id: string, slug: string, query?: string): Page => ({
    id, name: id, slug, query, title: id, description: "", children: [],
  });
  const source: SiteDoc = {
    schemaVersion: 1, siteName: "From", assets: {}, pageOrder: ["home", "source-news"],
    pages: {
      home: { ...page("home", ""), children: ["link", "button"] },
      "source-news": page("source-news", "blog", "tab=news"),
    },
    nodes: {
      link: {
        ...makeBox(), id: "link", attrId: "news-link", text: { content: "News link", heading: 0 },
        link: { kind: "page", pageId: "source-news" },
      },
      button: {
        ...makeBox(), id: "button", attrId: "news-button", semantic: "button",
        text: { content: "News script", heading: 0 },
        scripts: [{ id: "click", trigger: "click", pos: { x: 0, y: 0 }, steps: [
          { id: "open", kind: "open-page", pageId: "source-news" },
        ] }],
      },
    },
  };
  const target: SiteDoc = {
    schemaVersion: 1, siteName: "To", assets: {}, nodes: {}, pageOrder: ["default", "news", "archive"],
    pages: {
      default: page("default", "blog"),
      news: page("news", "blog", "tab=news"),
      archive: page("archive", "blog", "tab=archive"),
    },
  };
  return { source, target };
}

/** Run the generated page rather than only checking source fragments. */
export function renderQueryCopyExport(doc: SiteDoc) {
  const source = generateProject(doc).files["app/page.tsx"];
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const mod = { exports: {} as { default: () => any } };
  new Function("require", "module", "exports", code)(loadDependency, mod, mod.exports);
  return { tree: mod.exports.default(), html: renderToStaticMarkup(createElement(mod.exports.default)) };
}
