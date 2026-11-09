import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "parse5";
import { toSingleHtmlProject } from "../lib/generator/single-html";

for (const attribute of ["href", "xlink:href"]) {
  test(`single HTML embeds SVG image ${attribute} instead of dropping the referenced asset`, async () => {
    const project = await toSingleHtmlProject({
      files: { "index.html": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image ${attribute}="picture.png" width="30" height="20"/></svg>` },
      binaries: { "picture.png": "AQID" }, remoteAssets: {},
    });
    assert.match(project.files["index.html"], new RegExp(`${attribute}="data:image/png;base64,AQID"`));
    assert.match(project.files["index.html"], /width="30" height="20"\/>/);
    const tree = parse(project.files["index.html"]);
    const elements: any[] = [];
    const visit = (node: any) => { if (node.tagName === "image") elements.push(node); node.childNodes?.forEach(visit); };
    visit(tree);
    assert.equal(elements.length, 1);
    assert.equal(elements[0].namespaceURI, "http://www.w3.org/2000/svg");
    assert.deepEqual(project.binaries, {});
  });
}

test("SVG image fragments remain internal and ordinary hyperlinks are not downloaded", async () => {
  const html = '<svg><image href="#local"/><a href="https://example.com/"><text>link</text></a></svg>';
  const project = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => {
    throw new Error("Unexpected download");
  });
  assert.equal(project.files["index.html"], html);
});

test("SVG href takes precedence over an unused xlink source", async () => {
  const project = await toSingleHtmlProject({
    files: { "index.html": '<svg><image href="picture.png" xlink:href="missing.png"/></svg>' },
    binaries: { "picture.png": "AQID" }, remoteAssets: {},
  });
  assert.match(project.files["index.html"], /href="data:image\/png;base64,AQID"/);
});
