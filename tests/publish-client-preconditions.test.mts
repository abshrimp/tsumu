import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as React from "react";
import { generateProject } from "../lib/generator";
import { GENERATED_MANIFEST_PATH, parseGeneratedManifest } from "../lib/publish-files";
import type { SiteDoc } from "../lib/types";
import type { detectSvgFilters } from "../lib/assets";

const require = createRequire(new URL("../components/PublishModal.tsx", import.meta.url));
const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8");
const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
const old = "a".repeat(40);
function fixture({ conflict = false, missingHead = false, asset = false, document, snapshot, analyzeSvg, commitFailure }: {
  conflict?: boolean; missingHead?: boolean; asset?: boolean; document?: SiteDoc;
  analyzeSvg?: typeof detectSvgFilters;
  snapshot?: { blobs: Record<string, string>; generated: Record<string, string> | null };
  commitFailure?: { status: number; body: object };
} = {}) {
  let branch = "main", site = "example";
  let confirm: (yes: boolean) => void = () => { throw new Error("Confirmation not shown"); };
  let waiting = false;
  const writes: any[] = [], published: string[] = [], updates: { index: number; value: any }[] = [];
  const confirmations: string[] = [];
  const trustedMessages = new Set<string>();
  const translate = (value: string, vars: Record<string, string | number> = {}) => {
    const translated = value.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => vars[key] === undefined ? match : String(vars[key]));
    trustedMessages.add(translated);
    return translated;
  };
  const doc = document ?? { siteName: "Example", assets: {} };
  let documentWrites = 0;
  const store = {
    doc,
    markPublished: (fingerprint: string) => published.push(fingerprint),
    updateDoc: (edit: (draft: SiteDoc) => void) => {
      documentWrites++;
      const draft = structuredClone(store.doc) as SiteDoc;
      edit(draft);
      store.doc = draft;
    },
  };
  const useEditor = Object.assign((fn: any) => fn(store), { getState: () => store });
  const conf = {
    site: "example", configured: true, previewEnabled: true,
    production: { repo: "owner/site", branch: "main", url: null, error: null },
    test: { repo: "owner/site", branch: "preview", url: null, error: null },
  };
  let cursor = 0;
  const hooks = { ...React, useEffect() {}, useMemo(fn: () => unknown) { return fn(); }, useState(initial: any) {
    const index = cursor++;
    return [index === 0 ? conf : initial, (value: any) => updates.push({ index, value })];
  } };
  const mocks: Record<string, any> = {
    react: hooks,
    "../lib/use-escape-to-close": { useEscapeToClose() {} },
    "../lib/store": { useEditor, docFingerprint: () => "published" },
    "./HelpCenter": {}, "./controls": {},
    "../lib/dialog": { showConfirm: (message: string) => new Promise<boolean>(resolve => { confirmations.push(message); confirm = resolve; waiting = true; }) },
    "../lib/assets": { detectSvgFilters: analyzeSvg ?? (async () => ({})) },
    "../lib/generator": { generateProject: document ? generateProject : () => ({ files: { "app/page.tsx": "NEW" }, binaries: asset ? { "public/p.png": "eA==" } : {}, remoteAssets: {} }) },
    "../lib/export-formats": {
      DEFAULT_EXPORT_OPTIONS: { framework: "nextjs", language: "typescript", style: "css", scope: "project" },
      EXPORT_FRAMEWORK_OPTIONS: [{ value: "nextjs", label: "Next.js" }],
      exportLimitations: () => [],
      prepareExportProject: async (_doc: SiteDoc, _options: unknown, target: "test" | "production") =>
        document ? generateProject(_doc, target) : {
          files: { "app/page.tsx": "NEW" },
          binaries: asset ? { "public/p.png": "eA==" } : {},
          remoteAssets: {},
        },
    },
    "../lib/generator/checks": { runChecks: () => [] },
    "../lib/errors": { userMessage: (e: Error, fallback: string) => trustedMessages.has(e.message) ? e.message : fallback },
    "../lib/site": { sitePublishFields: () => ({ site, dest: { repo: "owner/site", branch, previewBranch: "preview" } }) },
    "../lib/i18n": { tr: translate, getLang: () => "en" },
  };
  const request = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); writes.push(body);
    if (body.action === "tree") return Response.json({ ...(missingHead ? {} : { head: old }), blobs: { "app/page.tsx": "manual" }, manifest: {}, generated: {}, ...snapshot });
    if (body.dest.branch !== body.expected.productionBranch || conflict) return Response.json({ error: "Destination or head changed; reopen and review." }, { status: 409 });
    if (body.action === "commit" && commitFailure) return Response.json(commitFailure.body, { status: commitFailure.status });
    return Response.json({ sha: "asset", commitUrl: "https://example.com/commit" });
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "fetch", code)((name: string) => name in mocks ? mocks[name] : require(name), module, module.exports, request);
  const tree = module.exports.default({ onClose() {}, onOpenHistory() {} });
  const elements = (node: any): any[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
  const button = elements(tree).find(e => e.type === "button" && e.props.className === "btn btn-primary");
  const run = () => button.props.onClick() as Promise<void>;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { run, settle, writes, updates, published, confirmations, store, get documentWrites() { return documentWrites; }, get waiting() { return waiting; }, confirm: (yes = true) => confirm(yes), changeBranch: () => { branch = "release"; }, navigate: () => { site = "other"; } };
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

test("a missingHead server snapshot without a head fails closed before confirmation or uploads", async () => {
  const f = fixture({ missingHead: true, asset: true }); await f.run();
  assert.equal(f.waiting, false); assert.equal(f.writes.length, 1); assert.deepEqual(f.published, []);
});

test("unchanged destination publishes with the approved identity and snapshot head", async () => {
  const f = fixture({ asset: true }); const run = f.run(); await f.settle(); f.confirm(); await run;
  assert.deepEqual(f.writes.map(w => w.action), ["tree", "upload", "commit"]);
  assert.ok(f.writes.every(w => w.expected.site === "example" && w.expected.branch === "main"));
  assert.equal(f.writes.at(-1).expectedHead, old); assert.deepEqual(f.published, ["published"]);
});

const pwaDoc: SiteDoc = {
  siteName: "PWA", nodes: {}, assets: {}, pageOrder: ["home"], pwa: { enabled: false },
  pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
};

test("PWA retirement is included before edited-worker confirmation, and cancel prevents all writes", async () => {
  for (const accepted of [false, true]) {
    const f = fixture({ document: pwaDoc, snapshot: {
      blobs: { "public/sw.js": "edited", "manual.txt": "mine" }, generated: { "public/sw.js": "original" },
    } });
    const run = f.run(); await f.settle();
    assert.equal(f.waiting, true);
    assert.match(f.confirmations[0], /public\/sw\.js/);
    assert.deepEqual(f.writes.map(w => w.action), ["tree"]);
    f.confirm(accepted); await run;
    if (!accepted) {
      assert.deepEqual(f.writes.map(w => w.action), ["tree"]);
      assert.deepEqual(f.published, []);
      assert.ok(f.updates.some(u => u.value === "check"));
      continue;
    }
    const commit = f.writes.at(-1);
    assert.equal(commit.action, "commit");
    assert.equal(commit.expectedHead, old);
    assert.deepEqual(commit.expected, f.writes[0].expected);
    assert.match(commit.files["public/sw.js"], /registration\.unregister\(\)/);
    assert.deepEqual(commit.keptPaths, ["manual.txt"]);
    assert.ok(parseGeneratedManifest(commit.files[GENERATED_MANIFEST_PATH])!["public/sw.js"]);
    assert.deepEqual(f.published, ["published"]);
  }
});

test("actual publication retains retirement ownership across repeated off, absent settings, and reenable", async () => {
  let snapshot: { blobs: Record<string, string>; generated: Record<string, string> } = {
    blobs: { "public/sw.js": "original" }, generated: { "public/sw.js": "original" },
  };
  let retirement = "";
  for (const pwa of [{ enabled: false }, undefined, { enabled: true }]) {
    const f = fixture({ document: { ...pwaDoc, pwa }, snapshot });
    await f.run();
    assert.equal(f.waiting, false);
    const commit = f.writes.at(-1);
    assert.equal(commit.action, "commit");
    const next = parseGeneratedManifest(commit.files[GENERATED_MANIFEST_PATH])!;
    assert.ok(next["public/sw.js"]);
    if (pwa?.enabled) {
      assert.equal(commit.files["public/sw.js"], generateProject({ ...pwaDoc, pwa }).files["public/sw.js"]);
      assert.ok(commit.files["public/pwa.js"]);
    } else {
      assert.match(commit.files["public/sw.js"], /registration\.unregister\(\)/);
      if (retirement) assert.equal(commit.files["public/sw.js"], retirement);
      retirement = commit.files["public/sw.js"];
      assert.equal(commit.files["public/pwa.js"], undefined);
      assert.equal(commit.files["app/manifest.ts"], undefined);
    }
    snapshot = { blobs: next, generated: next };
  }
});

test("publication without destination ownership preserves a manual worker and does not claim it", async () => {
  for (const generated of [null, {}]) {
    const f = fixture({ document: pwaDoc, snapshot: { blobs: { "public/sw.js": "manual" }, generated } });
    await f.run();
    assert.equal(f.waiting, false);
    const commit = f.writes.at(-1);
    assert.equal(commit.action, "commit");
    assert.equal(commit.files["public/sw.js"], undefined);
    assert.deepEqual(commit.keptPaths, ["public/sw.js"]);
    assert.equal(parseGeneratedManifest(commit.files[GENERATED_MANIFEST_PATH])!["public/sw.js"], undefined);
  }
});

test("publishing uses the checked document when the live SVG changes during analysis", async () => {
  const logo = { id: "logo", name: "logo.svg", path: "assets/original.svg", width: 0, height: 0 };
  const doc = { ...pwaDoc, siteName: "Reviewed", assets: { logo } };
  let finish!: () => void;
  const analysis = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture({ document: doc, snapshot: { blobs: {}, generated: null }, analyzeSvg: async assets => {
    assert.equal(assets, doc.assets);
    await analysis;
    return { logo: { svgFilter: true, width: 100, height: 50 } };
  } });
  const run = f.run();
  await f.settle();
  const replacement = { ...doc, siteName: "New edit", assets: { logo: { ...logo, path: "assets/new.svg" } } };
  f.store.doc = replacement;
  finish();
  await run;
  const commit = f.writes.find(request => request.action === "commit");
  const exported = JSON.parse(commit.files["_tsumu/doc.json"]);
  assert.equal(exported.siteName, "Reviewed");
  assert.deepEqual(exported.assets.logo, { ...logo, svgFilter: true, width: 100, height: 50 });
  assert.equal(f.store.doc, replacement);
  assert.equal(f.documentWrites, 0);
});

test("publishing records new SVG metadata and skips an editor write when it already matches", async () => {
  const logo = { id: "logo", name: "logo.svg", path: "assets/logo.svg", width: 20, height: 10 };
  for (const svgFilter of [undefined, true]) {
    const doc = { ...pwaDoc, assets: { logo: { ...logo, svgFilter } } };
    const f = fixture({ document: doc, snapshot: { blobs: {}, generated: null },
      analyzeSvg: async () => ({ logo: { svgFilter: true } }) });
    await f.run();
    const committed = JSON.parse(f.writes.find(request => request.action === "commit").files["_tsumu/doc.json"]);
    assert.deepEqual(committed.assets.logo, { ...logo, svgFilter: true });
    assert.deepEqual(f.store.doc.assets, committed.assets);
    assert.equal(f.documentWrites, svgFilter === undefined ? 1 : 0);
  }
});

test("recreating a deleted GitHub file requires confirmation before uploading or committing", async () => {
  for (const accepted of [false, true]) {
    const f = fixture({ asset: true, snapshot: { blobs: {}, generated: { "app/page.tsx": "prior" } } });
    const run = f.run();
    await f.settle();
    assert.deepEqual(f.writes.map(w => w.action), ["tree"]);
    assert.match(f.confirmations[0], /app\/page\.tsx/);
    f.confirm(accepted);
    await run;
    assert.deepEqual(f.writes.map(w => w.action), accepted ? ["tree", "upload", "commit"] : ["tree"]);
    if (accepted) {
      assert.equal(f.writes.at(-1).files["app/page.tsx"], "NEW");
      assert.equal(f.writes.at(-1).expectedHead, old);
    }
  }
});


test("typed GitHub tree failures remain actionable in English without trusting raw API errors", async () => {
  for (const [status, detail, expected] of [
    [422, { kind: "validation", path: "app/page.tsx", batch: 1, total: 2 }, "app/page.tsx"],
    [422, { kind: "validation", path: null, batch: 2, total: 3 }, "batch 2 of 3"],
    [429, { kind: "rate-limit", path: null, batch: 1, total: 1 }, "temporarily limiting"],
  ] as const) {
    const f = fixture({ snapshot: { blobs: {}, generated: {} }, commitFailure: {
      status, body: { error: "SECRET from the upstream provider", treeError: detail },
    } });
    await f.run();
    assert.deepEqual(f.writes.map(w => w.action), ["tree", "commit"]);
    assert.deepEqual(f.published, []);
    const result = f.updates.find(u => typeof u.value?.error === "string");
    assert.ok(result, "the publish modal should report an actionable error");
    assert.ok(result.value.error.includes(expected));
    assert.doesNotMatch(result.value.error, /SECRET/);
  }

  const untyped = fixture({ snapshot: { blobs: {}, generated: {} }, commitFailure: {
    status: 422, body: { error: "SECRET from an untyped provider failure" },
  } });
  await untyped.run();
  assert.equal(untyped.updates.find(u => typeof u.value?.error === "string")?.value.error, "Couldn't publish");
});
