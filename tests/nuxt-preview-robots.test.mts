import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { prepareExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";

const doc: SiteDoc = {
  siteName: "Preview site", nodes: {}, assets: {}, pageOrder: ["home", "nested"],
  pages: {
    home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: [] },
    nested: { id: "nested", name: "Nested", title: "Nested", description: "", slug: "guides/start", children: [] },
  },
};

// robots.txt や _headers を文書の単位の指示の証拠とみなさず、
// スタイルの変換を含め、出力した設定を評価する。
function configOf(source: string) {
  const module = { exports: {} as { default?: any } };
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  new Function("defineNuxtConfig", "require", "module", "exports", code)(
    (config: unknown) => config,
    (name: string) => {
      assert.equal(name, "@tailwindcss/vite");
      return () => ({ name: "tailwindcss" });
    }, module, module.exports,
  );
  return module.exports.default;
}

for (const language of ["typescript", "javascript"] as const) {
  for (const style of ["css", "css-modules", "tailwind"] as const) {
    for (const target of ["test", "production"] as const) {
      test(`Nuxt ${language}/${style}: ${target} head preserves publishing robots policy`, async () => {
        const options = { framework: "nuxt", language, style, scope: "project" } as const;
        const { files } = await prepareExportProject(doc, options, target);
        const config = configOf(files[`nuxt.config.${language === "typescript" ? "ts" : "js"}`]);
        const robots = config.app.head.meta.filter((entry: { name: string }) => entry.name === "robots");
        assert.deepEqual(robots, target === "test"
          ? [{ name: "robots", content: "noindex, nofollow, noarchive, nosnippet, noimageindex" }]
          : []);
        assert.equal(config.app.head.title, doc.siteName);
        assert.ok(files["app/pages/index.vue"]);
        assert.ok(files["app/pages/[...slug].vue"], "global head covers nested pages too");
        if (target === "test") {
          assert.equal(files["public/robots.txt"], "User-agent: *\nDisallow: /\n");
          assert.match(files["public/_headers"], /X-Robots-Tag: noindex/);
        }
      });
    }
  }
}
