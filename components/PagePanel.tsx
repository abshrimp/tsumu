"use client";

import { isEnterKey } from "../lib/keys";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import JSZip from "jszip";
import { useEditor } from "../lib/store";
import { showConfirm } from "../lib/dialog";
import { assetSrc, uploadStaticAsset } from "../lib/assets";
import type { Asset } from "../lib/types";
import ImagePicker from "./ImagePicker";
import { LoadingScreenSettings } from "./SitePanel";
import { CommitInput, CommitTextarea, FillControl, Grp, InfoTip, Section, Seg } from "./controls";
import { ScriptSummary } from "./ScriptEditor";
import { pageNodeIds, pageScriptsOf } from "../lib/script";
import { PAGE_TARGET } from "../lib/types";
import { userMessage } from "../lib/errors";
import { tr } from "../lib/i18n";
import { isSiteLang, SITE_LANGS, siteLangOf } from "../lib/site-lang";

const Sec = Section;

const blurOnEnter = (e: React.KeyboardEvent) => {
  if (
    isEnterKey(e) &&
    !e.nativeEvent.isComposing &&
    e.nativeEvent.keyCode !== 229
  ) {
    (e.target as HTMLInputElement).blur();
  }
};

const ZIP_MIME: Record<string, string> = {
  css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", pdf: "application/pdf",
};

const zipMime = (name: string) =>
  ZIP_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const cleanZipPath = (value: string) =>
  value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

function rewriteZipReferences(html: string, htmlPath: string, urls: Map<string, string>) {
  const baseDir = htmlPath.includes("/") ? htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1) : "";
  const resolve = (value: string, fromDir = baseDir) => {
    if (!value || /^(?:[a-z]+:|#|\/\/)/i.test(value)) return value;
    const [path, suffix = ""] = value.split(/(?=[?#])/);
    const parts = cleanZipPath(`${fromDir}${path}`).split("/");
    const normalized: string[] = [];
    for (const part of parts) part === ".." ? normalized.pop() : part !== "." && normalized.push(part);
    return (urls.get(normalized.join("/")) ?? value) + suffix;
  };
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[src],[href],[poster]"))) {
    for (const attr of ["src", "href", "poster"]) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, resolve(value));
    }
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[srcset]"))) {
    el.setAttribute("srcset", (el.getAttribute("srcset") ?? "").split(",").map((part) => {
      const [url, descriptor] = part.trim().split(/\s+/, 2);
      return `${resolve(url)}${descriptor ? ` ${descriptor}` : ""}`;
    }).join(", "));
  }
  const output = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  return output.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (_, q, url) => `url(${q}${resolve(url)}${q})`);
}

/** 要素が未選択のときに右パネルへ表示するページ設定 */
export default function PagePanel() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const updatePage = useEditor((s) => s.updatePage);
  const updateDoc = useEditor((s) => s.updateDoc);
  const checkpoint = useEditor((s) => s.checkpoint);
  const htmlFileRef = useRef<HTMLInputElement>(null);
  const htmlZipRef = useRef<HTMLInputElement>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipMessage, setZipMessage] = useState<string | null>(null);
  const openScriptEditor = useEditor((s) => s.openScriptEditor);

  const page = doc.pages[activePageId];
  if (!page) return null;

  /** ページ内の全要素のスクリプト（要素名つき） */
  const pageScripts = pageScriptsOf(
    doc,
    pageNodeIds(doc, page.id),
    page.id
  ).map((script) => ({
    script,
    element:
      script.nodeId === PAGE_TARGET
        ? tr("このページ")
        : script.nodeId
          ? doc.nodes[script.nodeId]?.name
          : tr("要素が未選択"),
  }));

  const pageKind =
    page.redirectTo !== undefined || page.rewriteTo !== undefined
      ? "redirect"
      : page.rawHtml != null
        ? "html"
        : "normal";
  const isSlugPg = page.slug.includes("[slug]");
  const isLoadingPage = doc.loadingScreen?.pageId === page.id;

  if (isLoadingPage) {
    return (
      <div className="panel-body" data-tutorial="page-settings">
        <Sec title={tr("ローディング画面")}>
          <LoadingScreenSettings showEditButton={false} />
        </Sec>
      </div>
    );
  }

  const importHtmlZip = async (file: File) => {
    setZipBusy(true);
    setZipMessage(null);
    try {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(
        (entry) => !entry.dir && !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith(".DS_Store")
      );
      if (entries.length > 200) throw new Error(tr("ZIPに入れられるファイルは200個までです"));
      const htmlEntries = entries.filter((entry) => /\.html?$/i.test(entry.name));
      if (!htmlEntries.length) throw new Error(tr("ZIP内にHTMLファイルが見つかりません"));
      const htmlEntry =
        htmlEntries.find((entry) => /(^|\/)index\.html?$/i.test(entry.name)) ?? htmlEntries[0];
      const assets: Asset[] = [];
      const urls = new Map<string, string>();
      const assetEntries = entries.filter((entry) => !/\.html?$/i.test(entry.name));
      for (let index = 0; index < assetEntries.length; index++) {
        const entry = assetEntries[index];
        setZipMessage(tr("アセットをアップロード中… {p1} / {length}", { p1: index + 1, length: assetEntries.length }));
        const blob = await entry.async("blob");
        const path = cleanZipPath(entry.name);
        const upload = new File([blob], path.replace(/\//g, "-"), {
          type: zipMime(path),
        });
        const asset = await uploadStaticAsset(upload);
        assets.push(asset);
        urls.set(path, assetSrc(asset));
      }
      const html = await htmlEntry.async("text");
      const rewritten = rewriteZipReferences(html, cleanZipPath(htmlEntry.name), urls);
      updateDoc((draft) => {
        for (const asset of assets) draft.assets[asset.id] = asset;
        const target = draft.pages[page.id];
        if (target) target.rawHtml = rewritten;
      });
      setZipMessage(
        tr("{name} と {length}個のアセットを読み込みました", { name: htmlEntry.name, length: assets.length })
      );
    } catch (error) {
      setZipMessage(userMessage(error, tr("ZIPを読み込めませんでした")));
    } finally {
      setZipBusy(false);
    }
  };

  const setPageKind = async (kind: string) => {
    if (kind === pageKind) return;
    if (kind === "html" || kind === "redirect") {
      if (
        page.children.length &&
        !(await showConfirm(
          tr("このページの要素は表示・編集できなくなります（データは残るので、元の種類に戻せばまた表示されます）。"),
          {
            title: kind === "html" ? tr("HTMLページに切り替えますか？") : tr("リダイレクトページに切り替えますか？"),
            okLabel: tr("切り替える"),
          }
        ))
      ) {
        return;
      }
      updatePage(
        page.id,
        kind === "html"
          ? {
              rawHtml: page.rawHtml || "",
              redirectTo: undefined,
              rewriteTo: undefined,
            }
          : {
              rawHtml: null,
              ...(page.rewriteTo !== undefined
                ? { rewriteTo: page.rewriteTo, redirectTo: undefined }
                : { redirectTo: page.redirectTo ?? "", rewriteTo: undefined }),
            }
      );
    } else {
      updatePage(page.id, {
        rawHtml: null,
        redirectTo: undefined,
        rewriteTo: undefined,
      });
    }
  };

  return (
    <div className="panel-body" data-tutorial="page-settings">
      {/* ---------- ページ設定 ---------- */}
      <Sec
        title={tr("ページ設定 ― {name}", { name: page.name })}
        tutorialTarget="tutorial-page-section"
        help="page-url"
      >
        <label
          className="lbl"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <input
            type="checkbox"
            data-tutorial="tutorial-page-publish-checkbox"
            checked={!page.unpublished}
            onChange={(e) =>
              updatePage(page.id, { unpublished: !e.target.checked })
            }
          />
          {tr("このページを公開する")}
          <InfoTip text={tr("非公開のページは書き出し・公開に含まれません（下書きとして残ります）。")} />
        </label>
        <div className="row">
          <label>{tr("名前")}</label>
          <CommitInput
            key={`${page.id}-name`}
            className="input"
            data-tutorial="tutorial-page-name"
            value={page.name}
            onCommit={(v) => updatePage(page.id, { name: v.trim() || page.name })}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="row">
          <label className="lbl-info">
            URL
            <InfoTip
              text={tr("ページのアドレスです（例: blog なら {p1}/blog）。\n「blog?tab=news」のようにクエリを付けると、このページへのリンクに付き、ページ内では {tab} として使えます。\n「blog/[slug]」のように [slug] を入れると、データの1件ごとの詳細ページになります。", { p1: doc.siteUrl ?? "" })}
            />
          </label>
          <input
            key={`${page.id}-slug-${page.slug}?${page.query ?? ""}`}
            className="input"
            data-tutorial="tutorial-page-slug"
            defaultValue={page.query ? `${page.slug}?${page.query}` : page.slug}
            placeholder={tr("（トップページ）")}
            onBlur={(e) => {
              const value = e.target.value.trim();
              const at = value.indexOf("?");
              const path = at < 0 ? value : value.slice(0, at);
              const query = at < 0 ? "" : value.slice(at + 1).split("#")[0].replace(/\s+/g, "");
              updatePage(page.id, {
                slug: path
                  .replace(/^\/+|\/+$/g, "")
                  .replace(/[^a-zA-Z0-9\-/_\[\]]/g, "-"),
                query: query || undefined,
              });
            }}
            onKeyDown={blurOnEnter}
          />
        </div>
        {pageKind === "normal" && !isLoadingPage && (
          <div className="row">
            <label className="lbl-info">
              {tr("言語")}
              <InfoTip text={tr("このページの文章の言語です。「サイトと同じ」のときは、サイト設定の言語になります。")} />
            </label>
            <select
              className="select"
              value={isSiteLang(page.lang) ? page.lang : ""}
              onChange={(e) => updatePage(page.id, { lang: e.target.value || undefined })}
            >
              <option value="">
                {tr("サイトと同じ（{lang}）", {
                  lang: SITE_LANGS.find((l) => l.value === siteLangOf(doc))?.label ?? siteLangOf(doc),
                })}
              </option>
              {SITE_LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
              {isSiteLang(page.lang) && !SITE_LANGS.some((l) => l.value === page.lang) && (
                <option value={page.lang}>{page.lang}</option>
              )}
            </select>
          </div>
        )}
        {isSlugPg && (
          <div className="note-chip">
            {tr("データの1件ごとの詳細ページ")}
            <InfoTip
              text={(() => {
                const base =
                  page.slug.replace("/[slug]", "").replace("[slug]", "") || "items";
                return tr("1つのデザインから、データの1件ごとにページが作られます（例: /{base}/1、/{base}/2 …）。\nこのページのスクリプト「ページを開いたとき」で、URLに {slug} を入れて1件を取得するか、一覧から項目が {slug} の1件を探して変数にしてください。", { base });
              })()}
            />
          </div>
        )}

        {pageKind !== "redirect" && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl lbl-info">
              {tr("外側の背景色")}
              <InfoTip text={tr("ページの端を越えてスクロールしたときに見える色です。未設定のときはbodyの背景色を使います。")} />
            </label>
            <FillControl
              value={page.htmlBackground}
              onChange={(v) =>
                updatePage(page.id, { htmlBackground: v ?? undefined })
              }
              onChangeStart={checkpoint}
              onChangeTransient={(v) =>
                updateDoc(
                  (draft) => {
                    const p = draft.pages[page.id];
                    if (p) p.htmlBackground = v ?? undefined;
                  },
                  { history: false }
                )
              }
            />
          </div>
        )}
      </Sec>

      {/* ---------- スクリプト ---------- */}
      {pageKind === "normal" && (
        <Sec
          title={tr("スクリプト")}
          defaultOpen={false}
          tutorialTarget="page-scripts"
          help="act-script"
          info={tr("「ボタンをクリックしたとき」などのきっかけに、ページを開く・要素を表示するといった動作をつないで、ページに動きを付けられます。")}
        >
          {pageScripts.length > 0 && <ScriptSummary
              items={pageScripts}
              onOpen={(script) => {
                // きっかけの要素があれば、その要素を選んだ状態にして開く
                const nodeId = pageScripts.find((p) => p.script.id === script.id)?.script.nodeId;
                const el = nodeId && nodeId !== PAGE_TARGET && doc.nodes[nodeId] ? nodeId : null;
                if (el) useEditor.getState().select(el);
                openScriptEditor({ focusNodeId: el, focusScriptId: script.id });
              }}
            />}
          <button
            className="btn"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => openScriptEditor({ focusNodeId: null })}
          >
            {tr("スクリプトを編集")}
          </button>
        </Sec>
      )}

      {/* ---------- 検索・シェア ---------- */}
      <Sec title={tr("検索・シェア（SEO）")} defaultOpen={false} tutorialTarget="page-seo" help="page-seo">
        <div className="row">
          <label>{tr("タイトル")}</label>
          <CommitInput
            key={`${page.id}-title`}
            className="input"
            value={page.title}
            placeholder={page.name}
            onCommit={(v) => updatePage(page.id, { title: v })}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl">{tr("説明文")}</label>
          <CommitTextarea
            key={`${page.id}-desc`}
            className="textarea"
            value={page.description}
            placeholder={tr("検索結果やSNSでシェアされたときに表示される紹介文です。")}
            onCommit={(v) => updatePage(page.id, { description: v })}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("シェア用画像（OGP）")}
            <InfoTip text={tr("SNSでリンクがシェアされたときに表示される画像です。未設定のときはサイト設定の画像を使います。1200×630pxがおすすめです。")} />
          </label>
          <ImagePicker
            value={page.ogImage}
            onChange={(v) => updatePage(page.id, { ogImage: v })}
          />
        </div>
        <label
          className="lbl"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <input
            type="checkbox"
            checked={!!page.noindex}
            onChange={(e) => updatePage(page.id, { noindex: e.target.checked })}
          />
          {tr("Googleなどの検索結果に表示させない")}
        </label>
      </Sec>

      {/* ---------- カスタムコード ---------- */}
      <Sec
        title={tr("カスタムコード")}
        defaultOpen={pageKind === "html"}
        tutorialTarget="page-code"
        help="page-code-snippet"
      >
        <Grp
          label={tr("ページの種類")}
          info={
            pageKind === "normal"
              ? tr("キャンバスで要素を組み立てる標準のページです。「HTML」にすると、このページをコードで直接書けます。")
              : undefined
          }
        >
        <Seg
          value={pageKind}
          options={[
            { label: tr("通常"), value: "normal" },
            { label: "HTML", value: "html", title: tr("コードを直接書いて配信") },
            {
              label: tr("リダイレクト"),
              value: "redirect",
              title: tr("別のURLへ301転送"),
            },
          ]}
          onChange={setPageKind}
        />
        </Grp>

      {pageKind === "redirect" && (
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("301リダイレクト先")}
            <InfoTip text={tr("このページへアクセスしたブラウザを転送先へ恒久的に移動します。リダイレクトページのキャンバスは編集できません。")} />
          </label>
          <input
            key={`${page.id}-redirect-${page.redirectTo ?? "empty"}`}
            className="input"
            defaultValue={page.redirectTo ?? ""}
            placeholder={tr("/new-page または https://example.com/...")}
            onBlur={(e) => {
              const value = e.target.value.trim();
              updatePage(page.id, {
                redirectTo:
                  value || page.rewriteTo === undefined ? value : undefined,
                ...(value ? { rewriteTo: undefined } : {}),
              });
            }}
            onKeyDown={blurOnEnter}
          />
        </div>
      )}

      {pageKind === "redirect" && (
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("外部サイトを表示（リバースプロキシ）")}
            <InfoTip text={tr("ブラウザのURLは変えず、指定した外部サイトの内容をこのURLで中継して表示します。このページ以下のパスも転送先の同じパスへ中継されます。301リダイレクトとは同時に設定できません。")} />
          </label>
          <input
            key={`${page.id}-rewrite-${page.rewriteTo ?? "empty"}`}
            className="input"
            defaultValue={page.rewriteTo ?? ""}
            placeholder="https://example.com/..."
            onBlur={(e) => {
              const value = e.target.value.trim();
              updatePage(page.id, {
                rewriteTo:
                  value || page.redirectTo === undefined ? value : undefined,
                ...(value ? { redirectTo: undefined } : {}),
              });
            }}
            onKeyDown={blurOnEnter}
          />
        </div>
      )}

      {pageKind === "html" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button
              className="btn btn-sm"
              onClick={() => htmlFileRef.current?.click()}
            >
              <FileUp size={12} />
              {tr("HTMLファイルを読み込む")}
            </button>
            <button
              className="btn btn-sm"
              disabled={zipBusy}
              data-tip={tr("index.html を優先して読み込みます。同梱のファイルはアセットにアップロードし、HTML内のパスを自動で書き換えます")}
              onClick={() => htmlZipRef.current?.click()}
            >
              <FileUp size={12} />
              {zipBusy ? tr("ZIPを読み込み中…") : tr("HTMLとアセットのZIPを読み込む")}
            </button>
            <input
              ref={htmlFileRef}
              type="file"
              accept=".html,.htm,text/html"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () =>
                  updatePage(page.id, {
                    rawHtml: String(reader.result ?? ""),
                  });
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
            <input
              ref={htmlZipRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importHtmlZip(file);
                e.target.value = "";
              }}
            />
          </div>
          {zipMessage && (
            <p className="hint" style={{ margin: 0 }} role="status">
              {zipMessage}
            </p>
          )}
          <label className="lbl lbl-info">
            {tr("HTMLコード")}
            <InfoTip text={tr("scriptやCSSを含むHTMLをそのまま配信します（このページにはNext.jsのレイアウトやメタデータは適用されません）。")} />
          </label>
          <CommitTextarea
            key={`${page.id}-rawhtml`}
            className="textarea mono"
            rows={14}
            value={page.rawHtml ?? ""}
            placeholder={
              "<!DOCTYPE html>\n<html>\n  <head>…</head>\n  <body>…</body>\n</html>"
            }
            spellCheck={false}
            onCommit={(v) => updatePage(page.id, { rawHtml: v })}
          />
        </>
      )}
      {pageKind === "normal" && (
        <>
          {/* ---- このページのみ ---- */}
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl lbl-info">
              {tr("先頭コード（このページのみ）")}
              <InfoTip text={tr("このページのHTMLの先頭・末尾に挿入されます。このページだけで使う計測タグや構造化データ（JSON-LD）などに使います。タイトルや説明文は「検索・シェア」で設定してください。")} />
            </label>
            <CommitTextarea
              key={`${page.id}-top`}
              className="textarea mono"
              rows={5}
              value={page.customTopHtml ?? ""}
              placeholder={
                '<script type="application/ld+json">...</script>'
              }
              spellCheck={false}
              onCommit={(v) => updatePage(page.id, { customTopHtml: v.trim() || undefined })}
            />
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl lbl-info">
              {tr("末尾コード（このページのみ）")}
              <InfoTip text={tr("このページのHTMLの先頭・末尾に挿入されます。このページだけで使う計測タグや構造化データ（JSON-LD）などに使います。タイトルや説明文は「検索・シェア」で設定してください。")} />
            </label>
            <CommitTextarea
              key={`${page.id}-end`}
              className="textarea mono"
              rows={5}
              value={page.customEndHtml ?? ""}
              placeholder={"<script>...</script>"}
              spellCheck={false}
              onCommit={(v) => updatePage(page.id, { customEndHtml: v.trim() || undefined })}
            />
          </div>

        </>
      )}
      </Sec>

    </div>
  );
}
