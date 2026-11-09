import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "parse5";
import { runInNewContext } from "node:vm";
import { toSingleHtmlProject } from "../lib/generator/single-html";

const legacyTypes = ["text/jscript", "text/livescript", ...Array.from({ length: 6 }, (_, i) => `text/javascript1.${i}`)];
for (const type of legacyTypes) {
  test(`single HTML embeds executable ${type} scripts`, async () => {
    const result = await toSingleHtmlProject({ files: {
      "index.html": `<script type="${type}" src="./legacy.js" defer></script>`,
      "legacy.js": "globalThis.answer = 42;",
    }, binaries: {}, remoteAssets: {} }, async () => { throw new Error("Unexpected network request"); });
    const scripts: any[] = [];
    const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
    visit(parse(result.files["index.html"]));
    const attrs = Object.fromEntries(scripts[0].attrs.map((a: any) => [a.name, a.value]));
    assert.match(attrs.src, /^data:/);
    assert.equal(attrs.type, type);
    assert.ok(Object.hasOwn(attrs, "defer"));
    const context: any = {};
    runInNewContext(Buffer.from(attrs.src.split(",")[1].split("#")[0], "base64").toString(), context);
    assert.equal(context.answer, 42);
  });
}
test("single HTML preserves non-executable script type data blocks without fetching", async () => {
  for (const type of ["application/json", "text/javascript; charset=utf-8", "text/javascript1.6"]) {
    const html = `<script type="${type}" src="https://example.invalid/data">data</script>`;
    const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => { throw new Error("Unexpected network request"); });
    assert.equal(result.files["index.html"], html);
  }
});

for (const type of legacyTypes) {
  test(`single HTML accepts fetched script MIME ${type}`, async () => {
    const result = await toSingleHtmlProject({ files: { "index.html": '<script src="https://cdn.example/script.js"></script>' }, binaries: {}, remoteAssets: {} }, async () => new Response("globalThis.answer = 42;", { headers: { "Content-Type": type } }));
    assert.ok(result.files["index.html"].includes(`data:${type};base64,`));
  });
}
