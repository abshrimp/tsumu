import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gitBlobSha } from "../lib/git-blob-sha";
import { gitlabClient } from "../lib/gitlab";
import { isSafeRepo, normalizeSiteInput } from "../lib/site-model";
import { targetConfig } from "../lib/github";
import { matchesPublishTarget } from "../lib/publish-preconditions";
import { serializeGeneratedManifest, GENERATED_MANIFEST_PATH } from "../lib/publish-files";

const tr = (message: string) => message;
const sha = "a".repeat(40);
const manifestSha = "b".repeat(40);
const config = {
  provider: "gitlab" as const,
  token: "test-token",
  repo: "group/nested/project",
  branch: "main",
  url: undefined,
};

test("GitLab and GitHub repository validators differ only for nested groups", () => {
  assert.equal(isSafeRepo("group/project"), true);
  assert.equal(isSafeRepo("group/nested/project"), false);
  assert.equal(isSafeRepo("group/nested/project", "gitlab"), true);
  for (const unsafe of ["../project", "group//project", "group/%2f/project", "group/../../project", "group/"]) {
    assert.equal(isSafeRepo(unsafe, "gitlab"), false, unsafe);
  }
  const base = { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
  const good = normalizeSiteInput({ gitProvider: "gitlab", repo: "group/sub/project" }, base);
  assert.equal(good.ok, true);
  const bad = normalizeSiteInput({ gitProvider: "github", repo: "group/sub/project" }, base);
  assert.equal(bad.ok, false);
  assert.equal(normalizeSiteInput({ gitProvider: "another-service" as "gitlab" }, base).ok, false);
});

test("publish destination preconditions bind the selected Git provider", () => {
  const conf = { ...config, branch: "main" };
  assert.equal(matchesPublishTarget({
    site: "site", provider: "gitlab", target: "production", repo: conf.repo,
    branch: "main", productionBranch: "main",
  }, "site", "production", conf, "main"), true);
  assert.equal(matchesPublishTarget({
    site: "site", provider: "github", target: "production", repo: conf.repo,
    branch: "main", productionBranch: "main",
  }, "site", "production", conf, "main"), false);
  assert.equal(targetConfig({
    gitProvider: "gitlab", repo: conf.repo, branch: "main",
    previewBranch: "preview", siteUrl: null, previewUrl: null,
  }, "production").provider, "gitlab");
});

test("GitLab blob hashes match Git's content-addressed SHA-1", async () => {
  for (const content of ["", "hello", "\u65e5\u672c\u8a9e", "a".repeat(131071)]) {
    const bytes = new TextEncoder().encode(content);
    const expected = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
    assert.equal(await gitBlobSha(bytes), expected);
  }
});

test("GitLab client never follows redirects carrying a credential", async () => {
  const previous = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 302, headers: { Location: "https://example.invalid/token" } });
  };
  try {
    const client = gitlabClient(config, tr);
    await assert.rejects(client.request("/repository/branches/main"), /redirect/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init?.redirect, "manual");
    assert.equal(new URL(requests[0].url).hostname, "gitlab.com");
    assert.equal((requests[0].init?.headers as Record<string, string>)["PRIVATE-TOKEN"], "test-token");
  } finally {
    globalThis.fetch = previous;
  }
});

test("GitLab snapshot traverses its tree and validates the generated manifest", async () => {
  const previous = globalThis.fetch;
  const manifest = serializeGeneratedManifest({ "index.html": sha });
  const paths: string[] = [];
  globalThis.fetch = async (url) => {
    const location = String(url);
    paths.push(location);
    if (location.endsWith("/repository/branches/main")) return Response.json({ commit: { id: sha } });
    if (location.includes("/repository/tree?")) {
      return Response.json([
        { path: "index.html", id: sha, type: "blob" },
        { path: GENERATED_MANIFEST_PATH, id: manifestSha, type: "blob" },
      ]);
    }
    if (location.endsWith("/repository/blobs/" + manifestSha + "/raw")) {
      return new Response(manifest);
    }
    throw new Error("Unexpected API path: " + location);
  };
  try {
    const client = gitlabClient(config, tr);
    const snapshot = await client.snapshot();
    assert.equal(snapshot.head, sha);
    assert.equal(snapshot.blobs["index.html"], sha);
    assert.equal(snapshot.generated?.["index.html"], sha);
    assert.equal(Object.getPrototypeOf(snapshot.manifest), null);
    assert.ok(paths.every(path => path.startsWith("https://gitlab.com/api/v4/projects/group%2Fnested%2Fproject/")));
  } finally {
    globalThis.fetch = previous;
  }
});

test("GitLab client rejects encoded traversal paths and non-gitlab.com commit web_url values", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    const location = String(url);
    if (location.endsWith("/repository/branches/main")) return Response.json({ commit: { id: sha } });
    if (location.includes("/repository/commits?")) {
      return Response.json([
        { id: sha, message: "Safe\ndetails", committed_date: "2026-01-01T00:00:00Z", web_url: "https://gitlab.com/group/nested/project/-/commit/" + sha },
        { id: manifestSha, message: "Untrusted", committed_date: "2026-01-01T00:00:00Z", web_url: "javascript:alert(1)" },
      ]);
    }
    throw new Error("Unexpected API path: " + location);
  };
  try {
    const client = gitlabClient(config, tr);
    for (const bad of ["/repository/files/%2e%2e/raw", "/repository/files/foo%5cbar/raw", "repository/branches/main"]) {
      await assert.rejects(client.request(bad));
    }
    assert.equal(calls, 0);
    const history = await client.history();
    assert.equal(history.commits[0]?.url, "https://gitlab.com/group/nested/project/-/commit/" + sha);
    assert.equal(history.commits[1]?.url, "https://gitlab.com/group/nested/project/-/commit/" + manifestSha);
  } finally {
    globalThis.fetch = previous;
  }
});

test("GitLab publish creates missing live branch on non-empty repos and reuses unchanged same-path assets", async () => {
  const { load } = await import("./helpers/document-generation-api");
  const { createInitialDoc } = await import("../lib/presets");
  const { DOC_PATH } = await import("../lib/publish-files");
  class StubNextResponse extends Response {
    static json(value: unknown, init?: ResponseInit) { return new StubNextResponse(JSON.stringify(value), init); }
  }
  const savedToken = process.env.GITLAB_TOKEN;
  const savedProvider = process.env.PUBLISH_PROVIDER;
  const previousFetch = globalThis.fetch;
  process.env.GITLAB_TOKEN = "glpat-test";
  process.env.PUBLISH_PROVIDER = "github";
  const docJson = JSON.stringify(createInitialDoc());
  const docSha = await gitBlobSha(new TextEncoder().encode(docJson));
  const logoBytes = new TextEncoder().encode("logo-bytes");
  const logoSha = await gitBlobSha(logoBytes);
  const dest = { gitProvider: "gitlab" as const, repo: "group/project", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
  const route = load("../../app/api/publish/gitlab/route.ts", {
    "next/server": { NextResponse: StubNextResponse },
    "../../../../lib/i18n-server": { serverTr: async () => tr },
    "../../../../lib/server": { requireAuth: async () => null, recordPublish: async () => {} },
    "../../../../lib/site-access": { requireSiteAccess: async () => null },
    "../../../../lib/site-server": { siteIdOf: () => "site1", siteDestOf: async () => dest },
    "../../../../lib/db": { dbConfigured: () => false, getDb: async () => { throw new Error("unused"); } },
    "../../../../lib/publish-preferences": {
      parsePublishedExportOptions: () => ({ framework: "html", language: "javascript", style: "css" }),
      savePublishedExportOptions: async () => {},
    },
  }) as { POST: (req: Request) => Promise<Response> };

  try {
    let branchCreated = false;
    let lastCommitActions: Array<{ action: string; file_path: string }> = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/repository/branches/main") && method === "GET") {
        return branchCreated ? Response.json({ commit: { id: sha } }) : new Response("{}", { status: 404 });
      }
      if (u.endsWith("/projects/group%2Fproject") && method === "GET") {
        return Response.json({ empty_repo: false, default_branch: "trunk" });
      }
      if (u.endsWith("/repository/branches") && method === "POST") {
        const b = JSON.parse(String(init?.body ?? "{}")) as { branch: string; ref: string };
        assert.deepEqual(b, { branch: "main", ref: "trunk" });
        branchCreated = true;
        return Response.json({ name: "main", commit: { id: sha } }, { status: 201 });
      }
      if (u.includes("/repository/tree?")) {
        return Response.json(branchCreated ? [
          { path: "public/logo.png", id: logoSha, type: "blob" },
          { path: GENERATED_MANIFEST_PATH, id: manifestSha, type: "blob" },
        ] : []);
      }
      if (u.endsWith("/repository/blobs/" + manifestSha + "/raw")) {
        return new Response(serializeGeneratedManifest({ "public/logo.png": logoSha, [DOC_PATH]: docSha }));
      }
      if (u.endsWith("/repository/commits") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { actions: Array<{ action: string; file_path: string }> };
        lastCommitActions = body.actions;
        return Response.json({ id: "c".repeat(40), web_url: "https://gitlab.com/group/project/-/commit/" + "c".repeat(40) }, { status: 201 });
      }
      throw new Error(`Unexpected GitLab API call: ${method} ${u}`);
    };

    const expected = { site: "site1", provider: "gitlab", target: "production", repo: "group/project", branch: "main", productionBranch: "main" };
    const prepRes = await route.POST(new Request("http://localhost/api/publish/gitlab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "tree", site: "site1", target: "production", expected }),
    }));
    assert.equal(prepRes.status, 200);
    assert.equal(branchCreated, true);

    const manifest = serializeGeneratedManifest({ "public/logo.png": logoSha, [DOC_PATH]: docSha });
    const res = await route.POST(new Request("http://localhost/api/publish/gitlab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "commit",
        site: "site1",
        target: "production",
        expected,
        expectedHead: sha,
        keptPaths: [],
        exportOptions: { framework: "html", language: "javascript", style: "css" },
        files: { [DOC_PATH]: docJson, [GENERATED_MANIFEST_PATH]: manifest },
        assets: [],
        assetShas: { "public/logo.png": logoSha },
      }),
    }));
    assert.equal(res.status, 200);
    assert.equal(lastCommitActions.some((a) => a.file_path === "public/logo.png"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (savedToken === undefined) delete process.env.GITLAB_TOKEN;
    else process.env.GITLAB_TOKEN = savedToken;
    if (savedProvider === undefined) delete process.env.PUBLISH_PROVIDER;
    else process.env.PUBLISH_PROVIDER = savedProvider;
  }
});

test("GitLab commit protects updates and deletes against edits arriving after the final branch read", async () => {
  const previous = globalThis.fetch;
  const newHead = "d".repeat(40);
  let remoteHead = sha;
  let commitRequests = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/repository/branches/main")) {
        return Response.json({ commit: { id: remoteHead } });
      }
      assert.equal(init?.method, "POST");
      assert.ok(String(url).endsWith("/repository/commits"));
      commitRequests++;
      remoteHead = newHead;
      const { actions } = JSON.parse(String(init?.body));
      assert.deepEqual(actions.map((a: { last_commit_id?: string }) => a.last_commit_id),
        [sha, sha, undefined]);
      return Response.json({ message: "The file has changed since you started editing it" }, { status: 400 });
    };
    assert.equal(await gitlabClient(config, tr).commit(sha, [
      { action: "update", file_path: "index.html", content: "edited" },
      { action: "delete", file_path: "old.html" },
      { action: "create", file_path: "new.html", content: "new" },
    ], "Publish"), null);
    assert.equal(commitRequests, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test("GitLab rollback caps changed blob fetches rather than total unchanged site files", async () => {
  const { load } = await import("./helpers/document-generation-api");
  const { createInitialDoc } = await import("../lib/presets");
  const { DOC_PATH } = await import("../lib/publish-files");
  class StubNextResponse extends Response {
    static json(value: unknown, init?: ResponseInit) { return new StubNextResponse(JSON.stringify(value), init); }
  }
  const savedToken = process.env.GITLAB_TOKEN;
  const savedProvider = process.env.PUBLISH_PROVIDER;
  const previousFetch = globalThis.fetch;
  process.env.GITLAB_TOKEN = "glpat-test";
  process.env.PUBLISH_PROVIDER = "github";
  const docJson = JSON.stringify(createInitialDoc());
  const docSha = await gitBlobSha(new TextEncoder().encode(docJson));
  const oldPageSha = "1".repeat(40);
  const curPageSha = "2".repeat(40);
  const curHead = "3".repeat(40);
  const chosenHead = "4".repeat(40);
  const curManifestSha = "5".repeat(40);
  const chosenManifestSha = "6".repeat(40);
  const unchanged: Record<string, string> = {};
  for (let i = 1; i <= 45; i++) unchanged[`p${i}.html`] = sha;
  const curGenerated = { ...unchanged, "p0.html": curPageSha, [DOC_PATH]: docSha };
  const chosenGenerated = { ...unchanged, "p0.html": oldPageSha, "missing.html": "7".repeat(40), [DOC_PATH]: docSha };
  const dest = { gitProvider: "gitlab" as const, repo: "group/project", branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
  const route = load("../../app/api/publish/gitlab/history/route.ts", {
    "next/server": { NextResponse: StubNextResponse },
    "../../../../../lib/i18n-server": { serverTr: async () => tr },
    "../../../../../lib/server": { requireAuth: async () => null, recordPublish: async () => {} },
    "../../../../../lib/site-access": { requireSiteAccess: async () => null },
    "../../../../../lib/site-server": { siteIdOf: () => "site1", siteDestOf: async () => dest, destParam: () => null },
  }) as { POST: (req: Request) => Promise<Response> };

  try {
    let rawFetches = 0;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/repository/branches/main")) return Response.json({ commit: { id: curHead } });
      if (u.includes("/repository/commits?")) return Response.json([
        { id: curHead, message: "Current", committed_date: "2026-01-02T00:00:00Z" },
        { id: chosenHead, message: "Previous", committed_date: "2026-01-01T00:00:00Z" },
      ]);
      if (u.includes("/repository/commits/" + chosenHead)) return Response.json({ id: chosenHead });
      if (u.includes("/repository/tree?")) {
        const isChosen = u.includes("ref=" + chosenHead);
        const pageSha = isChosen ? oldPageSha : curPageSha;
        const mSha = isChosen ? chosenManifestSha : curManifestSha;
        return Response.json([
          ...Object.entries(unchanged).map(([path, id]) => ({ path, id, type: "blob" })),
          { path: "p0.html", id: pageSha, type: "blob" },
          { path: DOC_PATH, id: docSha, type: "blob" },
          { path: GENERATED_MANIFEST_PATH, id: mSha, type: "blob" },
        ]);
      }
      if (u.endsWith("/repository/blobs/" + curManifestSha + "/raw")) return new Response(serializeGeneratedManifest(curGenerated));
      if (u.endsWith("/repository/blobs/" + chosenManifestSha + "/raw")) return new Response(serializeGeneratedManifest(chosenGenerated));
      if (u.endsWith("/repository/blobs/" + docSha + "/raw")) { rawFetches++; return new Response(docJson); }
      if (u.endsWith("/repository/blobs/" + oldPageSha + "/raw")) { rawFetches++; return new Response("<h1>old</h1>"); }
      if (u.endsWith("/repository/commits") && method === "POST") {
        return Response.json({ id: "8".repeat(40), web_url: "https://gitlab.com/group/project/-/commit/" + "8".repeat(40) }, { status: 201 });
      }
      throw new Error(`Unexpected GitLab API call: ${method} ${u}`);
    };

    const res = await route.POST(new Request("http://localhost/api/publish/gitlab/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        site: "site1",
        sha: chosenHead,
        expectedHead: curHead,
        target: "production",
        expected: { site: "site1", provider: "gitlab", target: "production", repo: "group/project", branch: "main", productionBranch: "main" },
      }),
    }));
    assert.equal(res.status, 200);
    assert.equal(rawFetches, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (savedToken === undefined) delete process.env.GITLAB_TOKEN;
    else process.env.GITLAB_TOKEN = savedToken;
    if (savedProvider === undefined) delete process.env.PUBLISH_PROVIDER;
    else process.env.PUBLISH_PROVIDER = savedProvider;
  }
});


