import { NextResponse } from "next/server";
import { serverTr } from "../../../lib/i18n-server";
import { recordPublish, requireAuth } from "../../../lib/server";
import {
  branchPath as toBranchPath,
  advanceBranchRef,
  configError,
  githubClient,
  previewEnabled,
  targetConfig,
  type TargetConfig,
} from "../../../lib/github";
import { assetStore } from "../../../lib/kv";
import type { PublishTarget } from "../../../lib/generator";
import { userMessage } from "../../../lib/errors";
import { destParam, siteDestOf, siteIdOf } from "../../../lib/site-server";
import {
  GENERATED_MANIFEST_PATH,
  ASSET_MANIFEST_PATH,
  DOC_PATH,
  isProtectedPath,
  isSafeCommitPath,
  conflictingCommitPaths,
  parseGeneratedManifest,
  planPublish,
  keptTreeEntries,
  type TreeEntry,
} from "../../../lib/publish-files";

import { matchesPublishTarget, publishConflictMessage } from "../../../lib/publish-preconditions";
import { hasPublishCredentials } from "../../../lib/publish-security";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 60;

/** ツリー作成1リクエストあたりの上限（項目数・インライン本文の文字数） */
const TREE_CHUNK_ITEMS = 200;
const TREE_CHUNK_BYTES = 512 * 1024;
const MAX_DOC_BYTES = 12 * 1024 * 1024;
// 25 MiB asset uploads expand to ~34 MiB in base64; cap the entire JSON stream.
const MAX_PUBLISH_REQUEST_BYTES = 48 * 1024 * 1024;

interface TargetField {
  expected: unknown;
  target: PublishTarget;
  /** 公開するサイト */
  site: string;
  /** D1 が無いときの公開先（ブラウザ内に保存したサイトの設定） */
  dest?: unknown;
}

/** 公開する内容をコミットする（アセットは先に upload で送った blob を sha で指す） */
interface CommitBody extends TargetField {
  action: "commit";
  expectedHead: string | null;
  files: Record<string, string>;
  assetShas?: Record<string, string>;
  /** 手で追加した項目は、先端のモード・種類・内容をそのまま保持する */
  keptPaths?: string[];
  message?: string;
}

/** アセットを1つ送る（base64 そのまま、または KV のキー source から読み込む） */
interface UploadBody extends TargetField {
  action: "upload";
  path: string;
  base64?: string;
  source?: string;
}

/** 現在の公開内容（差分公開用）を取得する */
interface TreeBody extends TargetField {
  action: "tree";
}

type PublishBody = CommitBody | UploadBody | TreeBody;

/** 保存先にアセットが存在しない（削除済みなど）。公開は続行できるので区別する */
class MissingAssetError extends Error {}

interface TreeItem {
  path: string;
  mode: string;
  type: string;
  content?: string;
  sha?: string;
}

/** 公開先の設定状況（公開ダイアログの表示用。?site= のサイト） */
export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const dest = await siteDestOf(siteId, destParam(params));
  if (dest instanceof NextResponse) return dest;
  const describe = (target: PublishTarget) => {
    const conf = targetConfig(dest, target);
    return {
      repo: conf.repo ?? null,
      branch: conf.branch,
      url: conf.url ?? null,
      error: configError(dest, target, tr),
    };
  };
  const prod = targetConfig(dest, "production");
  return NextResponse.json({
    // GitHubのトークンと公開先リポジトリが設定されているか（無ければ公開できない旨だけを出す）
    configured: !!(prod.token && prod.repo),
    /** 足りない設定（token = 環境変数の GITHUB_TOKEN / repo = サイトの公開先） */
    unset: !prod.token ? "token" : !prod.repo ? "repo" : null,
    previewEnabled: previewEnabled(dest),
    test: describe("test"),
    production: describe("production"),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;

  let body: PublishBody;
  try {
    const value = await readJsonLimited(req, MAX_PUBLISH_REQUEST_BYTES);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    body = value as PublishBody;
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413
      : error instanceof JsonContentTypeError ? 415 : 400;
    return NextResponse.json({ error: tr(status === 413 ? "リクエストが大きすぎます" : "リクエストが正しくありません") }, { status });
  }

  const target: PublishTarget = body.target === "test" ? "test" : "production";
  const siteId = await siteIdOf(body.site);
  if (siteId instanceof NextResponse) return siteId;
  const dest = await siteDestOf(siteId, body.dest);
  if (dest instanceof NextResponse) return dest;
  if (!body.expected) return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 400 });
  if (!matchesPublishTarget(body.expected, siteId, target, targetConfig(dest, target), targetConfig(dest, "production").branch)) {
    return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
  }
  const confError = configError(dest, target, tr);
  if (confError) {
    return NextResponse.json({ error: confError }, { status: 503 });
  }
  const conf = targetConfig(dest, target) as Required<TargetConfig>;
  const { repo, branch } = conf;
  const { gh, fail } = githubClient(conf, tr);

  // Creating even an unattached GitHub blob sends its contents to the
  // destination repository. Validate editable data before that first write,
  // and use the same check for inline and SHA-based commits.
  const validateDocument = (content: string | Uint8Array) => {
    const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
    if (size > MAX_DOC_BYTES) {
      return NextResponse.json({ error: tr("doc.jsonが大きすぎます。") }, { status: 400 });
    }
    let document: unknown;
    try {
      const text = typeof content === "string" ? content :
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
      document = JSON.parse(text);
    } catch {
      // Parser errors may contain document excerpts. Do not log or return them.
      return NextResponse.json({ error: tr("編集データの形式ではありません") }, { status: 400 });
    }
    if (hasPublishCredentials(document as Parameters<typeof hasPublishCredentials>[0])) {
      return NextResponse.json({
        error: tr("認証情報を含む編集データはGitHubへPushできません。APIキーやパスワードを削除し、サーバーの環境変数などで管理してください。"),
      }, { status: 400 });
    }
    return null;
  };

  // 空リポジトリでは Git Data API が使えないため、Contents API で初期コミットを作る
  //（.gitkeep もスナップショットに含め、ほかの手動ファイルと同様に保持する）。
  // 最初のコミットのブランチがリポジトリの既定ブランチになるため、テスト公開が最初でも
  // 本番のブランチで初期化する（preview が既定になると、ホスティング側で本番として扱われる）
  const initBranch =
    target === "test" ? targetConfig(dest, "production").branch : branch;
  const initRepository = async (): Promise<Response> =>
    gh(`/contents/.gitkeep`, {
      method: "PUT",
      body: JSON.stringify({
        message: "Initialize repository",
        content: "",
        branch: initBranch,
      }),
    });

  const uploadBlob = async (path: string, base64: string): Promise<string> => {
    const createBlob = () =>
      gh(`/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: base64, encoding: "base64" }),
      });
    const blobRes = await createBlob();
    if (!blobRes.ok) await fail(tr("アセット（{path}）のアップロード", { path }), blobRes);
    return (await blobRes.json()).sha;
  };

  /** KV に保存したアセットを読み込む */
  const loadStoredAsset = async (path: string, source: string): Promise<ArrayBuffer> => {
    if (!source.startsWith("assets/")) {
      throw new Error(tr("許可されていないアセット指定です: {source}", { source }));
    }
    const store = assetStore();
    if (!store) throw new Error(tr("アセットの保存先が設定されていません。管理者に確認してください"));
    const data = await store.get(source, { type: "arrayBuffer" });
    if (!data) throw new MissingAssetError(tr("アセットを読み込めませんでした: {path}", { path }));
    return data;
  };

  const branchPath = toBranchPath(branch);

  try {
    // 既存ツリーの path → sha と、アセット対応表・書き出したファイルの一覧を返す
    //（ブランチが無ければ空。一覧が無ければ generated: null）
    if (body.action === "tree") {
      let refRes = await gh(`/git/ref/heads/${branchPath}`);
      if (refRes.status === 409) {
        // Initialize once, before taking the snapshot. Uploads must never move its head.
        const bootRes = await initRepository();
        // A concurrent preflight may have initialized first. Re-read, but do not
        // treat an unsuccessful initialization as an empty snapshot.
        refRes = await gh(`/git/ref/heads/${branchPath}`);
        if (!bootRes.ok && !refRes.ok && refRes.status !== 404) await fail(tr("リポジトリの初期化"), bootRes);
        if (!bootRes.ok && refRes.status === 404) {
          const prodRef = await gh(`/git/ref/heads/${toBranchPath(initBranch)}`);
          if (!prodRef.ok) await fail(tr("リポジトリの初期化"), bootRes);
        }
      }
      if (refRes.status === 404) {
        return NextResponse.json({ ok: true, head: null, blobs: {}, manifest: {}, generated: null });
      }
      if (!refRes.ok) await fail(tr("ブランチの取得"), refRes);
      const commitSha = (await refRes.json()).object.sha as string;
      const treeRes = await gh(`/git/trees/${commitSha}?recursive=1`);
      if (!treeRes.ok) await fail(tr("ツリーの取得"), treeRes);
      const treeData = (await treeRes.json()) as {
        tree: { path: string; type: string; sha: string }[];
        truncated?: boolean;
      };
      // A partial snapshot would silently delete files omitted by GitHub.
      if (treeData.truncated) {
        throw new Error(tr("公開先のファイル一覧をすべて取得できなかったため、公開を中止しました"));
      }
      if (treeData.tree.some(item => !isSafeCommitPath(item.path))) {
        return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
      }
      const blobs: Record<string, string> = Object.create(null);
      for (const item of treeData.tree) {
        if (item.type === "blob" || item.type === "commit") blobs[item.path] = item.sha;
      }
      /** required: 読めなければ失敗にする（false なら読めないときも null） */
      const readText = async (path: string, required: boolean): Promise<string | null> => {
        const sha = blobs[path];
        if (!sha) return null;
        const blobRes = await gh(`/git/blobs/${sha}`);
        if (!blobRes.ok) {
          if (!required) return null;
          await fail(tr("ツリーの取得"), blobRes);
        }
        const { content } = (await blobRes.json()) as { content: string };
        return Buffer.from(content, "base64").toString("utf8");
      };
      let manifest: Record<string, string> = {};
      const manifestText = await readText(ASSET_MANIFEST_PATH, false);
      if (manifestText) {
        try {
          manifest = JSON.parse(manifestText);
        } catch {
          // 壊れた対応表は無視して全件送信に戻す
        }
      }
      // 読めないと手で追加したファイルを消してしまうため、取得の失敗は公開の失敗にする
      const generatedText = await readText(GENERATED_MANIFEST_PATH, true);
      const generated = generatedText === null ? null : parseGeneratedManifest(generatedText);
      if (generatedText !== null && generated === null) {
        throw new Error(tr("公開ファイル一覧が壊れているため、公開を中止しました"));
      }
      return NextResponse.json({ ok: true, head: commitSha, blobs, manifest, generated });
    }

    // アセットごとに別のWorker呼び出しへ分け、無料枠のサブリクエスト上限を回避する。
    if (body.action === "upload") {
      if (
        typeof body.path !== "string" || !body.path ||
        (body.base64 !== undefined && typeof body.base64 !== "string") ||
        (body.source !== undefined && typeof body.source !== "string") ||
        (body.base64 === undefined) === (body.source === undefined)
      ) {
        return NextResponse.json(
          { error: tr("アセットの指定が正しくありません") },
          { status: 400 }
        );
      }
      const base64 =
        body.base64 ??
        Buffer.from(await loadStoredAsset(body.path, body.source!)).toString(
          "base64"
        );
      if (body.path === DOC_PATH) {
        const invalid = validateDocument(Buffer.from(base64, "base64"));
        if (invalid) return invalid;
      }
      const sha = await uploadBlob(body.path, base64);
      return NextResponse.json({ ok: true, path: body.path, sha });
    }

    if (
      body.action !== "commit" ||
      !body.files ||
      typeof body.files !== "object" ||
      Array.isArray(body.files) ||
      !Object.keys(body.files).length
    ) {
      return NextResponse.json(
        { error: tr("ファイルがありません") },
        { status: 400 }
      );
    }

    const assetShas = body.assetShas ?? {};
    const keptPaths = body.keptPaths ?? [];
    if (!assetShas || typeof assetShas !== "object" || Array.isArray(assetShas) ||
        Object.values(body.files).some(value => typeof value !== "string") ||
        Object.values(assetShas).some(value => typeof value !== "string" || !value) ||
        Object.keys(body.files).some(path => Object.hasOwn(assetShas, path))) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
    }
    if (!Array.isArray(keptPaths) || !keptPaths.every((path) => typeof path === "string")) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
    }
    const paths = [...Object.keys(body.files), ...Object.keys(assetShas), ...keptPaths];
    if (!paths.every(isSafeCommitPath) || Object.keys(body.files).some(isProtectedPath)) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
    }

    // Ownership metadata controls deletion on the next publish and rollback.
    // It may only claim files supplied by this publication, never retained
    // manual entries. Validate SHA-based manifests as well as inline text.
    if (Object.hasOwn(body.files, GENERATED_MANIFEST_PATH) || Object.hasOwn(assetShas, GENERATED_MANIFEST_PATH)) {
      let manifestText: string;
      if (Object.hasOwn(body.files, GENERATED_MANIFEST_PATH)) {
        manifestText = body.files[GENERATED_MANIFEST_PATH];
      } else {
        const res = await gh(`/git/blobs/${assetShas[GENERATED_MANIFEST_PATH]}`);
        if (!res.ok) await fail(tr("ツリーの取得"), res);
        const blob = (await res.json()) as { content?: unknown; encoding?: unknown };
        if (typeof blob.content !== "string" || (blob.encoding && blob.encoding !== "base64")) {
          return NextResponse.json({ error: tr("公開ファイル一覧が壊れているため、公開を中止しました") }, { status: 400 });
        }
        manifestText = Buffer.from(blob.content, "base64").toString("utf8");
      }
      const generated = parseGeneratedManifest(manifestText);
      if (!generated || Object.keys(generated).some(path =>
        !Object.hasOwn(body.files, path) && !Object.hasOwn(assetShas, path))) {
        return NextResponse.json({ error: tr("公開ファイル一覧が壊れているため、公開を中止しました") }, { status: 400 });
      }
    }

    // The browser's credential check is not a security boundary. Inspect
    // doc.json again in the committing request, including when the document
    // was uploaded as a detached blob because it exceeded the inline limit.
    if (Object.hasOwn(body.files, DOC_PATH) || Object.hasOwn(assetShas, DOC_PATH)) {
      let content: string | Uint8Array;
      if (Object.hasOwn(body.files, DOC_PATH)) {
        content = body.files[DOC_PATH];
      } else {
        const res = await gh(`/git/blobs/${assetShas[DOC_PATH]}`);
        if (!res.ok) await fail(tr("編集データの取得"), res);
        const blob = (await res.json()) as { content?: unknown; encoding?: unknown };
        if (typeof blob.content !== "string" || (blob.encoding && blob.encoding !== "base64")) {
          return NextResponse.json({ error: tr("編集データの形式ではありません") }, { status: 400 });
        }
        content = Buffer.from(blob.content, "base64");
      }
      const invalid = validateDocument(content);
      if (invalid) return invalid;
    }

    // 1. ブランチ先端を取得
    let parentSha: string | null = null;
    /** 公開先のブランチがすでにあるか（無ければ最後に作る） */
    let branchExists = false;
    const refRes = await gh(`/git/ref/heads/${branchPath}`);
    if (refRes.ok) {
      parentSha = (await refRes.json()).object.sha;
      branchExists = true;
    } else if (refRes.status !== 404 && refRes.status !== 409) {
      await fail(tr("ブランチの取得"), refRes);
    }

    // A mandatory snapshot prevents an old keep/delete plan being rebased onto
    // a newer head. null means the branch was absent, not "skip the check".
    if (!(body.expectedHead === null || (typeof body.expectedHead === "string" && body.expectedHead.length > 0))) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 400 });
    }
    if (refRes.status === 409 || parentSha !== body.expectedHead) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    }

    // 2. ツリーを構築（テキストはそのまま、バイナリはblobを作成してsha参照）
    const tree: TreeItem[] = Object.entries(body.files).map(
      ([path, content]) => ({ path, mode: "100644", type: "blob", content })
    );
    const pushSha = (path: string, sha: string) => {
      tree.push({
        path,
        mode: "100644",
        type: "blob",
        sha,
      });
    };

    // This API replaces the entire tree. Protected entries come from the
    // pinned parent even when an incomplete client request omits them.
    let entries: TreeEntry[] = [];
    if (branchExists && parentSha) {
      const treeRes = await gh(`/git/trees/${parentSha}?recursive=1`);
      if (!treeRes.ok) await fail(tr("ツリーの取得"), treeRes);
      const treeData = (await treeRes.json()) as { tree: TreeEntry[]; truncated?: boolean };
      if (treeData.truncated) {
        throw new Error(tr("公開先のファイル一覧をすべて取得できなかったため、公開を中止しました"));
      }
      entries = treeData.tree;
      if (entries.some(item => !isSafeCommitPath(item.path))) {
        return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
      }
    }
    const protectedEntries = new Map(entries.filter(e =>
      isProtectedPath(e.path) && (e.type === "blob" || e.type === "commit")).map(e => [e.path, e]));

    // Do not trust the caller's keptPaths to enumerate every manual file. A
    // malformed or partial client request must not turn tree replacement into
    // deletion of unrelated files. Determine ownership from the pinned head.
    const existingBlobs: Record<string, string> = Object.create(null);
    for (const entry of entries) {
      if ((entry.type === "blob" || entry.type === "commit") && entry.sha) {
        existingBlobs[entry.path] = entry.sha;
      }
    }
    let previousGenerated: Record<string, string> | null = null;
    const previousGeneratedSha = existingBlobs[GENERATED_MANIFEST_PATH];
    if (previousGeneratedSha) {
      const manifestRes = await gh(`/git/blobs/${previousGeneratedSha}`);
      if (!manifestRes.ok) await fail(tr("ツリーの取得"), manifestRes);
      const data = (await manifestRes.json()) as { content?: unknown; encoding?: unknown };
      if (typeof data.content !== "string" || (data.encoding && data.encoding !== "base64")) {
        throw new Error(tr("公開ファイル一覧が壊れているため、公開を中止しました"));
      }
      previousGenerated = parseGeneratedManifest(Buffer.from(data.content, "base64").toString("utf8"));
      if (!previousGenerated) {
        throw new Error(tr("公開ファイル一覧が壊れているため、公開を中止しました"));
      }
    }
    const serverPlan = planPublish(
      existingBlobs,
      previousGenerated,
      [...Object.keys(body.files), ...Object.keys(assetShas)]
    );
    for (const [path, sha] of Object.entries(assetShas)) {
      if (isProtectedPath(path)) {
        if (!protectedEntries.has(path) || protectedEntries.get(path)!.sha !== sha) {
          return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
        }
      } else {
        pushSha(path, sha);
      }
    }
    // Invalid keep paths and overlapping outputs are malformed requests,
    // rather than normal head conflicts.
    if (keptPaths.some(path => !Object.hasOwn(existingBlobs, path) ||
        Object.hasOwn(body.files, path) || Object.hasOwn(assetShas, path))) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
    }
    // Client-supplied keep hints are never allowed to resurrect obsolete
    // generated files. Only entries independently classified as manual (or
    // the current protected GitHub configuration) can be retained.
    if (keptPaths.some(path => !Object.hasOwn(serverPlan.kept, path) && !protectedEntries.has(path))) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    }
    const preserved = [...new Set([...Object.keys(serverPlan.kept), ...protectedEntries.keys()])];
    const kept = keptTreeEntries(entries, preserved);
    if (!kept || keptPaths.some(path => Object.hasOwn(body.files, path) || Object.hasOwn(assetShas, path))) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
    }
    for (const entry of kept) tree.push({ ...entry, sha: entry.sha! });
    // A file at a parent path and a generated descendant cannot coexist in
    // a Git tree. GitHub may silently replace one when building nested paths.
    // Fail closed rather than losing an existing symlink, submodule or file.
    if (conflictingCommitPaths(tree.map(entry => entry.path))) {
      return NextResponse.json({ error: tr("公開できないファイルの場所が含まれています") }, { status: 400 });
    }

    // 一度に大きなツリーを送るとGitHub側でタイムアウトするため、分割して積み上げる。
    // 最初のチャンクは base_tree なし = リポジトリ内容を完全置換（削除も反映される）。
    // 以降は直前のツリーを base_tree にして追加していく。
    const chunks: TreeItem[][] = [];
    let current: TreeItem[] = [];
    let currentBytes = 0;
    for (const item of tree) {
      const bytes = item.content?.length ?? 0;
      if (
        current.length &&
        (current.length >= TREE_CHUNK_ITEMS ||
          currentBytes + bytes > TREE_CHUNK_BYTES)
      ) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(item);
      currentBytes += bytes;
    }
    if (current.length) chunks.push(current);

    let treeSha: string | undefined;
    for (const chunk of chunks) {
      const treeRes = await gh(`/git/trees`, {
        method: "POST",
        body: JSON.stringify(
          treeSha ? { base_tree: treeSha, tree: chunk } : { tree: chunk }
        ),
      });
      if (!treeRes.ok) await fail(tr("ツリーの作成"), treeRes);
      treeSha = (await treeRes.json()).sha as string;
    }

    // 3. コミット
    const commitRes = await gh(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: body.message ?? "Publish from Tsumu",
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
      }),
    });
    if (!commitRes.ok) await fail(tr("コミットの作成"), commitRes);
    const commitSha = (await commitRes.json()).sha;

    // 4. Never force an update. Resolve ambiguous transport errors by reading
    // back GitHub's ref before asking the user to publish again.
    if (!(await advanceBranchRef(gh, fail, branch, commitSha, branchExists, tr))) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    }

    // The GitHub commit already exists: a local history bookkeeping failure
    // must not turn successful publication into a misleading 502/retry.
    try {
      await recordPublish(siteId, target);
    } catch {
      console.warn("Publish completed, but the local publication record could not be updated", { siteId, target });
    }
    return NextResponse.json({
      ok: true,
      commit: commitSha,
      commitUrl: `https://github.com/${repo}/commit/${commitSha}`,
    });
  } catch (e) {
    if (e instanceof MissingAssetError) {
      return NextResponse.json(
        { error: e.message, missing: true },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: tr(userMessage(e, "公開できませんでした")) },
      { status: 502 }
    );
  }
}
