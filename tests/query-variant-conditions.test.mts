import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, posix } from "node:path";
import { test, describe } from "node:test";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import { makeText } from "../lib/presets";
import { pageHrefOf, pageQueryVars } from "../lib/vars";
import { previewNavigationFixture, previewQueryDoc } from "./helpers/preview-query-navigation";
import { QUERY_VARIANT_RUNTIME } from "../lib/generator/query-route";

describe("query-variant-conditions", () => {
  const require = createRequire(import.meta.url);
  const navigation = previewNavigationFixture();

  function generatedRoute(files: Record<string, string>) {
    const cache = new Map<string, any>();
    function load(path: string): any {
      if (cache.has(path)) return cache.get(path);
      const module = { exports: {} as any };
      const code = transformSync(files[path], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
      new Function("require", "module", "exports", code)(
        (name: string) => name.startsWith(".")
          ? load(posix.normalize(`${dirname(path)}/${name}.tsx`))
          : require(name), module, module.exports,
      );
      cache.set(path, module.exports);
      return module.exports;
    }
    const route = load("app/results/page.tsx");
    return async (url: string) => {
      const params = new URL(url, "https://query.test").searchParams;
      const searchParams = Object.fromEntries([...new Set(params.keys())].map((key) => {
        const values = params.getAll(key);
        return [key, values.length === 1 ? values[0] : values];
      }));
      const props = { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
      return {
        html: renderToStaticMarkup(await route.default(props)),
        metadata: await route.generateMetadata(props),
      };
    };
  }

  for (const [query, first, reversed] of [
    ["category=books&category=music", "category=books", "category=music&category=books"],
    ["category=books&category=books", "category=books", "category=music&category=books"],
    ["q=hello+world&q=later", "q=hello%20world", "q=later&q=hello+world"],
    ["%71=hello%20world&q=later", "q=hello+world", "q=later&%71=hello%20world"],
    ["q=%26%3D%2B&q=other", "q=%26%3D%2B", "q=other&q=%26%3D%2B"],
    ["q=&q=later", "q=", "q=later&q="],
    ["flag&flag=later", "flag=", "flag=later&flag"],
    ["%E7%A8%AE%E9%A1%9E=%E6%9C%AC&種類=音楽", "種類=本", "種類=音楽&種類=本"],
  ] as const) {
    test(`ordinary page links preserve ${query} and select their page, metadata and preview`, async () => {
      const doc = previewQueryDoc("results", ["", query]);
      const selected = doc.pages.variant1;
      selected.description = "Selected page description";
      const link = { ...makeText("Open selected results"), id: "selected-link", link: { kind: "page" as const, pageId: selected.id } };
      doc.nodes[link.id] = link;
      doc.pages.home.children.push(link.id);
      const original = structuredClone(doc);
      assert.deepEqual(runChecks(doc).filter((c) => c.level === "error"), []);
      const { files } = generateProject(doc);
      const href = pageHrefOf(selected);
      assert.equal(href, `/results?${query}`);
      assert.ok(files["app/page.tsx"].includes(`href="${href.replaceAll("&", "&amp;")}"`));
      const visit = generatedRoute(files);
      const navigate = await navigation;
      for (const url of [href, `/results?${first}`, `${href}&extra=ignored#section`]) {
        const actual = await visit(url);
        assert.match(actual.html, /Page variant1/);
        assert.doesNotMatch(actual.html, /Page variant0/);
        assert.equal(actual.metadata.title, "variant1");
        assert.equal(actual.metadata.description, selected.description);
        assert.equal(navigate(doc, url), selected.id);
      }
      for (const url of [`/results?${reversed}`, "/results"]) {
        const actual = await visit(url);
        assert.match(actual.html, /Page variant0/);
        assert.equal(actual.metadata.title, "variant0");
        assert.equal(navigate(doc, url), "variant0");
      }
      assert.deepEqual(doc, original, "routing must not rewrite saved query strings");
    });
  }

  for (const [left, right] of [
    ["category=books", "category=books&category=books"],
    ["category=books", "category=books&category=music"],
    ["category=books&lang=ja", "lang=ja&category=books&category=music"],
    ["q=hello+world", "%71=hello%20world&q=other"],
    ["q=", "q&q=later"],
    ["", "=ignored"],
    ["q=first", "=ignored&q=first&q=last"],
  ]) {
    test(`publish checks reject equivalent routing conditions: ${left} and ${right}`, () => {
      const doc = previewQueryDoc("results", [left, right]);
      const errors = runChecks(doc).filter((c) => c.level === "error");
      assert.equal(errors.length, 1);
      assert.equal(errors[0].help, "page-url");
    });
  }

  test("different first values remain distinct, and repeated keys do not increase specificity", async () => {
    const doc = previewQueryDoc("results", ["", "q=first&q=last", "q=last&q=first", "q=first&lang=ja"]);
    assert.deepEqual(runChecks(doc).filter((c) => c.level === "error"), []);
    const navigate = await navigation;
    const visit = generatedRoute(generateProject(doc).files);
    for (const [url, expected] of [
      ["/results?q=first&q=last", "variant1"],
      ["/results?q=last&q=first", "variant2"],
      ["/results?q=first&q=last&lang=ja", "variant3"],
      ["/results?q=missing", "variant0"],
    ]) {
      assert.equal((await visit(url)).metadata.title, expected);
      assert.equal(navigate(doc, url), expected);
    }
  });

  test("first-page fallback and declaration-order ties are retained", async () => {
    const doc = previewQueryDoc("results", ["q=first&q=last", "q=other", "lang=ja"]);
    const navigate = await navigation;
    const visit = generatedRoute(generateProject(doc).files);
    for (const [url, expected] of [
      ["/results?q=missing", "variant0"],
      ["/results?q=other&lang=ja", "variant1"],
      ["/results?q=last&lang=ja", "variant2"],
    ]) {
      assert.equal((await visit(url)).metadata.title, expected);
      assert.equal(navigate(doc, url), expected);
    }
  });

  test("route selection does not change existing script/data query-variable semantics", () => {
    assert.deepEqual(pageQueryVars("q=first&q=last"), { q: "last" });
  });

  test("condition names are values, including object prototype property names", async () => {
    const doc = previewQueryDoc("results", ["", "__proto__=first&__proto__=last", "constructor=first&constructor=last"]);
    const navigate = await navigation;
    for (const [url, expected] of [
      ["/results?__proto__=first", "variant1"],
      ["/results?__proto__=last", "variant0"],
      ["/results?constructor=first", "variant2"],
    ]) {
      // Next.js と同じく、クエリを自身のプロパティにする（Object.prototype を通して代入しない）。
      assert.equal((await generatedRoute(generateProject(doc).files)(url)).metadata.title, expected);
      assert.equal(navigate(doc, url), expected);
    }
  });
});

describe("query-variant-nomodule", () => {
  // モジュールに対応したブラウザは、classic script の nomodule のスクリプトを、load や error を発生させずに無視する。
  // ルーターは、ブラウザが決して発生させないイベントを待ってはならない。
  async function bootstrap(moduleCapable: boolean, type = "") {
    const inserted: string[] = [];
    const attributes = [{ name: "nomodule", value: "" }, { name: "src", value: "/legacy.js" }, { name: "type", value: type }];
    const old = {
      attributes, textContent: "",
      ...(moduleCapable ? { noModule: true } : {}),
      getAttribute: (name: string) => attributes.find(a => a.name === name)?.value ?? null,
      hasAttribute: (name: string) => attributes.some(a => a.name === name),
      replaceWith(script: any) {
        inserted.push("authored");
        if (!moduleCapable || type === "module") queueMicrotask(() => script.onload?.());
      },
    };
    const document = {
      currentScript: { getAttribute: () => JSON.stringify(["/data-loader.js", "/scripts.js"]) },
      documentElement: {},
      querySelector: (selector: string) => selector === "[data-variant-root]"
        ? { innerHTML: "", querySelectorAll: () => [old] }
        : selector === "script[data-page-variants]"
          ? { textContent: JSON.stringify([{ query: {}, html: "" }]) } : null,
      createElement: () => ({ text: "", src: "", setAttribute() {} }),
      body: { appendChild(script: any) { inserted.push(script.src); queueMicrotask(() => script.onload?.()); } },
    };
    new Function("document", "location", "URLSearchParams", QUERY_VARIANT_RUNTIME)(document, { search: "" }, URLSearchParams);
    await new Promise<void>(resolve => setImmediate(resolve));
    return inserted;
  }

  test("query variants do not wait for ignored classic nomodule scripts", async () => {
    assert.deepEqual(await bootstrap(true), ["/data-loader.js", "/scripts.js"]);
  });

  test("nomodule scripts still run when the browser does not support modules", async () => {
    assert.deepEqual(await bootstrap(false), ["authored", "/data-loader.js", "/scripts.js"]);
  });

  test("the nomodule attribute does not suppress module scripts", async () => {
    assert.deepEqual(await bootstrap(true, "module"), ["authored", "/data-loader.js", "/scripts.js"]);
  });

  test("the nomodule attribute does not suppress import maps", async () => {
    assert.deepEqual(await bootstrap(true, "importmap"), ["authored", "/data-loader.js", "/scripts.js"]);
  });
});

describe("query-variant-script-types", () => {
  // HTML Standard の script の type は、MIME の解析ではなく、本質の部分の *一致* で判定する。
  // text/javascript;charset=utf-8 のようにパラメーターの付いたものは、実行されないデータのブロックになる。
  // https://html.spec.whatwg.org/multipage/scripting.html#attr-script-type
  async function bootstrap(type:string | null, browserExecutes:boolean, language?:string) {
    const inserted:string[]=[];
    const attrs=[...(type === null ? [] : [{name:'type',value:type}]), {name:'src',value:'/authored.js'}, ...(language === undefined ? [] : [{name:'language',value:language}])];
    const old={attributes:attrs,textContent:'',
      getAttribute:(name:string)=>attrs.find(a=>a.name===name)?.value??null,
      hasAttribute:(name:string)=>attrs.some(a=>a.name===name),
      replaceWith(script:any){inserted.push('authored');if(browserExecutes)queueMicrotask(()=>script.onload?.());},
    };
    const document={
      currentScript:{getAttribute:()=>JSON.stringify(['/data-loader.js','/scripts.js'])},documentElement:{},
      querySelector:(sel:string)=>sel==='[data-variant-root]'?{innerHTML:'',querySelectorAll:()=>[old]}:
        sel==='script[data-page-variants]'?{textContent:JSON.stringify([{query:{},html:''}])}:null,
      createElement:()=>({text:'',src:'',setAttribute(){}}),
      body:{appendChild(script:any){inserted.push(script.src);queueMicrotask(()=>script.onload?.());}},
    };
    new Function('document','location','URLSearchParams',QUERY_VARIANT_RUNTIME)(document,{search:''},URLSearchParams);
    await new Promise<void>(resolve=>setImmediate(resolve));
    return inserted;
  }
  for(const type of ['text/javascript; charset=utf-8','application/javascript; charset=utf-8','application/ecmascript;version=1','text/javascript ;','application/json','application/ld+json'])
    test(`inert script type does not stall variant startup: ${type}`,async()=>{
      assert.deepEqual(await bootstrap(type,false),['/data-loader.js','/scripts.js']);
    });
  for(const type of ['text/javascript','application/javascript','text/ecmascript','application/ecmascript',
    'application/x-javascript','application/x-ecmascript','text/x-javascript','text/x-ecmascript',
    'text/javascript1.0','text/javascript1.1','text/javascript1.2','text/javascript1.3','text/javascript1.4','text/javascript1.5',
    'text/jscript','text/livescript','TEXT/JAVASCRIPT'])
    test(`browser-supported classic script type is replayed: ${type}`,async()=>{
      assert.deepEqual(await bootstrap(type,true),['authored','/data-loader.js','/scripts.js']);
    });

  for (const language of ['vbscript', 'python', 'javascript1.6', 'module', 'importmap'])
    test(`unsupported legacy language does not stall startup: ${language}`, async () => {
      assert.deepEqual(await bootstrap(null, false, language), ['/data-loader.js', '/scripts.js']);
    });
  for (const language of ['javascript', 'JavaScript1.2', 'jscript', 'livescript', ''])
    test(`supported legacy language is replayed: ${language}`, async () => {
      assert.deepEqual(await bootstrap(null, true, language), ['authored', '/data-loader.js', '/scripts.js']);
    });
  test('explicit empty type overrides an unsupported legacy language', async () => {
    assert.deepEqual(await bootstrap('', true, 'vbscript'), ['authored', '/data-loader.js', '/scripts.js']);
  });

  for (const type of [' ', '\t', ' module ', ' importmap ', '\u00a0text/javascript\u00a0'])
    test(`non-executable whitespace type does not stall startup: ${JSON.stringify(type)}`, async () => {
      assert.deepEqual(await bootstrap(type, false), ['/data-loader.js', '/scripts.js']);
    });
  for (const language of ['javascript ', ' javascript', 'javascript\t'])
    test(`language does not inherit type attribute whitespace trimming: ${JSON.stringify(language)}`, async () => {
      assert.deepEqual(await bootstrap(null, false, language), ['/data-loader.js', '/scripts.js']);
    });
  test('classic type attributes accept ASCII whitespace only', async () => {
    assert.deepEqual(await bootstrap(' \ttext/javascript\n', true), ['authored', '/data-loader.js', '/scripts.js']);
  });
});
