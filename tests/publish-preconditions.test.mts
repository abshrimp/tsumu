import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as files from "../lib/publish-files";
import * as contract from "../lib/publish-preconditions";
import * as preferences from "../lib/publish-preferences";
import { advanceBranchRef } from "../lib/github";
import { hasPublishCredentials } from "../lib/publish-security";
import { gitBlobRequestBody } from "../lib/github-blob";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

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
    { path: files.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "generated-manifest" },
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
              { path: files.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" },
            ]
          : options.rollbackSourceHasOldGenerated && path.includes("old-tree")
          ? [
              { path: "app/old.ts", mode: "100644", type: "blob", sha: "historical-generated" },
              { path: files.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" },
            ]
          : options.rollbackSourceContainsCredentials && path.includes("old-tree")
          ? [{ path: files.DOC_PATH, mode: "100644", type: "blob", sha: "historic-secret" }]
          : options.rollbackSourceHasOlderManual && path.includes("old-tree")
            ? [
                 { path: "manual.txt", mode: "100644", type: "blob", sha: "older" },
                 { path: files.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" },
               ]
          : options.rollbackSourceMissingManual && path.includes("old-tree")
             ? [{ path: files.GENERATED_MANIFEST_PATH, mode: "100644", type: "blob", sha: "historical-manifest" }]
             : entries,
        ...(options.truncatedRollback ? { truncated: true } : {}),
      });
      if (path === "/git/blobs/historic-secret") return NextResponse.json({
        content: Buffer.from(JSON.stringify({ scripts: [{ kind: "fetch", url: "https://api.example.test/?api_key=exposed" }] })).toString("base64"),
        encoding: "base64",
      });
      if (path === "/git/blobs/historical-manifest") return NextResponse.json({
        content: Buffer.from(files.serializeGeneratedManifest(
          options.rollbackSourceHasOldGenerated ? { "app/old.ts": "historical-generated" } : {},
        )).toString("base64"),
        encoding: "base64",
      });
      if (path === "/git/blobs/generated-manifest") return NextResponse.json({
        content: Buffer.from(files.serializeGeneratedManifest({ "app/new.ts": "generated" })).toString("base64"),
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
    "lib/site-server": { siteIdOf: async (site: string) => site, siteDestOf: async () => dest, destParam: () => undefined },
    "lib/github": { advanceBranchRef, targetConfig: conf, configError: () => null, githubClient: client, branchPath: (s: string) => s, previewEnabled: () => true },
    "lib/db": { dbConfigured: () => false },
    "lib/kv": {}, "lib/errors": { userMessage: (e: Error) => e.message },
    "lib/publish-files": files, "lib/publish-preconditions": contract, "lib/publish-preferences": preferences, "lib/publish-security": { hasPublishCredentials },
    "lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited },
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
  const plan = files.planPublish(snapshot.blobs, snapshot.generated, ["page.txt"]);
  f.addManual();
  assert.equal((await f.post({ action: "commit", files: { "page.txt": "p" }, expectedHead: snapshot.head, keptPaths: Object.keys(plan.kept) })).status, 409);
  assert.deepEqual(f.writes, []); assert.equal(f.recorded, 0); assert.equal(f.heads.main, newer);
  // 意図して再試行すると、新しいスナップショットを取り、新しく追加したファイルも含める。
  const fresh = await (await f.post({ action: "tree" })).json();
  const retry = await f.post({ action: "commit", files: { "page.txt": "p" }, expectedHead: fresh.head, keptPaths: Object.keys(files.planPublish(fresh.blobs, fresh.generated, ["page.txt"]).kept) });
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
  assert.ok(!updated.body.tree.some((entry: any) => entry.path === "app/new.ts" || entry.path === files.GENERATED_MANIFEST_PATH));
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
