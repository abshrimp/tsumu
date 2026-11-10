import { envVar } from "./env";
import type { Tr } from "./i18n-server";
import type { PublishTarget } from "./generator";
import { DEFAULT_BRANCH, isSafeBranch, isSafeRepo, type SiteDest } from "./sites";

/**
 * 公開先（GitHubリポジトリ）の設定と、GitHub API の呼び出し。
 *
 * 公開先はサイトごとに1つのリポジトリを使い、本番は branch（main）、
 * テスト公開は previewBranch（preview）へコミットする。Vercel・Cloudflare Workers Builds・
 * Netlify などは本番以外のブランチを自動でプレビュー環境としてビルドするため、
 * ホスティング側の設定は1つで済む。トークン（GITHUB_TOKEN）は全サイトで共通
 */

const GH = "https://api.github.com";

export interface TargetConfig {
  token: string | undefined;
  repo: string | undefined;
  branch: string;
  /** 公開後に開けるサイトのURL（任意） */
  url: string | undefined;
}

/** テスト公開を使うか（テスト公開のブランチが空なら使わない） */
export function previewEnabled(dest: SiteDest): boolean {
  return !!dest.previewBranch.trim();
}

/** 公開先ごとの設定（本番 = branch・siteUrl / テスト = previewBranch・previewUrl） */
export function targetConfig(dest: SiteDest, target: PublishTarget): TargetConfig {
  return {
    token: envVar("GITHUB_TOKEN"),
    repo: target === "test" && !previewEnabled(dest) ? undefined : dest.repo ?? undefined,
    branch: target === "test" ? dest.previewBranch.trim() : dest.branch || DEFAULT_BRANCH,
    url: (target === "test" ? dest.previewUrl : dest.siteUrl) ?? undefined,
  };
}

const sameDestination = (a: TargetConfig, b: TargetConfig) =>
  !!a.repo &&
  a.repo.toLowerCase() === b.repo?.toLowerCase() &&
  a.branch === b.branch;

/** 公開先の設定の誤り（テスト用の内容で本番を上書きしないよう、同じ公開先も拒否する） */
export function configError(dest: SiteDest, target: PublishTarget, tr: Tr): string | null {
  const conf = targetConfig(dest, target);
  if (target === "test" && !previewEnabled(dest)) {
    return tr("テスト公開は無効になっています（サイトの設定でテスト公開のブランチを指定すると使えます）");
  }
  if (!conf.token) {
    console.warn("Publishing is unavailable: GITHUB_TOKEN is not set");
    return tr("GitHubへの公開が設定されていません。管理者に確認してください");
  }
  if (!conf.repo) {
    return tr("このサイトの公開先リポジトリが設定されていません。ホーム画面のサイトの設定で指定してください");
  }
  // 保存済みの古い設定も、API の別のパスへ抜ける名前は使わない
  if (!isSafeRepo(conf.repo) || !isSafeBranch(conf.branch)) {
    return tr("リポジトリの指定が正しくありません（owner/name の形で指定してください）: {repo}", { repo: conf.repo });
  }
  if (sameDestination(targetConfig(dest, "test"), targetConfig(dest, "production"))) {
    return tr("テストサイトと本番サイトの公開先（リポジトリ・ブランチ）が同じです。別のブランチを指定してください");
  }
  return null;
}

/** ブランチ名の "/" はパス区切りのまま残す（%2F にすると404になる） */
export function branchPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

/** GitHub redirects moved repositories to their canonical API URL. */
async function fetchGitHubPath(path: string, init: RequestInit): Promise<Response> {
  for (let redirects = 0; ; redirects++) {
    const url = GH + path;
    // codeql[js/request-forgery] Only a path is appended to the constant API origin.
    const response = await fetch(url, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || ![301, 302, 303, 307, 308].includes(response.status)) return response;
    void response.body?.cancel().catch(() => {});
    if (redirects >= 5) throw new Error("Too many GitHub API redirects");
    const next = new URL(location, url);
    if (next.protocol !== "https:" || next.origin !== GH || next.username || next.password) {
      throw new Error("Invalid GitHub API redirect");
    }
    path = next.pathname + next.search;
    if (response.status === 303 && init.method !== "HEAD") {
      const headers = new Headers(init.headers);
      headers.delete("Content-Type");
      init = { ...init, method: "GET", body: undefined, headers };
    }
  }
}

/** 公開先リポジトリに対する GitHub API の呼び出し（失敗時は fail で例外にする） */
export function githubClient(conf: TargetConfig, tr: Tr) {
  const gh = (path: string, init?: RequestInit & { accept?: string }): Promise<Response> => {
    // The token must never be sent to an attacker-controlled GitHub API path.
    if (!conf.repo || !isSafeRepo(conf.repo) || !isSafeBranch(conf.branch) ||
        !path.startsWith("/") || path.startsWith("//") || /[\\\\#]/.test(path) ||
        path.split(/[/?]/).some((segment) => segment === "." || segment === ".." || /%(?:2e|2f|5c)/i.test(segment))) {
      throw new Error("Invalid GitHub API destination");
    }
    return fetchGitHubPath(`/repos/${conf.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${conf.token}`,
        Accept: init?.accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // GitHub APIはUser-Agent必須（Workersのfetchは自動付与しない）
        "User-Agent": "tsumu-publish",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  };
  const fail = async (step: string, res: Response): Promise<never> => {
    // GitHub error bodies can contain data supplied by the caller. Never log
    // response text next to a request that carries the publishing token.
    console.error("GitHub API request failed", { repo: conf.repo, step, status: res.status });
    if (res.status === 401) {
      throw new Error(tr("GitHubに接続できませんでした。管理者に確認してください"));
    }
    if (res.status === 403 || res.status === 404) {
      throw new Error(tr("{step}に失敗しました（{status}）。公開先リポジトリへの書き込みが許可されていない可能性があります。管理者に確認してください", { step, status: res.status }));
    }
    throw new Error(tr("{step}に失敗しました（{status}）", { step, status: res.status }));
  };
  /** ブランチ先端のコミット（ブランチが無い・空リポジトリなら null） */
  const head = async (): Promise<string | null> => {
    const res = await gh(`/git/ref/heads/${branchPath(conf.branch)}`);
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) await fail(tr("ブランチの取得"), res);
    return (await res.json()).object.sha as string;
  };
  return { gh, fail, head };
}

/** 公開の履歴（ブランチのコミット一覧）の1件 */
export interface PublishCommit {
  sha: string;
  message: string;
  date: string;
  url: string;
}

/**
 * Move a branch forward without force. A timed-out request may have reached
 * GitHub and committed successfully: check the actual ref before reporting
 * failure or asking the user to retry.
 *
 * Returns false only for a genuine conflicting update; other failures throw.
 */
export async function advanceBranchRef(
  gh: ReturnType<typeof githubClient>["gh"],
  fail: ReturnType<typeof githubClient>["fail"],
  branch: string,
  commitSha: string,
  branchExists: boolean,
  tr: Tr
): Promise<boolean> {
  let response: Response | undefined;
  let transportError: unknown;
  try {
    response = branchExists
      ? await gh(`/git/refs/heads/${branchPath(branch)}`, {
          method: "PATCH",
          body: JSON.stringify({ sha: commitSha, force: false }),
        })
      : await gh("/git/refs", {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
        });
  } catch (error) {
    transportError = error;
  }
  if (response?.ok) return true;

  // Never infer success from an exception or HTTP error alone. Read the ref
  // once; treat only our exact commit SHA as proof that the write succeeded.
  try {
    const check = await gh(`/git/ref/heads/${branchPath(branch)}`);
    if (check.ok) {
      const data = (await check.json()) as { object?: { sha?: unknown } };
      if (data.object?.sha === commitSha) return true;
    }
  } catch {
    // Original network/API outcome remains authoritative if verification fails.
  }
  if (transportError) throw transportError;
  if (response?.status === 409 || response?.status === 422) return false;
  if (response) await fail(tr(branchExists ? "ブランチの更新" : "ブランチの作成"), response);
  throw new Error("Could not verify GitHub branch update");
}
