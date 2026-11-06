import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as React from "react";

const require = createRequire(new URL("../components/PublishModal.tsx", import.meta.url));
const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8");
const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
const old = "a".repeat(40);
function fixture({ conflict = false, legacy = false, asset = false } = {}) {
  let branch = "main", site = "example";
  let confirm: (yes: boolean) => void = () => { throw new Error("Confirmation not shown"); };
  let waiting = false;
  const writes: any[] = [], published: string[] = [], updates: { index: number; value: any }[] = [];
  const doc = { siteName: "Example", assets: {} };
  const store = { doc, markPublished: (fingerprint: string) => published.push(fingerprint) };
  const useEditor = Object.assign((fn: any) => fn(store), { getState: () => store });
  const conf = {
    site: "example", configured: true, previewEnabled: true,
    production: { repo: "owner/site", branch: "main", url: null, error: null },
    test: { repo: "owner/site", branch: "preview", url: null, error: null },
  };
  let cursor = 0;
  const hooks = { ...React, useEffect() {}, useState(initial: any) {
    const index = cursor++;
    return [index === 0 ? conf : initial, (value: any) => updates.push({ index, value })];
  } };
  const mocks: Record<string, any> = {
    react: hooks,
    "../lib/store": { useEditor, docFingerprint: () => "published" },
    "./HelpCenter": {}, "./controls": {},
    "../lib/dialog": { showConfirm: () => new Promise<boolean>(resolve => { confirm = resolve; waiting = true; }) },
    "../lib/assets": { detectSvgFilters: async () => ({}) },
    "../lib/generator": { generateProject: () => ({ files: { "app/page.tsx": "NEW" }, binaries: asset ? { "public/p.png": "eA==" } : {}, remoteAssets: {} }) },
    "../lib/generator/checks": { runChecks: () => [] },
    "../lib/errors": { userMessage: (e: Error) => e.message },
    "../lib/site": { sitePublishFields: () => ({ site, dest: { repo: "owner/site", branch, previewBranch: "preview" } }) },
    "../lib/i18n": { tr: (s: string) => s, getLang: () => "en" },
  };
  const request = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); writes.push(body);
    if (body.action === "tree") return Response.json({ ...(legacy ? {} : { head: old }), blobs: { "app/page.tsx": "manual" }, manifest: {}, generated: {} });
    if (body.dest.branch !== body.expected.productionBranch || conflict) return Response.json({ error: "Destination or head changed; reopen and review." }, { status: 409 });
    return Response.json({ sha: "asset", commitUrl: "https://example.com/commit" });
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "fetch", code)((name: string) => name in mocks ? mocks[name] : require(name), module, module.exports, request);
  const tree = module.exports.default({ onClose() {}, onOpenHistory() {} });
  const elements = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
  const button = elements(tree).find(e => e.type === "button" && e.props.className === "btn btn-primary");
  const run = () => button.props.onClick() as Promise<void>;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { run, settle, writes, updates, published, get waiting() { return waiting; }, confirm: (yes = true) => confirm(yes), changeBranch: () => { branch = "release"; }, navigate: () => { site = "other"; } };
}

test("confirmation cannot retarget a publish after another Home tab changes local settings", async () => {
  const f = fixture({ asset: true }); const run = f.run(); await f.settle();
  assert.equal(f.waiting, true); f.changeBranch(); f.confirm(); await run;
  assert.equal(f.writes[0].dest.branch, "main");
  assert.equal(f.writes[1].dest.branch, "release", "current fallback must expose drift to server validation");
  assert.deepEqual(f.writes[1].expected, f.writes[0].expected, "approved identity stays immutable");
  assert.equal(f.writes[1].expected.branch, "main");
  assert.equal(f.writes.some(w => w.action === "commit"), false);
  assert.deepEqual(f.published, []);
  assert.ok(f.updates.some(u => u.value?.conflict === true));
});

test("commit carries the exact preflight head and a conflict never marks published", async () => {
  const f = fixture({ conflict: true }); const run = f.run(); await f.settle(); f.confirm(); await run;
  const commit = f.writes.find(w => w.action === "commit");
  assert.equal(commit.expectedHead, old);
  assert.deepEqual(commit.expected, f.writes[0].expected);
  assert.deepEqual(f.published, []); assert.ok(f.updates.some(u => u.value?.conflict));
  assert.equal(f.writes.length, 2, "conflicts do not automatically replan or publish");
});

test("navigation during confirmation cannot publish the new site's document or destination", async () => {
  const f = fixture(); const run = f.run(); await f.settle(); f.navigate(); f.confirm(); await run;
  assert.equal(f.writes.length, 1); assert.deepEqual(f.published, []);
});

test("a legacy server snapshot without a head fails closed before confirmation or uploads", async () => {
  const f = fixture({ legacy: true, asset: true }); await f.run();
  assert.equal(f.waiting, false); assert.equal(f.writes.length, 1); assert.deepEqual(f.published, []);
});

test("unchanged destination publishes with the approved identity and snapshot head", async () => {
  const f = fixture({ asset: true }); const run = f.run(); await f.settle(); f.confirm(); await run;
  assert.deepEqual(f.writes.map(w => w.action), ["tree", "upload", "commit"]);
  assert.ok(f.writes.every(w => w.expected.site === "example" && w.expected.branch === "main"));
  assert.equal(f.writes.at(-1).expectedHead, old); assert.deepEqual(f.published, ["published"]);
});
