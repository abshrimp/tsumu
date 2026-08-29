import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { exportProjectZip } from "../lib/exportZip";
import { parseSiteImport, restoreImportAssets } from "../lib/site-import";
import { attachZipDependencies, zipCssUrl } from "../lib/zip-css";
import { assetSrc } from "../lib/assets";
import { buildAssetNames } from "../lib/generator/names";
import type { Asset, SiteDoc } from "../lib/types";

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
