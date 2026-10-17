"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import {
  CircleHelp,
  Download,
  FileText,
  Globe,
  History,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Play,
  Redo2,
  RotateCcw,
  Settings,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Undo2,
  ZoomIn,
} from "lucide-react";
import { useEditor } from "../lib/store";
import { closeHelp, toggleHelp, useHelp } from "../lib/help";
import { useServerStatus } from "../lib/status";
import { toggleAi, useAi, useAiAvailability } from "./AiChat";
import { toggleCommentMode, useComments } from "../lib/comment-store";
import PublishModal, { CheckList, docWithSvgFilters, HistoryModal, useEscapeToClose } from "./PublishModal";
import { showAlert, showPrompt } from "../lib/dialog";
import { BP_INFO, BP_ORDER, breakpointForWidth, DEVICE_WIDTHS, parseNumeric } from "../lib/style";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { exportProjectZip } from "../lib/exportZip";
import { BpIcon, Dropdown, NumField, Seg } from "./controls";
import { userMessage } from "../lib/errors";
import { getLang, LANGS, setLang, tr, trNodes, type Lang } from "../lib/i18n";

function ExportModal({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [busy, setBusy] = useState(false);
  const checks: CheckResult[] = runChecks(doc);
  const hasError = checks.some((c) => c.level === "error");
  useEscapeToClose(onClose, !busy);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("Next.jsプロジェクトとして書き出し")}</h2>
        <p className="modal-desc">
          {trNodes("プロジェクト一式をzipでダウンロードします。展開して {cmd} を実行すると、そのまま動きます。", {
            cmd: <span className="kbd">npm install && npm run dev</span>,
          })}
        </p>

        <CheckList checks={checks} onClose={onClose} />

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {tr("キャンセル")}
          </button>
          <button
            className="btn btn-primary"
            disabled={hasError || busy}
            style={hasError ? { opacity: 0.5, pointerEvents: "none" } : undefined}
            onClick={async () => {
              setBusy(true);
              try {
                const missing = await exportProjectZip(await docWithSvgFilters());
                onClose();
                if (missing.length) {
                  void showAlert(
                    tr("次の画像は保存先に見つからなかったため、zipに含めていません（削除済みの可能性があります）。\n{p1}", { p1: missing.join("\n") }),
                    { title: tr("一部の画像を含めずにダウンロードしました") }
                  );
                }
              } catch (e) {
                void showAlert(userMessage(e, tr("zipを生成できませんでした")), { title: tr("zipを生成できませんでした") });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={13} />
            {busy ? tr("生成中…") : tr("zipをダウンロード")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 設定（表示言語・サイトのリセット） ---------- */

/** エディタの設定（ログインできるアカウントなど全サイト共通の設定は、ホームの設定にある） */
function SettingsModal({ onClose }: { onClose: () => void }) {
  const resetDoc = useEditor((s) => s.resetDoc);
  useEscapeToClose(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("設定")}</h2>

        <section className="settings-sec">
          <h3>{tr("表示言語")}</h3>
          <Seg
            value={getLang()}
            options={LANGS}
            onChange={(v) => {
              if (v !== getLang()) setLang(v as Lang);
            }}
          />
          <p className="hint">{tr("切り替えると画面を読み込み直します。作成中のサイトの内容は変わりません。")}</p>
        </section>

        <section className="settings-sec">
          <h3>{tr("サイトのリセット")}</h3>
          <button
            className="btn"
            onClick={async () => {
              // 誤操作を防ぐため、確認の文を入力したときだけ実行できる
              const confirmation = await showPrompt(
                tr("サイト全体を初期状態に戻します（「元に戻す」で復帰できます）。\n実行するには「初期状態に戻す」と入力してください。"),
                { title: tr("初期状態に戻しますか？"), expect: tr("初期状態に戻す"), okLabel: tr("初期状態に戻す"), danger: true }
              );
              if (confirmation !== tr("初期状態に戻す")) return;
              resetDoc();
              onClose();
            }}
          >
            <RotateCcw size={13} />
            {tr("初期状態に戻す")}
          </button>
          <p className="hint">{tr("すべてのページ・要素・設定を消して、新規作成した直後の状態に戻します。公開済みのサイトは、再度公開するまで変わりません。")}</p>
        </section>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>
            {tr("閉じる")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ログアウトの確認（サーバーへ保存していない変更があれば知らせる） */
function LogoutModal({ onClose }: { onClose: () => void }) {
  const cloudState = useEditor((s) => s.cloudState);
  const [busy, setBusy] = useState(false);
  const unsaved = cloudState === "saving" || cloudState === "local" || cloudState === "error";
  useEscapeToClose(onClose, !busy);
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
        <h2>{tr("ログアウトしますか？")}</h2>
        <p className="modal-desc">
          {tr("もう一度使うには、Googleアカウントでログインし直す必要があります。")}
        </p>
        {unsaved && (
          <ul className="check-list">
            <li className="is-error">
              <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
              {cloudState === "saving"
                ? tr("サーバーへ保存しています。保存が終わってからログアウトすると安全です。")
                : tr("サーバーに保存されていない変更があります。このブラウザには残りますが、他の端末からは見えません。")}
            </li>
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy} autoFocus>
            {tr("キャンセル")}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signOut({ callbackUrl: "/login" });
            }}
          >
            {busy ? <LoaderCircle size={13} className="spin" /> : <LogOut size={13} />}
            {tr("ログアウト")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Header({
  panels,
  onTogglePanel,
}: {
  /** 左右パネルが開いているか */
  panels: { l: boolean; r: boolean };
  onTogglePanel: (side: "l" | "r") => void;
}) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const breakpoint = useEditor((s) => s.breakpoint);
  const setBreakpoint = useEditor((s) => s.setBreakpoint);
  const customWidth = useEditor((s) => s.customWidth);
  const setCustomWidth = useEditor((s) => s.setCustomWidth);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const [exporting, setExporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const status = useServerStatus();
  const [historyOpen, setHistoryOpen] = useState<false | "site" | "doc">(false);
  // サイト設定の「履歴から戻す」から開く
  useEffect(() => {
    const open = (e: Event) => {
      closeHelp();
      setHistoryOpen((e as CustomEvent<"site" | "doc">).detail === "doc" ? "doc" : "site");
    };
    window.addEventListener("tsumu-open-history", open);
    return () => window.removeEventListener("tsumu-open-history", open);
  }, []);
  const helpOpen = useHelp((s) => s.open);
  const commenting = useComments((s) => s.active);
  /** まだ解決していないコメントの数（ボタンに添える） */
  const openComments = useComments((s) => s.threads.filter((t) => !t.resolvedAt).length);
  useEffect(() => {
    void useComments.getState().load();
  }, []);
  const aiEnabled = useAiAvailability();
  const aiOpen = useAi((s) => s.open);
  /** モーダルを開くときは、重なるヘルプを閉じる */
  const openModal = (open: (v: boolean) => void) => {
    closeHelp();
    open(true);
  };

  return (
    <header className="hdr">
      <div className="hdr-group">
        {/* ホーム（サイトの一覧）へ。ページごと移動するので、未保存の変更があればブラウザが確認する */}
        <a className="icon-btn" href="/" aria-label={tr("サイト一覧")} data-tip={tr("サイト一覧へ戻る")}>
          <LayoutGrid size={16} />
        </a>
        {mode === "design" && (
          <button
            className={`icon-btn${panels.l ? "" : " is-off"}`}
            onClick={() => onTogglePanel("l")}
            aria-label={panels.l ? tr("左パネルを閉じる") : tr("左パネルを開く")}
            aria-pressed={panels.l}
            data-tip={panels.l ? tr("左パネルを閉じる") : tr("左パネルを開く")}
            data-tip-kbd="⌘["
          >
            {panels.l ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        )}
        <div className="hdr-page" data-tutorial="pages">
          <Dropdown
            value={activePageId}
            options={[
              ...(doc.loadingScreen?.enabled &&
              doc.loadingScreen.pageId &&
              doc.pages[doc.loadingScreen.pageId]
                ? [
                    {
                      value: doc.loadingScreen.pageId,
                      label: tr("ローディング画面"),
                      desc: tr("サイト共通"),
                      icon: <LoaderCircle size={13} />,
                    },
                  ]
                : []),
              ...doc.pageOrder.map((id) => ({
                value: id,
                label: doc.pages[id].unpublished
                  ? tr("{name}（非公開）", { name: doc.pages[id].name })
                  : doc.pages[id].name,
                // フォルダに入れているページは、フォルダ名も添える
                desc: `${
                  doc.pageFolders?.find((f) => f.id === doc.pages[id].folderId)?.name
                    ? `${doc.pageFolders.find((f) => f.id === doc.pages[id].folderId)!.name} · `
                    : ""
                }/${doc.pages[id].slug}`,
                icon: <FileText size={13} />,
              })),
            ]}
            onChange={setActivePage}
            menuWidth={200}
          />
        </div>
        <div className="hdr-sep" />
        <button
          className="icon-btn"
          data-tutorial="undo"
          disabled={!past.length}
          onClick={undo}
          aria-label={tr("元に戻す")}
          data-tip={tr("元に戻す")} data-tip-kbd="⌘Z"
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-btn"
          disabled={!future.length}
          onClick={redo}
          aria-label={tr("やり直す")}
          data-tip={tr("やり直す")} data-tip-kbd="⇧⌘Z"
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="hdr-center" data-tutorial="responsive">
        <div className="hdr-center-in">
          {/* 狭いとき・ブレークポイントが多いときは、ドロップダウンに切り替える（CSSのコンテナクエリ） */}
          <div className="hdr-bp-dd">
            <Dropdown
              value={breakpoint}
              menuWidth={220}
              options={BP_ORDER.map((bp) => ({
                value: bp,
                label: BP_INFO[bp].label,
                desc:
                  bp === "base"
                    ? `${BP_INFO[bp].width}px`
                    : tr("{max}px以下に反映", { max: BP_INFO[bp].maxWidth ?? 0 }),
                icon: <BpIcon bp={bp} size={13} />,
              }))}
              onChange={(v) => setBreakpoint(v)}
            />
          </div>
          <div className={`seg bp-seg${BP_ORDER.length > 4 ? " is-many" : ""}`}>
            {BP_ORDER.map((bp) => (
              <button
                key={bp}
                className={breakpoint === bp && customWidth === null ? "is-on" : ""}
                data-tutorial={`breakpoint-${bp}`}
                data-tip={tr("{label}（{width}px）で表示 ― 変更は{scope}", { label: BP_INFO[bp].label, width: BP_INFO[bp].width, scope: BP_INFO[bp].scope })}
                aria-label={tr("{label}で表示", { label: BP_INFO[bp].label })}
                onClick={() => setBreakpoint(bp)}
              >
                <BpIcon bp={bp} size={14} />
                <span className="bp-seg-label">{BP_INFO[bp].short}</span>
              </button>
            ))}
          </div>
          <div className="hdr-width" data-tutorial="canvas-width">
            <NumField
              value={`${customWidth ?? BP_INFO[breakpoint].width}px`}
              units={["px"]}
              min={240}
              max={3000}
              title={tr("画面幅を指定（キャンバス左右の端をドラッグしても変えられます）")}
              pre={<MoveHorizontal size={12} />}
              onChange={(v) => {
                const n = v ? parseNumeric(v)?.num : undefined;
                setCustomWidth(n ?? null);
              }}
              onScrub={(v) => {
                const n = parseNumeric(v)?.num;
                if (n !== undefined) setCustomWidth(n);
              }}
            />
            <Dropdown
              value={String(customWidth ?? BP_INFO[breakpoint].width)}
              title={tr("よくある端末の幅で確かめる")}
              trigger={<Smartphone size={14} />}
              menuWidth={240}
              options={[...DEVICE_WIDTHS]
                .sort((a, b) => a.width - b.width)
                .map((d) => ({
                  value: String(d.width),
                  label: d.label,
                  desc: `${d.width}px`,
                  icon: <BpIcon bp={breakpointForWidth(d.width)} size={13} />,
                }))}
              onChange={(v) => {
                const w = Number(v);
                // ブレークポイントの表示幅ちょうどなら、そのデバイス表示として扱う
                const bp = BP_ORDER.find((b) => BP_INFO[b].width === w);
                if (bp) setBreakpoint(bp);
                else setCustomWidth(w);
              }}
            />
          </div>
        </div>
      </div>

      <div className="hdr-group">
        <div className="hdr-zoom" data-tutorial="zoom" data-tip={tr("⌘+スクロールでもズームできます")}>
          <Dropdown
            value={String(zoom)}
            options={[
              { value: "0", label: tr("フィット"), icon: <ZoomIn size={13} /> },
              ...([0.5, 0.75, 1, 1.5].includes(zoom) || zoom === 0
                ? []
                : [
                    {
                      value: String(zoom),
                      label: `${Math.round(zoom * 100)}%`,
                      icon: <ZoomIn size={13} />,
                    },
                  ]),
              { value: "0.5", label: "50%", icon: <ZoomIn size={13} /> },
              { value: "0.75", label: "75%", icon: <ZoomIn size={13} /> },
              { value: "1", label: "100%", icon: <ZoomIn size={13} /> },
              { value: "1.5", label: "150%", icon: <ZoomIn size={13} /> },
            ]}
            onChange={(v) => setZoom(+v)}
          />
        </div>
        <div className="seg" data-tutorial="preview">
          <button
            className={mode === "design" ? "is-on" : ""}
            onClick={() => setMode("design")}
            aria-label={tr("デザイン")}
          >
            <PenTool size={12} className="hdr-icon-narrow" />
            <span className="hdr-label">{tr("デザイン")}</span>
          </button>
          <button
            className={mode === "preview" ? "is-on" : ""}
            onClick={() => setMode("preview")}
            aria-label={tr("プレビュー")}
            data-tip={tr("ボタンやリンクの動きを試す")}
          >
            <Play size={12} />
            <span className="hdr-label">{tr("プレビュー")}</span>
          </button>
        </div>
        {aiEnabled && (
          <button
            className={`icon-btn hdr-ai${aiOpen ? " is-on" : ""}`}
            data-tutorial="ai"
            data-tip={tr("AIに頼んで編集する")}
            aria-label={tr("AIに頼む")}
            aria-pressed={aiOpen}
            onClick={() => {
              closeHelp();
              toggleAi();
            }}
          >
            <Sparkles size={15} />
          </button>
        )}
        <button
          className={`icon-btn hdr-comment${commenting && mode === "design" ? " is-on" : ""}`}
          data-tutorial="comments"
          data-tip={tr("コメント")}
          data-tip-kbd="C"
          aria-label={tr("コメント")}
          aria-pressed={commenting && mode === "design"}
          onClick={() => {
            closeHelp();
            toggleCommentMode(!(commenting && mode === "design"));
          }}
        >
          <MessageSquare size={15} />
          {openComments > 0 && <span className="hdr-badge">{openComments > 99 ? "99+" : openComments}</span>}
        </button>
        <button
          className={`icon-btn${helpOpen ? " is-on" : ""}`}
          data-tutorial="help"
          data-tip={tr("ヘルプ・使い方")}
          data-tip-kbd="?"
          aria-label={tr("ヘルプ")}
          aria-pressed={helpOpen}
          onClick={() => {
            toggleAi(false);
            toggleHelp();
          }}
        >
          <CircleHelp size={15} />
        </button>
        {/* 使う頻度の低い操作は1つのメニューにまとめる */}
        <div className="hdr-more" data-tutorial="menu">
          <Dropdown
            value=""
            trigger={<MoreHorizontal size={16} />}
            title={tr("メニュー（書き出し・履歴・設定）")}
            menuWidth={230}
            options={[
              { value: "history", label: tr("履歴・ロールバック"), icon: <History size={13} /> },
              { value: "export", label: tr("zipでエクスポート"), icon: <Download size={13} /> },
              { value: "settings", label: tr("設定"), icon: <Settings size={13} /> },
              // Google認証を使っていない（ログインなしで開ける）ときはログアウトを出さない
              ...(status?.auth === false
                ? []
                : [{ value: "logout", label: tr("ログアウト"), icon: <LogOut size={13} /> }]),
            ]}
            onChange={(v) => {
              if (v === "export") openModal(setExporting);
              else if (v === "history") {
                closeHelp();
                setHistoryOpen("site");
              }
              else if (v === "settings") openModal(setSettingsOpen);
              else if (v === "logout") openModal(setLogoutOpen);
            }}
          />
        </div>
        <button
          className="btn btn-primary"
          data-tutorial="publish"
          onClick={() => openModal(setPublishing)}
        >
          <Globe size={13} />
          {tr("公開")}
        </button>
        {mode === "design" && (
          <button
            className={`icon-btn${panels.r ? "" : " is-off"}`}
            onClick={() => onTogglePanel("r")}
            aria-label={panels.r ? tr("右パネルを閉じる") : tr("右パネルを開く")}
            aria-pressed={panels.r}
            data-tip={panels.r ? tr("右パネルを閉じる") : tr("右パネルを開く")}
            data-tip-kbd="⌘]"
          >
            {panels.r ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        )}
      </div>

      {exporting && <ExportModal onClose={() => setExporting(false)} />}
      {logoutOpen && <LogoutModal onClose={() => setLogoutOpen(false)} />}
      {publishing && (
        <PublishModal
          onClose={() => setPublishing(false)}
          onOpenHistory={() => {
            setPublishing(false);
            setHistoryOpen("site");
          }}
        />
      )}
      {historyOpen && <HistoryModal initialTab={historyOpen} onClose={() => setHistoryOpen(false)} />}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </header>
  );
}
