"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { usePendingImport } from "../lib/use-pending-import";
import { docFingerprint, useEditor } from "../lib/store";
import { HelpLink } from "./HelpCenter";
import { showAlert, showConfirm } from "../lib/dialog";
import { publishConflictMessage, type ExpectedPublishTarget } from "../lib/publish-preconditions";
import { addPwaRetirementWorker } from "../lib/publish-pwa";
import type { SiteDoc } from "../lib/types";
import { detectSvgFilters } from "../lib/assets";
import { sanitizeImportedInlineIcons } from "../lib/imported-svg";
import { hasPublishCredentials, readRestoreJson } from "../lib/publish-security";
import { validateImportedDoc, IMPORT_LIMITS } from "../lib/site-import";
import type { PublishTarget } from "../lib/generator";
import { DEFAULT_EXPORT_OPTIONS, EXPORT_FRAMEWORK_OPTIONS, exportLimitations, prepareExportProject, type ExportFormat, type ExportLanguage, type ExportOptions, type ExportStyle } from "../lib/export-formats";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { Dropdown, Seg } from "./controls";
import { userMessage } from "../lib/errors";
import { currentSiteId, sitePublishFields, siteApi } from "../lib/site";
import type { PublishedExportOptions } from "../lib/publish-preferences";
import { getLang, tr } from "../lib/i18n";
import {
  GENERATED_MANIFEST_PATH,
  ASSET_MANIFEST_PATH,
  DOC_PATH,
  planPublish,
  conflictingCommitPaths,
  serializeGeneratedManifest,
} from "../lib/publish-files";

/** 未判定のSVGアセットのシャドウ有無（と実寸が 0 なら viewBox の大きさ）を調べて記録し、書き出しに使う最新の編集データを返す */
export async function docWithSvgFilters(): Promise<SiteDoc> {
  const found = await detectSvgFilters(useEditor.getState().doc.assets);
  if (Object.keys(found).length) {
    useEditor.getState().updateDoc(
      (d) => {
        for (const [id, value] of Object.entries(found)) {
          if (d.assets[id]) Object.assign(d.assets[id], value);
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
        {tr("All pre-publish checks passed.")}
      </div>
    );
  }
  return (
    <ul className="check-list">
      {[...checks].sort((a, b) => Number(b.level === "warn") - Number(a.level === "warn")).map((c, i) => (
        <li key={i} className={c.level === "error" ? "is-error" : ""}>
          <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>{c.message}</span>
          {c.help && <HelpLink topicId={c.help} onBefore={onClose} />}
        </li>
      ))}
    </ul>
  );
}

/** UTF-8 のテキストを base64 にする（大きな文字列でも引数の上限を超えないよう、分けて処理する） */
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

/** Git の blob の SHA（sha1("blob <長さ>\0" + 内容)）。既存のツリーと一致するかの判定に使う */
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

/** これより大きいテキストは先に blob にして、ツリーを作るリクエストを軽くする */
const INLINE_TEXT_LIMIT = 32 * 1024;

/** 保存先にアセットが無い（削除済みなど）。公開は警告を出して続ける */
class MissingAssetError extends Error {}
class PublishConflictError extends Error {}

/** 確認の一覧に並べるファイルの数（残りは件数だけを表示する） */
const OVERWRITE_LIST_LIMIT = 8;

/** GitHub 上で変更されたファイルを上書きしてよいかを確かめる */
function confirmOverwrite(paths: string[]): Promise<boolean> {
  const listed = paths.slice(0, OVERWRITE_LIST_LIMIT).join("\n");
  const rest = paths.length - OVERWRITE_LIST_LIMIT;
  const list = rest > 0 ? `${listed}\n${tr("and {count} more", { count: rest })}` : listed;
  return showConfirm(
    tr("These files were edited on GitHub after the last publish, or were added by hand with the same name as a generated file. Publishing replaces them with the editor's version (the previous content stays in the Git history).\n\n{list}", { list }),
    { title: tr("Overwrite changes made on GitHub?"), okLabel: tr("Overwrite and publish"), danger: true }
  );
}

/** 表示している公開先は固定したまま、検証用に現在の手元の設定も渡す。 */
function publishFields(conf: PublishConfig, target: PublishTarget) {
  const fields = sitePublishFields();
  if (fields.site !== conf.site) throw new PublishConflictError(tr(publishConflictMessage));
  const expected: ExpectedPublishTarget = {
    site: conf.site, target, repo: conf[target].repo, branch: conf[target].branch,
    productionBranch: conf.production.branch,
  };
  return { ...fields, site: conf.site, expected };
}

function historyUrl(conf: PublishConfig, target: PublishTarget, doc?: string): string {
  const { site, dest, expected } = publishFields(conf, target);
  const params = new URLSearchParams({ site, target, expected: JSON.stringify(expected) });
  if (dest) params.set("dest", JSON.stringify(dest));
  if (doc) params.set("doc", doc);
  return `/api/publish/history?${params}`;
}

/**
 * /api/publish を呼び、エラーのときはサーバーのメッセージで例外を投げる。
 * Workers の CPU 時間の超過などでは HTML が返るため、JSON でなくても状態コードで報告する。
 */
async function postPublish<T>(conf: PublishConfig, target: PublishTarget, body: object, fallback: string, url = "/api/publish"): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // 現在の手元の設定を、変わらない表示中の公開先と照らし合わせる。
    body: JSON.stringify({ ...publishFields(conf, target), ...body }),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; missing?: boolean })
    | null;
  if (res.status === 409) throw new PublishConflictError(data?.error ?? tr(publishConflictMessage));
  if (data?.missing) {
    throw new MissingAssetError(data.error ?? fallback);
  }
  if (!res.ok || !data) {
    throw new Error(data?.error ?? tr("{fallback} ({status})", { fallback, status: res.status }));
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
  site: string;
  /** GitHub のトークンと公開先のリポジトリが設定されているか */
  configured: boolean;
  /** 足りない設定（token = 環境変数の GITHUB_TOKEN、repo = サイトの公開先） */
  unset: "token" | "repo" | null;
  /** テスト公開を使うか（サイトの設定でテスト公開のブランチが空なら使わない） */
  previewEnabled: boolean;
  lastExportOptions?: PublishedExportOptions;
  test: TargetInfo;
  production: TargetInfo;
}

/** 公開先の設定（モーダルを開くたびに読み直す） */
function usePublishConfig(): PublishConfig | null | "error" {
  const [conf, setConf] = useState<PublishConfig | null | "error">(null);
  useEffect(() => {
    let cancelled = false;
    const fields = sitePublishFields();
    const query = new URLSearchParams({ site: fields.site });
    if (fields.dest) query.set("dest", JSON.stringify(fields.dest));
    fetch(`/api/publish?${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PublishConfig | null) => {
        if (cancelled) return;
        setConf(data?.test && data.production ? { ...data, site: fields.site } : "error");
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
    label: () => tr("Test site"),
    desc: () => tr("For checking. Published so that search engines skip it"),
    action: () => tr("Publish to test"),
    icon: FlaskConical,
  },
  production: {
    label: () => tr("Live site"),
    desc: () => tr("Goes live on your domain"),
    action: () => tr("Publish to live"),
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
  const configuredTargets = targets?.configured ? targets : null;
  /** 選んだ公開先（公開を始めるまでは null） */
  const [site, setSite] = useState<PublishTarget | null>(null);
  const [phase, setPhase] = useState<"check" | "busy" | "done" | "error">("check");
  const [result, setResult] = useState<{
    commitUrl?: string;
    error?: string;
    warnings?: string[];
    conflict?: boolean;
    format?: ExportFormat;
    optionsSaved?: boolean;
  }>({});
  const [progress, setProgress] = useState("");
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_EXPORT_OPTIONS.framework);
  const [language, setLanguage] = useState<ExportLanguage>(DEFAULT_EXPORT_OPTIONS.language);
  const [style, setStyle] = useState<ExportStyle>(DEFAULT_EXPORT_OPTIONS.style);
  useEffect(() => {
    if (!targets?.lastExportOptions) return;
    setFormat(targets.lastExportOptions.framework);
    setLanguage(targets.lastExportOptions.language);
    setStyle(targets.lastExportOptions.style);
  }, [targets]);
  const options: ExportOptions = { framework: format, language, style, scope: "project" };
  // 公開先が読み込まれるまでは重い同期チェックを実行しない。
  // 初回のローディングを先に描画してから、公開先が揃った時点で検証する。
  const checks = useMemo<CheckResult[]>(() => configuredTargets ? [
    ...runChecks(doc),
    ...exportLimitations(doc, { framework: format, language, style, scope: "project" })
      .map((message): CheckResult => ({ level: "error", message })),
  ] : [], [configuredTargets, doc, format, language, style]);
  const hasError = checks.some((c) => c.level === "error");
  useEscapeToClose(onClose, phase !== "busy");

  const publish = async (site: PublishTarget) => {
    if (!targets || hasError) return;
    // Next.js 以外の出力ではリポジトリのツリー全体が変わり、ホスティング側のビルドと
    // 公開ディレクトリの設定も、選んだ形式に合わせる必要がある。
    if (site === "production" && format !== "nextjs") {
      const accepted = await showConfirm(
        tr("Pushing this format to GitHub changes the published file structure. Check that the hosting build and output-directory settings match the selected format. Continue?"),
        { title: tr("Check the hosting settings"), okLabel: tr("Push this format"), danger: true }
      );
      if (!accepted) return;
    }
    setSite(site);
    setPhase("busy");
    setProgress("");
    // ブラウザーでは重いファイル生成の前に進捗表示を描画する。
    // Node のユニットテストではブラウザー用 API を呼ばない。
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
      });
    }
    // 公開中に編集されても、実際に公開した内容で公開済み判定する
    let target = doc;
    try {
      target = await docWithSvgFilters();
      if (hasPublishCredentials(target)) {
        throw new Error(tr("Cannot push editable data containing credentials to GitHub. Remove API keys or passwords and manage them with server environment variables instead."));
      }
      const { files, binaries, remoteAssets } = await prepareExportProject(target, options, site);
      // 編集データも一緒に含める（バックアップを兼ね、履歴から編集内容を戻すときに使う）
      files[DOC_PATH] = JSON.stringify(target, null, 2) + "\n";
      const outputPaths = [
        ...Object.keys(files),
        ...Object.keys(binaries),
        ...Object.keys(remoteAssets),
        ASSET_MANIFEST_PATH,
      ];

      // アセットを1つずつ別のリクエストで送り、Cloudflare Workers 無料プランの
      // 「1回の呼び出しあたり50サブリクエスト」の上限を超えないようにする。
      // 大きなテキストも、アセットと同じく先に blob にする（ツリーを作るときのタイムアウト対策）
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

      // 公開済みの内容と同じアセットは送り直さない（blob の SHA は内容で決まるため、再利用できる）。
      // 手動で追加したファイルを残すためにも使うため、取得できなければ公開しない
      setProgress(tr("Checking what's already published…"));
      const existing = await postPublish<{
        head: string | null;
        blobs: Record<string, string>;
        manifest: Record<string, string>;
        generated: Record<string, string> | null;
      }>(targets, site, { action: "tree", target: site }, tr("Couldn't load the published content"));
      if (!(existing.head === null || (typeof existing.head === "string" && existing.head.length > 0))) {
        throw new PublishConflictError(tr(publishConflictMessage));
      }
      addPwaRetirementWorker(target, existing.generated, files, outputPaths, format);
      const plan = planPublish(existing.blobs, existing.generated, outputPaths);
      const incompatiblePaths = conflictingCommitPaths([...outputPaths, ...Object.keys(plan.kept)]);
      if (incompatiblePaths) {
        throw new Error(`${tr("The publish includes a file path that isn't allowed")}: ${incompatiblePaths.join(" / ")}`);
      }
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
        setProgress(tr("Uploading assets… 0/{length}", { length: pending.length }));
      }
      const uploaders = Array.from({ length: Math.min(4, pending.length) }, async () => {
        // 1件でも失敗したら、残りは送らない
        while (!failed && nextAsset < pending.length) {
          const asset = pending[nextAsset++];
          try {
            const uploaded = await postPublish<{ sha: string }>(targets, site,
              { action: "upload", target: site, ...asset },
              tr("Couldn't upload the asset ({path})", { path: asset.path })
            );
            assetShas[asset.path] = uploaded.sha;
            if (asset.source !== undefined) manifest[asset.source] = uploaded.sha;
          } catch (e) {
            // 保存先から消えているアセットは含めずに、公開を続ける
            if (!(e instanceof MissingAssetError)) {
              failed = true;
              throw e;
            }
            warnings.push(e.message);
          }
          uploadedAssets += 1;
          setProgress(
            tr("Uploading assets… {uploadedAssets}/{length}", { uploadedAssets, length: pending.length })
          );
        }
      });
      await Promise.all(uploaders);
      files[ASSET_MANIFEST_PATH] = JSON.stringify(manifest, null, 2) + "\n";
      // 書き出したファイルの一覧。次の公開では、これに無いファイルを手動で追加したものとして残す
      const generated: Record<string, string> = { ...assetShas };
      for (const [path, content] of Object.entries(files)) {
        generated[path] = await gitBlobShaOf(new TextEncoder().encode(content));
      }
      files[GENERATED_MANIFEST_PATH] = serializeGeneratedManifest(generated);
      setProgress(tr("Committing to GitHub…"));

      const data = await postPublish<{ commitUrl?: string; optionsSaved?: boolean }>(targets, site,
        {
          action: "commit",
          expectedHead: existing.head,
          target: site,
          files,
          exportOptions: { framework: format, language, style },
          assetShas,
          keptPaths: Object.keys(plan.kept),
          message: `${site === "test" ? "Test publish" : "Publish"}: ${target.siteName} (${new Date().toLocaleString(getLang())})`,
        },
        tr("Couldn't publish")
      );
      // フッターの「公開済み」の表示は、本番サイトの状態を表す
      if (site === "production") markPublished(docFingerprint(target));
      setResult({ commitUrl: data.commitUrl, warnings, format, optionsSaved: data.optionsSaved });
      setPhase("done");
    } catch (e) {
      setResult({ error: userMessage(e, tr("Couldn't publish")), conflict: e instanceof PublishConflictError });
      setPhase("error");
    }
  };

  const siteUrl = site ? targets?.[site].url : null;

  return (
    <div className="modal-backdrop" onClick={phase === "busy" ? undefined : onClose}>
      <div className="modal pub-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{site && phase !== "check" ? tr("Publish to {site}", { site: SITE[site].label() }) : tr("Publish site")}</h2>

        {phase === "check" && targets && !targets.configured && (
          <>
            <div className="pub-unset">
              <span className="pub-unset-icon">
                <CloudOff size={18} />
              </span>
              {targets.unset === "token" ? (
                <>
                  <strong>{tr("Publishing to GitHub isn't configured")}</strong>
                  <p>
                    {tr("Publishing needs to be set up on the server. Contact your administrator.")}
                  </p>
                </>
              ) : (
                <>
                  <strong>{tr("No publishing destination is set up")}</strong>
                  <p>{tr("Set the GitHub repository to publish to (e.g. owner/site-repo) in the site settings on the home screen.")}</p>
                </>
              )}
              <p>{tr("Until then, you can download the site with \"Export as zip\" in the menu. Your edits are still saved.")}</p>
            </div>
            <div className="modal-actions">
              {targets.unset === "repo" && (
                <a className="btn btn-primary" href={`/?settings=${encodeURIComponent(currentSiteId())}`}>
                  {tr("Open site settings")}
                </a>
              )}
              <button className="btn" onClick={onClose}>
                {tr("Close")}
              </button>
            </div>
          </>
        )}

        {phase === "check" && conf === null && (
          <div className="pub-loading is-large" role="status">
            <LoaderCircle size={16} className="spin" />
            {tr("Checking publish targets…")}
          </div>
        )}
        {phase === "check" && conf === "error" && (
          <ul className="check-list">
            <li className="is-error">
              <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
              {tr("Couldn't load the publish settings")}
            </li>
          </ul>
        )}
        {phase === "check" && configuredTargets && (
          <>
            <p className="modal-desc">
              {format === "html" || format === "single-html"
                ? format === "single-html"
                  ? tr("Push one HTML file with embedded CSS, JavaScript and images to GitHub. Configure static hosting to serve the repository root.")
                  : tr("Push ready-to-deploy HTML, CSS, JavaScript, and images to GitHub, without a build step. To host a static site, configure your provider to serve the repository root.")
                : format === "react"
                  ? tr("Push {framework} source to GitHub. Configure hosting to build the project and serve the dist directory.", { framework: EXPORT_FRAMEWORK_OPTIONS.find((x) => x.value === format)?.label ?? format })
                  : format === "vue"
                    ? tr("Push the Vue 3 + Vite project to GitHub. It renders on the server, so configure hosting to build it and then start the Node.js server with npm start.")
                  : format === "sveltekit"
                    ? tr("Push the SvelteKit project to GitHub. Its build output is in the build directory.")
                    : format === "nuxt"
                      ? tr("Push the Nuxt project to GitHub. Nuxt-specific build settings are required for hosting.")
                      : tr("Push a Next.js project to GitHub. Changes appear on the live site once your hosting provider finishes its build.")}
            </p>
            <fieldset className="export-options pub-export-options" disabled={!targets}>
              <div className="export-option">
                <div className="export-option-label">{tr("Framework")}</div>
                <Dropdown
                  value={format}
                  options={EXPORT_FRAMEWORK_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))}
                  onChange={(value) => {
                    setFormat(value as ExportFormat);
                    if (value === "html" || value === "single-html") {
                      setLanguage("javascript");
                      setStyle("css");
                    }
                  }}
                  title={tr("Framework")}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="export-option-grid">
                <div className="export-option">
                  <div className="export-option-label">{tr("Language")}</div>
                  <Dropdown
                    value={language}
                    options={format === "html" || format === "single-html"
                      ? [{ value: "javascript", label: "JavaScript" }]
                      : [
                          { value: "typescript", label: "TypeScript" },
                          { value: "javascript", label: "JavaScript" },
                        ]}
                    onChange={(value) => setLanguage(value as ExportLanguage)}
                    title={tr("Language")}
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="export-option">
                  <div className="export-option-label">{tr("Style")}</div>
                  <Dropdown
                    value={style}
                    options={format === "html" || format === "single-html"
                      ? [{ value: "css", label: "CSS" }]
                      : [
                          { value: "css", label: "CSS" },
                          { value: "css-modules", label: "CSS Modules" },
                          { value: "tailwind", label: "Tailwind CSS" },
                        ]}
                    onChange={(value) => setStyle(value as ExportStyle)}
                    title={tr("Style")}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </fieldset>
            <p className="hint export-note">
              {format === "html" || format === "single-html"
                ? tr("HTML output uses JavaScript and CSS. Fetching external data requires the API to allow CORS.")
                : tr("GitHub Push sends source files. Hosting build settings depend on the format; a commit alone does not guarantee a successful deployment.")}
              {tr(" The entire project will be published.")}
            </p>
            <p className="hint export-note">{tr("Pushing to GitHub also includes editable data, unpublished pages and settings. Anyone can view them in a public repository. Review the content before publishing.")}</p>
            <CheckList checks={checks} onClose={onClose} />
            <div className="pub-cards">
              {SITE_ORDER.filter((t) => t === "production" || configuredTargets.previewEnabled).map((t) => {
                const info = configuredTargets[t];
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
            <div className="modal-actions pub-actions">
              <button
                className="btn btn-ghost"
                disabled={!targets || !!targets.production.error}
                onClick={onOpenHistory}
              >
                <History size={13} />
                {tr("Publish history & rollback")}
              </button>
              <button className="btn" onClick={onClose}>
                {tr("Close")}
              </button>
            </div>
          </>
        )}

        {phase === "busy" && (
          <div className="pub-loading is-large">
            <LoaderCircle size={16} className="spin" />
            {progress || tr("Preparing files to publish…")}
          </div>
        )}

        {phase === "done" && (
          <>
            <div className="check-ok">
              <Check size={14} />
              {result.format === "html" || result.format === "single-html"
                ? tr("Pushed to GitHub. The HTML files can be served directly.")
                : tr("Pushed to GitHub. Verify your hosting provider's build and publish settings.")}
            </div>
            {result.optionsSaved === false && (
              <p className="hint export-note">{tr("Published to GitHub, but the output format preferences could not be saved to the database.")}</p>
            )}
            {!!result.warnings?.length && (
              <ul className="check-list">
                {result.warnings.map((w) => (
                  <li key={w}>
                    <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
                    {tr("{w} (published without this file)", { w })}
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              {result.commitUrl && (
                <a className="btn" href={result.commitUrl} target="_blank" rel="noopener noreferrer">
                  <GitCommitHorizontal size={13} />
                  {tr("View commit")}
                </a>
              )}
              {siteUrl && (
                <a className="btn" href={siteUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} />
                  {tr("Open site")}
                </a>
              )}
              <button className="btn btn-primary" onClick={onClose}>
                {tr("Close")}
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
              <button className="btn" onClick={() => result.conflict ? onClose() : setPhase("check")}>
                {result.conflict ? tr("Close") : tr("Back")}
              </button>
              <button className="btn btn-primary" disabled={result.conflict} onClick={() => site && publish(site)}>
                {tr("Retry")}
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

/** 取得した編集データを確かめ、確認を取ったうえで、今の編集内容をそれに置き換える */
async function restoreFrom(url: string, label: string, current: () => boolean): Promise<boolean> {
  const res = await fetch(url);
  const untrusted = await readRestoreJson(res, IMPORT_LIMITS.docBytes);
  if (!current()) return false;
  const error = untrusted && typeof untrusted === "object" && "error" in untrusted
    ? (untrusted as { error?: unknown }).error : undefined;
  if (!res.ok) throw new Error(typeof error === "string" ? error : tr("Couldn't load editor data"));
  // GitHub のコミットは Tsumu とは無関係に編集できる。基本的な形の確認だけでは足りないため、
  // 明示的な doc.json のインポートと同じ検証で、循環・プロトタイプのキー・不正なリンクを拒否する。
  const data = sanitizeImportedInlineIcons(validateImportedDoc(untrusted));
  const ok = await showConfirm(
    tr("Your current edits will be replaced with the content from \"{label}\". It's saved to the server too, but Undo (⌘Z) brings back what you have now.", { label }),
    { title: tr("Restore the edits from this version?"), okLabel: tr("Restore this version") }
  );
  if (!ok || !current()) return false;
  useEditor.getState().restoreDoc(data);
  return true;
}

function PublishHistory({ conf, onDone }: { conf: PublishConfig; onDone: () => void }) {
  const [target, setTarget] = useState<PublishTarget>("production");
  // 実行中の復元やロールバックは、公開先を切り替えても重ねて実行させない。
  const [busy, setBusy] = useState<string | null>(null);
  const busyRequest = useRef(0);
  return (
    <>
      {conf.previewEnabled && (
        <Seg
          value={target}
          options={SITE_ORDER.map((t) => ({ value: t, label: SITE[t].label() }))}
          onChange={(v) => setTarget(v as PublishTarget)}
        />
      )}
      {/* 公開先が変わったら履歴の状態を作り直し、前の通信結果を別の公開先に表示しない。 */}
      <TargetHistory key={target} conf={conf} target={target} onDone={onDone} busy={busy} setBusy={setBusy} busyRequest={busyRequest} />
    </>
  );
}

function TargetHistory({ conf, target, onDone, busy, setBusy, busyRequest }: {
  conf: PublishConfig;
  target: PublishTarget;
  onDone: () => void;
  busy: string | null;
  setBusy: (value: string | null) => void;
  busyRequest: { current: number };
}) {
  const [state, setState] = useState<{ head: string | null; commits: PublishCommit[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = conf[target];
  const pendingRestore = usePendingImport(JSON.stringify(["publish-history", conf.site, target, info]));

  const load = useCallback(async () => {
    setState(null);
    setError(null);
    try {
      const res = await fetch(historyUrl(conf, target));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? tr("Couldn't load the history"));
      setState(data);
    } catch (e) {
      setError(userMessage(e, tr("Couldn't load the history")));
    }
  }, [conf, target]);

  useEffect(() => {
    if (!conf[target].error) void load();
  }, [conf, target, load]);

  const rollback = async (c: PublishCommit) => {
    const ok = await showConfirm(
      tr("The {site} returns to what was published on {date}. It's added as a new commit, so you can undo this later too.", {
        site: SITE[target].label(),
        date: formatDate(c.date),
      }),
      { title: tr("Return the published site to this version?"), okLabel: tr("Restore this version"), danger: target === "production" }
    );
    if (!ok) return;
    const request = ++busyRequest.current;
    setBusy(c.sha);
    try {
      await postPublish(conf, target, { target, sha: c.sha, expectedHead: state?.head }, tr("Couldn't roll back"), "/api/publish/history");
      await load();
      void showAlert(tr("It goes live once your hosting service finishes building."), { title: tr("Rolled back") });
    } catch (e) {
      if (e instanceof PublishConflictError) { setState(null); setError(e.message); }
      void showAlert(userMessage(e, tr("Couldn't roll back")), { title: tr("Couldn't roll back") });
    } finally {
      if (busyRequest.current === request) setBusy(null);
    }
  };

  const restore = async (c: PublishCommit) => {
    const operation = pendingRestore.begin();
    const request = ++busyRequest.current;
    setBusy(`doc:${c.sha}`);
    try {
      if (await restoreFrom(historyUrl(conf, target, c.sha), formatDate(c.date), operation.current)) onDone();
    } catch (e) {
      if (operation.current()) void showAlert(userMessage(e, tr("Couldn't load editor data")), { title: tr("Couldn't load editor data") });
    } finally {
      operation.finish();
      if (busyRequest.current === request) setBusy(null);
    }
  };

  return (
    <>
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
          {tr("Loading…", "loading_variant_1")}
        </div>
      ) : !state.commits.length ? (
        <p className="hint">{tr("Not published yet.")}</p>
      ) : (
        <ol className="hist-list">
          {state.commits.map((c) => {
            const current = c.sha === state.head;
            return (
              <li key={c.sha} className={current ? "is-current" : ""}>
                <div className="hist-main">
                  <span className="hist-date">
                    {formatDate(c.date)}
                    {current && <em>{tr("Live")}</em>}
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
                    data-tip={tr("Loads the editor content as it was when this version was published")}
                    onClick={() => void restore(c)}
                  >
                    {busy === `doc:${c.sha}` ? <LoaderCircle size={12} className="spin" /> : null}
                    {tr("Restore edits")}
                  </button>
                  {!current && (
                    <button className="btn btn-sm" disabled={!!busy} onClick={() => void rollback(c)}>
                      {busy === c.sha ? <LoaderCircle size={12} className="spin" /> : <RotateCcw size={12} />}
                      {tr("Restore site")}
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
  const busyRequest = useRef(0);
  const pendingRestore = usePendingImport("server-backup-history");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(siteApi("/api/doc/backups"));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? tr("Couldn't load"));
        if (!cancelled) setList(data.backups);
      } catch (e) {
        if (!cancelled) setError(userMessage(e, tr("Couldn't load")));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const restore = async (b: Backup) => {
    const operation = pendingRestore.begin();
    const request = ++busyRequest.current;
    setBusy(b.day);
    try {
      if (await restoreFrom(siteApi("/api/doc/backups", { day: b.day }), formatDate(b.savedAt), operation.current)) onDone();
    } catch (e) {
      if (operation.current()) void showAlert(userMessage(e, tr("Couldn't load editor data")), { title: tr("Couldn't load editor data") });
    } finally {
      operation.finish();
      if (busyRequest.current === request) setBusy(null);
    }
  };

  return (
    <>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        {tr("For each day you edit, the server automatically keeps that day's final content (seven days, one per weekday; it is kept at the first save after the date changes).")}
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
          {tr("Loading…", "loading_variant_1")}
        </div>
      ) : !list.length ? (
        <p className="hint">{tr("No backups yet.")}</p>
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
                  {tr("Restore this")}
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
        <h2>{tr("History")}</h2>
        <p className="modal-desc">
          {tr("Return the published site to an earlier version, or bring your edits back to an earlier state.")}
        </p>
        <div className="hist-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "site"} className={tab === "site" ? "is-on" : ""} onClick={() => setTab("site")}>
            <Globe size={13} />
            {tr("Published site")}
          </button>
          <button role="tab" aria-selected={tab === "doc"} className={tab === "doc" ? "is-on" : ""} onClick={() => setTab("doc")}>
            <History size={13} />
            {tr("Automatic backups of edits")}
          </button>
        </div>
        <div className="hist-body">
          {tab === "doc" ? (
            <BackupHistory onDone={onClose} />
          ) : conf === null ? (
            <div className="pub-loading">
              <LoaderCircle size={14} className="spin" />
              {tr("Loading…", "loading_variant_1")}
            </div>
          ) : conf === "error" ? (
            <p className="hint">{tr("Couldn't load the publish settings")}</p>
          ) : (
            <PublishHistory conf={conf} onDone={onClose} />
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {tr("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
