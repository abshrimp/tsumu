import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { toJavaScriptProject } from "../lib/generator/javascript-export";

for (const [name, head] of [
  ["script literal", '<script>window.example="src/main.tsx";</script>'],
  ["comment", '<!-- <script type="module" src="/src/main.tsx"></script> -->'],
  ["other attribute", '<meta name="example" content="src/main.tsx">'],
  ["inert template", '<template><script type="module" src="/src/main.tsx"></script></template>'],
  ["earlier authored module", '<script type="module" src="/src/main.tsx" data-authored="yes"></script>'],
] as const) {
  test(`React JavaScript entry rewrite preserves ${name}`, async () => {
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: head,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    const entry = '<script type="module" src="/src/main.tsx"></script>';
    const index = source.files["index.html"].lastIndexOf(entry);
    assert.ok(index >= 0);
    const expected = source.files["index.html"].slice(0, index) + entry.replace("main.tsx", "main.jsx") + source.files["index.html"].slice(index + entry.length);
    assert.equal(output.files["index.html"], expected);
    assert.ok(output.files["src/main.jsx"]);
    assert.equal(output.files["src/main.tsx"], undefined);
  });
}
