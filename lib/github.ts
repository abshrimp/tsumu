import { envVar } from "./env";
import type { Tr } from "./i18n-server";
import type { PublishTarget } from "./generator";
import { DEFAULT_BRANCH, isSafeBranch, isSafeRepo, type SiteDest } from "./sites";

/**
 * 公開先（GitHub のリポジトリ）の設定と、GitHub API の呼び出し。
 *
 * 公開先にはサイトごとに1つのリポジトリを使い、本番は branch（main）に、
 * テスト公開は previewBranch（preview）にコミットする。Vercel・Netlify・Cloudflare Workers Builds
 * などは、本番以外のブランチをプレビュー環境としてビルドできるため、
 * ホスティング側の設定は1つで済む。トークン（GITHUB_TOKEN）は全サイトで共通
 */

const GH = "https://api.github.com";

export interface TargetConfig {
  token: string | undefined;
  repo: string | undefined;
  branch: string;
  /** 公開した後に開けるサイトの URL（任意） */
  url: string | undefined;
}

/** テスト公開を使うか（テスト公開のブランチが空なら使わない） */
export function previewEnabled(dest: SiteDest): boolean {
  return !!dest.previewBranch.trim();
}

/** 公開先ごとの設定（本番 = branch・siteUrl、テスト = previewBranch・previewUrl） */
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

/** 公開先の設定の誤り（テスト用の内容で本番を上書きしないよう、同じ公開先を指す設定も拒否する） */
export function configError(dest: SiteDest, target: PublishTarget, tr: Tr): string | null {
  const conf = targetConfig(dest, target);
  if (target === "test" && !previewEnabled(dest)) {
    return tr("Test publishing is off (set a test branch in the site settings to use it)");
  }
  if (!conf.token) {
    console.warn("Publishing is unavailable: GITHUB_TOKEN is not set");
    return tr("Publishing to GitHub isn't configured. Contact your administrator");
  }
  if (!conf.repo) {
    return tr("This site has no repository to publish to. Set one in the site settings on the home screen");
  }
  // 保存済みの古い設定でも、API の別のパスへ抜けるような名前は使わない
  if (!isSafeRepo(conf.repo) || !isSafeBranch(conf.branch)) {
    return tr("Invalid repository (use the owner/name format): {repo}", { repo: conf.repo });
  }
  if (sameDestination(targetConfig(dest, "test"), targetConfig(dest, "production"))) {
    return tr("The test site and live site point to the same repository and branch. Use a different branch");
  }
  return null;
}

/** ブランチ名の "/" はパスの区切りのまま残す（%2F にすると 404 になる） */
export function branchPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

/** GitHub は、移動したリポジトリを正規の API の URL にリダイレクトする。 */
async function fetchGitHubPath(path: string, init: RequestInit): Promise<Response> {
  for (let redirects = 0; ; redirects++) {
    const url = GH + path;
    // codeql[js/request-forgery] 定数の API のオリジンには、パスだけを付け足す。
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

/** 公開先のリポジトリに対する GitHub API の呼び出し（失敗したときは fail で例外にする） */
export function githubClient(conf: TargetConfig, tr: Tr) {
  const gh = (path: string, init?: RequestInit & { accept?: string }): Promise<Response> => {
    // トークンを、攻撃者が操作できる GitHub API のパスへ決して送ってはいけない。
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
        // GitHub API は User-Agent が必須（Workers の fetch は自動では付けない）
        "User-Agent": "tsumu-publish",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  };
  const fail = async (step: string, res: Response): Promise<never> => {
    // GitHub のエラーの本文には、呼び出し側が送ったデータが含まれることがある。公開用のトークンを
    // 付けたリクエストの横に、応答の本文をログに出してはいけない。
    console.error("GitHub API request failed", { repo: conf.repo, step, status: res.status });
    if (res.status === 401) {
      throw new Error(tr("Couldn't connect to GitHub. Contact your administrator"));
    }
    if (res.status === 403 || res.status === 404) {
      throw new Error(tr("{step} failed ({status}). Writing to the site repository may not be allowed. Contact your administrator", { step, status: res.status }));
    }
    throw new Error(tr("{step} failed ({status})", { step, status: res.status }));
  };
  /** ブランチの先端のコミット（ブランチが無いか、空のリポジトリなら null） */
  const head = async (): Promise<string | null> => {
    const res = await gh(`/git/ref/heads/${branchPath(conf.branch)}`);
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) await fail(tr("Fetching the branch"), res);
    return (await res.json()).object.sha as string;
  };
  return { gh, fail, head };
}

/** 公開の履歴（ブランチのコミットの一覧）の1件 */
export interface PublishCommit {
  sha: string;
  message: string;
  date: string;
  url: string;
}

/**
 * 強制せずにブランチを進める。タイムアウトしたリクエストも GitHub に届いて、
 * コミットが成功していることがある。失敗を報告したり、利用者に再試行を求めたりする前に、
 * 実際のブランチを確かめる。
 *
 * false を返すのは、本当に競合する更新があった場合だけで、それ以外の失敗は例外を投げる。
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

  // 例外や HTTP のエラーだけから、成功したと推測してはいけない。ブランチを1回読み、
  // 書き込みが成功した証拠とするのは、こちらが作ったコミットの SHA と完全に一致した場合だけ。
  try {
    const check = await gh(`/git/ref/heads/${branchPath(branch)}`);
    if (check.ok) {
      const data = (await check.json()) as { object?: { sha?: unknown } };
      if (data.object?.sha === commitSha) return true;
    }
  } catch {
    // 確認に失敗した場合は、元のネットワークや API の結果を正とする。
  }
  if (transportError) throw transportError;
  if (response?.status === 409 || response?.status === 422) return false;
  if (response) await fail(tr(branchExists ? "Updating the branch" : "Creating the branch"), response);
  throw new Error("Could not verify GitHub branch update");
}
