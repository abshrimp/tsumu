import assert from "node:assert/strict";
import { test } from "node:test";
import { runChecks } from "../lib/generator/checks";
import { createInitialDoc } from "../lib/presets";

const messages = (doc: ReturnType<typeof createInitialDoc>) => runChecks(doc).map((c) => c.message);

function withPage(slug: string, title: string, name = "Page") {
  const doc = createInitialDoc();
  doc.siteName = "Cafe";
  doc.pages.x = { id: "x", name, slug, title, description: "", children: [] };
  doc.pageOrder.push("x");
  return doc;
}

test("a fresh site with a real name has no default-naming warnings", () => {
  const doc = createInitialDoc();
  doc.siteName = "Cafe";
  assert.ok(!messages(doc).some((m) => /自動で付け|初期値|タイトルが同じ/.test(m)), messages(doc).join("\n"));
});

test("the default site name is reported", () => {
  assert.ok(messages(createInitialDoc()).some((m) => m.includes("My Site")));
});

test("automatic URLs from adding and duplicating pages are reported", () => {
  for (const slug of ["page-3", "about-copy", "about-copy-2", "blog/post-copy", "copy"]) {
    assert.ok(messages(withPage(slug, "About")).some((m) => m.includes(`/${slug}`)), slug);
  }
  for (const slug of ["about", "pages", "copywriting", "page-intro"]) {
    assert.ok(!messages(withPage(slug, "About")).some((m) => m.includes(`/${slug}」が自動`)), slug);
  }
});

test("automatic titles and shared titles are reported", () => {
  assert.ok(messages(withPage("about", "ページ 3")).some((m) => m.includes("「ページ 3」のまま")));
  // タイトルが空ならページ名がタイトルになる
  assert.ok(messages(withPage("about", "", "ページ 12")).some((m) => m.includes("「ページ 12」のまま")));
  assert.ok(messages(withPage("menu", "ホーム")).some((m) => m.includes("タイトルが同じ「ホーム」")));
  assert.ok(!messages(withPage("about", "ページの作り方")).some((m) => m.includes("自動で付けた「")));
});

test("unpublished pages are not checked", () => {
  const doc = withPage("page-3", "ページ 3");
  doc.pages.x.unpublished = true;
  assert.ok(!messages(doc).some((m) => m.includes("page-3") || m.includes("ページ 3")));
});

async function fresh(pages: Record<string, { name: string; slug: string; title: string }>) {
  const { useEditor } = await import("../lib/store");
  const doc = createInitialDoc();
  for (const [id, p] of Object.entries(pages)) {
    doc.pages[id] = { id, ...p, description: "", children: [] };
    doc.pageOrder.push(id);
  }
  useEditor.setState({ doc });
  const st = useEditor.getState;
  return { st, page: (id: string) => st().doc.pages[id], bySlug: (slug: string) => Object.values(st().doc.pages).find((p) => p.slug === slug)! };
}

test("a new page takes its first confirmed name as its title, and is not linked afterwards", async () => {
  const { st } = await fresh({});
  st().addPage();
  const added = Object.values(st().doc.pages).find((p) => p.titlePending)!;
  assert.ok(added, "new page is marked");
  // 触っただけ（同じ名前で確定）では決まらない
  st().updatePage(added.id, { name: added.name });
  assert.equal(st().doc.pages[added.id].titlePending, true);
  st().updatePage(added.id, { name: "会社概要" });
  assert.equal(st().doc.pages[added.id].title, "会社概要");
  assert.equal(st().doc.pages[added.id].titlePending, undefined);
  // 2回目以降は連動しない
  st().updatePage(added.id, { name: "会社案内" });
  assert.equal(st().doc.pages[added.id].title, "会社概要");
});

test("titles without an explicit pending marker stay unchanged when a page is renamed", async () => {
  const { st, page } = await fresh({ x: { name: "ページ 2", slug: "page-2", title: "ページ 2" }, y: { name: "News", slug: "news", title: "News" } });
  st().updatePage("x", { name: "会社概要" });
  assert.equal(page("x").title, "ページ 2");
  st().updatePage("x", { name: "会社案内" });
  assert.equal(page("x").title, "ページ 2");
  // 自分で決めた名前と同じタイトルは連動しない
  st().updatePage("y", { name: "お知らせ" });
  assert.equal(page("y").title, "News");
});

test("a copied page keeps the source title until its name is first confirmed", async () => {
  const { st, page, bySlug } = await fresh({ a: { name: "About", slug: "about", title: "About our cafe" } });
  st().duplicatePage("a");
  const id = bySlug("about-copy").id;
  assert.equal(page(id).title, "About our cafe");
  // 同じタイトルで確定しても、触っただけなのでしるしは残る
  st().updatePage(id, { title: "About our cafe" });
  assert.equal(page(id).titlePending, true);
  st().updatePage(id, { name: "Access" });
  assert.equal(page(id).title, "Access");
  st().updatePage(id, { name: "Map" });
  assert.equal(page(id).title, "Access");
  assert.equal(page("a").title, "About our cafe");
});

test("editing the title first stops it from following the name", async () => {
  const { st, page, bySlug } = await fresh({ a: { name: "About", slug: "about", title: "About our cafe" } });
  st().duplicatePage("a");
  const id = bySlug("about-copy").id;
  st().updatePage(id, { title: "Our menu" });
  st().updatePage(id, { name: "Menu" });
  assert.equal(page(id).title, "Our menu");
  // 名前とタイトルを一緒に指定したときは、指定したタイトル
  st().updatePage(id, { name: "Drinks", title: "Drinks list" });
  assert.equal(page(id).title, "Drinks list");
});
