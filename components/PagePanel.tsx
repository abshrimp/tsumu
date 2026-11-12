"use client";

import { isEnterKey } from "../lib/keys";
import { useLayoutEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { applyHtmlZipPage, readHtmlZip } from "../lib/html-zip";
import { convertHtmlFile } from "../lib/html-file-import";
import { normalizeBreakpoints } from "../lib/style";
import { useEditor } from "../lib/store";
import { usePendingImport } from "../lib/use-pending-import";
import { showConfirm } from "../lib/dialog";
import ImagePicker from "./ImagePicker";
import SiteLanguageSelect from "./SiteLanguageSelect";
import { LoadingScreenSettings } from "./SitePanel";
import { CommitInput, CommitTextarea, FillControl, Grp, InfoTip, Section, Seg } from "./controls";
import { ScriptSummary } from "./ScriptEditor";
import { pageNodeIds, pageScriptsOf } from "../lib/script";
import { PAGE_TARGET } from "../lib/types";
import { userMessage } from "../lib/errors";
import { tr } from "../lib/i18n";
import { isSiteLang, SITE_LANGS, siteLangOf } from "../lib/site-lang";

const htmlImportScope = (state: ReturnType<typeof useEditor.getState>) => {
  const target = state.doc.pages[state.activePageId];
  return JSON.stringify([state.activePageId, target?.rawHtml, target?.htmlZip, target?.redirectTo, target?.rewriteTo, target?.children]);
};

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

/** 要素が未選択のときに右パネルへ表示するページ設定 */
export default function PagePanel() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const updatePage = useEditor((s) => s.updatePage);
  const updateDoc = useEditor((s) => s.updateDoc);
  const htmlFileRef = useRef<HTMLInputElement>(null);
  const htmlZipRef = useRef<HTMLInputElement>(null);
  const normalHtmlRef = useRef<HTMLInputElement>(null);
  const normalZipRef = useRef<HTMLInputElement>(null);
  const [normalImportMessage, setNormalImportMessage] = useState<string | null>(null);
  const [zipMessage, setZipMessage] = useState<string | null>(null);
  const openScriptEditor = useEditor((s) => s.openScriptEditor);

  const page = doc.pages[activePageId];
  const scope = htmlImportScope(useEditor.getState());
  const pending = usePendingImport(scope);
  const gestureWaiters = useRef(new Set<() => void>());
  const wakeImports = () => { for (const wake of gestureWaiters.current) wake(); };
  useLayoutEffect(() => {
    const unsubscribe = useEditor.subscribe(wakeImports);
    return () => { unsubscribe(); wakeImports(); };
  }, []);
  const [importKind, setImportKind] = useState<"html" | "zip">("html");
  const zipBusy = pending.busy && importKind === "zip";
  const historyRevision = useEditor((s) => s.historyRevision);
  const kindRevision = useRef(0);
  // 確認中に対象・履歴・パネルが変わったら、以前の切り替えを反映しない。
  useLayoutEffect(() => () => { kindRevision.current++; }, [scope, historyRevision]);
  useLayoutEffect(() => { setZipMessage(null); setNormalImportMessage(null); }, [activePageId, historyRevision]);
  useLayoutEffect(wakeImports, [scope, historyRevision, pending.busy]);
  const waitForGesture = async (request: { current: () => boolean }) => {
    // 色などの連続編集を確定するまで待ち、読み込みを別のUndoにする。
    while (request.current() && useEditor.getState().gestureActive) {
      await new Promise<void>((resolve) => {
        const wake = () => { gestureWaiters.current.delete(wake); resolve(); };
        gestureWaiters.current.add(wake);
      });
    }
  };
  // ストア変更直後（再描画前）にも、古いページやコードへ書き戻さない。
  const beginImport = (kind: "html" | "zip") => {
    setImportKind(kind);
    const request = pending.begin();
    const scope = htmlImportScope(useEditor.getState());
    return { ...request, current: () => request.current() && htmlImportScope(useEditor.getState()) === scope };
  };
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
        ? tr("This page")
        : script.nodeId
          ? doc.nodes[script.nodeId]?.name
          : tr("No element selected"),
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
        <Sec title={tr("Loading screen")}>
          <LoadingScreenSettings showEditButton={false} />
        </Sec>
      </div>
    );
  }

  const importHtmlZip = async (file: File) => {
    const request = beginImport("zip");
    setZipMessage(null);
    try {
      const existing = (page.htmlZip?.assetIds ?? [])
        .map(id => useEditor.getState().doc.assets[id])
        .filter((asset): asset is NonNullable<typeof asset> => !!asset);
      const { assets, source, zip, name } = await readHtmlZip(file, (message) => {
        if (request.current()) setZipMessage(message);
      }, undefined, existing, true);
      await waitForGesture(request);
      if (!request.current()) {
        // アップロード済みの一式は残すが、Undo/Redoや手動編集を上書きしない。
        useEditor.getState().retainUploadedAssets(assets);
        return;
      }
      updateDoc(draft => applyHtmlZipPage(draft, page.id, { assets, source, zip }));
      setZipMessage(
        tr("Loaded {name} and {length} assets", { name, length: assets.length })
      );
    } catch (error) {
      if (request.current()) setZipMessage(userMessage(error, tr("Couldn't load the zip")));
    } finally {
      request.finish();
    }
  };

  /** Convert one HTML document, keeping the page's URL and site settings. */
  const importAsEditablePage = async (file: File) => {
    const request = beginImport(file.name.toLowerCase().endsWith(".zip") ? "zip" : "html");
    setNormalImportMessage(null);
    try {
      const state = useEditor.getState();
      const converted = await convertHtmlFile(file, {
        breakpoints: state.doc.breakpoints,
        progress: (message) => {
          if (request.current()) setNormalImportMessage(message);
        },
      });
      const assets = Object.values(converted.doc.assets);
      const keepAssets = () => useEditor.getState().retainUploadedAssets(assets);
      await waitForGesture(request);
      if (!request.current()) { keepAssets(); return; }
      const currentPage = useEditor.getState().doc.pages[page.id];
      if (!currentPage) { keepAssets(); return; }
      if (currentPage.children.length && !(await showConfirm(
        tr("Replace the existing elements on this page with elements converted from HTML?"),
        { title: tr("Replace the page elements?"), okLabel: tr("Replace") },
      ))) { keepAssets(); return; }
      if (!request.current()) { keepAssets(); return; }
      updateDoc((draft) => {
        const target = draft.pages[page.id];
        if (!target) return;
        const importedPage = converted.doc.pages[converted.doc.pageOrder[0]];
        // Keep nodes referenced from other pages and component masters. Unreachable
        // nodes from the replaced page must not inflate future doc.json exports.
        const oldNodes = new Set<string>();
        const reachable = (id: string, found: Set<string>) => {
          if (found.has(id) || !draft.nodes[id]) return;
          found.add(id);
          draft.nodes[id].children.forEach((child) => reachable(child, found));
        };
        target.children.forEach((id) => reachable(id, oldNodes));
        const keep = new Set<string>();
        for (const page of Object.values(draft.pages)) {
          if (page.id !== target.id) page.children.forEach((id) => reachable(id, keep));
        }
        for (const comp of Object.values(draft.components || {})) reachable(comp.rootId, keep);
        for (const id of oldNodes) if (!keep.has(id)) delete draft.nodes[id];
        // Imported nodes use globally unique IDs, so no remaining nodes are overwritten.
        Object.assign(draft.nodes, converted.doc.nodes);
        Object.assign(draft.assets, converted.doc.assets);
        target.children = [...importedPage.children];
        target.bodyStyles = importedPage.bodyStyles;
        target.customTopHtml = importedPage.customTopHtml;
        target.customEndHtml = importedPage.customEndHtml;
        target.pageScripts = undefined;
        target.scripts = undefined;
        target.rawHtml = null;
        delete target.htmlZip;
        draft.breakpoints = normalizeBreakpoints(converted.doc.breakpoints);
      });
      setNormalImportMessage(converted.warnings.length
        ? tr("HTML converted into editable elements ({n} notices).", { n: converted.warnings.length }) +
          "\n" + converted.warnings.join("\n")
        : tr("HTML converted into editable elements."));
    } catch (error) {
      setNormalImportMessage(userMessage(error, tr("Could not convert HTML.")));
    } finally {
      request.finish();
    }
  };

  const setPageKind = async (kind: string) => {
    if (kind === pageKind) return;
    const request = ++kindRevision.current;
    pending.cancel();
    setZipMessage(null);
    if (kind === "html" || kind === "redirect") {
      if (
        page.children.length &&
        !(await showConfirm(
          tr("This page's elements will no longer be shown or editable (they're kept, so switching back restores them)."),
          {
            title: kind === "html" ? tr("Switch to an HTML page?") : tr("Switch to a redirect page?"),
            okLabel: tr("Toggle"),
          }
        ))
      ) {
        return;
      }
      const latest = useEditor.getState();
      if (
        request !== kindRevision.current ||
        latest.historyRevision !== historyRevision ||
        htmlImportScope(latest) !== scope
      ) return;
      updatePage(
        page.id,
        kind === "html"
          ? {
              rawHtml: page.rawHtml || "",
              ...(page.htmlZip ? { htmlZip: undefined } : {}),
              redirectTo: undefined,
              rewriteTo: undefined,
            }
          : {
              rawHtml: null,
              ...(page.htmlZip ? { htmlZip: undefined } : {}),
              ...(page.rewriteTo !== undefined
                ? { rewriteTo: page.rewriteTo, redirectTo: undefined }
                : { redirectTo: page.redirectTo ?? "", rewriteTo: undefined }),
            }
      );
    } else {
      updatePage(page.id, {
        rawHtml: null,
        ...(page.htmlZip ? { htmlZip: undefined } : {}),
        redirectTo: undefined,
        rewriteTo: undefined,
      });
    }
  };

  return (
    <div className="panel-body" data-tutorial="page-settings">
      {/* ---------- ページ設定 ---------- */}
      <Sec
        title={tr("Page settings — {name}", { name: page.name })}
        tutorialTarget="tutorial-page-section"
        help="page-url"
      >
        <label
          className="lbl"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <input
            id={`page-${page.id}-published`}
            type="checkbox"
            data-tutorial="tutorial-page-publish-checkbox"
            checked={!page.unpublished}
            onChange={(e) =>
              updatePage(page.id, { unpublished: !e.target.checked })
            }
          />
          {tr("Publish this page")}
          <InfoTip text={tr("Unpublished pages are left out of exports and publishing (they stay as drafts).")} />
        </label>
        <div className="row">
          <label htmlFor={`page-${page.id}-name`}>{tr("Name")}</label>
          <CommitInput
            key={`${page.id}-name`}
            id={`page-${page.id}-name`}
            className="input"
            data-tutorial="tutorial-page-name"
            value={page.name}
            onCommit={(v) => updatePage(page.id, { name: v.trim() || page.name })}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="row">
          <label className="lbl-info" htmlFor={`page-${page.id}-slug`}>
            URL
            <InfoTip
              text={tr("The page's address (e.g. blog becomes {p1}/blog).\nAdd a query like \"blog?tab=news\" to append it to links to this page; inside the page it's available as {tab}.\nInclude [slug], as in \"blog/[slug]\", to create a detail page for each data item.", { p1: doc.siteUrl ?? "" })}
            />
          </label>
          <input
            key={`${page.id}-slug-${page.slug}?${page.query ?? ""}`}
            id={`page-${page.id}-slug`}
            className="input"
            data-tutorial="tutorial-page-slug"
            defaultValue={page.query ? `${page.slug}?${page.query}` : page.slug}
            placeholder={tr("(Home page)")}
            onBlur={(e) => {
              const value = e.target.value.trim();
              const at = value.indexOf("?");
              const path = at < 0 ? value : value.slice(0, at);
              const query = at < 0 ? "" : value.slice(at + 1).split("#")[0].replace(/\s+/g, "");
              updatePage(page.id, {
                slug: path
                  .replace(/^\/+|\/+$/g, "")
                  .replace(/\/{2,}/g, "/")
                  .replace(/[^a-zA-Z0-9\-/_\[\]]/g, "-"),
                query: query || undefined,
              });
            }}
            onKeyDown={blurOnEnter}
          />
        </div>
        {pageKind === "normal" && !isLoadingPage && (
          <div className="row">
            <label className="lbl-info" htmlFor={`page-${page.id}-lang`}>
              {tr("Language")}
              <InfoTip text={tr("The language this page is written in. \"Same as site\" uses the language from the site settings.")} />
            </label>
            <SiteLanguageSelect
              id={`page-${page.id}-lang`}
              key={page.id}
              value={isSiteLang(page.lang) ? page.lang : ""}
              onChange={(lang) => updatePage(page.id, { lang: lang || undefined })}
              inheritLabel={tr("Same as site ({lang})", {
                lang: SITE_LANGS.find((l) => l.value === siteLangOf(doc))?.label ?? siteLangOf(doc),
              })}
            />
          </div>
        )}
        {isSlugPg && (
          <div className="note-chip">
            {tr("A detail page for each data item")}
            <InfoTip
              text={(() => {
                const base =
                  page.slug.replace("/[slug]", "").replace("[slug]", "") || "items";
                return tr("One design generates a page for each data item (e.g. /{base}/1, /{base}/2 …).\nIn this page's \"When the page opens\" script, fetch one item using {slug} in the URL, or find the item whose field matches {slug} in a list and store it in a variable.", { base });
              })()}
            />
          </div>
        )}

        {pageKind !== "redirect" && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="lbl lbl-info">
              {tr("Outer background color")}
              <InfoTip text={tr("The color shown when scrolling past the edge of the page. Uses the body background color if not set.")} />
            </span>
            <FillControl
              value={page.htmlBackground}
              onChange={(v) =>
                updatePage(page.id, { htmlBackground: v ?? undefined })
              }
              onChangeStart={() => useEditor.getState().beginGesture()}
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
          title={tr("Scripts")}
          defaultOpen={false}
          tutorialTarget="page-scripts"
          help="act-script"
          info={tr("Connect triggers like \"when a button is clicked\" to actions like opening a page or showing an element to make your page interactive.")}
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
            {tr("Edit scripts")}
          </button>
        </Sec>
      )}

      {/* ---------- 検索・シェア ---------- */}
      <Sec title={tr("Search & sharing (SEO)")} defaultOpen={false} tutorialTarget="page-seo" help="page-seo">
        <div className="row">
          <label htmlFor={`page-${page.id}-title`}>{tr("Title")}</label>
          <CommitInput
            key={`${page.id}-title`}
            id={`page-${page.id}-title`}
            className="input"
            value={page.title}
            placeholder={page.name}
            onCommit={(v) => updatePage(page.id, { title: v })}
            onKeyDown={blurOnEnter}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl" htmlFor={`page-${page.id}-description`}>{tr("Description")}</label>
          <CommitTextarea
            key={`${page.id}-desc`}
            id={`page-${page.id}-description`}
            className="textarea"
            value={page.description}
            placeholder={tr("A short summary shown in search results and when shared on social media.")}
            onCommit={(v) => updatePage(page.id, { description: v })}
          />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="lbl lbl-info">
            {tr("Share image (OGP)")}
            <InfoTip text={tr("The image shown when a link is shared on social media. Uses the site's default image if not set. 1200×630px is recommended.")} />
          </span>
          <ImagePicker
            editTarget={page.id}
            value={page.ogImage}
            onChange={(v) => updatePage(page.id, { ogImage: v })}
          />
        </div>
        <label
          className="lbl"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <input
            id={`page-${page.id}-noindex`}
            type="checkbox"
            checked={!!page.noindex}
            onChange={(e) => updatePage(page.id, { noindex: e.target.checked })}
          />
          {tr("Hide from search results (Google, etc.)")}
        </label>
      </Sec>

      {/* ---------- カスタムコード ---------- */}
      <Sec
        title={tr("Custom code")}
        defaultOpen={pageKind === "html"}
        tutorialTarget="page-code"
        help="page-code-snippet"
      >
        <Grp
          label={tr("Page type")}
          info={
            pageKind === "normal"
              ? tr("A standard page built from elements on the canvas. Choose \"HTML\" to write this page directly in code.")
              : undefined
          }
        >
        <Seg
          value={pageKind}
          options={[
            { label: tr("Standard"), value: "normal" },
            { label: "HTML", value: "html", title: tr("Serve hand-written code") },
            {
              label: tr("Redirect"),
              value: "redirect",
              title: tr("301 redirect to another URL"),
            },
          ]}
          onChange={setPageKind}
        />
        </Grp>

      {pageKind === "normal" && (
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button className="btn btn-sm" disabled={pending.busy}
              onClick={() => normalHtmlRef.current?.click()}>
              <FileUp size={12} />
              {tr("Convert HTML to editable elements")}
            </button>
            <button className="btn btn-sm" disabled={pending.busy}
              onClick={() => normalZipRef.current?.click()}>
              <FileUp size={12} />
              {tr("Convert HTML and assets from ZIP")}
            </button>
            <input id={`page-${page.id}-import-html`} aria-label={tr("Convert HTML to editable elements")} ref={normalHtmlRef} type="file"
              accept=".html,.htm,text/html" style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importAsEditablePage(file);
                e.target.value = "";
              }} />
            <input id={`page-${page.id}-import-zip`} aria-label={tr("Convert HTML and assets from ZIP")} ref={normalZipRef} type="file"
              accept=".zip,application/zip" style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importAsEditablePage(file);
                e.target.value = "";
              }} />
          </div>
          <p className="hint">{tr("Convert HTML into editable Tsumu elements on this page.")}</p>
          {normalImportMessage && (
            <p className="hint" role="status" style={{ whiteSpace: "pre-wrap" }}>{normalImportMessage}</p>
          )}
        </div>
      )}

      {pageKind === "redirect" && (
        <div className="stack" style={{ gap: 4 }}>
          <label className="lbl lbl-info" htmlFor={`page-${page.id}-redirect`}>
            {tr("301 redirect target")}
            <InfoTip text={tr("Permanently sends visitors of this page to the target. Redirect pages can't be edited on the canvas.")} />
          </label>
          <input
            key={`${page.id}-redirect-${page.redirectTo ?? "empty"}`}
            id={`page-${page.id}-redirect`}
            className="input"
            defaultValue={page.redirectTo ?? ""}
            placeholder={tr("/new-page or https://example.com/...")}
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
          <label className="lbl lbl-info" htmlFor={`page-${page.id}-rewrite`}>
            {tr("Show an external site (reverse proxy)")}
            <InfoTip text={tr("Shows the external site's content at this URL without changing the address bar. Under the home page (/), this site's pages and files take priority. Only unmatched paths are forwarded. If the destination URL contains ? or #, only paths matching this page's URL are forwarded. Can't be combined with a 301 redirect.")} />
          </label>
          <input
            key={`${page.id}-rewrite-${page.rewriteTo ?? "empty"}`}
            id={`page-${page.id}-rewrite`}
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
              {tr("Load HTML without converting")}
            </button>
            <button
              className="btn btn-sm"
              disabled={zipBusy}
              data-tip={tr("Loads index.html first. Bundled files are uploaded as assets and paths in the HTML are rewritten automatically")}
              onClick={() => htmlZipRef.current?.click()}
            >
              <FileUp size={12} />
              {zipBusy ? tr("Loading zip…") : tr("Load HTML and assets from ZIP without converting")}
            </button>
            <input
              ref={htmlFileRef}
              id={`page-${page.id}-raw-html-import`}
              aria-label={tr("Load HTML without converting")}
              type="file"
              accept=".html,.htm,text/html"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const request = beginImport("html");
                setZipMessage(null);
                const reader = new FileReader();
                reader.onload = async () => {
                  await waitForGesture(request);
                  if (request.current()) {
                    const source = String(reader.result ?? "");
                    if (source.trim()) {
                      updatePage(page.id, { rawHtml: source, htmlZip: undefined });
                    } else {
                      setZipMessage(tr("The file is empty."));
                    }
                  }
                  request.finish();
                };
                reader.onerror = reader.onabort = () => request.finish();
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
            <input
              ref={htmlZipRef}
              id={`page-${page.id}-raw-zip-import`}
              aria-label={tr("Load HTML and assets from ZIP without converting")}
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
          <label className="lbl lbl-info" htmlFor={`page-${page.id}-rawhtml`}>
            {tr("HTML code")}
            <InfoTip text={tr("Serves the HTML, including scripts and CSS, as is (Next.js layouts and metadata don't apply to this page).")} />
          </label>
          <CommitTextarea
            key={`${page.id}-rawhtml`}
            id={`page-${page.id}-rawhtml`}
            className="textarea mono"
            rows={14}
            value={page.rawHtml ?? ""}
            placeholder={
              "<!DOCTYPE html>\n<html>\n  <head>…</head>\n  <body>…</body>\n</html>"
            }
            spellCheck={false}
            onChange={() => { pending.cancel(); setZipMessage(null); }}
            onCommit={(v) => { pending.cancel(); updatePage(page.id, { rawHtml: v }); }}
          />
        </>
      )}
      {pageKind === "normal" && (
        <>
          {/* ---- このページのみ ---- */}
          <div className="stack" style={{ gap: 4 }}>
            <label className="lbl lbl-info" htmlFor={`page-${page.id}-top`}>
              {tr("Head code (this page only)")}
              <InfoTip text={tr("Inserted at the start or end of this page's HTML. Use it for page-specific tracking tags, structured data (JSON-LD) and so on. Set the title and description under \"Search & sharing\".")} />
            </label>
            <CommitTextarea
              key={`${page.id}-top`}
              id={`page-${page.id}-top`}
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
            <label className="lbl lbl-info" htmlFor={`page-${page.id}-end`}>
              {tr("End code (this page only)")}
              <InfoTip text={tr("Inserted at the start or end of this page's HTML. Use it for page-specific tracking tags, structured data (JSON-LD) and so on. Set the title and description under \"Search & sharing\".")} />
            </label>
            <CommitTextarea
              key={`${page.id}-end`}
              id={`page-${page.id}-end`}
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
