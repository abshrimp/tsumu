import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { headHtmlToJsx } from "../lib/generator/head";
import { generateProject } from "../lib/generator";
import type { SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);

function evaluate(source: string) {
  const module = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  new Function("require", "module", "exports", code)(
    (id: string) => id.endsWith(".css") ? {} : require(id), module, module.exports,
  );
  return module.exports.default;
}

function emitted(html: string) {
  return renderToStaticMarkup(evaluate(`export default <>${headHtmlToJsx(html, "")}</>`));
}

function element(html: string) {
  return parseFragment(html).childNodes.find((node): node is Html.Element => "tagName" in node)!;
}

for (const tag of ["meta", "link", "base"]) {
  test(`custom head ${tag} ignores the inert HTML children attribute rather than crashing SSR`, () => {
    const node = element(emitted(`<${tag} children="not child content" data-kept="yes">`));
    assert.equal(node.tagName, tag);
    assert.deepEqual(node.attrs, [{ name: "data-kept", value: "yes" }]);
    assert.deepEqual(node.childNodes, []);
  });
}

for (const [tag, body] of [
  ["script", "globalThis.authored = true;"],
  ["style", "body { color: green; }"],
  ["title", "Authored &amp; title"],
  ["noscript", '<link rel="stylesheet" href="/fallback.css">'],
]) {
  test(`custom head ${tag} does not confuse an HTML children attribute with its authored body`, () => {
    const expected = element(`<${tag}>${body}</${tag}>`).childNodes;
    const actual = element(emitted(`<${tag} children="not child content">${body}</${tag}>`)).childNodes;
    assert.deepEqual(actual.map(node => "value" in node ? node.value : node.nodeName),
      expected.map(node => "value" in node ? node.value : node.nodeName));
  });
}

test("custom head does not turn an inert children attribute into script or stylesheet content", () => {
  for (const tag of ["script", "style", "title", "noscript"]) {
    const node = element(emitted(`<${tag} children="globalThis.notAuthored = true;"></${tag}>`));
    assert.deepEqual(node.childNodes, []);
  }
});

test("generated Next layout renders head metadata containing a children attribute", () => {
  const doc: SiteDoc = {
    siteName: "Metadata test", assets: {}, nodes: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", slug: "", description: "", children: [] } },
    customHeadHtml: '<meta name="description" children="inert" content="Preserved"><script children="globalThis.notAuthored = true;"></script>',
  };
  const layout = evaluate(generateProject(doc).files["app/layout.tsx"]);
  const html = renderToStaticMarkup(layout({ children: "Body remains available" }));
  assert.match(html, /<meta name="description" content="Preserved"\/>/);
  assert.match(html, /<body>Body remains available<\/body>/);
  assert.doesNotMatch(html, /notAuthored/);
});
