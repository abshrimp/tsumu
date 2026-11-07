import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { exportLimitations, exportScopeDoc, generateExportProject, prepareExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import { type SiteDoc, type ScriptStep } from "../lib/types";
import { BlockedUrlError, assertPublicUrl, isPrivateHost } from "../lib/safe-fetch";
import vm from "node:vm";
import { parse } from "acorn";
import { transformSync } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";
import { codeLiteral } from "../lib/generator/code-literal";
import { applyDocPatch, isDocPatch } from "../lib/doc-patch";

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
    const pending: unknown[] = [parse(source, { ecmaVersion: "latest", sourceType: "module" })];
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
