import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteHtmlZipScriptUrls, missingHtmlZipScriptAssets } from "../lib/html-zip-script-assets";
import { generateProject } from "../lib/generator";
import { generateExportProject } from "../lib/export-formats";
import { runChecks } from "../lib/generator/checks";
import { createInitialDoc } from "../lib/presets";
import { buildAssetNames } from "../lib/generator/names";
import { assetSrc } from "../lib/assets";
import type { Asset } from "../lib/types";

const stored = (id: string, name: string, path?: string): Asset => ({
  id, name, path: "assets/" + id, width: 10, height: 10,
  mimeType: name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".js") ? "text/javascript" : "image/png",
  ...(path ? { zip: { version: 1 as const, group: "dream_zip", path } } : {}),
});

function fixture() {
  const doc = createInitialDoc();
  const home = doc.pageOrder[0];
  doc.pages = { [home]: { ...doc.pages[home], slug: "", unpublished: false } };
  doc.pageOrder = [home];
  const assets = [
    stored("existing", "MENU.png"),
    stored("menu", "MENU.png", "MENU.png"),
    stored("scene", "classroom.png", "classroom.png"),
    stored("audio", "sound.mp3", "sound.mp3"),
    stored("module", "bgm.js", "bgm.js"),
  ];
  doc.assets = Object.fromEntries(assets.map(a => [a.id, a]));
  const tick = String.fromCharCode(96);
  const source = '<!doctype html><html lang="ja"><head><title>Keep source</title></head><body>\n' +
    '<script>\n' +
    '/* url: "classroom.png" stays in this comment */\n' +
    'const BG_ASSETS = { scene: { url: "classroom.png?v=1#frame" } };\n' +
    "const UI_ASSETS = { MENU: { url: 'MENU.png' } };\n" +
    'const BGM_ASSETS = { sound: { url: ' + tick + 'sound.mp3' + tick + ' }, missing: {url: "underwater.mp3"} };\n' +
    'const remote = "https://example.test/x.png";\n' +
    'const re = /classroom\\.png/g;\n' +
    '</script>\n' +
    '<script type="application/ld+json">{"url":"MENU.png"}</script>\n' +
    '<script type="module">import "./bgm.js";</script>\n' +
    '<img src="MENU.png"><!-- MENU.png -->\n</body></html>';
  doc.pages[home].rawHtml = source;
  doc.pages[home].htmlZip = { path: "index.html", assetIds: assets.slice(1).map(a => a.id) };
  return { doc, source };
}

test("ZIP script media literals resolve without altering comments, regexes, inert scripts, markup or stored source", () => {
  const { doc, source } = fixture();
  const zip = doc.pages[doc.pageOrder[0]].htmlZip!;
  const mapped = rewriteHtmlZipScriptUrls(source, zip, doc.assets, assetSrc);
  const tick = String.fromCharCode(96);
  assert.ok(mapped.includes('url: "/api/assets/file?path=assets%2Fscene&v=1#frame"'));
  assert.ok(mapped.includes('url: "/api/assets/file?path=assets%2Fmenu"'));
  assert.ok(mapped.includes('url: ' + tick + '/api/assets/file?path=assets%2Faudio' + tick));
  assert.ok(mapped.includes('import "/api/assets/file?path=assets%2Fmodule"'));
  assert.ok(mapped.includes('/* url: "classroom.png" stays in this comment */'));
  assert.ok(mapped.includes('const re = /classroom\\.png/g;'));
  assert.ok(mapped.includes('"https://example.test/x.png"'));
  assert.ok(mapped.includes('<script type="application/ld+json">{"url":"MENU.png"}</script>'));
  assert.ok(mapped.includes('<img src="MENU.png">'));
  assert.ok(mapped.includes('<!-- MENU.png -->'));
  assert.equal(source, doc.pages[doc.pageOrder[0]].rawHtml);
  assert.deepEqual(missingHtmlZipScriptAssets(source, zip, doc.assets), ["underwater.mp3"]);
});

test("Next.js and HTML export map script image/audio paths to actual published assets including collisions", () => {
  const { doc, source } = fixture();
  const before = structuredClone(doc);
  const names = buildAssetNames(doc);
  assert.equal(names.get("menu"), "MENU-2.png");
  const next = generateProject(doc);
  const match = /^const html = (.*);$/m.exec(next.files["app/route.ts"]);
  assert.ok(match);
  const page = JSON.parse(match[1]) as string;
  const tick = String.fromCharCode(96);
  assert.ok(page.includes('url: "/assets/classroom.png?v=1#frame"'));
  assert.ok(page.includes('url: "/assets/MENU-2.png"'));
  assert.ok(page.includes('url: ' + tick + '/assets/sound.mp3' + tick));
  assert.ok(page.includes('import "/assets/_imports/dream_zip/bgm.js"'));
  assert.ok(page.includes('<img src="/assets/MENU-2.png">'));
  assert.ok(page.includes('"underwater.mp3"'));
  assert.equal(next.remoteAssets["public/assets/MENU-2.png"], "assets/menu");
  assert.equal(next.remoteAssets["public/assets/classroom.png"], "assets/scene");
  assert.equal(next.remoteAssets["public/assets/_imports/dream_zip/bgm.js"], "assets/module");

  const flat = generateExportProject(doc, "html");
  assert.ok(flat.files["index.html"].includes('url: "assets/MENU-2.png"'));
  assert.ok(flat.files["index.html"].includes('url: "assets/classroom.png?v=1#frame"'));
  assert.ok(flat.files["index.html"].includes('import "assets/_imports/dream_zip/bgm.js"'));
  assert.ok(flat.files["index.html"].includes('url: ' + tick + 'assets/sound.mp3' + tick));
  assert.equal(flat.remoteAssets["assets/MENU-2.png"], "assets/menu");
  assert.deepEqual(doc, before);
  assert.equal(doc.pages[doc.pageOrder[0]].rawHtml, source);
});

test("ZIP media missing in JavaScript causes a warning without preventing publication", () => {
  const { doc } = fixture();
  const warnings = runChecks(doc).filter(item => item.message.includes("underwater.mp3"));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].level, "warn");
  assert.ok(!warnings[0].message.includes("MENU.png"));
});

test("non-ZIP HTML and external or inactive script values are never changed", () => {
  const { doc } = fixture();
  const zip = doc.pages[doc.pageOrder[0]].htmlZip!;
  const html = '<!-- <script>const url = "MENU.png";</script> -->' +
    '<script type="application/json">{"url":"MENU.png"}</script>' +
    '<script src="/other.js">let x = "MENU.png";</script>' +
    '<script>const a = "https://example.test/MENU.png"; const b = "missing.png";</script>';
  assert.equal(rewriteHtmlZipScriptUrls(html, zip, doc.assets, a => "/assets/" + a.name), html);
  assert.deepEqual(missingHtmlZipScriptAssets(html, undefined, doc.assets), []);
  assert.equal(rewriteHtmlZipScriptUrls(html, undefined, doc.assets, a => a.name), html);
});
