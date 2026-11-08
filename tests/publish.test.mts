import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { finishNetlifyOAuth, startNetlifyOAuth, readNetlifyAccount, saveNetlifyAccount, disconnectNetlifyAccount, readNetlifySite, saveNetlifySite, saveNetlifyProject, disconnectNetlifySite } from "../lib/browser-netlify";
import { netlifyOAuthConfig, netlifyAccount, createNetlifyProject, verifyNetlifySite, deployNetlifyZip } from "../lib/netlify-publish";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { transformSync } from "./helpers/bundle";
import * as React from "react";
import { generateProject } from "../lib/generator";
import * as files_2 from "../lib/publish-files";
import * as files_3 from "../lib/publish-files";
import * as helpers from "../lib/publish-files";
import { GENERATED_MANIFEST_PATH as GENERATED_MANIFEST_PATH_2, parseGeneratedManifest as parseGeneratedManifest_2, GENERATED_MANIFEST_PATH as GENERATED_MANIFEST_PATH_3, DOC_PATH as DOC_PATH_2, isProtectedPath as isProtectedPath_2, isSafeCommitPath as isSafeCommitPath_2, conflictingCommitPaths as conflictingCommitPaths_2, parseGeneratedManifest as parseGeneratedManifest_3, planPublish as planPublish_2, keptTreeEntries as keptTreeEntries_2, protectedTreeEdits, serializeGeneratedManifest as serializeGeneratedManifest_2, GENERATED_MANIFEST_PATH as GENERATED_MANIFEST_PATH_4, serializeGeneratedManifest as serializeGeneratedManifest_3 } from "../lib/publish-files";
import { type SiteDoc } from "../lib/types";
import { type detectSvgFilters } from "../lib/assets";
import { randomBytes, createHash } from "node:crypto";
import { gitBlobRequestBody } from "../lib/github-blob";
import { readActivity } from "../lib/activity";
import * as preferences from "../lib/publish-preferences";
import { readPublishedExportOptions, DEFAULT_PUBLISHED_EXPORT_OPTIONS as DEFAULT_PUBLISHED_EXPORT_OPTIONS_2, DEFAULT_PUBLISHED_EXPORT_OPTIONS as DEFAULT_PUBLISHED_EXPORT_OPTIONS_3, parsePublishedExportOptions, savePublishedExportOptions } from "../lib/publish-preferences";
import { load as load_2, replacement as replacement_2, setup, sqlOf, isRoomLookup } from "./helpers/document-generation-api";
import { useEditor as useEditor_2 } from "../lib/store";
import * as contract from "../lib/publish-preconditions";
import * as preconditions from "../lib/publish-preconditions";
import { advanceBranchRef } from "../lib/github";
import { hasPublishCredentials, readRestoreJson, validatePublishDocument } from "../lib/publish-security";
import { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited } from "../lib/api-json";
import { tmpdir } from "node:os";
import { join as join_2 } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite } from "../lib/sites";
import { runChecks as runChecks_2, runChecks as runChecks_3 } from "../lib/generator/checks";
import { loadDicts, translate as translate_2 } from "../lib/i18n";
import { createInitialDoc, makeText } from "../lib/presets";
import { renderToStaticMarkup } from "react-dom/server";
import { loadGeneratedRoute } from "./helpers/generated-route";
import { fetchRequestOf } from "../lib/fetch-request";
import { validSiteDoc } from "../lib/doc-tree";
import { exportLimitations as exportLimitations_2 } from "../lib/export-formats";
import { validateImportedDoc } from "../lib/site-import-format";
import { ZipBuilder } from "../lib/zip";
import { hostingProjectName } from "../lib/publish-provider";
import { isPublicStaticPath, listStaticDeployments, pagesAssetHash, readStaticZip } from "../lib/static-hosting";

describe("netlify-browser", () => {
function memoryStorage() {
  const contents = new Map<string, string>();
  return {
    getItem: (key: string) => contents.get(key) ?? null,
    setItem: (key: string, value: string) => { contents.set(key, value); },
    removeItem: (key: string) => { contents.delete(key); },
    clear: () => contents.clear(),
  };
}

test("Netlify OAuth state is bound to the originating tab and local site and consumed once", () => {
  const saved = {
    window: (globalThis as { window?: unknown }).window,
    localStorage: (globalThis as { localStorage?: unknown }).localStorage,
    sessionStorage: (globalThis as { sessionStorage?: unknown }).sessionStorage,
  };
  let destination = "";
  (globalThis as { window?: unknown }).window = {
    location: { origin: "https://tsumu.example.test", assign: (next: string) => { destination = next; } },
  };
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = memoryStorage();
  try {
    startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://tsumu.example.test/netlify/callback",
    });
    const authorize = new URL(destination);
    assert.equal(authorize.origin, "https://app.netlify.com");
    assert.equal(authorize.searchParams.get("response_type"), "token");
    assert.equal(authorize.searchParams.get("client_id"), "registered-client-123456");
    const state = authorize.searchParams.get("state")!;
    assert.throws(() => finishNetlifyOAuth("different", "opaque-oauth-token-1234567"), /did not match/);
    assert.equal(readNetlifyAccount(), null, "mismatched redirects must not persist tokens");
    startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://tsumu.example.test/netlify/callback",
    });
    const goodState = new URL(destination).searchParams.get("state")!;
    assert.equal(finishNetlifyOAuth(goodState, "opaque-oauth-token-1234567"), "local123456");
    assert.equal(readNetlifyAccount()?.token, "opaque-oauth-token-1234567");
    assert.throws(() => finishNetlifyOAuth(goodState, "opaque-oauth-token-1234567"), /did not match/);
    assert.throws(() => startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://attacker.example/netlify/callback",
    }), /does not match/);
  } finally {
    (globalThis as { window?: unknown }).window = saved.window;
    (globalThis as { localStorage?: unknown }).localStorage = saved.localStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = saved.sessionStorage;
  }
});

test("Netlify project IDs are pinned to one browser site and never silently replaced", () => {
  const saved = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  try {
    saveNetlifySite("local123456", {
      userId: "user-12345678", teamId: "team-12345678",
      teamSlug: "own-team", production: null, test: null,
    });
    saveNetlifyProject("local123456", "production", {
      id: "site-12345678", url: "https://site.netlify.app",
    });
    assert.equal(readNetlifySite("local123456")?.production?.id, "site-12345678");
    assert.equal(readNetlifySite("another12345"), null);
    assert.throws(() => saveNetlifyProject("local123456", "production", {
      id: "site-22222222", url: "https://other.netlify.app",
    }), /already linked/);
    disconnectNetlifySite("local123456");
    assert.equal(readNetlifySite("local123456"), null);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = saved;
  }
});

test("Netlify storage helpers degrade gracefully when browser storage is blocked", () => {
  const saved = {
    window: (globalThis as { window?: unknown }).window,
    localStorage: (globalThis as { localStorage?: unknown }).localStorage,
    sessionStorage: (globalThis as { sessionStorage?: unknown }).sessionStorage,
  };
  const blocked = {
    getItem: () => { throw new DOMException("Access denied", "SecurityError"); },
    setItem: () => { throw new DOMException("Access denied", "SecurityError"); },
    removeItem: () => { throw new DOMException("Access denied", "SecurityError"); },
  };
  (globalThis as { window?: unknown }).window = {
    location: { origin: "https://tsumu.example.test", assign: () => {} },
  };
  (globalThis as { localStorage?: unknown }).localStorage = blocked;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = blocked;
  try {
    assert.equal(readNetlifyAccount(), null);
    assert.equal(readNetlifySite("local123456"), null);
    assert.doesNotThrow(() => disconnectNetlifyAccount());
    assert.doesNotThrow(() => disconnectNetlifySite("local123456"));
    assert.throws(() => saveNetlifyAccount({ token: "opaque-oauth-token-1234567" }), /Browser storage is unavailable/);
    assert.throws(() => startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://tsumu.example.test/netlify/callback",
    }), /Browser storage is unavailable/);
  } finally {
    (globalThis as { window?: unknown }).window = saved.window;
    (globalThis as { localStorage?: unknown }).localStorage = saved.localStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = saved.sessionStorage;
  }
});
});

describe("netlify-oauth", () => {
function withConfig(run: () => void) {
  const names = ["PUBLISH_PROVIDER", "NETLIFY_OAUTH_CLIENT_ID", "NETLIFY_OAUTH_REDIRECT_URI"];
  const prior = Object.fromEntries(names.map(key => [key, process.env[key]]));
  try {
    process.env.PUBLISH_PROVIDER = "netlify";
    process.env.NETLIFY_OAUTH_CLIENT_ID = "registered-netlify-client-123456";
    process.env.NETLIFY_OAUTH_REDIRECT_URI = "https://tsumu.ebii.net/netlify/callback";
    run();
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
}

test("Netlify OAuth configuration never requires a Tsumu account, shared token, or encryption key", () => {
  withConfig(() => {
    assert.deepEqual(netlifyOAuthConfig(), {
      clientId: "registered-netlify-client-123456",
      redirectUri: "https://tsumu.ebii.net/netlify/callback",
    });
    process.env.NETLIFY_OAUTH_REDIRECT_URI = "https://attacker.test/other";
    assert.throws(netlifyOAuthConfig);
  });
});

test("Netlify client credential is scoped to the user-selected team", async () => {
  const original = globalThis.fetch;
  let created = false;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.equal(init?.headers instanceof Headers ? init.headers.get("Authorization") :
      (init?.headers as Record<string, string>)?.Authorization, "Bearer browser-token-1234567890");
    assert.equal(init?.redirect, "manual");
    if (path.endsWith("/user")) return Response.json({ id: "user-12345678", email: "visitor@example.test" });
    if (path.endsWith("/accounts")) return Response.json([
      { id: "team-12345678", slug: "visitor-team", name: "Visitor's Team" },
    ]);
    if (path.endsWith("/visitor-team/sites")) {
      created = true;
      assert.equal(init?.method, "POST");
      return Response.json({
        id: "site-12345678", account_id: "team-12345678",
        ssl_url: "https://visitor-site.netlify.app",
      });
    }
    throw new Error("Unexpected Netlify API request: " + path);
  };
  try {
    const user = await netlifyAccount("browser-token-1234567890");
    assert.equal(user.teams[0].slug, "visitor-team");
    const project = await createNetlifyProject(
      "browser-token-1234567890", "local123456", "production", "visitor-team",
    );
    assert.equal(project.id, "site-12345678");
    assert.equal(project.teamId, "team-12345678");
    assert.equal(created, true);
    await assert.rejects(createNetlifyProject(
      "browser-token-1234567890", "local123456", "production", "different-team",
    ), /permission/);
  } finally { globalThis.fetch = original; }
});

test("Netlify never deploys files to a project outside the chosen team", async () => {
  const original = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/sites/site-12345678")) {
      return Response.json({
        id: "site-12345678", account_id: "other-team-87654321",
      });
    }
    uploads++;
    return Response.json({ id: "deploy-12345678" });
  };
  try {
    await assert.rejects(verifyNetlifySite(
      "browser-token-1234567890", "site-12345678", "team-12345678",
    ), /does not belong/);
    await assert.rejects(deployNetlifyZip(
      "browser-token-1234567890", "site-12345678", "team-12345678",
      new ArrayBuffer(8),
    ), /does not belong/);
    assert.equal(uploads, 0);
  } finally { globalThis.fetch = original; }
});

test("Netlify deployment includes the verified project name for the visibility settings link", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.equal(init?.redirect, "manual");
    if (path.endsWith("/sites/site-12345678")) {
      return Response.json({
        id: "site-12345678", account_id: "team-12345678",
        name: "visitor-project", ssl_url: "https://visitor-project.netlify.app",
      });
    }
    if (path.endsWith("/sites/site-12345678/deploys")) {
      assert.equal(init?.method, "POST");
      return Response.json({
        id: "deploy-12345678", state: "ready",
        deploy_ssl_url: "https://deploy-12345678--visitor-project.netlify.app",
      });
    }
    throw new Error("Unexpected Netlify API request");
  };
  try {
    const deploy = await deployNetlifyZip(
      "browser-token-1234567890", "site-12345678", "team-12345678", new ArrayBuffer(8),
    );
    assert.equal(deploy.projectName, "visitor-project");
    assert.equal(deploy.siteUrl, "https://visitor-project.netlify.app");
  } finally {
    globalThis.fetch = original;
  }
});

test("Netlify account APIs never accept arbitrary URL paths or an invalid token", async () => {
  const { netlifyApi } = await import("../lib/netlify-publish");
  await assert.rejects(netlifyApi("short", "/sites"), /Invalid Netlify access token/);
  await assert.rejects(netlifyApi("browser-token-1234567890", "//attacker.test"), /Invalid Netlify API path/);
});

test("Netlify API calls work on Workers and reject redirects without exposing a token", async () => {
  const { netlifyApi } = await import("../lib/netlify-publish");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.netlify.com/api/v1/user");
    assert.equal(init?.redirect, "manual");
    assert.equal((init?.headers as Record<string, string>)?.Authorization, "Bearer browser-token-1234567890");
    return new Response(null, {
      status: 302, headers: { Location: "https://unexpected.example/path" },
    });
  };
  try {
    await assert.rejects(netlifyApi("browser-token-1234567890", "/user"), /redirected/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
});

describe("publish-client-preconditions", () => {
const require = createRequire(new URL("../components/PublishModal.tsx", import.meta.url));
const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8");
const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
const generatedCache = new Map<string, ReturnType<typeof generateProject>>();
function cachedGenerateProject(doc: SiteDoc, target: "test" | "production" = "production") {
  const key = JSON.stringify([doc, target]);
  let cached = generatedCache.get(key);
  if (!cached) {
    cached = generateProject(doc, target);
    generatedCache.set(key, cached);
  }
  return structuredClone(cached);
}
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
    "../lib/generator": { generateProject: document ? cachedGenerateProject : () => ({ files: { "app/page.tsx": "NEW" }, binaries: asset ? { "public/p.png": "eA==" } : {}, remoteAssets: {} }) },
    "../lib/export-formats": {
      exportLimitations: () => [],
      prepareExportProject: async (_doc: SiteDoc, _options: unknown, target: "test" | "production") =>
        document ? cachedGenerateProject(_doc, target) : {
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
  // Evaluate the real shared preflight helpers against the same mocked store.
  // The helpers were moved out of PublishModal to avoid a circular UI import.
  const sharedSource = readFileSync(new URL("../components/PublishShared.tsx", import.meta.url), "utf8");
  const sharedCode = transformSync(sharedSource, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const shared = { exports: {} as any };
  new Function("require", "module", "exports", sharedCode)(
    (name: string) => name in mocks ? mocks[name] : require(name), shared, shared.exports,
  );
  mocks["./PublishShared"] = shared.exports;
  mocks["./StaticPublishModal"] = { default: () => null };
  const module = { exports: {} as any };
  const immediateTimeout = (cb: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
    queueMicrotask(() => cb(...args));
    return 0;
  };
  new Function("require", "module", "exports", "fetch", "setTimeout", code)(
    (name: string) => name in mocks ? mocks[name] : require(name),
    module,
    module.exports,
    request,
    immediateTimeout,
  );
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
    assert.ok(parseGeneratedManifest_2(commit.files[GENERATED_MANIFEST_PATH_2])!["public/sw.js"]);
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
    const next = parseGeneratedManifest_2(commit.files[GENERATED_MANIFEST_PATH_2])!;
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
    assert.equal(parseGeneratedManifest_2(commit.files[GENERATED_MANIFEST_PATH_2])!["public/sw.js"], undefined);
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
});

describe("publish-files", () => {
describe("publish-files", () => {
  test("初回の公開は既存ファイルを保持し、重なるパスの上書きを知らせる", () => {
    const plan = planPublish_2({ "app/page.tsx": "a", "notes.md": "b", ".github/workflows/ci.yml": "c" }, null, ["app/page.tsx"]);
    assert.deepEqual(plan, { edited: [], clashing: ["app/page.tsx"], kept: { "notes.md": "b", ".github/workflows/ci.yml": "c" } });
    assert.deepEqual(planPublish_2({}, null, ["app/page.tsx"]), { edited: [], clashing: [], kept: {} });
  });

  test("手で追加したファイルは残し、直接編集された書き出しファイルは知らせる", () => {
    const blobs = {
      "app/page.tsx": "edited",
      "app/layout.tsx": "same",
      "app/api/hello/route.ts": "mine",
      "_next/static/build.js": "static",
      [DOC_PATH_2]: "doc",
      "_tsumu/stray.json": "stray",
      [GENERATED_MANIFEST_PATH_3]: "list",
    };
    const generated = { "app/page.tsx": "original", "app/layout.tsx": "same", [DOC_PATH_2]: "doc" };
    const plan = planPublish_2(blobs, generated, ["app/page.tsx", "app/layout.tsx", DOC_PATH_2]);
    assert.deepEqual(plan.edited, ["app/page.tsx"]);
    assert.deepEqual(plan.clashing, []);
    assert.deepEqual(plan.kept, { "app/api/hello/route.ts": "mine", "_next/static/build.js": "static" });
    const deleted = planPublish_2({}, {
      "app/page.tsx": "page", "app/old.tsx": "retired", [DOC_PATH_2]: "doc",
    }, ["app/page.tsx", "app/new.tsx", DOC_PATH_2]);
    assert.deepEqual(deleted, { edited: ["app/page.tsx"], clashing: [], kept: {} });
  });

  test("Tsumu managed metadata is never preserved as a manually authored file", () => {
    const blobs = {
      [DOC_PATH_2]: "document",
      "_tsumu/assets.json": "assets",
      [GENERATED_MANIFEST_PATH_3]: "generated",
      "_next/static/app.js": "framework",
      "README.md": "manual",
    };
    const plan = planPublish_2(blobs, null, [DOC_PATH_2, GENERATED_MANIFEST_PATH_3]);
    assert.deepEqual(plan.kept, { "_next/static/app.js": "framework", "README.md": "manual" });
    assert.deepEqual(plan.clashing, []);
    assert.deepEqual(plan.edited, []);
  });

  test("手で追加したファイルと同じパスを書き出すときは上書きを知らせる", () => {
    const plan = planPublish_2(
      { "app/about/page.tsx": "mine", "app/page.tsx": "g" },
      { "app/page.tsx": "g" },
      ["app/page.tsx", "app/about/page.tsx"]
    );
    assert.deepEqual(plan.clashing, ["app/about/page.tsx"]);
    assert.deepEqual(plan.kept, {});
  });

  test("前回書き出して今回は書き出さないファイル（削除したページ）は残さない", () => {
    const plan = planPublish_2({ "app/old/page.tsx": "g" }, { "app/old/page.tsx": "g" }, ["app/page.tsx"]);
    assert.deepEqual(plan, { edited: [], clashing: [], kept: {} });
  });

  test("一覧は書き出して読み戻せ、壊れていれば null", () => {
    const files = { "b.ts": "2", "a.ts": "1" };
    const text = serializeGeneratedManifest_2(files);
    assert.deepEqual(Object.keys(JSON.parse(text).files), ["a.ts", "b.ts"]);
    assert.deepEqual(parseGeneratedManifest_3(text), files);
    assert.equal(parseGeneratedManifest_3("{"), null);
    assert.equal(parseGeneratedManifest_3("[]"), null);
    assert.equal(parseGeneratedManifest_3('{"files":[]}'), null);
    assert.equal(parseGeneratedManifest_3('{"files":{"a.ts":"1"}}'), null);
    assert.equal(parseGeneratedManifest_3('{"version":2,"files":{"a.ts":"1"}}'), null);
    assert.equal(parseGeneratedManifest_3('{"version":1,"files":{"../outside":"1"}}'), null);
    assert.equal(parseGeneratedManifest_3('{"version":1,"files":{"a.ts":1}}'), null);
  });

  test("コミットするパスは、リポジトリの外や別の場所を指せない", () => {
    for (const ok of ["app/page.tsx", "public/a b.png", ".well-known/security.txt",
      "_next/static/chunk.js", "_app/entry.js", "_headers", "_redirects"])
      assert.ok(isSafeCommitPath_2(ok), ok);
    for (const ng of ["", "/etc/passwd", "a/../b", "./a", "a//b", "a/", "a\\b"])
      assert.ok(!isSafeCommitPath_2(ng), ng);
  });

  test(".github/ は書き出しに使わない場所として扱う", () => {
    assert.ok(isProtectedPath_2(".github/workflows/deploy.yml"));
    assert.ok(isProtectedPath_2(".GitHub/workflows/x.yml"));
    assert.ok(!isProtectedPath_2(".githubx/a"));
    assert.ok(!isProtectedPath_2("app/.github/a"));
  });

  test("ロールバックは .github/ を戻さず、いまの先端のものを引き継ぐ", () => {
    const dir = (path: string, sha: string) => ({ path, mode: "040000", type: "tree", sha });
    const app = dir("app", "a1");
    // 同じなら置き換えない（ロールバック先のツリーをそのまま使う）
    assert.deepEqual(protectedTreeEdits([app, dir(".github", "g1")], [dir("app", "a2"), dir(".github", "g1")]), []);
    // 他のブランチやフォークのワークフローは、いまの先端のもので上書きする
    assert.deepEqual(protectedTreeEdits([app, dir(".github", "evil")], [dir(".github", "g1")]), [dir(".github", "g1")]);
    // 先端に無い .github/（大文字と小文字を変えたものも含む）は消す
    assert.deepEqual(protectedTreeEdits([app, dir(".GitHub", "evil")], []), [{ ...dir(".GitHub", "evil"), sha: null }]);
    // ロールバック先に無ければ、先端のものを加える
    assert.deepEqual(protectedTreeEdits([app], [dir(".github", "g1")]), [dir(".github", "g1")]);
  });


  test("手で追加した実行ファイル・リンク・サブモジュールの種類とモードを保持する", () => {
    const entries = [
      { path: "script.sh", mode: "100755", type: "blob", sha: "exec" },
      { path: "link", mode: "120000", type: "blob", sha: "link" },
      { path: "vendor", mode: "160000", type: "commit", sha: "submodule" },
      { path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha: "workflow" },
    ];
    const blobs = Object.fromEntries(entries.map((entry) => [entry.path, entry.sha]));
    const plan = planPublish_2(blobs, null, ["app/page.tsx"]);
    assert.deepEqual(keptTreeEntries_2(entries, Object.keys(plan.kept)), entries);
    assert.deepEqual(keptTreeEntries_2(entries, ["script.sh", "script.sh"]), [entries[0]]);
    assert.deepEqual(keptTreeEntries_2(entries, []), []);
    assert.equal(keptTreeEntries_2(entries, ["missing"]), null);
    assert.equal(keptTreeEntries_2([{ path: "dir", mode: "040000", type: "tree", sha: "dir" }], ["dir"]), null);
  });

  test("detect file/directory prefix conflicts without rejecting ordinary siblings", () => {
    assert.deepEqual(conflictingCommitPaths_2(["public/assets", "public/assets/logo.png"]), ["public/assets", "public/assets/logo.png"]);
    assert.deepEqual(conflictingCommitPaths_2(["docs/guide.md", "docs"]), ["docs", "docs/guide.md"]);
    assert.equal(conflictingCommitPaths_2(["public/a.png", "public/abc.png", "public/ab/b.png"]), null);
    assert.equal(conflictingCommitPaths_2(["src/app/page.tsx", "src/app/layout.tsx"]), null);
  });
});

describe("github-blob", () => {
  test("blob body is the same JSON GitHub would get from JSON.stringify", () => {
    for (const size of [0, 1, 2, 3, 1000, 65_537]) {
      const bytes = randomBytes(size);
      const expected = JSON.stringify({ content: bytes.toString("base64"), encoding: "base64" });
      assert.equal(gitBlobRequestBody(bytes), expected);
    }
  });

  test("blob body encodes only the viewed bytes of a subarray", () => {
    const whole = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const parsed = JSON.parse(gitBlobRequestBody(whole.subarray(2, 5)));
    assert.deepEqual([...Buffer.from(parsed.content, "base64")], [3, 4, 5]);
    assert.equal(parsed.encoding, "base64");
  });
});
});

describe("publish-generation", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
}
const options = { framework: "vue", language: "javascript", style: "tailwind" } as const;
const head = "a".repeat(40);

async function fixture(t: Parameters<typeof setup>[0], operation: "production" | "test" | "rollback") {
  const f = await setup(t);
  const oldKey = await f.create("source");
  const db = { dbConfigured: () => true, getDb: async () => f.db };
  const common = {
    "next/server": { NextResponse },
    "./i18n-server": { serverTr: async () => (value: string) => value },
    "./db": db,
  };
  const siteServer = load_2("../../lib/site-server.ts", common);
  const server = load_2("../../lib/server.ts", {
    ...common, "../auth": { authConfigured: () => false }, "./anonymous": { anonymousAllowed: () => true },
  });
  let beforeRef: (() => Promise<void>) | undefined;
  let refs = 0;
  const gh = async (path: string) => {
    if (path.startsWith("/git/ref/heads/")) return Response.json({ object: { sha: head } });
    if (path.startsWith("/git/trees/")) return Response.json({ tree: [
      { path: GENERATED_MANIFEST_PATH_4, mode: "100644", type: "blob", sha: "generated-manifest" },
    ] });
    if (path === "/git/blobs/generated-manifest") return Response.json({
      content: Buffer.from(serializeGeneratedManifest_3({})).toString("base64"), encoding: "base64",
    });
    if (path.startsWith("/git/commits/")) return Response.json({ tree: { sha: "old-tree" }, message: "Synthetic" });
    if (path === "/git/trees") return Response.json({ sha: "new-tree" });
    if (path === "/git/commits") return Response.json({ sha: "new-commit" });
    if (path.startsWith("/git/refs/heads/")) {
      await beforeRef?.();
      refs++;
      return Response.json({});
    }
    assert.fail("Unexpected synthetic GitHub path: " + path);
  };
  const target = operation === "test" ? "test" : "production";
  const conf = { repo: "synthetic/site", branch: target === "test" ? "preview" : "main", token: "synthetic" };
  const github = await import("../lib/github");
  const prefix = operation === "rollback" ? "../../../../lib/" : "../../../lib/";
  const route = load_2(operation === "rollback" ? "../../app/api/publish/history/route.ts" : "../../app/api/publish/route.ts", {
    "next/server": { NextResponse },
    [prefix + "i18n-server"]: common["./i18n-server"],
    [prefix + "db"]: db,
    [prefix + "server"]: server,
    [prefix + "site-server"]: siteServer,
    [prefix + "github"]: {
      ...github, configError: () => null,
      targetConfig: (_dest: unknown, target: string) => ({ ...conf, branch: target === "test" ? "preview" : "main" }),
      githubClient: () => ({ gh, head: async () => head, fail: () => assert.fail("Unexpected GitHub error") }),
    },
  });
  return {
    ...f, oldKey, siteServer, refs: () => refs,
    beforeRef(fn: () => Promise<void>) { beforeRef = fn; },
    send: () => route.POST(new Request("https://editor.example.test/api/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "source", target, expectedHead: head,
        expected: { site: "source", target, repo: conf.repo, branch: conf.branch, productionBranch: "main" },
        ...(operation === "rollback" ? { sha: head } : {
          action: "commit", files: { "index.html": "Synthetic" }, exportOptions: options,
        }),
      }),
    })),
  };
}

for (const operation of ["production", "test", "rollback"] as const) {
  for (const phase of ["unchanged", "ref", "activity", ...(operation === "rollback" ? [] : ["preferences"])] as const) {
    test(`${operation} bookkeeping stays with its original generation (${phase})`, async t => {
      const f = await fixture(t, operation);
      let newKey: string | undefined;
      const replace = async () => { newKey = await f.replace("source", replacement_2); };
      if (phase === "ref") f.beforeRef(replace);
      if (phase === "activity" || phase === "preferences") {
        f.hooks.beforeExecute = async stmt => {
          if (sqlOf(stmt).includes(phase === "activity" ? "INSERT INTO site_activity" : "INSERT INTO site_publish_options")) {
            f.hooks.beforeExecute = undefined;
            await replace();
          }
        };
      }
      const response = await f.send();
      assert.equal(response.status, 200);
      const responseText = await response.text();
      assert.equal(responseText.includes(f.oldKey), false);
      assert.equal(responseText.includes('"roomKey"'), false);
      const result = JSON.parse(responseText);
      assert.equal(result.ok, true);
      assert.equal(f.refs(), 1);
      const activity = await readActivity(f.rawDb, "source");
      const published = operation === "test" ? activity.lastTestPublish : activity.lastPublish;
      if (phase === "unchanged") {
        assert.ok(published);
        if (operation !== "rollback") {
          assert.equal(result.optionsSaved, true);
          assert.deepEqual(await readPublishedExportOptions(f.rawDb, "source"), options);
        }
      } else {
        assert.ok(newKey);
        assert.notEqual(newKey, f.oldKey);
        assert.deepEqual(await readPublishedExportOptions(f.rawDb, "source"), DEFAULT_PUBLISHED_EXPORT_OPTIONS_2);
        assert.equal(published, null);
        assert.deepEqual(JSON.parse(f.room(newKey).snapshot()!.body), replacement_2);
        if (operation !== "rollback" && phase !== "activity") assert.equal(result.optionsSaved, false);
      }
    });
  }
}

test("destination lookup cannot pair replacement settings with an old generation", async t => {
  const f = await fixture(t, "production");
  f.hooks.afterExecute = async stmt => {
    if (isRoomLookup(stmt, "source")) {
      f.hooks.afterExecute = undefined;
      await f.replace("source", replacement_2);
    }
  };
  const response = await f.send();
  assert.equal(response.status, 404);
  assert.equal(f.refs(), 0);
});
});

describe("publish-history", () => {
  before(() => {
    useEditor_2.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const require = createRequire(new URL("../components/PublishModal.tsx", import.meta.url));
const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8") + "\nexport { PublishHistory };";
const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
const conf = {
  site: "example", configured: true, previewEnabled: true,
  production: { repo: "example/site", branch: "main", url: null, error: null },
  test: { repo: "example/site", branch: "preview", url: null, error: null },
};
const history = (label: string) => ({ head: `${label}-head`, commits: [
  { sha: `${label}-old`, message: `${label} commit`, date: "2026-11-01T00:00:00Z", url: `https://example.com/${label}` },
] });

type Instance = { type: unknown; values: any[]; deps: unknown[][]; cleanups: (() => void)[]; alive: boolean };

// 実際のコンポーネントを実行し、フックの状態を、型・位置・key ごとに持つ。
// 通信を保留して、応答が届く順序とタブの操作を決める（外部への通信もブラウザも使わない）。
function fixture(holdWrites = false, holdConfirmation = false) {
  let branch = "main";
  let confirm: ((yes: boolean) => void) | undefined;
  const alerts: any[] = [];
  const instances = new Map<string, Instance>();
  let current: Instance;
  let cursor = 0;
  let dirty = true;
  let tree: any;
  let effects: (() => void)[] = [];
  const changed = (deps: unknown[], previous?: unknown[]) => !previous || deps.some((d, i) => !Object.is(d, previous[i]));
  const hooks = {
    ...React,
    useState(initial: any) {
      const instance = current;
      const index = cursor++;
      if (!(index in instance.values)) instance.values[index] = typeof initial === "function" ? initial() : initial;
      return [instance.values[index], (value: any) => {
        if (!instance.alive) return;
        instance.values[index] = typeof value === "function" ? value(instance.values[index]) : value;
        dirty = true;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in current.values)) current.values[index] = { current: initial };
      return current.values[index];
    },
    useCallback(fn: any, deps: unknown[]) {
      const index = cursor++;
      if (changed(deps, current.deps[index])) {
        current.values[index] = fn;
        current.deps[index] = deps;
      }
      return current.values[index];
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const instance = current;
      const index = cursor++;
      if (changed(deps, instance.deps[index])) {
        instance.deps[index] = deps;
        effects.push(() => {
          instance.cleanups[index]?.();
          instance.cleanups[index] = fn() || (() => {});
        });
      }
    },
  };
  const reads: { url: string; target: string; resolve: (data: unknown, status?: number) => void; reject: (error: Error) => void }[] = [];
  const writes: any[] = [];
  const pendingWrites: (() => void)[] = [];
  const request = (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      if (branch !== "main") return Promise.resolve(Response.json({ error: "Destination changed. Close and reopen." }, { status: 409 }));
      return holdWrites ? new Promise<Response>((resolve) => pendingWrites.push(() => resolve(Response.json({ ok: true }))))
        : Promise.resolve(Response.json({ ok: true }));
    }
    return new Promise<Response>((resolve, reject) => reads.push({
      url, target: new URL(url, "https://example.com").searchParams.get("target")!,
      resolve: (data, status = 200) => resolve(Response.json(data, { status })), reject,
    }));
  };
  const mocks: Record<string, unknown> = {
    react: hooks,
    "../lib/export-formats": {}, // 履歴のパネルは、書き出しの生成を使わない。
    "./PublishShared": { CheckList: () => null, docWithSvgFilters: async (doc: unknown) => doc },
    "./StaticPublishModal": { default: () => null },
    "./controls": { Seg: (props: any) => React.createElement("tabs", props) },
    "../lib/dialog": { showConfirm: () => holdConfirmation ? new Promise<boolean>(resolve => { confirm = resolve; }) : Promise.resolve(true), showAlert: async (...args: any[]) => { alerts.push(args); } },
    "../lib/site": {
      siteApi: (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`,
      sitePublishFields: () => ({ site: "example", ...(holdConfirmation ? { dest: { repo: "example/site", branch, previewBranch: "preview" } } : {}) }),
    },
    "../lib/i18n": { tr: (text: string) => text, getLang: () => "en" },
  };
  // 実際の、読み込み中の操作のフックを、このレンダラーのフックの枠と実際のストアで実行する。
  // レンダラーの外で React を呼ばせることはしない。
  hooks.useLayoutEffect = hooks.useEffect;
  const store = { useEditor: Object.assign((select: (state: ReturnType<typeof useEditor_2.getState>) => unknown) => select(useEditor_2.getState()), { getState: useEditor_2.getState }) };
  const pendingCode = transformSync(readFileSync(new URL("../lib/use-pending-import.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
  const pendingModule = { exports: {} as any };
  new Function("require", "module", "exports", pendingCode)(
    (name: string) => name === "react" ? hooks : name === "./store" ? store : require(name), pendingModule, pendingModule.exports,
  );
  mocks["../lib/use-pending-import"] = pendingModule.exports;
  mocks["../lib/store"] = store;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "fetch", code)(
    (name: string) => name in mocks ? mocks[name] : require(name), module, module.exports, request,
  );
  const Root = module.exports.PublishHistory;

  function render() {
    dirty = false;
    effects = [];
    const seen = new Set<string>();
    function visit(element: any, path: string): any {
      if (element == null || typeof element !== "object") return element;
      if (Array.isArray(element)) return element.map((child, i) => visit(child, `${path}.${i}`));
      if (typeof element.type === "function" && !/lucide/.test(element.type.displayName ?? "")) {
        path += `:${element.key ?? ""}`;
        seen.add(path);
        let instance = instances.get(path);
        if (!instance || instance.type !== element.type) {
          if (instance) instance.alive = false;
          instance = { type: element.type, values: [], deps: [], cleanups: [], alive: true };
          instances.set(path, instance);
        }
        current = instance;
        cursor = 0;
        return visit(element.type(element.props), `${path}.render`);
      }
      return { ...element, props: { ...element.props, children: visit(element.props?.children, `${path}.children`) } };
    }
    tree = visit(React.createElement(Root, { conf, onDone() {} }), "root");
    for (const [path, instance] of instances) {
      if (seen.has(path)) continue;
      instance.alive = false;
      instance.cleanups.forEach((cleanup) => cleanup());
      instances.delete(path);
    }
    for (const effect of effects) effect();
  }
  function flush() {
    let turns = 0;
    while (dirty) {
      assert.ok(turns++ < 20, "render must settle");
      render();
    }
  }
  function elements(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap((child) => elements(child));
    return [element, ...elements(element.props?.children)];
  }
  const text = (value: any): string => value == null || typeof value === "boolean" ? "" :
    typeof value !== "object" ? String(value) : Array.isArray(value) ? value.map(text).join("") : text(value.props?.children);
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); flush(); };
  flush();
  return {
    reads, writes, pendingWrites, settle, alerts,
    changeBranch() { branch = "release"; },
    confirm() { assert.ok(confirm); confirm(true); },
    rollbackDisabled: () => elements(tree).find((e) => e.type === "button" && text(e) === "Restore site")?.props.disabled,
    text: () => text(tree),
    select(target: string) { elements(tree).find((e) => e.type === "tabs").props.onChange(target); flush(); },
    async restore() {
      const button = elements(tree).find((e) => e.type === "button" && text(e) === "Restore edits");
      assert.ok(button, "a restore button must be present");
      button.props.onClick();
      await settle();
    },
    async rollback() {
      const button = elements(tree).find((e) => e.type === "button" && text(e) === "Restore site");
      assert.ok(button, "a rollback button must be present");
      button.props.onClick();
      await settle();
    },
  };
}

test("history tabs ignore older responses and roll back only a commit from the displayed target", async () => {
  const f = fixture();
  assert.equal(f.reads[0].target, "production");
  f.select("test");
  f.reads[1].resolve(history("test"));
  await f.settle();
  assert.match(f.text(), /test commit/);
  f.reads[0].resolve(history("production"));
  await f.settle();
  await f.rollback();
  assert.deepEqual(f.writes, [{ site: "example", target: "test", sha: "test-old", expectedHead: "test-head", expected: { site: "example", target: "test", repo: "example/site", branch: "preview", productionBranch: "main" } }]);
  assert.equal(f.reads[2].target, "test", "a successful rollback refreshes its own history");
  f.reads[2].resolve(history("updated-test"));
  await f.settle();
  assert.doesNotMatch(f.text(), /production commit/);
  assert.match(f.text(), /updated-test commit/);
});

test("rapid target changes cannot show an obsolete response from an earlier visit to the same tab", async () => {
  const f = fixture();
  f.select("test");
  f.select("production");
  assert.deepEqual(f.reads.map((r) => r.target), ["production", "test", "production"]);
  f.reads[2].resolve(history("latest-production"));
  await f.settle();
  f.reads[1].resolve(history("test"));
  f.reads[0].resolve(history("old-production"));
  await f.settle();
  assert.match(f.text(), /latest-production commit/);
  assert.doesNotMatch(f.text(), /test commit|old-production commit/);
});

test("late failures from another target do not hide the active target's history", async () => {
  const f = fixture();
  f.select("test");
  f.reads[1].resolve(history("test"));
  await f.settle();
  f.reads[0].reject(new Error("本番の履歴を読み込めませんでした"));
  await f.settle();
  assert.match(f.text(), /test commit/);
  assert.doesNotMatch(f.text(), /本番の履歴を読み込めませんでした/);
});


test("switching targets during rollback keeps every target disabled until the operation finishes", async () => {
  const f = fixture(true);
  f.reads[0].resolve(history("production"));
  await f.settle();
  await f.rollback();
  assert.equal(f.rollbackDisabled(), true);
  f.select("test");
  f.reads[1].resolve(history("test"));
  await f.settle();
  assert.equal(f.rollbackDisabled(), true);
  f.select("production");
  f.reads[2].resolve(history("new-production"));
  await f.settle();
  assert.equal(f.rollbackDisabled(), true, "remounting the original target must not unlock rollback");
  f.pendingWrites[0]();
  await f.settle();
  assert.equal(f.reads[3].target, "production");
  f.reads[3].resolve(history("old-operation-refresh"));
  await f.settle();
  assert.equal(f.rollbackDisabled(), false);
  assert.match(f.text(), /new-production commit/);
  assert.doesNotMatch(f.text(), /old-operation-refresh commit/);
});


test("rollback confirmation keeps the displayed identity and head when Home settings change", async () => {
  const f = fixture(false, true);
  const query = new URL(f.reads[0].url, "https://example.com").searchParams;
  assert.deepEqual(JSON.parse(query.get("expected")!), { site: "example", target: "production", repo: "example/site", branch: "main", productionBranch: "main" });
  f.reads[0].resolve(history("production")); await f.settle();
  await f.rollback(); assert.equal(f.writes.length, 0);
  f.changeBranch(); f.confirm(); await f.settle();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].dest.branch, "release");
  assert.equal(f.writes[0].expected.branch, "main");
  assert.equal(f.writes[0].expectedHead, "production-head");
  assert.equal(f.reads.length, 1, "a conflicted rollback is not automatically retried or refreshed into another destination");
  assert.match(f.text(), /Destination changed/);
  assert.ok(f.alerts.every(args => args[1].title !== "Rolled back"));
});


test("real pending-import cleanup prevents a previous target's delayed restore", async () => {
  const f = fixture();
  f.reads[0].resolve(history("production")); await f.settle();
  await f.restore();
  const before = useEditor_2.getState().doc;
  f.select("test");
  f.reads[2].resolve(history("test")); await f.settle();
  f.reads[1].resolve({ ...before, siteName: "Obsolete backup" }); await f.settle();
  assert.equal(useEditor_2.getState().doc, before);
  assert.match(f.text(), /test commit/);
  assert.equal(f.rollbackDisabled(), false);
  assert.deepEqual(f.alerts, []);
});
});

describe("publish-preconditions", () => {
const require = createRequire(import.meta.url);
class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
}
const old = "a".repeat(40), newer = "b".repeat(40), created = "c".repeat(40);
const expected = (target = "production", branch = target === "test" ? "preview" : "main") => ({
  site: "example", target, repo: "owner/site", branch, productionBranch: "main",
});
function fixture(options: { empty?: boolean; absent?: boolean; lateMove?: boolean; concurrentInit?: boolean; unrelatedHistory?: boolean; recordFails?: boolean; ambiguousUpdate?: boolean; truncatedRollback?: boolean; rollbackSourceMissingManual?: boolean; rollbackGeneratedFile?: boolean; rollbackSourceContainsCredentials?: boolean; rollbackSourceHasOlderManual?: boolean; rollbackSourceHasDeletedManual?: boolean; rollbackSourceHasOldGenerated?: boolean } = {}) {
  const dest = { repo: "owner/site", branch: "main", previewBranch: "preview" };
  const heads: Record<string, string> = options.empty ? {} : { main: old, ...(options.absent ? {} : { preview: old }) };
  let empty = !!options.empty;
  let recorded = 0;
  const writes: { path: string; body: any }[] = [];
  const calls: string[] = [];
  let entries = [
    { path: "manual.txt", mode: "100755", type: "blob", sha: "manual" },
    { path: files_2.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "generated-manifest" },
  ];
  if (options.rollbackGeneratedFile) {
    entries.push({ path: "app/new.ts", mode: "100644", type: "blob", sha: "generated" });
  }
  const conf = (d: typeof dest, target: string) => ({ repo: d.repo, branch: target === "test" ? d.previewBranch : d.branch, token: "fake" });
  const client = (config: ReturnType<typeof conf>) => {
    const gh = async (path: string, init?: RequestInit) => {
      calls.push(`${config.repo}:${path}`);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (body) writes.push({ path, body });
      if (path.startsWith("/git/ref/heads/")) {
        const branch = path.slice("/git/ref/heads/".length);
        return empty ? NextResponse.json({}, { status: 409 }) : heads[branch]
          ? NextResponse.json({ object: { sha: heads[branch] } }) : NextResponse.json({}, { status: 404 });
      }
      if (path === "/contents/.gitkeep") {
        empty = false; heads[body.branch] = old;
        return NextResponse.json({ commit: { sha: old } }, { status: options.concurrentInit ? 422 : 201 });
      }
      if (path === "/git/blobs") return empty ? NextResponse.json({}, { status: 409 }) : NextResponse.json({ sha: "asset" });
      if (path.startsWith("/compare/")) {
        const source = path.slice("/compare/".length).split("...")[0];
        return NextResponse.json({ merge_base_commit: { sha: options.unrelatedHistory ? "f".repeat(40) : source } });
      }
      if (path.startsWith("/git/trees/")) return NextResponse.json({
        tree: options.rollbackSourceHasDeletedManual && path.includes("old-tree")
          ? [
              { path: "manual-deleted.txt", mode: "100644", type: "blob", sha: "manual-deleted" },
              { path: files_2.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" },
            ]
          : options.rollbackSourceHasOldGenerated && path.includes("old-tree")
          ? [
              { path: "app/old.ts", mode: "100644", type: "blob", sha: "historical-generated" },
              { path: files_2.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" },
            ]
          : options.rollbackSourceContainsCredentials && path.includes("old-tree")
          ? [{ path: files_2.DOC_PATH, mode: "100644", type: "blob", sha: "historic-secret" }]
          : options.rollbackSourceHasOlderManual && path.includes("old-tree")
            ? [
                 { path: "manual.txt", mode: "100644", type: "blob", sha: "older" },
                 { path: files_2.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" },
               ]
          : options.rollbackSourceMissingManual && path.includes("old-tree")
             ? [{ path: files_2.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" }]
             : entries,
        ...(options.truncatedRollback ? { truncated: true } : {}),
      });
      if (path === "/git/blobs/historic-secret") return NextResponse.json({
        content: Buffer.from(JSON.stringify({ scripts: [{ kind: "fetch", url: "https://api.example.test/?api_key=exposed" }] })).toString("base64"),
        encoding: "base64",
      });
      if (path === "/git/blobs/historical-manifest") return NextResponse.json({
        content: Buffer.from(files_2.serializeGeneratedManifest(
          options.rollbackSourceHasOldGenerated ? { "app/old.ts": "historical-generated" } : {},
        )).toString("base64"),
        encoding: "base64",
      });
      if (path === "/git/blobs/generated-manifest") return NextResponse.json({
        content: Buffer.from(files_2.serializeGeneratedManifest({ "app/new.ts": "generated" })).toString("base64"),
        encoding: "base64",
      });
      if (path === "/git/trees") return NextResponse.json({ sha: "tree" });
      if (path === "/git/commits") return NextResponse.json({ sha: created });
      if (path.startsWith("/git/commits/")) return NextResponse.json({ tree: { sha: "old-tree" }, message: "old" });
      if (path.startsWith("/git/refs/heads/")) {
        if (options.ambiguousUpdate) { heads[config.branch] = body.sha; throw new Error("Connection reset after update"); }
        if (options.lateMove) { heads[config.branch] = newer; return NextResponse.json({}, { status: 422 }); }
        heads[config.branch] = body.sha; return NextResponse.json({});
      }
      if (path === "/git/refs") {
        if (options.lateMove) { heads[config.branch] = newer; return NextResponse.json({}, { status: 422 }); }
        heads[body.ref.slice("refs/heads/".length)] = body.sha; return NextResponse.json({});
      }
      if (path.startsWith("/commits?")) return NextResponse.json([]);
      if (path.startsWith("/contents/")) return NextResponse.json({ pages: {} });
      throw new Error(`Unexpected GitHub request ${path}`);
    };
    return { gh, fail: async (_: string, res: Response) => { throw new Error(`GitHub ${res.status}`); }, head: async () => heads[config.branch] ?? null };
  };
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse },
    "lib/i18n-server": { serverTr: async () => (s: string) => s },
    "lib/server": { requireAuth: async () => null, recordPublish: async () => { recorded++; if (options.recordFails) throw new Error("Storage unavailable"); } },
    "lib/site-access": { requireSiteAccess: async () => null },
    "lib/site-asset-access": { siteHasAsset: async () => true },
    "lib/site-server": { siteIdOf: async (site: string) => site, siteDestOf: async () => dest, destParam: () => undefined },
    "lib/github": { advanceBranchRef, targetConfig: conf, configError: () => null, githubClient: client, branchPath: (s: string) => s, previewEnabled: () => true },
    "lib/db": { dbConfigured: () => false },
    "lib/publish-provider": { publishProvider: () => "github" },
    "lib/kv": {}, "lib/errors": { userMessage: (e: Error) => e.message },
    "lib/publish-files": files_2, "lib/publish-preconditions": contract, "lib/publish-preferences": preferences, "lib/publish-security": { hasPublishCredentials, validatePublishDocument },
    "lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited },
    "lib/github-blob": { gitBlobRequestBody },
  };
  function load(path: string) {
    const code = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)((name: string) => mocks[name.replace(/^(\.\.\/)+/, "")] ?? require(name), module, module.exports);
    return module.exports;
  }
  const publish = load("app/api/publish/route.ts"), history = load("app/api/publish/history/route.ts");
  const post = (body: object, isHistory = false) => (isHistory ? history : publish).POST(new Request("https://example.com", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: "example", target: "production", expected: expected(), expectedHead: old,
      exportOptions: preferences.DEFAULT_PUBLISHED_EXPORT_OPTIONS, ...body }),
  })) as Promise<Response>;
  const get = (extra: Record<string, string> = {}) => history.GET(new Request(`https://example.com?${new URLSearchParams({ site: "example", target: "production", expected: JSON.stringify(expected()), ...extra })}`)) as Promise<Response>;
  return { post, get, rawPublish: publish.POST, rawHistory: history.POST,
    heads, dest, writes, calls, get recorded() { return recorded; }, addManual() { entries = [...entries, { path: "manual-new.txt", mode: "100644", type: "blob", sha: "new" }]; heads.main = newer; } };
}

test("every request rejects changed authoritative identity before reading or writing GitHub", async () => {
  for (const change of ["branch", "repo", "productionBranch"]) {
    const f = fixture();
    if (change === "repo") f.dest.repo = "owner/other";
    else f.dest.branch = "release";
    const target = change === "productionBranch" ? "test" : "production";
    for (const action of ["tree", "upload", "commit"]) {
      const res = await f.post({ action, target, expected: expected(target), files: { "page.txt": "page" }, path: "asset", base64: "eA==" });
      assert.equal(res.status, 409);
    }
    assert.equal((await f.post({ target, expected: expected(target), sha: old }, true)).status, 409);
    for (const doc of ["", old]) assert.equal((await f.get({ target, expected: JSON.stringify(expected(target)), ...(doc ? { doc } : {}) })).status, 409);
    assert.deepEqual(f.calls, []); assert.equal(f.recorded, 0);
  }
});

test("requests without destination or head preconditions fail closed", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "tree", expected: undefined })).status, 400);
  assert.equal((await f.post({ action: "commit", files: { "page.txt": "p" }, expectedHead: undefined })).status, 400);
  assert.equal((await f.get({ expected: "" })).status, 400);
  assert.equal((await f.post({ sha: old, expectedHead: undefined }, true)).status, 400);
  assert.deepEqual(f.writes, []);
});

test("a changed head rejects a stale kept-path plan before creating any tree", async () => {
  const f = fixture();
  const snapshot = await (await f.post({ action: "tree" })).json();
  assert.equal(snapshot.head, old);
  const plan = files_2.planPublish(snapshot.blobs, snapshot.generated, ["page.txt"]);
  f.addManual();
  assert.equal((await f.post({ action: "commit", files: { "page.txt": "p" }, expectedHead: snapshot.head, keptPaths: Object.keys(plan.kept) })).status, 409);
  assert.deepEqual(f.writes, []); assert.equal(f.recorded, 0); assert.equal(f.heads.main, newer);
  // 意図して再試行すると、新しいスナップショットを取り、新しく追加したファイルも含める。
  const fresh = await (await f.post({ action: "tree" })).json();
  const retry = await f.post({ action: "commit", files: { "page.txt": "p" }, expectedHead: fresh.head, keptPaths: Object.keys(files_2.planPublish(fresh.blobs, fresh.generated, ["page.txt"]).kept) });
  assert.equal(retry.status, 200);
  assert.ok(f.writes.find(w => w.path === "/git/trees")!.body.tree.some((e: any) => e.path === "manual-new.txt"));
});

test("late ref movement conflicts without force or recording a publish", async () => {
  for (const absent of [false, true]) {
    const f = fixture({ absent, lateMove: true });
    const target = absent ? "test" : "production";
    const res = await f.post({ action: "commit", target, expected: expected(target), expectedHead: absent ? null : old, files: { "page.txt": "p" } });
    assert.equal(res.status, 409); assert.equal(f.recorded, 0);
    assert.equal(f.heads[absent ? "preview" : "main"], newer);
    if (!absent) assert.equal(f.writes.at(-1)!.body.force, false);
  }
});

test("first publication initializes before snapshot, including test-first and concurrent preflights", async () => {
  for (const target of ["production", "test"]) for (const concurrentInit of [false, true]) {
    const f = fixture({ empty: true, concurrentInit });
    const binding = { target, expected: expected(target) };
    const snapshot = await (await f.post({ action: "tree", ...binding })).json();
    assert.equal(snapshot.head, target === "test" ? null : old);
    assert.deepEqual(f.writes.map(w => w.path), ["/contents/.gitkeep"]);
    assert.equal(f.writes[0].body.branch, "main");
    const before = { ...f.heads };
    const uploads = await Promise.all([1, 2, 3, 4].map(i => f.post({ action: "upload", ...binding, path: `asset${i}`, base64: "eA==" })));
    assert.ok(uploads.every(r => r.status === 200)); assert.deepEqual(f.heads, before);
    const res = await f.post({ action: "commit", ...binding, expectedHead: snapshot.head, files: { "page.txt": "p" } });
    assert.equal(res.status, 200); assert.equal(f.recorded, 1);
    if (target === "test") assert.equal(f.heads.main, old);
    assert.equal(f.heads[target === "test" ? "preview" : "main"], created);
  }
});

test("uploads never initialize an empty repository and commit cannot bypass snapshot initialization", async () => {
  const f = fixture({ empty: true });
  assert.equal((await f.post({ action: "upload", path: "asset", base64: "eA==" })).status, 502);
  assert.equal((await f.post({ action: "commit", files: { "page.txt": "p" }, expectedHead: null })).status, 409);
  assert.deepEqual(f.writes.map(w => w.path), ["/git/blobs"]); assert.deepEqual(f.heads, {});
});

test("absent branch snapshot stays null and rejects a branch created before commit", async () => {
  const f = fixture({ absent: true });
  const binding = { target: "test", expected: expected("test") };
  const snapshot = await (await f.post({ action: "tree", ...binding })).json();
  assert.equal(snapshot.head, null); assert.deepEqual(f.writes, []);
  f.heads.preview = newer;
  assert.equal((await f.post({ action: "commit", ...binding, expectedHead: null, files: { "page.txt": "p" } })).status, 409);
  assert.deepEqual(f.writes, []);
});

test("rollback rejects both stale displayed heads and late movement without recording success", async () => {
  const stale = fixture(); stale.heads.main = newer;
  assert.equal((await stale.post({ sha: old }, true)).status, 409); assert.deepEqual(stale.writes, []);
  const late = fixture({ lateMove: true });
  assert.equal((await late.post({ sha: old }, true)).status, 409);
  assert.equal(late.writes.at(-1)!.body.force, false); assert.equal(late.recorded, 0);
});

test("history list and its rollback precondition use the same captured head", async () => {
  const f = fixture();
  const res = await f.get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal((await res.json()).head, old);
  assert.ok(f.calls.includes(`owner/site:/commits?sha=${old}&per_page=30`));
  assert.ok(!f.calls.some(path => path.includes("sha=main")));
});

test("restore cannot read editable data from an unrelated Git history", async () => {
  const f = fixture({ unrelatedHistory: true });
  const sha = "e".repeat(40);
  const response = await f.get({ doc: sha });
  assert.equal(response.status, 404);
  assert.ok(!f.calls.some(path => path.includes("/contents/")));
});

test("rollback rejects a valid commit SHA outside the selected branch ancestry", async () => {
  const f = fixture({ unrelatedHistory: true });
  const response = await f.post({ sha: "e".repeat(40) }, true);
  assert.equal(response.status, 404);
  assert.deepEqual(f.writes, []);
  assert.equal(f.recorded, 0);
});

test("an ancestor is eligible for history restore and rollback", async () => {
  const f = fixture();
  const sha = "e".repeat(40);
  const docResponse = await f.get({ doc: sha });
  assert.equal(docResponse.status, 200);
  assert.equal(docResponse.headers.get("cache-control"), "private, no-store");
  assert.equal((await f.post({ sha }, true)).status, 200);
  assert.ok(f.calls.some(path => path.includes(`/compare/${sha}...${old}`)));
});

test("a successful Git branch update remains successful when bookkeeping fails", async () => {
  for (const rollback of [false, true]) {
    const f = fixture({ recordFails: true });
    const response = await f.post(rollback ? { sha: old } : { action: "commit", files: { "page.txt": "page" } }, rollback);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).commit, created);
    assert.equal(f.heads.main, created);
    assert.equal(f.recorded, 1);
  }
});

test("connection loss after a successful ref update is reconciled instead of inviting a duplicate retry", async () => {
  for (const rollback of [false, true]) {
    const f = fixture({ ambiguousUpdate: true });
    const response = await f.post(rollback ? { sha: old } : { action: "commit", files: { "page.txt": "page" } }, rollback);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).commit, created);
    assert.equal(f.heads.main, created);
    assert.equal(f.recorded, 1);
  }
});

test("rollback refuses a truncated GitHub tree before writing a replacement commit", async () => {
  const f = fixture({ truncatedRollback: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 502);
  assert.deepEqual(f.writes, []);
  assert.equal(f.recorded, 0);
});

test("rollback preserves manually added files that are absent from the chosen historical tree", async () => {
  const f = fixture({ rollbackSourceMissingManual: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 200);
  const update = f.writes.find(item => item.path === "/git/trees");
  assert.ok(update, "rollback must overlay manually retained files over the historic tree");
  assert.equal(update.body.base_tree, "old-tree");
  assert.deepEqual(update.body.tree.find((e: any) => e.path === "manual.txt"),
    { path: "manual.txt", mode: "100755", type: "blob", sha: "manual" });
});

test("rollback removes generated files that are absent from history but retains current manual files", async () => {
  const f = fixture({ rollbackSourceMissingManual: true, rollbackGeneratedFile: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 200);
  const updated = f.writes.find(item => item.path === "/git/trees");
  assert.ok(updated);
  assert.ok(updated.body.tree.some((entry: any) => entry.path === "manual.txt"));
  assert.ok(!updated.body.tree.some((entry: any) => entry.path === "app/new.ts" || entry.path === files_2.GENERATED_MANIFEST_PATH));
});

test("rollback cannot reactivate a historical document containing embedded API credentials", async () => {
  const f = fixture({ rollbackSourceContainsCredentials: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /credentials|API key/i);
  assert.deepEqual(f.writes, []);
  assert.equal(f.recorded, 0);
});

test("rollback keeps a manually maintained file when the older tree has another version at the same path", async () => {
  const f = fixture({ rollbackSourceHasOlderManual: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 200);
  const update = f.writes.find(item => item.path === "/git/trees");
  assert.ok(update);
  assert.deepEqual(update.body.tree.find((entry: any) => entry.path === "manual.txt"),
    { path: "manual.txt", mode: "100755", type: "blob", sha: "manual" });
});

test("rollback keeps a manually deleted historical file absent from current tree deleted", async () => {
  const f = fixture({ rollbackSourceHasDeletedManual: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 200);
  const tree = f.writes.find(write => write.path === "/git/trees");
  assert.ok(tree);
  assert.deepEqual(tree.body.tree.find((item: any) => item.path === "manual-deleted.txt"), {
    path: "manual-deleted.txt", mode: "100644", type: "blob", sha: null,
  });
  assert.ok(tree.body.tree.some((item: any) => item.path === "manual.txt" && item.sha === "manual"));
});

test("rollback restores older generated files even when current publication removed them", async () => {
  const f = fixture({ rollbackSourceHasOldGenerated: true });
  const response = await f.post({ sha: old }, true);
  assert.equal(response.status, 200);
  const tree = f.writes.find(write => write.path === "/git/trees");
  assert.ok(tree);
  assert.ok(!tree.body.tree.some((item: any) => item.path === "app/old.ts" && item.sha === null));
  assert.ok(tree.body.tree.some((item: any) => item.path === "manual.txt" && item.sha === "manual"));
});


test("publish and rollback reject oversized, invalid MIME and malformed POST data before GitHub calls", async () => {
  const f = fixture();
  for (const [handler, limit] of [[f.rawPublish, 48 * 1024 * 1024], [f.rawHistory, 128 * 1024]] as const) {
    const request = (body: string, headers: Record<string, string>) => new Request("https://example.test/api/publish", {
      method: "POST", body, headers,
    });
    const oversized = await handler(request("{}", {
      "Content-Type": "application/json", "Content-Length": String(limit + 1),
    }));
    assert.equal(oversized.status, 413);
    const wrongMime = await handler(request("{}", { "Content-Type": "text/plain" }));
    assert.equal(wrongMime.status, 415);
    const bad = await handler(request("{bad", { "Content-Type": "application/json" }));
    assert.equal(bad.status, 400);
  }
  assert.deepEqual(f.writes, []);
});
});

describe("publish-preferences", () => {
const site = (name: string) => ({
  name, repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
});

async function withDatabase(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join_2(tmpdir(), "tsumu-publish-options-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "alpha", site("Alpha"));
    await insertSite(db, "beta", site("Beta"));
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("saved GitHub output formats persist per site in SQLite and are not part of SiteDoc", async () => withDatabase(async db => {
  const vue = { framework: "vue", language: "javascript", style: "tailwind" } as const;
  const html = { framework: "html", language: "javascript", style: "css" } as const;
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), DEFAULT_PUBLISHED_EXPORT_OPTIONS_3);
  assert.equal(await savePublishedExportOptions(db, "alpha", vue), true);
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), vue);
  assert.deepEqual(await readPublishedExportOptions(db, "beta"), DEFAULT_PUBLISHED_EXPORT_OPTIONS_3);
  assert.equal(await savePublishedExportOptions(db, "beta", html), true);
  assert.deepEqual(await readPublishedExportOptions(db, "beta"), html);
  assert.equal(await savePublishedExportOptions(db, "alpha", html), true);
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), html);
  const rows = await db.execute("SELECT site_id, framework, language, style FROM site_publish_options ORDER BY site_id");
  assert.deepEqual(rows.rows.map(row => ({ ...row })), [
    { site_id: "alpha", framework: "html", language: "javascript", style: "css" },
    { site_id: "beta", framework: "html", language: "javascript", style: "css" },
  ]);
}));

test("deletion removes persisted formats, and delayed writes cannot resurrect a removed site", async () => withDatabase(async db => {
  const selected = { framework: "nuxt", language: "typescript", style: "css-modules" } as const;
  assert.equal(await savePublishedExportOptions(db, "alpha", selected), true);
  await deleteSite(db, "alpha");
  assert.equal(await savePublishedExportOptions(db, "alpha", selected), false);
  const rows = await db.execute("SELECT COUNT(*) AS n FROM site_publish_options WHERE site_id='alpha'");
  assert.equal(rows.rows[0].n, 0);
  assert.deepEqual(await readPublishedExportOptions(db, "alpha"), DEFAULT_PUBLISHED_EXPORT_OPTIONS_3);
}));

test("invalid and incompatible published format settings cannot be accepted", () => {
  assert.deepEqual(parsePublishedExportOptions({ framework: "sveltekit", language: "typescript", style: "css" }),
    { framework: "sveltekit", language: "typescript", style: "css" });
  for (const options of [
    null, [], {}, { framework: "__proto__", language: "typescript", style: "css" },
    { framework: "html", language: "typescript", style: "css" },
    { framework: "single-html", language: "javascript", style: "css-modules" },
    { framework: "vue", language: "python", style: "css" },
  ]) assert.equal(parsePublishedExportOptions(options), null);
});
});

describe("publish-redirect-self-loops", () => {
const require = createRequire(import.meta.url);
// Next.js の実際のルーターと同じ条件で、書き出した規則を判定する。
// エディタの本体からは、Next.js の内部のモジュールを読み込まない。
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
const { modifyRouteRegex } = require("next/dist/lib/redirect-status");
const { prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination");
const { formatUrl } = require("next/dist/shared/lib/router/utils/format-url");
const { normalizeRepeatedSlashes } = require("next/dist/shared/lib/utils");

type Redirect = { source: string; destination: string; statusCode: number };
function matcher(rule: Redirect) {
  return getPathMatch(rule.source, {
    strict: true,
    removeUnnamedParams: true,
    sensitive: false,
    regexModifier: (regex: string) => modifyRouteRegex(regex, ["/_next"]),
  });
}

function fixture(slug: string, redirectTo: string) {
  const doc = createInitialDoc();
  if (slug.replace(/^\/+|\/+$/g, "") === "") {
    const home = doc.pageOrder.find(id => doc.pages[id].slug === "")!;
    Object.assign(doc.pages[home], { name: "Old URL", redirectTo });
  } else {
    doc.pages.old = { id: "old", name: "Old URL", slug, redirectTo, title: "", description: "", children: [] };
    doc.pageOrder.push("old");
  }
  return doc;
}
const errors = (doc: ReturnType<typeof fixture>) => runChecks_2(doc).filter(c => c.level === "error");
async function redirects(doc: ReturnType<typeof fixture>): Promise<Redirect[]> {
  const config = generateProject(doc).files["next.config.mjs"];
  return new Function(config.replace("export default nextConfig;", "return nextConfig;"))().redirects();
}

// クエリと # は、pathname の判定に関係しない。転送をくり返して、実際のループを確かめる。
function assertLoops(rule: Redirect, initialPath: string) {
  let url = new URL(initialPath, "https://site.example");
  for (let i = 0; i < 3; i++) {
    const params = matcher(rule)(url.pathname);
    assert.notEqual(params, false, `${rule.source} must still match ${url.pathname}`);
    const { parsedDestination } = prepareDestination({
      destination: rule.destination, params,
      query: Object.fromEntries(url.searchParams), appendParamsToQuery: false,
    });
    parsedDestination.pathname = normalizeRepeatedSlashes(parsedDestination.pathname);
    url = new URL(formatUrl({ ...parsedDestination, search: undefined }), url);
  }
}

for (const [slug, destination, request] of [
  ["About", "/about", "/About"],
  ["about", "/about", "/about"],
  ["/Docs/Team/", " /docs/team/ ", "/Docs/Team"],
  ["About", "/about?tab=new#details", "/About?tab=old"],
  ["About", "/ABOUT/#details", "/about"],
  ["Docs/Team", "/docs//team//?tab=new", "/Docs/Team"],
  ["_Old-123", "/_old-123/", "/_Old-123"],
  ["", "/?lang=en#top", "/"],
  ["Blog/[slug]", "/blog/new?from=old#top", "/Blog/old"],
  ["Blog/[slug]", "/blog/:slug/?tab=new#top", "/Blog/Article"],
  ["[slug]/Details", "/:slug/details", "/Article/Details"],
  ["[slug]", "/:slug", "/article"],
] as const) {
  test(`preflight blocks self-matching redirect ${slug || "/"} → ${destination}`, async () => {
    const doc = fixture(slug, destination);
    const before = structuredClone(doc);
    const [rule] = await redirects(doc);
    assertLoops(rule, request);
    const checks = errors(doc);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].help, "page-redirect");
    assert.match(checks[0].message, /Old URL/);
    assert.ok(checks[0].message.includes(destination.trim()));
    assert.match(checks[0].message, /redirect loop/);
    assert.deepEqual(doc, before, "checks and generation preserve the saved URL and destination");
  });
}

test("a case-only redirect cannot hide the real lower-case page at publication", async () => {
  const doc = fixture("About", "/about");
  doc.pages.about = { id: "about", name: "About us", slug: "about", title: "About us", description: "", children: [] };
  doc.pageOrder.push("about");
  assert.ok(generateProject(doc).files["app/about/page.tsx"]);
  assertLoops((await redirects(doc))[0], "/about");
  assert.equal(errors(doc).length, 1);
});

for (const [slug, destination, request] of [
  ["old-about", "/about?from=old#team", "/old-about"],
  ["About", "/about-us", "/About"],
  ["About", "/about/team", "/About"],
  ["K", "/K", "/K"],
  ["old/[slug]", "/new/:slug", "/old/article"],
  ["old/[slug]", "/old", "/old/article"],
  // 1回だけ再び一致しても、その次で別の URL へ移るものは拒否しない。
  ["[slug]/a", "/b/:slug", "/a/a"],
  ["About", "https://other.example/about", "/About"],
] as const) {
  test(`ordinary redirect remains valid: ${slug} → ${destination}`, async () => {
    const doc = fixture(slug, destination);
    assert.deepEqual(errors(doc), []);
    const [rule] = await redirects(doc);
    assert.deepEqual(rule, { source: `/${slug.replace("[slug]", ":slug")}`, destination, statusCode: 301 });
    let url = new URL(request, "https://site.example");
    for (let i = 0; i < 3; i++) {
      const params = matcher(rule)(url.pathname);
      if (params === false || url.origin !== "https://site.example") return;
      const { parsedDestination } = prepareDestination({ destination: rule.destination, params, query: {}, appendParamsToQuery: false });
      url = new URL(formatUrl({ ...parsedDestination, search: undefined }), url);
    }
    assert.fail("ordinary redirect must leave the source rule");
  });
}

test("Next's protected /_next paths are not self-matching custom redirects", async () => {
  for (const [slug, target] of [["_next/file", "/_next/file"], ["[slug]", "/_NEXTish"]]) {
    const doc = fixture(slug, target);
    assert.equal(matcher((await redirects(doc))[0])(target), false);
    assert.deepEqual(errors(doc), []);
  }
});

test("draft redirects, proxy pages, and distinct case-sensitive normal pages stay valid", () => {
  const doc = fixture("About", "/about");
  doc.pages.old.unpublished = true;
  assert.deepEqual(errors(doc), []);
  assert.equal(generateProject(doc).files["next.config.mjs"].includes("async redirects"), false);
  doc.pages.old.unpublished = false;
  delete doc.pages.old.redirectTo;
  doc.pages.old.rewriteTo = "https://other.example/About";
  assert.deepEqual(errors(doc), []);
  delete doc.pages.old.rewriteTo;
  doc.pages.about = { id: "about", name: "Lower case", slug: "about", title: "", description: "", children: [] };
  doc.pageOrder.push("about");
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  assert.ok(files["app/About/page.tsx"]);
  assert.ok(files["app/about/page.tsx"]);
});

test("the self-loop error has an English translation with the page and destination", async () => {
  const error = errors(fixture("About", "/about"))[0];
  assert.ok(error);
  // runChecks の日本語の文から辞書のキーに戻し、実際の翻訳の経路を通す。
  const key = error.message.replace("Old URL", "{name}").replace("/about", "{destination}");
  const translated = translate_2(await loadDicts("en"), key, { name: "Old URL", destination: "/about" });
  assert.match(translated, /Old URL/);
  assert.match(translated, /\/about/);
  assert.match(translated, /redirect loop/);
  assert.match(translated, /different path/);
});

// Next.js は、pageOrder の先頭から転送を探す。候補の規則だけでなく、その順序も実行する。
function traceRedirects(rules: Redirect[], initialPath: string) {
  let url = new URL(initialPath, "https://site.example");
  const seen = new Set<string>();
  const paths: string[] = [];
  for (let i = 0; i < 10; i++) {
    paths.push(url.pathname);
    if (seen.has(url.href)) return { loop: true, paths };
    seen.add(url.href);
    if (url.origin !== "https://site.example") return { loop: false, paths };
    const rule = rules.find(rule => matcher(rule)(url.pathname) !== false);
    if (!rule) return { loop: false, paths };
    const { parsedDestination } = prepareDestination({
      destination: rule.destination, params: matcher(rule)(url.pathname),
      query: Object.fromEntries(url.searchParams), appendParamsToQuery: false,
    });
    parsedDestination.pathname = normalizeRepeatedSlashes(parsedDestination.pathname);
    url = new URL(formatUrl({ ...parsedDestination, search: undefined }), url);
  }
  assert.fail("the ordered redirect fixture must terminate or repeat a URL");
}

for (const [source, target, firstSource, firstTarget, request, expectedPaths] of [
  ["blog/[slug]", "/blog/new", "blog/new", "/archive/new", "/blog/article", ["/blog/article", "/blog/new", "/archive/new"]],
  ["About", "/about", "about", "/archive/about", "/About", ["/About", "/archive/about"]],
  ["About", "/about", "[slug]", "/archive/:slug", "/About", ["/About", "/archive/About"]],
  ["Blog/[slug]", "/blog/:slug", "blog/[slug]", "/archive/:slug", "/Blog/article", ["/Blog/article", "/archive/article"]],
] as const) {
  test(`earlier ${firstSource} escape takes precedence over ${source} → ${target}`, async () => {
    const doc = fixture(source, target);
    doc.pages.escape = { id: "escape", name: "Escape", slug: firstSource, redirectTo: firstTarget, title: "", description: "", children: [] };
    doc.pageOrder.splice(doc.pageOrder.indexOf("old"), 0, "escape");
    assert.deepEqual(traceRedirects(await redirects(doc), request), { loop: false, paths: [...expectedPaths] });
    assert.deepEqual(errors(doc), []);

    doc.pageOrder = doc.pageOrder.filter(id => id !== "escape");
    doc.pageOrder.push("escape");
    assert.equal(traceRedirects(await redirects(doc), request).loop, true, "a later escape cannot override the first matching rule");
    assert.equal(errors(doc).length, 1);
    assert.match(errors(doc)[0].message, /Old URL/);
  });
}

test("unpublished redirects and rewrites do not shadow a redirect", () => {
  for (const patch of [{ redirectTo: "/archive/new", unpublished: true }, { rewriteTo: "https://other.example/blog/new" }]) {
    const doc = fixture("blog/[slug]", "/blog/new");
    doc.pages.escape = { id: "escape", name: "Escape", slug: "blog/new", title: "", description: "", children: [], ...patch };
    doc.pageOrder.unshift("escape");
    assert.equal(errors(doc).length, 1);
    assert.match(errors(doc)[0].message, /Old URL/);
  }
});

test("earlier disjoint redirects do not conceal deterministic loops", () => {
  const doc = fixture("blog/[slug]", "/blog/new");
  doc.pages.escape = { id: "escape", name: "Escape", slug: "other/[slug]", redirectTo: "/archive/:slug", title: "", description: "", children: [] };
  doc.pageOrder.unshift("escape");
  assert.equal(errors(doc).length, 1);
});

test("partially intercepted parameter targets are conservatively left undecided", async () => {
  const doc = fixture("Blog/[slug]", "/blog/:slug");
  doc.pages.escape = { id: "escape", name: "Escape", slug: "blog/new", redirectTo: "/archive/new", title: "", description: "", children: [] };
  doc.pageOrder.unshift("escape");
  const rules = await redirects(doc);
  assert.equal(traceRedirects(rules, "/Blog/new").loop, false);
  assert.equal(traceRedirects(rules, "/Blog/other").loop, true);
  // 一部の変数の値だけを遮る先の規則がある場合、すべての値について安全かは判定しない。
  assert.deepEqual(errors(doc), []);
});
});

describe("publish-rollback", () => {
// 実際のロールバック・スナップショット・公開のハンドラーの間で Git のオブジェクトを保ち、
// 次の公開でファイルを削除するだけの所有のエラーも見えるようにする。
function fixture(target: "production" | "test", manual: files_3.TreeEntry, historicalSha: string,
  options: { historicalManual?: files_3.TreeEntry; extraManual?: files_3.TreeEntry[];
    historicalExtra?: files_3.TreeEntry[]; historicalGenerated?: Record<string, string>;
    failTreeAt?: number; failCommit?: boolean; ambiguousUpdate?: boolean;
    lateMove?: boolean; noSourceManifest?: boolean } = {}) {
  const { historicalManual } = options;
  const branch = target === "test" ? "preview" : "main";
  const expected = { site: "site", target, repo: "owner/site", branch, productionBranch: "main" };
  const blobs = new Map<string, string>();
  const trees = new Map<string, files_3.TreeEntry[]>();
  const commits = new Map<string, { tree: { sha: string }; message: string; parents: string[] }>();
  const sha = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex");
  const blob = (path: string, content: string): files_3.TreeEntry => {
    const id = sha(content);
    blobs.set(id, content);
    return { path, mode: "100644", type: "blob", sha: id };
  };
  const saveTree = (entries: files_3.TreeEntry[]) => {
    assert.equal(files_3.conflictingCommitPaths(entries.map(entry => entry.path)), null);
    const id = sha(entries);
    trees.set(id, entries);
    return id;
  };
  // 再帰的な取得にはディレクトリも含め、保護した部分木の置き換えも再現する。
  const recursiveTree = (entries: files_3.TreeEntry[]) => {
    const directories = new Set<string>();
    for (const entry of entries) {
      for (let slash = entry.path.indexOf("/"); slash !== -1; slash = entry.path.indexOf("/", slash + 1)) {
        directories.add(entry.path.slice(0, slash));
      }
    }
    return [...entries, ...[...directories].map(path => ({
      path, mode: "040000", type: "tree",
      sha: saveTree(entries.filter(entry => entry.path.startsWith(`${path}/`))
        .map(entry => ({ ...entry, path: entry.path.slice(path.length + 1) }))),
    }))];
  };
  const saveCommit = (tree: string, parents: string[] = []) => {
    const value = { tree: { sha: tree }, message: "Publish", parents };
    const id = sha(value);
    commits.set(id, value);
    return id;
  };
  const generated = { path: "old-page.html", mode: "100644", type: "blob", sha: "generated-page" };
  const oldManifest = files_3.serializeGeneratedManifest({
    ...(!historicalManual ? { [manual.path]: historicalSha } : {}), [generated.path]: generated.sha,
    ...options.historicalGenerated,
  });
  const source = saveCommit(saveTree([
    historicalManual ?? { ...manual, mode: "100644", type: "blob", sha: historicalSha }, generated,
    ...(options.historicalExtra ?? []),
    ...(!options.noSourceManifest ? [blob(files_3.GENERATED_MANIFEST_PATH, oldManifest)] : []),
  ]));
  let head = saveCommit(saveTree([manual, ...(options.extraManual ?? []), blob(files_3.GENERATED_MANIFEST_PATH, files_3.serializeGeneratedManifest({}))]), [source]);
  const refs: string[] = [];
  let commitWrites = 0, recorded = 0;
  const treeWrites: { base_tree?: string; tree: files_3.TreeEntry[] }[] = [];
  const gh = async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === `/git/ref/heads/${branch}`) return Response.json({ object: { sha: head } });
    if (path === `/compare/${source}...${head}`) return Response.json({ merge_base_commit: { sha: source } });
    if (path.startsWith("/git/commits/")) {
      const value = commits.get(path.slice("/git/commits/".length));
      assert.ok(value);
      return Response.json(value);
    }
    if (path.startsWith("/git/trees/")) {
      const id = path.slice("/git/trees/".length).split("?")[0];
      const tree = trees.get(commits.get(id)?.tree.sha ?? id);
      assert.ok(tree);
      return Response.json({ tree: recursiveTree(tree) });
    }
    if (path.startsWith("/git/blobs/")) {
      const text = blobs.get(path.slice("/git/blobs/".length));
      assert.notEqual(text, undefined);
      return Response.json({ encoding: "base64", content: Buffer.from(text!).toString("base64") });
    }
    if (path === "/git/blobs") {
      assert.equal(body.encoding, "base64");
      return Response.json({ sha: blob("uploaded", Buffer.from(body.content, "base64").toString("utf8")).sha });
    }
    if (path === "/git/trees") {
      treeWrites.push(body);
      if (options.failTreeAt === treeWrites.length) return Response.json({}, { status: 503 });
      // 同じリクエストの中の親のパスと子のパスは、削除を含めても重ねない。
      assert.equal(files_3.conflictingCommitPaths(body.tree.map((entry: files_3.TreeEntry) => entry.path)), null);
      const result = new Map((body.base_tree ? trees.get(body.base_tree)! : []).map(e => [e.path, e]));
      for (const entry of body.tree) {
        const replaced = [...result.keys()].filter(path => path === entry.path || path.startsWith(`${entry.path}/`));
        // GitHub は、存在しないパスの削除を拒否する。
        if (entry.sha === null) assert.ok(replaced.length, `cannot delete missing path ${entry.path}`);
        for (const path of replaced) result.delete(path);
        if (entry.sha === null) continue;
        if (entry.type === "tree") {
          const subtree = trees.get(entry.sha);
          assert.ok(subtree, `unknown subtree ${entry.sha}`);
          for (const child of subtree) result.set(`${entry.path}/${child.path}`, { ...child, path: `${entry.path}/${child.path}` });
        } else result.set(entry.path, entry.content !== undefined ? blob(entry.path, entry.content) : entry);
      }
      return Response.json({ sha: saveTree([...result.values()]) });
    }
    if (path === "/git/commits") {
      commitWrites++;
      if (options.failCommit) return Response.json({}, { status: 503 });
      return Response.json({ sha: saveCommit(body.tree, body.parents) });
    }
    if (path === `/git/refs/heads/${branch}`) {
      assert.equal(body.force, false);
      assert.deepEqual(commits.get(body.sha)?.parents, [head]);
      if (options.lateMove) {
        head = saveCommit(commits.get(head)!.tree.sha, [head]);
        return Response.json({}, { status: 422 });
      }
      refs.push(path);
      head = body.sha;
      if (options.ambiguousUpdate) throw new Error("connection lost after ref update");
      return Response.json({});
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  class NextResponse extends Response {
    static json(value: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(value), init); }
  }
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse },
    "lib/i18n-server": { serverTr: async () => (s: string) => s },
    "lib/server": { requireAuth: async () => null, recordPublish: async () => { recorded++; } },
    "lib/site-access": { requireSiteAccess: async () => null },
    "lib/site-asset-access": { siteHasAsset: async () => true },
    "lib/site-server": { siteIdOf: async () => "site", siteDestOf: async () => ({}) },
    "lib/github": {
      advanceBranchRef, branchPath: (s: string) => s, configError: () => null,
      targetConfig: (_: unknown, t: string) => ({ repo: expected.repo, branch: t === "test" ? "preview" : "main", token: "fake" }),
      githubClient: () => ({ gh, head: async () => head, fail: async () => { throw new Error("GitHub failure"); } }),
    },
    "lib/db": { dbConfigured: () => false },
    "lib/publish-provider": { publishProvider: () => "github" },
    "lib/kv": {}, "lib/errors": { userMessage: (e: Error) => e.message },
    "lib/publish-files": files_3, "lib/publish-preconditions": preconditions, "lib/publish-preferences": preferences, "lib/publish-security": { hasPublishCredentials, validatePublishDocument },
    "lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited },
    "lib/github-blob": { gitBlobRequestBody },
  };
  const load = (path: string) => {
    const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)((name: string) => {
      const key = name.replace(/^(\.\.\/)+/, "");
      assert.ok(Object.hasOwn(mocks, key), name);
      return mocks[key];
    }, module, module.exports);
    return module.exports.POST as (req: Request) => Promise<Response>;
  };
  const rollback = load("../app/api/publish/history/route.ts");
  const publish = load("../app/api/publish/route.ts");
  return {
    source, refs, oldManifest, treeWrites,
    get currentHead() { return head; }, get commitWrites() { return commitWrites; }, get recorded() { return recorded; },
    sourceManifest: () => blobs.get(trees.get(commits.get(source)!.tree.sha)!.find(e => e.path === files_3.GENERATED_MANIFEST_PATH)!.sha!),
    entries: () => trees.get(commits.get(head)!.tree.sha)!,
    send: (body: object, history = false) => (history ? rollback : publish)(new Request("https://example.test", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: "site", target, expected, expectedHead: head,
         exportOptions: preferences.DEFAULT_PUBLISHED_EXPORT_OPTIONS, ...body }),
    })),
  };
}

for (const target of ["production", "test"] as const) {
  for (const [path, mode, type, historicalSha] of [
    ["manual.sh", "100755", "blob", "historical"],
    ["manual-link", "120000", "blob", "historical"],
    ["manual-module", "160000", "commit", "historical"],
    ["__proto__", "100644", "blob", "manual"],
  ]) {
    test(`${target}: rollback and subsequent publish preserve manual ownership of ${path}`, async () => {
      const manual = { path, mode, type, sha: "manual" };
      const f = fixture(target, manual, historicalSha);
      const rollback = await f.send({ sha: f.source }, true);
      assert.equal(rollback.status, 200, await rollback.text());
      assert.deepEqual(f.entries().find(e => e.path === path), manual);

      // 実際の次の事前確認と、サーバー側でファイルを残す処理を動かす。
      const preflight = await f.send({ action: "tree" });
      assert.equal(preflight.status, 200);
      const snapshot = await preflight.json();
      const publication = await f.send({
        action: "commit", keptPaths: [],
        files: { "new-page.html": "new", [files_3.GENERATED_MANIFEST_PATH]: files_3.serializeGeneratedManifest({ "new-page.html": "new" }) },
      });
      assert.equal(publication.status, 200, await publication.text());
      assert.deepEqual(f.entries().find(e => e.path === path), manual, "the next publish must not delete the retained manual file");
      assert.equal(f.entries().some(e => e.path === "old-page.html"), false, "obsolete generated files must still be removed");
      assert.deepEqual(snapshot.generated, { "old-page.html": "generated-page" });
      assert.equal(f.sourceManifest(), f.oldManifest, "historical manifest remains immutable");
      assert.deepEqual(f.refs, Array(2).fill(`/git/refs/heads/${target === "test" ? "preview" : "main"}`));
    });
  }
}


for (const target of ["production", "test"] as const) {
  for (const [oldPath, oldMode, oldType, path, mode, type] of [
    ["manual", "100644", "blob", "manual/info.md", "100755", "blob"],
    ["manual/info.md", "100644", "blob", "manual", "120000", "blob"],
    ["manual/info.md", "100644", "blob", "manual", "160000", "commit"],
    ["manual", "160000", "commit", "manual/info.md", "100644", "blob"],
  ]) {
    test(`${target}: rollback preserves a manual path converted from ${oldMode} ${oldPath} to ${mode} ${path}`, async () => {
      const historical = { path: oldPath, mode: oldMode, type: oldType, sha: "old-manual" };
      const manual = { path, mode, type, sha: "current-manual" };
      const extraManual = [
        { path: "notes/current.txt", mode: "100755", type: "blob", sha: "unrelated" },
        { path: ".github", mode: "120000", type: "blob", sha: "protected" },
      ];
      const f = fixture(target, manual, "unused", { historicalManual: historical, extraManual });
      const response = await f.send({ sha: f.source }, true);
      assert.equal(response.status, 200, await response.text());
      assert.equal(f.entries().some(entry => entry.path === oldPath), false);
      assert.deepEqual(f.entries().find(entry => entry.path === path), manual);
      for (const entry of extraManual) assert.deepEqual(f.entries().find(item => item.path === entry.path), entry);
      assert.ok(f.entries().some(entry => entry.path === "old-page.html"), "restore the historical generated site");
      assert.equal(files_3.conflictingCommitPaths(f.entries().map(entry => entry.path)), null);
      assert.equal(f.treeWrites.length, 2, "prune the deleted historical manual path before its replacement");
      assert.deepEqual(f.treeWrites[0].tree, [{ ...historical, sha: null }]);
      const next = await f.send({ action: "commit", files: {
        "new-page.html": "new",
        [files_3.GENERATED_MANIFEST_PATH]: files_3.serializeGeneratedManifest({ "new-page.html": "new" }),
      } });
      assert.equal(next.status, 200, await next.text());
      assert.deepEqual(f.entries().find(entry => entry.path === path), manual);
      for (const entry of extraManual) assert.deepEqual(f.entries().find(item => item.path === entry.path), entry);
      assert.equal(f.entries().some(entry => entry.path === oldPath || entry.path === "old-page.html"), false);
      assert.equal(f.sourceManifest(), f.oldManifest, "the historical tree is immutable");
      assert.equal(f.refs.length, 2, "each operation advances the branch only after its tree is complete");
    });
  }
}


for (const failTreeAt of [1, 2]) {
  test(`rollback leaves the branch unchanged when manual-path tree operation ${failTreeAt} fails`, async () => {
    const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
    const f = fixture("production", manual, "unused", {
      historicalManual: { ...manual, path: "manual", sha: "old-manual" }, failTreeAt,
    });
    const before = f.currentHead;
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 502);
    assert.equal(f.currentHead, before);
    assert.equal(f.treeWrites.length, failTreeAt);
    assert.equal(f.commitWrites, 0);
    assert.equal(f.recorded, 0);
    assert.deepEqual(f.refs, []);
  });
}

test("a concurrent commit still rejects rollback after both manual-path tree operations", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const f = fixture("test", manual, "unused", {
    historicalManual: { ...manual, path: "manual", sha: "old-manual" }, lateMove: true,
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 409);
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.recorded, 0);
  assert.deepEqual(f.refs, []);
  assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
});

test("rollback refuses generated-path conflicts and histories without a generated manifest", async () => {
  for (const missingManifest of [false, true]) {
    const manual = { path: `${missingManifest ? "manual" : "old-page.html"}/readme`, mode: "100644", type: "blob", sha: "manual" };
    const f = fixture("production", manual, "unused", {
      historicalManual: { ...manual, path: "manual", sha: "old-manual" }, noSourceManifest: missingManifest,
    });
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 409);
    assert.deepEqual(f.treeWrites, []);
    assert.equal(f.commitWrites, 0);
    assert.equal(f.recorded, 0);
    assert.deepEqual(f.refs, []);
  }
});

test("rollback preserves siblings and protected subtrees through mixed nested path conversions", async () => {
  const manual = { path: "nested/to-directory/readme", mode: "100644", type: "blob", sha: "current" };
  const stable = { path: "nested/stable.txt", mode: "100755", type: "blob", sha: "unchanged" };
  const historicalGenerated = { path: "nested/site.html", mode: "100644", type: "blob", sha: "site" };
  const extraManual = [
    { path: "nested/to-directory/deep/tool.sh", mode: "100755", type: "blob", sha: "tool" },
    { path: "nested/to-file", mode: "120000", type: "blob", sha: "link" },
    stable,
    { path: ".github/workflows/current.yml", mode: "100644", type: "blob", sha: "current-workflow" },
    { path: ".github/CODEOWNERS", mode: "100644", type: "blob", sha: "owners" },
  ];
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "nested/to-directory", sha: "old" },
    historicalExtra: [
      { ...manual, path: "nested/to-file/one", sha: "old-one" },
      { ...manual, path: "nested/to-file/deep/two", sha: "old-two" },
      { ...manual, path: ".github/workflows/old.yml", sha: "old-workflow" },
      stable, historicalGenerated,
    ],
    historicalGenerated: { [historicalGenerated.path]: historicalGenerated.sha }, extraManual,
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 200, await response.text());
  for (const entry of [manual, ...extraManual, historicalGenerated]) {
    assert.deepEqual(f.entries().find(item => item.path === entry.path), entry);
  }
  assert.equal(f.entries().some(entry => entry.sha?.startsWith("old-")), false);
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.recorded, 1);
  assert.equal(f.refs.length, 1);
  assert.equal(f.treeWrites[0].tree.length, 3);
  assert.ok(f.treeWrites[0].tree.every(entry => entry.sha === null && entry.path.startsWith("nested/to-")));
  assert.deepEqual(f.treeWrites[1].tree.filter(entry => files_3.isProtectedPath(entry.path)).map(entry => entry.path), [".github"]);
  assert.equal(f.treeWrites[1].tree.some(entry => entry.path === stable.path), false);
});

test("rollback preserves protected file and directory conversions while pruning manual paths", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const protectedFile = { path: ".github", mode: "120000", type: "blob", sha: "link" };
  const protectedChild = { path: ".github/workflows/current.yml", mode: "100644", type: "blob", sha: "workflow" };
  for (const [historical, current] of [[protectedFile, protectedChild], [protectedChild, protectedFile]]) {
    const f = fixture("test", manual, "unused", {
      historicalManual: { ...manual, path: "manual", sha: "old" },
      historicalExtra: [historical], extraManual: [current],
    });
    const response = await f.send({ sha: f.source }, true);
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(f.entries().filter(entry => files_3.isProtectedPath(entry.path)), [current]);
    assert.equal(f.treeWrites.length, 2);
    assert.equal(f.commitWrites, 1);
    assert.equal(f.refs.length, 1);
  }
});

test("rollback refuses to replace a directory with any retained historical generated descendants", async () => {
  const manual = { path: "manual", mode: "120000", type: "blob", sha: "current" };
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "manual/deleted.txt", mode: "100644", sha: "deleted" },
    historicalExtra: [{ ...manual, path: "manual/generated.html", mode: "100644", sha: "generated" }],
    historicalGenerated: { "manual/generated.html": "generated" },
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 409);
  assert.deepEqual(f.treeWrites, []);
  assert.equal(f.commitWrites, 0);
  assert.deepEqual(f.refs, []);
});

test("commit creation failure after pruning and overlay leaves the branch unchanged", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "manual", sha: "old" }, failCommit: true,
  });
  const before = f.currentHead;
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 502);
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.currentHead, before);
  assert.equal(f.recorded, 0);
  assert.deepEqual(f.refs, []);
});

test("a lost final ref response after both tree writes is verified without a duplicate rollback", async () => {
  const manual = { path: "manual/readme", mode: "100644", type: "blob", sha: "manual" };
  const f = fixture("production", manual, "unused", {
    historicalManual: { ...manual, path: "manual", sha: "old" }, ambiguousUpdate: true,
  });
  const response = await f.send({ sha: f.source }, true);
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.treeWrites.length, 2);
  assert.equal(f.commitWrites, 1);
  assert.equal(f.refs.length, 1);
  assert.equal(f.recorded, 1);
  assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
});

for (const target of ["production", "test"] as const) {
  for (const transport of ["inline", "blob"] as const) {
    test(`${target}: ${transport} generated manifest cannot claim a retained manual file`, async () => {
      const manual = { path: "manual.sh", mode: "100755", type: "blob", sha: "manual" };
      const f = fixture(target, manual, "old");
      const before = f.currentHead;
      const manifest = files_3.serializeGeneratedManifest({ "page.html": "page", [manual.path]: manual.sha });
      const output: Record<string, string> = { "page.html": "page" };
      const assetShas: Record<string, string> = {};
      if (transport === "inline") {
        output[files_3.GENERATED_MANIFEST_PATH] = manifest;
      } else {
        const upload = await f.send({ action: "upload", path: files_3.GENERATED_MANIFEST_PATH,
          base64: Buffer.from(manifest).toString("base64") });
        assert.equal(upload.status, 200);
        assetShas[files_3.GENERATED_MANIFEST_PATH] = (await upload.json()).sha;
      }
      const response = await f.send({ action: "commit", files: output, assetShas, keptPaths: [manual.path] });
      assert.equal(response.status, 400, "ownership metadata must not turn a retained file into generated output");
      assert.equal(f.currentHead, before);
      assert.deepEqual(f.treeWrites, []);
      assert.equal(f.commitWrites, 0);
      assert.equal(f.recorded, 0);
      assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);

      // 一覧を正しく直してから、2回公開する。手動で追加したファイルは両方のコミットで残り、
      // 1回目で書き出したものは取り除かれなければならない。
      const validManifest = files_3.serializeGeneratedManifest({ "page.html": "page" });
      if (transport === "inline") {
        output[files_3.GENERATED_MANIFEST_PATH] = validManifest;
      } else {
        const upload = await f.send({ action: "upload", path: files_3.GENERATED_MANIFEST_PATH,
          base64: Buffer.from(validManifest).toString("base64") });
        assert.equal(upload.status, 200);
        assetShas[files_3.GENERATED_MANIFEST_PATH] = (await upload.json()).sha;
      }
      const first = await f.send({ action: "commit", files: output, assetShas });
      assert.equal(first.status, 200, await first.text());
      const second = await f.send({ action: "commit", files: {
        "next.html": "next",
        [files_3.GENERATED_MANIFEST_PATH]: files_3.serializeGeneratedManifest({ "next.html": "next" }),
      } });
      assert.equal(second.status, 200, await second.text());
      assert.deepEqual(f.entries().find(entry => entry.path === manual.path), manual);
      assert.equal(f.entries().some(entry => entry.path === "page.html"), false);
      assert.equal(f.refs.length, 2);
    });
  }
}

test("publication rejects malformed manifests and claims outside its own output keys", async () => {
  const invalid = ["{", JSON.stringify({ version: 2, files: {} }),
    ...["missing.html", "toString", "__proto__"].map(path =>
      files_3.serializeGeneratedManifest(Object.fromEntries([[path, "unwritten"]])))];
  for (const manifest of invalid) {
    const f = fixture("production", { path: "manual.sh", mode: "100755", type: "blob", sha: "manual" }, "old");
    const response = await f.send({ action: "commit", files: {
      "page.html": "page", [files_3.GENERATED_MANIFEST_PATH]: manifest,
    } });
    assert.equal(response.status, 400, manifest);
    assert.deepEqual(f.treeWrites, []);
    assert.equal(f.commitWrites, 0);
    assert.equal(f.recorded, 0);
  }
});

test("a manifest may own inline and uploaded output, including an own prototype-named path", async () => {
  const f = fixture("production", { path: "manual.sh", mode: "100755", type: "blob", sha: "manual" }, "old");
  const upload = await f.send({ action: "upload", path: "asset.txt", base64: Buffer.from("asset").toString("base64") });
  assert.equal(upload.status, 200);
  const assetSha = (await upload.json()).sha;
  const response = await f.send({ action: "commit", files: {
    "page.html": "page", ["__proto__"]: "page data",
    [files_3.GENERATED_MANIFEST_PATH]: files_3.serializeGeneratedManifest({
      "page.html": "page", ["__proto__"]: "data", "asset.txt": assetSha,
    }),
  }, assetShas: { "asset.txt": assetSha } });
  assert.equal(response.status, 200, await response.text());
  assert.ok(f.entries().some(entry => entry.path === "__proto__"));
  assert.equal(f.entries().find(entry => entry.path === "asset.txt")?.sha, assetSha);
  assert.equal(f.entries().find(entry => entry.path === "manual.sh")?.sha, "manual");
});
});

describe("publish-route", () => {
const HEAD_SHA = "1".repeat(40);
const WORKFLOW_SHA = "2".repeat(40);
const SECRET_DOC_SHA = "3".repeat(40);
const OTHER_BLOB_SHA = "4".repeat(40);

// 外部とは通信せずに、公開の API が GitHub に渡すツリーを確かめる。
function fixture(truncated?: boolean, manifestText?: string, documentBlob?: string,
  storedAssets: Record<string, Uint8Array> = {}, dbMode = false, ownedAssets?: Set<string>) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  const entries = [
    { path: "script.sh", mode: "100755", type: "blob", sha: "exec" },
    { path: "link", mode: "120000", type: "blob", sha: "link" },
    { path: "vendor", mode: "160000", type: "commit", sha: "submodule" },
    { path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha: WORKFLOW_SHA },
  ];
  const trees: { tree: helpers.TreeEntry[]; base_tree?: string }[] = [];
  const treeSnapshots = new Map<string, Map<string, helpers.TreeEntry>>();
  const commitTrees: string[] = [];
  const writes: string[] = [];
  const refUpdates: { sha: string; force: boolean }[] = [];
  const uploaded: { content: string; encoding: string }[] = [];
  const kvReads: string[] = [];
  let recorded = false;
  let treeRejection: { body: object; headers?: Record<string, string>; when?: (items: helpers.TreeEntry[]) => boolean } | null = null;
  const gh = async (path: string, options: { body?: string } = {}) => {
    if (options.body) writes.push(path);
    if (path.startsWith("/git/ref/heads/")) return NextResponse.json({ object: { sha: HEAD_SHA } });
    if (path.startsWith("/git/trees/")) return NextResponse.json({ tree: entries, truncated });
    if (path.startsWith("/git/blobs/")) return NextResponse.json({
      encoding: "base64", content: Buffer.from(path.endsWith(`/${SECRET_DOC_SHA}`) ? documentBlob ?? "" : manifestText ?? "").toString("base64"),
    });
    if (path === "/git/blobs") {
      uploaded.push(JSON.parse(options.body!));
      return NextResponse.json({ sha: "uploaded-blob" });
    }
    if (path === "/git/trees") {
      const request = JSON.parse(options.body!) as { tree: helpers.TreeEntry[]; base_tree?: string };
      trees.push(request);
      if (treeRejection && (!treeRejection.when || treeRejection.when(request.tree))) {
        return NextResponse.json(treeRejection.body, { status: 422, headers: treeRejection.headers });
      }
      const sha = treeRejection?.when ? `tree-${trees.length}` : "new-tree";
      const snapshot = new Map(request.base_tree ? treeSnapshots.get(request.base_tree) : []);
      for (const entry of request.tree) snapshot.set(entry.path, entry);
      treeSnapshots.set(sha, snapshot);
      return NextResponse.json({ sha });
    }
    if (path === "/git/commits") {
      commitTrees.push(JSON.parse(options.body!).tree);
      return NextResponse.json({ sha: "new-commit" });
    }
    if (path.startsWith("/git/refs/heads/")) refUpdates.push(JSON.parse(options.body!));
    return NextResponse.json({});
  };
  const injected = {
    JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited, gitBlobRequestBody,
    matchesPublishTarget: preconditions.matchesPublishTarget,
    publishConflictMessage: preconditions.publishConflictMessage,
    GENERATED_MANIFEST_PATH: helpers.GENERATED_MANIFEST_PATH,
    ASSET_MANIFEST_PATH: helpers.ASSET_MANIFEST_PATH,
    isSafeCommitPath: helpers.isSafeCommitPath,
    conflictingCommitPaths: helpers.conflictingCommitPaths,
    isProtectedPath: helpers.isProtectedPath,
    parseGeneratedManifest: helpers.parseGeneratedManifest,
    DOC_PATH: helpers.DOC_PATH,
    hasPublishCredentials,
    validatePublishDocument,
    parsePublishedExportOptions,
    planPublish: helpers.planPublish,
    keptTreeEntries: helpers.keptTreeEntries,
    NextResponse,
    publishProvider: () => "github",
    serverTr: async () => (message: string, vars?: Record<string, string | number>) =>
      message.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => vars?.[key] === undefined ? match : String(vars[key])),
    requireAuth: async () => null, requireSiteAccess: async () => null,
    siteIdOf: async () => "site",
    siteDestOf: async () => ({}),
    configError: () => null,
    targetConfig: () => ({ repo: "test/site", branch: "main", token: "fake" }),
    githubClient: () => ({ gh, fail: () => { throw new Error("Unexpected GitHub error"); } }),
    toBranchPath: (path: string) => path,
    advanceBranchRef,
    recordPublish: async () => { recorded = true; },
    dbConfigured: () => dbMode,
    getDb: async () => ({}),
    siteHasAsset: async (_db: unknown, _siteId: string, source: string) => ownedAssets ? ownedAssets.has(source) : true,
    assetStore: () => ({ get: async (source: string) => { kvReads.push(source); return storedAssets[source] ?? null; } }),
    userMessage: (error: Error) => error.message,
  };
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/publish/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^export /gm, "");
  const post = new Function(...Object.keys(injected), `${source}\nreturn POST;`)(...Object.values(injected)) as (req: Request) => Promise<Response>;
  const send = (body: object) => post(new Request("https://example.com/api/publish", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected: { site: "site", target: "production", repo: "test/site", branch: "main", productionBranch: "main" }, expectedHead: HEAD_SHA, exportOptions: { framework: "nextjs", language: "typescript", style: "css" }, ...body, site: "site", target: "production" }),
  }));
  return {
    entries, trees, treeSnapshots, commitTrees, writes, refUpdates, uploaded, kvReads, send,
    rejectTree(body: object, headers?: Record<string, string>) { treeRejection = { body, headers }; },
    rejectTreeWhen(body: object, when: (items: helpers.TreeEntry[]) => boolean) { treeRejection = { body, when }; },
    get recorded() { return recorded; },
  };
}

test("公開 API は手で追加した Git の項目をモード・種類ごと保持する", async () => {
  const { entries, trees, send } = fixture();
  const current = await (await send({ action: "tree" })).json();
  assert.equal(current.blobs.vendor, "submodule");
  const plan = helpers.planPublish(current.blobs, current.generated, ["app/page.tsx"]);
  const response = await send({ action: "commit", files: { "app/page.tsx": "export default function Page() {}" }, keptPaths: Object.keys(plan.kept) });
  assert.equal(response.status, 200);
  assert.deepEqual(trees[0].tree.slice(1), entries);
});

test("保持する項目は先端に存在する安全なパスに限る", async () => {
  for (const keptPaths of [["missing"], ["../outside"], [7]]) {
    const { trees, send } = fixture();
    const response = await send({ action: "commit", files: { "app/page.tsx": "page" }, keptPaths });
    assert.equal(response.status, 400);
    assert.equal(trees.length, 0);
  }
});


test("既存の保持項目はテキスト・アセットの書き出しと重複させない", async () => {
  const overlapping = [
    { files: { "app/page.tsx": "page", "script.sh": "replacement" } },
    { files: { "app/page.tsx": "page" }, assetShas: { "script.sh": OTHER_BLOB_SHA } },
  ];
  for (const output of overlapping) {
    const { trees, send } = fixture();
    const response = await send({ action: "commit", ...output, keptPaths: ["script.sh"] });
    assert.equal(response.status, 400);
    assert.equal(trees.length, 0);
  }
});


test("a truncated snapshot is rejected before a destructive replacement can be planned", async () => {
  const f = fixture(true);
  const response = await f.send({ action: "tree" });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /complete file list/i);
  assert.equal(body.blobs, undefined);
  assert.deepEqual(f.writes, []);
  assert.equal(f.recorded, false);
});

test("a truncated commit-time tree is rejected even when requested entries are present", async () => {
  for (const retained of [
    { keptPaths: ["script.sh", "vendor"] },
    { assetShas: { ".github/workflows/ci.yml": WORKFLOW_SHA } },
  ]) {
    const f = fixture(true);
    const response = await f.send({ action: "commit", files: { "app/page.tsx": "page" }, ...retained });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /complete file list/i);
    assert.deepEqual(f.writes, []);
    assert.equal(f.recorded, false);
  }
});

test("a complete tree still publishes with editor priority", async () => {
  const f = fixture(false);
  const snapshot = await f.send({ action: "tree" });
  assert.equal(snapshot.status, 200);
  const response = await f.send({ action: "commit", files: { "app/page.tsx": "page" }, keptPaths: ["script.sh"] });
  assert.equal(response.status, 200);
  assert.equal(f.recorded, true);
  assert.deepEqual(f.refUpdates, [{ sha: "new-commit", force: false }]);
});

test("commits cannot omit protected files or replace their Git mode through a blob SHA", async () => {
  for (const useSha of [false, true]) {
    const f = fixture();
    const protectedEntry = f.entries.find(entry => entry.path.startsWith(".github/"))!;
    protectedEntry.mode = "100755";
    const response = await f.send({
      action: "commit", files: { "app/page.tsx": "page" },
      ...(useSha ? { assetShas: { [protectedEntry.path]: protectedEntry.sha } } : {}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(f.trees[0].tree.filter(e => e.path === protectedEntry.path), [protectedEntry]);
  }
});

test("snapshot and publication retain manual filenames that match object prototype keys", async () => {
  const f = fixture();
  f.entries.push({ path: "__proto__", sha: "manual", mode: "100644", type: "blob" });
  const snapshot = await (await f.send({ action: "tree" })).json();
  assert.equal(Object.hasOwn(snapshot.blobs, "__proto__"), true);
  const plan = helpers.planPublish(snapshot.blobs, snapshot.generated, ["app/page.tsx"]);
  assert.equal(Object.hasOwn(plan.kept, "__proto__"), true);
  const response = await f.send({ action: "commit", files: { "app/page.tsx": "page" }, keptPaths: Object.keys(plan.kept) });
  assert.equal(response.status, 200);
  assert.ok(f.trees[0].tree.some(e => e.path === "__proto__" && e.sha === "manual"));
});

test("an existing path that cannot be represented safely prevents tree replacement", async () => {
  const f = fixture();
  f.entries.push({ path: "notes\\meeting.txt", sha: "manual", mode: "100644", type: "blob" });
  for (const action of ["tree", "commit"]) {
    const response = await f.send({ action, files: { "app/page.tsx": "page" } });
    assert.notEqual(response.status, 200);
  }
  assert.deepEqual(f.writes, []);
});

test("incomplete keptPaths cannot silently remove existing manual files", async () => {
  const f = fixture();
  const res = await f.send({ action: "commit", files: { "app/page.tsx": "page" }, keptPaths: [] });
  assert.equal(res.status, 200);
  const written = f.trees.flatMap(chunk => chunk.tree);
  for (const original of f.entries) {
    assert.deepEqual(written.find(entry => entry.path === original.path), original, original.path);
  }
});

test("the same path cannot be supplied as both text and an asset SHA", async () => {
  const f = fixture();
  const res = await f.send({
    action: "commit",
    files: { "app/page.tsx": "text" },
    assetShas: { "app/page.tsx": OTHER_BLOB_SHA },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(f.writes, []);
});

test("commit reconstructs manual retention from the previous generated manifest", async () => {
  const older = helpers.serializeGeneratedManifest({ "app/obsolete.ts": "original" });
  const f = fixture(false, older);
  f.entries.push(
    { path: helpers.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "manifest-blob" },
    { path: "app/obsolete.ts", mode: "100644", type: "blob", sha: "original" },
    { path: "README.md", mode: "100644", type: "blob", sha: "manual" }
  );
  const response = await f.send({
    action: "commit",
    files: {
      "app/page.tsx": "updated",
      [helpers.GENERATED_MANIFEST_PATH]: helpers.serializeGeneratedManifest({ "app/page.tsx": "updated" }),
    },
    keptPaths: [],
  });
  assert.equal(response.status, 200);
  const output = f.trees.flatMap(chunk => chunk.tree);
  assert.equal(output.some(entry => entry.path === "app/obsolete.ts"), false, "obsolete generated files are removed");
  assert.equal(output.some(entry => entry.path === "README.md"), true, "manual files survive an incomplete client plan");
});

test("malformed previous generated manifest stops destructive replacement", async () => {
  const f = fixture(false, '{"version":1,"files":{"../outside":"not-safe"}}');
  f.entries.push({ path: helpers.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "broken-blob" });
  const response = await f.send({ action: "commit", files: { "app/page.tsx": "page" }, keptPaths: [] });
  assert.equal(response.status, 502);
  assert.deepEqual(f.writes, []);
});

test("client keep hints cannot resurrect obsolete editor-generated files", async () => {
  const older = helpers.serializeGeneratedManifest({ "app/obsolete.ts": "original" });
  const f = fixture(false, older);
  f.entries.push(
    { path: helpers.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "manifest-blob" },
    { path: "app/obsolete.ts", mode: "100644", type: "blob", sha: "original" }
  );
  const response = await f.send({
    action: "commit", files: { "app/page.tsx": "updated" },
    keptPaths: ["app/obsolete.ts"],
  });
  assert.equal(response.status, 409);
  assert.deepEqual(f.writes, []);
});

test("a manual symlink that is an ancestor of generated files cannot be silently overwritten", async () => {
  const f = fixture();
  f.entries.push({ path: "public/assets", mode: "120000", type: "blob", sha: "symlink" });
  const response = await f.send({
    action: "commit",
    files: { "public/assets/logo.svg": "<svg/>" },
    keptPaths: ["public/assets"],
  });
  assert.equal(response.status, 400);
  assert.deepEqual(f.writes, []);
});

test("a generated file cannot silently replace a directory containing manual files", async () => {
  const f = fixture();
  f.entries.push({ path: "docs/README.md", mode: "100644", type: "blob", sha: "readme" });
  const response = await f.send({ action: "commit", files: { docs: "new content" }, keptPaths: ["docs/README.md"] });
  assert.equal(response.status, 400);
  assert.deepEqual(f.writes, []);
});

test("two generated paths cannot overlap in a file/descendant relationship", async () => {
  const f = fixture();
  const response = await f.send({ action: "commit", files: { "config": "file", "config/settings.json": "{}" } });
  assert.equal(response.status, 400);
  assert.deepEqual(f.writes, []);
});

test("commit blocks embedded fetch credentials even when a crafted API call bypasses the UI check", async () => {
  const f = fixture();
  const document = JSON.stringify({ pageScripts: [{ steps: [
    { kind: "fetch", url: "https://api.example.test/search?api_key=credential" },
  ] }] });
  const response = await f.send({
    action: "commit",
    files: { "app/page.tsx": "page", [helpers.DOC_PATH]: document },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /credentials/i);
  assert.deepEqual(f.writes, []);
});

test("commit checks credentials in a previously uploaded doc.json blob as well", async () => {
  const document = JSON.stringify({ pages: { p: { pageScripts: [{
    steps: [{ kind: "fetch", headers: [{ name: "Authorization", value: "Bearer credential" }] }],
  }] } } });
  const f = fixture(false, undefined, document);
  const response = await f.send({
    action: "commit",
    files: { "app/page.tsx": "page" },
    assetShas: { [helpers.DOC_PATH]: SECRET_DOC_SHA },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /credentials/i);
  assert.deepEqual(f.writes, []);
});

test("commit rejects malformed editable JSON and accepts benign data", async () => {
  const invalid = fixture();
  const denied = await invalid.send({
    action: "commit", files: { [helpers.DOC_PATH]: "{broken" },
  });
  assert.equal(denied.status, 400);
  assert.deepEqual(invalid.writes, []);

  const permitted = fixture();
  const ok = await permitted.send({
    action: "commit", files: { [helpers.DOC_PATH]: JSON.stringify({ siteName: "Public", pages: {} }) },
  });
  assert.equal(ok.status, 200);
});

test("editable document uploads reject credentials before sending any bytes to GitHub", async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  t.mock.method(console, "warn", (...args: unknown[]) => { logs.push(args); });
  const secret = "upload-credential-must-stay-local";
  const document = Buffer.from(JSON.stringify({ pages: { private: { pageScripts: [{
    steps: [{ kind: "fetch", url: "https://api.example.test/", headers: [
      { name: "Authorization", value: `Bearer ${secret}` },
    ] }],
  }] } } }));
  for (const payload of [{ base64: document.toString("base64") }, { source: "assets/document.json" }]) {
    const f = fixture(false, undefined, undefined, { "assets/document.json": document });
    const response = await f.send({ action: "upload", path: helpers.DOC_PATH, ...payload });
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /credentials/i);
    assert.ok(!text.includes(secret));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.uploaded, []);
    assert.equal(f.recorded, false);
  }
  assert.deepEqual(logs, []);
});

test("editable document uploads reject malformed JSON, invalid UTF-8 and oversized documents locally", async () => {
  const limit = 12 * 1024 * 1024;
  const cases = [
    { bytes: Buffer.from("{broken"), error: /editor data file|format|invalid/i },
    { bytes: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), error: /editor data file|format|invalid/i },
    { bytes: Buffer.from(JSON.stringify({ text: "あ".repeat(limit / 3) })), error: /too large|size limit|too big/i },
  ];
  for (const { bytes, error } of cases) {
    for (const payload of [{ base64: bytes.toString("base64") }, { source: "assets/document.json" }]) {
      const f = fixture(false, undefined, undefined, { "assets/document.json": bytes });
      const response = await f.send({ action: "upload", path: helpers.DOC_PATH, ...payload });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, error);
      assert.deepEqual(f.writes, []);
    }
  }
});

test("safe editable uploads and ordinary binary assets retain their exact bytes", async () => {
  // クライアントがそのまま送る大きさの上限を超える文書は、この別のアップロードの経路を使う。
  const document = Buffer.from(JSON.stringify({ siteName: "Publish", text: "x".repeat(512 * 1024), scripts: [
    { kind: "fetch", url: "https://api.example.test/?api_key=%7Bkey%7D" },
  ] }));
  for (const [path, bytes] of [
    [helpers.DOC_PATH, document], ["public/assets/icon.bin", Buffer.from([0, 255, 1, 128])],
  ] as const) {
    for (const payload of [{ base64: bytes.toString("base64") }, { source: "assets/input" }]) {
      const f = fixture(false, undefined, undefined, { "assets/input": bytes });
      const response = await f.send({ action: "upload", path, ...payload });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, path, sha: "uploaded-blob" });
      assert.deepEqual(f.uploaded, [{ content: bytes.toString("base64"), encoding: "base64" }]);
      assert.deepEqual(f.writes, ["/git/blobs"]);
    }
  }
});

test("upload requires a string path and exactly one string content source before any GitHub write", async () => {
  for (const payload of [
    {}, { base64: "eA==", source: "assets/input" },
    { base64: null }, { base64: { content: "credential" } },
    { source: null }, { source: ["assets/input"] },
    { path: 42, base64: "eA==" }, { path: "", base64: "eA==" },
  ]) {
    const f = fixture();
    const response = await f.send({ action: "upload", path: helpers.DOC_PATH, ...payload });
    assert.equal(response.status, 400);
    assert.deepEqual(f.writes, []);
  }
});

test("invalid format preferences reject a GitHub commit without changing its branch", async () => {
  for (const exportOptions of [
    null, {}, { framework: "bogus", language: "typescript", style: "css" },
    { framework: "html", language: "typescript", style: "css" },
    { framework: "html", language: "javascript", style: "tailwind" },
  ]) {
    const f = fixture();
    const response = await f.send({ action: "commit", files: { "index.html": "example" }, exportOptions });
    assert.equal(response.status, 400);
    assert.deepEqual(f.writes, []);
    assert.equal(f.recorded, false);
  }
});

test("publication rejects padded credential headers before any remote write", async () => {
  const document = JSON.stringify({ pages: { p: { pageScripts: [{ steps: [{
    kind: "fetch", url: "https://public.example/data",
    headers: [{ name: " \tAuthorization ", value: "Bearer synthetic-credential" }],
  }] }] } } });
  for (const payload of [
    { action: "commit", files: { [helpers.DOC_PATH]: document } },
    { action: "commit", files: { "app/page.tsx": "page" }, assetShas: { [helpers.DOC_PATH]: SECRET_DOC_SHA } },
    { action: "upload", path: helpers.DOC_PATH, base64: Buffer.from(document).toString("base64") },
  ]) {
    const f = fixture(false, undefined, document);
    const response = await f.send(payload);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /credentials/i);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.uploaded, []);
  }
});


test("GitHub 422 reports an offending tree entry without reflecting raw API content", async () => {
  const f = fixture();
  f.rejectTree({
    message: "Validation Failed: secret pasted into an upstream error",
    errors: [{ resource: "Tree", field: "tree", code: "invalid", index: 0, message: "secret pasted into an upstream error" }],
  });
  const response = await f.send({ action: "commit", files: { "app/page.tsx": "page" } });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.ok(body.error.includes("app/page.tsx"));
  assert.deepEqual(body.treeError, { kind: "validation", path: "app/page.tsx", batch: 1, total: 1 });
  assert.doesNotMatch(body.error, /secret pasted/i);
  assert.equal(f.trees.length, 1);
  assert.deepEqual(f.refUpdates, []);
  assert.equal(f.recorded, false);
});

test("GitHub 422 invalid blob SHA is linked to its own path, not upstream prose", async () => {
  const f = fixture();
  const sha = "d".repeat(40);
  f.rejectTree({ message: `tree.sha ${sha} is not a valid blob` });
  const response = await f.send({
    action: "commit",
    files: { "app/page.tsx": "page" },
    assetShas: { "public/assets/image.png": sha },
  });
  assert.equal(response.status, 422);
  const data = await response.json();
  assert.ok(data.error.includes("public/assets/image.png"));
  assert.equal(data.treeError.path, "public/assets/image.png");
  assert.deepEqual(f.refUpdates, []);
});

test("GitHub tree abuse throttling is not misreported as a bad file", async () => {
  const f = fixture();
  f.rejectTree({
    message: "You have triggered an abuse detection mechanism",
    errors: [],
  }, { "Retry-After": "60" });
  const response = await f.send({ action: "commit", files: { "index.html": "<h1>hello</h1>" } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  const data = await response.json();
  assert.match(data.error, /temporarily limiting publishing requests/);
  assert.deepEqual(data.treeError, { kind: "rate-limit", path: null, batch: 1, total: 1 });
  assert.deepEqual(f.refUpdates, []);
});

test("unrecognized GitHub 422 errors report the tree batch without revealing untrusted prose", async () => {
  const f = fixture();
  f.rejectTree({ message: "Unrecognized payload with sensitive user data" });
  const response = await f.send({ action: "commit", files: { "index.html": "<h1>hello</h1>" } });
  assert.equal(response.status, 422);
  const message = (await response.json()).error;
  assert.match(message, /batch 1 of 1/);
  assert.doesNotMatch(message, /sensitive user data/);
  assert.deepEqual(f.refUpdates, []);
});


test("generic 422 validation is subdivided and succeeds without losing a single file", async () => {
  const f = fixture();
  // Simulate a remote per-request batch limit. An ordinary 9-entry tree is
  // rejected, but the same entries are accepted in smaller tree operations.
  f.rejectTreeWhen({ message: "Validation Failed", errors: [] }, items => items.length > 2);
  const response = await f.send({ action: "commit", files: {
    "a.txt": "a", "b.txt": "b", "c.txt": "c", "d.txt": "d", "e.txt": "e",
  } });
  assert.equal(response.status, 200);
  assert.ok(f.trees.length > 1);
  assert.equal(f.commitTrees.length, 1);
  const result = f.treeSnapshots.get(f.commitTrees[0]);
  assert.ok(result, "the new commit must refer to the complete assembled tree");
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt",
    "script.sh", "link", "vendor", ".github/workflows/ci.yml"]) {
    assert.ok(result.has(name), `missing ${name} from the subdivided tree`);
  }
  const protectedEntry = result.get(".github/workflows/ci.yml");
  assert.equal(protectedEntry?.sha, WORKFLOW_SHA);
  assert.equal(f.recorded, true);
  assert.deepEqual(f.refUpdates, [{ sha: "new-commit", force: false }]);
});

test("generic validation error isolates a single invalid file and never moves the branch", async () => {
  const f = fixture();
  f.rejectTreeWhen({ message: "Validation Failed", errors: [] },
    items => items.some(item => item.path === "b.txt"));
  const response = await f.send({ action: "commit", files: {
    "a.txt": "a", "b.txt": "bad", "c.txt": "c",
  } });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.treeError.path, "b.txt");
  assert.equal(f.commitTrees.length, 0);
  assert.deepEqual(f.refUpdates, []);
  assert.equal(f.recorded, false);
});

test("unclassified and rate-limited 422 responses are not automatically retried", async () => {
  for (const [body, headers, expectedStatus] of [
    [{ message: "Unrecognized provider response" }, undefined, 422],
    [{ message: "Validation Failed" }, { "Retry-After": "90" }, 429],
    [{ message: "secondary rate limit exceeded" }, undefined, 429],
  ] as const) {
    const f = fixture();
    f.rejectTree(body, headers);
    const response = await f.send({ action: "commit", files: { "a.txt": "a", "b.txt": "b" } });
    assert.equal(response.status, expectedStatus);
    assert.equal(f.trees.length, 1, "potential throttling must not be amplified by extra requests");
    assert.deepEqual(f.refUpdates, []);
  }
});

test("validation subdivision stops after a bounded number of GitHub writes", async () => {
  const f = fixture();
  f.rejectTree({ message: "Validation Failed", errors: [] });
  const files: Record<string, string> = {};
  for (let i = 0; i < 200; i++) files[`item-${i}.txt`] = String(i);
  const response = await f.send({ action: "commit", files });
  assert.equal(response.status, 422);
  // Initial POST plus at most eight subdivisions; each failed left half only
  // consumes one additional write on this all-rejected fixture.
  assert.ok(f.trees.length <= 1 + 8);
  assert.deepEqual(f.refUpdates, []);
  assert.equal(f.recorded, false);
});

test("commit rejects non-40-hex expectedHead and assetShas before any GitHub write", async () => {
  for (const payload of [
    { expectedHead: "../../heads/main" },
    { expectedHead: "not-a-git-sha" },
    { assetShas: { "public/logo.png": "../blobs/evil" } },
    { assetShas: { "public/logo.png": "g".repeat(40) } },
  ]) {
    const f = fixture();
    const response = await f.send({ action: "commit", files: { "app/page.tsx": "page" }, ...payload });
    assert.equal(response.status, 400);
    assert.deepEqual(f.writes, []);
    assert.equal(f.recorded, false);
  }
});

test("upload rejects stored asset sources that do not belong to the publishing site", async () => {
  const secretBytes = Buffer.from("other-tenant-secret");
  const f = fixture(false, undefined, undefined, { "assets/other-site.png": secretBytes }, true, new Set(["assets/own.png"]));
  const denied = await f.send({ action: "upload", path: "public/assets/stolen.png", source: "assets/other-site.png" });
  assert.equal(denied.status, 404);
  assert.deepEqual(f.kvReads, []);
  assert.deepEqual(f.writes, []);
});
});

describe("publish-route-aliases", () => {
function fixture() {
  const doc = createInitialDoc();
  for (const [id, slug, text] of [
    ["first", "about/team", "The original team page"],
    ["second", "about//team", "The other team page"],
  ]) {
    const node = makeText(text);
    doc.nodes[node.id] = node;
    doc.pages[id] = { id, name: id, slug, title: id, description: "", children: [node.id] };
    doc.pageOrder.push(id);
  }
  return doc;
}

const errors = (doc: ReturnType<typeof fixture>) => runChecks_3(doc).filter((c) => c.level === "error");

test("publish and export checks reject URLs that produce the same generated route", () => {
  for (const slug of ["about//team", "/about///team/", "about/./team", "about/../team"]) {
    const doc = fixture();
    doc.pages.second.slug = slug;
    const result = errors(doc);
    assert.equal(result.length, 1, slug);
    assert.match(result[0].message, /used by both|same URL|duplicate/i);
    assert.match(result[0].message, /first/);
    assert.match(result[0].message, /second/);
  }
});

test("aliases cannot bypass conflicts for raw HTML and redirect pages", () => {
  for (const patch of [{ rawHtml: "<html><body>Other</body></html>" }, { redirectTo: "/" }, { rewriteTo: "https://example.com/" }]) {
    const doc = fixture();
    Object.assign(doc.pages.second, patch, { query: "tab=other" });
    assert.ok(errors(doc).some((c) => /used by both|same URL|duplicate/i.test(c.message)));
  }
});

test("unpublished aliases stay excluded and unrelated underscore routes stay distinct", () => {
  const doc = fixture();
  doc.pages.second.unpublished = true;
  assert.deepEqual(errors(doc), []);
  doc.pages.second.unpublished = false;
  doc.pages.first.slug = "_team";
  doc.pages.second.slug = "team";
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  assert.ok(files["app/%5Fteam/page.tsx"]);
  assert.ok(files["app/team/page.tsx"]);
});

test("query variants sharing an output route both render through the generated dispatcher", async () => {
  const doc = fixture();
  doc.pages.second.query = "tab=other";
  const before = structuredClone(doc);
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  const route = loadGeneratedRoute(files, "app/about/team/page.tsx");
  for (const [query, title, expected, unexpected] of [
    [{}, "first", "The original team page", "The other team page"],
    [{ tab: "other" }, "second", "The other team page", "The original team page"],
    [{ tab: "missing" }, "first", "The original team page", "The other team page"],
    [{ tab: ["other", "missing"] }, "second", "The other team page", "The original team page"],
    [{ tab: ["missing", "other"] }, "first", "The original team page", "The other team page"],
  ] as const) {
    const props = { params: Promise.resolve({}), searchParams: Promise.resolve(query) };
    const html = renderToStaticMarkup(await route.default(props));
    assert.ok(html.includes(expected));
    assert.ok(!html.includes(unexpected));
    assert.equal((await route.generateMetadata(props)).title, title);
  }
  assert.deepEqual(doc, before, "generation does not rewrite the saved document");
});


test("the special not-found page is separate from normal /404 routes", async () => {
  for (const query of [undefined, "tab=other"]) {
    const doc = fixture();
    doc.pages.first.slug = "404/.";
    doc.pages.first.query = query;
    doc.pages.second.unpublished = true;
    // 初期の文書には、すでに特別な 404 のページがある。
    assert.ok(doc.pageOrder.some((id) => doc.pages[id].slug === "404"));
    assert.deepEqual(errors(doc), []);
    const { files } = generateProject(doc);
    assert.ok(files["app/not-found.tsx"]);
    assert.ok(files["app/404/page.tsx"]);
    assert.equal(files["app/404/_q/p1.tsx"], undefined);
    assert.match(renderToStaticMarkup(await loadGeneratedRoute(files, "app/404/page.tsx").default({
      params: Promise.resolve({}), searchParams: Promise.resolve({}),
    })), /The original team page/);
  }
});

test("HTML /404 routes remain distinct from not-found but collide with normal /404 routes", () => {
  const doc = fixture();
  doc.pages.first.slug = "404";
  doc.pages.first.rawHtml = "<html><body>Explicit 404 URL</body></html>";
  doc.pages.second.unpublished = true;
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  assert.ok(files["app/not-found.tsx"]);
  assert.match(files["app/404/route.ts"], /Explicit 404 URL/);
  doc.pages.second.unpublished = false;
  doc.pages.second.slug = "404/.";
  assert.ok(errors(doc).some((c) => /used by both|same URL|duplicate/i.test(c.message)));
});
});

describe("publish-security", () => {
const siteWithFetch = (url: string, headers?: { name: string; value: string }[], body?: string) => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{ id: "load", trigger: "load",    steps: [{ id: "get", kind: "fetch", as: "data", url, ...(headers ? { headers } : {}),
      ...(body ? { body } : {}) }] }];
  return doc;
};

test("GitHub Push blocks literal API credentials in full editable document", () => {
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data?api_key=top-secret")), true);
  assert.equal(hasPublishCredentials(siteWithFetch("https://user:password@public.example/data")), true);
  assert.equal(hasPublishCredentials(siteWithFetch("//user:password@public.example/data")), true);
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
  node.scripts = [{ id: "node-event", trigger: "click",    steps: [{ id: "fetch", kind: "fetch", as: "private", url: "https://api.example/secret?token=abc" }],
  }];
  assert.equal(hasPublishCredentials(doc), true);
});

test("credential detection visits deep scripts and decoded query, form and JSON keys", () => {
  const url = "https://example.test/data";
  assert.equal(hasPublishCredentials(siteWithFetch(url + "?%61pi_key=literal")), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url, [], "mode=test&client%5Fsecret=literal")), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url, [], '{"nested":{"pass\\u0077ord":"literal"}}')), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url + "?%61pi_key=%7Bkey%7D")), false);
  for (const [target, body] of [
    ["/data?refresh_token=?sample", undefined],
    [url + "#/callback?id_token=sample", undefined],
    [url, "grant_type=refresh_token&refresh_token=sample"],
    [url, '{"nested":{"idToken":"sample"}}'],
    [url, '{"refresh_token":"sample","payload":{value}}'],
  ] as const) {
    const doc = siteWithFetch(target, undefined, body);
    assert.equal(hasPublishCredentials(doc), true);
    assert.ok(exportLimitations_2(doc, "nextjs").some(reason => reason.includes("secret API key")));
  }
  assert.equal(hasPublishCredentials(siteWithFetch("//public.example/data?refresh_token=%7Btoken%7D",
    undefined, '{"id_token":"{identity}"}')), false);
  const slugReference = siteWithFetch(url + "?refresh_token=[slug]", undefined, '{"id_token":"[slug]"}');
  assert.deepEqual(exportLimitations_2(slugReference, "nextjs"), []);
  assert.equal(hasPublishCredentials(siteWithFetch(url + "?refresh_token=[slug]-suffix")), true);
  assert.equal(hasPublishCredentials(siteWithFetch(url, [{ name: "Authorization", value: "[slug]" }])), true);
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
  assert.throws(() => validateImportedDoc(poison), /invalid property names/i);

  const invalid = JSON.parse(JSON.stringify(doc));
  invalid.pageOrder = ["nonexistent-page"];
  assert.throws(() => validateImportedDoc(invalid), /page|hierarchy/i);
});

test("credential checks normalize header names exactly as executable fetch settings do", () => {
  for (const name of [" Authorization ", "\tX-API-Key\r\n", "\u00a0Cookie\u00a0", "  x-AuTh-ToKeN\t"]) {
    const headers = [{ name, value: "synthetic-credential" }];
    const doc = siteWithFetch("https://public.example/data", headers);
    assert.equal(validSiteDoc(doc), true, "padded names are valid editable data");
    assert.equal(fetchRequestOf({ headers }, {})?.headers?.[name.trim()], "synthetic-credential");
    assert.equal(hasPublishCredentials(doc), true, name);
    for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit", "html", "single-html"] as const) {
      assert.ok(exportLimitations_2(doc, framework).length > 0, framework + ": " + name);
    }
  }
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data",
    [{ name: " Authorization ", value: " \t" }])), false);
  assert.equal(hasPublishCredentials(siteWithFetch("https://public.example/data",
    [{ name: " X-Public-Category ", value: "books" }])), false);
});
});

describe("static-hosting", () => {
test("each provider isolates site projects, including Netlify previews", () => {
  const a = hostingProjectName("abc123", "netlify", "production", "tsumu");
  const b = hostingProjectName("abc124", "netlify", "production", "tsumu");
  assert.notEqual(a, b);
  assert.equal(a, "tsumu-abc123");
  assert.equal(hostingProjectName("abc123", "netlify", "test", "tsumu"), "tsumu-abc123-preview");
  assert.equal(hostingProjectName("abc123", "cloudflare", "test", "tsumu"), "tsumu-abc123");
  assert.throws(() => hostingProjectName("abc123", "netlify", "production", "../bad"));
  assert.throws(() => hostingProjectName("ABC", "netlify", "production", "tsumu"));
  assert.throws(() => hostingProjectName("a".repeat(64), "cloudflare", "production", "tsumu"));
});

test("never include editable data or environment files in public hosting payloads", () => {
  for (const path of ["_tsumu/doc.json", ".env", ".env.production", "assets/.env", "pages/Doc.json", ".git/config"]) {
    assert.equal(isPublicStaticPath(path), false, path);
  }
  assert.equal(isPublicStaticPath("index.html"), true);
  assert.equal(isPublicStaticPath("assets/logo.png"), true);
});

async function zipFor(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new ZipBuilder();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return zip.toArrayBuffer();
}

test("valid static ZIP has only deployable files", async () => {
  const files = await readStaticZip(await zipFor({
    "index.html": "<html>OK</html>",
    "assets/logo.svg": "<svg></svg>",
  }));
  assert.deepEqual(files.map((file) => file.path), ["index.html", "assets/logo.svg"]);
});

test("rejects missing index, private files, path collisions and oversized archives", async () => {
  await assert.rejects(readStaticZip(await zipFor({ "about.html": "x" })), /index.html/);
  await assert.rejects(readStaticZip(await zipFor({ "index.html": "x", "_tsumu/doc.json": "{}" })), /Editable project data/);
  await assert.rejects(readStaticZip(await zipFor({ "index.html": "x", "INDEX.HTML": "y" })), /collision/i);
  await assert.rejects(readStaticZip(new ArrayBuffer(0)), /too large/i);
});

test("Cloudflare asset hashes are content- and extension-dependent", () => {
  const file = new TextEncoder().encode("static content");
  const hash = pagesAssetHash(file, "index.html");
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.equal(hash, pagesAssetHash(file, "pages/about.html"));
  assert.notEqual(hash, pagesAssetHash(file, "index.js"));
  assert.notEqual(hash, pagesAssetHash(new TextEncoder().encode("other"), "index.html"));
});

test("listStaticDeployments returns an empty list when Cloudflare Pages project does not exist yet", async () => {
  const savedAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedToken = process.env.CLOUDFLARE_API_TOKEN;
  const savedFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  process.env.CLOUDFLARE_API_TOKEN = "cf-test-token";
  try {
    let status = 404;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false }), { status });
    assert.deepEqual(await listStaticDeployments("abc123", "production"), []);
    status = 500;
    await assert.rejects(listStaticDeployments("abc123", "production"), /HTTP 500/);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = savedAccount;
    if (savedToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = savedToken;
  }
});
});
