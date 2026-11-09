import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc, makeIcon } from "../lib/presets";
import { parseSiteImport, validateImportedDoc } from "../lib/site-import";
import { sanitizeImportedSvg } from "../lib/imported-svg";

const encoder = new TextEncoder();

test("imported node settings must have usable shape before the document is persisted", async () => {
  const corruptions: { name: string; patch: Record<string, unknown> }[] = [
    { name: "missing styles", patch: { styles: null } },
    { name: "array styles", patch: { styles: [] } },
    { name: "non-string CSS property", patch: { styles: { base: { default: { color: 1 } } } } },
    { name: "unknown node type", patch: { type: "unknown-element" } },
    { name: "unknown node semantic", patch: { semantic: "script" } },
    { name: "non-string text", patch: { text: { content: 42, heading: 0 } } },
    { name: "non-string link", patch: { link: { kind: "url", url: 5 } } },
    { name: "invalid image source", patch: { image: { src: {}, alt: "", width: 10, height: 10 } } },
    { name: "malformed field options", patch: { field: { kind: "select", options: [false] } } },
    { name: "non-array scripts", patch: { scripts: { steps: [] } } },
    { name: "invalid icon SVG", patch: { icon: { name: "imported", svg: 3 } } },
  ];
  for (const { name, patch } of corruptions) {
    const doc = createInitialDoc();
    const node = Object.values(doc.nodes)[0];
    Object.assign(node, patch);
    assert.throws(() => validateImportedDoc(doc), /要素の設定/, name);
    await assert.rejects(parseSiteImport(encoder.encode(JSON.stringify(doc)), "doc"), /要素の設定/, name);
  }
});

test("imported page style maps cannot contain malformed declarations", () => {
  const doc = createInitialDoc();
  Object.assign(doc.pages[doc.pageOrder[0]], {
    bodyStyles: { base: { default: { backgroundColor: ["red"] } } },
  });
  assert.throws(() => validateImportedDoc(doc), /ページの構造/);
});

test("imported SiteDoc rejects dangling asset references before saving or reopening", async () => {
  const referenceCases: Array<(doc: ReturnType<typeof createInitialDoc>) => void> = [
    doc => { Object.values(doc.nodes)[0].image = { src: "", alt: "", width: 1, height: 1, assetId: "missing" }; },
    doc => { Object.values(doc.nodes)[0].media = { kind: "video", src: "", assetId: "missing" }; },
    doc => { doc.pages[doc.pageOrder[0]].ogImage = { assetId: "missing" }; },
    doc => { doc.favicon = { assetId: "missing" }; },
    doc => { doc.appleTouchIcon = { assetId: "missing" }; },
    doc => { doc.ogImage = { assetId: "missing" }; },
    doc => { doc.pwa = { enabled: true, icon: { assetId: "missing" } }; },
  ];
  for (const [index, setRef] of referenceCases.entries()) {
    const doc = createInitialDoc();
    setRef(doc);
    assert.throws(() => validateImportedDoc(doc), /アセットの参照/, String(index));
    await assert.rejects(parseSiteImport(encoder.encode(JSON.stringify(doc)), "doc"), /アセットの参照/, String(index));
  }
  const valid = createInitialDoc();
  valid.assets.existing = { id: "existing", name: "existing.png", width: 1, height: 1 };
  Object.values(valid.nodes)[0].image = { src: "", alt: "", width: 1, height: 1, assetId: "existing" };
  assert.equal(validateImportedDoc(valid), valid);
});

test("imported SiteDoc rejects missing or duplicate page folders", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.folderId = "missing";
  assert.throws(() => validateImportedDoc(doc), /ページフォルダー/);
  doc.pageFolders = [{ id: "folder", name: "Folder" }];
  page.folderId = "folder";
  assert.equal(validateImportedDoc(doc), doc);
  doc.pageFolders.push({ id: "folder", name: "Duplicate" });
  assert.throws(() => validateImportedDoc(doc), /ページフォルダー/);
});

test("valid documents retain editable node styles after validation", () => {
  const doc = createInitialDoc();
  assert.equal(validateImportedDoc(doc), doc);
});


test("non-browser import strips active or external SVG content rather than bypassing sanitization", () => {
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ' +
    'onload="globalThis.injected=1"><script>alert(1)</script>' +
    '<foreignObject><div onclick="alert(2)">unsafe</div></foreignObject>' +
    '<rect width="10" height="10" fill="url(https://remote.example/payload)"/>' +
    '<circle cx="5" cy="5" r="3"/></svg><img src=x onerror="alert(3)">';
  const cleaned = sanitizeImportedSvg(hostile);
  assert.match(cleaned, /<svg\b/);
  assert.match(cleaned, /<circle\b/);
  assert.doesNotMatch(cleaned, /onload|onerror|<script|foreignobject|remote\.example|url\(https?:|<img|alert\(/i);
  assert.ok(!cleaned.includes('fill="url('));
});


test("direct API SiteDoc validation blocks executable inline SVG without browser sanitization", () => {
  const doc = createInitialDoc();
  const icon = makeIcon();
  const page = doc.pages[doc.pageOrder[0]];
  doc.nodes[icon.id] = icon;
  page.children.push(icon.id);
  assert.equal(validateImportedDoc(doc), doc);
  for (const payload of [
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="5" height="5"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe srcdoc="unsafe"></iframe></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/svg"/></svg>',
  ]) {
    icon.icon!.svg = payload;
    assert.throws(() => validateImportedDoc(doc), /要素の設定/);
  }
});
