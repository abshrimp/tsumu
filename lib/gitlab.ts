import type { Tr } from "./i18n-server";
import type { PublishCommit, TargetConfig } from "./github";
import { isSafeBranch, isSafeRepo } from "./site-model";
import {
  ASSET_MANIFEST_PATH, GENERATED_MANIFEST_PATH, isSafeCommitPath, parseGeneratedManifest,
} from "./publish-files";

export interface GitLabCommitAction {
  action: "create" | "update" | "delete";
  file_path: string;
  content?: string;
  encoding?: "base64";
}

/**
 * GitLab.com REST adapter. The host is fixed, and the project path is validated
 * before sending the server's credential; redirects never carry the credential.
 */
export function gitlabClient(conf: Required<TargetConfig>, tr: Tr) {
  const repo = conf.repo ?? "";
  const token = conf.token ?? "";
  if (conf.provider !== "gitlab" || !token || !isSafeRepo(repo, "gitlab") ||
      !isSafeBranch(conf.branch)) {
    throw new Error("Invalid GitLab destination");
  }
  const root = "https://gitlab.com/api/v4/projects/" + encodeURIComponent(repo);
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    if (path !== "" && (!path.startsWith("/") || path.startsWith("//") || /[\\#]|%(?:2e|5c)/i.test(path) ||
        path.split(/[/?]/).some(segment => segment === "." || segment === ".."))) {
      throw new Error("Invalid GitLab API path");
    }
    const response = await fetch(root + path, {
      ...init,
      redirect: "manual",
      headers: {
        "PRIVATE-TOKEN": token,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Unexpected GitLab API redirect");
    }
    return response;
  };
  const fail = async (step: string, res: Response): Promise<never> => {
    console.error("GitLab API request failed", { project: conf.repo, step, status: res.status });
    await res.body?.cancel().catch(() => {});
    if (res.status === 401 || res.status === 403) {
      throw new Error(tr("Couldn't connect to GitLab. Check the server token and project permissions."));
    }
    throw new Error(tr("{step} failed ({status})", { step, status: res.status }));
  };
  const head = async (branch: string = conf.branch): Promise<string | null> => {
    if (!isSafeBranch(branch)) throw new Error("Invalid GitLab branch");
    const res = await request("/repository/branches/" + encodeURIComponent(branch));
    if (res.status === 404) return null;
    if (!res.ok) await fail(tr("Fetching the branch"), res);
    const data = await res.json() as { commit?: { id?: string } };
    if (!data.commit?.id || !/^[0-9a-f]{40}$/i.test(data.commit.id)) {
      throw new Error(tr("Couldn't load the published content"));
    }
    return data.commit.id;
  };
  const ensureProject = async (): Promise<void> => {
    const res = await request("");
    if (!res.ok) await fail(tr("Fetching the repository"), res);
    await res.body?.cancel().catch(() => {});
  };
  type GitLabTreeItem = { path: string; id: string; type: string };
  const tree = async (ref: string): Promise<GitLabTreeItem[]> => {
    const items: GitLabTreeItem[] = [];
    for (let page = 1; page <= 100; page++) {
      const path = "/repository/tree?recursive=true&per_page=100&page=" + page + "&ref=" + encodeURIComponent(ref);
      const res = await request(path);
      if (!res.ok) await fail(tr("Fetching the tree"), res);
      const batch = await res.json() as GitLabTreeItem[];
      if (!Array.isArray(batch) || batch.some(item => typeof item.path !== "string" ||
          !isSafeCommitPath(item.path) || !/^[0-9a-f]{40}$/i.test(item.id))) {
        throw new Error(tr("Publishing stopped because the complete file list could not be retrieved from the destination"));
      }
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error(tr("Publishing stopped because the complete file list could not be retrieved from the destination"));
  };
  const blob = async (sha: string): Promise<Uint8Array> => {
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("Invalid GitLab blob SHA");
    const res = await request("/repository/blobs/" + sha + "/raw");
    if (!res.ok) await fail(tr("Fetching the tree"), res);
    return new Uint8Array(await res.arrayBuffer());
  };
  const snapshot = async (ref?: string) => {
    const commit = ref ?? await head();
    if (!commit) {
      await ensureProject();
      return { head: null, blobs: Object.create(null) as Record<string, string>,
        manifest: Object.create(null) as Record<string, string>, generated: null as Record<string, string> | null };
    }
    const entries = await tree(commit);
    const blobs: Record<string, string> = Object.create(null);
    for (const item of entries) {
      if (item.type === "blob" || item.type === "commit") blobs[item.path] = item.id;
    }
    const textAt = async (path: string, required: boolean): Promise<string | null> => {
      const sha = blobs[path];
      if (!sha) return null;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(await blob(sha));
      } catch (error) {
        if (required) throw error;
        return null;
      }
    };
    const manifest: Record<string, string> = Object.create(null);
    const assetText = await textAt(ASSET_MANIFEST_PATH, false);
    if (assetText) {
      try {
        const parsed = JSON.parse(assetText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (isSafeCommitPath(k) && typeof v === "string") manifest[k] = v;
          }
        }
      } catch { /* Missing asset cache only increases upload work. */ }
    }
    const generatedText = await textAt(GENERATED_MANIFEST_PATH, true);
    const generated = generatedText === null ? null : parseGeneratedManifest(generatedText);
    if (generatedText !== null && generated === null) {
      throw new Error(tr("Publishing stopped because the generated file manifest is invalid."));
    }
    return { head: commit, blobs, manifest, generated };
  };
  const history = async (): Promise<{ head: string | null; commits: PublishCommit[] }> => {
    const current = await head();
    if (!current) return { head: null, commits: [] };
    const res = await request("/repository/commits?ref_name=" + encodeURIComponent(conf.branch) + "&per_page=30");
    if (!res.ok) await fail(tr("Fetching history"), res);
    const list = await res.json() as Array<{
      id: string; message: string; committed_date: string; web_url?: string;
    }>;
    if (!Array.isArray(list)) throw new Error(tr("Couldn't load the history"));
    return {
      head: current,
      commits: list.map(commit => ({
        sha: commit.id, message: commit.message.split("\n")[0],
        date: commit.committed_date,
        url: typeof commit.web_url === "string" && commit.web_url.startsWith("https://gitlab.com/")
          ? commit.web_url
          : "https://gitlab.com/" + conf.repo + "/-/commit/" + commit.id,
      })),
    };
  };
  /** Returns null if another writer changed the destination. Never retry a commit. */
  const commit = async (
    expectedHead: string | null, actions: GitLabCommitAction[], message: string, startBranch?: string,
  ): Promise<string | null> => {
    if (await head() !== expectedHead) return null;
    const res = await request("/repository/commits", {
      method: "POST",
      body: JSON.stringify({
        branch: conf.branch,
        ...(startBranch ? { start_branch: startBranch } : {}),
        commit_message: message,
        // GitLab compares each path's last commit at this ref with its current
        // last commit. A create action already requires its path to be absent.
        actions: actions.map(action => expectedHead && action.action !== "create"
          ? { ...action, last_commit_id: expectedHead } : action),
      }),
    });
    if (!res.ok) {
      if ((res.status === 400 || res.status === 409) && await head() !== expectedHead) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      await fail(tr("Creating the commit"), res);
    }
    const result = await res.json() as { id?: string };
    if (!result.id || !/^[a-f0-9]{40}$/i.test(result.id)) throw new Error(tr("Couldn't publish"));
    return result.id;
  };
  return { request, fail, head, tree, blob, snapshot, history, commit };
}

