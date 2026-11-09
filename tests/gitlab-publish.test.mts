import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gitlabBlobSha, gitlabClient } from "../lib/gitlab";
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
    assert.equal(await gitlabBlobSha(bytes), expected);
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

