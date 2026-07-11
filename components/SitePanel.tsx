"use client";

import { isEnterKey } from "../lib/keys";
import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  FileDown,
  FileUp,
  History,
  Maximize,
  PanelTop,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useEditor } from "../lib/store";
import { showAlert, showConfirm } from "../lib/dialog";
import { assetSrc } from "../lib/assets";
import { SITE_LANGS, siteLangOf } from "../lib/site-lang";
import { genId, makeBox, makeText } from "../lib/presets";
import {
  DEFAULT_DATA_REVALIDATE,
  type DocNode,
  type Page,
  type PwaSetting,
} from "../lib/types";
import ImagePicker from "./ImagePicker";
import { BpIcon, CommitTextarea, FillControl, InfoTip, NumField, Section, Seg } from "./controls";
import {
  MAX_BREAKPOINTS,
  normalizeBaseWidth,
  normalizeBreakpoints,
  parseNumeric,
} from "../lib/style";
import {
  addBreakpoint,
  addedBreakpoints,
  breakpointUsage,
  isDefaultBreakpoints,
  removeBreakpoint,
  resetBreakpoints,
  updateBaseWidth,
  updateBreakpoint,
} from "../lib/breakpoints";
import { tr } from "../lib/i18n";

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

function makeLoadingPage(): { page: Page; nodes: DocNode[] } {
  const root = makeBox(tr("ローディング画面"), {
    width: "100%",
    minHeight: "100vh",
    padding: "40px",
    gap: "16px",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    color: "#18181b",
  });
  const nodes: DocNode[] = [root];
  const children: string[] = [];
  const text = makeText(tr("読み込み中…"), {
    color: "#18181b",
    textAlign: "center",
  });
  text.name = tr("ローディングテキスト");
  nodes.push(text);
  children.push(text.id);
  root.children = children;
  return {
    page: {
      id: genId("page"),
      name: tr("ローディング画面"),
      slug: "__loading-screen",
      title: tr("ローディング画面"),
      description: "",
      children: [root.id],
    },
    nodes,
  };
}

export function LoadingScreenSettings({
  showEditButton = true,
}: {
  showEditButton?: boolean;
}) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const updateDoc = useEditor((s) => s.updateDoc);
  const setActivePage = useEditor((s) => s.setActivePage);
  const select = useEditor((s) => s.select);
  const setting = doc.loadingScreen;

  const ensurePage = () => {
    const existing = setting?.pageId;
    if (existing && doc.pages[existing]) {
      // 一度オフにしたローディング画面は、作ってあるページのまま表示をオンに戻す
      if (!setting?.enabled) {
        updateDoc((d) => {
          if (d.loadingScreen) d.loadingScreen.enabled = true;
        });
      }
      return existing;
    }
    const made = makeLoadingPage();
    updateDoc((d) => {
      for (const node of made.nodes) d.nodes[node.id] = node;
      d.pages[made.page.id] = made.page;
      d.loadingScreen = {
        minDuration: 500,
        fadeDuration: 300,
        showOnce: false,
        ...d.loadingScreen,
        enabled: true,
        pageId: made.page.id,
      };
    });
    return made.page.id;
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label
        className="lbl"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        <input
          type="checkbox"
          checked={!!setting?.enabled}
          onChange={(e) => {
            if (e.target.checked) {
              ensurePage();
              return;
            }
            if (setting?.pageId === activePageId) {
              setActivePage(doc.pageOrder[0]);
            }
            updateDoc((d) => {
              if (d.loadingScreen) d.loadingScreen.enabled = false;
            });
          }}
        />
        {tr("ローディング画面を表示する")}
        <InfoTip text={tr("見た目は、通常のページと同じようにキャンバスで要素を追加・編集できます。")} />
      </label>
      {setting?.enabled && (
        <>
          {showEditButton && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ justifyContent: "center" }}
              onClick={() => {
                setActivePage(ensurePage());
                select(null);
              }}
            >
              {tr("ローディング画面を編集")}
            </button>
          )}
          <div className="grid2">
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">{tr("最短の表示時間（ms）")}</label>
              <input
                key={`loading-min-${setting.minDuration ?? 500}`}
                type="number"
                min={0}
                className="input"
                defaultValue={setting.minDuration ?? 500}
                onBlur={(e) =>
                  updateDoc((d) => {
                    if (d.loadingScreen)
                      d.loadingScreen.minDuration = Math.max(
                        0,
                        Number(e.target.value) || 0
                      );
                  })
                }
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">{tr("フェード（ms）")}</label>
              <input
                key={`loading-fade-${setting.fadeDuration ?? 300}`}
                type="number"
                min={0}
                className="input"
                defaultValue={setting.fadeDuration ?? 300}
                onBlur={(e) =>
                  updateDoc((d) => {
                    if (d.loadingScreen)
                      d.loadingScreen.fadeDuration = Math.max(
                        0,
                        Number(e.target.value) || 0
                      );
                  })
                }
              />
            </div>
          </div>
          <label
            className="lbl"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="checkbox"
              checked={!!setting.showOnce}
              onChange={(e) =>
                updateDoc((d) => {
                  if (d.loadingScreen)
                    d.loadingScreen.showOnce = e.target.checked;
                })
              }
            />
            {tr("同じタブでは初回だけ表示する")}
          </label>
        </>
      )}
    </div>
  );
}

const PWA_DISPLAY_MODES: {
  value: NonNullable<PwaSetting["display"]>;
  label: string;
  desc: string;
  icon: typeof AppWindow;
}[] = [
  {
    value: "standalone",
    label: tr("スタンドアロン"),
    desc: tr("アドレスバーのない、アプリと同じ見た目で開きます。"),
    icon: AppWindow,
  },
  {
    value: "minimal-ui",
    label: tr("最小UI"),
    desc: tr("戻る・再読み込みなど、最小限の操作だけを残して開きます。"),
    icon: PanelTop,
  },
  {
    value: "fullscreen",
    label: tr("全画面"),
    desc: tr("ステータスバーも隠して画面全体に表示します。ゲームや展示向けです。"),
    icon: Maximize,
  },
];

/** PWA（ホーム画面に追加してアプリのように使える）の公開設定 */
function PwaSettings() {
  const pwa = useEditor((s) => s.doc.pwa);
  const doc = useEditor((s) => s.doc);
  const updateDoc = useEditor((s) => s.updateDoc);
  const set = (patch: Partial<PwaSetting>) =>
    updateDoc((d) => {
      d.pwa = { ...(d.pwa ?? { enabled: false }), ...patch };
    });

  const appName = pwa?.name?.trim() || doc.siteName;
  const shortName = pwa?.shortName?.trim() || appName;
  const mode =
    PWA_DISPLAY_MODES.find((m) => m.value === (pwa?.display ?? "standalone")) ??
    PWA_DISPLAY_MODES[0];
  // 公開時と同じ順でアイコンを選ぶ（PWA用 → ホーム画面アイコン → ファビコン）
  const iconSrc = [pwa?.icon, doc.appleTouchIcon, doc.favicon]
    .map((r) => {
      if (!r) return null;
      const asset = r.assetId ? doc.assets[r.assetId] : null;
      return asset ? assetSrc(asset) : r.url?.trim() || null;
    })
    .find(Boolean);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <label
        className="lbl"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        <input
          type="checkbox"
          checked={!!pwa?.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        {tr("PWAとして公開する")}
        <InfoTip text={tr("スマートフォンやパソコンで「ホーム画面に追加」「アプリをインストール」したとき、ブラウザの枠なしでアプリのように開けます。")} />
      </label>
      {pwa?.enabled && (
        <>
          <div
            className="pwa-preview"
            style={
              pwa.themeColor
                ? ({ "--pwa-theme": pwa.themeColor } as React.CSSProperties)
                : undefined
            }
          >
            <div
              className="pwa-preview-icon"
              style={
                pwa.backgroundColor
                  ? { background: pwa.backgroundColor }
                  : undefined
              }
            >
              {iconSrc ? (
                <img src={iconSrc} alt="" />
              ) : (
                <span>{shortName.slice(0, 1)}</span>
              )}
            </div>
            <div className="pwa-preview-text">
              <div className="pwa-preview-name">{appName}</div>
              <div className="pwa-preview-sub">
                {shortName !== appName ? `${shortName} · ` : ""}
                {mode.label}
              </div>
            </div>
          </div>

          <div className="grid2" style={{ alignItems: "start" }}>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl">{tr("アプリ名")}</label>
              <input
                key={`pwa-name-${pwa.name ?? ""}`}
                className="input"
                defaultValue={pwa.name ?? ""}
                placeholder={doc.siteName}
                onBlur={(e) => set({ name: e.target.value.trim() || undefined })}
                onKeyDown={blurOnEnter}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl lbl-info">
                {tr("短い名前")}
                <InfoTip text={tr("ホーム画面のアイコンの下に出る名前です。12文字程度までにします。")} />
              </label>
              <input
                key={`pwa-short-${pwa.shortName ?? ""}`}
                className="input"
                defaultValue={pwa.shortName ?? ""}
                placeholder={appName}
                onBlur={(e) =>
                  set({ shortName: e.target.value.trim() || undefined })
                }
                onKeyDown={blurOnEnter}
              />
            </div>
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl lbl-info">
              {tr("アイコン")}
              <InfoTip text={tr("512×512pxの正方形のPNGがおすすめです。未設定のときはホーム画面アイコンを、それもなければファビコンを使います。")} />
            </label>
            <ImagePicker value={pwa.icon} onChange={(v) => set({ icon: v })} />
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl">{tr("表示モード")}</label>
            <Seg
              value={mode.value}
              options={PWA_DISPLAY_MODES.map((m) => ({
                value: m.value,
                title: m.label,
                label: (
                  <>
                    <m.icon size={13} />
                    {m.value === mode.value && m.label}
                  </>
                ),
              }))}
              onChange={(v) => set({ display: v as PwaSetting["display"] })}
            />
            <div className="hint">{mode.desc}</div>
          </div>

          <div className="grid2" style={{ alignItems: "start" }}>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl lbl-info">
                {tr("テーマ色")}
                <InfoTip text={tr("アプリとして開いたときの、タイトルバーやステータスバーの色です。")} />
              </label>
              <FillControl
                value={pwa.themeColor}
                onChange={(v) => set({ themeColor: v ?? undefined })}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl lbl-info">
                {tr("背景色")}
                <InfoTip text={tr("起動してからページが表示されるまでの画面の色です。アイコンの余白にも使われます。")} />
              </label>
              <FillControl
                value={pwa.backgroundColor}
                onChange={(v) => set({ backgroundColor: v ?? undefined })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** ブレークポイント（各デバイスのスタイルが効く画面幅）の編集・追加・削除 */
function BreakpointSettings() {
  const doc = useEditor((s) => s.doc);
  const updateDoc = useEditor((s) => s.updateDoc);
  const list = normalizeBreakpoints(doc.breakpoints);
  const baseWidth = normalizeBaseWidth(doc.baseWidth, list);

  const remove = async (id: string, label: string) => {
    const used = breakpointUsage(doc, id);
    if (
      used &&
      !(await showConfirm(
        tr("{used}個の要素に設定した「{label}」用のスタイル・表示設定も削除されます（「元に戻す」で戻せます）。", { used, label }),
        { title: tr("「{label}」を削除しますか？", { label }), okLabel: tr("削除"), danger: true }
      ))
    ) {
      return;
    }
    updateDoc((d) => removeBreakpoint(d, id));
  };
  const reset = async () => {
    const added = addedBreakpoints(doc);
    const used = added.reduce((n, b) => n + breakpointUsage(doc, b.id), 0);
    if (
      used &&
      !(await showConfirm(
        tr("追加した{names}用のスタイル（{used}個の要素）が削除されます。", {
          names: added.map((b) => tr("「{name}」", { name: tr(b.label) })).join(tr("・")),
          used,
        }),
        { title: tr("ブレークポイントを既定に戻しますか？"), okLabel: tr("既定に戻す"), danger: true }
      ))
    ) {
      return;
    }
    updateDoc((d) => resetBreakpoints(d));
  };

  return (
    <div data-section="breakpoints">
      <Sec
        title={tr("ブレークポイント")}
        tutorialTarget="site-breakpoints"
        help="resp-breakpoints"
        info={
          tr("画面幅ごとにスタイルを変えるための区切りです。それぞれのスタイルは、その幅以下の画面に効きます（小さい幅のほうが優先）。\n「パソコン」はキャンバスで表示するときの幅です。名前の変更や、追加・削除もできます。")
        }
      >
        <div className="bp-edit">
          <div className="bp-edit-row">
            <span className="bp-edit-name">
              <BpIcon bp="base" />
              <span className="bp-edit-fixed">{tr("パソコン")}</span>
            </span>
            <div className="bp-edit-field" data-tip={tr("キャンバスで表示する幅")}>
              <NumField
                pre={tr("幅")}
                value={`${baseWidth}px`}
                units={["px"]}
                min={320}
                max={3000}
                onChange={(v) =>
                  updateDoc((d) => updateBaseWidth(d, v ? (parseNumeric(v)?.num ?? null) : null))
                }
              />
            </div>
            <span />
          </div>
          {list.map((b) => (
            <div key={b.id} className="bp-edit-row">
              <span className="bp-edit-name">
                <BpIcon bp={b.id} />
                <input
                  key={b.label}
                  className="bp-edit-label"
                  defaultValue={tr(b.label)}
                  aria-label={tr("ブレークポイントの名前")}
                  onBlur={(e) => {
                    // 既定の名前は日本語で保存し、表示するときに訳す（訳のまま変えていなければ保存しない）
                    const label = e.target.value.trim();
                    if (label && label !== tr(b.label)) updateDoc((d) => updateBreakpoint(d, b.id, { label }));
                    else e.target.value = tr(b.label);
                  }}
                  onKeyDown={(e) => {
                    if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                  }}
                />
              </span>
              <div className="bp-edit-field" data-tip={tr("{maxWidth}px以下の画面に効きます", { maxWidth: b.maxWidth })}>
                <NumField
                  pre="≦"
                  value={`${b.maxWidth}px`}
                  units={["px"]}
                  min={240}
                  max={2999}
                  onChange={(v) => {
                    const n = v ? parseNumeric(v)?.num : undefined;
                    if (n !== undefined) updateDoc((d) => updateBreakpoint(d, b.id, { maxWidth: n }));
                  }}
                />
              </div>
              <button
                type="button"
                className="icon-btn sm"
                aria-label={tr("{label}を削除", { label: tr(b.label) })}
                data-tip={tr("{label}を削除", { label: tr(b.label) })}
                onClick={() => remove(b.id, tr(b.label))}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="bp-edit-actions">
          <button
            className="btn btn-sm"
            disabled={list.length >= MAX_BREAKPOINTS}
            data-tip={list.length >= MAX_BREAKPOINTS ? tr("{MAX_BREAKPOINTS}個まで追加できます", { MAX_BREAKPOINTS }) : undefined}
            onClick={() => updateDoc((d) => void addBreakpoint(d))}
          >
            <Plus size={12} />
            {tr("追加")}
          </button>
          {!isDefaultBreakpoints(doc) && (
            <button className="btn btn-sm" onClick={reset}>
              <RotateCcw size={12} />
              {tr("既定に戻す")}
            </button>
          )}
        </div>
      </Sec>
    </div>
  );
}

export default function SitePanel() {
  const doc = useEditor((s) => s.doc);
  const updateDoc = useEditor((s) => s.updateDoc);
  const restoreDoc = useEditor((s) => s.restoreDoc);
  const docFileRef = useRef<HTMLInputElement>(null);

  const exportDocJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tsumu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // すぐに破棄すると、Safari などでダウンロードが始まらないことがある
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importDocJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        void showAlert(tr("エディタで保存したバックアップファイルか確認してください。"), {
          title: tr("このファイルは読み込めませんでした"),
        });
        return;
      }
      if (!parsed?.pages || !parsed?.nodes || !parsed?.pageOrder?.length) {
        void showAlert(tr("ページや要素の情報が見つかりません。エディタで保存したバックアップファイルを選んでください。"), {
          title: tr("編集データの形式ではありません"),
        });
        return;
      }
      if (
        await showConfirm(tr("いまの編集内容は、このファイルの内容に置き換わります。「元に戻す」（⌘Z）で今の内容に戻せます。"), {
          title: tr("バックアップを読み込みますか？"),
          okLabel: tr("読み込む"),
        })
      ) {
        restoreDoc(parsed);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="panel-body" data-tutorial="site-settings">
      <Sec title={tr("サイト設定")} tutorialTarget="site-basics" help="pub-site">
        <div className="row">
          <label className="lbl-info">
            {tr("サイト名")}
            <InfoTip text={tr("ブラウザのタブの名前が「ページ名 | サイト名」の形になります。")} />
          </label>
          <input
            key={doc.siteName}
            className="input"
            defaultValue={doc.siteName}
            onBlur={(e) =>
              updateDoc(
                (d) => void (d.siteName = e.target.value.trim() || d.siteName)
              )
            }
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="row">
          <label className="lbl-info">
            {tr("サイトURL")}
            <InfoTip text={tr("公開したサイトのアドレスです（例: https://example.com）。シェア用画像のURLなどに使います。")} />
          </label>
          <input
            key={doc.siteUrl ?? "_"}
            className="input"
            defaultValue={doc.siteUrl ?? ""}
            placeholder="https://example.com"
            onBlur={(e) =>
              updateDoc(
                (d) => void (d.siteUrl = e.target.value.trim() || undefined)
              )
            }
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="row">
          <label className="lbl-info">
            {tr("言語")}
            <InfoTip text={tr("ページの文章の言語です。ブラウザの読み上げ・翻訳や検索エンジンが、この言語として扱います。")} />
          </label>
          <select
            className="select"
            value={siteLangOf(doc)}
            onChange={(e) => {
              const lang = e.target.value;
              updateDoc((d) => void (d.lang = lang));
            }}
          >
            {SITE_LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            {/* 一覧に無いコード（AI などで設定したもの）もそのまま選べるようにする */}
            {!SITE_LANGS.some((l) => l.value === siteLangOf(doc)) && (
              <option value={siteLangOf(doc)}>{siteLangOf(doc)}</option>
            )}
          </select>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("ファビコン（タブのアイコン）")}
            <InfoTip text={tr("正方形のPNG・SVG・ICOがおすすめです。")} />
          </label>
          <ImagePicker
            value={doc.favicon}
            onChange={(v) => updateDoc((d) => void (d.favicon = v))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("ホーム画面アイコン")}
            <InfoTip text={tr("iPhone・iPadで「ホーム画面に追加」したときのアイコンです（apple-touch-icon）。180×180pxのPNGがおすすめです。")} />
          </label>
          <ImagePicker
            value={doc.appleTouchIcon}
            onChange={(v) => updateDoc((d) => void (d.appleTouchIcon = v))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("デフォルトのシェア用画像（OGP）")}
            <InfoTip text={tr("ページで設定していないときに使われます。1200×630pxがおすすめです。")} />
          </label>
          <ImagePicker
            value={doc.ogImage}
            onChange={(v) => updateDoc((d) => void (d.ogImage = v))}
          />
        </div>
        <div
          data-tutorial="site-loading"
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <LoadingScreenSettings />
        </div>
        <div
          data-tutorial="site-pwa"
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <PwaSettings />
        </div>
      </Sec>

      <Sec
        title={tr("ホスティングとデータの更新")}
        defaultOpen={false}
        tutorialTarget="site-hosting"
        help="pub-hosting"
        info={tr("書き出したサイトを動かすサービスと、外部のJSONを使うページを取得し直す間隔です。")}
      >
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("公開先のホスティング")}
            <InfoTip text={tr("書き出すサイトを動かすサービスです。外部のJSONを使うページの作り方が変わります。\n標準: Vercel・Netlify・Node.js など。ページを作り置き、更新間隔ごとに作り直します（ISR）。\nCloudflare Workers: ページはアクセスのたびに描画し、取得したJSONを更新間隔のあいだCloudflareのキャッシュに置きます。")} />
          </label>
          <Seg
            value={doc.hosting ?? "standard"}
            options={[
              { value: "standard", label: tr("標準（Vercel など）") },
              { value: "cloudflare", label: "Cloudflare", title: "Cloudflare Workers" },
            ]}
            onChange={(v) =>
              updateDoc((d) => void (d.hosting = v === "cloudflare" ? "cloudflare" : undefined))
            }
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("データの更新間隔（秒）")}
            <InfoTip text={tr("外部のJSONを使うページを取得し直す間隔です。その間は作っておいたページ（Cloudflareでは取得済みのJSON）を使うので、サーバーの負荷を抑えられます。0にするとアクセスのたびに取得します（常に最新ですが、負荷は大きくなります）。")} />
          </label>
          <input
            key={doc.dataRevalidate ?? "_"}
            className="input"
            inputMode="numeric"
            defaultValue={doc.dataRevalidate ?? ""}
            placeholder={String(DEFAULT_DATA_REVALIDATE)}
            onBlur={(e) => {
              const t = e.target.value.trim();
              const n = Math.max(0, Math.round(Number(t)));
              updateDoc(
                (d) => void (d.dataRevalidate = t === "" || Number.isNaN(n) ? undefined : n)
              );
            }}
            onKeyDown={blurOnEnter}
          />
        </div>
      </Sec>

      <Sec
        title={tr("カスタムコード（全ページ共通）")}
        defaultOpen={false}
        tutorialTarget="site-code"
        help="page-code-snippet"
      >
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("head内コード")}
            <InfoTip text={tr("全ページの <head> に挿入されます。")} />
          </label>
          <CommitTextarea
            className="textarea mono"
            rows={5}
            value={doc.customHeadHtml ?? ""}
            placeholder={'<meta name="..." content="...">\n<script>...</script>'}
            spellCheck={false}
            onCommit={(v) => updateDoc((d) => void (d.customHeadHtml = v.trim() || undefined))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info">
            {tr("body末尾コード")}
            <InfoTip text={tr("全ページの </body> 直前に挿入されます。")} />
          </label>
          <CommitTextarea
            className="textarea mono"
            rows={5}
            value={doc.customBodyEndHtml ?? ""}
            placeholder={"<script>...</script>"}
            spellCheck={false}
            onCommit={(v) => updateDoc((d) => void (d.customBodyEndHtml = v.trim() || undefined))}
          />
        </div>
      </Sec>

      <BreakpointSettings />

      <Sec
        title={tr("バックアップ")}
        tutorialTarget="site-backup"
        help="pub-backup"
        info={tr("サイト全体の編集データをバックアップファイルとして保存・復元します。公開時にリポジトリへ保存される _tsumu/doc.json も読み込めます。")}
        defaultOpen={false}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            data-tip={tr("サーバーの自動バックアップや、公開した版の編集内容に戻します")}
            onClick={() => window.dispatchEvent(new CustomEvent("tsumu-open-history", { detail: "doc" }))}
          >
            <History size={12} />
            {tr("履歴から戻す")}
          </button>
          <button className="btn btn-sm" onClick={exportDocJson}>
            <FileDown size={12} />
            {tr("書き出す")}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => docFileRef.current?.click()}
          >
            <FileUp size={12} />
            {tr("読み込む")}
          </button>
          <input
            ref={docFileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importDocJson(file);
              e.target.value = "";
            }}
          />
        </div>
      </Sec>
    </div>
  );
}
