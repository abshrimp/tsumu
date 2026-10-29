import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { transformSync } from "esbuild";
import { generateProject } from "../lib/generator";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { generateStandaloneHtml } from "../lib/generator/html-export";
import { assetSrc } from "../lib/assets";
import { makeText, createInitialDoc, makeBox } from "../lib/presets";
import { type SiteDoc, type Script } from "../lib/types";
import { createRequire } from "node:module";
import { isSiteLang, pageLangOf, SITE_LANGS, siteLangOf } from "../lib/site-lang";
import { useEditor } from "../lib/store";
import { buildComponentNames, buildAssetNames, buildClassNames } from "../lib/generator/names";
import { runInNewContext } from "node:vm";
import { pageNodeIds } from "../lib/script";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { anchorFixture, renderAnchorExport } from "./helpers/instance-anchor";

describe("generator-framework-boundaries", () => {
  function fixture(slug = ""): SiteDoc {
    return {
      siteName: "Framework boundaries", lang: "en", nodes: {
        text: { ...makeText("Ordinary page"), id: "text" },
      }, assets: {}, pageOrder: ["home"], pages: {
        home: { id: "home", name: "Home", title: "Home", description: "", slug,
          children: ["text"] },
      },
    };
  }

  async function routeHtml(source: string): Promise<string> {
    const mod = { exports: {} as { GET: () => Response } };
    const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
    new Function("module", "exports", code)(mod, mod.exports);
    return mod.exports.GET().text();
  }

  for (const slug of ["_preview", "guides/_draft", "日本語", "café"]) {
    test(`imported HTML does not depend on Next.js route filenames: ${slug}`, async () => {
      const doc = fixture(slug);
      doc.pages.home.rawHtml = '<!doctype html><html><head></head><body>Imported page</body></html>';
      const before = structuredClone(doc);
      const next = generateProject(doc);
      const route = Object.entries(next.files).find(([path]) => path.endsWith("/route.ts"))!;
      assert.ok(route);
      const expected = await routeHtml(route[1]);
      const exported = generateExportProject(doc, "html");
      assert.equal(exported.files["index.html"], expected);
      assert.deepEqual(doc, before);
    });
  }

  for (const separator of ["\u2028", "\u2029"]) {
    test(`imported HTML preserves Unicode separator U+${separator.codePointAt(0)!.toString(16)}`, async () => {
      const doc = fixture();
      doc.pages.home.rawHtml = '<!doctype html><html><head></head><body><p>Before' + separator +
        'after</p><script>window.message = "first' + separator + 'last";</script></body></html>';
      const expected = await routeHtml(generateProject(doc).files["app/route.ts"]);
      assert.equal(generateExportProject(doc, "html").files["index.html"], expected);
      const single = await prepareExportProject(doc, "single-html");
      assert.ok(single.files["index.html"].includes("Before" + separator + "after"));
      assert.ok(single.files["index.html"].includes("first" + separator + "last"));
    });
  }

  test("distinct static HTML routes preserve their content when Next.js filenames collide", () => {
    const doc = fixture("--");
    doc.pages.home.rawHtml = '<html><head></head><body>ASCII route</body></html>';
    doc.pages.other = { ...doc.pages.home, id: "other", slug: "日本",
      rawHtml: '<html><head></head><body>Japanese route</body></html>' };
    doc.pageOrder.push("other");
    const output = generateExportProject(doc, "html");
    assert.match(output.files["--/index.html"], /ASCII route/);
    assert.doesNotMatch(output.files["--/index.html"], /Japanese route/);
    assert.match(output.files["日本/index.html"], /Japanese route/);
  });

  test("React keeps distinct public routes when Next.js groups their generated JSX", () => {
    const doc = fixture("caf-");
    doc.nodes.other = { ...makeText("Accented route"), id: "other" };
    doc.pages.other = { ...doc.pages.home, id: "other", slug: "café", children: ["other"] };
    doc.pageOrder.push("other");
    const output = generateExportProject(doc, "react");
    assert.match(output.files["src/pages/Page0.tsx"], /Ordinary page/);
    assert.doesNotMatch(output.files["src/pages/Page0.tsx"], /Accented route/);
    assert.match(output.files["src/pages/Page1.tsx"], /Accented route/);
    assert.ok(output.files["src/App.tsx"].includes('path: "/caf-"'));
    assert.ok(output.files["src/App.tsx"].includes('path: "/café"'));
  });

  test("imported HTML has output parity with published HTML using only shared styles and assets", async () => {
    const doc = fixture();
    doc.breakpoints = [{ id: "mobile", label: "Mobile", maxWidth: 640 }];
    doc.assets.logo = { id: "logo", name: "logo.svg", width: 10, height: 10,
      mimeType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" };
    doc.assets.remote = { ...doc.assets.logo, id: "remote", name: "remote.svg",
      dataUrl: undefined, path: "assets/remote.svg" };
    const source = assetSrc(doc.assets.logo);
    doc.pages.home.rawHtml = '<!doctype html><html><head><title>Keep &amp; preserve</title></head>' +
      '<body><img src="' + source + '"><script>window.literal = "/assets/keep";</script></body></html>';
    doc.pages.home.htmlBackground = "#f0f0f0";
    doc.pages.home.bodyStyles = {
      base: { default: { backgroundImage: 'url("' + source + '")', color: "red" } },
      mobile: { default: { padding: "12px" } },
    };
    const before = structuredClone(doc);
    const next = generateProject(doc);
    const expected = (await routeHtml(next.files["app/route.ts"]))
      .replace('src="/assets/logo.svg"', 'src="./assets/logo.svg"')
      .replace('url("/assets/logo.svg")', 'url("./assets/logo.svg")');
    const shared = { ...next, files: Object.fromEntries(Object.entries(next.files).filter(([path]) =>
      path.startsWith("public/") || path === "styles/site.css" || path === "app/globals.css")) };
    const output = generateStandaloneHtml(doc, shared);
    assert.equal(output.files["index.html"], expected);
    assert.match(expected, /padding: 12px/);
    assert.match(expected, /window.literal = "\/assets\/keep"/);
    assert.deepEqual(output.binaries, { "assets/logo.svg": "PHN2Zy8+" });
    assert.deepEqual(output.remoteAssets, { "assets/remote.svg": "assets/remote.svg" });
    assert.deepEqual(output, generateExportProject(doc, "html"));
    assert.deepEqual(output, await prepareExportProject(doc, "html"));
    assert.deepEqual(next, generateExportProject(doc, "nextjs"));
    assert.deepEqual(doc, before);
  });

  test("raw-page styles and robots metadata preserve authored head text and the doctype", async () => {
    const doc = fixture();
    doc.pages.home.noindex = true;
    const comment = "<!-- header example: <head> -->";
    const script = '<script>const headEnd = "</head>";</script>';
    for (const source of [
      comment + '<!doctype html><html><head>' + script + '</head><body>Page</body></html>',
      comment + '<!doctype html>' + script + '<main>Page</main>',
    ]) {
      doc.pages.home.rawHtml = source;
      const next = generateProject(doc);
      const production = generateExportProject(doc, "html");
      const preview = await prepareExportProject(doc, "html", "test");
      for (const [output, target] of [
        [await routeHtml(next.files["app/route.ts"]), "production"],
        [production.files["index.html"], "production"], [preview.files["index.html"], "test"],
      ]) {
        assert.ok(output.startsWith(comment + "<!doctype html>"));
        assert.ok(output.includes(script));
        assert.match(output, /<style data-editor-body-style>/);
        const robots = output.match(/<meta name="robots" content="([^"]+)">/g) ?? [];
        assert.equal(robots.length, 1);
        assert.match(robots[0], target === "test" ? /noarchive/ : /noindex,\s*nofollow/);
      }
    }
  });

  test("test-target HTML is independent of Next.js publication route removal", async () => {
    const doc = fixture("robots.txt");
    doc.pages.home.rawHtml = '<html><head></head><body>Authored page</body></html>';
    assert.equal(generateProject(doc, "test").files["app/robots.txt/route.ts"], undefined);
    const output = await prepareExportProject(doc, "html", "test");
    assert.match(output.files["index.html"], /Authored page/);
    assert.match(output.files["index.html"], /<meta name="robots" content="noindex, nofollow/);
    assert.equal(output.files["robots.txt"], "User-agent: *\nDisallow: /\n");
  });

  for (const slug of ["_preview", "guides/_draft", "日本語", "café"]) {
    for (const variants of [false, true]) {
      test(`React locates Next.js-generated JSX while retaining its public route: ${slug}, variants=${variants}`, async () => {
        const doc = fixture(slug);
        if (variants) {
          doc.nodes.variant = { ...makeText("Query variant"), id: "variant" };
          doc.pages.variant = { ...doc.pages.home, id: "variant", query: "mode=detail", children: ["variant"] };
          doc.pageOrder.push("variant");
        }
        const before = structuredClone(doc);
        const output = generateExportProject(doc, "react");
        assert.match(output.files["src/pages/Page0.tsx"], /Ordinary page/);
        assert.ok(output.files["src/App.tsx"].includes('path: ' + JSON.stringify("/" + slug)));
        if (variants) assert.match(output.files["src/pages/Page1.tsx"], /Query variant/);
        assert.deepEqual(await prepareExportProject(doc, "react"), output);
        assert.deepEqual(doc, before);
      });
    }
  }
});

describe("opengraph-site-name", () => {
  const require=createRequire(import.meta.url);
  // この印には、実行時の動作が無い。Next.js の実際のメタデータの解決はそのまま使う。
  const Module=require('node:module'),originalLoad=Module._load;
  let accumulateMetadata:any;
  try {
   Module._load=function(id:string,...args:any[]){return id==='server-only'?{}:originalLoad.call(this,id,...args);};
   ({accumulateMetadata}=require('next/dist/lib/metadata/resolve-metadata'));
  } finally {Module._load=originalLoad;}
  function fixture(dynamic:boolean,override:boolean):SiteDoc {
   return {siteName:'Brand "quoted" & 日本',siteUrl:'https://example.com',ogImage:{url:'https://example.com/default.png'},nodes:{},assets:{},pageOrder:['p'],pages:{p:{id:'p',name:'Page',title:'Page title',description:'Description',slug:dynamic?'posts/[slug]':'',children:[],
   ...(override?{ogImage:{url:'https://example.com/page.png'}}:{}),
   ...(dynamic?{pageScripts:[{id:'load',trigger:'load',steps:[{id:'fetch',kind:'fetch',url:'https://example.com/posts/{slug}',as:'response'},{id:'set',kind:'set-var',value:'{response}',into:'post'}]}]}:{}),
   }}};
  }
  for(const dynamic of [false,true])for(const override of [false,true])test(`Next resolved OGP retains site name (${dynamic?'dynamic':'static'}, ${override?'page':'default'} image)`,async()=>{
   const doc=fixture(dynamic,override),files=generateProject(doc).files;
   const layoutSource=files['app/layout.tsx'];
   const layout=new Function('return ('+layoutSource.match(/export const metadata: Metadata = (\{[\s\S]*?\n\});/)![1]+')')();
   const pageSource=files[dynamic?'app/posts/[slug]/page.tsx':'app/page.tsx'];
   let page:any;
   if(dynamic){
    const source=pageSource.slice(pageSource.indexOf('export async function generateMetadata'),pageSource.indexOf('export default'));
    assert.ok(source,'exercise generated dynamic metadata');
    const mod={exports:{} as any};
    new Function('module','exports','loadData',transformSync(source,{loader:'ts',format:'cjs'}).code)(mod,mod.exports,async()=>{});
    page=await mod.exports.generateMetadata({params:Promise.resolve({slug:'one'}),searchParams:Promise.resolve({})});
   }else page=new Function('return ('+pageSource.match(/export const metadata: Metadata = (\{[\s\S]*?\n\});/)![1]+')')();
   const resolved=await accumulateMetadata('/',[[layout,null],[page,null]],'/',{pathname:'/',trailingSlash:false,isStaticMetadataRouteFile:false});
   assert.equal(resolved.openGraph.siteName,doc.siteName);
   assert.equal(resolved.openGraph.images[0].url,override?'https://example.com/page.png':'https://example.com/default.png');
   assert.equal(resolved.openGraph.title.absolute,'Page title');
   assert.equal(resolved.openGraph.description,'Description');
  });
});

describe("site-language", () => {
  test("custom language codes use the same validation as existing saved documents", () => {
    for (const code of [...SITE_LANGS.map((lang) => lang.value), "en-US", "pt-BR", "zh-Hant-TW", "fil", "es-419"]) {
      assert.equal(isSiteLang(code), true, code);
    }
    for (const code of ["", " ", "en_US", "en--US", "English", "en US", '<script>', 'en"']) {
      assert.equal(isSiteLang(code), false, code);
    }
  });

  test("custom site and page languages survive editing, serialization and generated output", () => {
    useEditor.getState().replaceDoc(createInitialDoc());
    const pageId = useEditor.getState().doc.pageOrder[0];
    useEditor.getState().updateDoc((doc) => { doc.lang = "pt-BR"; doc.pwa = { enabled: true }; });
    useEditor.getState().updatePage(pageId, { lang: "en-US" });
    const doc = JSON.parse(JSON.stringify(useEditor.getState().doc));
    assert.equal(siteLangOf(doc), "pt-BR");
    assert.equal(pageLangOf(doc, doc.pages[pageId]), "en-US");
    const { files } = generateProject(doc);
    assert.match(files["app/layout.tsx"], /<html lang="pt-BR">/);
    assert.match(files["app/manifest.ts"], /"lang": "pt-BR"/);
    assert.match(files["app/page.tsx"], /lang="en-US"/);

    useEditor.getState().updatePage(pageId, { lang: undefined });
    const inherited = useEditor.getState().doc;
    assert.equal(pageLangOf(inherited, inherited.pages[pageId]), "pt-BR");
    assert.doesNotMatch(generateProject(inherited).files["app/page.tsx"], /lang=/);
  });

  test("existing custom codes keep their spelling and invalid values keep the existing fallback", () => {
    assert.equal(siteLangOf({ lang: "en-us" }), "en-us");
    assert.equal(pageLangOf({ lang: "pt-BR" }, { lang: "es-419" }), "es-419");
    assert.equal(siteLangOf({ lang: "not a language" }), "ja");
    assert.equal(pageLangOf({ lang: "pt-BR" }, { lang: "en_US" }), "pt-BR");
  });
});

describe("component-output-name-portability", () => {
  function fixture(names:string[]):SiteDoc {
    const doc:SiteDoc={siteName:'Components',assets:{},nodes:{},components:{},pageOrder:['p'],pages:{p:{id:'p',name:'Home',title:'Home',description:'',slug:'',children:[]}}};
    names.forEach((name,i)=>{
      const id='component'+i,rootId='root'+i,instance='instance'+i;
      doc.components![id]={id,name,rootId};
      doc.nodes[rootId]={...makeBox(),id:rootId};
      doc.nodes[instance]={...makeBox(),id:instance,type:'instance',componentId:id};
      doc.pages.p.children.push(instance);
    });
    return doc;
  }
  for(const names of [['Hero','HERO','Hero2','hero'],['Con','Aux','NUL','COM1','Lpt9','Prn'],['image','IMAGE','Page','PAGE','page2']]) {
    test(`component output names remain portable: ${names.join(',')}`,()=>{
      const doc=fixture(names),assigned=[...buildComponentNames(doc).values()];
      assert.equal(new Set(assigned.map(n=>n.toLowerCase())).size,names.length);
      assert.ok(assigned.every(n=>!/^(con|aux|nul|com[1-9]|lpt[1-9]|prn)$/i.test(n)));
      for(const framework of ['nextjs','react'] as const) {
        const {files}=generateExportProject(doc,{framework,language:'typescript',style:'css',scope:'project'});
        const prefix=framework==='nextjs'?'components/':'src/components/';
        for(const name of assigned)assert.ok(files[prefix+name+'.tsx'],`${framework}: ${name}`);
        const page=Object.entries(files).find(([p])=>framework==='nextjs'?p==='app/page.tsx':p==='src/pages/Page0.tsx')![1];
        for(const name of assigned)assert.ok(page.includes('/components/'+name),`${framework}: import ${name}`);
      }
      assert.deepEqual(Object.values(doc.components!).map(c=>c.name),names,'authored names remain unchanged');
    });
  }
  test('ordinary readable component names retain stable output',()=>{
    assert.deepEqual([...buildComponentNames(fixture(['Hero','Footer','Call to action'])).values()],['Hero','Footer','CallToAction']);
  });

  test('long component labels export with bounded unique filenames and matching imports',()=>{
    const names=['A'.repeat(300),'A'.repeat(299)+'B','a'.repeat(300)];
    const doc=fixture(names),assigned=[...buildComponentNames(doc).values()];
    assert.deepEqual(assigned,['A'.repeat(120),'A'.repeat(120)+'2','A'+'a'.repeat(119)+'3']);
    for(const framework of ['nextjs','react'] as const) {
      const {files}=generateExportProject(doc,{framework,language:'typescript',style:'css',scope:'project'});
      const prefix=framework==='nextjs'?'components/':'src/components/';
      const page=files[framework==='nextjs'?'app/page.tsx':'src/pages/Page0.tsx'];
      for(const name of assigned) {
        assert.ok(files[prefix+name+'.tsx']);
        assert.ok(page.includes('/components/'+name));
        assert.ok(new TextEncoder().encode(name+'.tsx').length<=255);
      }
    }
    assert.deepEqual(Object.values(doc.components!).map(c=>c.name),names);
  });
});

describe("generator-name-allocation", () => {
  function fixture(names: string[]): SiteDoc {
    return {
      siteName: "Names", pages: {}, pageOrder: [],
      nodes: Object.fromEntries(names.map((name, i) => [String(i), {
        id: String(i), name, type: "box", semantic: "div", children: [], styles: {},
      }])),
      assets: Object.fromEntries(names.map((name, i) => [String(i), {
        id: String(i), name, width: 1, height: 1,
      }])),
      components: Object.fromEntries(names.map((name, i) => [String(i), {
        id: String(i), name, rootId: String(i),
      }])),
    };
  }

  test("class names preserve ordered collisions with authored numeric suffixes", () => {
    const names = ["Box", "Box", "Box-2", "BOX", "Box-3", "Box", "ボックス", "Box-4", "Box"];
    const doc = fixture(names), before = structuredClone(doc);
    assert.deepEqual([...buildClassNames(doc).values()], [
      "box", "box-2", "box-2-2", "box-3", "box-3-2", "box-4", "box-5", "box-4-2", "box-6",
    ]);
    assert.deepEqual(doc, before);
  });

  test("asset names preserve case, extensions and authored suffix collisions", () => {
    assert.deepEqual([...buildAssetNames(fixture([
      "logo.png", "LOGO.png", "logo-2.png", "logo.png", "logo.PNG", "logo-3.PNG", "logo.jpg",
    ])).values()], [
      "logo.png", "LOGO-2.png", "logo-2-2.png", "logo-3.png", "logo-4.PNG", "logo-3-2.PNG", "logo.jpg",
    ]);
  });

  test("component names preserve reserved names and numeric suffix precedence", () => {
    assert.deepEqual([...buildComponentNames(fixture([
      "Hero", "Hero", "Hero2", "HERO", "Hero3", "Hero", "Image", "Image", "Image2", "CON", "con", "Con2",
    ])).values()], [
      "Hero", "Hero2", "Hero22", "HERO3", "Hero32", "Hero4", "Image2", "Image3", "Image22", "CON2", "Con3", "Con22",
    ]);
  });

  test("document-size repeated labels receive distinct readable output names", () => {
    const doc = fixture(Array<string>(25000).fill("ボックス"));
    const classes = buildClassNames(doc);
    assert.equal(classes.size, 25000);
    assert.equal(new Set(classes.values()).size, 25000);
    assert.equal(classes.get("0"), "box");
    assert.equal(classes.get("24999"), "box-25000");
    const assets = buildAssetNames(fixture(Array<string>(1000).fill("logo.png")));
    assert.equal(new Set(assets.values()).size, 1000);
    assert.equal(assets.get("999"), "logo-1000.png");
    const components = buildComponentNames(fixture(Array<string>(1000).fill("Hero")));
    assert.equal(new Set(components.values()).size, 1000);
    assert.equal(components.get("999"), "Hero1000");
  });
});

describe("live-navigation", () => {
  test('live fields initialize after client navigation without requiring typing', () => {
    const doc: SiteDoc = { siteName: 'Live navigation', pages: {}, pageOrder: ['a', 'b'], nodes: {}, assets: {} };
    for (const id of doc.pageOrder) {
      doc.pages[id] = { id, name: id, slug: id === 'a' ? '' : 'second', title: id, description: '', children: [id + 'field', id + 'text', id + 'dependent'] };
      doc.nodes[id + 'field'] = { ...makeBox(), id: id + 'field', type: 'field', attrId: 'name', field: { kind: 'input', defaultValue: id === 'a' ? 'Alice' : 'Bob' } };
      doc.nodes[id + 'dependent'] = { ...makeBox(), id: id + 'dependent', type: 'field', attrId: 'dependent', field: { kind: 'input', placeholder: 'For {name}', defaultValue: '{name}' } };
      doc.nodes[id + 'text'] = { ...makeBox(), id: id + 'text', text: { content: 'Hello {name}', heading: 0 } };
    }
    const { files } = generateProject(doc);
    assert.match(files['app/second/page.tsx'], /data-live=/);
    let mutation: (() => void) | undefined;
    const frames: Array<() => void> = [];
    let pid = 'a';
    let input = { value: 'Alice', type: 'text', matches: () => true };
    const text = () => ({ firstChild: { nodeType: 3, nodeValue: 'Hello ' }, getAttribute: () => 'Hello {name}' });
    let output = text();
    const dependent = () => ({ value: '', placeholder: '', edited: false, setAttribute(name: string) { if (name === 'data-edited') this.edited = true; }, hasAttribute(name: string) { return name === 'data-edited' && this.edited; }, getAttribute: (name: string) => name === 'data-live-placeholder' ? 'For {name}' : '{name}' });
    let field = dependent();
    const listeners = new Map<string, Function>();
    const root = {
      querySelector: (selector: string) => selector === '[data-page-body]' ? { getAttribute: () => pid } : null,
      querySelectorAll: (selector: string) => selector === '#name' ? [input] : selector === '[data-live]' ? [output] : selector === '[data-live-placeholder]' || selector === '[data-live-value]' ? [field] : [],
      addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
      removeEventListener: () => {},
    };
    let observedOptions: unknown;
    runInNewContext(files['public/scripts.js'], {
      document: root, CSS: { escape: (s: string) => s }, location: { search: '' }, URLSearchParams,
      MutationObserver: class { constructor(fn: () => void) { mutation = fn; } observe(_root: unknown, options: unknown) { observedOptions = options; } disconnect() {} },
      requestAnimationFrame: (fn: () => void) => frames.push(fn),
    });
    assert.equal(output.firstChild.nodeValue, 'Hello Alice');
    assert.equal(field.value, 'Alice');
    assert.equal(field.placeholder, 'For Alice');
    // Next.js の Link は、レイアウトの next/script を取り付けたまま、ページの DOM を置き換える。
    pid = 'b'; input = { value: 'Bob', type: 'text', matches: () => true }; output = text(); field = dependent();
    mutation?.();
    while (frames.length) frames.shift()!();
    assert.equal(output.firstChild.nodeValue, 'Hello Bob');
    assert.equal(field.value, 'Bob');
    assert.equal(field.placeholder, 'For Bob');
    // 後の変更の走査でも、訪問者がすでに編集した値を保たなければならない。
    field.value = 'Custom'; listeners.get('input')!({ target: field, isTrusted: true });
    assert.equal(field.edited, true);
    mutation?.();
    while (frames.length) frames.shift()!();
    assert.equal(field.value, 'Custom');
    // その後の通常の編集でも、新しいページが更新される。
    input.value = 'Bobby'; listeners.get('input')!({ target: input, isTrusted: false });
    assert.equal(output.firstChild.nodeValue, 'Hello Bobby');
    assert.equal(field.placeholder, 'For Bobby');
    assert.equal(field.value, 'Custom');
    assert.equal(JSON.stringify(observedOptions), JSON.stringify({ childList: true, subtree: true, attributes: true, attributeFilter: ['data-scripts', 'data-page-body', 'data-list-seeds'] }));
  });
});

describe("instance-clone-anchors", () => {
  function fixture(): SiteDoc {
    return {
      siteName: "Anchors", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["first", "second", "fallback"] } },
      components: { card: { id: "card", name: "Card", rootId: "root" }, inner: { id: "inner", name: "Inner", rootId: "innerRoot" } },
      nodes: {
        first: { ...makeBox(), id: "first", type: "instance", componentId: "card", attrId: "first-card" },
        second: { ...makeBox(), id: "second", type: "instance", componentId: "card", attrId: "second-card" },
        fallback: { ...makeBox(), id: "fallback", type: "instance", componentId: "card" },
        root: { ...makeBox(), id: "root", attrId: "master-card", semantic: "div", children: ["nested"] },
        nested: { ...makeBox(), id: "nested", type: "instance", componentId: "inner", attrId: "nested-card" },
        innerRoot: { ...makeBox(), id: "innerRoot", attrId: "inner-master", semantic: "div" },
      },
    };
  }

  for (const operation of ["duplicate", "paste"] as const) {
    test(`${operation} reserves attached instance anchors and supports undo/redo`, () => {
      const doc = fixture();
      useEditor.getState().replaceDoc(doc);
      useEditor.getState().setActivePage("p");
      if (operation === "duplicate") useEditor.getState().duplicateNode("first");
      else {
        useEditor.getState().copyNode("first");
        useEditor.getState().select("first");
        useEditor.getState().pasteClipboard();
      }
      const state = useEditor.getState();
      assert.equal(state.doc.nodes[state.selection!].attrId, "first-card-2");
      const copyId = state.selection!;
      state.detachInstance("first");
      useEditor.getState().detachInstance(copyId);
      const detached = useEditor.getState().doc;
      const anchors = detached.pages.p.children.map((id) => detached.nodes[id].attrId);
      assert.equal(anchors.filter((id) => id === "first-card").length, 1);
      assert.equal(anchors.filter((id) => id === "first-card-2").length, 1);
      const page = generateProject(detached).files["app/page.tsx"];
      assert.equal((page.match(/id="first-card"/g) ?? []).length, 1);
      assert.equal((page.match(/id="first-card-2"/g) ?? []).length, 1);
      // 解除を2回元に戻してから、複製の履歴の境界を確かめる。
      useEditor.getState().undo();
      useEditor.getState().undo();
      const after = structuredClone(useEditor.getState().doc);
      state.undo();
      assert.deepEqual(useEditor.getState().doc, doc);
      useEditor.getState().redo();
      assert.deepEqual(useEditor.getState().doc, after);
    });
  }


  test("ID collection includes instance placements only when explicitly requested", () => {
    const doc = fixture();
    assert.deepEqual(pageNodeIds(doc, "p"), ["root", "innerRoot"]);
    assert.deepEqual(pageNodeIds(doc, "p", [], true), ["first", "root", "nested", "innerRoot", "second", "fallback"]);
    // 使われていないマスターの編集中も、そこにあるインスタンスの ID を予約する。
    doc.pages.p.children = [];
    assert.deepEqual(pageNodeIds(doc, "p", ["root"], true), ["root", "nested", "innerRoot"]);
  });
});

describe("generator-script-query", () => {
  const require = createRequire(import.meta.url);
  const script = (steps: Script["steps"]): Script => ({ id: "s", trigger: "click", steps });
  function fixture(s: Script, pageScript = false): SiteDoc {
    const node = { ...makeBox(), id: "button", ...(pageScript ? {} : { scripts: [s] }) };
    return {
      siteName: "Query test", assets: {}, nodes: { button: node }, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["button"], ...(pageScript ? { pageScripts: [{ ...s, trigger: "load" }] } : {}) } },
    };
  }
  async function renderedScript(doc: SiteDoc, query: Record<string, string>, pageScript = false) {
    const source = generateProject(doc).files["app/page.tsx"];
    assert.match(source, /export const dynamic = "force-dynamic"/);
    const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    const mod = { exports: {} as { default: (props: object) => Promise<any> } };
    const localRequire = (name: string) => require(name === "@/lib/vars" ? "../lib/vars" : name);
    new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
    const tree = await mod.exports.default({ searchParams: Promise.resolve(query) });
    return JSON.parse(tree.props.children[pageScript ? 0 : 1].props["data-scripts"]);
  }

  test("クエリをスクリプトだけで使う場合も、リクエストごとの値を渡す", async () => {
    const doc = fixture(script([{ id: "go", kind: "open-url", url: "/search?q={q}" }]));
    for (const q of ["hello world", "another"]) {
      const scripts = await renderedScript(doc, { q });
      assert.equal(scripts[0].steps[0].url, `/search?q=${encodeURIComponent(q)}`);
    }
  });

  test("ページの条件分岐にしかないクエリも失われない", async () => {
    const doc = fixture(script([{ id: "if", kind: "if", cond: { subject: "var", target: "", left: "{campaign}", op: "eq", value: "sale" }, then: [{ id: "go", kind: "open-url", url: "/sale?from={source}" }] }]), true);
    const scripts = await renderedScript(doc, { campaign: "sale", source: "mail" }, true);
    assert.deepEqual(scripts[0].steps[0].cond.left, { inputRef: "campaign", raw: "sale" });
    assert.equal(scripts[0].steps[0].then[0].url, "/sale?from=mail");
  });

  test("画面上で作る変数だけのスクリプトは ISR を維持する", () => {
    const doc = fixture(script([{ id: "set", kind: "set-var", into: "local", value: "hello" }, { id: "go", kind: "open-url", url: "/search?q={local}" }]));
    const source = generateProject(doc).files["app/page.tsx"];
    assert.match(source, /export const revalidate = 60/);
    assert.doesNotMatch(source, /await searchParams/);
  });

  test("クリック時にクエリを変数へコピーする場合も元の値を渡す", async () => {
    const doc = fixture(script([{ id: "copy", kind: "set-var", into: "local", value: "{source}" }]));
    const scripts = await renderedScript(doc, { source: "newsletter" });
    assert.equal(scripts[0].steps[0].raw, "newsletter");
  });


  test("ブラウザで同名の変数を作っても、配信前の取得にはクエリを使う", () => {
    const doc = fixture(script([{ id: "set", kind: "set-var", into: "q", value: "clicked" }]));
    doc.nodes.button.link = { kind: "url", url: "/?q=initial" };
    doc.pages.p.pageScripts = [{
      id: "load", trigger: "load",    steps: [{ id: "fetch", kind: "fetch", url: "https://example.com/api?q={q}", as: "result" }],
    }];
    const source = generateProject(doc).files["app/page.tsx"];
    assert.match(source, /export const dynamic = "force-dynamic"/);
    assert.match(source, /await searchParams/);
    assert.doesNotMatch(source, /export const revalidate/);
  });
});

describe("published-instance-anchor", () => {
  const nodeViewUrl = new URL("../components/canvas/NodeView.tsx", import.meta.url);
  const nodeViewRequire = createRequire(nodeViewUrl);
  const { VarsCtx } = nodeViewRequire("./render");
  const nodeViewCode = transformSync(readFileSync(nodeViewUrl, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;

  function preview(doc: SiteDoc, id: string) {
    const mod = { exports: {} as { NodeView: any } };
    const state = { doc, mode: "preview", selectedIds: [], editingText: null };
    new Function("require", "module", "exports", nodeViewCode)((name: string) =>
      name === "../../lib/store" ? { useEditor: (select: any) => select(state) } : nodeViewRequire(name), mod, mod.exports);
    return renderToStaticMarkup(createElement(VarsCtx.Provider, {
      value: { preview: true, pageVars: {}, clientVars: new Set(), fieldValues: {}, refresh: () => {} },
    }, createElement(mod.exports.NodeView, { id, isTop: true })));
  }

  test("page instance anchors match preview, remain independent, and restore the master layout", () => {
    const doc = anchorFixture();
    const before = structuredClone(doc);
    const { html, files } = renderAnchorExport(doc);
    for (const id of ["first-card", "second-card"]) assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
    assert.match(html, /href="#first-card"/);
    assert.match(html, /id="first-card"[^>]*data-toggle-show="flex"/);
    assert.equal((html.match(/<div/g) ?? []).length, 2, "no layout wrappers");
    assert.match(preview(doc, "first"), /id="first-card"/);
    assert.match(preview(doc, "second"), /id="second-card"/);
    assert.deepEqual(generateProject(doc).files, files, "deterministic output");
    assert.deepEqual(doc, before, "source document is unchanged");
  });

  test("master IDs and authored references take priority over conflicting instance settings", () => {
    const doc = anchorFixture();
    doc.nodes.root.attrId = "master";
    doc.nodes.root.children = ["child", "custom"];
    doc.nodes.root.customCss = "--anchor-note: master; color: red";
    doc.nodes.child = { ...makeBox(), id: "child", link: { kind: "url", url: "#master" }, scripts: [{ id: "hide", trigger: "click", steps: [{ id: "hide-step", kind: "hide", target: "master" }] }] };
    doc.nodes.custom = { ...makeBox(), id: "custom", type: "code", code: { html: '<span data-note="master"><style>#master { color: red; }</style></span>' } };
    const before = structuredClone(doc);
    const output = renderAnchorExport(doc);
    const noInstanceIds = structuredClone(doc);
    delete noInstanceIds.nodes.first.attrId;
    delete noInstanceIds.nodes.second.attrId;
    assert.deepEqual(output.files, generateProject(noInstanceIds).files, "ignored conflicts cannot rewrite authored references");
    assert.equal((output.html.match(/id="master"/g) ?? []).length, 2);
    assert.ok(!output.html.includes('id="first-card"'));
    assert.match(output.html, /href="#master"/);
    assert.match(output.html, /&quot;target&quot;:&quot;master&quot;/);
    assert.match(preview(doc, "first"), /id="master"/);
    assert.deepEqual(doc, before);
  });

  test("nested placements and instance-root aliases do not gain new IDs", () => {
    const doc = anchorFixture();
    doc.components!.inner = { id: "inner", name: "Inner", rootId: "innerRoot" };
    doc.nodes.root.children = ["nested"];
    doc.nodes.nested = { ...makeBox(), id: "nested", type: "instance", componentId: "inner", attrId: "nested-anchor" };
    doc.nodes.innerRoot = { ...makeBox(), id: "innerRoot", semantic: "div" };
    assert.ok(!renderAnchorExport(doc).html.includes('id="nested-anchor"'));
    assert.ok(!preview(doc, "first").includes('id="nested-anchor"'));
    doc.components!.card.rootId = "nested";
    const html = renderAnchorExport(doc).html;
    assert.ok(!html.includes('id="first-card"'));
    assert.ok(!html.includes('id="nested-anchor"'));
  });

  test("unanchored instances stay unanchored and IDs are escaped as JSX data", () => {
    const doc = anchorFixture();
    delete doc.nodes.second.attrId;
    doc.nodes.first.attrId = 'anchor"<&';
    const { html } = renderAnchorExport(doc);
    assert.match(html, /id="anchor&quot;&lt;&amp;"/);
    assert.equal((html.match(/data-toggle-show=/g) ?? []).length, 1);
  });

  test("the generated anchored project passes TypeScript checking", () => {
    const { files } = generateProject(anchorFixture());
    const dir = mkdtempSync(join(tmpdir(), "tsumu-instance-anchor-"));
    try {
      symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      execFileSync(resolve("node_modules/.bin/tsc"), ["--project", join(dir, "tsconfig.json"), "--noEmit", "--incremental", "false"], { cwd: dir, stdio: "pipe" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
