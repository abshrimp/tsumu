import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as preconditions from "../lib/publish-preconditions";
import { advanceBranchRef } from "../lib/github";
import * as helpers from "../lib/publish-files";

// 外部通信せず、公開 API が GitHub に渡すツリーを確かめる。
function fixture(truncated?: boolean, manifestText?: string) {
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
  let recorded = false;
  const gh = async (path: string, options: { body?: string } = {}) => {
    if (options.body) writes.push(path);
    if (path.startsWith("/git/ref/heads/")) return NextResponse.json({ object: { sha: "head" } });
    if (path.startsWith("/git/trees/")) return NextResponse.json({ tree: entries, truncated });
    if (path.startsWith("/git/blobs/")) return NextResponse.json({
      encoding: "base64", content: Buffer.from(manifestText ?? "").toString("base64"),
    });
    if (path === "/git/trees") {
      trees.push(JSON.parse(options.body!));
      return NextResponse.json({ sha: "new-tree" });
    }
    if (path === "/git/commits") return NextResponse.json({ sha: "new-commit" });
    if (path.startsWith("/git/refs/heads/")) refUpdates.push(JSON.parse(options.body!));
    return NextResponse.json({});
  };
  const injected = {
    matchesPublishTarget: preconditions.matchesPublishTarget,
    publishConflictMessage: preconditions.publishConflictMessage,
    GENERATED_MANIFEST_PATH: helpers.GENERATED_MANIFEST_PATH,
    ASSET_MANIFEST_PATH: helpers.ASSET_MANIFEST_PATH,
    isSafeCommitPath: helpers.isSafeCommitPath,
    conflictingCommitPaths: helpers.conflictingCommitPaths,
    isProtectedPath: helpers.isProtectedPath,
    parseGeneratedManifest: helpers.parseGeneratedManifest,
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
    userMessage: (error: Error) => error.message,
  };
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/publish/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/^export /gm, "");
  const post = new Function(...Object.keys(injected), `${source}\nreturn POST;`)(...Object.values(injected)) as (req: Request) => Promise<Response>;
  const send = (body: object) => post(new Request("https://example.com/api/publish", {
    method: "POST", body: JSON.stringify({ expected: { site: "site", target: "production", repo: "test/site", branch: "main", productionBranch: "main" }, expectedHead: "head", ...body, site: "site", target: "production" }),
  }));
  return { entries, trees, writes, refUpdates, send, get recorded() { return recorded; } };
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
  assert.match(body.error, /ファイル一覧/);
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
    assert.match((await response.json()).error, /ファイル一覧/);
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
