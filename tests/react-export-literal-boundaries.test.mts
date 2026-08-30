import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { prepareExportProject } from "../lib/export-formats";
import { reactSource } from "../lib/generator/react-export";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
const examples = [
  "Example: import 'next/link'; and import 'next'; from 'next/image'",
  '<Link href="/docs">Link example</Link> and <Image src="/photo.png" />',
  'export default async function Page() { return null; }\nconst sp = await searchParams;',
  "before\u2028import 'next/link';\u2029const sp = await searchParams;",
];

function fixture(content: string): SiteDoc {
  return {
    siteName: "Literal examples", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["text"] } },
    nodes: { text: { ...makeText(content), id: "text" } },
  };
}

for (const language of ["typescript", "javascript"] as const) {
  for (const [index, content] of examples.entries()) {
    test(`React ${language} renders code-like authored text unchanged (${index})`, async () => {
      const doc = fixture(content);
      const before = structuredClone(doc);
      const project = await prepareExportProject(doc,
        { framework: "react", language, style: "css", scope: "project" });
      const source = project.files["src/pages/Page0." + (language === "typescript" ? "tsx" : "jsx")];
      const { code } = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" });
      const module = { exports: {} as { default: () => ReturnType<typeof createElement> } };
      new Function("require", "module", "exports", code)(require, module, module.exports);
      const fragment = parseFragment(renderToStaticMarkup(createElement(module.exports.default)));
      const textOf = (node: Html.Node): string => "value" in node ? node.value :
        "childNodes" in node ? node.childNodes.map(textOf).join("") : "";
      assert.equal(textOf(fragment), content);
      assert.deepEqual(doc, before);
    });
  }
}

test("React adaptation preserves literal HTML and still converts real inline JSX", () => {
  const literal = '<Link href="/example">Keep</Link><Image src="/keep.png" />';
  const source = 'import Link from "next/link";\nimport Image from "next/image";\n' +
    'export default function Page() { return <><Link href="/">Home</Link>' +
    '<Image src="/real.png" alt="Real" width={1} height={1} />' +
    '<div dangerouslySetInnerHTML={{ __html: ' + JSON.stringify(literal) + ' }} /></>; }';
  const adapted = reactSource(source);
  assert.ok(adapted.includes(JSON.stringify(literal)));
  assert.match(adapted, /<a href="\/">Home<\/a>/);
  assert.match(adapted, /<img src="\/real.png"/);
  for (const source of ['import { notFound } from "next/navigation";', 'import "next/unsupported";']) {
    assert.throws(() => reactSource(source), /Next.js-only imports/);
  }
});
