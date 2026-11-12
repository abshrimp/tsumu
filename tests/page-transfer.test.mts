import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { walkSteps } from "../lib/script";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import type { SiteDoc } from "../lib/types";

function source(): SiteDoc {
  const box = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
  return {
    siteName: "From",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["a"] },
      about: { id: "about", name: "About", slug: "about", title: "About", description: "", children: ["c"], folderId: "f1" },
      news: { id: "news", name: "News", slug: "news", title: "News", description: "", children: [] },
    },
    pageOrder: ["home", "about", "news"],
    pageFolders: [{ id: "f1", name: "Info" }],
    nodes: {
      a: { ...box("a", ["b"]), link: { kind: "page", pageId: "about" } },
      b: { ...box("b"), image: { src: "", alt: "", width: 1, height: 1, assetId: "img1" } },
      c: {
        ...box("c"),
        scripts: [{ id: "s", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: "x", kind: "open-page", pageId: "news" }] }],
      },
    },
    assets: { img1: { id: "img1", name: "a.png", path: "/a.png", width: 1, height: 1 }, unused: { id: "unused", name: "b.png", path: "/b.png", width: 1, height: 1 } },
  };
}

function target(): SiteDoc {
  return {
    siteName: "To",
    pages: {
      t: { id: "t", name: "Home", slug: "", title: "Home", description: "", children: [] },
      tn: { id: "tn", name: "Latest", slug: "news", title: "", description: "", children: [] },
    },
    pageOrder: ["t", "tn"],
    nodes: {},
    assets: {},
  };
}

test("copying pages to another site brings nodes, assets and folders and relinks pages", () => {
  const src = source();
  const dst = target();
  const added = applyPagePayload(dst, buildPagePayload(src, ["about", "home"]));
  assert.equal(added, 2);
  assert.equal(dst.pageOrder.length, 4);
  const [home, about] = dst.pageOrder.slice(2).map((id) => dst.pages[id]);
  // 同じ名前・URL のページがあれば、「のコピー」にする
  assert.notEqual(home.slug, "");
  assert.equal(about.slug, "about");
  assert.equal(about.name, "About");
  // フォルダは、同じ名前で作る
  assert.equal(dst.pageFolders?.find((f) => f.id === about.folderId)?.name, "Info");
  // 要素は新しい ID になり、入れ子もそろっている
  const a = dst.nodes[home.children[0]];
  assert.ok(a && a.id !== "a");
  assert.equal(dst.nodes[a.children[0]]?.image?.assetId, "img1");
  // 一緒にコピーしたページへのリンクは新しいページへ、コピーしなかったページへのリンクは、同じ URL のページへ
  assert.equal(a.link?.pageId, about.id);
  const step = dst.nodes[about.children[0]].scripts?.[0].steps[0];
  assert.equal(step?.kind === "open-page" ? step.pageId : null, "tn");
  // 使っているアセットだけを写す
  assert.deepEqual(Object.keys(dst.assets), ["img1"]);
  // 元のサイトは変わらない
  assert.deepEqual(src, source());
});

test("pages copied to a site in another language keep their language", () => {
  const src = source();
  src.lang = "en";
  src.pages.news.lang = "fr";
  const dst = target();
  dst.lang = "ja";
  applyPagePayload(dst, buildPagePayload(src, ["home", "news"]));
  const [home, news] = dst.pageOrder.slice(2).map((id) => dst.pages[id]);
  assert.equal(home.lang, "en");
  // ページで選んでいた言語は、そのまま
  assert.equal(news.lang, "fr");
  // 同じ言語のサイトへのコピーでは、サイトの言語に従ったまま
  const same = target();
  same.lang = "en";
  applyPagePayload(same, buildPagePayload(src, ["home"]));
  assert.equal(same.pages[same.pageOrder[2]].lang, undefined);
});

test("copied component masters relink copied pages and matching destination slugs", () => {
  const src = source();
  src.nodes.a.type = "instance";
  src.nodes.a.componentId = "header";
  src.nodes.a.children = [];
  src.nodes.master = {
    ...makeBox(), id: "master", children: [],
    link: { kind: "page", pageId: "about" },
    scripts: [{ id: "master-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [
      { id: "loop", kind: "repeat", times: 1, then: [
        { id: "open", kind: "open-page", pageId: "news" },
      ] },
    ] }],
  };
  src.components = { header: { id: "header", name: "Header", rootId: "master" } };
  const original = structuredClone(src);
  const dst = target();
  applyPagePayload(dst, buildPagePayload(src, ["home", "about"]));
  const about = dst.pages[dst.pageOrder[3]];
  assert.equal(dst.nodes.master.link?.pageId, about.id);
  const loop = dst.nodes.master.scripts?.[0].steps[0];
  assert.equal(loop?.kind === "repeat" && loop.then[0].kind === "open-page" ? loop.then[0].pageId : null, "tn");
  assert.deepEqual(src, original);

  // 同じコンポーネントがすでにあるときは、コピー先の編集内容を保つ。
  dst.nodes.master.link = { kind: "page", pageId: "t" };
  const existing = structuredClone(dst.nodes.master);
  applyPagePayload(dst, buildPagePayload(src, ["home", "about"]));
  assert.deepEqual(dst.nodes.master, existing);
});

test("page copy remaps equal-width breakpoint IDs without changing the destination", () => {
  const src = source(), dst = target();
  src.breakpoints = [{ id: "narrow", label: "Small", maxWidth: 600 }, { id: "wide", label: "Large", maxWidth: 900 }];
  // ID をわざと入れ替える。その場でキーの名前を変えると、スタイルが上書きされてしまう。
  dst.breakpoints = [{ id: "wide", label: "Small target", maxWidth: 600 }, { id: "narrow", label: "Large target", maxWidth: 900 }];
  src.nodes.a.styles = { base: { default: { color: "red" } }, narrow: { default: { color: "blue" } }, wide: { default: { color: "green" } } };
  src.nodes.a.hiddenOn = ["narrow"];
  src.pages.home.bodyStyles = { wide: { default: { backgroundColor: "yellow" } } };
  src.nodes.a.children = ["instance"];
  src.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "widget" };
  src.nodes.master = { ...makeBox(), id: "master", styles: { narrow: { default: { color: "purple" } } }, hiddenOn: ["wide"] };
  src.components = { widget: { id: "widget", name: "Widget", rootId: "master" } };
  const before = structuredClone(dst), original = structuredClone(src);
  const payload = buildPagePayload(src, ["home"]);
  const payloadBefore = structuredClone(payload);
  applyPagePayload(dst, payload);
  const page = dst.pages[dst.pageOrder.at(-1)!], node = dst.nodes[page.children[0]];
  assert.equal(node.styles.wide?.default?.color, "blue");
  assert.equal(node.styles.narrow?.default?.color, "green");
  assert.deepEqual(node.hiddenOn, ["wide"]);
  assert.equal(page.bodyStyles?.narrow?.default?.backgroundColor, "yellow");
  assert.equal(dst.nodes.master.styles.wide?.default?.color, "purple");
  assert.deepEqual(dst.nodes.master.hiddenOn, ["narrow"]);
  assert.deepEqual(dst.breakpoints, before.breakpoints);
  for (const id of before.pageOrder) assert.deepEqual(dst.pages[id], before.pages[id]);
  assert.deepEqual(src, original);
  assert.deepEqual(payload, payloadBefore);
});

test("incompatible or unknown responsive settings stop before importing any dependencies", () => {
  for (const change of ["width", "node", "page", "component", "limit"] as const) {
    const src = source(), dst = target();
    if (change === "width") src.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
    if (change === "node") src.nodes.a.hiddenOn = ["unknown"];
    if (change === "page") src.pages.home.bodyStyles = { unknown: { default: { color: "red" } } };
    if (change === "component") {
      src.nodes.a.type = "instance"; src.nodes.a.componentId = "widget";
      src.nodes.master = { ...makeBox(), id: "master", styles: { unknown: { default: { color: "red" } } } };
      src.components = { widget: { id: "widget", name: "Widget", rootId: "master" } };
    }
    if (change === "limit") src.breakpoints = Array.from({ length: 7 }, (_, i) => ({ id: `bp${i}`, label: `BP${i}`, maxWidth: 400 + i * 100 }));
    const before = structuredClone(dst);
    assert.throws(() => applyPagePayload(dst, buildPagePayload(src, ["home"])), /画面幅|screen-width/);
    assert.deepEqual(dst, before, change);
  }
});

test("six matching custom screen widths remain usable", () => {
  const src = source(), dst = target();
  src.breakpoints = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, label: "Source", maxWidth: 400 + i * 100 }));
  dst.breakpoints = src.breakpoints.map(b => ({ ...b, id: b.id.replace("a", "b") }));
  src.nodes.a.styles = { a5: { default: { color: "blue" } } };
  applyPagePayload(dst, buildPagePayload(src, ["home"]));
  assert.equal(dst.nodes[dst.pages[dst.pageOrder.at(-1)!].children[0]].styles.b5?.default?.color, "blue");
});

test("conflicting source masters with invalid responsive styles are rejected without modifying the destination", () => {
  const src = source(), dst = target();
  src.nodes.a.type = "instance"; src.nodes.a.componentId = "widget";
  src.nodes.master = { ...makeBox(), id: "master", styles: { obsolete: { default: { color: "red" } } } };
  src.components = { widget: { id: "widget", name: "Widget", rootId: "master" } };
  dst.nodes.existing = { ...makeBox(), id: "existing" };
  dst.components = { widget: { id: "widget", name: "Existing widget", rootId: "existing" } };
  const before = structuredClone(dst);
  assert.throws(() => applyPagePayload(dst, buildPagePayload(src, ["home"])), /画面幅|screen-width/);
  assert.deepEqual(dst, before);
});

test("over-limit destination breakpoints cannot be silently truncated during copy", () => {
  const src = source(), dst = target();
  dst.breakpoints = Array.from({ length: 7 }, (_, i) => ({ id: `bp${i}`, label: "BP", maxWidth: 400 + i * 100 }));
  const before = structuredClone(dst);
  assert.throws(() => applyPagePayload(dst, buildPagePayload(src, ["home"])), /画面幅|screen-width/);
  assert.deepEqual(dst, before);
});


test("repeated page copies give each node and page script independent block identities", () => {
  const src = source(), dst = target();
  const nested = (id: string) => [{ id, trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [{
    id: id + "-condition", kind: "if" as const,
    cond: { subject: "visible" as const, target: "@self" },
    then: [{ id: id + "-then", kind: "show" as const, target: "@self" }],
    else: [{ id: id + "-else", kind: "hide" as const, target: "@self" }],
  }] }];
  src.nodes.a.scripts = nested("node-script");
  src.pages.home.scripts = nested("loose-script");
  src.pages.home.pageScripts = nested("page-script");
  const payload = buildPagePayload(src, ["home"]);
  const original = structuredClone(payload);
  applyPagePayload(dst, payload);
  applyPagePayload(dst, payload);

  const seen = new Set<string>();
  for (const id of dst.pageOrder.slice(2)) {
    const page = dst.pages[id];
    const node = dst.nodes[page.children[0]];
    const scripts = [...(node.scripts ?? []), ...(page.pageScripts ?? []), ...(page.scripts ?? [])];
    assert.equal(scripts.length, 3);
    for (const script of scripts) {
      assert.ok(!seen.has(script.id), "copied script ID must be unique");
      seen.add(script.id);
      walkSteps(script.steps, (step) => {
        assert.ok(!seen.has(step.id), "copied nested step ID must be unique");
        seen.add(step.id);
      });
    }
  }
  assert.equal(seen.size, 24, "two copies, three scripts each, four identities per script");
  assert.deepEqual(payload, original);
});
