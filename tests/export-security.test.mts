import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { exportLimitations, exportScopeDoc, generateExportProject, prepareExportProject } from "../lib/export-formats";
import { makeBox, makeText, createInitialDoc } from "../lib/presets";
import { type SiteDoc, type ScriptStep, type Script as Script_2, type DocNode, type EmbedContent } from "../lib/types";
import { BlockedUrlError, assertPublicUrl, isPrivateHost } from "../lib/safe-fetch";
import vm, { runInNewContext as runInNewContext_2, runInNewContext as runInNewContext_3, runInNewContext as runInNewContext_4 } from "node:vm";
import { parse as parse_2 } from "acorn";
import { transformSync, buildSync } from "./helpers/bundle";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join_2, dirname, join as join_3, resolve as resolve_2, join as join_4, resolve as resolve_3 } from "node:path";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";
import { codeLiteral } from "../lib/generator/code-literal";
import { applyDocPatch, isDocPatch } from "../lib/doc-patch";
import { runChecks } from "../lib/generator/checks";
import { fieldExpr, listItemsExpr } from "../lib/generator/render-helpers";
import { compareValues, filterItems, filterConds, previewDataVars } from "../lib/data";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { nativeDataModule } from "../lib/generator/native-data";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { matchesValueCondition, setVarPath } from "../lib/value-semantics";
import { createRequire } from "node:module";
import { generateProject } from "../lib/generator";
import { fetchRequestOf } from "../lib/fetch-request";
import { publishedComponentList } from "./helpers/component-list-export";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
import { generateStandaloneHtml } from "../lib/generator/html-export";
import { assetSrc } from "../lib/assets";
import { isSiteLang, pageLangOf, SITE_LANGS, siteLangOf } from "../lib/site-lang";
import { useEditor } from "../lib/store";
import { buildComponentNames, buildAssetNames as buildAssetNames_2, buildClassNames } from "../lib/generator/names";
import { pageNodeIds } from "../lib/script";
import { execFileSync } from "node:child_process";
import { createElement as createElement_2, createElement as createElement_3 } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { anchorFixture, renderAnchorExport } from "./helpers/instance-anchor";
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { reactSource } from "../lib/generator/react-export";
import { pageHrefOf, pageQueryVars, interpolate, interpolateUrl, lookupVar, varText } from "../lib/vars";
import { loadGeneratedRoute } from "./helpers/generated-route";
import { PAGE_DATA_RUNTIME } from "../lib/generator/browser-data";
import { fieldInitialValue } from "../lib/fields";
import { YOUTUBE_ALLOW } from "../lib/embed";
import { safeNavigationUrl, safeResourceUrl } from "../lib/url-policy";

describe("export-safety-boundaries", () => {
describe("export-safety-boundaries", () => {
  function doc(): SiteDoc {
    return {
      siteName: "Export scope security",
      lang: "ja",
      pageOrder: ["public", "private"],
      pages: {
        public: { id: "public", name: "Public", slug: "", title: "Public",
          description: "", children: ["container", "instance"] },
        private: { id: "private", name: "Private", slug: "private", title: "Private",
          description: "", unpublished: true, children: ["secret"] },
      },
      nodes: {
        container: { ...makeBox(), id: "container", children: ["visible"] },
        visible: { ...makeBox(), id: "visible", text: { heading: 0, content: "PUBLIC" } },
        instance: { ...makeBox(), id: "instance", type: "instance", componentId: "shared" },
        master: { ...makeBox(), id: "master", children: ["nested"] },
        nested: { ...makeBox(), id: "nested", text: { heading: 0, content: "COMPONENT" } },
        secret: { ...makeBox(), id: "secret", text: { heading: 0, content: "PRIVATE-SENTINEL" } },
      },
      components: { shared: { id: "shared", name: "Shared", rootId: "master" } },
      assets: {},
    };
  }

  const opts = { framework: "html", language: "javascript", style: "css", scope: "component",
    pageId: "public" } as const;

  test("component export cannot select a stale node from a different page", () => {
    const site = doc();
    assert.ok(exportLimitations(site, { ...opts, nodeId: "secret" }).length > 0);
    assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "secret" }),
      /Select an element or component to export/i);
    assert.throws(() => generateExportProject(site, { ...opts, nodeId: "secret" }),
      /Select an element or component to export/i);
    assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "missing" }),
      /Select an element or component to export/i);
  });

  test("descendant nodes and referenced component masters remain valid selections", () => {
    const site = doc();
    for (const nodeId of ["container", "visible", "instance", "master", "nested"]) {
      const scoped = exportScopeDoc(site, { ...opts, nodeId });
      assert.deepEqual(scoped.pageOrder, ["__export_component__"]);
      assert.ok(scoped.nodes[nodeId], nodeId);
      assert.equal(scoped.nodes.secret, undefined);
      assert.doesNotMatch(generateExportProject(site, { ...opts, nodeId }).files["index.html"],
        /PRIVATE-SENTINEL/);
    }
    assert.equal(site.pages.public.children.includes("container"), true,
      "export must not mutate the saved document");
  });

  test("inherited object properties never count as page or component nodes", () => {
    const site = doc();
    assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "toString" }),
      /Select an element or component to export/i);
    assert.throws(() => exportScopeDoc(site, { ...opts, pageId: "constructor", nodeId: "visible" }),
      /Select a page to export/i);
  });

  test("malformed cyclic child pointers terminate without widening export scope", () => {
    const site = doc();
    site.nodes.visible.children = ["container"];
    assert.doesNotThrow(() => exportScopeDoc(site, { ...opts, nodeId: "visible" }));
    assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "secret" }),
      /Select an element or component to export/i);
  });

  test("static query variants bootstrap authored scripts before the page engine", async () => {
    const { QUERY_VARIANT_RUNTIME } = await import("../lib/generator/query-route");
    const site = doc();
    site.pages.private.unpublished = false;
    site.pages.private.slug = "";
    site.pages.private.query = "tab=2";
    site.pages.private.customTopHtml = '<script>window.__authoredScript = true;</script>';
    const project = generateExportProject(site, "html");
    const html = project.files["index.html"];
    assert.match(html, /data-runtime-sources="[^"]*data-loader\.js/);
    assert.match(html, /query-router\.js/);
    assert.equal((html.match(/<script defer /g) || []).length, 1,
      "generated data/event scripts are loaded only after the variant is ready");

    const events: string[] = [];
    const element = (type: string, textContent: string, source?: string) => {
      const attributes = [
        ...(type ? [{ name: "type", value: type }] : []),
        ...(source ? [{ name: "src", value: source }] : []),
      ];
      return {
        attributes, textContent,
        getAttribute: (name: string) => attributes.find((attr) => attr.name === name)?.value ?? null,
        hasAttribute: (name: string) => attributes.some((attr) => attr.name === name),
        replaceWith(script: { text: string; onload?: () => void }) {
          events.push(source ? "author-external-inserted" : type === "application/json" ? "incorrect-json" : "author-inline-inserted");
          if (!source) {
            assert.equal(script.text, textContent);
          } else {
            queueMicrotask(() => {
              events.push("author-external-loaded");
              script.onload?.();
            });
          }
        },
      };
    };
    const fragments = [
      element("application/json", '{"steps":[]}'),
      element("", "window.__authoredScript = true;"),
      element("module", "", "/author.js"),
    ];
    const host = {
      innerHTML: "",
      querySelectorAll(selector: string) {
        assert.equal(selector, "script");
        return fragments;
      },
    };
    const metadata = { value: "", setAttribute(_key: string, value: string) { this.value = value; } };
    const documentMock = {
      title: "",
      documentElement: { lang: "" },
      currentScript: {
        getAttribute: (_name: string) => JSON.stringify(["/data-loader.js", "/scripts.js"]),
      },
      querySelector(selector: string) {
        if (selector === "[data-variant-root]") return host;
        if (selector === "script[data-page-variants]") {
          return { textContent: JSON.stringify([
            { query: {}, html: "<h1>Default</h1>", title: "Default", lang: "en", description: "" },
            { query: { tab: "2" }, html: "<h1>Selected</h1>", title: "Selected", lang: "ja", description: "Chosen" },
          ]) };
        }
        if (selector === 'meta[name="description"]') return metadata;
        return null;
      },
      createElement() {
        return {
          text: "", src: "",
          setAttribute(name: string, value: string) {
            if (name === "src") this.src = value;
          },
          onload: undefined as undefined | (() => void),
          onerror: undefined as undefined | (() => void),
        };
      },
      body: {
        appendChild(script: { src: string; onload?: () => void }) {
          events.push(script.src);
          queueMicrotask(() => script.onload?.());
        },
      },
    };
    const run = new Function("document", "location", "URLSearchParams", "console", QUERY_VARIANT_RUNTIME);
    run(documentMock, { search: "?tab=2" }, URLSearchParams, console);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(host.innerHTML, "<h1>Selected</h1>");
    assert.equal(documentMock.title, "Selected");
    assert.equal(documentMock.documentElement.lang, "ja");
    assert.equal(metadata.value, "Chosen");
    assert.deepEqual(events, [
      "author-inline-inserted", "author-external-inserted", "author-external-loaded",
      "/data-loader.js", "/scripts.js",
    ]);
  });

  test("native formats refuse authored HTML they would otherwise omit", () => {
    const site = doc();
    const page = site.pages.public;
    const cases: Array<() => void> = [
      () => { site.customHeadHtml = '<meta name="authored-marker" content="head">'; },
      () => { site.customBodyEndHtml = '<aside data-marker="footer">Footer</aside>'; },
      () => { page.customTopHtml = '<div data-marker="top">Top</div>'; },
      () => { page.customEndHtml = '<div data-marker="end">End</div>'; },
    ];
    for (const setup of cases) {
      delete site.customHeadHtml;
      delete site.customBodyEndHtml;
      delete page.customTopHtml;
      delete page.customEndHtml;
      setup();
      for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
        assert.ok(exportLimitations(site, framework).some((reason) =>
          reason.includes("Custom HTML")), framework);
        assert.throws(() => generateExportProject(site, framework), /Custom HTML/);
      }
    }
    assert.equal(exportLimitations(site, "html").length, 0,
      "custom page HTML is supported in standalone HTML");
  });

  test("React refuses executable page scripts on data-driven DOM pages", () => {
    const site = doc();
    const page = site.pages.public;
    page.pageScripts = [{
      id: "init", trigger: "load",    steps: [{ id: "set", kind: "set-var", into: "state", value: "ready" }],
    }];
    page.customTopHtml = '<script>window.__pageStarted = true;</script>';
    assert.ok(exportLimitations(site, "react").some((reason) =>
      reason.includes("Custom scripts")));
    assert.throws(() => generateExportProject(site, "react"), /Custom scripts/);
    page.customTopHtml = '<script type="application/json">{"safe":true}</script>';
    assert.ok(!exportLimitations(site, "react").some((reason) =>
      reason.includes("Custom scripts")));
  });

  test("exporting a selected unpublished page includes it without publishing it in the source", () => {
    const site = doc();
    site.pages.public.unpublished = true;
    const scoped = exportScopeDoc(site, { ...opts, scope: "page" });
    assert.equal(scoped.pages.public.unpublished, false);
    assert.equal(site.pages.public.unpublished, true);
    assert.deepEqual(scoped.pageOrder, ["public"]);
    const html = generateExportProject(site, { ...opts, scope: "page" }).files["index.html"];
    assert.match(html, /PUBLIC/);
    assert.doesNotMatch(html, /PRIVATE-SENTINEL/);
    assert.equal(site.pages.public.unpublished, true,
      "exporting a page does not change the saved publication state");
  });

  test("every Tailwind export registers its CSS processing plugin", () => {
    const site = doc();
    const options = { language: "typescript", style: "tailwind", scope: "project" } as const;
    const registrations = [
      ["react", "vite.config.ts", /plugins:\s*\[tailwindcss\(\)\]/],
      ["vue", "vite.config.ts", /plugins:\s*\[vue\(\),\s*tailwindcss\(\)\]/],
      ["nuxt", "nuxt.config.ts", /vite:\s*\{\s*plugins:\s*\[tailwindcss\(\)\]/],
      ["sveltekit", "vite.config.ts", /plugins:\s*\[tailwindcss\(\),\s*sveltekit\(/],
      ["nextjs", "postcss.config.mjs", /"@tailwindcss\/postcss"/],
    ] as const;
    for (const [framework, path, plugin] of registrations) {
      const generated = generateExportProject(site, { ...options, framework });
      assert.match(generated.files[path], plugin, framework + ": missing Tailwind plugin");
      assert.match(generated.files["package.json"], /tailwindcss/,
        framework + ": missing Tailwind dependency");
    }
  });

  test("generated ZIPs reject file/directory collisions and unsafe paths", async () => {
    const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
    const empty = { binaries: {}, remoteAssets: {} };
    for (const path of ["../outside.txt", "/absolute.txt", "C:/drive.txt",
      "a//b.txt", "a/./b.txt", "a/../b.txt", "a\\b.txt", "bad\u0000name"]) {
      assert.throws(() => assertGeneratedPaths({ ...empty, files: { [path]: "x" } }),
        /Unsafe generated/, JSON.stringify(path));
    }
    assert.throws(() => assertGeneratedPaths({
      files: { "styles/site.css": "css", "styles/site.css/index.html": "html" },
      binaries: {}, remoteAssets: {},
    }), /file\/directory collision/);
    assert.throws(() => assertGeneratedPaths({
      files: { "public/assets/photo.png": "text" },
      binaries: { "public/assets/photo.png": "AQID" }, remoteAssets: {},
    }), /Duplicate generated/);
    assert.doesNotThrow(() => assertGeneratedPaths({
      files: { "styles/site.css": "css", "styles/globals.css": "css" },
      binaries: { "public/assets/photo.png": "AQID" }, remoteAssets: {},
    }));
  });

  test("HTML export reports a page slug that collides with the CSS file", () => {
    const site = doc();
    site.pages.private.unpublished = false;
    site.pages.private.slug = "styles/site.css";
    assert.throws(() => generateExportProject(site, "html"),
      /file\/directory collision: styles\/site\.css/);
    assert.doesNotThrow(() => generateExportProject(site, "nextjs"),
      "Next.js uses a different output tree without this HTML static-file collision");
  });

  test("generated names remain unambiguous on case-insensitive filesystems", async () => {
    const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
    const { buildAssetNames } = await import("../lib/generator/names");
    assert.throws(() => assertGeneratedPaths({
      files: { "About/index.html": "page", "about/index.html": "other" },
      binaries: {}, remoteAssets: {},
    }), /Case-insensitive generated file collision/);
    assert.throws(() => assertGeneratedPaths({
      files: { "ASSETS": "file", "assets/logo.png": "image" },
      binaries: {}, remoteAssets: {},
    }), /file\/directory collision/);
    for (const path of ["CON.txt", "public/nul/file", "public/name.", "public/invalid?file"]) {
      assert.throws(() => assertGeneratedPaths({
        files: { [path]: "content" }, binaries: {}, remoteAssets: {},
      }), /Unsafe generated/);
    }

    const site = doc();
    site.assets["upper"] = { id: "upper", name: "Logo.PNG", mimeType: "image/png",
      width: 1, height: 1, dataUrl: "data:image/png;base64,AQID" };
    site.assets["lower"] = { id: "lower", name: "logo.png", mimeType: "image/png",
      width: 1, height: 1, dataUrl: "data:image/png;base64,AQID" };
    const names = buildAssetNames(site);
    assert.notEqual(names.get("upper")?.toLowerCase(), names.get("lower")?.toLowerCase());
    assert.match(names.get("lower")!, /-2\.png$/i);
  });


  test("editable ZIP metadata cannot collide with generated page paths", async () => {
    const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
    const reserved = ["_tsumu/doc.json", "_tsumu/assets.json"];
    const empty = { binaries: {}, remoteAssets: {} };
    for (const path of ["_tsumu/doc.json", "_tsumu/doc.json/index.html",
      "_TSUMU/Assets.JSON/index.html", "_tsumu/assets.json"]) {
      assert.throws(() => assertGeneratedPaths({ ...empty, files: { [path]: "content" } }, reserved),
        /Duplicate generated|Case-insensitive generated|file\/directory collision/,
        "ZIP metadata collision: " + path);
    }
    const site = doc();
    site.pages.private.unpublished = false;
    site.pages.private.slug = "_tsumu/doc.json";
    const html = generateExportProject(site, "html");
    assert.ok(html.files["_tsumu/doc.json/index.html"],
      "normal HTML generation alone cannot detect later ZIP metadata entries");
    assert.throws(() => assertGeneratedPaths(html, reserved), /file\/directory collision/);
  });

  test("Windows device names are renamed, not rejected, as asset paths", async () => {
    const { buildAssetNames } = await import("../lib/generator/names");
    const site = doc();
    for (const [i, name] of ["CON.png", "con.png", "AUX.svg", "COM1.jpg",
      "lpt9.woff", "CON..png", "AUX.preview.svg", "com1.dark.logo.png", "auxiliary.preview.svg"].entries()) {
      const id = "asset" + i;
      site.assets[id] = { id, name, width: 1, height: 1,
        mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" };
    }
    const names = buildAssetNames(site);
    const files = Array.from(names.values());
    assert.equal(new Set(files.map((name) => name.toLowerCase())).size, files.length);
    assert.deepEqual(files, [
      "_CON.png", "_con-2.png", "_AUX.svg", "_COM1.jpg", "_lpt9.woff", "_CON-3.png",
      "_AUX.preview.svg", "_com1.dark.logo.png", "auxiliary.preview.svg",
    ]);
    assert.doesNotThrow(() => generateExportProject(site, "html"));
  });

  test("the ZIP root directory is portable for Windows device-name site titles", async () => {
    const { exportDirectoryName } = await import("../lib/exportZip");
    for (const name of ["CON", "prn", "AuX", "NUL", "com1", "LPT9"]) {
      assert.equal(exportDirectoryName(name), "_" + name.toLowerCase());
    }
    assert.equal(exportDirectoryName("Example website"), "example-website");
    assert.equal(exportDirectoryName(""), "my-site");
  });

  test("Next.js refuses imported HTML route collisions before generating files", () => {
    const site = doc();
    site.pages.public.rawHtml = "<!doctype html><html><body>Imported</body></html>";
    site.pages.private.unpublished = false;
    site.pages.private.slug = "";
    site.pages.private.query = "tab=2";
    assert.ok(exportLimitations(site, "nextjs").some((reason) =>
      reason.includes("share a path")));
    assert.throws(() => generateExportProject(site, "nextjs"), /share a path/);

    // クエリの異なる2つの取り込んだページも、1つの route.ts にまとめられる。
    site.pages.private.rawHtml = "<!doctype html><html><body>Other</body></html>";
    assert.throws(() => generateExportProject(site, "nextjs"), /share a path/);

    // URL が異なれば別々のルートになり、引き続き使える。
    site.pages.private.slug = "other";
    assert.deepEqual(exportLimitations(site, "nextjs"), []);
  });

  test("browser exports use decoded, deep credential scanning like GitHub Push", () => {
    const site = doc();
    site.pages.public.pageScripts = [{
      id: "load", trigger: "load",    steps: [{ id: "fetch", kind: "fetch", as: "data",
        url: "https://public.example/data?%61pi_key=literal" }],
    }];
    for (const framework of ["react", "vue", "nuxt", "sveltekit", "html", "single-html"] as const) {
      assert.ok(exportLimitations(site, framework).some((reason) =>
        reason.includes("secret API key")), framework + ": encoded query must be rejected");
    }
    const step = site.pages.public.pageScripts[0].steps[0];
    if (step.kind !== "fetch") throw new Error("Expected fetch fixture");
    step.url = "https://public.example/data";
    step.method = "POST";
    step.body = '{"nested":{"password":"literal"}}';
    assert.ok(exportLimitations(site, "html").some((reason) => reason.includes("secret API key")),
      "nested JSON must be rejected");
    step.body = "mode=public&client%5Fsecret=literal";
    assert.ok(exportLimitations(site, "react").some((reason) => reason.includes("secret API key")),
      "URL-encoded body fields must be rejected");
    step.body = undefined;
    step.headers = [{ name: "Authorization", value: "Bearer {private}" }];
    assert.ok(exportLimitations(site, "html").length > 0,
      "browser exports must never accept Authorization headers");
    step.headers = [{ name: "Metadata-Flavor", value: "Google" }];
    assert.ok(exportLimitations(site, "html").length > 0,
      "metadata service headers must retain previous export restrictions");
    step.headers = [];
    step.url = "https://public.example/data?api_key=%7Bkey%7D";
    assert.deepEqual(exportLimitations(site, "html"), [],
      "pure variable placeholders are not literal credentials");
  });

  test("every export, including Next.js SSR, rejects credentials before source generation", async () => {
    const { hasPublishCredentials } = await import("../lib/publish-security");
    const { prepareExportProject } = await import("../lib/export-formats");
    const site = doc();
    const sentinel = "PROBE_NOT_A_REAL_SECRET_SENTINEL_0529";
    site.pages.public.pageScripts = [{
      id: "load", trigger: "load",    steps: [{ id: "fetch", kind: "fetch", as: "data",
        url: "https://public.example/private",
        headers: [{ name: "Authorization", value: "Bearer " + sentinel }] }],
    }];
    assert.equal(hasPublishCredentials(site), true);
    for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit", "html", "single-html"] as const) {
      assert.ok(exportLimitations(site, framework).some(reason => reason.includes("editable ZIP")),
        framework + ": a server-only fetch still exposes hardcoded credentials in source or archives");
      assert.throws(() => generateExportProject(site, framework),
        /credentials|API key/i, framework);
    }
    await assert.rejects(prepareExportProject(site, "nextjs"), /credentials|API key/i,
      "the shared async ZIP / GitHub Push entrypoint must fail closed");

    const step = site.pages.public.pageScripts![0].steps[0];
    if (step.kind !== "fetch") throw new Error("Unexpected fixture type");
    step.headers = [];
    assert.equal(hasPublishCredentials(site), false);
    const project = generateExportProject(site, "nextjs");
    assert.match(project.files["app/page.tsx"], /fetchPublic/,
      "public server-side fetch remains available without embedded credentials");

    step.headers = [{ name: "Metadata-Flavor", value: "Google" }];
    assert.ok(exportLimitations(site, "nextjs").length > 0,
      "reserved internal metadata headers are unsafe even in SSR");

    // コンポーネントやページの範囲での書き出しでは、生成する編集可能な文書に含まれない秘密を
    // 除けることがある。プロジェクトの書き出しでは、すべてのページを調べなければならない。
    step.headers = [];
    site.pages.private.pageScripts = [{
      id: "secret-load", trigger: "load",    steps: [{ id: "secret-fetch", kind: "fetch", as: "secret",
        url: "https://public.example/private?api_key=" + sentinel }],
    }];
    assert.ok(exportLimitations(site, "nextjs").length > 0);
    assert.deepEqual(exportLimitations(site, { framework: "nextjs", language: "typescript",
      style: "css", scope: "page", pageId: "public" }), [],
      "a scoped page archive does not include unrelated private pages");
  });

  test("generated filename components are bounded for portable ZIP extraction", async () => {
    const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
    const { buildAssetNames } = await import("../lib/generator/names");
    const { exportDirectoryName } = await import("../lib/exportZip");
    const empty = { binaries: {}, remoteAssets: {} };
    for (const tooLong of ["a".repeat(256) + ".txt", "あ".repeat(86) + ".png"]) {
      assert.throws(() => assertGeneratedPaths({ ...empty, files: { [tooLong]: "data" } }),
        /Unsafe generated/, "filesystem segment longer than 255 bytes: " + tooLong.length);
    }
    const site = doc();
    site.assets["long"] = {
      id: "long", name: "A".repeat(500) + ".png", width: 1, height: 1,
      mimeType: "image/png", dataUrl: "data:image/png;base64,AQID",
    };
    const path = buildAssetNames(site).get("long")!;
    assert.ok(path.length <= 140, "asset path should leave room for unique suffixes");
    assert.match(path, /\.png$/);
    assert.doesNotThrow(() => generateExportProject(site, "html"));
    assert.ok(exportDirectoryName("A".repeat(1000)).length <= 96);
  });

  test("exported CSS contains untrusted style-map values as declarations only", async () => {
    const { safeCssDeclaration } = await import("../lib/css-declaration");
    assert.equal(safeCssDeclaration("color", "rebeccapurple"), "color: rebeccapurple;");
    assert.equal(safeCssDeclaration("WebkitLineClamp", "3"), "-webkit-line-clamp: 3;");
    assert.equal(safeCssDeclaration("--brand-color", "#abc"), "--brand-color: #abc;");
    assert.equal(safeCssDeclaration("fontFamily", '"A; B", sans-serif'),
      'font-family: "A; B", sans-serif;');
    for (const value of ["red; } body { display:none", '"</style><script>unsafe()</script>"',
      "rgb(1,2", "red/* unclosed", "red; background:black"]) {
      assert.equal(safeCssDeclaration("color", value), null);
    }
    assert.equal(safeCssDeclaration("color; } body {", "red"), null);

    const site = doc();
    site.nodes.visible.styles = { base: { default: {
      "color; } body {": "red",
      color: 'red; } body { --__PROBE_CSS_BREAKOUT__: yes; } /*',
      backgroundImage: "url(data:image/png;base64,AQID)",
      fontFamily: '"A; B", sans-serif',
      WebkitLineClamp: "3",
      "--brand-color": "#abc",
    } } };
    site.nodes.visible.customCss = 'padding: 5px; border-radius: calc(2px + 1px);';
    site.pages.public.bodyStyles = { base: { default: {
      color: '"</style><script>window.__PROBE_CSS_XSS__=1</script>"',
      margin: "12px",
    } } };
    site.pages.public.htmlBackground = 'red; } body { --__PROBE_HTML_BACKGROUND_BREAKOUT__: yes; } /*';
    for (const format of ["nextjs", "html"] as const) {
      const project = generateExportProject(site, format);
      const css = project.files["styles/site.css"];
      assert.doesNotMatch(css, /__PROBE_CSS_BREAKOUT__|__PROBE_CSS_XSS__|__PROBE_HTML_BACKGROUND_BREAKOUT__/);
      assert.match(css, /background-image: url\(data:image\/png;base64,AQID\);/);
      assert.match(css, /font-family: "A; B", sans-serif;/);
      assert.match(css, /-webkit-line-clamp: 3;/);
      assert.match(css, /--brand-color: #abc;/);
      assert.match(css, /padding: 5px;/);
      assert.match(css, /border-radius: calc\(2px \+ 1px\);/);
      assert.match(css, /margin: 12px;/);
    }
  });

  test("custom keyframes and motion settings cannot escape generated CSS", async () => {
    const { safeCssKeyframesBody } = await import("../lib/css-declaration");
    for (const good of ["from { opacity: 0; } to { opacity: 1; }",
      "0%, 30.5% { transform: translateX(0); } 100% { transform: translateX(1px); }",
      "/* start */ from { background: url(data:image/png;base64,AQID); }"]) {
      assert.equal(safeCssKeyframesBody(good), true, good);
    }
    for (const bad of ["from { opacity: 0; } } body { --__PROBE_KF_BREAKOUT__: yes; } /*",
      "from { opacity:0;", "from { opacity:0; } @import url(x);",
      "body { color:red; }", 'from { content: "</style><script>x</script>"; }']) {
      assert.equal(safeCssKeyframesBody(bad), false, bad);
    }
    const site = doc();
    site.nodes.visible.motions = [
      { id: "valid", trigger: "load", keyframes: "custom",
        customKeyframes: "from { opacity: 0; } to { opacity: 1; }",
        duration: 1, delay: 0, easing: "ease" },
      { id: "broken", trigger: "load", keyframes: "custom",
        customKeyframes: "from { opacity: 0; } } body { --__PROBE_KF_BREAKOUT__: yes; } /*",
        duration: 1, delay: 0, easing: "ease" },
      { id: "easing", trigger: "hover", keyframes: "fade-in",
        duration: 1, delay: 0, easing: "ease; } body { --__PROBE_EASING_BREAKOUT__: yes; } /*" },
      { id: "transition", trigger: "state", property: "opacity, transform",
        duration: 0.2, delay: 0, easing: "ease" },
    ];
    const css = generateExportProject(site, "html").files["styles/site.css"];
    assert.match(css, /@keyframes anim-visible-valid/);
    assert.match(css, /transition: opacity, transform 0\.2s ease 0s;/);
    assert.doesNotMatch(css, /__PROBE_KF_BREAKOUT__|__PROBE_EASING_BREAKOUT__/);
  });

  test("Vue TypeScript CSS Modules has Vite ambient CSS module types", () => {
    const site = doc();
    const { files } = generateExportProject(site, {
      framework: "vue", language: "typescript", style: "css-modules", scope: "project",
    });
    assert.match(files["src/env.d.ts"], /reference types="vite\/client"/);
    assert.match(files["src/App.vue"], /import siteStyles from "\.\/site\.module\.css"/);
    assert.match(files["tsconfig.json"], /src\/\*\*\/\*\.ts/);
  });
});

describe("export-ssr-dns", () => {
  test("generated Node SSR transport blocks private DNS answers at socket connection time", async () => {
    const doc: SiteDoc = {
      siteName: "External fetch check", pageOrder: ["home"],
      pages: { home: { id: "home", name: "Home", title: "Home", slug: "",
        description: "", children: ["item"],
        pageScripts: [{ id: "load", trigger: "load",        steps: [{ id: "get", kind: "fetch", url: "https://public.example.test/data", as: "data" }] }],
      } },
      nodes: { item: { ...makeBox(), id: "item" } }, assets: {},
    };
    const project = generateExportProject(doc, "sveltekit");
    const source = project.files["src/lib/server-request.js"];
    assert.match(source, /Private DNS address blocked/);
    assert.match(source, /agent: false/);
    assert.match(source, /bytes > 5 \* 1024 \* 1024/);
    const { requestPublic } = await import("data:text/javascript;base64," +
      Buffer.from(source).toString("base64")) as {
      requestPublic: (url: string, opts: RequestInit, base: string,
        local: (url: string) => Promise<Response>) => Promise<Response>;
    };

    const processModule = process as typeof process & {
      getBuiltinModule?: (name: string) => unknown;
    };
    const descriptor = Object.getOwnPropertyDescriptor(processModule, "getBuiltinModule");
    let requests = 0, lookups = 0, outbound = 0;
    Object.defineProperty(processModule, "getBuiltinModule", {
      configurable: true, writable: true,
      value: (name: string): unknown => {
        if (name === "node:dns") return {
          lookup(_host: string, options: { family: number }, cb: Function) {
            lookups++;
            assert.equal(options.family, 4);
            cb(null, [{ address: "127.0.0.1", family: 4 }]);
          },
        };
        if (name === "node:https") return {
          request(_target: URL, opts: {
            lookup: (host: string, flags: unknown, callback: Function) => void;
            agent: boolean;
          }) {
            requests++;
            assert.equal(opts.agent, false);
            let errorHandler: (error: Error) => void = () => {};
            return {
              on(event: string, callback: (error: Error) => void) {
                if (event === "error") errorHandler = callback;
                return this;
              },
              end() {
                opts.lookup("public.example.test", {}, (error: Error | null) => {
                  if (error) errorHandler(error);
                  else throw new Error("The DNS pinning check incorrectly permitted loopback");
                });
              },
            };
          },
        };
        throw new Error("Unexpected builtin request: " + name);
      },
    });
    try {
      await assert.rejects(
        requestPublic("https://public.example.test/data", {}, "https://site.example",
          async () => { outbound++; throw new Error("No local request expected"); }),
        /Private DNS address blocked/);
      assert.equal(requests, 1);
      assert.equal(lookups, 1);
      assert.equal(outbound, 0);
    } finally {
      if (descriptor) Object.defineProperty(processModule, "getBuiltinModule", descriptor);
      else Reflect.deleteProperty(processModule, "getBuiltinModule");
    }
  });
});

describe("native-export-path-security", () => {
  function fixture(slug: string): SiteDoc {
    return {
      siteName: "Native export route audit",
      pageOrder: ["home"],
      pages: {
        home: {
          id: "home", name: "Home", title: "Home", slug,
          description: "", children: ["content"],
          pageScripts: [{
            id: "load", trigger: "load",          steps: [{ id: "get", kind: "fetch", url: "https://api.example.test/data", as: "records" }],
          }],
        },
      },
      nodes: { content: { ...makeBox(), id: "content" } },
      assets: {},
    };
  }

  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const base = framework === "vue" ? "src/" :
      framework === "nuxt" ? "app/generated/" : "src/lib/";

    test(framework + " native routes match percent-encoded Unicode without decoding encoded slashes", async () => {
      const files = generateExportProject(fixture("資料/ご案内"), framework).files;
      const routes = files[base + "site-routes.js"];
      assert.ok(routes);
      const module = await import("data:text/javascript;base64," +
        Buffer.from(routes).toString("base64")) as {
          pages: Array<{ id: string }>;
          selectPage: (pathname: string, query: string) => { id: string } | null;
        };

      assert.equal(module.selectPage("/%E8%B3%87%E6%96%99/%E3%81%94%E6%A1%88%E5%86%85/", "")?.id, "home");
      assert.equal(module.selectPage("/資料/ご案内", "")?.id, "home");
      assert.equal(module.selectPage("/%E8%B3%87%E6%96%99%2F%E3%81%94%E6%A1%88%E5%86%85", ""), null);
      assert.equal(module.selectPage("/%broken", ""), null);
    });

    test(framework + " generated SSR rejects reserved IPv4 ranges and home.arpa", () => {
      const files = generateExportProject(fixture(""), framework).files;
      const code = files[base + "server-request.js"];
      assert.ok(code);
      const policy = /^function publicHost\(host\) \{[\s\S]*?^\}/m.exec(code);
      assert.ok(policy);
      const isPublic = new Function(policy[0] + "\nreturn publicHost;")() as (host: string) => boolean;

      for (const host of [
        "192.0.0.9", "192.0.8.1", "192.168.1.1", "127.0.0.1",
        "169.254.169.254", "api.home.arpa", "home.arpa", "localhost",
      ]) {
        assert.equal(isPublic(host), false, framework + " allowed " + host);
      }
      assert.equal(isPublic("api.example.test"), true);
    });
  }

  test("generated SSR blocks recursive requests to a percent-encoded Unicode page path", async () => {
    const code = generateExportProject(fixture("資料/ご案内"), "sveltekit")
      .files["src/lib/server-request.js"];
    const module = await import("data:text/javascript;base64," +
      Buffer.from(code).toString("base64")) as {
        requestPublic: (
          uri: string, init: RequestInit, base: string,
          localFetch: (url: string, init: RequestInit) => Promise<Response>,
        ) => Promise<Response>;
      };
    let requests = 0;
    await assert.rejects(
      module.requestPublic("/%E8%B3%87%E6%96%99/%E3%81%94%E6%A1%88%E5%86%85/", {},
        "https://site.example", async () => {
          requests++;
          return new Response("{}");
        }),
      /Recursive generated page fetch/,
    );
    assert.equal(requests, 0, "a recursive route must be rejected before it reaches localFetch");
  });
});

describe("ssrf-generated-parity", () => {
  function fixture(): SiteDoc {
    return {
      siteName: "SSRF boundary fixture", pageOrder: ["home"], assets: {},
      pages: { home: {
        id: "home", name: "Home", title: "Home", slug: "",
        description: "", children: ["node"],
      }},
      nodes: { node: { ...makeBox(), id: "node", name: "Node" } },
    };
  }

  type PublicRequest = (uri: string, init: RequestInit, base: string,
    localFetch: (uri: string, init: RequestInit) => Promise<Response>) => Promise<Response>;

  test("server API and generated SSR refuse private destinations before any HTTP request", async () => {
    // 書き出した SSR のランタイムは、lib/safe-fetch から写したものではなく、実際に生成した JavaScript
    // として読み込む。写しのほうの回帰は、別に見つけられる。
    const project = generateExportProject(fixture(), "sveltekit");
    const generated = project.files["src/lib/server-request.js"];
    assert.ok(generated, "SvelteKit must ship its request policy");
    const { requestPublic } = await import("data:text/javascript;base64," +
      Buffer.from(generated).toString("base64")) as { requestPublic: PublicRequest };

    const hosts = [
      "127.0.0.1", "127.1", "2130706433", "0x7f000001",
      "10.1.2.3", "172.31.255.255", "192.168.0.1", "169.254.169.254",
      "100.100.100.200", "198.18.0.1", "198.51.100.5", "203.0.113.7",
      "0.0.0.0", "[::1]", "[::ffff:127.0.0.1]", "[fe80::1]",
      "[2001:db8::1]", "[2002::1]", "localhost", "metadata.google.internal",
      "router.lan", "database",
    ];
    const previousFetch = globalThis.fetch;
    let outbound = 0, local = 0;
    globalThis.fetch = async () => {
      outbound++;
      return new Response("{}", { status: 200 });
    };
    const localFetch = async () => {
      local++;
      return new Response("{}", { status: 200 });
    };
    try {
      for (const hostname of hosts) {
        for (const scheme of ["http:", "https:"]) {
          const raw = scheme + "//" + hostname + "/metadata?secret=probe";
          const url = new URL(raw);
          assert.ok(isPrivateHost(url.hostname), "API guard missed " + raw);
          await assert.rejects(
            assertPublicUrl(raw),
            (error: unknown) => error instanceof BlockedUrlError,
            "API accepted " + raw,
          );
          await assert.rejects(
            requestPublic(raw, {}, "https://published.example", localFetch),
            undefined, "Generated SSR accepted " + raw,
          );
        }
      }
      // URL のユーザー名やパスワードで、公開のホスト名が方針を迂回できてはならない。
      const credentialed = "https://user:secret@1.1.1.1/private";
      await assert.rejects(assertPublicUrl(credentialed), BlockedUrlError);
      await assert.rejects(requestPublic(credentialed, {}, "https://published.example", localFetch));
      assert.equal(outbound, 0, "a private address was fetched");
      assert.equal(local, 0, "a private address was sent to the local fetch");

      // 通るべきものも確かめ、API のネットワークの方針と、生成した SSR のより厳しい明示的なオリジンの
      // 許可リストを区別する。公開の IP は、API では許されるが、それを許可リストに入れていないサイトでは許されない。
      const allowed = "https://1.1.1.1/public";
      assert.equal((await assertPublicUrl(allowed)).href, allowed);
      await assert.rejects(
        requestPublic(allowed, {}, "https://published.example", localFetch),
        /origin is not allowed/,
      );
      assert.equal(outbound, 0);
      assert.equal(local, 0);

      // 同じオリジンの相対のデータの API は、外部のネットワークに接続せず、生成したフレームワークの
      // ローカルの fetch を通して、引き続き動かなければならない。
      const response = await requestPublic("/api/safe", {}, "https://published.example", localFetch);
      assert.equal(response.status, 200);
      assert.equal(local, 1);
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe("export-regex-complexity", () => {
  const catalogCode = "^([A-Z]+)-([0-9]+)$";

  function site(): SiteDoc {
    const transform: ScriptStep = {
      id: "replace", kind: "transform", source: "input", into: "output",
      transform: { kind: "replace", find: catalogCode, replacement: "$2:$1", regex: true },
    };
    return {
      siteName: "Catalog", assets: {}, pageOrder: ["home"],
      nodes: { text: { ...makeText("{output}"), id: "text", scripts: [
        { id: "click", trigger: "click", steps: [{ ...transform, id: "click-replace", into: "clickedOutput" }] },
      ] } },
      pages: { home: {
        id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["text"],
        pageScripts: [{ id: "load", trigger: "load", steps: [
          { id: "input", kind: "set-var", into: "input", value: "KIT-2026" }, transform,
        ] }],
      } },
    };
  }

  /** この形式で、コードの生成と機能の削除の後に残った評価器を取り出す。 */
  function emittedEvaluator(source: string): string {
    const pending: unknown[] = [parse_2(source, { ecmaVersion: "latest", sourceType: "module" })];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) { pending.push(...value); continue; }
      const node = value as Record<string, unknown>;
      if (node.type === "VariableDeclarator") {
        const name = (node.id as { name?: string } | undefined)?.name;
        if (name === "evaluateValueRecipe" || name === "evalRecipe") {
          const expression = node.init as { start: number; end: number };
          return source.slice(expression.start, expression.end);
        }
      }
      pending.push(...Object.values(node));
    }
    assert.fail("export did not include its recipe evaluator");
  }

  // 各項目は最初の選択肢から始まり、1つの項目の中の選択肢は、それぞれ先頭の文字が異なる。
  const catalogFields = [
    ["Mon", "Tue", "Wed"], ["red", "blue", "green"], ["small", "medium", "large"],
    ["east", "west", "north"], ["yes", "no", "later"], ["bus", "rail", "walk"],
  ];
  function catalogSample(fieldCount: number) {
    const fields = catalogFields.slice(0, fieldCount);
    return {
      input: fields.map(([first]) => first).join("/"),
      pattern: "^" + fields.map((choices) => "(?:" + choices.join("|") + ")").join("/") + "$",
    };
  }

  for (const [framework, path] of [
    ["nextjs", "lib/value-recipe.ts"],
    ["react", "public/scripts.js"],
    ["html", "data-loader.js"],
    ["vue", "src/site-data.js"],
    ["nuxt", "app/generated/site-data.js"],
    ["sveltekit", "src/lib/site-data.js"],
  ] as const) {
    test(`${framework} published evaluator applies regex budgets to ordinary catalog values`, () => {
      const files = generateExportProject(site(), framework).files;
      assert.ok(files[path], path);
      // Next.js は TypeScript を、他の形式は JavaScript を出力する。
      // Acorn や vm で評価器を解析・実行する前に、型だけの構文を取り除く。
      const runtimeSource = path.endsWith(".ts")
        ? transformSync(files[path], { loader: "ts", target: "es2022" }).code
        : files[path];
      const evaluator = emittedEvaluator(runtimeSource);
      const script = new vm.Script("const __name = (fn) => fn; (" + evaluator + ")(input, [transform]);");
      const evaluate = (input: string, find: string, replacement: string) => JSON.parse(JSON.stringify(
        script.runInNewContext({ input, transform: { kind: "replace", find, replacement, regex: true } }),
      ));
      const rejected = { kind: "error", code: "invalid-regex" };

      assert.deepEqual(evaluate("KIT-2026", catalogCode, "$2:$1"), { kind: "value", value: "2026:KIT" });
      const section = "CATALOG".repeat(200);
      assert.deepEqual(evaluate(section, "^([A-Z]+)$", "[$1]"), { kind: "value", value: "[" + section + "]" });
      assert.deepEqual(evaluate(section + "-2026", catalogCode, "$2:$1"), rejected);

      const five = catalogSample(5);
      assert.deepEqual(evaluate(five.input, five.pattern, "selected"), { kind: "value", value: "selected" });
      const six = catalogSample(6);
      assert.deepEqual(evaluate(six.input, six.pattern, "selected"), rejected);
    });
  }
});

describe("export-recursive-ssr", () => {
  test("generated Vue/Nuxt/SvelteKit SSR cannot recursively fetch its own page routes", async () => {
    const doc: SiteDoc = {
      siteName: "Guard self-fetch", pageOrder: ["home", "about"],
      pages: {
        home: { id: "home", name: "Home", title: "Home", slug: "", description: "",
          children: ["box"], pageScripts: [{ id: "load", trigger: "load",          steps: [{ id: "f", kind: "fetch", url: "/api/items", as: "items" }] }] },
        about: { id: "about", name: "About", title: "About", slug: "about",
          description: "", children: [] },
      },
      nodes: { box: { ...makeBox(), id: "box" } }, assets: {},
    };
    for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
      const project = generateExportProject(doc, framework);
      const modulePath = framework === "vue" ? "src/server-request.js"
        : framework === "nuxt" ? "app/generated/server-request.js" : "src/lib/server-request.js";
      const source = project.files[modulePath];
      assert.ok(source, modulePath);
      const { requestPublic } = await import("data:text/javascript;base64," +
        Buffer.from(source).toString("base64")) as {
        requestPublic: (uri: string, init: RequestInit, base: string,
          local: (uri: string) => Promise<Response>) => Promise<Response>;
      };
      let localRequests = 0;
      const local = async () => {
        localRequests++;
        return new Response("{}", { status: 200 });
      };
      for (const uri of ["/", "/?refresh=1", "/about", "/about/", "/about/?query=x"]) {
        await assert.rejects(
          requestPublic(uri, {}, "https://published.example", local),
          /Recursive generated page fetch/, framework + ": " + uri,
        );
      }
      assert.equal(localRequests, 0, framework);
      await requestPublic("/api/items?limit=2", {}, "https://published.example", local);
      assert.equal(localRequests, 1, framework);
    }
  });

  test("generated SSR never passes a normalized network-path reference to a local fetch", async () => {
    const doc: SiteDoc = {
      siteName: "Relative fetch", pageOrder: ["home"], assets: {}, nodes: {},
      pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    };
    for (const [format, path] of [
      ["vue", "src/server-request.js"], ["nuxt", "app/generated/server-request.js"],
      ["sveltekit", "src/lib/server-request.js"],
    ] as const) {
      const code = generateExportProject(doc, format).files[path];
      const { requestPublic } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
      const destinations: string[] = [];
      const base = "https://published.example";
      const local = async (url: string) => {
        destinations.push(new URL(url, base).href);
        return new Response("{}");
      };
      for (const uri of ["/a/..//127.0.0.1/private", "/a/%2e%2e//127.0.0.1/private"]) {
        await assert.rejects(requestPublic(uri, {}, base, local));
      }
      assert.deepEqual(destinations, [], format);
      await requestPublic("/api/items", {}, base, local);
      assert.deepEqual(destinations, [base + "/api/items"], format);
    }
  });

  test("generated Vue HTTP server rejects invalid request targets before rendering", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { request } = await import("node:http");
    const dir = await mkdtemp(join(tmpdir(), "vue-request-target-"));
    const doc: SiteDoc = {
      siteName: "Request target", pageOrder: ["home"], assets: {}, nodes: {},
      pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    };
    const project = generateExportProject(doc, "vue");
    const source = project.files["server.mjs"];
    try {
      await mkdir(join(dir, "dist/client"), { recursive: true });
      await mkdir(join(dir, "dist/server"), { recursive: true });
      await writeFile(join(dir, "package.json"), '{"type":"module"}');
      await writeFile(join(dir, "dist/client/index.html"), "<title><!--page-title--></title><!--app-html--><!--app-data-->");
      const result = {
        id: "home", title: "$& <title>", html: "<p>$&</p><!--app-data-->",
        vars: { value: "$' and $` and $$ <test>" }, description: "", status: 200,
      };
      await writeFile(join(dir, "dist/server/entry-server.js"),
        "export function render() { return " + JSON.stringify(result) + "; }");
      // 生成したハンドラーはそのまま保ち、テストが一時的なポートを選べるようにする。
      await writeFile(join(dir, "server.mjs"), source.replace('process.env.NODE_ENV === "production"', "true")
        .replace(/^server\.listen\(.*$/m, "export { server };"));
      const { server } = await import(pathToFileURL(join(dir, "server.mjs")).href);
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const get = (path: string) => new Promise<number>((resolve, reject) => {
          const req = request({ host: "127.0.0.1", port: server.address().port, path }, res => {
            res.resume(); resolve(res.statusCode!);
          });
          req.on("error", reject); req.end();
        });
        assert.equal(await get("/\\127.0.0.2/"), 400);
        assert.equal(await get("//["), 400);
        assert.equal(await get("/"), 200);
        const html = await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text();
        assert.ok(html.includes("<title>$&amp; &lt;title&gt;</title>" + result.html));
        const payload = /<script id="site-payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
        assert.ok(payload);
        assert.deepEqual(JSON.parse(payload[1]), { id: result.id, vars: result.vars });
      } finally { await new Promise<void>(resolve => server.close(resolve)); }
    } finally { await rm(dir, { force: true, recursive: true }); }
  });
});

describe("generated-safe-fetch-sync", () => {
  test("generated server-side fetch policy matches the audited source exactly", () => {
    const source = readFileSync(new URL("../lib/safe-fetch.ts", import.meta.url), "utf8");
    assert.equal(
      SAFE_FETCH_SOURCE,
      source,
      "Run node --import tsx scripts/sync-fetch-runtime.mts to synchronize generated security code",
    );
  });
});

describe("code-literal-security", () => {
  test("generated code literals preserve values without emitting HTML script terminators", () => {
    for (const original of [
      "</script><script>alert(1)</script>", "<img src=x onerror=alert(1)>",
      "quote \" slash \\ and <>&", "\u2028\u2029", { nested: ["</script>", "<svg/onload=alert(1)>"] },
    ]) {
      const literal = codeLiteral(original);
      assert.deepEqual(JSON.parse(literal), original);
      assert.doesNotMatch(literal, /[<>&\u2028\u2029]/);
    }
    assert.match(codeLiteral("</script>"), /\\u003c\/script\\u003e/);
    assert.throws(() => codeLiteral(undefined), TypeError);
  });

  test("document patch never accepts prototype-chain keys", () => {
    const doc = {
      schemaVersion: 1, siteName: "Safe", pages: { p: { id: "p", name: "p", slug: "", children: [] } },
      pageOrder: ["p"], nodes: {}, assets: {},
    } as SiteDoc;
    for (const name of ["__proto__", "constructor", "prototype"]) {
      const patch = [{ path: ["nodes", name], value: { injected: true } }];
      assert.equal(isDocPatch(patch), false);
      assert.throws(() => applyDocPatch(doc, patch));
    }
    assert.equal((Object.prototype as Record<string, unknown>).injected, undefined);
  });
});
});

describe("export-security", () => {
function doc(): SiteDoc {
  return {
    siteName: "Site {1 + 2} </script>",
    lang: 'ja" onload="globalThis.__attributeExecuted=1',
    pages: {
      home: { id: "home", name: "Home", slug: "", title: 'Page </title><script>unsafe()</script>',
        description: "", children: ["text", "picture"] },
    },
    pageOrder: ["home"],
    nodes: {
      text: { ...makeBox(), id: "text", text: {
        content: "Literal {{ 3 + 4 }} and {1 + 2}", heading: 1,
      } },
      picture: { ...makeBox(), id: "picture", type: "image", image: {
        src: "data:image/png;base64,AQID",
        alt: "Image {1 + 2}", width: 1, height: 1,
      } },
    },
    assets: {},
  };
}

test("generated Vue and Svelte components never compile authored plain text into expressions", () => {
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const project = generateExportProject(doc(), framework);
    const path = framework === "nuxt" ? "app/generated/pages/Page0.vue" :
      framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
    const source = project.files[path];
    assert.ok(source, path);
    assert.ok(source.includes('src="data:image/png;base64,AQID"'));
    // 文字参照で書いた波かっこは普通の HTML の文字で、コンパイルされる式ではない。
    assert.match(source, /Literal &#123;&#123; 3 \+ 4 &#125;&#125; and &#123;1 \+ 2&#125;/);
    assert.doesNotMatch(source, /Literal \{\{/);
    assert.match(source, /Image &#123;1 \+ 2&#125;/);
    if (framework === "sveltekit") {
      const template = project.files["src/app.html"];
      // ページごとのメタデータは、静的な骨組みにコンパイルせず、SSR のフックで挿入する。
      // 実行時のエスケープは、native-page-language で試す。
      assert.ok(template.includes('lang="%page.language%"'));
      assert.ok(!template.includes('lang="ja" onload="'));
      assert.ok(!template.includes(doc().siteName));
      const route = project.files["src/routes/+page.svelte"];
      assert.doesNotMatch(route, /Site \{1 \+ 2\} <\/script>/);
      assert.match(route, /<title>\{data\.title\} \| \{/);
    }
    if (framework === "vue") {
      assert.doesNotMatch(project.files["index.html"], /onload="globalThis/);
      // 生成したサーバーが、リクエストごとにエスケープしたメタデータを渡す。
      // native-ssr-export.test.mts で、実際に実行するサーバーの回帰テストを参照。
      assert.match(project.files["index.html"], /lang="<!--page-language-->"/);
      assert.doesNotMatch(project.files["server.mjs"], /req\.headers\.host/);
    }
  }
});


test("list predicates and variable condition operators share scalar text comparison semantics", () => {
  const ready = [{ status: "ready", price: 8 }, { status: "ready", price: 1 },
    { status: "draft", price: 9 }];
  const result = filterItems(ready, [{ kind: "filter", conds: [
    { field: "status", op: "eq", value: "ready" },
    { field: "price", op: "gte", value: "5", and: true },
  ] }]);
  assert.deepEqual(result, [ready[0]]);
  assert.equal(matchesValueCondition("alphabet", "contains", "pha"), true);
  assert.equal(matchesValueCondition({ x: 1 }, "has-key", "x"), true);
  assert.equal(matchesValueCondition([1, 2], "contains", 2), true);
  assert.equal(matchesValueCondition([1, 2], "contains", "2"), true);
});
test("native framework links reject active URL schemes without breaking images", async () => {
  const source = nativeDataModule();
  const uri = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  const resolver = await import(uri);
  for (const unsafe of [
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "data:image/svg+xml;base64,PHN2Zy8+", "//attacker.invalid/path",
    "java\\nscript:alert(1)",
  ]) {
    assert.equal(resolver.resolveUrl(unsafe, {}), "#", unsafe);
  }
  assert.equal(resolver.resolveUrl("https://example.test/", {}), "https://example.test/");
  assert.equal(resolver.resolveResourceUrl("data:image/png;base64,AQID", {}),
    "data:image/png;base64,AQID");
  assert.equal(resolver.resolveResourceUrl("javascript:alert(1)", {}), "#");
});

test("single HTML preserves srcset data URLs and filenames containing commas", async () => {
  const source = {
    files: {
      "index.html": '<!doctype html><html><body><img srcset="data:image/png;base64,AQID 1x, assets/photo,one.png 2x"></body></html>',
    },
    binaries: { "assets/photo,one.png": "BAUG" },
    remoteAssets: {},
  };
  const project = await toSingleHtmlProject(source);
  const html = project.files["index.html"];
  assert.match(html, /data:image\/png;base64,AQID 1x, data:image\/png;base64,BAUG 2x/);
  assert.doesNotMatch(html, /assets\/photo,one\.png/);
  assert.deepEqual(Object.keys(project.files), ["index.html"]);
});

test("generated SSR request policy blocks reserved hosts, sensitive headers and Host-origin bypass", async () => {
  const site = doc();
  site.pages.home.pageScripts = [{
    id: "load", trigger: "load",    steps: [{ id: "fetch", kind: "fetch", as: "data",
      url: "http://100.100.100.200/latest" }],
  }];
  const project = generateExportProject(site, "sveltekit");
  const serverModule = project.files["src/lib/server-request.js"];
  assert.ok(serverModule);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(serverModule).toString("base64")) as {
    requestPublic: (uri: string, init: RequestInit, base: string,
      localFetch: (uri: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
  };
  let remoteCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    remoteCalls++;
    return new Response("{}", { status: 200 });
  };
  try {
    const localRequests: string[] = [];
    const local = async (uri: string) => {
      localRequests.push(uri);
      return new Response("{}", { status: 200 });
    };
    await assert.rejects(
      requestPublic("http://100.100.100.200/latest", {}, "https://site.example", local),
      /not allowed/);
    await assert.rejects(
      requestPublic("/private", { headers: { Authorization: "Bearer private" } },
        "https://site.example", local),
      /Sensitive headers/);
    await assert.rejects(
      requestPublic("https://site.example/private", {}, "https://site.example", local),
      /Absolute same-origin/);
    await requestPublic("/api/data?limit=1", {}, "https://site.example", local);
    assert.deepEqual(localRequests, ["/api/data?limit=1"]);
    assert.equal(remoteCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test("generated SSR limits same-origin data responses even without Content-Length", async () => {
  const project = generateExportProject(doc(), "sveltekit");
  const source = project.files["src/lib/server-request.js"];
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(source).toString("base64")) as {
    requestPublic: (uri: string, init: RequestInit, base: string,
      local: (uri: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
  };
  const accepted = await requestPublic("/api/okay", {}, "https://site.example",
    async () => new Response('{"ready":true}'));
  assert.deepEqual(await accepted.json(), { ready: true });

  let pulls = 0, cancellations = 0;
  await assert.rejects(
    requestPublic("/api/large", {}, "https://site.example", async () =>
      new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() { cancellations++; },
      }))),
    /SSR response exceeds 5 MB/,
  );
  assert.equal(cancellations, 1);
  assert.ok(pulls <= 8);
});

test("partial export and generated JS reject inherited object properties", () => {
  const vars: Record<string, unknown> = {};
  setVarPath(vars, "__proto__.polluted", true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal((vars["__proto__"] as Record<string, unknown>).polluted, true);
  vars.rows = [];
  setVarPath(vars, "rows.1000001", "bad");
  assert.equal((vars.rows as unknown[]).length, 0);
  const expression = fieldExpr("item", "constructor");
  const read = new Function("item", "return " + expression) as (item: object) => unknown;
  assert.equal(read({}), undefined);
  assert.equal(read(JSON.parse('{"constructor":"own"}')), "own");
});

test("export validation checks targets in every joined if condition", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  const node = doc.nodes[page.children[0]];
  node.scripts = [{ id: "check-all", trigger: "click",    steps: [{ id: "cond", kind: "if",
      cond: { subject: "var", target: "", left: "1", op: "eq", value: "1" },
      conditions: [{ subject: "visible", target: "missing-joined-target", and: true }],
      then: [],
    }],
  }];
  const issues = runChecks(doc);
  assert.ok(issues.some((issue) => issue.message.includes("missing-joined-target")));
});



test("filters, sorts and generated expressions avoid unsafe object coercion", () => {
  const objectWithShadowedToString = JSON.parse('{"toString":"not a function"}');
  const items = [
    { value: objectWithShadowedToString },
    { value: "regular" },
    { value: ["x", null, "y"] },
  ];
  assert.doesNotThrow(() => compareValues(objectWithShadowedToString, 2));
  const selected = filterItems(items, [
    { kind: "filter", conds: [
      { field: "value", op: "eq", value: "[object Object]" },
    ] },
  ]);
  assert.deepEqual(selected, [], "a list value must not equal a display string");
  assert.deepEqual(filterItems(items, [
    { kind: "filter", conds: [
      { field: "value", op: "eq", value: "x,,y" },
    ] },
  ]), [], "list equality is structural rather than comma-joined");
  const filters = filterConds({
    kind: "list-display", id: "filter-conditions", mode: "filter", array: "items",
    field: "value", op: "eq", value: "none", dir: "asc" as const,
    or: [
      { field: "", op: "eq", value: "", and: false },
      { field: "value", op: "eq", value: "x,,y", and: true },
    ],
  });
  assert.equal(filters[1].and, false, "Empty OR clauses must keep group boundaries");
  const expr = listItemsExpr({ from: "items" }, "vars", "items", [
    { kind: "sort", field: "value", dir: "asc" },
  ]);
  const fn = new Function("vars", "lookupVar", "toItems", "return " + expr) as
    (vars: object, get: (vars: any, name: string) => any,
     toItems: (source: unknown) => unknown[]) => unknown[];
  const sorted = fn({ items }, (vars, key) => vars[key],
    (value) => Array.isArray(value) ? [...value] : []);
  assert.equal(sorted.length, 3);
  assert.ok(sorted.includes(items[0]));
});
});

describe("generated-next-fetch-parity", () => {
const require = createRequire(import.meta.url);
function execute(source: string, dependencies: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", compiled)(
    (name: string) => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}

test("the emitted Next page sends the same JSON and headers as the editor, using its emitted vars module", async () => {
  const options: Extract<ScriptStep, { kind: "fetch" }> = {
    id: "fetch", kind: "fetch", as: "result", method: "POST",
    url: "https://example.com/api", headers: [{ name: "content-type", value: "application/vnd.test+json" }],
    body: JSON.stringify({ literal: "\\{name}", value: "{name}", next: "{slug}" }),
  };
  const node = { ...makeBox(), id: "box" };
  const doc: SiteDoc = {
    siteName: "Request parity", assets: {}, nodes: { box: node }, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["box"],
      pageScripts: [{ id: "load", trigger: "load", steps: [options] }] } },
  };
  const project = generateProject(doc);
  const sent: Array<{ url: string; init: any }> = [];
  const page = execute(project.files["app/page.tsx"], {
    "@/lib/vars": execute(project.files["lib/vars.ts"]),
    "@/lib/safe-fetch": {
      fetchPublic: async (url: string, init: any) => { sent.push({ url, init }); return { ok: true }; },
      readTextLimited: async () => "{}",
    },
  });
  const vars = { name: 'quotes" and slash\\ and newline\n', slug: "日本" };
  await page.default({ searchParams: Promise.resolve(vars) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, options.url);
  const expected = fetchRequestOf(options, vars)!;
  assert.equal(sent[0].init.method, expected.method);
  assert.deepEqual(sent[0].init.headers, expected.headers);
  assert.equal(sent[0].init.body, expected.body);
  assert.deepEqual(JSON.parse(sent[0].init.body), { literal: "{name}", value: vars.name, next: vars.slug });
});

for (const mutation of [
  { id: "remove", kind: "remove-list-item", list: "items", mode: "value", value: "B" },
  { id: "replace", kind: "set-list-item", list: "items", key: "0", value: "C" },
] satisfies ScriptStep[]) {
  test(`emitted Next page runs standalone ${mutation.kind} on a list literal`, async () => {
    const doc: SiteDoc = {
      siteName: "List operations", assets: {}, nodes: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: [],
        pageScripts: [{ id: "load", trigger: "load", steps: [
          { id: "seed", kind: "set-var", into: "items", value: '["B","A"]' },
          mutation,
          { id: "request", kind: "fetch", as: "result", url: "https://example.com/{items.0}" },
        ] }] } },
    };
    const { files } = generateProject(doc);
    const calls: string[] = [];
    const page = execute(files["app/page.tsx"], {
      "@/lib/vars": execute(files["lib/vars.ts"]),
      "@/lib/page-load-steps": execute(files["lib/page-load-steps.ts"]),
      "@/lib/value-recipe": execute(files["lib/value-recipe.ts"]),
      "@/lib/safe-fetch": {
        fetchPublic: async (url: string) => { calls.push(url); return { ok: true }; },
        readTextLimited: async () => "{}",
      },
    });
    await page.default({ searchParams: Promise.resolve({}) });
    assert.deepEqual(calls, ["https://example.com/" + (mutation.kind === "remove-list-item" ? "A" : "C")]);
  });
}

function fetchedListDoc(steps: ScriptStep[]): SiteDoc {
  return {
    siteName: "Fetched list", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["act", "list"],
      pageScripts: [{ id: "load", trigger: "load", steps: [
        { id: "fetch", kind: "fetch", url: "https://example.com/catalogue", as: "data" },
      ] }] } },
    nodes: {
      act: { ...makeText("Run"), id: "act", attrId: "act", semantic: "button", scripts: [
        { id: "click", trigger: "click", steps },
      ] },
      list: { ...makeBox(), id: "list", type: "list", list: { from: "data.0.rows" }, children: ["name"] },
      name: { ...makeText("{値}"), id: "name", attrId: "item" },
    },
  };
}

test("clicking remove in a Next page updates the fetched list without sending its unrelated fields", async () => {
  const doc = fetchedListDoc([
    { id: "remove", kind: "remove-list-item", list: "data.0.rows", mode: "key", value: "1" },
  ]);
  const html = await publishedComponentList(doc, "app/page.tsx", [{ rows: ["A", "B", "C"], other: "server-only" }]);
  assert.doesNotMatch(html, /server-only/);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  const items = () => dom.active("#item").map(node => node.textContent);
  assert.deepEqual(items(), ["A", "B", "C"]);
  await dom.click("act");
  assert.deepEqual(items(), ["A", "C"]);
  await dom.click("act");
  assert.deepEqual(items(), ["A"]);
  dom.navigate(await publishedComponentList(doc, "app/page.tsx", [{ rows: ["D", "E"] }]));
  assert.deepEqual(items(), ["D", "E"]);
  await dom.click("act");
  assert.deepEqual(items(), ["D"]);
});

test("a click condition compares fetched records and lists with their original types", async () => {
  const doc = fetchedListDoc([
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "{data.0.meta}", op: "has-key", value: "title" },
      conditions: [{ subject: "var", target: "", left: "{data.0.rows}", op: "contains", value: "{data.0.meta.title}", and: true }],
      then: [{ id: "ok", kind: "open-url", url: "/matched", newTab: true }] },
  ]);
  const source = generateProject(doc).files["public/scripts.js"];
  for (const [rows, expected] of [[["AB"], []], [["A", "B"], ["/matched"]]] as const) {
    const html = await publishedComponentList(doc, "app/page.tsx", [{ rows, meta: { title: "A" } }]);
    const urls: string[] = [];
    const dom = listRuntimeDom(html, source, { window: { open: (url: string) => urls.push(url) } });
    await dom.click("act");
    assert.deepEqual(urls, expected);
  }
});

test("a click filter compares a row's nested list against a fetched list variable", async () => {
  const doc = fetchedListDoc([
    { id: "filter", kind: "list-display", mode: "filter", array: "data.0.rows",
      field: "tags", op: "eq", value: "{data.0.wanted}", dir: "asc" },
  ]);
  doc.nodes.name.text!.content = "{name}";
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    rows: [{ name: "first", tags: ["x", "y"] }, { name: "second", tags: ["x"] }],
    wanted: ["x"],
  }]);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  await dom.click("act");
  const visible = dom.active("[data-item]").filter(node => node.style.display !== "none");
  assert.deepEqual(visible.map(node => node.textContent), ["second"]);
});

test("list removal keeps a structured selection supplied by another fetched variable", async () => {
  const doc = fetchedListDoc([
    { id: "remove", kind: "remove-list-item", list: "data.0.rows", mode: "value", value: "{selection.0.target}" },
  ]);
  doc.pages.p.pageScripts![0].steps.push({ id: "selection", kind: "fetch", url: "https://example.com/selection", as: "selection" });
  doc.nodes.name.text!.content = "{name}";
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    rows: [{ name: "A" }, { name: "B" }], target: { name: "A" },
  }]);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  await dom.click("act");
  assert.deepEqual(dom.active("#item").map(node => node.textContent), ["B"]);
});

test("mutating a fetched list preserves sibling text, other lists and conditions through hydration", async () => {
  const doc = fetchedListDoc([
    { id: "remove", kind: "remove-list-item", list: "data.0.rows", mode: "key", value: "0" },
    { id: "count", kind: "transform", source: "data", into: "count", transform: { kind: "length" } },
    { id: "read", kind: "transform", source: "data.0.heading", into: "heading", transform: { kind: "field", key: "name" } },
    { id: "if", kind: "if", conditions: [{ subject: "var", target: "", left: "{heading}", op: "eq", value: "Reports", and: true },
      { subject: "var", target: "", left: "{count}", op: "eq", value: "2", and: true }],
      cond: { subject: "var", target: "", left: "{data.0.status}", op: "eq", value: "open" },
      then: [{ id: "ok", kind: "open-url", url: "/open", newTab: true }] },
  ]);
  doc.nodes.title = { ...makeText("{data.0.title}"), id: "title", attrId: "title" };
  doc.nodes.related = { ...makeBox(), id: "related", type: "list", list: { from: "data.0.related" }, children: ["tag"] };
  doc.nodes.tag = { ...makeText("{label}"), id: "tag", attrId: "tag" };
  doc.pages.p.children.push("title", "related");
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    title: "Catalogue", rows: ["A", "B"], related: [{ label: "X", extra: "unreferenced-field" }], status: "open", heading: { name: "Reports" }, private: "unreferenced-field",
  }, { private: "unreferenced-field" }]);
  assert.doesNotMatch(html, /unreferenced-field/);
  const urls: string[] = [];
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"], {
    window: { open: (url: string) => urls.push(url) },
  });
  const visible = (selector: string) => dom.active(selector).map(node => node.textContent);
  assert.deepEqual(visible("#title"), ["Catalogue"]);
  assert.deepEqual(visible("#tag"), ["X"]);
  await dom.click("act");
  assert.deepEqual(visible("#item"), ["B"]);
  assert.deepEqual(visible("#tag"), ["X"]);
  assert.deepEqual(visible("#title"), ["Catalogue"]);
  assert.deepEqual(urls, ["/open"]);
});

test("Next length counts both fetched records and new keys in a browser-edited record", async () => {
  const doc = fetchedListDoc([
    { id: "count-record", kind: "transform", source: "data.0.static", into: "before", transform: { kind: "length" } },
    { id: "write-key", kind: "set-var", into: "data.0.mutable.added", value: "1" },
    { id: "count-edited", kind: "transform", source: "data.0.mutable", into: "after", transform: { kind: "length" } },
  ]);
  doc.nodes.counts = { ...makeText("{before}/{after}"), id: "counts", attrId: "counts" };
  doc.pages.p.children.push("counts");
  const html = await publishedComponentList(doc, "app/page.tsx", [{
    static: { label: "private-immutable-field", enabled: true }, mutable: { original: true }, rows: [],
  }]);
  assert.doesNotMatch(html, /private-immutable-field/);
  const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
  await dom.click("act");
  assert.equal(dom.active("#counts")[0].textContent, "2/2");
});

test("preview and generated Next page load update the parent record for nested destinations", async () => {
  const doc = fetchedListDoc([]);
  const sample = [{ value: "loaded" }];
  doc.pages.p.pageScripts![0].steps = [
    { id: "record", kind: "set-var", into: "record", value: '{"keep":"old"}' },
    { id: "field", kind: "set-var", into: "record.label", value: "new" },
    { id: "request", kind: "fetch", as: "record.rows", url: "https://example.com/catalogue", preview: { sample } },
    { id: "transform", kind: "transform", source: "record.rows", into: "record.count", transform: { kind: "length" } },
    { id: "out", kind: "transform", source: "record", into: "output", transform: { kind: "stringify" } },
  ];
  doc.pages.p.children = ["result"];
  doc.nodes.result = { ...makeText("{output}"), id: "result", attrId: "result" };
  const expected = { keep: "old", label: "new", rows: sample, count: 1 };
  assert.deepEqual(JSON.parse(String(previewDataVars(doc, "p").output)), expected);
  const html = await publishedComponentList(doc, "app/page.tsx", sample);
  const dom = listRuntimeDom(html, "");
  assert.deepEqual(JSON.parse(dom.active("#result")[0].textContent), expected);
});

for (const [target, reference] of [["data.1.rows", "data.-1.rows.0"], ["data.-1.rows", "data.1.rows.0"]]) {
  test(`editing ${target} updates the fetched last item at ${reference}`, async () => {
    const doc = fetchedListDoc([
      { id: "remove", kind: "remove-list-item", list: target, mode: "key", value: "0" },
    ]);
    doc.nodes.tail = { ...makeText(`{${reference}}`), id: "tail", attrId: "tail" };
    doc.pages.p.children.push("tail");
    const html = await publishedComponentList(doc, "app/page.tsx", [
      { rows: ["A"], private: "unreferenced-field" }, { rows: ["B", "C"], private: "unreferenced-field" },
    ]);
    assert.doesNotMatch(html, /unreferenced-field/);
    const dom = listRuntimeDom(html, generateProject(doc).files["public/scripts.js"]);
    assert.equal(dom.active("#tail")[0].textContent, "B");
    await dom.click("act");
    assert.equal(dom.active("#tail")[0].textContent, "C");
  });
}
});

describe("generator-framework-boundaries", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
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
    assert.deepEqual([...buildAssetNames_2(fixture([
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
    const assets = buildAssetNames_2(fixture(Array<string>(1000).fill("logo.png")));
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
    runInNewContext_2(files['public/scripts.js'], {
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
  const script = (steps: Script_2["steps"]): Script_2 => ({ id: "s", trigger: "click", steps });
  function fixture(s: Script_2, pageScript = false): SiteDoc {
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
    return renderToStaticMarkup(createElement_2(VarsCtx.Provider, {
      value: { preview: true, pageVars: {}, clientVars: new Set(), fieldValues: {}, refresh: () => {} },
    }, createElement_2(mod.exports.NodeView, { id, isTop: true })));
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
    const dir = mkdtempSync(join_3(tmpdir(), "tsumu-instance-anchor-"));
    try {
      symlinkSync(resolve_2("node_modules"), join_3(dir, "node_modules"), "dir");
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join_3(dir, path)), { recursive: true });
        writeFileSync(join_3(dir, path), content);
      }
      execFileSync(resolve_2("node_modules/.bin/tsc"), ["--project", join_3(dir, "tsconfig.json"), "--noEmit", "--incremental", "false"], { cwd: dir, stdio: "pipe" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
});

describe("native-export-safety-regressions", () => {
function fixture(): SiteDoc {
  return {
    siteName: "Export regression",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: ["heading", "audio", "video"],
      },
    },
    nodes: {
      heading: {
        ...makeBox(), id: "heading", text: {
          content: "It's <script>not code</script>", heading: 1,
        },
        htmlAttrs: { title: "Owner's & friends" },
      },
      audio: {
        ...makeBox(), id: "audio", type: "media",
        media: { kind: "audio", src: "data:audio/wav;base64,AQID" },
      },
      video: {
        ...makeBox(), id: "video", type: "media",
        media: { kind: "video", src: "data:video/mp4;base64,AQID" },
      },
    },
    assets: {},
  };
}

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  const sourcePath = framework === "nuxt"
    ? "app/generated/pages/Page0.vue"
    : framework === "sveltekit" ? "src/lib/pages/Page0.svelte" : "src/pages/Page0.vue";

  test(framework + " escapes native text and attributes and validates inline media URLs", () => {
    const doc = fixture();
    const source = generateExportProject(doc, framework).files[sourcePath];
    assert.ok(source, sourcePath);
    assert.match(source, /It&#39;s &lt;script&gt;not code&lt;\/script&gt;/);
    assert.match(source, /title="Owner&#39;s &amp; friends"/);
    assert.doesNotMatch(source, /Itundefineds|Ownerundefineds/);
    assert.doesNotMatch(source, /<script>not code<\/script>/);
    assert.match(source, /src="data:audio\/wav;base64,AQID"/);
    assert.match(source, /src="data:video\/mp4;base64,AQID"/);
    doc.nodes.audio.media!.src = "javascript:alert(1)";
    const denied = generateExportProject(doc, framework).files[sourcePath];
    assert.match(denied, /<audio[^>]*src="#"/);
    assert.doesNotMatch(denied, /javascript:alert/);
  });
}

test("HTML export keeps inline image, audio, and video resources without allowing active schemes", () => {
  const doc = fixture();
  doc.nodes.picture = {
    ...makeBox(), id: "picture", type: "image",
    image: { src: "data:image/png;base64,AQID", alt: "Pixel", width: 1, height: 1 },
  };
  doc.pages.home.children.push("picture");
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.match(html, /<img[^>]*src="data:image\/png;base64,AQID"/);
  assert.match(html, /<audio[^>]*src="data:audio\/wav;base64,AQID"/);
  assert.match(html, /<video[^>]*src="data:video\/mp4;base64,AQID"/);
  doc.nodes.picture.image!.src = "data:text/html;base64,PHNjcmlwdD4=";
  doc.nodes.audio.media!.src = "javascript:alert(1)";
  const denied = generateExportProject(doc, "html").files["index.html"];
  assert.doesNotMatch(denied, /data:text\/html|javascript:alert/);
  assert.match(denied, /<audio[^>]*src="#"/);
});

test("Next.js export applies the same media URL restrictions", () => {
  const doc = fixture();
  const source = generateExportProject(doc, "nextjs").files["app/page.tsx"];
  assert.match(source, /data:audio\/wav;base64,AQID/);
  assert.match(source, /data:video\/mp4;base64,AQID/);
  doc.nodes.audio.media!.src = "javascript:alert(1)";
  const denied = generateExportProject(doc, "nextjs").files["app/page.tsx"];
  assert.doesNotMatch(denied, /javascript:alert/);
});

test("Nuxt internal requests preserve the fetch policy, stream limit and bodyless statuses", async () => {
  const files = generateExportProject(fixture(), "nuxt").files;
  const page = files["app/pages/index.vue"];
  const source = page.match(/const requestLocal = async \(path, init\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(source, "Nuxt generated page should define the internal request adapter");
  type RawFetch = (path: string, init: Record<string, unknown>) => Promise<Response>;
  const makeLocal = (raw: RawFetch): ((path: string, init?: RequestInit) => Promise<Response>) =>
    new Function("$fetch", source + "\nreturn requestLocal;")({ raw });

  for (const status of [204, 205, 304]) {
    const requestLocal = makeLocal(async (_path, init) => {
      assert.equal(init.responseType, "stream");
      return new Response(null, { status });
    });
    const response = await requestLocal("/api/no-content", {});
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }

  const head = makeLocal(async () => new Response("some data"));
  assert.equal((await head("/api/metadata", { method: "HEAD" })).body, null);

  const module = files["app/generated/server-request.js"];
  assert.ok(module);
  // Nuxt runs this module on client navigation too, without Node's Buffer global.
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from("const Buffer = undefined;\n" + module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  const data = await requestPublic("/api/records?page=2", {}, "https://site.example",
    makeLocal(async (path, init) => {
      assert.equal(path, "/api/records?page=2");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      assert.equal(init.responseType, "stream");
      return Response.json({ title: "京都" });
    }));
  assert.deepEqual(await data.json(), { title: "京都" });

  let pulls = 0, cancellations = 0;
  const local = makeLocal(async (_path, init) => {
    assert.equal(init.responseType, "stream");
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() { cancellations++; },
    }), { headers: { "content-type": "application/json" } });
  });
  await assert.rejects(
    requestPublic("/api/large", {}, "https://site.example", local),
    /SSR response exceeds 5 MB/,
  );
  assert.equal(cancellations, 1);
  assert.ok(pulls <= 8, "the response is cancelled near the configured limit");
});

test("HTML media paths are not page routes even when the asset path matches a slug", () => {
  const doc = fixture();
  doc.pages.home.slug = "blog";
  doc.pages.resource = {
    id: "resource", name: "Resource", slug: "audio", title: "Resource",
    description: "", children: [],
  };
  doc.pageOrder.push("resource");
  doc.nodes.audio.media!.src = "/audio";
  const files = generateExportProject(doc, "html").files;
  const html = files["blog/index.html"];
  assert.ok(html);
  assert.match(html, /<audio[^>]*src="\.\.\/audio"/);
  assert.doesNotMatch(html, /<audio[^>]*src="[^"]*audio\/index\.html"/);
});

test("Nuxt client navigation uses browser fetch without bypassing the SSR origin allowlist", async () => {
  const doc = fixture();
  doc.pages.home.pageScripts = [{
    id: "page-data", trigger: "load", steps: [
      { id: "request", kind: "fetch", url: "https://api.example/public", as: "records" },
    ],
  }];
  const module = generateExportProject(doc, "nuxt").files["app/generated/server-request.js"];
  assert.ok(module);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  let requests = 0;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    globalThis.fetch = async (url, init) => {
      requests++;
      assert.equal(String(url), "https://api.example/public");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    };
    const fromBrowser = await requestPublic("https://api.example/public", {},
      "https://site.example", async () => { throw new Error("unexpected same-origin request"); });
    assert.deepEqual(await fromBrowser.json(), { ok: true });
    assert.equal(requests, 1);
    await assert.rejects(
      requestPublic("https://another.example/private", {}, "https://site.example",
        async () => { throw new Error("unexpected request"); }),
      /not allowed/,
    );
    assert.equal(requests, 1, "disallowed origins must never reach the browser transport");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("Native SSR socket lookup supports both Node { all: true } and single-address callbacks while blocking private DNS answers", async () => {
  const doc = fixture();
  doc.pages.home.pageScripts = [{
    id: "page-data", trigger: "load", steps: [
      { id: "request", kind: "fetch", url: "https://api.example/public", as: "records" },
    ],
  }];
  const module = generateExportProject(doc, "vue").files["src/server-request.js"];
  assert.ok(module);
  const { requestPublic } = await import("data:text/javascript;base64," +
    Buffer.from(module).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        localFetch: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>;
    };

  const prevGetBuiltin = process.getBuiltinModule;
  let capturedLookup: ((host: string, flags: { all?: boolean }, cb: (...args: any[]) => void) => void) | undefined;
  let dnsAnswers: Array<{ address: string; family: number }> = [{ address: "93.184.216.34", family: 4 }];
  try {
    process.getBuiltinModule = ((id: string) => {
      if (id === "node:dns") {
        return {
          lookup(_host: string, _opts: unknown, cb: (err: Error | null, res: Array<{ address: string; family: number }>) => void) {
            cb(null, dnsAnswers);
          },
        };
      }
      if (id === "node:https") {
        return {
          request(_target: URL, opts: { lookup: typeof capturedLookup }, onRes: (res: any) => void) {
            capturedLookup = opts.lookup;
            setImmediate(() => {
              onRes({
                statusCode: 200,
                headers: { "content-type": "application/json" },
                destroy() {},
                async *[Symbol.asyncIterator]() { yield Buffer.from('{"ok":1}'); },
              });
            });
            return { on() {}, end() {}, destroy() {} };
          },
        };
      }
      return prevGetBuiltin(id);
    }) as typeof process.getBuiltinModule;

    const res = await requestPublic("https://api.example/public", {}, "https://site.example",
      async () => { throw new Error("unexpected"); });
    assert.deepEqual(await res.json(), { ok: 1 });
    assert.ok(capturedLookup);

    capturedLookup!("api.example", { all: true }, (err, list) => {
      assert.equal(err, null);
      assert.deepEqual(list, [{ address: "93.184.216.34", family: 4 }]);
    });
    capturedLookup!("api.example", {}, (err, addr, family) => {
      assert.equal(err, null);
      assert.equal(addr, "93.184.216.34");
      assert.equal(family, 4);
    });

    dnsAnswers = [{ address: "127.0.0.1", family: 4 }];
    capturedLookup!("api.example", { all: true }, (err, list) => {
      assert.match(String(err), /Private DNS address blocked/);
      assert.deepEqual(list, []);
    });
    capturedLookup!("api.example", {}, (err, addr, family) => {
      assert.match(String(err), /Private DNS address blocked/);
      assert.equal(addr, "");
      assert.equal(family, 4);
    });
  } finally {
    process.getBuiltinModule = prevGetBuiltin;
  }
});

test("Native components render span icons, guard input attributes by type, and fall back unsafe dynamic image URLs to EMPTY_GIF", async () => {
  const doc = fixture();
  doc.nodes.icon = {
    ...makeBox(), id: "icon", type: "icon",
    icon: { name: "check", svg: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' },
  };
  doc.nodes.textInput = {
    ...makeBox(), id: "textInput", type: "field",
    field: { kind: "input", inputType: "text", min: "1", max: "10", step: "2", maxLength: 20, placeholder: "Name" },
  };
  doc.nodes.colorInput = {
    ...makeBox(), id: "colorInput", type: "field",
    field: { kind: "input", inputType: "color", maxLength: 7, placeholder: "Ignored" },
  };
  doc.assets.logo = {
    id: "logo", name: "logo.svg", mimeType: "image/svg+xml",
    width: 48, height: 24, svgFilter: true, dataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
  };
  doc.nodes.svgLogo = {
    ...makeBox(), id: "svgLogo", type: "image",
    image: { src: "/logo.svg", assetId: "logo", alt: "Logo", width: 48, height: 24 },
  };
  doc.nodes.unsafeImg = {
    ...makeBox(), id: "unsafeImg", type: "image",
    image: { src: "javascript:alert(1)", alt: "Blocked", width: 10, height: 10 },
  };
  doc.pages.home.children.push("icon", "textInput", "colorInput", "svgLogo", "unsafeImg");

  const vueFiles = generateExportProject(doc, "vue").files;
  const page = vueFiles["src/pages/Page0.vue"];
  assert.match(page, /<span[^>]*aria-hidden="true"[^>]*v-html=/);
  assert.match(page, /type="text"[^>]*placeholder="Name"[^>]*maxlength="20"/);
  const textInputTag = page.match(/<input[^>]*type="text"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(textInputTag, /\b(?:min|max|step)=/);
  const colorInputTag = page.match(/<input[^>]*type="color"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(colorInputTag, /\b(?:placeholder|maxlength)=/);
  assert.match(page, /--crisp-svg-width:48px;--crisp-svg-ratio:48\/24/);
  assert.match(page, /<img[^>]*src="data:image\/gif;base64,[^"]*"[^>]*alt="Blocked"/);

  const siteData = vueFiles["src/site-data.js"];
  const { resolveResourceUrl } = await import("data:text/javascript;base64," +
    Buffer.from(siteData).toString("base64")) as {
      resolveResourceUrl: (template: string, scope: Record<string, unknown>) => string;
    };
  assert.equal(resolveResourceUrl("{img}", { img: "javascript:alert(1)" }), "#");
  assert.equal(resolveResourceUrl("{img}", { img: "" }), "#");
  assert.equal(resolveResourceUrl("{img}", { img: "https://example.com/pic.png" }), "https://example.com/pic.png");
});
});

describe("native-ssr-export", () => {
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
      const code = Object.entries(project.files).filter(([path]) => !/\.md$/i.test(path));
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
    const head = runInNewContext_3(callback, { selected });
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
    runInNewContext_3(files["src/lib/site-routes.js"].replace(/\bexport /g, "") + "\nglobalThis.selectPage = selectPage;", routes);
    const context: any = { selectPage: routes.selectPage };
    runInNewContext_3(files["src/hooks.server.js"].replace(/^import .*;\n/m, "").replace(/\bexport /g, "") + "\nglobalThis.handle = handle;", context);
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
    const apply = runInNewContext_3(effect, context);
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

        const folder = mkdtempSync(join_4(tmpdir(), "tsumu-react-script-types-"));
        try {
          for (const [name, source] of Object.entries(project.files)) {
            const path = join_4(folder, name);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, source);
          }
          symlinkSync(resolve_3("node_modules"), join_4(folder, "node_modules"), "junction");
          if (language === "typescript") {
            const config = JSON.parse(project.files["tsconfig.json"]);
            // Vite そのものには依存せず、出力した React のソースのすべてを、strict の設定で検証する。
            config.compilerOptions.types = ["node"];
            config.include = ["src"];
            writeFileSync(join_4(folder, "src/css.d.ts"), 'declare module "*.css";\n');
            writeFileSync(join_4(folder, "tsconfig.json"), JSON.stringify(config));
            try {
              execFileSync(resolve_3("node_modules/.bin/tsc"), ["--project", folder], { encoding: "utf8" });
            } catch (cause) {
              const error = cause as { stdout?: string; stderr?: string; message?: string };
              assert.fail("Generated React failed strict TypeScript checking:\n" +
                (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""));
            }
          } else {
            assert.doesNotMatch(app, /const scripts\s*:/);
            buildSync({
              entryPoints: [join_4(folder, "src/main.jsx")],
              bundle: true, write: false, outdir: join_4(folder, "dist"), jsx: "automatic",
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
      const module = { exports: {} as { default: () => ReturnType<typeof createElement_3> } };
      new Function("require", "module", "exports", code)(require, module, module.exports);
      const fragment = parseFragment(renderToStaticMarkup(createElement_3(module.exports.default)));
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
    const handle=runInNewContext_3(source.slice(begin,end)+"\nhandle",{
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
    runInNewContext_3(files['app/generated/site-routes.js'].replace(/\bexport /g,'')+'\nglobalThis.selectPage=selectPage;',routes);
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
      const id=await runInNewContext_3(js,context);
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
});

describe("native-url-parity", () => {
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const module = { exports: {} as any };
runInNewContext_4(transformSync(nativeDataModule(), { format: "cjs" }).code, { module });
const native = module.exports;
const start = PAGE_DATA_RUNTIME.indexOf("  function interpolate(");
const end = PAGE_DATA_RUNTIME.indexOf("  function jsonBody(", start);
assert.ok(start >= 0 && end > start);
const browserInterpolate = runInNewContext_4(PAGE_DATA_RUNTIME.slice(start, end) + "\ninterpolate", { read: lookupVar, text: varText });

test("native links encode variable query/path components like Canvas and Next", () => {
  for (const value of ["a&admin=true#x", "my photo?.png", "日本/旅", "100%", '"quoted"', ""]) {
    for (const template of ["/search?q={value}", "/files/{value}", "{value}", "/[slug]", "\\{value}/{value}"]) {
      const vars = { value, slug: value };
      assert.equal(native.resolveUrl(template, vars), safeNavigationUrl(interpolateUrl(template, vars)), JSON.stringify({ template, value }));
    }
  }
});
test("whole URL handling matches editor, including inline image URLs for fetch interpolation", () => {
  for (const value of ["https://example.com/a?x=1&y=2", "/a?x=1", "#section", "mailto:a@example.com", "tel:+123", "//evil.test", "javascript:alert(1)", "https:evil", "data:image/png;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:audio/wav;base64,AAAA", "blob:https://example.com/id"]) {
    const vars = { value };
    assert.equal(browserInterpolate("{value}", vars, true), interpolateUrl("{value}", vars), value);
    assert.equal(native.resolveUrl("{value}", vars), safeNavigationUrl(interpolateUrl("{value}", vars)), value);
  }
});
test("resource URL helpers retain inline media and block executable protocols", () => {
  for (const value of ["data:image/png;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:audio/wav;base64,AAAA", "data:video/mp4;base64,AAAA", "blob:https://example.com/id", "javascript:alert(1)", "data:text/html;base64,AAAA", "//evil.test", "/\\evil.test", "https://example.com/image?a=1&b=2"]) {
    assert.equal(native.resolveResourceUrl("{value}", { value }), safeResourceUrl(interpolate("{value}", { value })), value);
  }
});
test("nested native scopes shadow outer values without mutating them", () => {
  const outer = { value: "outer", nested: { value: "outer" } };
  const row = { value: "a/b?c", nested: { value: "inner" } };
  assert.equal(native.resolveUrl("/x/{value}", outer, row), "/x/a%2Fb%3Fc");
  assert.equal(native.resolveText("{nested.value}", outer, row), "inner");
  assert.equal(native.resolveText("{value}", outer, row, { value: undefined }), "");
  assert.equal(outer.value, "outer");
});
test("text token recognition matches editor for backticks and literal escapes", () => {
  for (const template of ["{bad`name}", "\\{value}", "{value}{missing}", "[slug]"]) {
    const vars = { value: "hello", slug: "s", "bad`name": "wrong" };
    assert.equal(native.resolveText(template, vars), interpolate(template, vars));
  }
});

const nativePagePath = (framework: "vue" | "nuxt" | "sveltekit") =>
  framework === "nuxt" ? "app/generated/pages/Page0.vue" : framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";

function markup(framework: "vue" | "nuxt" | "sveltekit", nodes: Record<string, DocNode>, children: string[]) {
  const doc: SiteDoc = { siteName: "Controls", assets: {}, pageOrder: ["p"], nodes,
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children } } };
  return parse(generateExportProject(doc, framework).files[nativePagePath(framework)]);
}
for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(`${framework}: scripted buttons do not submit their enclosing form`, () => {
    const button = (id: string): DocNode => ({ ...makeBox(), id, attrId: id, semantic: "button" });
    const tree = markup(framework, {
      form: { ...makeBox(), id: "form", semantic: "form", children: ["scripted", "ordinary", "onload", "explicit"] },
      scripted: { ...button("scripted"), scripts: [{ id: "click", trigger: "click", steps: [{ id: "set", kind: "set-var", into: "clicked", value: "yes" }] }] },
      ordinary: button("ordinary"),
      onload: { ...button("onload"), scripts: [{ id: "load", trigger: "load", steps: [] }] },
      explicit: { ...makeBox(), id: "explicit", attrId: "explicit", type: "field", field: { kind: "submit", label: "Go" } },
      outside: button("outside"),
    }, ["form", "outside"]);
    assert.equal(tree.querySelector("#scripted").getAttribute("type"), "button");
    assert.equal(tree.querySelector("#ordinary").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#onload").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#explicit").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#outside").getAttribute("type"), "button");
  });
  test(`${framework}: inline paragraph children keep p and block children retain paragraph styling`, () => {
    const paragraph = (id: string, child: string): DocNode => ({ ...makeBox(), id, attrId: id, text: { content: "Line one\nLine two", heading: 0 }, children: [child] });
    const tree = markup(framework, {
      inline: paragraph("inline", "span"),
      span: { ...makeBox(), id: "span", semantic: "custom", customTag: "span", text: { content: "bold", heading: 0 } },
      block: paragraph("block", "box"), box: { ...makeBox(), id: "box" },
    }, ["inline", "block"]);
    assert.equal(tree.querySelector("#inline").tagName.toLowerCase(), "p");
    assert.equal(tree.querySelector("#inline").hasAttribute("data-p"), false);
    assert.equal(tree.querySelector("#block").tagName.toLowerCase(), "div");
    assert.equal(tree.querySelector("#block").hasAttribute("data-p"), true);
  });
  test(`${framework}: instance visibility markup matches its responsive CSS without hiding sibling instances`, () => {
    const doc: SiteDoc = { siteName: "Visibility", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["hidden", "visible"] } },
      components: { card: { id: "card", name: "Card", rootId: "root" } },
      nodes: {
        root: { ...makeBox(), id: "root", text: { content: "Card", heading: 0 } },
        hidden: { ...makeBox(), id: "hidden", attrId: "hidden-use", type: "instance", componentId: "card", hiddenOn: ["sm"] },
        visible: { ...makeBox(), id: "visible", attrId: "visible-use", type: "instance", componentId: "card" },
      },
    };
    const { files } = generateExportProject(doc, framework);
    const tree = parse(files[nativePagePath(framework)]);
    const hidden = tree.querySelector("#hidden-use"), visible = tree.querySelector("#visible-use");
    const marker = hidden.getAttribute("data-instance-hidden");
    assert.ok(marker, "instance wrapper needs the selector marker used by shared responsive CSS");
    const css = Object.entries(files).filter(([name]) => name.endsWith(".css")).map(([, content]) => content).join("\n");
    assert.ok(css.includes(`[data-instance-hidden~=${JSON.stringify(marker)}]`));
    assert.match(css.slice(css.indexOf(`[data-instance-hidden~=${JSON.stringify(marker)}]`)), /display: none !important/);
    assert.equal(visible.hasAttribute("data-instance-hidden"), false);
    assert.equal(hidden.getAttribute("style"), "display:contents");
  });
}

{
  const queryDoc: SiteDoc = { siteName: "Query routes", nodes: {}, assets: {}, pageOrder: ["home", "special"], pages: {
    home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: [] },
    special: { id: "special", name: "Special", title: "Special", description: "", slug: "", query: "tab=details", children: [] },
  } };
  const files = generateExportProject(queryDoc, "nuxt").files;
  const queryLine = files["app/pages/index.vue"].match(/^const query = computed\(\(\) => (.+)\);$/m)?.[1];
  assert.ok(queryLine);
  const routesMod = { exports: {} as any };
  runInNewContext_4(transformSync(files["app/generated/site-routes.js"], { format: "cjs" }).code, { module: routesMod, URLSearchParams });
  const dataMod = { exports: {} as any };
  runInNewContext_4(transformSync(files["app/generated/site-data.js"], { format: "cjs" }).code, { module: dataMod, URLSearchParams, URL, fetch });
  for (const fullPath of ["/?q=alpha?beta", "/?tab=details#section", "/?q=alpha?beta#section", "/?q=a%3Fb%23c", "/?q=a+b&tag=one&tag=two", "/#section?not=a-query", "/"]) {
    test(`Nuxt query loader agrees with server URL parsing: ${fullPath}`, async () => {
      const expected = new URL(fullPath, "https://example.com").searchParams;
      const query = runInNewContext_4(queryLine, { route: { fullPath }, requestUrl: new URL("https://example.com"), URLSearchParams, URL });
      assert.deepEqual([...query.entries()], [...expected.entries()]);
      assert.equal(routesMod.exports.selectPage("/", query)?.id, routesMod.exports.selectPage("/", expected)?.id);
      const values = await dataMod.exports.loadPageData({ steps: [] }, query);
      assert.deepEqual({ ...values }, Object.fromEntries(expected));
    });
  }
}

function mediaFixture(kind: EmbedContent["kind"]): SiteDoc {
  return { siteName: "Media parity", pageOrder: ["p"], pages: { p: { id: "p", name: "P", slug: "", title: "P", description: "", children: ["embed"] } }, nodes: { embed: { ...makeBox(), id: "embed", type: "embed", embed: { kind, src: kind === "youtube" ? "https://youtu.be/abcdefghijk" : kind === "map" ? "Tokyo" : "https://example.com/player" } } }, assets: {} };
}
for (const framework of ["vue", "nuxt", "sveltekit"] as const) for (const kind of ["url", "youtube", "map"] as const) test(`${framework} ${kind} embed preserves editor fullscreen policy`, () => {
  const doc = mediaFixture(kind);
  const nativeFrame = generateExportProject(doc, framework).files[nativePagePath(framework)].match(/<iframe\b[^>]*>/)?.[0];
  const next = generateExportProject(doc, "nextjs").files["app/page.tsx"].match(/<iframe\b[\s\S]*?\/>/)?.[0];
  assert.ok(nativeFrame); assert.ok(next);
  assert.equal(/\ballowfullscreen\b/i.test(nativeFrame), /\ballowFullScreen\b/.test(next));
  assert.equal(/\ballowfullscreen\b/i.test(nativeFrame), kind !== "map");
  if (kind === "youtube") assert.ok(nativeFrame.includes(`allow="${YOUTUBE_ALLOW}"`));
  else assert.doesNotMatch(nativeFrame, /\ballow="/);
  assert.match(nativeFrame, /loading="lazy"/);
  assert.match(nativeFrame, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.equal(/\bsandbox\b/.test(nativeFrame), /\bsandbox\b/.test(next));
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) for (const priority of [true, false, undefined]) test(`${framework} image priority ${priority} is preserved`, () => {
  const doc = mediaFixture("url"); doc.nodes.embed = { ...makeBox(), id: "embed", type: "image", image: { src: "https://example.com/image.png", alt: "", width: 100, height: 100, priority } };
  const nativeImg = generateExportProject(doc, framework).files[nativePagePath(framework)].match(/<img\b[^>]*>/)?.[0];
  const next = generateExportProject(doc, "nextjs").files["app/page.tsx"];
  assert.ok(nativeImg);
  assert.equal(/fetchpriority="high"/.test(nativeImg), !!priority);
  assert.equal(/fetchPriority="high"/.test(next), !!priority);
  if (!priority) assert.doesNotMatch(nativeImg, /fetchpriority=/);
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  for (const label of ["Plan {choice}", "\\{choice}", "Static & safe"]) test(`${framework} radio submits the displayed resolved label: ${label}`, () => {
    const doc: SiteDoc = {
      siteName: "Radio", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["radio"] } },
      nodes: { radio: { ...makeBox(), id: "radio", type: "field", attrId: "selection", field: { kind: "radio", label, checked: true } } },
    };
    const source = generateExportProject(doc, framework).files[nativePagePath(framework)];
    const input = parse(source).querySelector('input[type="radio"]');
    assert.ok(input);
    const expression = framework === "sveltekit"
      ? /\bvalue=\{(resolveText\([^\n]*?\))\}/.exec(source)?.[1]
      : (() => { const match = /:value="([^"]*)"/.exec(source); return match ? parse(`<div data-code="${match[1]}"></div>`).querySelector("div").getAttribute("data-code") : undefined; })();
    const scope = { choice: 'A & "B"' };
    const actual = expression ? new Function("resolveText", "scope", `return ${expression}`)(native.resolveText, scope) : input.getAttribute("value");
    assert.equal(actual, native.resolveText(label, scope));
  });
}

const selectCases: Array<{ options: string[]; defaultValue: string; scope: Record<string, unknown>; row?: Record<string, unknown>; expectedIndex?: number }> = [
  { options: ["A", "B"], defaultValue: "{choice}", scope: { choice: "B" } },
  { options: ["A", "{second}"], defaultValue: "B", scope: { second: "B" } },
  { options: ["A", "{second}"], defaultValue: "{choice}", scope: { second: "B", choice: "B" } },
  { options: ["A", "{missing}"], defaultValue: "{choice}", scope: {} },
  { options: ["{first}", "B"], defaultValue: "{choice}", scope: { first: "Fallback", choice: "missing" } },
  { options: ["A", "\\{literal}"], defaultValue: "\\{literal}", scope: {} },
  { options: ["A", "B"], defaultValue: "B", scope: {} },
  { options: ["{first}", "{second}"], defaultValue: "{choice}", scope: { first: "B", second: "B", choice: "B" }, expectedIndex: 0 },
  { options: ["B", "A", "B"], defaultValue: "B", scope: {}, expectedIndex: 0 },
  { options: [], defaultValue: "{choice}", scope: { choice: "B" }, expectedIndex: -1 },
  { options: ["A", "{second}"], defaultValue: "{choice}", scope: { choice: "A", second: "Wrong" }, row: { choice: "B", second: "B" }, expectedIndex: 1 },
];
for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  selectCases.forEach((sample, i) => test(`${framework}: select resolves default and options before selecting (${i})`, () => {
    const field = { kind: "select" as const, options: sample.options.map(value => ({ label: value, value })), defaultValue: sample.defaultValue };
    const doc: SiteDoc = {
      schemaVersion: 1, siteName: "Select", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["select"] } },
      nodes: { select: { ...makeBox(), id: "select", type: "field", field } },
    };
    if (sample.row) {
      doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: ["select"] };
      doc.pages.p.children = ["list"];
    }
    const source = generateExportProject(doc, framework).files[nativePagePath(framework)];
    const optionTags = [...source.matchAll(/<option\b([^>]*)>/g)].map(m => m[1]);
    const evaluate = (code: string) => runInNewContext_4(code, { ...native, scope: sample.scope, row0: sample.row });
    const selectedFlags = optionTags.map(attrs => {
      const dynamic = framework === "sveltekit" ? /selected=\{(.*)\}/.exec(attrs)?.[1] : /:selected="([^"]*)"/.exec(attrs)?.[1];
      if (dynamic) {
        const decoded = framework === "sveltekit" ? dynamic : parse(`<div data-code="${dynamic}"></div>`).querySelector("div").getAttribute("data-code");
        return evaluate(decoded);
      }
      return /\bselected\b/.test(attrs);
    });
    const selected = selectedFlags.indexOf(true);
    assert.equal(selectedFlags.filter(Boolean).length, sample.options.length ? 1 : 0, "select exactly one option");
    if (sample.expectedIndex !== undefined) assert.equal(selected, sample.expectedIndex);
    if (!sample.options.length) return;
    assert.ok(selected >= 0, "must select a matching option or first fallback");
    const scope = { ...sample.scope, ...sample.row };
    assert.equal(native.resolveText(sample.options[selected], scope), fieldInitialValue(field, scope));
  }));
}
});
