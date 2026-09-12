"use client";

import { isEnterKey } from "../lib/keys";
import { useId, useRef, useState } from "react";
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
import { usePendingImport } from "../lib/use-pending-import";
import { showAlert, showConfirm } from "../lib/dialog";
import { assetSrc } from "../lib/assets";
import { serializePortableDoc } from "../lib/portable-doc";
import { parseSiteImport, IMPORT_LIMITS } from "../lib/site-import";
import { sanitizeImportedInlineIcons } from "../lib/imported-svg";
import { siteLangOf } from "../lib/site-lang";
import { genId, makeBox, makeText } from "../lib/presets";
import {
  DEFAULT_DATA_REVALIDATE,
  type DocNode,
  type Page,
  type PwaSetting,
} from "../lib/types";
import ImagePicker from "./ImagePicker";
import { CodeEditorButton, CustomCodeEditorModal } from "./CustomCodeEditor";
import SiteLanguageSelect from "./SiteLanguageSelect";
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
  const root = makeBox(tr("Loading screen"), {
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
  const text = makeText(tr("Loading…"), {
    color: "#18181b",
    textAlign: "center",
  });
  text.name = tr("Loading text");
  nodes.push(text);
  children.push(text.id);
  root.children = children;
  return {
    page: {
      id: genId("page"),
      name: tr("Loading screen"),
      slug: "__loading-screen",
      title: tr("Loading screen"),
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
  const inputBaseId = useId();
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
          id={`${inputBaseId}-enabled`}

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
        {tr("Show a loading screen")}
        <InfoTip text={tr("Design it on the canvas, just like a regular page.")} />
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
              {tr("Edit loading screen")}
            </button>
          )}
          <div className="grid2">
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor={`${inputBaseId}-min`}>{tr("Minimum display time (ms)")}</label>
              <input
                key={`loading-min-${setting.minDuration ?? 500}`}
                id={`${inputBaseId}-min`}
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
              <label className="lbl" htmlFor={`${inputBaseId}-fade`}>{tr("Fade (ms)")}</label>
              <input
                key={`loading-fade-${setting.fadeDuration ?? 300}`}
                id={`${inputBaseId}-fade`}
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
          id={`${inputBaseId}-once`}

              type="checkbox"
              checked={!!setting.showOnce}
              onChange={(e) =>
                updateDoc((d) => {
                  if (d.loadingScreen)
                    d.loadingScreen.showOnce = e.target.checked;
                })
              }
            />
            {tr("Show only once per tab")}
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
    label: tr("Standalone"),
    desc: tr("Opens like an app, without the address bar."),
    icon: AppWindow,
  },
  {
    value: "minimal-ui",
    label: tr("Minimal UI"),
    desc: tr("Opens with only minimal controls like back and reload."),
    icon: PanelTop,
  },
  {
    value: "fullscreen",
    label: tr("Full screen"),
    desc: tr("Hides the status bar too and fills the whole screen. Good for games and kiosks."),
    icon: Maximize,
  },
];

/** PWA（ホーム画面に追加してアプリのように使える）の公開設定 */
function PwaSettings() {
  const inputBaseId = useId();
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
          id={`${inputBaseId}-enabled`}

          type="checkbox"
          checked={!!pwa?.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        {tr("Publish as a PWA")}
        <InfoTip text={tr("When added to the home screen or installed as an app, the site opens like an app without the browser frame.")} />
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
              <label className="lbl" htmlFor={`${inputBaseId}-name`}>{tr("App name")}</label>
              <input
                key={`pwa-name-${pwa.name ?? ""}`}
                id={`${inputBaseId}-name`}
                className="input"
                defaultValue={pwa.name ?? ""}
                placeholder={doc.siteName}
                onBlur={(e) => set({ name: e.target.value.trim() || undefined })}
                onKeyDown={blurOnEnter}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl lbl-info" htmlFor={`${inputBaseId}-short`}>
                {tr("Short name")}
                <InfoTip text={tr("The name shown under the home screen icon. Keep it to about 12 characters.")} />
              </label>
              <input
                key={`pwa-short-${pwa.shortName ?? ""}`}
                id={`${inputBaseId}-short`}
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
            <span className="lbl lbl-info">
              {tr("Icon")}
              <InfoTip text={tr("A 512×512px square PNG is recommended. Falls back to the home screen icon, then the favicon.")} />
            </span>
            <ImagePicker value={pwa.icon} onChange={(v) => set({ icon: v })} />
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <span className="lbl">{tr("Display mode")}</span>
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
              <span className="lbl lbl-info">
                {tr("Theme color")}
                <InfoTip text={tr("The title bar and status bar color when opened as an app.")} />
              </span>
              <FillControl
                value={pwa.themeColor}
                onChange={(v) => set({ themeColor: v ?? undefined })}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lbl lbl-info">
                {tr("Background color")}
                <InfoTip text={tr("The screen color shown while the app starts. Also used around the icon.")} />
              </span>
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
  const pending = usePendingImport("breakpoint-settings");

  const remove = async (id: string, label: string) => {
    const request = pending.begin();
    const used = breakpointUsage(doc, id);
    if (
      used &&
      !(await showConfirm(
        tr("Styles and visibility settings for \"{label}\" on {used} elements will also be deleted (you can undo this).", { used, label }),
        { title: tr("Delete \"{label}\"?", { label }), okLabel: tr("Delete"), danger: true }
      ))
    ) {
      request.finish();
      return;
    }
    // A delayed confirmation must not remove newly edited styles or a replacement document.
    if (request.current() && useEditor.getState().doc === doc) updateDoc((d) => removeBreakpoint(d, id));
    request.finish();
  };
  const reset = async () => {
    const request = pending.begin();
    const added = addedBreakpoints(doc);
    const used = added.reduce((n, b) => n + breakpointUsage(doc, b.id), 0);
    if (
      used &&
      !(await showConfirm(
        tr("Styles for the added {names} ({used} elements) will be deleted.", {
          names: added.map((b) => tr("\"{name}\"", { name: tr(b.label) })).join(tr(", ")),
          used,
        }),
        { title: tr("Reset breakpoints to the defaults?"), okLabel: tr("Reset to defaults"), danger: true }
      ))
    ) {
      request.finish();
      return;
    }
    if (request.current() && useEditor.getState().doc === doc) updateDoc((d) => resetBreakpoints(d));
    request.finish();
  };

  return (
    <div data-section="breakpoints">
      <Sec
        title={tr("Breakpoints")}
        tutorialTarget="site-breakpoints"
        help="resp-breakpoints"
        info={
          tr("Breakpoints let you change styles by screen width. Each one applies to screens at or below its width (smaller ones take priority).\n\"Desktop\" is the width shown on the canvas. You can rename, add and remove breakpoints.")
        }
      >
        <div className="bp-edit">
          <div className="bp-edit-row">
            <span className="bp-edit-name">
              <BpIcon bp="base" />
              <span className="bp-edit-fixed">{tr("Desktop")}</span>
            </span>
            <div className="bp-edit-field" data-tip={tr("Width shown on the canvas")}>
              <NumField
                pre={tr("Width")}
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
                  id={`site-breakpoint-${b.id}`}
                  className="bp-edit-label"
                  defaultValue={tr(b.label)}
                  aria-label={tr("Breakpoint name")}
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
              <div className="bp-edit-field" data-tip={tr("Applies to screens up to {maxWidth}px wide", { maxWidth: b.maxWidth })}>
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
                aria-label={tr("Delete {label}", { label: tr(b.label) })}
                data-tip={tr("Delete {label}", { label: tr(b.label) })}
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
            data-tip={list.length >= MAX_BREAKPOINTS ? tr("You can add up to {MAX_BREAKPOINTS}", { MAX_BREAKPOINTS }) : undefined}
            onClick={() => updateDoc((d) => void addBreakpoint(d))}
          >
            <Plus size={12} />
            {tr("Add")}
          </button>
          {!isDefaultBreakpoints(doc) && (
            <button className="btn btn-sm" onClick={reset}>
              <RotateCcw size={12} />
              {tr("Reset to defaults")}
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
  const pendingBackup = usePendingImport("site-backup");
  const [codeEditorOpen, setCodeEditorOpen] = useState<"head" | "body" | null>(null);

  const exportDocJson = async () => {
    let serialized: string;
    try {
      serialized = await serializePortableDoc(doc, IMPORT_LIMITS.docBytes);
    } catch {
      void showAlert(tr("Could not create the backup file."));
      return;
    }
    const blob = new Blob([serialized], {
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

  const importDocJson = async (file: File) => {
    const request = pendingBackup.begin();
    let parsed;
    try {
      if (file.size > IMPORT_LIMITS.docBytes) throw new RangeError();
      parsed = (await parseSiteImport(new Uint8Array(await file.arrayBuffer()), "doc")).doc;
    } catch {
      if (!request.current()) return;
      request.finish();
      void showAlert(tr("Make sure it's a backup file saved from this editor."), {
        title: tr("Couldn't load this file"),
      });
      return;
    }
    if (!request.current()) return;
    if (await showConfirm(
      tr("Your current edits will be replaced with this file's content. Undo (⌘Z) brings back what you have now."),
      { title: tr("Load the backup?"), okLabel: tr("Load") },
    ) && request.current()) restoreDoc(sanitizeImportedInlineIcons(parsed));
    request.finish();
  };

  return (
    <div className="panel-body" data-tutorial="site-settings">
      <Sec title={tr("Site settings")} tutorialTarget="site-basics" help="pub-site">
        <div className="row">
          <label className="lbl-info" htmlFor={`site-name`}>
            {tr("Site name")}
            <InfoTip text={tr("Browser tabs show \"Page name | Site name\".")} />
          </label>
          <input
            key={doc.siteName}
            id="site-name"
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
          <label className="lbl-info" htmlFor={`site-url`}>
            {tr("Site URL")}
            <InfoTip text={tr("Your published site's address (e.g. https://example.com). Used for things like share image URLs.")} />
          </label>
          <input
            key={doc.siteUrl ?? "_"}
            id="site-url"
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
          <label className="lbl-info" htmlFor={`site-language`}>
            {tr("Language")}
            <InfoTip text={tr("The language your pages are written in. Screen readers, browser translation and search engines treat the text as this language.")} />
          </label>
          <SiteLanguageSelect
            id="site-language"
            value={siteLangOf(doc)}
            onChange={(lang) => updateDoc((d) => void (d.lang = lang))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="lbl lbl-info">
            {tr("Favicon (tab icon)")}
            <InfoTip text={tr("A square PNG, SVG or ICO is recommended.")} />
          </span>
          <ImagePicker
            value={doc.favicon}
            onChange={(v) => updateDoc((d) => void (d.favicon = v))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="lbl lbl-info">
            {tr("Home screen icon")}
            <InfoTip text={tr("The icon used when added to the home screen on iPhone or iPad (apple-touch-icon). A 180×180px PNG is recommended.")} />
          </span>
          <ImagePicker
            value={doc.appleTouchIcon}
            onChange={(v) => updateDoc((d) => void (d.appleTouchIcon = v))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="lbl lbl-info">
            {tr("Default share image (OGP)")}
            <InfoTip text={tr("Used when a page doesn't set its own. 1200×630px is recommended.")} />
          </span>
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
        title={tr("Hosting & data refresh")}
        defaultOpen={false}
        tutorialTarget="site-hosting"
        help="pub-hosting"
        info={tr("The service that runs the exported site, and how often pages that use external JSON fetch it again.")}
      >
        <div className="stack" style={{ gap: 4 }}>
          <span className="lbl lbl-info">
            {tr("Hosting")}
            <InfoTip text={tr("The service that runs the exported site. It changes how pages that use external JSON are built.\nStandard: Vercel, Netlify, Node.js, etc. Pages are prebuilt and rebuilt at the refresh interval (ISR).\nCloudflare Workers: pages are rendered on every request, and fetched JSON is cached at Cloudflare for the refresh interval.")} />
          </span>
          <Seg
            value={doc.hosting ?? "standard"}
            options={[
              { value: "standard", label: tr("Standard (Vercel etc.)") },
              { value: "cloudflare", label: "Cloudflare", title: "Cloudflare Workers" },
            ]}
            onChange={(v) =>
              updateDoc((d) => void (d.hosting = v === "cloudflare" ? "cloudflare" : undefined))
            }
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info" htmlFor={`site-data-revalidate`}>
            {tr("Data refresh interval (seconds)")}
            <InfoTip text={tr("How often pages that use external JSON fetch it again. In between, the prebuilt page (on Cloudflare, the fetched JSON) is reused to keep server load down. Set 0 to fetch on every request (always fresh, but heavier).")} />
          </label>
          <input
            key={doc.dataRevalidate ?? "_"}
            id="site-data-revalidate"
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
        title={tr("Custom code (all pages)")}
        defaultOpen={false}
        tutorialTarget="site-code"
        help="page-code-snippet"
      >
        <div className="stack" style={{ gap: 4 }}>
          <div className="code-field-heading">
            <label className="lbl lbl-info" htmlFor="site-head-code">
              {tr("Head code")}
              <InfoTip text={tr("Inserted into <head> on every page.")} />
            </label>
            <CodeEditorButton label={tr("Head code")} onClick={() => setCodeEditorOpen("head")} />
          </div>
          <CommitTextarea
            id="site-head-code"
            className="textarea mono"
            rows={5}
            value={doc.customHeadHtml ?? ""}
            placeholder={'<meta name="..." content="...">\n<script>...</script>'}
            spellCheck={false}
            onCommit={(v) => updateDoc((d) => void (d.customHeadHtml = v.trim() || undefined))}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <div className="code-field-heading">
            <label className="lbl lbl-info" htmlFor="site-body-code">
              {tr("End of body code")}
              <InfoTip text={tr("Inserted just before </body> on every page.")} />
            </label>
            <CodeEditorButton label={tr("End of body code")} onClick={() => setCodeEditorOpen("body")} />
          </div>
          <CommitTextarea
            id="site-body-code"
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
        title={tr("Backup")}
        tutorialTarget="site-backup"
        help="pub-backup"
        info={tr("Save or restore the whole site's data as a backup file. You can also load the _tsumu/doc.json saved to the repository when publishing.")}
        defaultOpen={false}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            data-tip={tr("Restore from the server's automatic backups or from a published version")}
            onClick={() => window.dispatchEvent(new CustomEvent("tsumu-open-history", { detail: "doc" }))}
          >
            <History size={12} />
            {tr("Restore from history")}
          </button>
          <button className="btn btn-sm" onClick={exportDocJson}>
            <FileDown size={12} />
            {tr("Export")}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => docFileRef.current?.click()}
          >
            <FileUp size={12} />
            {tr("Load")}
          </button>
          <input
            ref={docFileRef}
            id="site-backup-import"
            aria-label={tr("Load")}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importDocJson(file);
              e.target.value = "";
            }}
          />
        </div>
      </Sec>
      {codeEditorOpen && (
        <CustomCodeEditorModal
          key={codeEditorOpen}
          title={codeEditorOpen === "head" ? tr("Head code") : tr("End of body code")}
          value={codeEditorOpen === "head" ? doc.customHeadHtml ?? "" : doc.customBodyEndHtml ?? ""}
          placeholder={codeEditorOpen === "head" ? '<meta name="description" content="...">' : "<script>...</script>"}
          onApply={(value) => updateDoc((d) => {
            if (codeEditorOpen === "head") d.customHeadHtml = value.trim() || undefined;
            else d.customBodyEndHtml = value.trim() || undefined;
          })}
          onClose={() => setCodeEditorOpen(null)}
        />
      )}
    </div>
  );
}
