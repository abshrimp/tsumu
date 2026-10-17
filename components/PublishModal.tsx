"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CloudOff,
  ExternalLink,
  FlaskConical,
  GitCommitHorizontal,
  Globe,
  History,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { docFingerprint, useEditor } from "../lib/store";
import { HelpLink } from "./HelpCenter";
import { showAlert, showConfirm } from "../lib/dialog";
import type { SiteDoc } from "../lib/types";
import { detectSvgFilters } from "../lib/assets";
import { generateProject, type PublishTarget } from "../lib/generator";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { Seg } from "./controls";
import { userMessage } from "../lib/errors";
import { currentSiteId, sitePublishFields, siteApi } from "../lib/site";
import { getLang, tr } from "../lib/i18n";
import {
  GENERATED_MANIFEST_PATH,
  ASSET_MANIFEST_PATH,
  DOC_PATH,
  planPublish,
  serializeGeneratedManifest,
} from "../lib/publish-files";

/** Esc でモーダルを閉じる（確認ダイアログを開いていれば、そちらが先に受け取って閉じる） */
export function useEscapeToClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}

/** 未判定のSVGアセットのシャドウ有無を調べて記録し、書き出しに使う最新の編集データを返す */
export async function docWithSvgFilters(): Promise<SiteDoc> {
  const found = await detectSvgFilters(useEditor.getState().doc.assets);
  if (Object.keys(found).length) {
    useEditor.getState().updateDoc(
      (d) => {
        for (const [id, value] of Object.entries(found)) {
          if (d.assets[id]) d.assets[id].svgFilter = value;
        }
      },
      { history: false }
    );
  }
  return useEditor.getState().doc;
}

/** 公開前チェックの結果 */
export function CheckList({ checks, onClose }: { checks: CheckResult[]; onClose: () => void }) {
  if (!checks.length) {
    return (
      <div className="check-ok">
        <Check size={14} />
        {tr("公開前チェックをすべて通過しました。")}
      </div>
    );
  }
  return (
    <ul className="check-list">
      {checks.map((c, i) => (
        <li key={i} className={c.level === "error" ? "is-error" : ""}>
          <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>{c.message}</span>
          {c.help && <HelpLink topicId={c.help} onBefore={onClose} />}
        </li>
      ))}
    </ul>
  );
}

/** UTF-8 テキストを base64 にする（大きな文字列でも引数上限を超えないよう分割） */
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** base64 をバイト列に戻す */
function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Gitのblob SHA（sha1("blob <長さ>\0" + 内容)）。既存ツリーとの一致判定に使う */
async function gitBlobSha(base64: string): Promise<string> {
  return gitBlobShaOf(base64ToBytes(base64));
}

async function gitBlobShaOf(body: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header);
  buf.set(body, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** これより大きいテキストは事前にblob化し、ツリー作成リクエストを軽くする */
const INLINE_TEXT_LIMIT = 32 * 1024;

/** 保存先にアセットが無い（削除済みなど）。公開は警告付きで続行する */
class MissingAssetError extends Error {}

/** 確認の一覧に並べるファイルの数（残りは件数だけ出す） */
const OVERWRITE_LIST_LIMIT = 8;

/** GitHub上で変更されたファイルを上書きしてよいか確かめる */
function confirmOverwrite(paths: string[]): Promise<boolean> {
  const listed = paths.slice(0, OVERWRITE_LIST_LIMIT).join("\n");
  const rest = paths.length - OVERWRITE_LIST_LIMIT;
  const list = rest > 0 ? `${listed}\n${tr("ほか{count}件", { count: rest })}` : listed;
  return showConfirm(
    tr("次のファイルは、前回の公開のあとにGitHub上で編集されたか、手で追加したファイルと同じ名前です。公開するとエディタの内容で上書きされます（上書き前の内容はGitの履歴に残ります）。\n\n{list}", { list }),
    { title: tr("GitHub上の変更を上書きしますか？"), okLabel: tr("上書きして公開"), danger: true }
  );
}

/**
 * /api/publish を呼び、エラー時はサーバーのメッセージで例外を投げる。
 * WorkersのCPU超過などではHTMLが返るため、JSONでなくても状態コードで報告する。
 */
async function postPublish<T>(body: object, fallback: string, url = "/api/publish"): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // どのサイトを公開するか（と、D1 が無いときの公開先）を毎回付ける
    body: JSON.stringify({ ...sitePublishFields(), ...body }),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; missing?: boolean })
    | null;
  if (data?.missing) {
    throw new MissingAssetError(data.error ?? fallback);
  }
  if (!res.ok || !data) {
    throw new Error(data?.error ?? tr("{fallback}（{status}）", { fallback, status: res.status }));
  }
  return data;
}

interface TargetInfo {
  repo: string | null;
  branch: string;
  url: string | null;
  error: string | null;
}

interface PublishConfig {
  /** GitHubのトークンと公開先リポジトリが設定されているか */
  configured: boolean;
  /** 足りない設定（token = 環境変数の GITHUB_TOKEN / repo = サイトの公開先） */
  unset: "token" | "repo" | null;
  /** テスト公開を使うか（サイトの設定でテスト公開のブランチが空なら使わない） */
  previewEnabled: boolean;
  test: TargetInfo;
  production: TargetInfo;
}

/** 公開先の設定（モーダルを開くたびに読み直す） */
function usePublishConfig(): PublishConfig | null | "error" {
  const [conf, setConf] = useState<PublishConfig | null | "error">(null);
  useEffect(() => {
    let cancelled = false;
    fetch(siteApi("/api/publish"))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PublishConfig | null) => {
        if (cancelled) return;
        setConf(data?.test && data.production ? data : "error");
      })
      .catch(() => {
        if (!cancelled) setConf("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return conf;
}

const SITE = {
  test: {
    label: () => tr("テストサイト"),
    desc: () => tr("確認用。検索エンジンに載らないように公開します"),
    action: () => tr("テストに公開"),
    icon: FlaskConical,
  },
  production: {
    label: () => tr("本番サイト"),
    desc: () => tr("公開ドメインに反映します"),
    action: () => tr("本番に公開"),
    icon: Globe,
  },
} as const;

const SITE_ORDER: PublishTarget[] = ["test", "production"];

function TargetMeta({ info }: { info: TargetInfo }) {
  if (info.error) return <p className="pub-card-error">{info.error}</p>;
  return (
    <div className="pub-card-meta">
      <span className="pub-meta-row mono">
        <GitCommitHorizontal size={12} />
        <span className="pub-meta-text">
          {info.repo}
          <b>{info.branch}</b>
        </span>
      </span>
      {info.url && (
        <a className="pub-meta-row" href={info.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={11} />
          <span className="pub-meta-text">{info.url.replace(/^https?:\/\//, "")}</span>
        </a>
      )}
    </div>
  );
}

export default function PublishModal({
  onClose,
  onOpenHistory,
}: {
  onClose: () => void;
  onOpenHistory: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const markPublished = useEditor((s) => s.markPublished);
  const conf = usePublishConfig();
  const targets = conf && conf !== "error" ? conf : null;
  /** 選んだ公開先（公開開始まで null） */
  const [site, setSite] = useState<PublishTarget | null>(null);
  const [phase, setPhase] = useState<"check" | "busy" | "done" | "error">("check");
  const [result, setResult] = useState<{
    commitUrl?: string;
    error?: string;
    warnings?: string[];
  }>({});
  const [progress, setProgress] = useState("");
  const checks: CheckResult[] = runChecks(doc);
  const hasError = checks.some((c) => c.level === "error");
  useEscapeToClose(onClose, phase !== "busy");

  const publish = async (site: PublishTarget) => {
    setSite(site);
    setPhase("busy");
    setProgress("");
    // 公開中に編集されても、実際に公開した内容で公開済み判定する
    let target = doc;
    try {
      target = await docWithSvgFilters();
      const { files, binaries, remoteAssets } = generateProject(target, site);
      // 編集データも同梱（バックアップ兼、履歴から編集内容を戻すときに使う）
      files[DOC_PATH] = JSON.stringify(target, null, 2) + "\n";
      const outputPaths = [
        ...Object.keys(files),
        ...Object.keys(binaries),
        ...Object.keys(remoteAssets),
        ASSET_MANIFEST_PATH,
      ];

      // 1アセットずつ別リクエストにして、Cloudflare Workers無料枠の
      // 「1回あたり50サブリクエスト」を超えないようにする。
      // 大きなテキストもアセットと同様に先にblob化する（ツリー作成のタイムアウト対策）
      const largeTexts: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        if (new TextEncoder().encode(content).length > INLINE_TEXT_LIMIT) {
          largeTexts[path] = textToBase64(content);
          delete files[path];
        }
      }
      const assets: { path: string; base64?: string; source?: string }[] = [
        ...Object.entries(largeTexts).map(([path, base64]) => ({ path, base64 })),
        ...Object.entries(binaries).map(([path, base64]) => ({ path, base64 })),
        ...Object.entries(remoteAssets).map(([path, source]) => ({ path, source })),
      ];
      const assetShas: Record<string, string> = {};
      const warnings: string[] = [];

      // 公開済みの内容と同じアセットは送り直さない（blob SHAは内容で決まるため再利用できる）。
      // 手で追加したファイルを残すためにも使うので、取得できなければ公開しない
      setProgress(tr("公開済みの内容を確認しています…"));
      const existing = await postPublish<{
        blobs: Record<string, string>;
        manifest: Record<string, string>;
        generated: Record<string, string> | null;
      }>({ action: "tree", target: site }, tr("公開済みの内容を取得できませんでした"));
      const plan = planPublish(existing.blobs, existing.generated, outputPaths);
      const overwritten = [...plan.edited, ...plan.clashing];
      if (overwritten.length && !(await confirmOverwrite(overwritten))) {
        setSite(null);
        setPhase("check");
        return;
      }
      const knownShas = new Set(Object.values(existing.blobs));
      const manifest: Record<string, string> = {};
      const pending: typeof assets = [];
      for (const asset of assets) {
        const sha =
          asset.base64 !== undefined
            ? await gitBlobSha(asset.base64)
            : existing.manifest[asset.source!];
        if (sha && knownShas.has(sha)) {
          assetShas[asset.path] = sha;
          if (asset.source !== undefined) manifest[asset.source] = sha;
        } else {
          pending.push(asset);
        }
      }

      let nextAsset = 0;
      let uploadedAssets = 0;
      let failed = false;
      if (pending.length) {
        setProgress(tr("アセットを送信中… 0/{length}", { length: pending.length }));
      }
      const uploaders = Array.from({ length: Math.min(4, pending.length) }, async () => {
        // 1件でも失敗したら残りは送らない
        while (!failed && nextAsset < pending.length) {
          const asset = pending[nextAsset++];
          try {
            const uploaded = await postPublish<{ sha: string }>(
              { action: "upload", target: site, ...asset },
              tr("アセット（{path}）をアップロードできませんでした", { path: asset.path })
            );
            assetShas[asset.path] = uploaded.sha;
            if (asset.source !== undefined) manifest[asset.source] = uploaded.sha;
          } catch (e) {
            // 保存先から消えているアセットは含めずに公開を続ける
            if (!(e instanceof MissingAssetError)) {
              failed = true;
              throw e;
            }
            warnings.push(e.message);
          }
          uploadedAssets += 1;
          setProgress(
            tr("アセットを送信中… {uploadedAssets}/{length}", { uploadedAssets, length: pending.length })
          );
        }
      });
      await Promise.all(uploaders);
      files[ASSET_MANIFEST_PATH] = JSON.stringify(manifest, null, 2) + "\n";
      // 書き出したファイルの一覧。次の公開で、これに無いファイルを手で追加したものとして残す
      const generated: Record<string, string> = { ...assetShas };
      for (const [path, content] of Object.entries(files)) {
        generated[path] = await gitBlobShaOf(new TextEncoder().encode(content));
      }
      files[GENERATED_MANIFEST_PATH] = serializeGeneratedManifest(generated);
      Object.assign(assetShas, plan.kept);
      setProgress(tr("GitHubへコミットしています…"));

      const data = await postPublish<{ commitUrl?: string }>(
        {
          action: "commit",
          target: site,
          files,
          assetShas,
          message: `${site === "test" ? "Test publish" : "Publish"}: ${target.siteName} (${new Date().toLocaleString(getLang())})`,
        },
        tr("公開できませんでした")
      );
      // フッターの「公開済み」表示は本番サイトの状態を表す
      if (site === "production") markPublished(docFingerprint(target));
      setResult({ commitUrl: data.commitUrl, warnings });
      setPhase("done");
    } catch (e) {
      setResult({ error: userMessage(e, tr("公開できませんでした")) });
      setPhase("error");
    }
  };

  const siteUrl = site ? targets?.[site].url : null;

  return (
    <div className="modal-backdrop" onClick={phase === "busy" ? undefined : onClose}>
      <div className="modal pub-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{site && phase !== "check" ? tr("{site}に公開", { site: SITE[site].label() }) : tr("サイトを公開")}</h2>

        {phase === "check" && targets && !targets.configured && (
          <>
            <div className="pub-unset">
              <span className="pub-unset-icon">
                <CloudOff size={18} />
              </span>
              {targets.unset === "token" ? (
                <>
                  <strong>{tr("GitHubへの公開が設定されていません")}</strong>
                  <p>
                    {tr("公開するには、サーバー側の設定が必要です。管理者に確認してください。")}
                  </p>
                </>
              ) : (
                <>
                  <strong>{tr("公開先が設定されていません")}</strong>
                  <p>{tr("ホーム画面のサイトの設定で、公開先のGitHubリポジトリ（例: owner/site-repo）を指定してください。")}</p>
                </>
              )}
              <p>{tr("設定するまでは、メニューの「zipでエクスポート」でサイトを書き出せます。編集内容はこのまま保存されます。")}</p>
            </div>
            <div className="modal-actions">
              {targets.unset === "repo" && (
                <a className="btn btn-primary" href={`/?settings=${encodeURIComponent(currentSiteId())}`}>
                  {tr("サイトの設定を開く")}
                </a>
              )}
              <button className="btn" onClick={onClose}>
                {tr("閉じる")}
              </button>
            </div>
          </>
        )}

        {phase === "check" && !(targets && !targets.configured) && (
          <>
            <p className="modal-desc">
              {tr("サイトを生成してGitHubリポジトリにコミットします。ホスティング側でビルドが終わると反映されます。")}
            </p>
            <CheckList checks={checks} onClose={onClose} />
            {conf === null ? (
              <div className="pub-loading">
                <LoaderCircle size={14} className="spin" />
                {tr("公開先を確認しています…")}
              </div>
            ) : conf === "error" ? (
              <ul className="check-list">
                <li className="is-error">
                  <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
                  {tr("公開先の設定を読み込めませんでした")}
                </li>
              </ul>
            ) : (
              <div className="pub-cards">
                {SITE_ORDER.filter((t) => t === "production" || conf.previewEnabled).map((t) => {
                  const info = conf[t];
                  const Icon = SITE[t].icon;
                  const disabled = hasError || !!info.error;
                  return (
                    <section key={t} className={`pub-card${t === "production" ? " is-prod" : ""}`}>
                      <header>
                        <span className="pub-card-icon">
                          <Icon size={15} />
                        </span>
                        <div>
                          <strong>{SITE[t].label()}</strong>
                          <p>{SITE[t].desc()}</p>
                        </div>
                      </header>
                      <TargetMeta info={info} />
                      <button
                        className={t === "production" ? "btn btn-primary" : "btn"}
                        disabled={disabled}
                        onClick={() => publish(t)}
                      >
                        <Icon size={13} />
                        {SITE[t].action()}
                      </button>
                    </section>
                  );
                })}
              </div>
            )}
            <div className="modal-actions pub-actions">
              <button
                className="btn btn-ghost"
                disabled={!targets || !!targets.production.error}
                onClick={onOpenHistory}
              >
                <History size={13} />
                {tr("公開履歴・ロールバック")}
              </button>
              <button className="btn" onClick={onClose}>
                {tr("閉じる")}
              </button>
            </div>
          </>
        )}

        {phase === "busy" && (
          <div className="pub-loading is-large">
            <LoaderCircle size={16} className="spin" />
            {progress || tr("公開データを準備しています…")}
          </div>
        )}

        {phase === "done" && (
          <>
            <div className="check-ok">
              <Check size={14} />
              {tr("コミットしました。まもなくビルドが始まります。")}
            </div>
            {!!result.warnings?.length && (
              <ul className="check-list">
                {result.warnings.map((w) => (
                  <li key={w}>
                    <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
                    {tr("{w}（このファイルは含めずに公開しました）", { w })}
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              {result.commitUrl && (
                <a className="btn" href={result.commitUrl} target="_blank" rel="noopener noreferrer">
                  <GitCommitHorizontal size={13} />
                  {tr("コミットを見る")}
                </a>
              )}
              {siteUrl && (
                <a className="btn" href={siteUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} />
                  {tr("サイトを開く")}
                </a>
              )}
              <button className="btn btn-primary" onClick={onClose}>
                {tr("閉じる")}
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <ul className="check-list">
              <li className="is-error">
                <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
                {result.error}
              </li>
            </ul>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPhase("check")}>
                {tr("戻る")}
              </button>
              <button className="btn btn-primary" onClick={() => site && publish(site)}>
                {tr("再試行")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- 履歴（公開サイトのロールバック・編集データの復元） ---------- */

interface PublishCommit {
  sha: string;
  message: string;
  date: string;
  url: string;
}

interface Backup {
  day: number;
  savedAt: number;
  bytes: number;
}

function formatDate(v: string | number): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(getLang(), { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 取得した編集データを確かめて、確認のうえで今の編集内容をそれに置き換える */
async function restoreFrom(url: string, label: string): Promise<boolean> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => null)) as (SiteDoc & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? tr("編集データを読み込めませんでした"));
  if (!data.pages || !data.nodes || !data.pageOrder?.length) {
    throw new Error(tr("編集データの形式ではありません"));
  }
  const ok = await showConfirm(
    tr("いまの編集内容が「{label}」の内容に置き換わります。サーバーにも保存されますが、「元に戻す」（⌘Z）で今の内容に戻せます。", { label }),
    { title: tr("この版の編集内容に戻しますか？"), okLabel: tr("この版に戻す") }
  );
  if (!ok) return false;
  useEditor.getState().restoreDoc(data);
  return true;
}

function PublishHistory({ conf, onDone }: { conf: PublishConfig; onDone: () => void }) {
  const [target, setTarget] = useState<PublishTarget>("production");
  const [state, setState] = useState<{ head: string | null; commits: PublishCommit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const info = conf[target];

  const load = useCallback(async () => {
    setState(null);
    setError(null);
    try {
      const res = await fetch(siteApi("/api/publish/history", { target }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? tr("履歴を読み込めませんでした"));
      setState(data);
    } catch (e) {
      setError(userMessage(e, tr("履歴を読み込めませんでした")));
    }
  }, [target]);

  useEffect(() => {
    if (!conf[target].error) void load();
  }, [conf, target, load]);

  const rollback = async (c: PublishCommit) => {
    const ok = await showConfirm(
      tr("{site}を {date} に公開した内容に戻します。新しいコミットとして積むので、あとからこの操作も取り消せます。", {
        site: SITE[target].label(),
        date: formatDate(c.date),
      }),
      { title: tr("公開サイトをこの版に戻しますか？"), okLabel: tr("この版に戻す"), danger: target === "production" }
    );
    if (!ok) return;
    setBusy(c.sha);
    try {
      await postPublish({ target, sha: c.sha }, tr("ロールバックできませんでした"), "/api/publish/history");
      await load();
      void showAlert(tr("ホスティング側でビルドが終わると反映されます。"), { title: tr("ロールバックしました") });
    } catch (e) {
      void showAlert(userMessage(e, tr("ロールバックできませんでした")), { title: tr("ロールバックできませんでした") });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (c: PublishCommit) => {
    setBusy(`doc:${c.sha}`);
    try {
      if (await restoreFrom(siteApi("/api/publish/history", { target, doc: c.sha }), formatDate(c.date))) onDone();
    } catch (e) {
      void showAlert(userMessage(e, tr("編集データを読み込めませんでした")), { title: tr("編集データを読み込めませんでした") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {conf.previewEnabled && (
        <Seg
          value={target}
          options={SITE_ORDER.map((t) => ({ value: t, label: SITE[t].label() }))}
          onChange={(v) => setTarget(v as PublishTarget)}
        />
      )}
      <TargetMeta info={info} />
      {info.error ? null : error ? (
        <ul className="check-list">
          <li className="is-error">
            <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
            {error}
          </li>
        </ul>
      ) : !state ? (
        <div className="pub-loading">
          <LoaderCircle size={14} className="spin" />
          {tr("読み込んでいます…")}
        </div>
      ) : !state.commits.length ? (
        <p className="hint">{tr("まだ公開されていません。")}</p>
      ) : (
        <ol className="hist-list">
          {state.commits.map((c) => {
            const current = c.sha === state.head;
            return (
              <li key={c.sha} className={current ? "is-current" : ""}>
                <div className="hist-main">
                  <span className="hist-date">
                    {formatDate(c.date)}
                    {current && <em>{tr("公開中")}</em>}
                  </span>
                  <a className="hist-msg" href={c.url} target="_blank" rel="noopener noreferrer" title={c.message}>
                    <span className="mono">{c.sha.slice(0, 7)}</span>
                    {c.message}
                  </a>
                </div>
                <div className="hist-acts">
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={!!busy}
                    data-tip={tr("この版で公開した時点の編集内容をエディタに読み込みます")}
                    onClick={() => void restore(c)}
                  >
                    {busy === `doc:${c.sha}` ? <LoaderCircle size={12} className="spin" /> : null}
                    {tr("編集内容を復元")}
                  </button>
                  {!current && (
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => void rollback(c)}>
                      {busy === c.sha ? <LoaderCircle size={12} className="spin" /> : <RotateCcw size={12} />}
                      {tr("サイトを戻す")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function BackupHistory({ onDone }: { onDone: () => void }) {
  const [list, setList] = useState<Backup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(siteApi("/api/doc/backups"));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? tr("読み込めませんでした"));
        if (!cancelled) setList(data.backups);
      } catch (e) {
        if (!cancelled) setError(userMessage(e, tr("読み込めませんでした")));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const restore = async (b: Backup) => {
    setBusy(b.day);
    try {
      if (await restoreFrom(siteApi("/api/doc/backups", { day: b.day }), formatDate(b.savedAt))) onDone();
    } catch (e) {
      void showAlert(userMessage(e, tr("編集データを読み込めませんでした")), { title: tr("編集データを読み込めませんでした") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        {tr("サーバーは1日に1回、その日最初に保存した時点の内容を自動で残します（曜日ごとに7日分）。")}
      </p>
      {error ? (
        <ul className="check-list">
          <li className="is-error">
            <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
            {error}
          </li>
        </ul>
      ) : !list ? (
        <div className="pub-loading">
          <LoaderCircle size={14} className="spin" />
          {tr("読み込んでいます…")}
        </div>
      ) : !list.length ? (
        <p className="hint">{tr("まだバックアップがありません。")}</p>
      ) : (
        <ol className="hist-list">
          {list.map((b) => (
            <li key={b.day}>
              <div className="hist-main">
                <span className="hist-date">{formatDate(b.savedAt)}</span>
                <span className="hist-msg is-plain">{formatSize(b.bytes)}</span>
              </div>
              <div className="hist-acts">
                <button className="btn btn-sm" disabled={busy !== null} onClick={() => void restore(b)}>
                  {busy === b.day ? <LoaderCircle size={12} className="spin" /> : <RotateCcw size={12} />}
                  {tr("この内容に戻す")}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** 履歴: 公開サイトのロールバックと、編集データの復元 */
export function HistoryModal({
  onClose,
  initialTab = "site",
}: {
  onClose: () => void;
  initialTab?: "site" | "doc";
}) {
  const conf = usePublishConfig();
  const [tab, setTab] = useState<"site" | "doc">(initialTab);
  useEscapeToClose(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hist-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("履歴")}</h2>
        <p className="modal-desc">
          {tr("公開したサイトを前の版に戻したり、編集内容を以前の状態に戻したりできます。")}
        </p>
        <div className="hist-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "site"} className={tab === "site" ? "is-on" : ""} onClick={() => setTab("site")}>
            <Globe size={13} />
            {tr("公開サイト")}
          </button>
          <button role="tab" aria-selected={tab === "doc"} className={tab === "doc" ? "is-on" : ""} onClick={() => setTab("doc")}>
            <History size={13} />
            {tr("編集データの自動バックアップ")}
          </button>
        </div>
        <div className="hist-body">
          {tab === "doc" ? (
            <BackupHistory onDone={onClose} />
          ) : conf === null ? (
            <div className="pub-loading">
              <LoaderCircle size={14} className="spin" />
              {tr("読み込んでいます…")}
            </div>
          ) : conf === "error" ? (
            <p className="hint">{tr("公開先の設定を読み込めませんでした")}</p>
          ) : (
            <PublishHistory conf={conf} onDone={onClose} />
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {tr("閉じる")}
          </button>
        </div>
      </div>
    </div>
  );
}
