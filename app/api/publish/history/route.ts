import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { recordPublish, requireAuth } from "../../../../lib/server";
import {
  advanceBranchRef,
  configError,
  githubClient,
  targetConfig,
  type PublishCommit,
  type TargetConfig,
} from "../../../../lib/github";
import type { PublishTarget } from "../../../../lib/generator";
import { userMessage } from "../../../../lib/errors";
import { destParam, siteDestOf, siteIdOf } from "../../../../lib/site-server";
import {
  DOC_PATH,
  GENERATED_MANIFEST_PATH,
  conflictingCommitPaths,
  isProtectedPath,
  isSafeCommitPath,
  keptTreeEntries,
  parseGeneratedManifest,
  planPublish,
  protectedTreeEdits,
  serializeGeneratedManifest,
  type TreeEntry,
} from "../../../../lib/publish-files";

import { matchesPublishTarget, publishConflictMessage } from "../../../../lib/publish-preconditions";
import { hasPublishCredentials } from "../../../../lib/publish-security";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../../lib/api-json";

export const maxDuration = 30;
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_ROLLBACK_REQUEST_BYTES = 128 * 1024;

const isSha = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{40}$/i.test(s);

/** 別のブランチの SHA（または到達できないコミット）は、GitHub から読めても、
 * 選択した公開先の履歴には含めない。 */
async function belongsToHistory(
  gh: (path: string) => Promise<Response>,
  fail: (step: string, response: Response) => Promise<never>,
  tr: (message: string) => string,
  sha: string,
  head: string
): Promise<boolean> {
  if (sha === head) return true;
  const res = await gh(`/compare/${sha}...${head}`);
  if (res.status === 404 || res.status === 422) return false;
  if (!res.ok) await fail(tr("Fetching the selected version"), res);
  const data = (await res.json()) as { merge_base_commit?: { sha?: unknown } };
  // リポジトリに存在するだけでは、その版への復元を許可しない。
  return data.merge_base_commit?.sha === sha;
}

function parseTarget(v: unknown): PublishTarget {
  return v === "test" ? "test" : "production";
}

/**
 * 公開の履歴（公開先のブランチのコミット）。
 * ?target=production|test で一覧を、&doc=<sha> でその版の編集データを返す
 */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const target = parseTarget(params.get("target"));
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const dest = await siteDestOf(siteId, destParam(params));
  if (dest instanceof NextResponse) return dest;
  let expected: unknown;
  try { expected = JSON.parse(params.get("expected") ?? "null"); } catch { /* invalid contract */ }
  if (!expected) return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 400 });
  if (!matchesPublishTarget(expected, siteId, target, targetConfig(dest, target), targetConfig(dest, "production").branch)) {
    return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
  }
  const confError = configError(dest, target, tr);
  if (confError) return NextResponse.json({ error: confError }, { status: 503 });
  const conf = targetConfig(dest, target) as Required<TargetConfig>;
  const { gh, fail, head } = githubClient(conf, tr);

  try {
    const docSha = params.get("doc");
    if (docSha) {
      if (!isSha(docSha)) {
        return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
      }
      const current = await head();
      if (!current || !(await belongsToHistory(gh, fail, tr, docSha, current))) {
        return NextResponse.json({ error: tr("This version doesn't include editor data") }, { status: 404 });
      }
      // raw 形式で受け取り、パースせずにそのまま返す（大きな編集データでも CPU 時間を使わない）
      const res = await gh(`/contents/${DOC_PATH}?ref=${docSha}`, {
        accept: "application/vnd.github.raw+json",
      });
      if (res.status === 404) {
        return NextResponse.json(
          { error: tr("This version doesn't include editor data") },
          { status: 404 }
        );
      }
      if (!res.ok) await fail(tr("Fetching editor data"), res);
      return new NextResponse(res.body, {
        headers: { ...PRIVATE_NO_STORE, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const current = await head();
    if (!current) return NextResponse.json({ head: null, commits: [] }, { headers: PRIVATE_NO_STORE });
    const res = await gh(`/commits?sha=${current}&per_page=30`);
    if (!res.ok) await fail(tr("Fetching history"), res);
    const list = (await res.json()) as {
      sha: string;
      html_url: string;
      commit: { message: string; committer?: { date?: string }; author?: { date?: string } };
    }[];
    const commits: PublishCommit[] = list.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      date: c.commit.committer?.date ?? c.commit.author?.date ?? "",
      url: c.html_url,
    }));
    return NextResponse.json({ head: current, commits }, { headers: PRIVATE_NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't load the history")) },
      { status: 502 }
    );
  }
}

/**
 * ロールバック: 指定した版と同じ内容のコミットを、現在の先端の上に積む。
 * 履歴を消さない（force push しない）ため、ロールバック自体も後から戻せる
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  let body: { target?: unknown; sha?: unknown; site?: string; dest?: unknown; expected?: unknown; expectedHead?: unknown };
  try {
    const value = await readJsonLimited(req, MAX_ROLLBACK_REQUEST_BYTES);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    body = value as typeof body;
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413
      : error instanceof JsonContentTypeError ? 415 : 400;
    return NextResponse.json({ error: tr(status === 413 ? "Request too large" : "Invalid request", status === 413 ? undefined : "invalid_request_variant_1") }, { status });
  }
  if (!isSha(body.sha)) {
    return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
  }
  const sha = body.sha;
  const target = parseTarget(body.target);
  const siteId = await siteIdOf(body.site);
  if (siteId instanceof NextResponse) return siteId;
  const dest = await siteDestOf(siteId, body.dest);
  if (dest instanceof NextResponse) return dest;
  if (!body.expected || typeof body.expectedHead !== "string" || !body.expectedHead) {
    return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 400 });
  }
  if (!matchesPublishTarget(body.expected, siteId, target, targetConfig(dest, target), targetConfig(dest, "production").branch)) {
    return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
  }
  const confError = configError(dest, target, tr);
  if (confError) return NextResponse.json({ error: confError }, { status: 503 });
  const conf = targetConfig(dest, target) as Required<TargetConfig>;
  const { gh, fail, head } = githubClient(conf, tr);

  try {
    const current = await head();
    if (!current) {
      return NextResponse.json({ error: tr("Not published yet") }, { status: 404 });
    }
    if (current !== body.expectedHead) return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    if (!(await belongsToHistory(gh, fail, tr, sha, current))) {
      return NextResponse.json({ error: tr("Invalid parameters") }, { status: 404 });
    }
    const srcRes = await gh(`/git/commits/${sha}`);
    if (!srcRes.ok) await fail(tr("Fetching the selected version"), srcRes);
    const src = (await srcRes.json()) as { tree: { sha: string }; message: string };
    // ロールバックで戻すのは生成したサイトで、手動で管理しているファイルは対象外。
    // 両方の版の全体を比べ、古いコミットより後に手動で追加したファイルは残す。
    // 省かれたファイルを削除してしまわないよう、一部しか読めないツリーは受け付けない。
    const readTree = async (commit: string): Promise<TreeEntry[]> => {
      const res = await gh(`/git/trees/${commit}?recursive=1`);
      if (!res.ok) await fail(tr("Fetching the tree"), res);
      const result = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
      if (result.truncated || !Array.isArray(result.tree) ||
          result.tree.some(entry => !isSafeCommitPath(entry.path))) {
        throw new Error(tr("Publishing stopped because the complete file list could not be retrieved from the destination"));
      }
      return result.tree;
    };
    const [sourceEntries, currentEntries] = await Promise.all([
      readTree(src.tree.sha), readTree(current),
    ]);
    // ロールバックも公開の一種。通常の公開では拒否する認証情報の設定を、
    // 古い編集データから持ち込まないようにする。
    const sourceDoc = sourceEntries.find(entry => entry.path === DOC_PATH && entry.type === "blob");
    if (sourceDoc?.sha) {
      const docRes = await gh(`/git/blobs/${sourceDoc.sha}`);
      if (!docRes.ok) await fail(tr("Fetching editor data"), docRes);
      const blob = (await docRes.json()) as { content?: unknown; encoding?: unknown };
      if (typeof blob.content !== "string" || (blob.encoding && blob.encoding !== "base64")) {
        return NextResponse.json({ error: tr("Not an editor data file") }, { status: 400 });
      }
      const bytes = Buffer.from(blob.content, "base64");
      if (bytes.byteLength > 12 * 1024 * 1024) {
        return NextResponse.json({ error: tr("doc.json exceeds the size limit.") }, { status: 400 });
      }
      let doc: unknown;
      try { doc = JSON.parse(bytes.toString("utf8")); } catch {
        return NextResponse.json({ error: tr("Not an editor data file") }, { status: 400 });
      }
      if (hasPublishCredentials(doc as Parameters<typeof hasPublishCredentials>[0])) {
        return NextResponse.json({
          error: tr("Editable data that contains credentials cannot be pushed to GitHub. Remove the API keys or passwords and manage them with server environment variables instead."),
        }, { status: 400 });
      }
    }
    const leaf = (entries: TreeEntry[]) => entries.filter(
      entry => (entry.type === "blob" || entry.type === "commit") && !!entry.sha
    );
    const blobsOf = (items: TreeEntry[]): Record<string, string> => {
      const blobs: Record<string, string> = Object.create(null);
      for (const entry of leaf(items)) blobs[entry.path] = entry.sha!;
      return blobs;
    };
    const currentBlobs = blobsOf(currentEntries);
    const sourceBlobs = blobsOf(sourceEntries);

    // 両方の版について、どのファイルを生成したかの記録を読む。過去のファイルを
    // すべて生成物とみなしてはいけない。選んだ版より後に手動のファイルを削除している
    // 場合があり、ロールバックではその削除も尊重する。
    const readGenerated = async (blobs: Record<string, string>): Promise<Record<string, string> | null> => {
      const sha = blobs[GENERATED_MANIFEST_PATH];
      if (!sha) return null;
      const res = await gh(`/git/blobs/${sha}`);
      if (!res.ok) await fail(tr("Fetching the tree"), res);
      const data = (await res.json()) as { content?: unknown; encoding?: unknown };
      if (typeof data.content !== "string" || (data.encoding && data.encoding !== "base64")) {
        throw new Error(tr("Publishing stopped because the generated file manifest is invalid."));
      }
      const parsed = parseGeneratedManifest(Buffer.from(data.content, "base64").toString("utf8"));
      if (!parsed) throw new Error(tr("Publishing stopped because the generated file manifest is invalid."));
      return parsed;
    };
    const generated = await readGenerated(currentBlobs);
    const sourceGenerated = await readGenerated(sourceBlobs);
    const sourcePaths = leaf(sourceEntries).map(entry => entry.path);
    const manual = planPublish(currentBlobs, generated, []);
    const keptPaths = Object.keys(manual.kept).filter(path => !isProtectedPath(path));
    const kept = keptTreeEntries(currentEntries, keptPaths);
    // 古い版の生成ファイルの一覧があれば、過去のツリーで手動のファイルだったものは、
    // 現在の削除をそのまま残す。現在のツリーにない生成ファイルは復元する。
    const deletedManual = sourceGenerated
      ? leaf(sourceEntries).filter(entry =>
          !isProtectedPath(entry.path) && !entry.path.startsWith("_tsumu/") &&
          !Object.hasOwn(sourceGenerated, entry.path) &&
          !Object.hasOwn(currentBlobs, entry.path))
      : [];
    const deletedPaths = new Set(deletedManual.map(entry => entry.path));
    if (!kept || conflictingCommitPaths([
      ...sourcePaths.filter(path => !isProtectedPath(path) && !deletedPaths.has(path)), ...keptPaths,
    ])) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 409 });
    }
    // .github はサブツリーごと残す。この Git Trees API のリクエストで、その中のファイルを
    // 個別に書き込むと、サブツリーが置き換わってしまうため書き込まない。
    const sourceRoot = sourceEntries.filter(entry => !entry.path.includes("/"));
    const currentRoot = currentEntries.filter(entry => !entry.path.includes("/"));
    const sourceByPath = new Map(sourceEntries.map(entry => [entry.path, entry]));
    // 手動のファイルとディレクトリが入れ替わった場合は、古いパスを先に別のツリーで取り除く。
    // 親と子の編集を同時に渡さず、最後のコミットまでブランチの先端は動かさない。
    const pruneFirst = !!conflictingCommitPaths([
      ...sourcePaths.filter(path => !isProtectedPath(path)), ...keptPaths,
    ]);
    const deletions: TreeEntry[] = deletedManual.map(entry => ({
      path: entry.path, mode: entry.mode, type: entry.type, sha: null,
    }));
    const edits: (TreeEntry | { path: string; mode: "100644"; type: "blob"; content: string })[] = [
      ...protectedTreeEdits(sourceRoot, currentRoot),
      ...(!pruneFirst ? deletions : []),
      ...kept.filter(entry => {
        const prior = sourceByPath.get(entry.path);
        return !prior || prior.sha !== entry.sha || prior.mode !== entry.mode || prior.type !== entry.type;
      }),
    ];
    // 残す手動ファイルが、以前は生成ファイルだったパスを使っている場合がある。
    // 古い所有の情報を戻すと、内容や Git の属性が過去の版と一致していても、
    // 次の公開でそのファイルを削除してしまう。
    if (sourceGenerated && keptPaths.some(path => Object.hasOwn(sourceGenerated, path))) {
      const retained = new Set(keptPaths);
      edits.push({
        path: GENERATED_MANIFEST_PATH,
        mode: "100644",
        type: "blob",
        content: serializeGeneratedManifest(Object.fromEntries(
          Object.entries(sourceGenerated).filter(([path]) => !retained.has(path))
        )),
      });
    }
    let treeSha = src.tree.sha;
    for (const changes of pruneFirst ? [deletions, edits] : [edits]) {
      if (!changes.length) continue;
      const treeRes = await gh(`/git/trees`, {
        method: "POST",
        body: JSON.stringify({ base_tree: treeSha, tree: changes }),
      });
      if (!treeRes.ok) await fail(tr("Creating the tree"), treeRes);
      treeSha = ((await treeRes.json()) as { sha: string }).sha;
    }
    const commitRes = await gh(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: `Rollback to ${sha.slice(0, 7)}: ${src.message.split("\n")[0]}`,
        tree: treeSha,
        parents: [current],
      }),
    });
    if (!commitRes.ok) await fail(tr("Creating the commit"), commitRes);
    const commitSha = (await commitRes.json()).sha as string;
    if (!(await advanceBranchRef(gh, fail, conf.branch, commitSha, true, tr))) {
      return NextResponse.json(
        { error: tr("Another publish happened at the same time. Reload the history and try again.") },
        { status: 409 }
      );
    }
    // GitHub のブランチはすでに更新されている。記録の保存に失敗しても、
    // ロールバックの失敗として報告し、重複したロールバックのコミットを促すことはしない。
    try {
      await recordPublish(siteId, target, dest.roomKey);
    } catch {
      console.warn("Rollback completed, but the local publication record could not be updated", { siteId, target });
    }
    return NextResponse.json({
      ok: true,
      commit: commitSha,
      commitUrl: `https://github.com/${conf.repo}/commit/${commitSha}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't roll back")) },
      { status: 502 }
    );
  }
}
