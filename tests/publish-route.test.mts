import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as preconditions from "../lib/publish-preconditions";
import { advanceBranchRef } from "../lib/github";
import { hasPublishCredentials } from "../lib/publish-security";
import * as helpers from "../lib/publish-files";
import { parsePublishedExportOptions } from "../lib/publish-preferences";
import { gitBlobRequestBody } from "../lib/github-blob";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

// 外部とは通信せずに、公開の API が GitHub に渡すツリーを確かめる。
function fixture(truncated?: boolean, manifestText?: string, documentBlob?: string,
  storedAssets: Record<string, Uint8Array> = {}) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  const entries = [
    { path: "script.sh", mode: "100755", type: "blob", sha: "exec" },
    { path: "link", mode: "120000", type: "blob", sha: "link" },
    { path: "vendor", mode: "160000", type: "commit", sha: "submodule" },
    { path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha: "workflow" },
  ];
  const trees: { tree: helpers.TreeEntry[] }[] = [];
  const writes: string[] = [];
  const refUpdates: { sha: string; force: boolean }[] = [];
  const uploaded: { content: string; encoding: string }[] = [];
  let recorded = false;
  let treeRejection: { body: object; headers?: Record<string, string> } | null = null;
  const gh = async (path: string, options: { body?: string } = {}) => {
    if (options.body) writes.push(path);
    if (path.startsWith("/git/ref/heads/")) return NextResponse.json({ object: { sha: "head" } });
    if (path.startsWith("/git/trees/")) return NextResponse.json({ tree: entries, truncated });
    if (path.startsWith("/git/blobs/")) return NextResponse.json({
      encoding: "base64", content: Buffer.from(path.endsWith("/secret-doc") ? documentBlob ?? "" : manifestText ?? "").toString("base64"),
    });
    if (path === "/git/blobs") {
      uploaded.push(JSON.parse(options.body!));
      return NextResponse.json({ sha: "uploaded-blob" });
    }
    if (path === "/git/trees") {
      trees.push(JSON.parse(options.body!));
      if (treeRejection) return NextResponse.json(treeRejection.body, { status: 422, headers: treeRejection.headers });
      return NextResponse.json({ sha: "new-tree" });
    }
    if (path === "/git/commits") return NextResponse.json({ sha: "new-commit" });
    if (path.startsWith("/git/refs/heads/")) refUpdates.push(JSON.parse(options.body!));
    return NextResponse.json({});
  };
  const injected = {
    JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited, gitBlobRequestBody,
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
    parsePublishedExportOptions,
    planPublish: helpers.planPublish,
    keptTreeEntries: helpers.keptTreeEntries,
    NextResponse,
    serverTr: async () => (text: string) => text,
    requireAuth: async () => null,
    siteIdOf: async () => "site",
    siteDestOf: async () => ({}),
    configError: () => null,
    targetConfig: () => ({ repo: "test/site", branch: "main", token: "fake" }),
    githubClient: () => ({ gh, fail: () => { throw new Error("Unexpected GitHub error"); } }),
    toBranchPath: (path: string) => path,
    advanceBranchRef,
    recordPublish: async () => { recorded = true; },
    dbConfigured: () => false,
    assetStore: () => ({ get: async (source: string) => storedAssets[source] ?? null }),
    userMessage: (error: Error) => error.message,
  };
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/publish/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^export /gm, "");
  const post = new Function(...Object.keys(injected), `${source}\nreturn POST;`)(...Object.values(injected)) as (req: Request) => Promise<Response>;
  const send = (body: object) => post(new Request("https://example.com/api/publish", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected: { site: "site", target: "production", repo: "test/site", branch: "main", productionBranch: "main" }, expectedHead: "head", exportOptions: { framework: "nextjs", language: "typescript", style: "css" }, ...body, site: "site", target: "production" }),
  }));
  return {
    entries, trees, writes, refUpdates, uploaded, send,
    rejectTree(body: object, headers?: Record<string, string>) { treeRejection = { body, headers }; },
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
    { files: { "app/page.tsx": "page" }, assetShas: { "script.sh": "replacement-sha" } },
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
    { assetShas: { ".github/workflows/ci.yml": "workflow" } },
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
    assetShas: { "app/page.tsx": "other-blob" },
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
    assetShas: { [helpers.DOC_PATH]: "secret-doc" },
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
    { action: "commit", files: { "app/page.tsx": "page" }, assetShas: { [helpers.DOC_PATH]: "secret-doc" } },
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
  assert.ok((await response.json()).error.includes("public/assets/image.png"));
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
  assert.match((await response.json()).error, /temporarily limiting publishing requests/);
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
