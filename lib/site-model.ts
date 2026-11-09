/**
 * サイト（1つの編集データと、その公開先）の純粋な型と入力検証。
 * データベースやサーバー専用の依存を持たず、クライアント・サーバーの双方から直接読み込める。
 */

export type SiteRole = "owner" | "editor" | "viewer";

export function isSiteRole(value: unknown): value is SiteRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

/** サイトの ID の形（URL やブラウザの保存のキーに使うため、英小文字・数字・ハイフンだけ） */
const SITE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isSiteId(v: unknown): v is string {
  return typeof v === "string" && SITE_ID_RE.test(v);
}

/** 公開先の設定（サイトごと） */
export type GitProvider = "github" | "gitlab";

export interface SiteDest {
  /** サイトごとのGitサービス。未指定時はGitHub。 */
  gitProvider?: GitProvider;
  /** 公開先リポジトリ。GitLabはサブグループにも対応する。 */
  repo: string | null;
  /** 本番のブランチ */
  branch: string;
  /** テスト公開のブランチ（空 = テスト公開を使わない） */
  previewBranch: string;
  /** 公開した後に開ける本番のサイトの URL（任意） */
  siteUrl: string | null;
  /** テストのサイトの URL（任意） */
  previewUrl: string | null;
}

export interface SiteRecord extends SiteDest {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 編集データを最後に保存した時刻（まだ無ければ null） */
  savedAt?: number | null;
  accessRole?: SiteRole;
}

/** 新しいサイトの作成と、設定の変更で受け取る項目 */
export type SiteInput = Partial<Pick<SiteRecord, "name" | keyof SiteDest>>;

export const DEFAULT_BRANCH = "main";
export const DEFAULT_PREVIEW_BRANCH = "preview";

const REPO_RE = /^[\w.-]+(?:\/[\w.-]+){1,9}$/;
const BRANCH_RE = /^[\w.][\w./-]*$/;

/**
 * GitHub API のパスに入れても、別のパスへ抜けない名前か（「.」「..」の区切りを含まない）。
 * こうした名前は、GitHub のリポジトリ名や git のブランチ名としても、もともと使えない
 */
export function isSafeRepo(repo: string, provider: GitProvider = "github"): boolean {
  const segments = repo.split("/");
  return REPO_RE.test(repo) && (provider === "gitlab" || segments.length === 2) &&
    segments.every((s) => s !== "." && s !== "..");
}

/** git のブランチ名の決まり（git check-ref-format）のうち、パスの抜け道になるものと、使えないもの */
export function isSafeBranch(branch: string): boolean {
  return (
    BRANCH_RE.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.split("/").some((s) => s.startsWith(".") || s.endsWith(".lock"))
  );
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * 入力を確かめて、保存できる形にする。検証に失敗したときは、翻訳のための英語の原文を返す。
 * base は変更前の値（新規作成では既定値）
 */
export function normalizeSiteInput(
  input: SiteInput,
  base: Pick<SiteRecord, "name" | keyof SiteDest>
): { ok: true; value: Pick<SiteRecord, "name" | keyof SiteDest> } | { ok: false; error: string } {
  const has = (k: keyof SiteInput) => Object.prototype.hasOwnProperty.call(input, k);
  const name = has("name") ? clean(input.name) : base.name;
  if (!name) return { ok: false, error: "Enter a site name" };
  if (name.length > 100) return { ok: false, error: "Site names can be up to 100 characters" };

  const rawProvider = has("gitProvider") ? input.gitProvider : base.gitProvider;
  if (rawProvider !== undefined && rawProvider !== "github" && rawProvider !== "gitlab") {
    return { ok: false, error: "Select GitHub or GitLab as the Git provider" };
  }
  const gitProvider = rawProvider ?? "github";
  const repo = has("repo") ? clean(input.repo) || null : base.repo;
  if (repo && !isSafeRepo(repo, gitProvider)) {
    return { ok: false, error: "Enter the repository as owner/name" };
  }
  const branch = has("branch") ? clean(input.branch) || DEFAULT_BRANCH : base.branch;
  const previewBranch = has("previewBranch") ? clean(input.previewBranch) : base.previewBranch;
  if (!isSafeBranch(branch) || (previewBranch && !isSafeBranch(previewBranch))) {
    return { ok: false, error: "The branch name contains characters that aren't allowed" };
  }
  if (previewBranch && previewBranch === branch) {
    return { ok: false, error: "Use a different branch for test publishing than for production" };
  }
  const url = (k: "siteUrl" | "previewUrl") => (has(k) ? clean(input[k]) || null : base[k]);
  const siteUrl = url("siteUrl");
  const previewUrl = url("previewUrl");
  for (const u of [siteUrl, previewUrl]) {
    if (!u) continue;
    if (!/^https?:\/\/[^\s\\]+$/i.test(u) || !URL.canParse(u)) {
      return { ok: false, error: "URLs must start with http:// or https://" };
    }
    const parsed = new URL(u);
    if (parsed.username || parsed.password) {
      return { ok: false, error: "URLs must start with http:// or https://" };
    }
  }
  return { ok: true, value: { name, ...(rawProvider ? { gitProvider } : {}), repo, branch, previewBranch, siteUrl, previewUrl } };
}

/** 新しいサイトの ID（推測されにくい英数字10文字） */
export function newSiteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
