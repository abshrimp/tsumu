import assert from "node:assert/strict";
import { test, describe } from "node:test";
import JSZip from "jszip";
import { exportProjectZip } from "../lib/exportZip";
import { parseSiteImport, restoreImportAssets } from "../lib/site-import";
import { attachZipDependencies, zipCssUrl } from "../lib/zip-css";
import { assetSrc } from "../lib/assets";
import { buildAssetNames } from "../lib/generator/names";
import { type Asset, type SiteDoc, type NodeStyles } from "../lib/types";
import { generateSiteCss } from "../lib/generator/css";
import { buildCanvasCss } from "../components/canvas/css";
import { makeBox } from "../lib/presets";
import { createRequire } from "node:module";
import { splitCssModule } from "../lib/generator/style-export";
import { generateExportProject } from "../lib/export-formats";

describe("export-css-roundtrip", () => {
  for (const framework of ["nextjs", "html", "react", "vue", "nuxt", "sveltekit"] as const) {
    for (const remote of [false, true]) test(`${framework} ZIP restores original ${remote ? "uploaded" : "embedded"} CSS bytes and script-relative dependencies`, async () => {
      const sources: Record<string, string> = {
        "css/main.css": '\uFEFF@import "nested/theme.css";\n@font-face{font-family:demo;src:url("../fonts/demo.woff2?v=2#font")}',
        "css/nested/theme.css": "body{color:navy}",
        "fonts/demo.woff2": "font fixture",
        "js/main.js": 'const link = document.createElement("link");link.rel="stylesheet";link.href=new URL("../css/main.css",import.meta.url);document.head.append(link);',
      };
      const stored = new Map<string, Uint8Array>();
      const assets = Object.entries(sources).map(([path, source], i): Asset => {
        const id = "asset-" + i;
        const bytes = new TextEncoder().encode(source);
        const mimeType = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "font/woff2";
        stored.set("assets/" + id, bytes);
        return { id, name: path.replaceAll("/", "-"), width: 0, height: 0, mimeType,
          ...(remote ? { path: "assets/" + id } : { dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` }),
          zip: { version: 1, group: "roundtrip", path,
            ...(path.endsWith(".css") ? { stylesheet: { source: source.replace(/^\uFEFF/, ""), references: [] } } : {}) },
        };
      });
      attachZipDependencies(assets);
      const doc: SiteDoc = { schemaVersion: 1, siteName: "CSS roundtrip", nodes: {},
        pageOrder: ["p"], pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [],
          ...(["vue", "nuxt", "sveltekit"].includes(framework) ? {} : {
            customTopHtml: `<link rel="stylesheet" href="${zipCssUrl(assets[0].id)}">`,
            customEndHtml: `<script type="module" src="${assetSrc(assets[3])}"></script>`,
          }) } },
        assets: Object.fromEntries(assets.map(asset => [asset.id, asset])),
      };
      const original = structuredClone(doc);
      const globals = Object.getOwnPropertyDescriptors(globalThis);
      const createUrl = URL.createObjectURL;
      let download: Blob | undefined;
      let uploads = 0;
      URL.createObjectURL = blob => { download = blob; return "blob:css-roundtrip"; };
      Object.assign(globalThis, {
        document: { createElement: () => ({ href: "", download: "", click() {} }) },
        fetch: async (input: string, init?: RequestInit) => {
          if (input.startsWith("data:")) return globals.fetch.value(input, init);
          if (input.startsWith("/api/assets/file?")) {
            const bytes = stored.get(new URL(input, "https://editor.test").searchParams.get("path")!);
            assert.ok(bytes, input);
            return new Response(bytes);
          }
          assert.equal(input, "/api/assets");
          assert.equal(init?.method, "POST");
          const file = (init!.body as FormData).get("file") as File;
          const path = "assets/restored-" + ++uploads;
          stored.set(path, new Uint8Array(await file.arrayBuffer()));
          return Response.json({ path });
        },
      });
      try {
        const exportZip = async (value: SiteDoc) => {
          download = undefined;
          assert.deepEqual(await exportProjectZip(value, framework), []);
          assert.ok(download);
          return new Uint8Array(await (download as Blob).arrayBuffer());
        };
        const bytes = await exportZip(doc);
        const zip = await JSZip.loadAsync(bytes);
        const assetRoot = framework === "html" ? "assets/" : framework === "sveltekit" ? "static/assets/" : "public/assets/";
        const names = buildAssetNames(doc);
        const generated = await zip.file("css-roundtrip/" + assetRoot + names.get(assets[0].id))!.async("text");
        assert.ok(generated.includes(names.get(assets[1].id)!));
        assert.ok(generated.includes(names.get(assets[2].id)! + "?v=2#font"));
        assert.ok(!generated.includes("../fonts/"), "website CSS still uses generated filenames");

        const imported = await parseSiteImport(bytes, "zip");
        assert.deepEqual(imported.doc, original);
        for (const asset of assets) {
          assert.deepEqual(imported.assets.get(asset.id), new TextEncoder().encode(sources[asset.zip!.path]),
            "editable archive must preserve original bytes: " + asset.zip!.path);
        }
        const restored = await restoreImportAssets(imported);
        assert.deepEqual(restored.warnings, []);
        const next = await JSZip.loadAsync(await exportZip(restored.doc));
        for (const asset of assets) {
          const alias = `css-roundtrip/${assetRoot}_imports/roundtrip/${asset.zip!.path}`;
          assert.deepEqual(await next.file(alias)!.async("uint8array"), new TextEncoder().encode(sources[asset.zip!.path]),
            "script-relative assets must survive re-import: " + alias);
        }
        assert.deepEqual(doc, original, "export does not mutate the active document");
      } finally {
        URL.createObjectURL = createUrl;
        for (const key of ["document", "fetch"]) {
          if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    });
  }

  for (const mode of ["percent", "metadata", "missing", "forbidden"] as const) {
    test(`CSS-only ZIP preserves source or reports unavailable bytes: ${mode}`, async () => {
      const source = 'body::before{content:"日本語"}';
      const asset: Asset = { id: "css", name: "theme.css", width: 0, height: 0, mimeType: "text/css",
        ...(mode === "percent" ? { dataUrl: "data:text/css;charset=utf-8," + encodeURIComponent(source) } :
          mode === "metadata" ? {} : { path: "assets/unavailable" }),
        zip: { version: 1, group: "css-only", path: "theme.css", stylesheet: { source, references: [] } },
      };
      const doc: SiteDoc = { schemaVersion: 1, siteName: "CSS only", assets: { css: asset }, nodes: {}, pageOrder: ["p"],
        pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [],
          customTopHtml: `<link rel="stylesheet" href="${zipCssUrl(asset.id)}">` } },
      };
      const globals = Object.getOwnPropertyDescriptors(globalThis);
      const createUrl = URL.createObjectURL;
      let download: Blob | undefined;
      URL.createObjectURL = blob => { download = blob; return "blob:css-only"; };
      Object.assign(globalThis, {
        document: { createElement: () => ({ href: "", download: "", click() {} }) },
        fetch: async (input: string) => input.startsWith("data:") ? globals.fetch.value(input) :
          new Response(null, { status: mode === "forbidden" ? 403 : 404 }),
      });
      try {
        if (mode === "forbidden") {
          await assert.rejects(exportProjectZip(doc, "html"), /403/);
          assert.equal(download, undefined, "failed asset reads must not offer an incomplete download");
          return;
        }
        const missing = await exportProjectZip(doc, "html");
        assert.deepEqual(missing, mode === "missing" ? ["_tsumu/assets/theme.css"] : []);
        assert.ok(download);
        const imported = await parseSiteImport(new Uint8Array(await (download as Blob).arrayBuffer()), "zip");
        if (mode === "missing") {
          assert.equal(imported.assets.has(asset.id), false);
          assert.ok(imported.warnings.some(warning => warning.includes(asset.name)));
        } else {
          assert.deepEqual(imported.assets.get(asset.id), new TextEncoder().encode(source));
          assert.deepEqual(imported.warnings, []);
        }
      } finally {
        URL.createObjectURL = createUrl;
        for (const key of ["document", "fetch"]) {
          if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    });
  }
});

describe("export-positioning-breakpoints", () => {
  function css(styles: NodeStyles) {
    const doc: SiteDoc = { siteName: "Position", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["parent"] } },
      nodes: {
        parent: { ...makeBox(), id: "parent", children: ["child"], styles },
        child: { ...makeBox(), id: "child", styles: { base: { default: { position: "absolute", top: "0px" } } } },
      },
    };
    return {
      exported: generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map()),
      preview: buildCanvasCss(doc, ["parent"], "base", "preview", null, "default"),
    };
  }
  for (const position of ["relative", "absolute", "static", "fixed", "sticky"]) test(`narrow ${position} does not suppress desktop absolute-child containing block`, () => {
    const { exported, preview } = css({ sm: { default: { position } } });
    assert.match(preview, /position: relative/);
    const base = exported.slice(0, exported.indexOf("@media"));
    assert.match(base, /\.parent\s*\{[^}]*position: relative;/);
    assert.match(exported.slice(exported.indexOf("@media")), new RegExp(`position: ${position};`));
  });
  test("explicit base static remains intentional and is not replaced", () => {
    const { exported } = css({ base: { default: { position: "static" } }, sm: { default: { position: "relative" } } });
    assert.match(exported.slice(0, exported.indexOf("@media")), /\.parent\s*\{[^}]*position: static;/);
  });
});

describe("export-custom-css-comments", () => {
  const postcss=createRequire(import.meta.url)('postcss');
  function css(source:string) {
    const doc:SiteDoc={siteName:'Comments',assets:{},pageOrder:['p'],pages:{p:{id:'p',name:'P',title:'P',description:'',slug:'',children:['box']}},nodes:{box:{...makeBox(),id:'box',customCss:source}}};
    return { exported:generateSiteCss(doc,new Map([['box','box']]),new Map()),
      canvas:buildCanvasCss(doc,['box'],'base','preview',null,'default') };
  }
  function declarations(source:string) {
    const result:Record<string,string>={};
    postcss.parse(source).walkDecls((decl:any)=>{result[decl.prop]=decl.value;});
    return result;
  }
  for(const source of [
    'color:red; /* note */ background:blue;',
    '/* punctuation ; : ) \' */ color:red; /* more */ background:blue;',
    'color:/* ; ) " */red; background:blue;',
    'color /* property note */ : red; background: blue;',
    String.raw`color:red; --literal: \/*not-comment*/; background:blue;`,
    'color:red; content:"/* keep ; quote */"; background:blue;',
  ]) test(`export preserves commented custom declarations: ${source}`,()=>{
    const actual=css(source);
    const expected=declarations(actual.canvas),result=declarations(actual.exported);
    assert.equal(result.color,expected.color);
    assert.equal(result.background,expected.background);
    if(source.includes('--literal:'))assert.equal(result['--literal'],expected['--literal']);
    if(source.includes('content:'))assert.equal(result.content,expected.content);
  });
  for (const [closingStyle, openingScript] of [
    ['</style>', '<script>'],
    ['</STYLE>', '<SCRIPT>'],
    ['</StYlE>', '<ScRiPt>'],
  ]) test(`comment tokens do not make rule-breaking custom declarations valid: ${closingStyle}`, () => {
    const result = css(`color: red; /* note */ background: blue; bad property: x; content: "${closingStyle}${openingScript}x</script>";`);
    assert.equal(declarations(result.exported).background, 'blue');
    assert.doesNotMatch(result.exported, /bad property|<\/style>|<script>/i);
  });
});

describe("export-responsive-containing-block", () => {
  function fixture(child: NodeStyles, parent: NodeStyles = {}) {
    const doc: SiteDoc = { siteName: "Position", assets: {}, pageOrder: [], pages: {}, nodes: {
      parent: { ...makeBox(), id: "parent", children: ["child"], styles: parent },
      child: { ...makeBox(), id: "child", styles: child },
    } };
    const exported = generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map());
    const at = exported.indexOf("@media");
    return { doc, exported, base: at < 0 ? exported : exported.slice(0, at), media: at < 0 ? "" : exported.slice(at) };
  }
  test("a mobile-only absolute child does not position its parent on desktop", () => {
    const { doc, base, media } = fixture({ sm: { default: { position: "absolute" } } });
    assert.doesNotMatch(buildCanvasCss(doc, ["parent"], "base", "preview", null, "default"), /position: relative/);
    assert.doesNotMatch(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
    assert.match(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  });
  test("automatic containing block ends when its last absolute child becomes static", () => {
    const { doc, base, media } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } });
    assert.doesNotMatch(buildCanvasCss(doc, ["parent"], "sm", "preview", null, "default"), /position: relative/);
    assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
    assert.match(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
  });
  test("authored containing block remains when a child stops being absolute", () => {
    const { base, media } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } }, { base: { default: { position: "relative" } } });
    assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
    assert.doesNotMatch(media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
  });
  test("explicit static parent prevents automatic positioning at every breakpoint", () => {
    const { base, media } = fixture({ sm: { default: { position: "absolute" } } }, { base: { default: { position: "static" } } });
    assert.match(base, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: static/);
    assert.doesNotMatch(base + media, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: relative/);
  });

  test("custom CSS positioning is not overwritten by inferred media rules", () => {
    const { doc } = fixture({ base: { default: { position: "absolute" } }, sm: { default: { position: "static" } } });
    doc.nodes.parent.customCss = "position: absolute; top: 20px";
    const exported = generateSiteCss(doc, new Map([["parent", "parent"], ["child", "child"]]), new Map());
    assert.match(exported, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: absolute/);
    assert.doesNotMatch(exported, /\.parent(?:,\s*\.[\w-]+)*\s*\{[^}]*position: (relative|static)/);
  });
});

describe("css-module-escaped-values", () => {
  const require = createRequire(import.meta.url);
  const postcss = require("postcss");
  const local = require("next/dist/compiled/postcss-modules-local-by-default");
  const scope = require("next/dist/compiled/postcss-modules-scope");
  const compile = (css: string) => postcss([
    local(), scope({ generateScopedName: (name: string) => "scoped_" + name }),
  ]).process(css, { from: "site.module.css" });

  function declarations(css: string): [string, string][] {
    const values: [string, string][] = [];
    postcss.parse(css).walkDecls((decl: { prop: string; value: string; parent: { selector: string } }) => {
      if (decl.parent.selector !== ":export" && decl.prop !== "display") values.push([decl.prop, decl.value]);
    });
    return values;
  }

  for (const value of [
    String.raw`url(/assets/owner\'s-photo.png)`,
    String.raw`url(/assets/icon\"small.png)`,
    String.raw`url(/assets/icon\{small.png)`,
    String.raw`url(/assets/icon\}small.png)`,
  ]) {
    for (const responsive of [false, true]) {
      test(`CSS Modules preserves escaped CSS tokens ${value} (responsive=${responsive})`, async () => {
        const rules = `.card { --authored: ${value}; color: red; }\n.after { color: blue; }`;
        const source = responsive ? `@media (max-width: 600px) { ${rules} }` : rules;
        const expected = declarations(source);
        const split = splitCssModule(source);
        assert.ok(split.module.includes(`--authored: ${value};`));
        const result = await compile(split.module);
        assert.deepEqual(declarations(result.css), expected);
        assert.match(result.css, /\.scoped_siteRoot \.after/);
        assert.equal(split.global.trim(), "");
        if (responsive) {
          result.root.walkDecls("--authored", (decl: any) => {
            assert.equal(decl.parent.parent.name, "media");
            assert.equal(decl.parent.parent.params, "(max-width: 600px)");
          });
        }
      });
    }
  }

  for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
    test(`${framework} CSS Modules exports valid escaped URLs from authored styles`, async () => {
      const image = String.raw`url(/assets/owner\'s-photo.png)`;
      const narrowImage = String.raw`url(/assets/icon\}small.png)`;
      const doc: SiteDoc = {
        siteName: "Escaped CSS", assets: {}, pageOrder: ["p"],
        pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["card", "after"],
          bodyStyles: { base: { default: { backgroundImage: image } } } } },
        nodes: {
          card: { ...makeBox(), id: "card", customCss: `background-image: ${image};`,
            styles: { sm: { default: { backgroundImage: narrowImage } } } },
          after: { ...makeBox(), id: "after", styles: { base: { default: { color: "blue" } } } },
        },
      };
      const options = { framework, language: "typescript", scope: "project" } as const;
      const original = generateExportProject(doc, { ...options, style: "css" });
      const originalCss = Object.entries(original.files).find(([path]) => path.endsWith("/site.css"))![1];
      const generated = generateExportProject(doc, { ...options, style: "css-modules" });
      const module = Object.entries(generated.files).find(([path]) => path.endsWith("site.module.css"))![1];
      const global = Object.entries(generated.files).find(([path]) => path.endsWith("site-global.css"))![1];
      const compiled = await compile(module);
      assert.deepEqual(declarations(global + compiled.css), declarations(originalCss));
      assert.equal(declarations(compiled.css).filter(([prop]) => prop === "background-image").length, 2);
      assert.ok(global.includes(image));
    });
  }
});

describe("css-module-keyframe-parity", () => {
  const require = createRequire(import.meta.url);
  const postcss = require("postcss");
  const local = require("next/dist/compiled/postcss-modules-local-by-default");
  const scope = require("next/dist/compiled/postcss-modules-scope");
  for (const prefix of ["", "-webkit-"]) test(`CSS Modules keeps ${prefix}keyframes paired with compiled animation names`, async () => {
    const source = `body { animation: shared 2s; }
  .card { animation: shared 1s ease, other 2s linear; }
  @${prefix}keyframes shared { from { opacity: 0; } to { opacity: 1; } }
  @${prefix}keyframes other { from { transform: translateX(2px); } to { transform: none; } }`;
    const split = splitCssModule(source);
    const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(split.module, { from: "site.module.css" });
    const names: string[] = [];
    result.root.walkAtRules(/keyframes$/, (rule: any) => names.push(rule.params));
    assert.ok(names.includes("scoped_shared"), "module animation must have the matching local definition");
    assert.ok(names.includes("scoped_other"));
    assert.match(result.css, /animation: scoped_shared 1s ease, scoped_other 2s linear/);
    assert.ok(split.global.includes(`@${prefix}keyframes shared`), "global body animation retains its original definition");
  });
  test("responsive module keyframes retain their enclosing media condition", async () => {
    const split = splitCssModule('@media (max-width:600px) { .card { animation-name: narrow; } @keyframes narrow { to { opacity: 0; } } }');
    const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(split.module, { from: "site.module.css" });
    let checked = false;
    result.root.walkAtRules("keyframes", (rule: any) => {
      assert.equal(rule.params, "scoped_narrow");
      assert.equal(rule.parent.name, "media");
      assert.equal(rule.parent.params, "(max-width:600px)");
      checked = true;
    });
    assert.ok(checked);
  });

  test("an authored motion survives the actual CSS Modules export pipeline", async () => {
    const { generateExportProject } = await import("../lib/export-formats");
    const { makeBox } = await import("../lib/presets");
    const doc = { siteName: "Motion", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["box"] } },
      nodes: { box: { ...makeBox(), id: "box", motions: [{ id: "fade", trigger: "load" as const,
        keyframes: "custom", customKeyframes: "from { opacity: 0; } to { opacity: 1; }", duration: 1, delay: 0, easing: "ease" }] } },
    };
    for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
      const { files } = generateExportProject(doc, { framework, language: "typescript", style: "css-modules", scope: "project" });
      const module = Object.entries(files).find(([path]) => path.endsWith("site.module.css"))![1];
      const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(module, { from: "site.module.css" });
      const names: string[] = [];
      result.root.walkAtRules("keyframes", (rule: any) => names.push(rule.params));
      assert.ok(names.length > 0, framework);
      let matched = false;
      result.root.walkDecls(/^animation(?:-name)?$/, (decl: any) => {
        if (names.some(name => decl.value.includes(name))) matched = true;
      });
      assert.ok(matched, framework + " animation references its emitted scoped keyframes");
    }
  });
});
