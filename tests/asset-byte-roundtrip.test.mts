import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { exportProjectZip } from "../lib/exportZip";
import { generateExportProject } from "../lib/export-formats";
import { parseSiteImport, restoreImportAssets, IMPORT_LIMITS } from "../lib/site-import";
import { serializePortableDoc } from "../lib/portable-doc";
import { validSiteDoc } from "../lib/doc-tree";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const cases = [
  ["empty", "data:application/octet-stream,"],
  ["base64", "data:application/octet-stream;charset=utf-8;base64,AP8A"],
  ["binary-percent", "data:application/octet-stream," + Array.from({ length: 256 }, (_, i) => "%" + i.toString(16).padStart(2, "0")).join("")],
  ["escaped-base64", "data:application/octet-stream;base64,%2F%2B%2B%2F%2Fw%3D%3D"],
  ["uppercase", "DATA:application/octet-stream;BASE64,/w=="],
  ["literal-percent", "data:text/plain,100% complete%2"],
  ["unicode", "data:text/plain;charset=utf-8,雪🌸%00"],
  ["fragment", "data:text/plain,keep%23payload?query#discard-fragment"],
  ["empty-fragment", "data:text/plain,payload#"],
  ["empty-query", "data:text/plain,keep?"],
  ["empty-query-fragment", "data:text/plain,?#discard-fragment"],
  ["authority", "data://host,payload"],
  ["authority-query-fragment", "data://host,payload?query#discard-fragment"],
  ["base64-fragment", "data:application/octet-stream;base64,AQID#discard-fragment"],
  ["large", "data:application/octet-stream," + "%ff%00%80".repeat(12000)],
] as const;

function fixture(dataUrl: string, count = 32): SiteDoc {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Byte roundtrip", pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", slug: "", title: "雪🌸", description: "", children: [] } },
    nodes: {}, assets: {
      bytes: { id: "bytes", name: "payload.bin", mimeType: "application/octet-stream", width: 0, height: 0,
        dataUrl, zip: { version: 1, group: "original", path: "nested/payload.bin" } },
      module: { id: "module", name: "main.js", mimeType: "text/javascript", width: 0, height: 0,
        dataUrl: "data:text/javascript,export%20default%201", zip: { version: 1, group: "original", path: "main.js" } },
    },
  };
  for (let i = 0; i < count; i++) {
    const id = "node-" + i;
    doc.nodes[id] = { ...makeBox("Nested " + i), id };
    if (i % 16) doc.nodes["node-" + (i - 1)].children.push(id);
    else doc.pages.home.children.push(id);
  }
  return doc;
}

for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit", "html"] as const) {
  for (const [name, url] of cases) test(`${framework} preserves ${name} asset bytes and ZIP-relative aliases`, async () => {
    const doc = fixture(url), before = structuredClone(doc);
    assert.equal(validSiteDoc(doc), true);
    const parsed = await parseSiteImport(new TextEncoder().encode(JSON.stringify(doc)), "doc");
    assert.deepEqual(parsed.doc, doc);
    // Native data URL fetching is the same byte decoder used by asset restoration.
    const expected = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const project = generateExportProject(parsed.doc, framework);
    const root = framework === "html" ? "" : framework === "sveltekit" ? "static/" : "public/";
    for (const path of ["assets/payload.bin", "assets/_imports/original/nested/payload.bin"]) {
      assert.ok(Object.hasOwn(project.binaries, root + path), path);
      assert.deepEqual(new Uint8Array(Buffer.from(project.binaries[root + path], "base64")), expected, path);
    }
    assert.deepEqual(doc, before);
  });
}

test("invalid and non-data asset URLs are omitted without aborting project generation", () => {
  for (const url of ["not-a-url", "//example.test/a.png", "https://example.test/a.png", "data:text/plain", "data://[broken],payload"]) {
    const project = generateExportProject(fixture(url), "html");
    assert.equal(Object.hasOwn(project.binaries, "assets/payload.bin"), false, url);
    assert.equal(Object.hasOwn(project.binaries, "assets/_imports/original/nested/payload.bin"), false, url);
  }
});

test("4000 nested nodes, 160 scripts and binary assets survive JSON, ZIP, restore and a second export", async () => {
  const doc = fixture(cases.find(([name]) => name === "binary-percent")![1], 4000);
  for (const [name, dataUrl] of cases) doc.assets[name] = {
    id: name, name: name + ".bin", mimeType: "application/octet-stream", width: 0, height: 0, dataUrl,
  };
  for (let i = 0; i < 4000; i += 25) doc.nodes["node-" + i].scripts = [{
    id: "script-" + i, trigger: "click", pos: { x: i, y: 0 },
    steps: [{ id: "step-" + i, kind: "set-var", into: "message", value: "雪<>& " + i }],
  }];
  const before = structuredClone(doc);
  const packed = await serializePortableDoc(doc, IMPORT_LIMITS.docBytes);
  assert.deepEqual((await parseSiteImport(new TextEncoder().encode(packed), "doc")).doc, before);
  const globals = Object.getOwnPropertyDescriptors(globalThis);
  const createUrl = URL.createObjectURL;
  const stored = new Map<string, Uint8Array>();
  let download: Blob | undefined;
  URL.createObjectURL = blob => { download = blob; return "blob:byte-roundtrip"; };
  Object.assign(globalThis, {
    document: { createElement: () => ({ href: "", download: "", click() {} }) },
    fetch: async (input: string, init?: RequestInit) => {
      if (input.startsWith("/api/assets/file?")) {
        const path = new URL(input, "https://editor.test").searchParams.get("path")!;
        assert.ok(stored.has(path));
        return new Response(stored.get(path));
      }
      if (input === "/api/assets") {
        const file = (init!.body as FormData).get("file") as File;
        const path = "assets/restored-" + stored.size;
        stored.set(path, new Uint8Array(await file.arrayBuffer()));
        return Response.json({ path });
      }
      return globals.fetch.value(input, init);
    },
  });
  try {
    const archive = async (value: SiteDoc) => {
      download = undefined;
      assert.deepEqual(await exportProjectZip(value, "html"), []);
      assert.ok(download);
      return new Uint8Array(await (download as Blob).arrayBuffer());
    };
    const imported = await parseSiteImport(await archive(doc), "zip");
    assert.deepEqual(imported.doc, before);
    const expected = new Map<string, Uint8Array>();
    for (const asset of Object.values(doc.assets)) {
      const bytes = new Uint8Array(await (await globals.fetch.value(asset.dataUrl)).arrayBuffer());
      expected.set(asset.id, bytes);
      assert.deepEqual(imported.assets.get(asset.id), bytes, asset.id);
    }
    const restored = await restoreImportAssets(imported);
    assert.deepEqual(restored.warnings, []);
    assert.equal(validSiteDoc(restored.doc), true);
    assert.deepEqual(restored.doc.nodes, doc.nodes);
    assert.deepEqual(restored.doc.pages, doc.pages);
    assert.deepEqual(Object.keys(restored.doc.assets), Object.keys(doc.assets));
    assert.deepEqual(restored.doc.assets.bytes.zip, doc.assets.bytes.zip);
    for (const asset of Object.values(restored.doc.assets)) assert.deepEqual(stored.get(asset.path!), expected.get(asset.id), asset.id);
    const second = await archive(restored.doc);
    assert.deepEqual((await parseSiteImport(second, "zip")).assets, expected);
    const zip = await JSZip.loadAsync(second);
    assert.deepEqual(await zip.file("byte-roundtrip/assets/_imports/original/nested/payload.bin")!.async("uint8array"), expected.get("bytes"));
    assert.deepEqual(doc, before);
  } finally {
    URL.createObjectURL = createUrl;
    for (const key of ["document", "fetch"]) {
      if (globals[key]) Object.defineProperty(globalThis, key, globals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
