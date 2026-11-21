import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { runChecks } from "../lib/generator/checks";
import { splitCssModule } from "../lib/generator/style-export";
import type { SiteDoc } from "../lib/types";

function site(): SiteDoc {
  return {
    schemaVersion: 1,
    siteName: "Export guard fixture",
    nodes: {},
    assets: {},
    pageOrder: ["home"],
    pages: {
      home: { id: "home", name: "Home", title: "Home", description: "",
        slug: "", children: [] },
    },
  };
}

test("Next.js metadata base validates URLs without rejecting uppercase HTTP schemes", () => {
  for (const value of ["https://example.test/path/", "HTTPS://EXAMPLE.TEST/path/", "http://example.test/"]) {
    const doc = site();
    doc.siteUrl = value;
    const layout = generateExportProject(doc, "nextjs").files["app/layout.tsx"];
    assert.ok(layout.includes("metadataBase: new URL("), value);
    assert.ok(layout.includes(JSON.stringify(value)), value);
  }
  for (const value of ["https://", "https://example.test:invalid/", "ftp://example.test/",
    "https://user:secret@example.test/"]) {
    const doc = site();
    doc.siteUrl = value;
    const layout = generateExportProject(doc, "nextjs").files["app/layout.tsx"];
    assert.doesNotMatch(layout, /metadataBase: new URL\(/, value);
  }
});

test("a deleted page left in pageOrder does not crash checks or generated formats", () => {
  const doc = site();
  doc.pageOrder.unshift("deleted-page");
  const before = structuredClone(doc);
  assert.doesNotThrow(() => runChecks(doc));
  for (const framework of ["nextjs", "react", "html", "vue", "nuxt", "sveltekit"] as const) {
    const generated = generateExportProject(doc, framework);
    assert.ok(Object.keys(generated.files).length > 0, framework);
  }
  assert.deepEqual(doc, before, "generation must not mutate the original document");
});

test("CSS Modules still scopes class rules preceded by authored comments", () => {
  const source = [
    "/* exported node style */",
    ".card { color: red; }",
    "/* second selector */",
    "@media (max-width: 600px) {",
    "  /* mobile node rule */",
    "  .card { color: blue; }",
    "  /* global body rule */",
    "  body { color: black; }",
    "}",
  ].join("\n");
  const result = splitCssModule(source);
  assert.match(result.module, /\.siteRoot :global\(\.card\) \{ color: red; \}/);
  assert.match(result.module, /@media \(max-width: 600px\)/);
  assert.match(result.module, /\.siteRoot :global\(\.card\) \{ color: blue; \}/);
  assert.doesNotMatch(result.global, /\.card \{/);
  assert.match(result.global, /body \{ color: black; \}/);
});
