import { NextResponse } from "next/server";
import { serverTr } from "../../../lib/i18n-server";
import { recordPublish, requireAuth } from "../../../lib/server";
import { dbConfigured, getDb } from "../../../lib/db";
import { DEFAULT_PUBLISHED_EXPORT_OPTIONS, parsePublishedExportOptions, readPublishedExportOptions, savePublishedExportOptions, type PublishedExportOptions } from "../../../lib/publish-preferences";
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
import { gitBlobRequestBody } from "../../../lib/github-blob";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../../../lib/api-json";

export const maxDuration = 60;

/** ツリーを作るリクエスト1回あたりの上限（項目数と、インラインで送る本文の文字数） */
const TREE_CHUNK_ITEMS = 200;
const TREE_CHUNK_BYTES = 512 * 1024;
const MAX_DOC_BYTES = 12 * 1024 * 1024;
// 25 MiB のアセットは base64 で約 34 MiB になる。JSON のストリーム全体の大きさを制限する。
const MAX_PUBLISH_REQUEST_BYTES = 48 * 1024 * 1024;

interface TargetField {
  expected: unknown;
  target: PublishTarget;
  /** 公開するサイト */
  site: string;
  /** D1 が無いときの公開先（ブラウザ内に保存したサイトの設定） */
  dest?: unknown;
}

/** 公開する内容をコミットする（アセットは、先に upload で送った blob を sha で指す） */
interface CommitBody extends TargetField {
  action: "commit";
  expectedHead: string | null;
  files: Record<string, string>;
  exportOptions: PublishedExportOptions;
  assetShas?: Record<string, string>;
  /** 手動で追加した項目は、先端のモード・種類・内容をそのまま残す */
  keptPaths?: string[];
  message?: string;
}

/** アセットを1つ送る（base64 をそのまま送るか、KV のキー source から読み込む） */
interface UploadBody extends TargetField {
  action: "upload";
  path: string;
  base64?: string;
  source?: string;
}

/** 現在の公開内容を取得する（差分だけを公開するため） */
interface TreeBody extends TargetField {
  action: "tree";
}

type PublishBody = CommitBody | UploadBody | TreeBody;

/** 保存先にアセットが無い（削除済みなど）。公開は続けられるため、他のエラーと区別する */
class MissingAssetError extends Error {}

interface TreeItem {
  path: string;
  mode: string;
  type: string;
  content?: string;
  sha?: string;
}

/** 公開先の設定状況（?site= のサイト。公開ダイアログの表示に使う） */
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
    // GitHub のトークンと公開先のリポジトリが設定されているか（無ければ、公開できないことだけを表示する）
    configured: !!(prod.token && prod.repo),
    /** 足りない設定（token = 環境変数の GITHUB_TOKEN、repo = サイトの公開先） */
    unset: !prod.token ? "token" : !prod.repo ? "repo" : null,
    previewEnabled: previewEnabled(dest),
    lastExportOptions: dbConfigured()
      ? await readPublishedExportOptions(await getDb(), siteId)
      : DEFAULT_PUBLISHED_EXPORT_OPTIONS,
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
    return NextResponse.json({ error: tr(status === 413 ? "Request too large" : "Invalid request", status === 413 ? undefined : "invalid_request_variant_1") }, { status });
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

  // 未接続の GitHub blob を作るだけでも、内容は公開先のリポジトリに送られる。
  // 最初の書き込みの前に編集データを検証し、インラインのコミットにも SHA で指すコミットにも
  // 同じ検査を使う。
  const validateDocument = (content: string | Uint8Array) => {
    const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
    if (size > MAX_DOC_BYTES) {
      return NextResponse.json({ error: tr("doc.json exceeds the size limit.") }, { status: 400 });
    }
    let document: unknown;
    try {
      const text = typeof content === "string" ? content :
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
      document = JSON.parse(text);
    } catch {
      // パーサーのエラーには文書の一部が含まれることがあるため、ログにも応答にも出さない。
      return NextResponse.json({ error: tr("Not an editor data file") }, { status: 400 });
    }
    if (hasPublishCredentials(document as Parameters<typeof hasPublishCredentials>[0])) {
      return NextResponse.json({
        error: tr("Cannot push editable data containing credentials to GitHub. Remove API keys or passwords and manage them with server environment variables instead."),
      }, { status: 400 });
    }
    return null;
  };

  // 空のリポジトリでは Git Data API が使えないため、Contents API で最初のコミットを作る
  //（.gitkeep もスナップショットに含め、他の手動ファイルと同じように残す）。
  // 最初のコミットのブランチがリポジトリの既定ブランチになるため、テスト公開が先でも
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

  const uploadBlob = async (path: string, content: Uint8Array): Promise<string> => {
    const createBlob = () =>
      gh(`/git/blobs`, {
        method: "POST",
        body: gitBlobRequestBody(content),
      });
    const blobRes = await createBlob();
    if (!blobRes.ok) await fail(tr("Uploading asset ({path})", { path }), blobRes);
    return (await blobRes.json()).sha;
  };

  /** KV に保存したアセットを読み込む */
  const loadStoredAsset = async (path: string, source: string): Promise<ArrayBuffer> => {
    if (!source.startsWith("assets/")) {
      throw new Error(tr("Asset source not allowed: {source}", { source }));
    }
    const store = assetStore();
    if (!store) throw new Error(tr("Asset storage isn't configured. Contact your administrator"));
    const data = await store.get(source, { type: "arrayBuffer" });
    if (!data) throw new MissingAssetError(tr("Couldn't load asset: {path}", { path }));
    return data;
  };

  const branchPath = toBranchPath(branch);

  try {
    // 既存のツリーの path → sha と、アセットの対応表、書き出したファイルの一覧を返す
    //（ブランチが無ければ空。一覧が無ければ generated: null）
    if (body.action === "tree") {
      let refRes = await gh(`/git/ref/heads/${branchPath}`);
      if (refRes.status === 409) {
        // スナップショットを取る前に、一度だけ初期化する。アップロードで先端を動かしてはいけない。
        const bootRes = await initRepository();
        // 同時に走った事前確認が先に初期化した可能性があるため読み直す。ただし、
        // 初期化に失敗した状態を空のスナップショットとして扱ってはいけない。
        refRes = await gh(`/git/ref/heads/${branchPath}`);
        if (!bootRes.ok && !refRes.ok && refRes.status !== 404) await fail(tr("Initializing the repository"), bootRes);
        if (!bootRes.ok && refRes.status === 404) {
          const prodRef = await gh(`/git/ref/heads/${toBranchPath(initBranch)}`);
          if (!prodRef.ok) await fail(tr("Initializing the repository"), bootRes);
        }
      }
      if (refRes.status === 404) {
        return NextResponse.json({ ok: true, head: null, blobs: {}, manifest: {}, generated: null });
      }
      if (!refRes.ok) await fail(tr("Fetching the branch"), refRes);
      const commitSha = (await refRes.json()).object.sha as string;
      const treeRes = await gh(`/git/trees/${commitSha}?recursive=1`);
      if (!treeRes.ok) await fail(tr("Fetching the tree"), treeRes);
      const treeData = (await treeRes.json()) as {
        tree: { path: string; type: string; sha: string }[];
        truncated?: boolean;
      };
      // 一部しか読めないスナップショットを使うと、GitHub が省いたファイルを気づかないうちに削除してしまう。
      if (treeData.truncated) {
        throw new Error(tr("Publishing stopped because the complete file list could not be retrieved from the destination"));
      }
      if (treeData.tree.some(item => !isSafeCommitPath(item.path))) {
        return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
      }
      const blobs: Record<string, string> = Object.create(null);
      for (const item of treeData.tree) {
        if (item.type === "blob" || item.type === "commit") blobs[item.path] = item.sha;
      }
      /** required が true なら、読めないときは失敗にする（false なら null を返す） */
      const readText = async (path: string, required: boolean): Promise<string | null> => {
        const sha = blobs[path];
        if (!sha) return null;
        const blobRes = await gh(`/git/blobs/${sha}`);
        if (!blobRes.ok) {
          if (!required) return null;
          await fail(tr("Fetching the tree"), blobRes);
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
          // 壊れた対応表は無視し、全件を送る方式に戻す
        }
      }
      // 一覧を読めないと手動で追加したファイルを消してしまうため、取得に失敗したら公開も失敗にする
      const generatedText = await readText(GENERATED_MANIFEST_PATH, true);
      const generated = generatedText === null ? null : parseGeneratedManifest(generatedText);
      if (generatedText !== null && generated === null) {
        throw new Error(tr("Publishing stopped because the generated file manifest is invalid."));
      }
      return NextResponse.json({ ok: true, head: commitSha, blobs, manifest, generated });
    }

    // アセットごとに Worker の呼び出しを分け、無料プランのサブリクエスト数の上限に収める。
    if (body.action === "upload") {
      if (
        typeof body.path !== "string" || !body.path ||
        (body.base64 !== undefined && typeof body.base64 !== "string") ||
        (body.source !== undefined && typeof body.source !== "string") ||
        (body.base64 === undefined) === (body.source === undefined)
      ) {
        return NextResponse.json(
          { error: tr("Invalid asset reference") },
          { status: 400 }
        );
      }
      const content = body.base64 !== undefined
        ? Buffer.from(body.base64, "base64")
        : new Uint8Array(await loadStoredAsset(body.path, body.source!));
      if (body.path === DOC_PATH) {
        const invalid = validateDocument(content);
        if (invalid) return invalid;
      }
      const sha = await uploadBlob(body.path, content);
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
        { error: tr("No file was provided") },
        { status: 400 }
      );
    }

    // 保存する形式が不正なら、GitHub のブランチを進めない。
    const exportOptions = parsePublishedExportOptions(body.exportOptions);
    if (!exportOptions) {
      return NextResponse.json({ error: tr("Invalid request", "invalid_request_variant_1") }, { status: 400 });
    }

    const assetShas = body.assetShas ?? {};
    const keptPaths = body.keptPaths ?? [];
    if (!assetShas || typeof assetShas !== "object" || Array.isArray(assetShas) ||
        Object.values(body.files).some(value => typeof value !== "string") ||
        Object.values(assetShas).some(value => typeof value !== "string" || !value) ||
        Object.keys(body.files).some(path => Object.hasOwn(assetShas, path))) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }
    if (!Array.isArray(keptPaths) || !keptPaths.every((path) => typeof path === "string")) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }
    const paths = [...Object.keys(body.files), ...Object.keys(assetShas), ...keptPaths];
    if (!paths.every(isSafeCommitPath) || Object.keys(body.files).some(isProtectedPath)) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }

    // 所有の情報は、次の公開とロールバックで何を削除するかを決める。
    // 主張できるのはこの公開で送ったファイルだけで、残す手動のファイルは含められない。
    // インラインの本文だけでなく、SHA で指す一覧も検証する。
    if (Object.hasOwn(body.files, GENERATED_MANIFEST_PATH) || Object.hasOwn(assetShas, GENERATED_MANIFEST_PATH)) {
      let manifestText: string;
      if (Object.hasOwn(body.files, GENERATED_MANIFEST_PATH)) {
        manifestText = body.files[GENERATED_MANIFEST_PATH];
      } else {
        const res = await gh(`/git/blobs/${assetShas[GENERATED_MANIFEST_PATH]}`);
        if (!res.ok) await fail(tr("Fetching the tree"), res);
        const blob = (await res.json()) as { content?: unknown; encoding?: unknown };
        if (typeof blob.content !== "string" || (blob.encoding && blob.encoding !== "base64")) {
          return NextResponse.json({ error: tr("Publishing stopped because the generated file manifest is invalid.") }, { status: 400 });
        }
        manifestText = Buffer.from(blob.content, "base64").toString("utf8");
      }
      const generated = parseGeneratedManifest(manifestText);
      if (!generated || Object.keys(generated).some(path =>
        !Object.hasOwn(body.files, path) && !Object.hasOwn(assetShas, path))) {
        return NextResponse.json({ error: tr("Publishing stopped because the generated file manifest is invalid.") }, { status: 400 });
      }
    }

    // ブラウザでの認証情報の検査は、安全のための境界にはならない。コミットするリクエストでも
    // doc.json を検査し直す。インラインの上限を超えて別の blob として送った場合も同様。
    if (Object.hasOwn(body.files, DOC_PATH) || Object.hasOwn(assetShas, DOC_PATH)) {
      let content: string | Uint8Array;
      if (Object.hasOwn(body.files, DOC_PATH)) {
        content = body.files[DOC_PATH];
      } else {
        const res = await gh(`/git/blobs/${assetShas[DOC_PATH]}`);
        if (!res.ok) await fail(tr("Fetching editor data"), res);
        const blob = (await res.json()) as { content?: unknown; encoding?: unknown };
        if (typeof blob.content !== "string" || (blob.encoding && blob.encoding !== "base64")) {
          return NextResponse.json({ error: tr("Not an editor data file") }, { status: 400 });
        }
        content = Buffer.from(blob.content, "base64");
      }
      const invalid = validateDocument(content);
      if (invalid) return invalid;
    }

    // 1. ブランチの先端を取得する
    let parentSha: string | null = null;
    /** 公開先のブランチがすでにあるか（無ければ最後に作る） */
    let branchExists = false;
    const refRes = await gh(`/git/ref/heads/${branchPath}`);
    if (refRes.ok) {
      parentSha = (await refRes.json()).object.sha;
      branchExists = true;
    } else if (refRes.status !== 404 && refRes.status !== 409) {
      await fail(tr("Fetching the branch"), refRes);
    }

    // 古い「残す・削除する」の計画が新しい先端に適用されないよう、スナップショットを必須にする。
    // null は「ブランチが無かった」ことを表し、「確認を省く」という意味ではない。
    if (!(body.expectedHead === null || (typeof body.expectedHead === "string" && body.expectedHead.length > 0))) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 400 });
    }
    if (refRes.status === 409 || parentSha !== body.expectedHead) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    }

    // 2. ツリーを組み立てる（テキストはそのまま、バイナリは blob を作って sha で参照する）
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

    // この API はツリー全体を置き換える。クライアントの不完全なリクエストが保護対象の項目を
    // 省いても、固定した親コミットから補う。
    let entries: TreeEntry[] = [];
    if (branchExists && parentSha) {
      const treeRes = await gh(`/git/trees/${parentSha}?recursive=1`);
      if (!treeRes.ok) await fail(tr("Fetching the tree"), treeRes);
      const treeData = (await treeRes.json()) as { tree: TreeEntry[]; truncated?: boolean };
      if (treeData.truncated) {
        throw new Error(tr("Publishing stopped because the complete file list could not be retrieved from the destination"));
      }
      entries = treeData.tree;
      if (entries.some(item => !isSafeCommitPath(item.path))) {
        return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
      }
    }
    const protectedEntries = new Map(entries.filter(e =>
      isProtectedPath(e.path) && (e.type === "blob" || e.type === "commit")).map(e => [e.path, e]));

    // 手動ファイルの一覧を、呼び出し側の keptPaths に任せてはいけない。不正なリクエストや
    // 一部だけのリクエストで、ツリーの置き換えが無関係なファイルの削除にならないよう、
    // 所有の判定は固定した先端から行う。
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
      if (!manifestRes.ok) await fail(tr("Fetching the tree"), manifestRes);
      const data = (await manifestRes.json()) as { content?: unknown; encoding?: unknown };
      if (typeof data.content !== "string" || (data.encoding && data.encoding !== "base64")) {
        throw new Error(tr("Publishing stopped because the generated file manifest is invalid."));
      }
      previousGenerated = parseGeneratedManifest(Buffer.from(data.content, "base64").toString("utf8"));
      if (!previousGenerated) {
        throw new Error(tr("Publishing stopped because the generated file manifest is invalid."));
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
          return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
        }
      } else {
        pushSha(path, sha);
      }
    }
    // 不正な保持パスや、出力どうしの重なりは、通常の先端の競合ではなく不正なリクエストとして扱う。
    if (keptPaths.some(path => !Object.hasOwn(existingBlobs, path) ||
        Object.hasOwn(body.files, path) || Object.hasOwn(assetShas, path))) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }
    // クライアントが送る保持の指定で、不要になった生成ファイルを復活させてはいけない。
    // 残せるのは、サーバーが独自に手動と判定した項目（と、現在の保護対象の GitHub の設定）だけ。
    if (keptPaths.some(path => !Object.hasOwn(serverPlan.kept, path) && !protectedEntries.has(path))) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    }
    const preserved = [...new Set([...Object.keys(serverPlan.kept), ...protectedEntries.keys()])];
    const kept = keptTreeEntries(entries, preserved);
    if (!kept || keptPaths.some(path => Object.hasOwn(body.files, path) || Object.hasOwn(assetShas, path))) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }
    for (const entry of kept) tree.push({ ...entry, sha: entry.sha! });
    // 親のパスにあるファイルと、その下の生成ファイルは、Git のツリーに同時には置けない。
    // 入れ子のパスを組み立てるときに GitHub が黙って一方を置き換えることがあるため、
    // 既存のシンボリックリンク・サブモジュール・ファイルを失わないよう、ここで中止する。
    if (conflictingCommitPaths(tree.map(entry => entry.path))) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }

    // 大きなツリーを一度に送ると GitHub 側でタイムアウトするため、分割して積み上げる。
    // 最初のチャンクは base_tree なしで送り、リポジトリの内容を完全に置き換える（削除も反映される）。
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
      if (!treeRes.ok) await fail(tr("Creating the tree"), treeRes);
      treeSha = (await treeRes.json()).sha as string;
    }

    // 3. コミットを作る
    const commitRes = await gh(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: body.message ?? "Publish from Tsumu",
        tree: treeSha,
        parents: parentSha ? [parentSha] : [],
      }),
    });
    if (!commitRes.ok) await fail(tr("Creating the commit"), commitRes);
    const commitSha = (await commitRes.json()).sha;

    // 4. 強制的な更新はしない。通信エラーで結果が分からない場合は、利用者にもう一度公開を
    // 求める前に、GitHub のブランチを読み直して確かめる。
    if (!(await advanceBranchRef(gh, fail, branch, commitSha, branchExists, tr))) {
      return NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
    }

    // GitHub のコミットはすでにできている。手元の履歴の記録に失敗しても、
    // 成功した公開を 502 や再試行の案内にすり替えない。
    let optionsSaved = false;
    if (dbConfigured()) {
      try {
        optionsSaved = await savePublishedExportOptions(await getDb(), siteId, exportOptions, dest.roomKey);
      } catch (error) {
        console.warn("Published to GitHub, but could not save export preferences", error);
      }
    }
    try {
      await recordPublish(siteId, target, dest.roomKey);
    } catch {
      console.warn("Publish completed, but the local publication record could not be updated", { siteId, target });
    }
    return NextResponse.json({
      ok: true,
      commit: commitSha,
      commitUrl: `https://github.com/${repo}/commit/${commitSha}`,
      optionsSaved,
    });
  } catch (e) {
    if (e instanceof MissingAssetError) {
      return NextResponse.json(
        { error: e.message, missing: true },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: tr(userMessage(e, "Couldn't publish")) },
      { status: 502 }
    );
  }
}
