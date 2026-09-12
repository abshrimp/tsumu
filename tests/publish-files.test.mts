import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENERATED_MANIFEST_PATH,
  DOC_PATH,
  isProtectedPath,
  isSafeCommitPath,
  conflictingCommitPaths,
  parseGeneratedManifest,
  planPublish,
  keptTreeEntries,
  protectedTreeEdits,
  serializeGeneratedManifest,
} from "../lib/publish-files";

test("初回の公開は既存ファイルを保持し、重なるパスの上書きを知らせる", () => {
  const plan = planPublish({ "app/page.tsx": "a", "notes.md": "b", ".github/workflows/ci.yml": "c" }, null, ["app/page.tsx"]);
  assert.deepEqual(plan, { edited: [], clashing: ["app/page.tsx"], kept: { "notes.md": "b", ".github/workflows/ci.yml": "c" } });
  assert.deepEqual(planPublish({}, null, ["app/page.tsx"]), { edited: [], clashing: [], kept: {} });
});

test("手で追加したファイルは残し、直接編集された書き出しファイルは知らせる", () => {
  const blobs = {
    "app/page.tsx": "edited",
    "app/layout.tsx": "same",
    "app/api/hello/route.ts": "mine",
    "_next/static/build.js": "static",
    [DOC_PATH]: "doc",
    "_tsumu/stray.json": "stray",
    [GENERATED_MANIFEST_PATH]: "list",
  };
  const generated = { "app/page.tsx": "original", "app/layout.tsx": "same", [DOC_PATH]: "doc" };
  const plan = planPublish(blobs, generated, ["app/page.tsx", "app/layout.tsx", DOC_PATH]);
  assert.deepEqual(plan.edited, ["app/page.tsx"]);
  assert.deepEqual(plan.clashing, []);
  assert.deepEqual(plan.kept, { "app/api/hello/route.ts": "mine", "_next/static/build.js": "static" });
});

test("Tsumu managed metadata is never preserved as a manually authored file", () => {
  const blobs = {
    [DOC_PATH]: "document",
    "_tsumu/assets.json": "assets",
    [GENERATED_MANIFEST_PATH]: "generated",
    "_next/static/app.js": "framework",
    "README.md": "manual",
  };
  const plan = planPublish(blobs, null, [DOC_PATH, GENERATED_MANIFEST_PATH]);
  assert.deepEqual(plan.kept, { "_next/static/app.js": "framework", "README.md": "manual" });
  assert.deepEqual(plan.clashing, []);
  assert.deepEqual(plan.edited, []);
});

test("手で追加したファイルと同じパスを書き出すときは上書きを知らせる", () => {
  const plan = planPublish(
    { "app/about/page.tsx": "mine", "app/page.tsx": "g" },
    { "app/page.tsx": "g" },
    ["app/page.tsx", "app/about/page.tsx"]
  );
  assert.deepEqual(plan.clashing, ["app/about/page.tsx"]);
  assert.deepEqual(plan.kept, {});
});

test("前回書き出して今回は書き出さないファイル（削除したページ）は残さない", () => {
  const plan = planPublish({ "app/old/page.tsx": "g" }, { "app/old/page.tsx": "g" }, ["app/page.tsx"]);
  assert.deepEqual(plan, { edited: [], clashing: [], kept: {} });
});

test("一覧は書き出して読み戻せ、壊れていれば null", () => {
  const files = { "b.ts": "2", "a.ts": "1" };
  const text = serializeGeneratedManifest(files);
  assert.deepEqual(Object.keys(JSON.parse(text).files), ["a.ts", "b.ts"]);
  assert.deepEqual(parseGeneratedManifest(text), files);
  assert.equal(parseGeneratedManifest("{"), null);
  assert.equal(parseGeneratedManifest("[]"), null);
  assert.equal(parseGeneratedManifest('{"files":[]}'), null);
  assert.equal(parseGeneratedManifest('{"files":{"a.ts":"1"}}'), null);
  assert.equal(parseGeneratedManifest('{"version":2,"files":{"a.ts":"1"}}'), null);
  assert.equal(parseGeneratedManifest('{"version":1,"files":{"../outside":"1"}}'), null);
  assert.equal(parseGeneratedManifest('{"version":1,"files":{"a.ts":1}}'), null);
});

test("コミットするパスは、リポジトリの外や別の場所を指せない", () => {
  for (const ok of ["app/page.tsx", "public/a b.png", ".well-known/security.txt",
    "_next/static/chunk.js", "_app/entry.js", "_headers", "_redirects"])
    assert.ok(isSafeCommitPath(ok), ok);
  for (const ng of ["", "/etc/passwd", "a/../b", "./a", "a//b", "a/", "a\\b"])
    assert.ok(!isSafeCommitPath(ng), ng);
});

test(".github/ は書き出しに使わない場所として扱う", () => {
  assert.ok(isProtectedPath(".github/workflows/deploy.yml"));
  assert.ok(isProtectedPath(".GitHub/workflows/x.yml"));
  assert.ok(!isProtectedPath(".githubx/a"));
  assert.ok(!isProtectedPath("app/.github/a"));
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
  const plan = planPublish(blobs, null, ["app/page.tsx"]);
  assert.deepEqual(keptTreeEntries(entries, Object.keys(plan.kept)), entries);
  assert.deepEqual(keptTreeEntries(entries, ["script.sh", "script.sh"]), [entries[0]]);
  assert.deepEqual(keptTreeEntries(entries, []), []);
  assert.equal(keptTreeEntries(entries, ["missing"]), null);
  assert.equal(keptTreeEntries([{ path: "dir", mode: "040000", type: "tree", sha: "dir" }], ["dir"]), null);
});

test("detect file/directory prefix conflicts without rejecting ordinary siblings", () => {
  assert.deepEqual(conflictingCommitPaths(["public/assets", "public/assets/logo.png"]), ["public/assets", "public/assets/logo.png"]);
  assert.deepEqual(conflictingCommitPaths(["docs/guide.md", "docs"]), ["docs", "docs/guide.md"]);
  assert.equal(conflictingCommitPaths(["public/a.png", "public/abc.png", "public/ab/b.png"]), null);
  assert.equal(conflictingCommitPaths(["src/app/page.tsx", "src/app/layout.tsx"]), null);
});
