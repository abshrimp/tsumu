import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import { exportProjectZip } from "../lib/exportZip";
import { parseSiteImport, EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH } from "../lib/site-import";

test("ZIP export preserves the editable SiteDoc and archive asset IDs for direct re-import", async () => {
  const doc = createInitialDoc();
  doc.siteName = "ZIP roundtrip";
  doc.customHeadHtml = '<meta name="test-roundtrip" content="yes">';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  doc.assets["original-asset"] = {
    id: "original-asset", name: "mark.svg",
    width: 10, height: 10, mimeType: "image/svg+xml",
    dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
  };
  let blob: Blob | null = null;
  const createUrl = URL.createObjectURL;
  const previousDoc = globalThis.document;
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: (b: Blob) => { blob = b; return "blob:export-test"; },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true, value: {
        createElement: () => ({ href: "", download: "", click() {} }),
      },
    });
    const missing = await exportProjectZip(doc);
    assert.deepEqual(missing, []);
    assert.ok(blob);
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const roundtrip = await zip.file("zip-roundtrip/" + EDITABLE_DOC_PATH)!.async("text");
    assert.deepEqual(JSON.parse(roundtrip), doc);
    const mapped = JSON.parse(await zip.file("zip-roundtrip/" + EDITABLE_ASSETS_PATH)!.async("text"));
    assert.equal(mapped.version, 1);
    assert.equal(mapped.assets["original-asset"], "public/assets/mark.svg");
    assert.ok(zip.file("zip-roundtrip/public/assets/mark.svg"));
    const imported = await parseSiteImport(bytes, "zip");
    assert.deepEqual(imported.doc, doc);
    assert.equal(imported.doc.assets["original-asset"].id, "original-asset");
    assert.equal(new TextDecoder().decode(imported.assets.get("original-asset")), svg);
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDoc });
  }
});

test("HTML, Vue and SvelteKit ZIP exports round-trip editable data and asset IDs", async () => {
  const doc = createInitialDoc();
  doc.siteName = "Format roundtrip";
  // The starter includes a dynamic route that static frameworks intentionally reject.
  for (const page of Object.values(doc.pages)) {
    if (/\[[^\]]+\]/.test(page.slug)) page.unpublished = true;
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  doc.assets["roundtrip-logo"] = {
    id: "roundtrip-logo", name: "logo.svg", mimeType: "image/svg+xml",
    width: 10, height: 10,
    dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
  };
  const createUrl = URL.createObjectURL;
  const previousDoc = globalThis.document;
  let blob: Blob | null = null;
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: (value: Blob) => { blob = value; return "blob:roundtrip"; },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => ({ href: "", download: "", click() {} }) },
    });
    for (const framework of ["html", "vue", "sveltekit"] as const) {
      blob = null;
      const missing = await exportProjectZip(doc, {
        framework, language: "javascript", style: "css", scope: "project",
      });
      assert.deepEqual(missing, []);
      assert.ok(blob, `Missing ${framework} ZIP`);
      const archive = new Uint8Array(await (blob as Blob).arrayBuffer());
      const imported = await parseSiteImport(archive, "zip");
      assert.deepEqual(imported.doc, doc);
      assert.equal(imported.doc.assets["roundtrip-logo"].id, "roundtrip-logo");
      assert.equal(new TextDecoder().decode(imported.assets.get("roundtrip-logo")), svg);
      const zip = await JSZip.loadAsync(archive);
      const mapPath = "format-roundtrip/" + EDITABLE_ASSETS_PATH;
      const assetMap = JSON.parse(await zip.file(mapPath)!.async("text"));
      const prefix = framework === "html" ? "assets/" :
        framework === "sveltekit" ? "static/assets/" : "public/assets/";
      assert.equal(assetMap.assets["roundtrip-logo"], prefix + "logo.svg");
    }
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDoc });
  }
});


test("page-scoped ZIP round-trip does not include other pages, nodes or private assets", async () => {
  const doc = createInitialDoc();
  doc.siteName = "Scope audit";
  const home = doc.pageOrder[0];
  doc.pages = { [home]: { ...doc.pages[home], slug: "", unpublished: false } };
  doc.pageOrder = [home];
  doc.pages.private = {
    ...structuredClone(doc.pages[home]), id: "private",
    name: "Private", title: "PRIVATE-PAGE-TITLE", slug: "private",
    children: ["private-node"], unpublished: true,
  };
  doc.pageOrder.push("private");
  doc.nodes["private-node"] = { ...doc.nodes[doc.pages[home].children[0]],
    id: "private-node", text: { content: "PRIVATE-NODE-CONTENT", heading: 0 } };
  doc.assets["private-asset"] = {
    id: "private-asset", name: "secret.svg", width: 10, height: 10,
    mimeType: "image/svg+xml",
    dataUrl: "data:image/svg+xml;base64," +
      Buffer.from("<svg>SECRET_ASSET_MARKER</svg>").toString("base64"),
  };
  doc.pages[home].customEndHtml = '<img src="https://external.test/assets/secret.svg"><img src="//export.invalid/assets/secret.svg"><!-- <img src="/assets/secret.svg"> -->';
  doc.pages[home].description = "Example local filename: /assets/secret.svg";
  const create = URL.createObjectURL;
  const previous = globalThis.document;
  let blob: Blob | null = null;
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: (value: Blob) => { blob = value; return "blob:scoped"; },
    });
    Object.defineProperty(globalThis, "document", { configurable: true,
      value: { createElement: () => ({ href: "", download: "", click() {} }) },
    });
    await exportProjectZip(doc, {
      framework: "html", language: "javascript", style: "css",
      scope: "page", pageId: home,
    });
    assert.ok(blob);
    const archive = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
    const names = Object.keys(archive.files);
    assert.ok(!names.some((name) => name.endsWith("/assets/secret.svg")));
    const entry = archive.file("scope-audit/" + EDITABLE_DOC_PATH);
    assert.ok(entry);
    const scoped = JSON.parse(await entry.async("text"));
    assert.deepEqual(scoped.pageOrder, [home]);
    assert.equal(scoped.pages.private, undefined);
    assert.equal(scoped.nodes["private-node"], undefined);
    assert.equal(scoped.assets["private-asset"], undefined);
    const imported = await parseSiteImport(new Uint8Array(await (blob as Blob).arrayBuffer()), "zip");
    assert.deepEqual(imported.doc.pageOrder, [home]);
  } finally {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
});
