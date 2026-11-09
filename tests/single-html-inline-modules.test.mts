import assert from "node:assert/strict";
import { test } from "node:test";
import { singleHtmlResources, EXPORT_BASE } from "../lib/generator/single-html-resources";
const noRequest = async () => { throw new Error("Unexpected network request"); };
const run = (source: string) => import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
test("inline modules resolve static and dynamic dependencies relative to the document base", async () => {
  const resources = singleHtmlResources({ files: {
    "dir/entry.mjs": 'import { value } from "./child.mjs"; export const n = value + 1;',
    "dir/child.mjs": "export const value = 40;",
  }, binaries: {}, remoteAssets: {} }, noRequest, false);
  const text = await resources.inlineModule('import { n } from "./entry.mjs"; export const result = n + (await import("./child.mjs")).value;', new URL("dir/page.html", EXPORT_BASE));
  assert.ok(!text.includes('"./entry.mjs"'));
  assert.ok(!text.includes('"./child.mjs"'));
  assert.equal((await run(text)).result, 81);
});
test("inline modules reuse cached dependencies and retain data URL imports", async () => {
  const resources = singleHtmlResources({ files: { "value.mjs": "export const n = {};" }, binaries: {}, remoteAssets: {} }, noRequest, false);
  const text = await resources.inlineModule('import { n as a } from "./value.mjs"; import { n as b } from "./value.mjs"; import { n as c } from "data:text/javascript,export const n=2"; export const result = a === b && c === 2;', EXPORT_BASE);
  assert.equal((await run(text)).result, true);
});
test("inline modules reject circular dependencies and non-static resolution just like external modules", async () => {
  const resources = singleHtmlResources({ files: { "a.mjs": 'import "./b.mjs";', "b.mjs": 'import "./a.mjs";' }, binaries: {}, remoteAssets: {} }, noRequest, false);
  await assert.rejects(resources.inlineModule('import "./a.mjs";', EXPORT_BASE), /circular/);
  await assert.rejects(resources.inlineModule('import(location.href);', EXPORT_BASE), /runtime resolution/);
  await assert.rejects(resources.inlineModule('console.log(import.meta.url);', EXPORT_BASE), /runtime resolution/);
});
test("inline scripts with no imports retain their bytes while authored import maps fail closed", async () => {
  const resources = singleHtmlResources({ files: {}, binaries: {}, remoteAssets: {} }, noRequest, true);
  const plain = 'const text = "<script>not an import</script>";';
  assert.equal(await resources.inlineModule(plain, EXPORT_BASE), plain);
  await assert.rejects(resources.inlineModule('import "./x.mjs";', EXPORT_BASE), /import map/);
});

test("single HTML rewrites inline module bodies and preserves surrounding markup", async () => {
  const { toSingleHtmlProject } = await import("../lib/generator/single-html");
  const { parse } = await import("parse5");
  const html = '<!doctype html><base href="/dir/"><script type="module" nonce="test">import { n } from "./entry.mjs"; export const answer = n;</script><p>After</p>';
  const project = await toSingleHtmlProject({ files: { "index.html": html, "dir/entry.mjs": "export const n = 42;" }, binaries: {}, remoteAssets: {} }, noRequest);
  const output = project.files["index.html"];
  assert.match(output, /nonce="test"/);
  assert.ok(output.endsWith("</script><p>After</p>"));
  const scripts: any[] = [];
  const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
  visit(parse(output));
  assert.equal(scripts.length, 1);
  const source = scripts[0].childNodes.map((node: any) => node.value ?? "").join("");
  assert.equal((await run(source)).answer, 42);
  assert.deepEqual(Object.keys(project.files), ["index.html"]);
});

test("an EOF-terminated inline module still embeds its dependencies", async () => {
  const { toSingleHtmlProject } = await import("../lib/generator/single-html");
  const prefix = '<script type="module">';
  const project = await toSingleHtmlProject({ files: { "index.html": prefix + 'import { n } from "./entry.mjs"; export const answer = n;', "entry.mjs": "export const n = 7;" }, binaries: {}, remoteAssets: {} }, noRequest);
  assert.equal((await run(project.files["index.html"].slice(prefix.length))).answer, 7);
});
