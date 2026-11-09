import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { hasPublishCredentials, readRestoreJson } from "../lib/publish-security";
import { validateImportedDoc } from "../lib/site-import";

const siteWithFetch = (url: string, headers?: { name: string; value: string }[], body?: string) => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "get", kind: "fetch", as: "data", url, ...(headers ? { headers } : {}),
      ...(body ? { body } : {}) }] }];
  return doc;
};

test("GitHub Push blocks literal API credentials in full editable document", () => {
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data?api_key=top-secret")), true);
  assert.equal(hasPublishCredentials(siteWithFetch("https://user:password@public.example/data")), true);
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data",
    [{ name: "Authorization", value: "Bearer top-secret" }])), true);
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data",
    undefined, '{"client_secret":"not-for-git"}')), true);
});

test("GitHub Push can include public data sources and placeholder variables", () => {
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data?category=books")), false);
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data?api_key=%7Bkey%7D")), false);
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data", undefined,
    '{"category":"{search}"}')), false);
});

test("credential scanner also visits scripts attached to elements", () => {
  const doc = createInitialDoc();
  const node = doc.nodes[doc.pages[doc.pageOrder[0]].children[0]];
  node.scripts = [{ id: "node-event", trigger: "click", pos: { x: 0, y: 0 },
    steps: [{ id: "fetch", kind: "fetch", as: "private", url: "https://api.example/secret?token=abc" }],
  }];
  assert.equal(hasPublishCredentials(doc), true);
});

test("credential detection visits deep scripts and decoded query, form and JSON keys", () => {
  const url = "https://example.test/data";
  assert.equal(hasPublishCredentials(siteWithFetch(url + "?%61pi_key=literal")), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url, [], "mode=test&client%5Fsecret=literal")), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url, [], '{"nested":{"pass\\u0077ord":"literal"}}')), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url + "?%61pi_key=%7Bkey%7D")), false);
  const doc = siteWithFetch(url + "?token=literal");
  const steps = doc.pages[doc.pageOrder[0]].pageScripts![0].steps;
  let nested = steps.splice(0);
  for (let i = 0; i < 60; i++) nested = [{ id: String(i), kind: "repeat", times: 1, then: nested }];
  steps.push(...nested);
  assert.equal(hasPublishCredentials(doc), true);
});

test("GitHub history JSON is bounded even without Content-Length", async () => {
  const tooLarge = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([123, 34, 97, 34, 58, 34]));
      controller.enqueue(new Uint8Array(24));
      controller.close();
    },
  }));
  await assert.rejects(readRestoreJson(tooLarge, 16), /大きすぎ/);
  const advertised = new Response('{"siteName":"ignored"}', { headers: { "Content-Length": "1000" } });
  await assert.rejects(readRestoreJson(advertised, 16), /大きすぎ/);
});

test("GitHub history JSON rejects truncated content and malformed UTF-8", async () => {
  await assert.rejects(readRestoreJson(new Response('{"siteName":'), 100), /読み込めません/);
  await assert.rejects(readRestoreJson(new Response(new Uint8Array([0xff, 0xfe])), 100), /読み込めません/);
});

test("validated history JSON round-trips a SiteDoc but rejects poisoned restores", async () => {
  const doc = createInitialDoc();
  const restored = validateImportedDoc(await readRestoreJson(Response.json(doc), 1024 * 1024));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(doc)));

  const poison = JSON.parse(JSON.stringify(doc));
  Object.defineProperty(poison.nodes, "__proto__", { value: { poisoned: true }, enumerable: true });
  assert.throws(() => validateImportedDoc(poison), /プロパティ/);

  const invalid = JSON.parse(JSON.stringify(doc));
  invalid.pageOrder = ["nonexistent-page"];
  assert.throws(() => validateImportedDoc(invalid), /ページ|親子/);
});
