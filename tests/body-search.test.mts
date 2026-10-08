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

test("body search excerpts preserve the authored spelling around normalization expansions and contractions", () => {
  const title = doc.nodes.title;
  const cases = [
    ["㍿".repeat(110), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["ｶﾞ".repeat(130), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["İ".repeat(140), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["ㄱㅏ".repeat(140), "Ｔｓｕｍｕガイド", "tsumuガイド", "後".repeat(300)],
    ["㍿".repeat(100), "ｺﾞ".repeat(180), "ゴ".repeat(180), "ｶﾞ".repeat(120)],
    ["前".repeat(100), "ａ" + "\u0315".repeat(200) + "\u0301", "á", "後".repeat(300)],
  ];
  for (const [prefix, spelling, query, suffix] of cases) {
    const content = prefix + spelling + suffix;
    const site = {
      ...doc, nodes: { ...doc.nodes, title: { ...title, text: { content, heading: 0 as const } } },
    };
    const [hit] = searchSiteBody(site, query);
    assert.ok(hit.excerpt.includes(spelling), hit.excerpt);
    assert.ok(hit.excerpt.startsWith("…") && hit.excerpt.endsWith("…"));
  }
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

test("raw HTML search reads body text, including entities and words spanning inline markup", () => {
  const page = {
    ...doc.pages.html,
    rawHtml: '<title>Metadata only</title><main><p title="a > b">Tsu<strong>mu</strong> &amp; Co</p>' +
      '<p>News<br>today</p><!-- Comment only --><template>Template only</template><i hidden>Hidden only</i></main>',
  };
  const site = { ...doc, pages: { html: page }, pageOrder: ["html"] };
  assert.deepEqual(searchSiteBody(site, "Tsumu & Co News today").map(hit => hit.excerpt), ["Tsumu & Co News today"]);
  for (const query of ["Metadata only", "Comment only", "Template only", "Hidden only", "CoNews", "a > b"]) {
    assert.deepEqual(searchSiteBody(site, query), []);
  }
  page.rawHtml = "<p>Updated body</p>";
  assert.equal(searchSiteBody(site, "Tsumu").length, 0);
  assert.equal(searchSiteBody(site, "Updated body").length, 1);
});
