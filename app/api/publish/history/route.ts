import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { recordPublish, requireAuth } from "../../../../lib/server";
import {
  branchPath,
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
import { rollbackPwaRetirement } from "../../../../lib/publish-pwa";

export const maxDuration = 30;
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

const isSha = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{40}$/i.test(s);

/** A SHA from a different branch (or an unreachable commit) is not a history
 * entry for the selected publication target, even when GitHub can read it. */
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
  if (!res.ok) await fail(tr("指定した版の取得"), res);
  const data = (await res.json()) as { merge_base_commit?: { sha?: unknown } };
  // Merely existing in the repository does not authorize restoration.
  return data.merge_base_commit?.sha === sha;
}

function parseTarget(v: unknown): PublishTarget {
  return v === "test" ? "test" : "production";
}

/**
 * 公開の履歴（公開先ブランチのコミット）。
 * ?target=production|test で一覧、&doc=<sha> でその版の編集データを返す
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
        return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 400 });
      }
      const current = await head();
      if (!current || !(await belongsToHistory(gh, fail, tr, docSha, current))) {
        return NextResponse.json({ error: tr("この版には編集データが含まれていません") }, { status: 404 });
      }
      // raw で受け取り、パースせずにそのまま返す（大きな編集データでもCPU時間を使わない）
      const res = await gh(`/contents/${DOC_PATH}?ref=${docSha}`, {
        accept: "application/vnd.github.raw+json",
      });
      if (res.status === 404) {
        return NextResponse.json(
          { error: tr("この版には編集データが含まれていません") },
          { status: 404 }
        );
      }
      if (!res.ok) await fail(tr("編集データの取得"), res);
      return new NextResponse(res.body, {
        headers: { ...PRIVATE_NO_STORE, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const current = await head();
    if (!current) return NextResponse.json({ head: null, commits: [] }, { headers: PRIVATE_NO_STORE });
    const res = await gh(`/commits?sha=${current}&per_page=30`);
    if (!res.ok) await fail(tr("履歴の取得"), res);
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
      { error: tr(userMessage(e, "履歴を読み込めませんでした")) },
      { status: 502 }
    );
  }
}

/**
 * ロールバック: 指定した版と同じ内容のコミットを、いまの先端の上に積む。
 * 履歴を消さない（force push しない）ので、ロールバック自体もあとから戻せる
 */
export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  let body: { target?: unknown; sha?: unknown; site?: string; dest?: unknown; expected?: unknown; expectedHead?: unknown };
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError();
  } catch {
    return NextResponse.json({ error: tr("リクエストが正しくありません") }, { status: 400 });
  }
  if (!isSha(body.sha)) {
    return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 400 });
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
      return NextResponse.json({ error: tr("まだ公開されていません") }, { status: 404 });
    }
    if (current !== body.expectedHead) return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    if (!(await belongsToHistory(gh, fail, tr, sha, current))) {
      return NextResponse.json({ error: tr("指定が正しくありません") }, { status: 404 });
    }
    const srcRes = await gh(`/git/commits/${sha}`);
    if (!srcRes.ok) await fail(tr("指定した版の取得"), srcRes);
    const src = (await srcRes.json()) as { tree: { sha: string }; message: string };
    // A rollback replaces the generated site, not manually maintained files.
    // Compare full snapshots and keep manual files added after the old commit.
    // Refuse partial trees, since an omitted file could otherwise be deleted.
    const readTree = async (commit: string): Promise<TreeEntry[]> => {
      const res = await gh(`/git/trees/${commit}?recursive=1`);
      if (!res.ok) await fail(tr("ツリーの取得"), res);
      const result = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
      if (result.truncated || !Array.isArray(result.tree) ||
          result.tree.some(entry => !isSafeCommitPath(entry.path))) {
        throw new Error(tr("公開先のファイル一覧をすべて取得できなかったため、公開を中止しました"));
      }
      return result.tree;
    };
    const [sourceEntries, currentEntries] = await Promise.all([
      readTree(src.tree.sha), readTree(current),
    ]);
    // A rollback is also a publication. It must not reintroduce credential
    // settings from an older editable document that normal publishing rejects.
    const sourceDoc = sourceEntries.find(entry => entry.path === DOC_PATH && entry.type === "blob");
    if (sourceDoc?.sha) {
      const docRes = await gh(`/git/blobs/${sourceDoc.sha}`);
      if (!docRes.ok) await fail(tr("編集データの取得"), docRes);
      const blob = (await docRes.json()) as { content?: unknown; encoding?: unknown };
      if (typeof blob.content !== "string" || (blob.encoding && blob.encoding !== "base64")) {
        return NextResponse.json({ error: tr("編集データの形式ではありません") }, { status: 400 });
      }
      const bytes = Buffer.from(blob.content, "base64");
      if (bytes.byteLength > 12 * 1024 * 1024) {
        return NextResponse.json({ error: tr("doc.jsonが大きすぎます。") }, { status: 400 });
      }
      let doc: unknown;
      try { doc = JSON.parse(bytes.toString("utf8")); } catch {
        return NextResponse.json({ error: tr("編集データの形式ではありません") }, { status: 400 });
      }
      if (hasPublishCredentials(doc as Parameters<typeof hasPublishCredentials>[0])) {
        return NextResponse.json({
          error: tr("認証情報を含む編集データはGitHubへPushできません。APIキーやパスワードを削除し、サーバーの環境変数などで管理してください。"),
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

    // Read ownership metadata for both revisions. Never infer that every
    // historical file was generated: a user may have deleted a manual file
    // after the chosen snapshot, and rollback must respect that deletion.
    const readGenerated = async (blobs: Record<string, string>): Promise<Record<string, string> | null> => {
      const sha = blobs[GENERATED_MANIFEST_PATH];
      if (!sha) return null;
      const res = await gh(`/git/blobs/${sha}`);
      if (!res.ok) await fail(tr("ツリーの取得"), res);
      const data = (await res.json()) as { content?: unknown; encoding?: unknown };
      if (typeof data.content !== "string" || (data.encoding && data.encoding !== "base64")) {
        throw new Error(tr("公開ファイル一覧が壊れているため、公開を中止しました"));
      }
      const parsed = parseGeneratedManifest(Buffer.from(data.content, "base64").toString("utf8"));
      if (!parsed) throw new Error(tr("公開ファイル一覧が壊れているため、公開を中止しました"));
      return parsed;
    };
    const generated = await readGenerated(currentBlobs);
    const sourceGenerated = await readGenerated(sourceBlobs);
    const sourcePaths = leaf(sourceEntries).map(entry => entry.path);
    const manual = planPublish(currentBlobs, generated, []);
    const keptPaths = Object.keys(manual.kept).filter(path => !isProtectedPath(path));
    const kept = keptTreeEntries(currentEntries, keptPaths);
    // When the older generated-file manifest exists, retain current deletions
    // of files that were manually owned in the historical tree. Generated
    // files absent from the current tree must still be restored.
    const deletedManual = sourceGenerated
      ? leaf(sourceEntries).filter(entry =>
          !isProtectedPath(entry.path) && !entry.path.startsWith("_tsumu/") &&
          !Object.hasOwn(sourceGenerated, entry.path) &&
          !Object.hasOwn(currentBlobs, entry.path))
      : [];
    const deletedPaths = new Set(deletedManual.map(entry => entry.path));
    const restoredPaths = sourcePaths.filter(path => !isProtectedPath(path) && !deletedPaths.has(path));
    const retirement = await rollbackPwaRetirement(generated, sourcePaths, [...restoredPaths, ...keptPaths], sourceGenerated);
    const addedPaths = retirement ? [retirement.path] : [];
    if (!kept || conflictingCommitPaths([...restoredPaths, ...keptPaths, ...addedPaths])) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 409 });
    }
    // Preserve .github as a whole subtree. Do not also write its nested files
    // in this Git Trees API request; that could replace the subtree.
    const sourceRoot = sourceEntries.filter(entry => !entry.path.includes("/"));
    const currentRoot = currentEntries.filter(entry => !entry.path.includes("/"));
    const sourceByPath = new Map(sourceEntries.map(entry => [entry.path, entry]));
    // 手動ファイルとディレクトリを入れ替えた場合は、古いパスを先に別ツリーから除く。
    // 親と子の編集を同時に渡さず、最後のコミットまでブランチの先端は動かさない。
    const pruneFirst = !!conflictingCommitPaths([
      ...sourcePaths.filter(path => !isProtectedPath(path)), ...keptPaths, ...addedPaths,
    ]);
    const deletions: TreeEntry[] = deletedManual.map(entry => ({
      path: entry.path, mode: entry.mode, type: entry.type, sha: null,
    }));
    const edits: (TreeEntry | { path: string; mode: "100644"; type: "blob"; content: string })[] = [
      ...protectedTreeEdits(sourceRoot, currentRoot),
      ...(!pruneFirst ? deletions : []),
      ...(retirement ? [{ path: retirement.path, mode: "100644" as const, type: "blob" as const, content: retirement.content }] : []),
      ...kept.filter(entry => {
        const prior = sourceByPath.get(entry.path);
        return !prior || prior.sha !== entry.sha || prior.mode !== entry.mode || prior.type !== entry.type;
      }),
    ];
    // A retained manual file may reuse a formerly generated path. Restoring
    // its old ownership would let the next publish delete it, even when its
    // content and Git attributes happen to match the historical version.
    if (retirement || (sourceGenerated && keptPaths.some(path => Object.hasOwn(sourceGenerated, path)))) {
      const retained = new Set(keptPaths);
      edits.push({
        path: GENERATED_MANIFEST_PATH,
        mode: "100644",
        type: "blob",
        content: serializeGeneratedManifest({
          ...Object.fromEntries(Object.entries(sourceGenerated ?? {}).filter(([path]) => !retained.has(path))),
          ...(retirement ? { [retirement.path]: retirement.sha } : {}),
        }),
      });
    }
    let treeSha = src.tree.sha;
    for (const changes of pruneFirst ? [deletions, edits] : [edits]) {
      if (!changes.length) continue;
      const treeRes = await gh(`/git/trees`, {
        method: "POST",
        body: JSON.stringify({ base_tree: treeSha, tree: changes }),
      });
      if (!treeRes.ok) await fail(tr("ツリーの作成"), treeRes);
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
    if (!commitRes.ok) await fail(tr("コミットの作成"), commitRes);
    const commitSha = (await commitRes.json()).sha as string;
    if (!(await advanceBranchRef(gh, fail, conf.branch, commitSha, true, tr))) {
      return NextResponse.json(
        { error: tr("ほかの公開と重なりました。履歴を読み込み直してから、もう一度お試しください") },
        { status: 409 }
      );
    }
    // GitHub's ref has already moved. A bookkeeping outage must not report
    // that rollback failed and encourage a duplicate rollback commit.
    try {
      await recordPublish(siteId, target);
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
      { error: tr(userMessage(e, "ロールバックできませんでした")) },
      { status: 502 }
    );
  }
}
