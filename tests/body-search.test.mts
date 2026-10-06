import assert from "node:assert/strict";
import { test } from "node:test";
import { searchSiteBody } from "../lib/body-search";
import type { SiteDoc } from "../lib/types";

const doc = {
  pageOrder: ["home", "article", "html"],
  pages: {
    home: { id: "home", name: "Home", children: ["title", "outer"] },
    article: { id: "article", name: "Article", children: ["second"] },
    html: { id: "html", name: "HTML", children: [], rawHtml: "<main><h1>日本語の本文</h1><script>秘密の本文</script></main>" },
  },
  nodes: {
    title: { id: "title", name: "Heading", type: "box", text: { content: "公開する本文", heading: 1 }, children: [] },
    outer: { id: "outer", name: "Container", type: "box", text: null, children: ["nested"] },
    nested: { id: "nested", name: "Nested", type: "box", text: { content: "本文中の文字列", heading: 0 }, children: [] },
    second: { id: "second", name: "Article text", type: "box", text: { content: "本文と関連する説明", heading: 0 }, children: [] },
  },
} as unknown as SiteDoc;

test("text search finds Japanese editable body content across pages in page order", () => {
  const results = searchSiteBody(doc, "本文");
  assert.deepEqual(results.map((r) => [r.pageId, r.nodeId]), [
    ["home", "title"], ["home", "nested"], ["article", "second"], ["html", null],
  ]);
  assert.match(results[0].excerpt, /公開する本文/);
});

test("text search excludes script contents, supports NFKC and bounds results", () => {
  assert.deepEqual(searchSiteBody(doc, "秘密"), []);
  assert.deepEqual(searchSiteBody(doc, ""), []);
  assert.equal(searchSiteBody(doc, "本文", 2).length, 2);
  assert.equal(searchSiteBody({
    ...doc,
    nodes: { ...doc.nodes, title: { ...doc.nodes.title, text: { content: "ＣＡＦＥ", heading: 0 } } },
  } as SiteDoc, "cafe").length, 1);
});

test("page kinds search only the content available in the editor", () => {
  for (const mode of [{ rawHtml: "<p>Imported body</p>" }, { rawHtml: "" }, { redirectTo: "" }, { rewriteTo: "/news" }]) {
    const page = { ...doc.pages.home, ...mode };
    const site = { ...doc, pages: { home: page }, pageOrder: ["home"] };
    assert.deepEqual(searchSiteBody(site, "本文"), []);
    assert.deepEqual(searchSiteBody(site, "Imported").map(hit => hit.nodeId), page.rawHtml ? [null] : []);
  }
});
