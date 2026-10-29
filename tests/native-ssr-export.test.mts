import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import { type DocNode, type SiteDoc } from "../lib/types";
import { transformSync, buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { reactSource } from "../lib/generator/react-export";
import { pageHrefOf, pageQueryVars } from "../lib/vars";
import { loadGeneratedRoute } from "./helpers/generated-route";

describe("native-ssr-export", () => {
  function site(): SiteDoc {
    const box = (id: string, name: string) => ({ ...makeBox(), id, name });
    const heading = { ...box("heading", "Headline"),
      text: { content: "Results {count}", heading: 1 } };
    const image: DocNode = {
      ...box("image", "Photo"), type: "image",
      image: { src: "/assets/example.svg", alt: "Example", width: 120, height: 80 },
    };
    const input: DocNode = {
      ...box("input", "Search"), type: "field", attrId: "query",
      field: { kind: "input", inputType: "text", placeholder: "Search {category}", defaultValue: "" },
    };
    const item = { ...box("item", "Item"), text: { content: "{name}", heading: 0 } };
    const list: DocNode = { ...box("list", "List"), type: "list", list: { from: "items", limit: 10 },
      children: ["item"] };
    const reusable = box("reusable", "Reusable card");
    reusable.text = { content: "Reusable {count}", heading: 0 };
    const instance: DocNode = { ...box("instance", "Card instance"), type: "instance", componentId: "card" };
    return {
      siteName: "Native view",
      pages: { home: { id: "home", name: "Home", title: "Home", slug: "",
        description: "Rendered on the server", children: ["heading", "image", "input", "list", "instance"],
        pageScripts: [{
          id: "load", trigger: "load",        steps: [
            { id: "fetch", kind: "fetch", as: "items", url: "https://api.example.test/items?type={category}" },
            { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
          ],
        }] } },
      pageOrder: ["home"],
      nodes: { heading, image, input, item, list, instance, reusable },
      components: { card: { id: "card", name: "Reusable card", rootId: "reusable" } },
      assets: {},
    };
  }

  test("native template generators preserve safe imported HTML classes and attributes", () => {
    const doc = site();
    doc.nodes.heading.htmlClass = "external-heading";
    doc.nodes.heading.htmlAttrs = {
      "data-source": "imported",
      "aria-label": "Imported heading",
      "title": "Original {literal}",
      "tabIndex": "4",
      "onmouseover": "alert(1)",
      "data-tsumu-scripts": "untrusted",
    };
    for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
      const files = generateExportProject(doc, framework).files;
      const base = framework === "nuxt" ? "app/generated/" :
        framework === "sveltekit" ? "src/lib/" : "src/";
      const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
      const source = files[base + "pages/Page0" + suffix];
      assert.ok(source, framework);
      assert.match(source, /class="[^"]*external-heading/);
      assert.match(source, /data-source="imported"/);
      assert.match(source, /aria-label="Imported heading"/);
      assert.match(source, /title="Original &#123;literal&#125;"/);
      assert.match(source, /tabindex="4"/);
      assert.doesNotMatch(source, /onmouseover|data-tsumu-scripts/);
    }
  });

  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    test(framework + " emits native components, scoped lists, text and fields", () => {
      const project = generateExportProject(site(), framework);
      const base = framework === "nuxt" ? "app/generated/" :
        framework === "sveltekit" ? "src/lib/" : "src/";
      const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
      const component = project.files[base + "pages/Page0" + suffix];
      const widget = project.files[base + "components/Widget0" + suffix];
      assert.ok(component);
      assert.ok(widget);
      assert.match(component, /<h1|<div/);
      assert.match(component, /resolveText/);
      assert.match(component, /<img/);
      assert.match(component, /<input/);
      assert.match(component, /<Widget0/);
      assert.match(widget, /Reusable/);
      if (framework === "sveltekit") {
        assert.match(component, /\{#each listItems/);
        assert.match(component, /\{resolveText/);
        assert.doesNotMatch(component, /\{@html html\}/);
      } else {
        assert.match(component, /v-for=/);
        assert.match(component, /\{\{ resolveText/);
        assert.doesNotMatch(component, /v-html/);
      }
      const code = Object.entries(project.files).filter(([path]) =>
        !/\.md$/i.test(path) && path !== "vendor/picomatch/package.json");
      for (const [path, content] of code) assert.doesNotMatch(content, /tsumu/i, path);
    });

    test(framework + " includes an environment-neutral SSR-capable data interpreter", async () => {
      const project = generateExportProject(site(), framework);
      const base = framework === "nuxt" ? "app/generated/" :
        framework === "sveltekit" ? "src/lib/" : "src/";
      const source = project.files[base + "site-data.js"];
      assert.ok(source);
      assert.doesNotMatch(source, /document\.|window\.|location\.search/);
      const url = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
      const module = await import(url) as {
        loadPageData: (plan: unknown, query: string, request: typeof fetch) => Promise<Record<string, unknown>>;
      };
      const routes = project.files[base + "site-routes.js"];
      const routeModule = await import("data:text/javascript;base64," + Buffer.from(routes).toString("base64"));
      const plan = routeModule.pages[0].plan;
      const calls: string[] = [];
      const vars = await module.loadPageData(plan, "?category=books", async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify([{ name: "Alpha" }, { name: "Beta" }]), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      });
      assert.deepEqual(calls, ["https://api.example.test/items?type=books"]);
      assert.ok(Object.values(vars).includes(2));
      assert.ok(Object.values(vars).some((x) => Array.isArray(x) && x.length === 2));
    });
  }

  test("Nuxt and SvelteKit enable SSR with server-side route data loading", () => {
    const nuxt = generateExportProject(site(), "nuxt");
    assert.match(nuxt.files["nuxt.config.ts"], /ssr: true/);
    assert.match(nuxt.files["app/pages/index.vue"], /useAsyncData/);
    assert.match(nuxt.files["app/pages/index.vue"], /<Page0/);
    assert.match(nuxt.files["app/pages/[...slug].vue"], /useAsyncData/);
    const svelte = generateExportProject(site(), "sveltekit");
    assert.match(svelte.files["vite.config.ts"], /adapter-node/);
    assert.equal(svelte.files["svelte.config.js"], undefined);
    assert.match(svelte.files["src/routes/+page.server.js"], /export async function load/);
    assert.match(svelte.files["src/routes/+page.server.js"], /requestPublic/);
    assert.match(svelte.files["src/routes/+page.svelte"], /<Page0/);
    assert.match(svelte.files["src/routes/[...path]/+page.svelte"], /<Page0/);
    assert.match(svelte.files["src/routes/+layout.ts"] ?? svelte.files["src/routes/+layout.js"], /ssr = true/);
  });

  test("Vue with Vite also builds an SSR entry with hydration and native components", () => {
    const vue = generateExportProject(site(), "vue");
    assert.match(vue.files["src/App.vue"], /onMounted/);
    assert.ok(vue.files["src/pages/Page0.vue"]);
    assert.match(vue.files["src/App.vue"], /<Page0/);
    assert.match(vue.files["src/entry-server.ts"], /renderToString/);
    assert.match(vue.files["src/entry-client.ts"], /createSSRApp/);
    assert.match(vue.files["server.mjs"], /app-html/);
    assert.match(vue.files["package.json"], /vite build --ssr/);
    assert.doesNotMatch(vue.files["src/pages/Page0.vue"], /v-html/);
  });

  test("native exports keep image alt, media src and embed src literal while interpolating image src", () => {
    const doc = site();
    const literalText = "Photo {name} \\{name}";
    const literalMedia = "https://example.com/{name}/\\{name}/clip.mp4";
    const literalEmbed = "https://example.com/embed/{name}";
    doc.nodes.image.image = { src: "/images/{name}.png", alt: literalText, width: 120, height: 80 };
    doc.nodes.video = {
      ...makeBox(), id: "video", name: "Video", type: "media",
      media: { kind: "video", src: literalMedia, sources: [{ src: literalMedia, type: "video/mp4" }] },
    };
    doc.nodes.frame = {
      ...makeBox(), id: "frame", name: "Embed", type: "embed",
      embed: { kind: "url", src: literalEmbed },
    };
    doc.pages.home.children.push("video", "frame");

    for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
      const files = generateExportProject(doc, framework).files;
      const base = framework === "nuxt" ? "app/generated/" : framework === "sveltekit" ? "src/lib/" : "src/";
      const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
      const page = files[base + "pages/Page0" + suffix];
      assert.match(page, /resolveResourceUrl\((?:&quot;|")\/images\/\\u007bname\\u007d\.png(?:&quot;|")/);
      assert.match(page, /alt="Photo &#123;name&#125; \\&#123;name&#125;"/);
      assert.match(page, /<video[^>]* src="https:\/\/example\.com\/&#123;name&#125;\/\\&#123;name&#125;\/clip\.mp4"/);
      assert.match(page, /<source src="https:\/\/example\.com\/&#123;name&#125;\/\\&#123;name&#125;\/clip\.mp4"/);
      assert.match(page, /<iframe src="https:\/\/example\.com\/embed\/%7Bname%7D"/);
    }
  });

  test("native exports normalize /404 custom page and avoid orphan else blocks when only 404 exists", () => {
    const doc = site();
    doc.pages.home.slug = "/404/";
    for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
      const files = generateExportProject(doc, framework).files;
      const base = framework === "nuxt" ? "app/generated/" : framework === "sveltekit" ? "src/lib/" : "src/";
      const suffix = framework === "sveltekit" ? ".svelte" : ".vue";
      assert.ok(files[base + "pages/NotFound" + suffix], framework);
      assert.equal(files[base + "pages/Page0" + suffix], undefined);
      if (framework === "sveltekit") {
        assert.doesNotMatch(files["src/routes/+page.svelte"], /\{:else\}/);
        assert.match(files["src/routes/+page.svelte"], /<NotFound \{scope\} \/>/);
        assert.match(files["src/routes/+error.svelte"], /<NotFound scope=\{\{\}\} \/>/);
      } else {
        const entry = framework === "nuxt" ? files["app/pages/index.vue"] : files["src/App.vue"];
        assert.doesNotMatch(entry, /v-else/);
        assert.match(entry, /<NotFound :scope="vars" \/>/);
      }
    }
  });

  test("React and native exports emit open-url handler in scripts.js for unnested inner links", () => {
    const outer = { ...makeBox(), id: "outer", name: "Outer", link: { kind: "url" as const, url: "https://example.com/outer" }, children: ["inner"] };
    const inner = { ...makeBox(), id: "inner", name: "Inner", link: { kind: "url" as const, url: "https://example.com/inner" }, text: { content: "Inner", heading: 0 } };
    const doc: SiteDoc = {
      siteName: "Nested link site",
      pageOrder: ["home"],
      pages: {
        home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["outer"] },
      },
      nodes: { outer, inner },
      assets: {},
    };
    for (const framework of ["react", "vue", "nuxt", "sveltekit", "html"] as const) {
      const files = generateExportProject(doc, framework).files;
      const scriptPath = framework === "sveltekit" ? "static/scripts.js" : framework === "html" ? "scripts.js" : "public/scripts.js";
      assert.ok(files[scriptPath], `${framework}: ${scriptPath} should be emitted`);
      assert.match(files[scriptPath], /case "open-url":/, framework);
    }
  });
});

describe("vue-ssr-not-found-render", () => {
  const doc:SiteDoc={siteName:'SSR fallback',lang:'ja',nodes:{},assets:{},pageOrder:['home'],pages:{
    home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
  }};
  for(const language of ['javascript','typescript'] as const) for(const style of ['css','css-modules'] as const) {
    test(`Vue ${language}/${style} SSR 404 renders the same App that the client hydrates`,async()=>{
      const files=generateExportProject(doc,{framework:'vue',language,style,scope:'project'}).files;
      const extension=language==='typescript'?'ts':'js';
      const App={source:files['src/App.vue']};
      assert.match(App.source,/<main v-else><h1>Not Found<\/h1><\/main>/);
      if(style==='css-modules')assert.match(App.source,/:class="siteStyles.siteRoot"/);
      assert.match(files[`src/entry-client.${extension}`],/createSSRApp\(App,/);
      const calls:any[]=[];
      const mod={exports:{} as any};
      new Function('require','module','exports',transformSync(files[`src/entry-server.${extension}`],{loader:'ts',format:'cjs'}).code)((id:string)=>{
        if(id==='vue')return {createSSRApp:(component:any,props:any)=>{assert.equal(component,App);calls.push(props);return {component,props};}};
        if(id==='vue/server-renderer')return {renderToString:async(app:any)=>{
          assert.equal(app.component,App);
          return `<div data-rendered-app="${style}"><main><h1>Not Found</h1></main></div>`;
        }};
        if(id==='./App.vue')return {__esModule:true,default:App};
        if(id==='./site-routes.js')return {selectPage:()=>null};
        if(id==='./site-data.js')return {loadPageData:()=>{assert.fail('missing routes must not load data');}};
        if(id==='./server-request.js')return {requestPublic:()=>{assert.fail('missing routes must not fetch');}};
        throw Error(id);
      },mod,mod.exports);
      const result=await mod.exports.render('https://site.example/does-not-exist');
      assert.deepEqual(calls,[{initialPageId:'',initialVars:{}}]);
      assert.equal(result.status,404);
      assert.equal(result.id,'');
      assert.deepEqual(result.vars,{});
      assert.equal(result.language,'ja');
      assert.match(result.html,/data-rendered-app=/,'SSR must use App renderer output, including its wrappers');
    });
  }
});

describe("native-page-language", () => {
  const doc: SiteDoc = { siteName: "Languages", lang: "ja", assets: {}, nodes: {}, pageOrder: ["home", "en"], pages: {
    home: { id: "home", name: "Home", title: "Home", description: "Japanese", slug: "", children: [] },
    en: { id: "en", name: "English", title: "English", description: "English page", lang: "en-GB", slug: "english", children: [] },
  } };
  test("Nuxt reactive useHead sets document language on SSR and route changes", () => {
    const files = generateExportProject(doc, "nuxt").files;
    const source = files["app/pages/index.vue"];
    const callback = /useHead\((\(\) => \(\{[\s\S]*?\}\))\);/.exec(source)?.[1];
    assert.ok(callback);
    const selected: any = { value: { title: "Home", description: "Japanese", language: "ja" } };
    const head = runInNewContext(callback, { selected });
    assert.equal(head().htmlAttrs?.lang, "ja");
    selected.value = { title: "English", description: "English page", language: "en-GB" };
    assert.equal(head().htmlAttrs?.lang, "en-GB");
    selected.value = null;
    assert.equal(head().htmlAttrs?.lang, "ja");
  });
  test("Svelte SSR hook selects and escapes the page language without duplicate static metadata", async () => {
    const files = generateExportProject(doc, "sveltekit").files;
    assert.ok(files["src/hooks.server.js"]);
    const routes: any = { URLSearchParams };
    runInNewContext(files["src/lib/site-routes.js"].replace(/\bexport /g, "") + "\nglobalThis.selectPage = selectPage;", routes);
    const context: any = { selectPage: routes.selectPage };
    runInNewContext(files["src/hooks.server.js"].replace(/^import .*;\n/m, "").replace(/\bexport /g, "") + "\nglobalThis.handle = handle;", context);
    for (const [path, lang] of [["/", "ja"], ["/english", "en-GB"], ["/missing", "ja"]]) {
      const html = await context.handle({ event: { url: new URL(path, "https://example.com") },
        resolve: (_: unknown, options: any) => options.transformPageChunk({ html: files["src/app.html"], done: true }) });
      assert.ok(html.includes(`<html lang="${lang}">`));
      assert.ok(!html.includes("%page.language%"));
      assert.ok(!html.includes("<title>"));
      assert.ok(!html.includes('name="description"'));
    }
    context.selectPage = () => ({ language: 'en" onload="bad<&' });
    const escaped = await context.handle({ event: { url: new URL("https://example.com") }, resolve: (_: unknown, options: any) => options.transformPageChunk({ html: files["src/app.html"] }) });
    assert.ok(escaped.includes('lang="en&quot; onload=&quot;bad&lt;&amp;"'));
  });
  test("Svelte updates html lang when navigation replaces page data", () => {
    const files = generateExportProject(doc, "sveltekit").files;
    const source = files["src/routes/+page.svelte"];
    const effect = /\$effect\((\(\) => \{ document\.documentElement\.lang = data\.language; \})\);/.exec(source)?.[1];
    assert.ok(effect);
    const context: any = { data: { language: "ja" }, document: { documentElement: { lang: "" } } };
    const apply = runInNewContext(effect, context);
    apply(); assert.equal(context.document.documentElement.lang, "ja");
    context.data = { language: "en-GB" };
    apply(); assert.equal(context.document.documentElement.lang, "en-GB");
  });
});

describe("react-export-script-types", () => {
  for (const language of ["typescript", "javascript"] as const) {
    for (const withScripts of [false, true]) {
      test(`React ${language} export compiles ${withScripts ? "with" : "without"} runtime scripts`, async () => {
        const doc: SiteDoc = {
          siteName: "Static React",
          pages: {
            home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["heading"] },
          },
          pageOrder: ["home"],
          nodes: { heading: { ...makeBox(), id: "heading", text: { content: "Hello", heading: 1 } } },
          assets: {},
        };
        if (withScripts) doc.pwa = { enabled: true };
        const project = await prepareExportProject(doc, { framework: "react", language, style: "css", scope: "project" });
        const extension = language === "typescript" ? "tsx" : "jsx";
        const app = project.files[`src/App.${extension}`];
        assert.match(app, withScripts ? /const scripts[^=]*=\s*\["\/pwa\.js"\]/ : /const scripts[^=]*=\s*\[\]/);
        assert.equal(Boolean(project.files["public/pwa.js"]), withScripts);

        const folder = mkdtempSync(join(tmpdir(), "tsumu-react-script-types-"));
        try {
          for (const [name, source] of Object.entries(project.files)) {
            const path = join(folder, name);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, source);
          }
          symlinkSync(resolve("node_modules"), join(folder, "node_modules"), "junction");
          if (language === "typescript") {
            const config = JSON.parse(project.files["tsconfig.json"]);
            // Vite そのものには依存せず、出力した React のソースのすべてを、strict の設定で検証する。
            config.compilerOptions.types = ["node"];
            config.include = ["src"];
            writeFileSync(join(folder, "src/css.d.ts"), 'declare module "*.css";\n');
            writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(config));
            try {
              execFileSync(resolve("node_modules/.bin/tsc"), ["--project", folder], { encoding: "utf8" });
            } catch (cause) {
              const error = cause as { stdout?: string; stderr?: string; message?: string };
              assert.fail("Generated React failed strict TypeScript checking:\n" +
                (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""));
            }
          } else {
            assert.doesNotMatch(app, /const scripts\s*:/);
            buildSync({
              entryPoints: [join(folder, "src/main.jsx")],
              bundle: true, write: false, outdir: join(folder, "dist"), jsx: "automatic",
            });
          }
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("react-export-literal-boundaries", () => {
  const require = createRequire(import.meta.url);
  const examples = [
    "Example: import 'next/link'; and import 'next'; from 'next/image'",
    '<Link href="/docs">Link example</Link> and <Image src="/photo.png" />',
    'export default async function Page() { return null; }\nconst sp = await searchParams;',
    "before\u2028import 'next/link';\u2029const sp = await searchParams;",
  ];

  function fixture(): SiteDoc {
    const children = examples.map((_, index) => `text_${index}`);
    const nodes = Object.fromEntries(examples.map((content, index) => [
      `text_${index}`,
      { ...makeText(content), id: `text_${index}`, attrId: `text_${index}` },
    ]));
    return {
      siteName: "Literal examples", assets: {}, pageOrder: ["home"],
      pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children } },
      nodes,
    };
  }

  for (const language of ["typescript", "javascript"] as const) {
    test(`React ${language} renders code-like authored text unchanged`, async () => {
      const doc = fixture();
      const before = structuredClone(doc);
      const project = await prepareExportProject(doc,
        { framework: "react", language, style: "css", scope: "project" });
      const source = project.files["src/pages/Page0." + (language === "typescript" ? "tsx" : "jsx")];
      const { code } = transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" });
      const module = { exports: {} as { default: () => ReturnType<typeof createElement> } };
      new Function("require", "module", "exports", code)(require, module, module.exports);
      const fragment = parseFragment(renderToStaticMarkup(createElement(module.exports.default)));
      const textOf = (node: Html.Node): string => "value" in node ? node.value :
        "childNodes" in node ? node.childNodes.map(textOf).join("") : "";
      const byId = new Map<string, Html.Node>();
      const visit = (node: Html.Node) => {
        if ("attrs" in node) {
          const id = node.attrs.find((attr) => attr.name === "id")?.value;
          if (id) byId.set(id, node);
        }
        if ("childNodes" in node) for (const child of node.childNodes) visit(child);
      };
      visit(fragment);
      for (const [index, content] of examples.entries()) {
        const target = byId.get(`text_${index}`);
        assert.ok(target, `missing rendered node text_${index}`);
        assert.equal(textOf(target), content);
      }
      assert.deepEqual(doc, before);
    });
  }

  test("React adaptation preserves literal HTML and still converts real inline JSX", () => {
    const literal = '<Link href="/example">Keep</Link><Image src="/keep.png" />';
    const source = 'import Link from "next/link";\nimport Image from "next/image";\n' +
      'export default function Page() { return <><Link href="/">Home</Link>' +
      '<Image src="/real.png" alt="Real" width={1} height={1} />' +
      '<div dangerouslySetInnerHTML={{ __html: ' + JSON.stringify(literal) + ' }} /></>; }';
    const adapted = reactSource(source);
    assert.ok(adapted.includes(JSON.stringify(literal)));
    assert.match(adapted, /<a href="\/">Home<\/a>/);
    assert.match(adapted, /<img src="\/real.png"/);
    for (const source of ['import { notFound } from "next/navigation";', 'import "next/unsupported";']) {
      assert.throws(() => reactSource(source), /Next.js-only imports/);
    }
  });
});

describe("vue-ssr-metadata", () => {
  const {parse}=createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
  const site='Site & "quoted"';
  const title='Page <unsafe> & "double" \'single\' <!--page-lang-->';
  const description='Description " onload="bad <script>alert(1)</script> & \'text\'';
  const doc:SiteDoc={siteName:site,lang:"ja",nodes:{},assets:{},pageOrder:["home","foreign"],pages:{
    home:{id:"home",name:"Home",title:"Home",description:"Home description",slug:"",children:[]},
    foreign:{id:"foreign",name:"Foreign",title,description,lang:"en-GB",slug:"foreign",children:[]},
  }};
  function harness(language:"javascript"|"typescript", sourceDoc: SiteDoc = doc) {
    const files=generateExportProject(sourceDoc,{framework:"vue",language,scope:"project"}).files;
    const modules=new Map<string,any>();
    const load=(path:string):any=>{
      if(modules.has(path))return modules.get(path);
      const module={exports:{} as any};modules.set(path,module.exports);
      const source=transformSync(files[path],{loader:"ts",format:"cjs"}).code;
      new Function("require","module","exports",source)((id:string)=>{
        if(id === "vue")return {createSSRApp:()=>({})};
        if(id === "vue/server-renderer")return {renderToString:async()=>'<p id="content">SSR</p>'};
        if(id === "./App.vue")return {default:{}};
        if(id.startsWith("./"))return load("src/"+id.slice(2));
        throw Error(id);
      },module,module.exports);
      modules.set(path,module.exports);return module.exports;
    };
    const render=load(`src/entry-server.${language === "typescript" ? "ts" : "js"}`).render;
    const source=files["server.mjs"];
    const begin=source.indexOf("async function handle(req, res) {");
    const end=source.indexOf("const server =",begin);
    assert.ok(begin>=0&&end>begin);
    const handle=runInNewContext(source.slice(begin,end)+"\nhandle",{
      URL,console,process:{env:{}},production:false,templateFile:"index.html",
      readFile:async()=>files["index.html"],
      vite:{ssrLoadModule:async()=>({render}),transformIndexHtml:async(_path:string,html:string)=>html,ssrFixStacktrace(){}},
    });
    return async(path:string)=>{
      let status=0,html="";
      await handle({url:path},{writeHead(code:number){status=code;},end(value:string){html=value;}});
      return {status,html,tree:parse(html)};
    };
  }
  for(const language of ["javascript","typescript"] as const) {
    test(`Vue ${language} SSR renders escaped page-specific title, description and language`,async()=>{
      const request=harness(language);const result=await request("/foreign");
      assert.equal(result.status,200);
      assert.equal(result.tree.querySelector("html").getAttribute("lang"),"en-GB");
      assert.equal(result.tree.querySelector("title").text,title+" | "+site);
      assert.equal(result.tree.querySelector('meta[name="description"]').getAttribute("content"),description);
      assert.equal(result.tree.querySelectorAll("script").length,2,"metadata cannot insert script elements");
      assert.equal(result.tree.querySelector("#content").text,"SSR");
      assert.doesNotMatch(result.html,/onload="bad/);
      const home=await request("/");
      assert.equal(home.tree.querySelector("html").getAttribute("lang"),"ja");
      assert.equal(home.tree.querySelector('meta[name="description"]').getAttribute("content"),"Home description");
    });
    test(`Vue ${language} not-found response retains safe default metadata`,async()=>{
      const result=await harness(language)("/missing");
      assert.equal(result.status,404);
      assert.equal(result.tree.querySelector("html").getAttribute("lang"),"ja");
      assert.equal(result.tree.querySelector('meta[name="description"]').getAttribute("content"),"");
      assert.match(result.tree.querySelector("title").text,/Not Found/);
    });
  }

  test("Vue SSR language metadata cannot escape its HTML attribute", async () => {
    const source = structuredClone(doc);
    source.pages.foreign.lang = 'en" data-injected="yes';
    const result = await harness("typescript", source)("/foreign");
    assert.equal(result.status, 200);
    assert.equal(result.tree.querySelector("html").getAttribute("lang"), source.pages.foreign.lang);
    assert.equal(result.tree.querySelector("html").hasAttribute("data-injected"), false);
  });
});

describe("nuxt-route-status", () => {
  const doc: SiteDoc = {siteName:'Routes',nodes:{},assets:{},pageOrder:['home','about','draft'],pages:{
    home:{id:'home',name:'Home',title:'Home',description:'',slug:'',children:[]},
    about:{id:'about',name:'About',title:'About',description:'',slug:'about',children:[]},
    draft:{id:'draft',name:'Draft',title:'Draft',description:'',slug:'draft',unpublished:true,children:[]},
  }};
  for (const language of ['javascript','typescript'] as const) {
    const files=generateExportProject(doc,{framework:'nuxt',language,scope:'project'}).files;
    const routes:any={URLSearchParams};
    runInNewContext(files['app/generated/site-routes.js'].replace(/\bexport /g,'')+'\nglobalThis.selectPage=selectPage;',routes);
    const source=files['app/pages/index.vue'];
    assert.equal(source,files['app/pages/[...slug].vue']);
    const setup=source.slice(source.indexOf('const route ='),source.indexOf('</script>'));
    const js=transformSync('(async()=>{'+setup+'\nreturn selected.value?.id ?? null;})()', {loader:'ts',target:'esnext'}).code;
    async function execute(path: string, server=true) {
      const event=server ? {status:200}:undefined;
      const url=new URL(path,'https://example.test');
      const computed=(fn:()=>any)=>({get value(){return fn();}});
      const context={URL,Response,URLSearchParams,
        useRoute:()=>({fullPath:path,path:url.pathname}),useRequestURL:()=>url,
        useRequestEvent:()=>event,setResponseStatus:(target:typeof event,status:number)=>{assert.ok(target);target.status=status;},
        computed,ref:(value:any)=>({value}),watch:()=>{},useHead:()=>{},onMounted:()=>{},
        selectPage:routes.selectPage,
        useAsyncData:async(_key:any,fn:()=>Promise<any>)=>({data:{value:await fn()}}),
        loadPageData:async()=>({}),
      };
      const id=await runInNewContext(js,context);
      return {status:event?.status,id};
    }
    test(`Nuxt ${language} unknown and unpublished paths return HTTP 404`,async()=>{
      for(const path of ['/missing','/missing/child?x=1','/draft']) {
        assert.deepEqual(await execute(path),{status:404,id:null});
      }
    });
    test(`Nuxt ${language} authored paths retain HTTP 200`,async()=>{
      for(const [path,id] of [['/','home'],['/about','about'],['/about/?x=1','about']])
        assert.deepEqual(await execute(path),{status:200,id});
    });
    test(`Nuxt ${language} client rendering does not require a server event`,async()=>{
      assert.deepEqual(await execute('/missing',false),{status:undefined,id:null});
      assert.deepEqual(await execute('/about',false),{status:undefined,id:'about'});
    });
  }

  const previewDoc: SiteDoc = {
    siteName: "Preview site", nodes: {}, assets: {}, pageOrder: ["home", "nested"],
    pages: {
      home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: [] },
      nested: { id: "nested", name: "Nested", title: "Nested", description: "", slug: "guides/start", children: [] },
    },
  };

  function configOf(source: string) {
    const module = { exports: {} as { default?: any } };
    const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
    new Function("defineNuxtConfig", "require", "module", "exports", code)(
      (config: unknown) => config,
      (name: string) => {
        assert.equal(name, "@tailwindcss/vite");
        return () => ({ name: "tailwindcss" });
      }, module, module.exports,
    );
    return module.exports.default;
  }

  for (const language of ["typescript", "javascript"] as const) {
    for (const style of ["css", "css-modules", "tailwind"] as const) {
      for (const target of ["test", "production"] as const) {
        test(`Nuxt ${language}/${style}: ${target} head preserves publishing robots policy`, async () => {
          const options = { framework: "nuxt", language, style, scope: "project" } as const;
          const { files } = await prepareExportProject(previewDoc, options, target);
          const config = configOf(files[`nuxt.config.${language === "typescript" ? "ts" : "js"}`]);
          const robots = config.app.head.meta.filter((entry: { name: string }) => entry.name === "robots");
          assert.deepEqual(robots, target === "test"
            ? [{ name: "robots", content: "noindex, nofollow, noarchive, nosnippet, noimageindex" }]
            : []);
          assert.equal(config.app.head.title, previewDoc.siteName);
          assert.ok(files["app/pages/index.vue"]);
          assert.ok(files["app/pages/[...slug].vue"], "global head covers nested pages too");
          if (target === "test") {
            assert.equal(files["public/robots.txt"], "User-agent: *\nDisallow: /\n");
            assert.match(files["public/_headers"], /X-Robots-Tag: noindex/);
          }
        });
      }
    }
  }
});

describe("export-query-condition-parity", () => {
  const require = createRequire(import.meta.url);
  const queries = ["", "q=first&q=last", "q=last&q=first", "q=first&q=later&lang=ja",
    "=ignored&empty=", "__proto__=first&__proto__=last", "constructor=first&constructor=last",
    "%71=hello+world&q=later", "tag=&tag=later"];
  const doc: SiteDoc = { siteName: "Query parity", nodes: {}, assets: {}, pages: {}, pageOrder: [] };
  for (const [i, query] of queries.entries()) {
    const id = "variant" + i;
    doc.nodes[id] = { ...makeText(id), id };
    doc.pages[id] = { id, name: id, title: id, description: "Description " + id,
      slug: "", query, children: [id] };
    doc.pageOrder.push(id);
  }
  const original = structuredClone(doc);
  const visits: [string, string][] = [
    ["q=first&q=last", "variant1"], ["q=last&q=first", "variant2"],
    ["q=first&q=other&lang=ja", "variant3"], ["empty=", "variant4"],
    ["=different&empty=", "variant4"], ["__proto__=first", "variant5"],
    ["__proto__=last", "variant0"], ["constructor=first", "variant6"],
    ["q=hello%20world&q=other", "variant7"], ["tag=", "variant8"],
    ["tag=later&tag=", "variant0"], ["q=missing", "variant0"], ["", "variant0"],
  ];

  function nativeSelection(files: Record<string, string>, path: string, query: string) {
    const module = { exports: {} as any };
    const code = transformSync(files[path], { format: "cjs" }).code;
    new Function("module", "exports", "URLSearchParams", code)(module, module.exports, URLSearchParams);
    return module.exports.selectPage("/", query)?.id;
  }

  function reactSelection(files: Record<string, string>, query: string) {
    const module = { exports: {} as any };
    const document = { title: "", documentElement: { lang: "" }, querySelector: () => null };
    const code = transformSync(files["src/App.tsx"], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    // ルーターは生成したコードそのものを実行し、関係の無いページの本文と副作用だけを置き換える。
    new Function("require", "module", "exports", "window", "document", code)((name: string) => {
      if (name === "react") return { useEffect: (fn: () => void, deps: unknown[]) => { if (deps.length) fn(); } };
      const page = /^\.\/pages\/Page(\d+)$/.exec(name);
      if (page) return { __esModule: true, default: () => "variant" + page[1] };
      if (name === "./NotFound") return { __esModule: true, default: () => "not-found" };
      return require(name);
    }, module, module.exports, { location: { pathname: "/", search: "?" + query } }, document);
    const id = renderToStaticMarkup(module.exports.default());
    assert.equal(document.title, id + " | Query parity");
    return id;
  }

  function htmlSelection(files: Record<string, string>, query: string) {
    const config = /<script type="application\/json" data-page-variants>([\s\S]*?)<\/script>/.exec(files["index.html"]);
    assert.ok(config);
    const host = { innerHTML: "", querySelectorAll: () => [] };
    const document = { title: "", documentElement: {}, currentScript: { getAttribute: () => "[]" },
      querySelector: (selector: string) => selector === "[data-variant-root]" ? host :
        selector === "script[data-page-variants]" ? { textContent: config[1] } : null };
    new Function("document", "location", "URLSearchParams", files["query-router.js"])(
      document, { search: "?" + query }, URLSearchParams);
    assert.ok(host.innerHTML.includes(document.title));
    return document.title;
  }

  const next = loadGeneratedRoute(generateExportProject(doc, "nextjs").files, "app/page.tsx");
  for (const format of ["react", "html", "vue", "nuxt", "sveltekit"] as const) {
    test(`${format} query routing agrees with Next.js for repeated, empty and prototype-named keys`, async () => {
      const { files } = generateExportProject(doc, format);
      for (const [query, expected] of visits) {
        const params = new URLSearchParams(query);
        const searchParams = Object.fromEntries([...new Set(params.keys())].map(key => {
          const values = params.getAll(key);
          return [key, values.length > 1 ? values : values[0]];
        }));
        assert.equal((await next.generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) })).title, expected);
        const actual = format === "react" ? reactSelection(files, query) : format === "html" ? htmlSelection(files, query) :
          nativeSelection(files, (format === "vue" ? "src/" : format === "nuxt" ? "app/generated/" : "src/lib/") + "site-routes.js", query);
        assert.equal(actual, expected, `${format}: ?${query}`);
      }
      assert.deepEqual(doc, original);
    });
  }

  test("query routing fixes preserve authored links and last-value data variables", () => {
    assert.equal(pageHrefOf(doc.pages.variant1), "/?q=first&q=last");
    assert.deepEqual(pageQueryVars("q=first&q=last"), { q: "last" });
  });
});
