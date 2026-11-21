import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
  test(framework + " keeps generated node names separate from Tailwind utilities", () => {
    const text = { ...makeText("Visible"), name: "Invisible", htmlClass: "underline" };
    const doc: SiteDoc = {
      schemaVersion: 1, siteName: "Utilities", assets: {}, pageOrder: ["p"], nodes: { [text.id]: text },
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: [text.id] } },
    };
    const options = { framework, language: "typescript", scope: "project" } as const;
    for (const style of ["css", "tailwind"] as const) {
      const { files } = generateExportProject(doc, { ...options, style });
      const generatedClass = style === "tailwind" ? "tsumu-invisible" : "invisible";
      const stylesheet = Object.entries(files).find(([path]) => path.endsWith("/site.css"))![1];
      assert.ok(stylesheet.includes("." + generatedClass + " {"));
      const views = Object.entries(files).filter(([path]) => /\.(?:tsx|vue|svelte)$/.test(path));
      assert.ok(views.some(([, source]) => source.includes('"' + generatedClass + ' underline"')));
    }
  });
}
