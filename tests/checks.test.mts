import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { runChecks } from "../lib/generator/checks";
import { createInitialDoc } from "../lib/presets";
import { generateProject } from "../lib/generator";
import { pageDataSteps } from "../lib/data";
import { type SiteDoc } from "../lib/types";

describe("checks", () => {
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
    for (const title of ["Page 3", "ページ 3"]) {
      assert.ok(messages(withPage("about", title)).some((m) => m.includes(`"${title}"`) && m.includes("automatic")));
    }
    // タイトルが空なら、ページ名がタイトルになる
    assert.ok(messages(withPage("about", "", "ページ 12")).some((m) => m.includes('"ページ 12"') && m.includes("automatic")));
    assert.ok(messages(withPage("menu", "Home")).some((m) => m.includes("same search and share title")));
    assert.ok(!messages(withPage("about", "ページの作り方")).some((m) => m.includes("still the automatic")));
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

  test("MCP can create a named page with a single edit and a unique route", async () => {
    const { st } = await fresh({});
    const before = st().doc.pageOrder.length;
    const pageId = st().addPage(undefined, "Menu");
    const page = st().doc.pages[pageId];
    assert.equal(page.name, "Menu");
    assert.equal(page.title, "Menu");
    assert.equal(page.titlePending, undefined);
    assert.equal(st().activePageId, pageId);
    assert.equal(st().doc.pageOrder.length, before + 1);
    assert.ok(page.slug);
    assert.throws(() => st().addPage(undefined, "Menu"), /already exists/);
    assert.equal(st().doc.pageOrder.length, before + 1);
  });

  test("a new page takes its first confirmed name as its title, and is not linked afterwards", async () => {
    const { st } = await fresh({});
    const number = st().doc.pageOrder.length + 1;
    st().addPage();
    const added = Object.values(st().doc.pages).find((p) => p.titlePending)!;
    assert.ok(added, "new page is marked");
    assert.equal(added.name, `Page ${number}`);
    assert.equal(added.title, added.name);
    // 触れただけ（同じ名前で確定した）では、決まらない
    st().updatePage(added.id, { name: added.name });
    assert.equal(st().doc.pages[added.id].titlePending, true);
    st().updatePage(added.id, { name: "About us" });
    assert.equal(st().doc.pages[added.id].title, "About us");
    assert.equal(st().doc.pages[added.id].titlePending, undefined);
    // 2回目以降は連動しない
    st().updatePage(added.id, { name: "会社案内" });
    assert.equal(st().doc.pages[added.id].title, "About us");
  });

  test("titles without an explicit pending marker stay unchanged when a page is renamed", async () => {
    const { st, page } = await fresh({ x: { name: "ページ 2", slug: "page-2", title: "ページ 2" }, y: { name: "News", slug: "news", title: "News" } });
    st().updatePage("x", { name: "About us" });
    assert.equal(page("x").title, "ページ 2");
    st().updatePage("x", { name: "会社案内" });
    assert.equal(page("x").title, "ページ 2");
    // 自分で決めた名前と同じタイトルは、連動しない
    st().updatePage("y", { name: "News" });
    assert.equal(page("y").title, "News");
  });

  test("a copied page keeps the source title until its name is first confirmed", async () => {
    const { st, page, bySlug } = await fresh({ a: { name: "About", slug: "about", title: "About our cafe" } });
    st().duplicatePage("a");
    const id = bySlug("about-copy").id;
    assert.equal(page(id).title, "About our cafe");
    // 同じタイトルで確定しても、触れただけなので、しるしは残る
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
    // 名前とタイトルを一緒に指定したときは、指定したタイトルになる
    st().updatePage(id, { name: "Drinks", title: "Drinks list" });
    assert.equal(page(id).title, "Drinks list");
  });

  test("empty raw HTML blocks publishing instead of generating a blank page", () => {
    const doc = withPage("tokimeki-dreamworld", "Dream World", "Dream World");
    doc.pages.x.rawHtml = "";
    const errors = runChecks(doc).filter(result => result.level === "error" && result.message.includes("Dream World"));
    assert.ok(errors.some(result => result.message.includes("empty")), JSON.stringify(errors));
    doc.pages.x.rawHtml = "<!doctype html><body>Story</body>";
    assert.ok(!runChecks(doc).some(result => result.level === "error" && result.message.includes("empty")));
    doc.pages.x.rawHtml = undefined;
    assert.ok(!runChecks(doc).some(result => result.level === "error" && result.message.includes("empty")));
    doc.pages.x.rawHtml = " ";
    doc.pages.x.unpublished = true;
    assert.ok(!runChecks(doc).some(result => result.level === "error" && result.message.includes("empty")));
  });
});

describe("checks-fetch-detail", () => {
  function fixture():SiteDoc {
   return {siteName:'Detail',assets:{},nodes:{},pageOrder:['home','detail'],pages:{
    home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
    detail:{id:'detail',name:'Detail',title:'Detail',description:'',slug:'posts/[slug]',children:[],pageScripts:[{id:'load',trigger:'load',steps:[{id:'fetch',kind:'fetch',url:'https://example.com/posts/{slug}',as:'post'}]}]},
   }};
  }
  const missingData=(doc:SiteDoc)=>runChecks(doc).filter(r=>r.help==='data-detail'&&r.message.includes("doesn't fetch any data"));
  test('detail page with a generated server fetch does not warn that no data is fetched',()=>{
   const doc=fixture();
   assert.equal(pageDataSteps(doc,'detail').some(s=>s.kind==='fetch'&&s.as==='post'),true);
   const output=generateProject(doc).files['app/posts/[slug]/page.tsx'];
   assert.match(output,/await fetchJson\(interpolateUrl\("https:\/\/example.com\/posts\/\{slug\}"/);
   assert.deepEqual(missingData(doc),[]);
  });
  test('detail page without server data still reports the missing-data warning',()=>{
   const doc=fixture();doc.pages.detail.pageScripts=[];
   assert.equal(missingData(doc).length,1);
  });
  test('empty fetch URL still reports its separate blocking error',()=>{
   const doc=fixture();const step=doc.pages.detail.pageScripts![0].steps[0];
   if(step.kind==='fetch')step.url='';
   assert.ok(runChecks(doc).some(r=>r.level==='error'&&r.help==='data-fetch'));
  });
});
