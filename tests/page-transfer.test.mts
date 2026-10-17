import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
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
  // 同じ名前・URLのページがあれば「のコピー」にする
  assert.notEqual(home.slug, "");
  assert.equal(about.slug, "about");
  assert.equal(about.name, "About");
  // フォルダは同じ名前で作る
  assert.equal(dst.pageFolders?.find((f) => f.id === about.folderId)?.name, "Info");
  // 要素は新しいIDで、入れ子もそろっている
  const a = dst.nodes[home.children[0]];
  assert.ok(a && a.id !== "a");
  assert.equal(dst.nodes[a.children[0]]?.image?.assetId, "img1");
  // 一緒にコピーしたページへのリンクは新しいページへ、コピーしなかったページは同じURLのページへ
  assert.equal(a.link?.pageId, about.id);
  const step = dst.nodes[about.children[0]].scripts?.[0].steps[0];
  assert.equal(step?.kind === "open-page" ? step.pageId : null, "tn");
  // 使っているアセットだけ写す
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
  // ページで選んでいた言語はそのまま
  assert.equal(news.lang, "fr");
  // 同じ言語のサイトへは、サイトに従うまま
  const same = target();
  same.lang = "en";
  applyPagePayload(same, buildPagePayload(src, ["home"]));
  assert.equal(same.pages[same.pageOrder[2]].lang, undefined);
});
