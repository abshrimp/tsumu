import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { embedSrc } from "../lib/embed";
import { generateProject } from "../lib/generator";
import { createInitialDoc, makeBox } from "../lib/presets";
import { renderLeafNode } from "../components/canvas/render";
import { loadGeneratedRoute } from "./helpers/generated-route";
import type { DocNode } from "../lib/types";

const id = "dQw4w9WgXcQ";
const target = `https://www.youtube-nocookie.com/embed/${id}`;
const urls = [
  `https://www.youtube.com/watch?v=${id}`,
  `https://www.youtube.com/watch?v=${id}&rv=abcdefghijk`,
  `https://www.youtube.com/watch?rv=abcdefghijk&v=${id}&other_v=XXXXXXXXXXX`,
  `https://www.youtube.com/watch?v=${id}#v=abcdefghijk`,
  `https://www.youtube.com/watch?feature=shared&v=${id}&v=abcdefghijk`,
  `https://www.youtube.com/watch?%76=${id}`,
  `https://www.youtube.com/watch?v=%64Qw4w9WgXcQ`,
  `https://youtu.be/${id}?si=example`,
  `https://www.youtube.com/shorts/${id}`,
  `https://www.youtube.com/live/${id}`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
  id,
];

for (const src of urls) {
  test(`YouTube input selects its video in preview and generated output: ${src}`, async () => {
    assert.equal(embedSrc({ kind: "youtube", src }), target);
    const doc = createInitialDoc();
    const home = doc.pageOrder.find((pid) => doc.pages[pid].slug === "")!;
    const node: DocNode = { ...makeBox(), id: "youtube", type: "embed", embed: { kind: "youtube", src } };
    doc.nodes[node.id] = node;
    doc.pages[home].children = [node.id];
    const before = structuredClone(doc);
    const preview = renderToStaticMarkup(renderLeafNode(node, {}));
    const { files } = generateProject(doc);
    const route = loadGeneratedRoute(files, "app/page.tsx");
    const published = renderToStaticMarkup(await route.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
    for (const html of [preview, published]) {
      assert.equal(/<iframe\b[^>]*\bsrc="([^"]*)"/.exec(html)?.[1], target);
      assert.match(html, /allowFullScreen=""/);
      assert.match(html, /referrerPolicy="strict-origin-when-cross-origin"/);
    }
    assert.deepEqual(doc, before);
  });
}

test("watch URLs do not obtain an ID from unrelated parameters or fragments", () => {
  for (const query of ["rv=abcdefghijk", "other_v=abcdefghijk", "x=1#v=abcdefghijk", "v=&rv=abcdefghijk", "v=short&rv=abcdefghijk", "v=bad%20video&rv=abcdefghijk"]) {
    assert.equal(embedSrc({ kind: "youtube", src: `https://www.youtube.com/watch?${query}` }), null, query);
  }
});
