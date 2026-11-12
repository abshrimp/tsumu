"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useDocumentConfirmation } from "../lib/use-document-confirmation";
import { closeHelp, toggleHelp, useHelp } from "../lib/help";
import { useServerStatus } from "../lib/status";
import { toggleAi, useAi, useAiAvailability } from "./AiChat";
import { toggleCommentMode, useComments } from "../lib/comment-store";
import PublishModal, { CheckList, docWithSvgFilters, HistoryModal, useEscapeToClose } from "./PublishModal";
import { showAlert, showPrompt } from "../lib/dialog";
import { BP_INFO, BP_ORDER, breakpointForWidth, DEVICE_WIDTHS, parseNumeric } from "../lib/style";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { exportProjectZip } from "../lib/exportZip";
import { exportLimitations, exportScopeDoc, DEFAULT_EXPORT_OPTIONS, EXPORT_FRAMEWORK_OPTIONS, type ExportFormat, type ExportLanguage, type ExportStyle, type ExportScope, type ExportOptions } from "../lib/export-formats";
import { BpIcon, Dropdown, NumField, Seg } from "./controls";
import { userMessage } from "../lib/errors";
import { getLang, LANGS, setLang, tr, trNodes, type Lang } from "../lib/i18n";

function ExportModal({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedNodeId = useEditor((s) => s.selection);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_EXPORT_OPTIONS.framework);
  const [language, setLanguage] = useState<ExportLanguage>(DEFAULT_EXPORT_OPTIONS.language);
  const [style, setStyle] = useState<ExportStyle>(DEFAULT_EXPORT_OPTIONS.style);
  const [scope, setScope] = useState<ExportScope>(DEFAULT_EXPORT_OPTIONS.scope);
  const options: ExportOptions = {
    framework: format, language, style, scope,
    pageId: activePageId,
    nodeId: selectedNodeId ?? undefined,
  };
  const checks = useMemo<CheckResult[]>(() => {
    const compatibility = exportLimitations(doc, options);
    let scoped: typeof doc | null = null;
    try {
      scoped = exportScopeDoc(doc, options);
    } catch {
      // The scope error is already included in the compatibility list.
    }
    return [
      ...(scoped ? runChecks(scoped, { requireHomePage: scope === "project" }) : []),
      ...compatibility.map((message): CheckResult => ({ level: "error", message })),
    ];
  }, [doc, activePageId, selectedNodeId, format, language, style, scope]);
  const hasError = checks.some((check) => check.level === "error");
  useEscapeToClose(onClose, !busy);

  const description = format === "html"
    ? tr("Download a ZIP with ready-to-use HTML, CSS, JavaScript and images. Extract it and open index.html in your browser. No npm or build step is needed.")
    : format === "single-html"
      ? tr("Download one HTML file with embedded images, fonts, CSS and JavaScript. Multiple pages cannot be exported at the same time.")
      : trNodes("Export as a {framework} project. After extracting the files, run {cmd} to start.", {
          framework: tr(EXPORT_FRAMEWORK_OPTIONS.find((item) => item.value === format)?.label ?? "Next.js"),
          cmd: <span className="kbd">npm install && npm run dev</span>,
        });

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal export-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{tr("Export code")}</h2>
        <p className="modal-desc">{description}</p>

        <fieldset className="export-options" disabled={busy}>
          <div className="export-option">
            <div className="export-option-label">{tr("Framework")}</div>
            <Dropdown
              value={format}
              options={EXPORT_FRAMEWORK_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))}
              onChange={(value) => {
                setFormat(value as ExportFormat);
                if (value === "single-html" && scope === "project") setScope("page");
                if (value === "html" || value === "single-html") {
                  setLanguage("javascript");
                  setStyle("css");
                }
              }}
              style={{ width: "100%" }}
              title={tr("Framework")}
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
                style={{ width: "100%" }}
                title={tr("Language")}
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
                style={{ width: "100%" }}
                title={tr("Style")}
              />
            </div>
          </div>
          <div className="export-option">
            <div className="export-option-label">{tr("Export scope")}</div>
            <Dropdown
              value={scope}
              options={[
                { value: "component", label: tr("Selected component") },
                { value: "page", label: tr("Current page") },
                ...(format === "single-html" ? [] : [{ value: "project", label: tr("Entire project") }]),
              ]}
              onChange={(value) => setScope(value as ExportScope)}
              style={{ width: "100%" }}
              title={tr("Export scope")}
            />
          </div>
        </fieldset>
        {style === "tailwind" && (
          <p className="hint export-note">
            {tr("Tailwind utilities are available. Tsumu-generated CSS remains included to preserve your design.")}
          </p>
        )}
        {scope === "component" && (
          <p className="hint export-note">
            {tr("Exports the selected element and its descendants as a standalone page.")}
          </p>
        )}
        {(format === "html" || format === "single-html") && (
          <p className="hint export-note">
            {tr("The HTML format provides ready-to-open files, so language is JavaScript and styling is CSS.")}
          </p>
        )}
        {(format === "html" || format === "single-html") && (
          <p className="hint export-note">
            {tr("Fetching external data requires the API to allow CORS. file:// has restrictions, so test on localhost or a similar environment.")}
          </p>
        )}
        {format === "single-html" && (
          <p className="hint export-note">
            {tr("External APIs and embedded videos still require an internet connection. If external images cannot be embedded, import them into the asset library and retry.")}
          </p>
        )}
        {format !== "single-html" && (
          <p className="hint export-note">
            {scope === "project"
              ? tr("The ZIP contains the site’s complete editable source (_tsumu/doc.json). Publish only the generated website files, not its editable data, to a public host.")
              : tr("The ZIP contains the editable source for the exported scope (_tsumu/doc.json). Publish only the generated website files, not its editable data, to a public host.")}
          </p>
        )}
        <CheckList checks={checks} onClose={onClose} />

        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={hasError || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const missing = await exportProjectZip(await docWithSvgFilters(), options);
                onClose();
                if (missing.length) {
                  void showAlert(
                    tr("These images weren't found in storage, so they were left out of the zip (they may have been deleted).\n{p1}", { p1: missing.join("\n") }),
                    { title: tr("Downloaded without some images") }
                  );
                }
              } catch (error) {
                const title = format === "single-html" ? tr("Could not generate the HTML file") : tr("Couldn't create the zip");
                void showAlert(userMessage(error, title), { title });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={13} />
            {busy ? tr("Generating…") : format === "single-html" ? tr("Download HTML") : tr("Download zip")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 設定（表示言語・サイトのリセット） ---------- */

/** エディタの設定（ログインできるアカウントなど全サイト共通の設定は、ホームの設定にある） */
function SettingsModal({ onClose }: { onClose: () => void }) {
  const confirmReset = useDocumentConfirmation("document-reset");
  const resetDoc = useEditor((s) => s.resetDoc);
  useEscapeToClose(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("Settings")}</h2>

        <section className="settings-sec">
          <h3>{tr("Language", "language_variant_1")}</h3>
          <Seg
            value={getLang()}
            options={LANGS}
            onChange={(v) => {
              if (v !== getLang()) setLang(v as Lang);
            }}
          />
          <p className="hint">{tr("The editor reloads when you switch. Your site's content isn't changed.")}</p>
        </section>

        <section className="settings-sec">
          <h3>{tr("Reset site")}</h3>
          <button
            className="btn"
            onClick={async () => {
              // 誤操作を防ぐため、確認の文を入力したときだけ実行できる
              const accepted = await confirmReset(async () => (await showPrompt(
                tr("This resets the entire site to its initial state (you can undo it).\nType \"Reset\" to continue."),
                { title: tr("Reset the site?"), expect: tr("Reset"), okLabel: tr("Reset"), danger: true }
              )) === tr("Reset"));
              if (!accepted) return;
              resetDoc();
              onClose();
            }}
          >
            <RotateCcw size={13} />
            {tr("Reset")}
          </button>
          <p className="hint">{tr("Removes all pages, elements and settings and returns the site to how it was when created. The published site isn't affected.")}</p>
        </section>

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>
            {tr("Close")}
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
        <h2>{tr("Sign out?")}</h2>
        <p className="modal-desc">
          {tr("You'll need to sign in with Google again to continue.")}
        </p>
        {unsaved && (
          <ul className="check-list">
            <li className="is-error">
              <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
              {cloudState === "saving"
                ? tr("Saving to the server. It's safest to sign out after saving finishes.")
                : tr("Some changes haven't been saved to the server. They're kept in this browser but won't appear on other devices.")}
            </li>
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy} autoFocus>
            {tr("Cancel")}
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
            {tr("Sign out")}
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
  const openComments = useComments((s) => s.unresolvedCount);
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
        <a className="icon-btn" href="/" aria-label={tr("Sites")} data-tip={tr("Back to sites")}>
          <LayoutGrid size={16} />
        </a>
        {mode === "design" && (
          <button
            className={`icon-btn${panels.l ? "" : " is-off"}`}
            onClick={() => onTogglePanel("l")}
            aria-label={panels.l ? tr("Close left panel") : tr("Open left panel")}
            aria-pressed={panels.l}
            data-tip={panels.l ? tr("Close left panel") : tr("Open left panel")}
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
                      label: tr("Loading screen"),
                      desc: tr("Site-wide"),
                      icon: <LoaderCircle size={13} />,
                    },
                  ]
                : []),
              ...doc.pageOrder.map((id) => ({
                value: id,
                label: doc.pages[id].unpublished
                  ? tr("{name} (unpublished)", { name: doc.pages[id].name })
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
          aria-label={tr("Undo")}
          data-tip={tr("Undo")} data-tip-kbd="⌘Z"
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-btn"
          disabled={!future.length}
          onClick={redo}
          aria-label={tr("Redo")}
          data-tip={tr("Redo")} data-tip-kbd="⇧⌘Z"
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
                    : tr("Applies at {max}px and below", { max: BP_INFO[bp].maxWidth ?? 0 }),
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
                data-tip={tr("View as {label} ({width}px) — {scope}", { label: BP_INFO[bp].label, width: BP_INFO[bp].width, scope: BP_INFO[bp].scope })}
                aria-label={tr("View as {label}", { label: BP_INFO[bp].label })}
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
              title={tr("Set screen width (you can also drag the canvas edges)")}
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
              title={tr("Check common device widths")}
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
        <div className="hdr-zoom" data-tutorial="zoom" data-tip={tr("You can also zoom with ⌘ + scroll")}>
          <Dropdown
            value={String(zoom)}
            options={[
              { value: "0", label: tr("Fit"), icon: <ZoomIn size={13} /> },
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
            aria-label={tr("Design")}
          >
            <PenTool size={12} className="hdr-icon-narrow" />
            <span className="hdr-label">{tr("Design")}</span>
          </button>
          <button
            className={mode === "preview" ? "is-on" : ""}
            onClick={() => setMode("preview")}
            aria-label={tr("Preview")}
            data-tip={tr("Try out buttons and links")}
          >
            <Play size={12} />
            <span className="hdr-label">{tr("Preview")}</span>
          </button>
        </div>
        {aiEnabled && (
          <button
            className={`icon-btn hdr-ai${aiOpen ? " is-on" : ""}`}
            data-tutorial="ai"
            data-tip={tr("Ask AI to edit")}
            aria-label={tr("Ask AI")}
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
          data-tip={tr("Comments")}
          data-tip-kbd="C"
          aria-label={tr("Comments")}
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
          data-tip={tr("Help", "help_variant_1")}
          data-tip-kbd="?"
          aria-label={tr("Help")}
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
            title={tr("Menu (export, history, settings)")}
            menuWidth={230}
            options={[
              { value: "history", label: tr("History & rollback"), icon: <History size={13} /> },
              { value: "export", label: tr("Export as zip"), icon: <Download size={13} /> },
              { value: "settings", label: tr("Settings"), icon: <Settings size={13} /> },
              // Google認証を使っていない（ログインなしで開ける）ときはログアウトを出さない
              ...(status?.auth === false
                ? []
                : [{ value: "logout", label: tr("Sign out"), icon: <LogOut size={13} /> }]),
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
          {tr("Publish")}
        </button>
        {mode === "design" && (
          <button
            className={`icon-btn${panels.r ? "" : " is-off"}`}
            onClick={() => onTogglePanel("r")}
            aria-label={panels.r ? tr("Close right panel") : tr("Open right panel")}
            aria-pressed={panels.r}
            data-tip={panels.r ? tr("Close right panel") : tr("Open right panel")}
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
