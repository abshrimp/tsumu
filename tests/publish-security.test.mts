import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { hasPublishCredentials } from "../lib/publish-security";

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
