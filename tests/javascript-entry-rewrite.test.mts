import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { toJavaScriptProject } from "../lib/generator/javascript-export";
import type { DefaultTreeAdapterTypes as Html } from "parse5";

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
    assert.equal(output.files["index.html"], name === "earlier authored module"
      ? expected.replace('src="/src/main.tsx" data-authored="yes"', 'src="/src/main.jsx" data-authored="yes"') : expected);
    assert.ok(output.files["src/main.jsx"]);
    assert.equal(output.files["src/main.tsx"], undefined);
  });
}

for (const src of [
  "./src/main.tsx",
  "src/main.tsx",
  "/src/main.tsx?v=1&amp;mode=preview#boot",
  "./src/main.tsx?v=1#boot",
  "src/main.tsx#boot",
  "src/main.tsx?next=/src/main.tsx#boot",
  "./src/main.tsx?literal=&quot;&amp;mode=1#boot",
]) {
  test(`React JavaScript export follows the renamed entry for ${src}`, async () => {
    const { parse } = await import("parse5");
    const output = await prepareExportProject({
      siteName: "Export", customHeadHtml: `<script type="module" src="${src}" data-authored="yes"></script>`,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, { framework: "react", language: "javascript", style: "css", scope: "project" });
    assert.ok(output.files["src/main.jsx"]);
    assert.equal(output.files["src/main.tsx"], undefined);
    assert.ok(output.files["index.html"].includes(`src="${src.replace(/\.tsx(?=[?#]|$)/, ".jsx")}" data-authored="yes"`));
    // 実際のHTML解析後も、モジュールが存在する生成ファイルを参照することを確かめる。
    const pending: Html.Node[] = [parse(output.files["index.html"])];
    while (pending.length) {
      const node = pending.pop()!;
      if ("tagName" in node && node.tagName === "script") {
        const source = node.attrs.find(attr => attr.name === "src")?.value;
        if (source) {
          const url = new URL(source, "https://export.invalid/index.html");
          assert.ok(output.files[url.pathname.slice(1)], `Missing module: ${source}`);
        }
      }
      if ("childNodes" in node) pending.push(...node.childNodes);
    }
  });
}

for (const src of [
  "https://cdn.example/src/main.tsx?v=1#boot",
  "//cdn.example/src/main.tsx",
  "/other/src/main.tsx",
  "./src/main.tsx.map",
  "./src/main.tsx/other",
  "./other.js?entry=/src/main.tsx",
]) {
  test(`React JavaScript entry rewrite preserves unrelated URL ${src}`, async () => {
    const head = `<script type="module" src="${src}" data-authored="yes"></script>`;
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: head,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    assert.ok(output.files["index.html"].includes(head));
    assert.ok(output.files["index.html"].includes('src="/src/main.jsx"'));
  });
}

for (const href of ["/", "/nested/", "https://cdn.example/app/"]) {
  test(`React JavaScript entry rewrite preserves local Vite input paths with base ${href}`, async () => {
    const base = `<base href="${href}">`;
    const external = '<script type="module" src="https://cdn.example/src/main.tsx"></script>';
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: base + external +
        '<script type="module" src="./src/main.tsx?v=1#boot" data-authored="yes"></script>',
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    // Vite の入力はbaseではなくindex.html基準。相対パスをルート相対に変えない。
    assert.ok(output.files["index.html"].includes(base + external));
    assert.ok(output.files["index.html"].includes('src="./src/main.jsx?v=1#boot" data-authored="yes"'));
    assert.ok(output.files["index.html"].includes('src="/src/main.jsx"'));
  });
}

for (const src of ["/src/main.tsx", "./src/main.tsx", "src/main.tsx?v=1#boot"]) {
  test(`React JavaScript entry rewrite preserves browser-resolved vite-ignore URL ${src}`, async () => {
    const head = '<base href="https://cdn.example/app/">' +
      `<script type="module" vite-ignore src="${src}"></script>`;
    const source = generateExportProject({
      siteName: "Export", customHeadHtml: head,
      pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      pageOrder: ["home"], nodes: {}, assets: {},
    }, "react");
    const output = await toJavaScriptProject(source, "react");
    assert.ok(output.files["index.html"].includes(head));
    assert.ok(output.files["index.html"].includes('src="/src/main.jsx"'));
  });
}
