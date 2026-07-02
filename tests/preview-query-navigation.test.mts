import assert from "node:assert/strict";
import { test } from "node:test";
import { previewNavigationFixture, previewQueryDoc, publishedQueryPage } from "./helpers/preview-query-navigation";

const fixture = previewNavigationFixture();
for (const slug of ["blog", "posts/[slug]"]) {
  test(`preview ${slug} links select the same query variant as the generated route`, async () => {
    const navigate = await fixture;
    const doc = previewQueryDoc(slug);
    const variants = doc.pageOrder.filter((id) => id.startsWith("variant")).map((id) => doc.pages[id]);
    for (const query of ["tab=news", "lang=ja&tab=news#section", "tab=archive", "tab=unknown", "", "extra=1&tab=news", "tab=news&tab=archive", "tab=archive&tab=news"]) {
      const url = `/${slug.replace("[slug]", "article")}?${query}`;
      assert.equal(navigate(doc, url), await publishedQueryPage(variants, url), url);
    }
  });
}
test("encoded query keys and values, first-value inputs and equally specific ties match publishing", async () => {
  const navigate = await fixture;
  const doc = previewQueryDoc("blog", ["", "q=hello+world", "q=hello%20world&lang=ja", "lang=ja", "q=hello+world&source=mail", "q=first&q=last"]);
  const variants = doc.pageOrder.filter((id) => id.startsWith("variant")).map((id) => doc.pages[id]);
  for (const url of ["/blog?q=hello%20world", "/blog?q=hello+world&lang=ja", "/blog?lang=ja&q=other", "/blog?q=hello%20world&q=other", "/blog?lang=ja&q=hello+world#q=other", "/blog?source=mail&q=hello+world&lang=ja", "/blog?q=last", "/blog?q=first"]) {
    assert.equal(navigate(doc, url), await publishedQueryPage(variants, url), url);
  }
});
test("no default query keeps the first-page fallback and does not affect other routes", async () => {
  const navigate = await fixture;
  const doc = previewQueryDoc("blog", ["tab=archive", "tab=news"]);
  assert.equal(navigate(doc, "/blog?tab=news"), "variant1");
  assert.equal(navigate(doc, "/blog?tab=missing"), "variant0");
  assert.equal(navigate(doc, "/unknown?tab=news"), "missing");
  assert.equal(navigate(doc, "/"), "home");
  assert.equal(navigate(doc, "#section"), "home");
});
