import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import { makeBox } from "../lib/presets";
import { walkSteps } from "../lib/script";
import type { Script } from "../lib/types";
import { queryCopyFixture, renderQueryCopyExport } from "./helpers/page-copy-query";

test("copied links and generated navigation scripts preserve the destination query variant", () => {
  const { source, target } = queryCopyFixture();
  const original = structuredClone(source);
  applyPagePayload(target, buildPagePayload(source, ["home"]));
  const { tree, html } = renderQueryCopyExport(target);
  const [, link, button] = tree.props.children;
  assert.equal(link.props.href, "/blog?tab=news");
  assert.equal(JSON.parse(button.props["data-scripts"])[0].steps[0].href, "/blog?tab=news");
  assert.match(html, /href="\/blog\?tab=news"/);
  assert.deepEqual(source, original);
});

test("query matching ignores parameter order and equivalent encoding, but not values", () => {
  for (const [from, to] of [
    ["tab=news&page=2", "page=2&tab=news"],
    ["q=hello%20world&tab=news", "tab=news&q=hello+world"],
    [undefined, ""],
    ["", undefined],
  ]) {
    const { source, target } = queryCopyFixture();
    source.pages["source-news"].query = from;
    target.pages.news.query = to;
    // slug が同じでクエリが違うページを、最後の項目にする。
    delete target.pages.default;
    target.pageOrder = ["news", "archive"];
    applyPagePayload(target, buildPagePayload(source, ["home"]));
    const home = target.pages[target.pageOrder.at(-1)!];
    assert.equal(target.nodes[home.children[0]].link?.pageId, "news", `${from} → ${to}`);
  }
});

test("missing query matches do not silently retarget links to another variant", () => {
  const { source, target } = queryCopyFixture();
  delete target.pages.news;
  target.pageOrder = ["default", "archive"];
  applyPagePayload(target, buildPagePayload(source, ["home"]));
  const home = target.pages[target.pageOrder.at(-1)!];
  assert.equal(target.nodes[home.children[0]].link?.pageId, "source-news");
});

test("missing required page-copy metadata is rejected without changing the destination", () => {
  const { source, target } = queryCopyFixture();
  const payload = buildPagePayload(source, ["home"]);
  const before = structuredClone(target);
  delete (payload as Partial<typeof payload>).queries;
  assert.throws(() => applyPagePayload(target, payload), /Invalid page copy metadata/);
  assert.deepEqual(target, before);
});

test("pages copied together take priority over matching destination URLs", () => {
  const { source, target } = queryCopyFixture();
  applyPagePayload(target, buildPagePayload(source, ["home", "source-news"]));
  const [home, news] = target.pageOrder.slice(-2).map((id) => target.pages[id]);
  assert.equal(target.nodes[home.children[0]].link?.pageId, news.id);
  assert.notEqual(news.id, "news");
  assert.equal(news.query, "tab=news");
});

test("query-aware relinking covers page scripts and new masters without changing existing masters", () => {
  const { source, target } = queryCopyFixture();
  const scripts: Script[] = [{ id: "nested", trigger: "click", pos: { x: 0, y: 0 }, steps: [
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "yes", op: "eq", value: "yes" }, then: [
      { id: "repeat", kind: "repeat", times: 1, then: [
        { id: "open", kind: "open-page", pageId: "source-news" },
      ] },
    ], else: [{ id: "each", kind: "for-each", array: "items", then: [
      { id: "otherwise", kind: "open-page", pageId: "source-news" },
    ] }] },
  ] }];
  source.pages.home.scripts = structuredClone(scripts);
  source.pages.home.pageScripts = structuredClone(scripts);
  source.nodes.master = { ...makeBox(), id: "master", link: { kind: "page", pageId: "source-news" }, scripts };
  source.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "header" };
  source.pages.home.children.push("instance");
  source.components = { header: { id: "header", name: "Header", rootId: "master" } };
  const payload = buildPagePayload(source, ["home"]);
  const original = structuredClone(payload);
  applyPagePayload(target, payload);
  const home = target.pages[target.pageOrder.at(-1)!];
  assert.equal(target.nodes.master.link?.pageId, "news");
  for (const script of [...home.scripts!, ...home.pageScripts!, ...target.nodes.master.scripts!]) {
    walkSteps(script.steps, (step) => {
      if (step.kind === "open-page") assert.equal(step.pageId, "news");
    });
  }
  target.nodes.master.link = { kind: "page", pageId: "archive" };
  const existing = structuredClone(target.nodes.master);
  applyPagePayload(target, payload);
  assert.deepEqual(target.nodes.master, existing);
  assert.deepEqual(payload, original);
});

test("copied pages keep compatible query routes and reserve exclusive or equivalent routes", () => {
  const { source, target } = queryCopyFixture();
  // A matching display name alone must not change the public URL.
  target.pages.news.name = source.pages["source-news"].name;
  target.pages.news.query = "view=other";
  source.pages.archive = { ...source.pages["source-news"], id: "archive", name: "Another archive", query: "view=new" };
  source.pageOrder.push("archive");
  applyPagePayload(target, buildPagePayload(source, ["source-news", "archive"]));
  const added = target.pageOrder.slice(-2).map(id => target.pages[id]);
  assert.deepEqual(added.map(p => [p.slug, p.query]), [["blog", "tab=news"], ["blog", "view=new"]]);
  assert.notEqual(added[0].name, target.pages.news.name);

  for (const existing of [
    { slug: "blog/", query: "tab=news&tab=unused" },
    { slug: "blog", query: "different=yes", rawHtml: "<p>Keep me</p>" },
    { slug: "blog", redirectTo: "/about" },
    { slug: "blog", rewriteTo: "https://example.org/" },
    { slug: "404", query: "other=page" },
  ]) {
    const { source, target } = queryCopyFixture();
    target.pages = { news: { ...target.pages.news, ...existing } };
    target.pageOrder = ["news"];
    source.pages["source-news"].slug = existing.slug === "404" ? "404" : "blog";
    applyPagePayload(target, buildPagePayload(source, ["source-news"]));
    assert.equal(target.pages[target.pageOrder[1]].slug, source.pages["source-news"].slug + "-copy");
  }
});
