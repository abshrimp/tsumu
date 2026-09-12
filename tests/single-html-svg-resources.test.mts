import assert from "node:assert/strict";
import { test } from "node:test";
import { toSingleHtmlProject } from "../lib/generator/single-html";

for (const attribute of ["href", "xlink:href"]) {
  test(`single HTML embeds SVG filter image ${attribute}`, async () => {
    const result = await toSingleHtmlProject({
      files: {
        "index.html": `<svg><defs><filter id="texture"><feImage ${attribute}="texture.png" result="texture" preserveAspectRatio="xMidYMid slice"/></filter></defs><rect filter="url(#texture)" width="100" height="100"/></svg>`,
      },
      binaries: { "texture.png": "AQID" }, remoteAssets: {},
    });
    assert.match(result.files["index.html"], new RegExp(`<feImage ${attribute}="data:image/png;base64,AQID"`));
    assert.match(result.files["index.html"], /result="texture" preserveAspectRatio="xMidYMid slice"\/>/);
    assert.match(result.files["index.html"], /filter="url\(#texture\)"/);
    assert.deepEqual(result.binaries, {});
  });
}

test("SVG filter images use the document base and fetch remote resources once", async () => {
  const seen: string[] = [];
  const result = await toSingleHtmlProject({
    files: {
      "index.html": '<base href="https://cdn.example/art/"><svg><filter id="texture"><feImage href="paper.png"/><feImage xlink:href="paper.png"/></filter></svg>',
    },
    binaries: {}, remoteAssets: {},
  }, async url => {
    seen.push(url);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
  });
  assert.deepEqual(seen, ["https://cdn.example/art/paper.png"]);
  assert.equal((result.files["index.html"].match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
});

test("SVG filter href takes precedence over unused xlink:href", async () => {
  const result = await toSingleHtmlProject({
    files: { "index.html": '<svg><filter><feImage href="texture.png" xlink:href="missing.png"/></filter></svg>' },
    binaries: { "texture.png": "AQID" }, remoteAssets: {},
  });
  assert.match(result.files["index.html"], /href="data:image\/png;base64,AQID" xlink:href="missing.png"/);
});

test("SVG filter internal references, existing data URLs and empty href stay unchanged", async () => {
  const html = '<svg><filter><feImage href="#local"/><feImage xlink:href="#legacy"/><feImage href="data:image/png;base64,AQID"/><feImage href="" xlink:href="missing.png"/></filter></svg>';
  const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} }, async () => {
    throw new Error("Unexpected download");
  });
  assert.equal(result.files["index.html"], html);
});

test("single HTML does not treat an HTML feimage lookalike as an SVG resource", async () => {
  const html = '<feimage href="missing.png"></feimage>';
  const result = await toSingleHtmlProject({ files: { "index.html": html }, binaries: {}, remoteAssets: {} });
  assert.equal(result.files["index.html"], html);
});

test("SVG image URLs ignore removed xml:base attributes and retain the HTML base", async () => {
  // SVG 2 では xml:base が削除されたため、HTML の文書の基準だけを使う。
  // https://www.w3.org/TR/SVG2/changes.html#struct
  const result = await toSingleHtmlProject({
    files: {
      "index.html": '<base href="./art/"><svg xml:base="https://wrong.example/"><g xml:base="nested/"><image href="picture.png"/><image xlink:href="picture.png"/></g></svg>',
    },
    binaries: { "art/picture.png": "AQID" }, remoteAssets: {},
  }, async () => { throw new Error("Unexpected download"); });
  assert.equal((result.files["index.html"].match(/data:image\/png;base64,AQID/g) ?? []).length, 2);
  assert.match(result.files["index.html"], /xml:base="https:\/\/wrong\.example\/"/);
  assert.match(result.files["index.html"], /xml:base="nested\/"/);
});
