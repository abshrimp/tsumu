import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { recordPublish, requireAuth } from "../../../../lib/server";
import {
  branchPath,
  configError,
  githubClient,
  targetConfig,
  type PublishCommit,
  type TargetConfig,
} from "../../../../lib/github";
import type { PublishTarget } from "../../../../lib/generator";
import { userMessage } from "../../../../lib/errors";
import { destParam, siteDestOf, siteIdOf } from "../../../../lib/site-server";
import { DOC_PATH, protectedTreeEdits, type TreeEntry } from "../../../../lib/publish-files";

export const maxDuration = 30;

const isSha = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{7,40}$/i.test(s);

function parseTarget(v: unknown): PublishTarget {
  return v === "test" ? "test" : "production";
}

/**
 * 公開の履歴（公開先ブランチのコミット）。
 * ?target=production|test で一覧、&doc=<sha> でその版の編集データ（_tsumu/doc.json）を返す
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
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const current = await head();
    if (!current) return NextResponse.json({ head: null, commits: [] });
    const res = await gh(`/commits?sha=${branchPath(conf.branch)}&per_page=30`);
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
    return NextResponse.json({ head: current, commits });
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
  let body: { target?: unknown; sha?: unknown; site?: string; dest?: unknown };
  try {
    body = await req.json();
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
  const confError = configError(dest, target, tr);
  if (confError) return NextResponse.json({ error: confError }, { status: 503 });
  const conf = targetConfig(dest, target) as Required<TargetConfig>;
  const { gh, fail, head } = githubClient(conf, tr);

  try {
    const current = await head();
    if (!current) {
      return NextResponse.json({ error: tr("まだ公開されていません") }, { status: 404 });
    }
    const srcRes = await gh(`/git/commits/${sha}`);
    if (!srcRes.ok) await fail(tr("指定した版の取得"), srcRes);
    const src = (await srcRes.json()) as { tree: { sha: string }; message: string };
    // .github/ は戻さず、いまの先端のものを引き継ぐ（公開と同じく、エディタからは書き込ませない）
    const topLevel = async (commit: string): Promise<TreeEntry[]> => {
      const res = await gh(`/git/trees/${commit}`);
      if (!res.ok) await fail(tr("ツリーの取得"), res);
      return ((await res.json()) as { tree: TreeEntry[] }).tree;
    };
    const edits = protectedTreeEdits(await topLevel(src.tree.sha), await topLevel(current));
    let treeSha = src.tree.sha;
    if (edits.length) {
      const treeRes = await gh(`/git/trees`, {
        method: "POST",
        body: JSON.stringify({ base_tree: src.tree.sha, tree: edits }),
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
    const upRes = await gh(`/git/refs/heads/${branchPath(conf.branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: false }),
    });
    if (upRes.status === 422) {
      return NextResponse.json(
        { error: tr("ほかの公開と重なりました。履歴を読み込み直してから、もう一度お試しください") },
        { status: 409 }
      );
    }
    if (!upRes.ok) await fail(tr("ブランチの更新"), upRes);
    // ロールバックも公開として記録する（右下の「公開」に、最後に公開した人として出す）
    await recordPublish(siteId, target);
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
