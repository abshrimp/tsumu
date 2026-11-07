import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { assetSrc, removePageAssetBackgrounds } from "../lib/assets";
import { type Asset, type NodeStyles, type SiteDoc, type Page, type Script } from "../lib/types";
import { createInitialDoc, makeBox, makeText } from "../lib/presets";
import { validSiteDoc } from "../lib/doc-tree";
import { getProp, clearedValue, resolveStyles, resolveThemeStyleMap, applyBreakpoints } from "../lib/style";
import { buildCanvasCss, previewHtmlWithBodyStyles } from "../components/canvas/css";
import { generateSiteCss, rawHtmlWithBodyStyles } from "../lib/generator/css";
import { buildClassNames } from "../lib/generator/names";
import { canvasMoveDoc } from "./helpers/canvas-move";
import { mergeDocs } from "../lib/merge";
import { useEditor, type EditorMode } from "../lib/store";
import { pageFolderFixture } from "./helpers/page-folder-merge";
import { createRequire } from "node:module";
import { transformSync } from "./helpers/bundle";
import * as React from "react";
import { generateProject } from "../lib/generator";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";
import { deferRunnableScripts } from "../lib/generator/defer-scripts";
import { elements, importCallbacks } from "./helpers/pending-import";
import { pageKindFixture } from "./helpers/page-kind-confirmation";
import { pagePanelItems, placePageFolder, retainPageFolderSlots } from "../lib/page-panel-order";
import { walkSteps } from "../lib/script";
import { applyPagePayload, buildPagePayload, copyPagesToSite } from "../lib/page-transfer";
import { queryCopyFixture, renderQueryCopyExport } from "./helpers/page-copy-query";
import { previewNavigationFixture, previewQueryDoc, publishedQueryPage } from "./helpers/preview-query-navigation";
import { readFileSync } from "node:fs";
import { resolve as resolve_2, dirname, posix } from "node:path";
import { runInNewContext } from "node:vm";
import { makeSample, previewDataVars } from "../lib/data";
import { previewRefreshDoc, previewRows } from "./helpers/preview-refresh";
import { renderToStaticMarkup } from "react-dom/server";
import { runChecks } from "../lib/generator/checks";
import { pageHrefOf, pageQueryVars } from "../lib/vars";
import { QUERY_VARIANT_RUNTIME } from "../lib/generator/query-route";

describe("page-asset-backgrounds", () => {
const asset: Asset = { id: "a", name: "background.png", path: "assets/background.png", width: 10, height: 10 };
const src = assetSrc(asset);
const image = `url("${src}")`;

function docWith(...styles: (NodeStyles | undefined)[]): SiteDoc {
  return {
    siteName: "Test",
    pages: Object.fromEntries(styles.map((bodyStyles, i) => [String(i), {
      id: String(i), name: "Page", slug: String(i), title: "", description: "", children: [], bodyStyles,
    }])),
    pageOrder: styles.map((_, i) => String(i)),
    nodes: {},
    assets: { [asset.id]: { ...asset } },
  };
}

test("asset removal clears exact page backgrounds across pages and breakpoints", () => {
  const doc = docWith(
    { base: { default: { backgroundImage: image, color: "red" } }, mobile: { default: { backgroundImage: image } } },
    { base: { default: { backgroundImage: image } } },
    undefined,
  );
  removePageAssetBackgrounds(doc, asset);
  assert.deepEqual(doc.pages["0"].bodyStyles, { base: { default: { color: "red" } }, mobile: { default: {} } });
  assert.deepEqual(doc.pages["1"].bodyStyles, { base: { default: {} } });
  assert.equal(doc.pages["2"].bodyStyles, undefined);
  assert.deepEqual(doc.assets, { a: asset });
});

test("asset removal preserves other URLs, authored backgrounds and other properties", () => {
  const values = [
    `url("${src}.backup")`, `url("${src}&version=2")`, `url("${src}#fragment")`,
    `url('${src}')`, `url(${src})`, `linear-gradient(red, blue), ${image}`,
    'url("/other.png")', "none",
  ];
  const doc = docWith(...values.map((backgroundImage) => ({
    base: { default: { backgroundImage, content: image } },
  })));
  const before = JSON.stringify(doc);
  removePageAssetBackgrounds(doc, asset);
  assert.equal(JSON.stringify(doc), before);
});

test("asset removal leaves empty sources and sparse page styles alone", () => {
  const doc = docWith({ base: { default: { backgroundImage: 'url("")' }, hover: undefined } });
  const before = JSON.stringify(doc);
  removePageAssetBackgrounds(doc, { ...asset, path: undefined });
  assert.equal(JSON.stringify(doc), before);
  removePageAssetBackgrounds(doc, asset);
  assert.equal(JSON.stringify(doc), before);
});

test("asset removal does not rewrite authored HTML or CSS", () => {
  const doc = docWith({ base: { default: { backgroundImage: image } } });
  doc.pages["0"].rawHtml = `<style>body { background-image: ${image} }</style>`;
  const html = doc.pages["0"].rawHtml;
  removePageAssetBackgrounds(doc, asset);
  assert.equal(doc.pages["0"].rawHtml, html);
});
});

describe("page-dark-theme", () => {
test("light styles remain the fallback until a dark value is explicitly edited", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  const node = doc.nodes.a;
  node.styles = {
    base: { default: { color: "#111111", backgroundColor: "#ffffff" }, hover: { color: "#222222" } },
    sm: { default: { fontSize: "13px" } },
  };
  assert.equal(resolveStyles(node, "base", "default", "dark").color, "#111111");
  node.darkStyles = {
    base: { default: { color: "#eeeeee" }, hover: { color: "#cccccc" } },
    sm: { default: { backgroundColor: "#202020" } },
  };
  assert.deepEqual(resolveStyles(node, "base", "default", "light"), {
    color: "#111111", backgroundColor: "#ffffff",
  });
  assert.deepEqual(resolveStyles(node, "base", "default", "dark"), {
    backgroundColor: "#ffffff", color: "#eeeeee",
  });
  assert.equal(resolveStyles(node, "sm", "default", "dark").backgroundColor, "#202020");
  assert.equal(resolveStyles(node, "sm", "default", "dark").fontSize, "13px");
  assert.equal(resolveStyles(node, "sm", "hover", "light").color, "#222222");
  assert.equal(resolveStyles(node, "sm", "hover", "dark").color, "#cccccc");
  assert.equal(getProp(node, "base", "default", "color", undefined, "light").setHere, true);
  assert.equal(getProp(node, "base", "default", "color", undefined, "dark").setHere, true);
  assert.equal(getProp(node, "sm", "default", "fontSize", undefined, "dark").setHere, false);
  assert.equal(clearedValue(node, "sm", "default", "backgroundColor", "dark"), null);
});

test("dark page style preview remains separate from the light canvas and HTML page", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  const page = doc.pages.p;
  doc.nodes.a.styles = { base: { default: { color: "#111111" } } };
  doc.nodes.a.darkStyles = { base: { default: { color: "#eeeeee" } } };
  page.bodyStyles = { base: { default: { backgroundColor: "white" } } };
  page.bodyDarkStyles = { base: { default: { backgroundColor: "#101010" } } };
  const view = (theme: "light" | "dark") => buildCanvasCss(
    doc, ["a"], "base", "preview", null, "default", page.bodyStyles, undefined, theme, page.bodyDarkStyles
  );
  assert.match(view("light"), /color: #111111;/);
  assert.doesNotMatch(view("light"), /#eeeeee|#101010/);
  assert.match(view("dark"), /color: #eeeeee;/);
  assert.match(view("dark"), /background-color: #101010;/);
  const html = "<html><head></head><body><p>Hello</p></body></html>";
  const lightHtml = previewHtmlWithBodyStyles(html, page.bodyStyles, "base", "light", page.bodyDarkStyles);
  const darkHtml = previewHtmlWithBodyStyles(html, page.bodyStyles, "base", "dark", page.bodyDarkStyles);
  assert.match(lightHtml, /background-color: white;/);
  assert.doesNotMatch(lightHtml, /#101010/);
  assert.match(darkHtml, /background-color: #101010;/);
  assert.match(darkHtml, /color-scheme: dark/);
});

test("published CSS uses the OS dark-mode preference and preserves responsive overrides", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  doc.nodes.a.styles = { base: { default: { color: "#111111" } } };
  doc.nodes.a.darkStyles = {
    base: { default: { color: "#eeeeee" }, hover: { color: "#dddddd" } },
    sm: { default: { color: "#bbbbbb" } },
  };
  doc.pages.p.bodyDarkStyles = { base: { default: { backgroundColor: "#101010" } } };
  const css = generateSiteCss(doc, buildClassNames(doc), new Map());
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /background-color: #101010;/);
  assert.match(css, /color: #eeeeee;/);
  assert.match(css, /:hover \{\n[^}]*color: #dddddd;/);
  assert.match(css, /@media \(max-width: 478px\)/);
  assert.match(css, /color: #bbbbbb;/);
  const rawHtml = rawHtmlWithBodyStyles(doc, doc.pages.p,
    "<html><head></head><body>Page</body></html>", new Map(), "production");
  assert.match(rawHtml, /prefers-color-scheme: dark/);
  assert.match(rawHtml, /background-color: #101010;/);
});

test("documents accept valid dark styles and reject malformed dark style maps", () => {
  const doc = createInitialDoc();
  const node = Object.values(doc.nodes)[0]!;
  const page = doc.pages[doc.pageOrder[0]];
  node.darkStyles = { base: { default: { color: "#ffffff" } } };
  page.bodyDarkStyles = { base: { default: { backgroundColor: "#181818" } } };
  assert.equal(validSiteDoc(doc), true);
  const invalidNode = structuredClone(doc);
  (Object.values(invalidNode.nodes)[0]!.darkStyles as unknown as Record<string, unknown>).base =
    { default: { color: 5 } };
  assert.equal(validSiteDoc(invalidNode), false);
  const invalidBody = structuredClone(doc);
  (invalidBody.pages[invalidBody.pageOrder[0]].bodyDarkStyles as unknown as Record<string, unknown>).base =
    { default: { backgroundColor: null } };
  assert.equal(validSiteDoc(invalidBody), false);
});


test("dark-only absolute positioning gives the parent the same containing block in export", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  doc.nodes.a.children = ["b"];
  doc.pages.p.children = ["a", "c"];
  doc.nodes.a.styles = {};
  doc.nodes.b.styles = {};
  doc.nodes.b.darkStyles = { base: { default: { position: "absolute" } } };
  const classNames = buildClassNames(doc);
  const lightCss = generateSiteCss(canvasMoveDoc(), buildClassNames(canvasMoveDoc()), new Map());
  assert.doesNotMatch(lightCss, /prefers-color-scheme: dark/);
  const css = generateSiteCss(doc, classNames, new Map());
  const darkSection = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(darkSection, new RegExp("\\." + classNames.get("a") + " \\{[^}]*position: relative;"));
});

test("legacy light-only documents do not emit dark media styles", () => {
  applyBreakpoints({});
  const doc = canvasMoveDoc();
  const css = generateSiteCss(doc, buildClassNames(doc), new Map());
  assert.doesNotMatch(css, /prefers-color-scheme: dark/);
  assert.deepEqual(resolveThemeStyleMap(undefined, undefined, "base", "default", "dark"), {});
});
});

describe("page-folder-merge", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const names = (doc: SiteDoc) => Object.fromEntries((doc.pageFolders ?? []).map((folder) => [folder.id, folder.name]));
const order = (doc: SiteDoc) => doc.pageFolders?.map((folder) => folder.id) ?? [];
function edit(base: SiteDoc, fn: () => void): SiteDoc {
  useEditor.getState().replaceDoc(structuredClone(base));
  fn();
  return structuredClone(useEditor.getState().doc);
}

test("concurrent renames of different page folders both survive", () => {
  const base = pageFolderFixture();
  const local = edit(base, () => useEditor.getState().renamePageFolder("first", "Local name"));
  const remote = edit(base, () => useEditor.getState().renamePageFolder("second", "Remote name"));
  const originals = structuredClone([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(names(merged), { first: "Local name", second: "Remote name", third: "Third" });
  assert.deepEqual(order(merged), order(base));
  assert.deepEqual([base, local, remote], originals);
});

test("concurrent new folders keep their pages attached to visible folders", () => {
  const base = pageFolderFixture();
  let localId = "", remoteId = "";
  const local = edit(base, () => {
    localId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["p"], localId);
  });
  const remote = edit(base, () => {
    remoteId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["q"], remoteId);
  });
  const merged = mergeDocs(base, local, remote);
  assert.ok(names(merged)[localId]);
  assert.ok(names(merged)[remoteId]);
  assert.equal(merged.pages.p.folderId, localId);
  assert.equal(merged.pages.q.folderId, remoteId);
  assert.deepEqual(merged.nodes, base.nodes);
  assert.deepEqual(merged.pageOrder, local.pageOrder);
});

for (const localReorder of [false, true]) {
  test(`folder rename and ${localReorder ? "local" : "remote"} reorder remain independent`, () => {
    const base = pageFolderFixture();
    const renamed = edit(base, () => useEditor.getState().renamePageFolder("first", "Renamed"));
    const reordered = edit(base, () => useEditor.getState().moveFolder("third", { kind: "folder", id: "first", after: false }));
    const merged = mergeDocs(base, localReorder ? reordered : renamed, localReorder ? renamed : reordered);
    assert.deepEqual(order(merged), ["third", "first", "second"]);
    assert.equal(names(merged).first, "Renamed");
  });
}

for (const localDelete of [false, true]) {
  test(`deleting a folder does not erase an unrelated ${localDelete ? "remote" : "local"} rename`, () => {
    const base = pageFolderFixture();
    const renamed = edit(base, () => useEditor.getState().renamePageFolder("first", "Renamed"));
    const deleted = edit(base, () => useEditor.getState().deletePageFolder("second"));
    const merged = mergeDocs(base, localDelete ? deleted : renamed, localDelete ? renamed : deleted);
    assert.deepEqual(order(merged), ["first", "third"]);
    assert.equal(names(merged).first, "Renamed");
    assert.equal(merged.pages.q.folderId, undefined);
    assert.deepEqual(merged.nodes, base.nodes);
  });
}

test("same-folder rename conflicts still prefer the local edit", () => {
  const base = pageFolderFixture();
  const local = edit(base, () => useEditor.getState().renamePageFolder("first", "Local"));
  const remote = edit(base, () => useEditor.getState().renamePageFolder("first", "Remote"));
  assert.equal(names(mergeDocs(base, local, remote)).first, "Local");
});

test("same-folder deletion conflicts keep the established local preference", () => {
  const base = pageFolderFixture();
  const renamed = edit(base, () => useEditor.getState().renamePageFolder("first", "Renamed"));
  const deleted = edit(base, () => useEditor.getState().deletePageFolder("first"));
  assert.equal(names(mergeDocs(base, renamed, deleted)).first, "Renamed");
  assert.equal(names(mergeDocs(base, deleted, renamed)).first, undefined);
});

test("an unchanged side preserves absent and empty folder collections", () => {
  const base = pageFolderFixture();
  for (const folders of [undefined, [], [{ id: "new", name: "Only folder" }]]) {
    const remote = structuredClone(base);
    if (folders) remote.pageFolders = folders;
    else delete remote.pageFolders;
    assert.deepEqual(mergeDocs(base, base, remote).pageFolders, folders);
    assert.deepEqual(mergeDocs(base, remote, base).pageFolders, folders);
  }
});

test("concurrent additions are inserted next to their following folder", () => {
  const base = pageFolderFixture();
  const local = structuredClone(base), remote = structuredClone(base);
  local.pageFolders!.splice(1, 0, { id: "local", name: "Local" });
  remote.pageFolders!.splice(2, 0, { id: "remote", name: "Remote" });
  assert.deepEqual(order(mergeDocs(base, local, remote)), ["first", "local", "second", "remote", "third"]);
});

test("Undo and Redo of a local rename retain a different remote folder rename", () => {
  const base = pageFolderFixture();
  const remote = edit(base, () => useEditor.getState().renamePageFolder("second", "Remote name"));
  edit(base, () => useEditor.getState().renamePageFolder("first", "Local name"));
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().undo();
  assert.deepEqual(names(useEditor.getState().doc), { first: "First", second: "Remote name", third: "Third" });
  useEditor.getState().redo();
  assert.deepEqual(names(useEditor.getState().doc), { first: "Local name", second: "Remote name", third: "Third" });
});

test("receiving a folder rename after Undo preserves it through Redo", () => {
  const base = pageFolderFixture();
  const remote = edit(base, () => useEditor.getState().renamePageFolder("second", "Remote name"));
  edit(base, () => useEditor.getState().renamePageFolder("first", "Local name"));
  useEditor.getState().undo();
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().redo();
  assert.deepEqual(names(useEditor.getState().doc), { first: "Local name", second: "Remote name", third: "Third" });
});

test("Undo of local folder creation keeps the remote folder and page membership", () => {
  const base = pageFolderFixture();
  let remoteId = "";
  const remote = edit(base, () => {
    remoteId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["q"], remoteId);
  });
  let localId = "";
  edit(base, () => {
    localId = useEditor.getState().addPageFolder();
    useEditor.getState().movePagesToFolder(["p"], localId);
  });
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  useEditor.getState().undo();
  assert.equal(useEditor.getState().doc.pages.p.folderId, "first");
  assert.equal(useEditor.getState().doc.pages.q.folderId, remoteId);
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  useEditor.getState().undo();
  assert.equal(names(useEditor.getState().doc)[localId], undefined);
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  useEditor.getState().redo();
  useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.pages.p.folderId, localId);
  assert.ok(names(useEditor.getState().doc)[remoteId]);
});

for (const localDelete of [false, true]) {
  test(`a ${localDelete ? "local" : "remote"} folder deletion wins over a concurrent page move into it`, () => {
    const base = pageFolderFixture();
    const moved = edit(base, () => useEditor.getState().movePagesToFolder(["p"], "second"));
    const deleted = edit(base, () => useEditor.getState().deletePageFolder("second"));
    const originals = structuredClone([base, moved, deleted]);
    const merged = mergeDocs(base, localDelete ? deleted : moved, localDelete ? moved : deleted);
    assert.equal(names(merged).second, undefined);
    assert.equal(merged.pages.p.folderId, undefined);
    assert.equal(merged.pages.q.folderId, undefined);
    assert.deepEqual(merged.nodes, base.nodes);
    assert.deepEqual([base, moved, deleted], originals);
  });
}

test("concurrent folder reorder conflicts still prefer the local order", () => {
  const base = pageFolderFixture();
  const local = edit(base, () => useEditor.getState().moveFolder("third", { kind: "folder", id: "first", after: false }));
  const remote = edit(base, () => useEditor.getState().moveFolder("second", { kind: "folder", id: "first", after: false }));
  assert.deepEqual(order(mergeDocs(base, local, remote)), order(local));
});

test("Undo and Redo of folder deletion keep a concurrently added folder", () => {
  const base = pageFolderFixture();
  let remoteId = "";
  const remote = edit(base, () => { remoteId = useEditor.getState().addPageFolder(); });
  edit(base, () => useEditor.getState().deletePageFolder("first"));
  useEditor.getState().applyRemoteDoc(mergeDocs(base, useEditor.getState().doc, remote));
  assert.equal(names(useEditor.getState().doc).first, undefined);
  useEditor.getState().undo();
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  assert.equal(names(useEditor.getState().doc).first, "First");
  assert.equal(useEditor.getState().doc.pages.p.folderId, "first");
  useEditor.getState().redo();
  assert.ok(names(useEditor.getState().doc)[remoteId]);
  assert.equal(names(useEditor.getState().doc).first, undefined);
  assert.equal(useEditor.getState().doc.pages.p.folderId, undefined);
});

test("merging documents without folders does not add a folder collection", () => {
  const base = pageFolderFixture();
  delete base.pageFolders;
  for (const page of Object.values(base.pages)) delete page.folderId;
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages.p.name = "Local page";
  remote.pages.q.name = "Remote page";
  const merged = mergeDocs(base, local, remote);
  assert.equal(Object.hasOwn(merged, "pageFolders"), false);
  assert.equal(merged.pages.p.name, "Local page");
  assert.equal(merged.pages.q.name, "Remote page");
});

test("rebasing folder history does not mutate the existing document or history snapshots", () => {
  const base = pageFolderFixture();
  edit(base, () => {
    useEditor.getState().renamePageFolder("first", "Local name");
    useEditor.getState().deletePageFolder("third");
  });
  const current = useEditor.getState().doc;
  const past = [...useEditor.getState().past];
  const remote = structuredClone(base);
  remote.pageFolders![1].name = "Remote name";
  const originals = structuredClone([base, current, ...past, remote]);
  useEditor.getState().applyRemoteDoc(mergeDocs(base, current, remote));
  useEditor.getState().undo();
  useEditor.getState().redo();
  assert.deepEqual([base, current, ...past, remote], originals);
  assert.equal(names(useEditor.getState().doc).second, "Remote name");
  assert.equal(names(useEditor.getState().doc).third, undefined);
});
});

describe("page-html-navigation", () => {
const require = createRequire(import.meta.url);
function evaluate(source: string, overrides: Record<string, unknown> = {}) {
  const mod = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)(
    (id: string) => id in overrides ? overrides[id] : require(id), mod, mod.exports
  );
  return mod.exports;
}
const inline = (name: string) => `<script>${name}</script>`;

/** 偽の DOM に必要なスクリプトの準備だけを読む。タグに一致する正規表現を、
 * HTML の無害化として扱うことはしない。このマークアップは、実際のブラウザが解析する。 */
function scriptFixtures(html: string): { src: string | null; text: string }[] {
  const lower = html.toLowerCase();
  const result: { src: string | null; text: string }[] = [];
  let index = 0;
  while (index < html.length) {
    const open = lower.indexOf("<script", index);
    if (open < 0) break;
    const next = lower[open + 7];
    if (next && !/\s|>/.test(next)) { index = open + 7; continue; }
    let end = open + 7;
    let quote = "";
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === "'" || char === '"') quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) break;
    const close = lower.indexOf("</script", end + 1);
    if (close < 0) break;
    const closeEnd = lower.indexOf(">", close + 8);
    if (closeEnd < 0) break;
    const attributes = html.slice(open + 7, end);
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
    result.push({ src: src ? (src[1] ?? src[2] ?? "") : null, text: html.slice(end + 1, close) });
    index = closeEnd + 1;
  }
  return result;
}


// ブラウザ無しで、生成したコンポーネントのフックと DOM の操作を実行する。
// React と同じく、型・キー・位置が同じコンポーネントの ref を、描画の間で保つ。
function mount(fromServer: boolean) {
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let hydrating = fromServer;
  let effect: (() => (() => void) | undefined) | undefined;
  let previousDeps: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  const executed: string[] = [];
  const pending: { onload?: () => void; onerror?: () => void }[] = [];
  const hooks = {
    ...React,
    useRef(value: unknown) {
      const index = cursor++;
      return refs[index] ?? (refs[index] = { current: value });
    },
    useSyncExternalStore: () => hydrating,
    useEffect(fn: typeof effect, deps: unknown[]) {
      if (!previousDeps || deps.some((value, index) => value !== previousDeps![index])) {
        effect = fn;
        previousDeps = deps;
      }
    },
  };
  const document = {
    createElement: () => ({
      text: "", src: "", onload: undefined, onerror: undefined,
      setAttribute(name: string, value: string) { (this as any)[name] = value; },
    }),
  };
  // このモジュールにだけ document を渡し、グローバルの DOM や他のテストに影響させない。
  const source = PAGE_HTML_COMPONENT.replace('"use client";', '"use client";\nconst document = require("test-document");');
  const Component = evaluate(source, { react: hooks, "test-document": document }).default;
  function render(html: string, replay = false) {
    cursor = 0;
    effect = undefined;
    const element = Component({ html, staticHtml: deferRunnableScripts(html) });
    element.props.ref.current = {
      querySelectorAll: () => scriptFixtures(html).map((part) => ({
        attributes: [
          { name: "type", value: "application/x-tsumu-deferred" },
          { name: "data-tsumu-deferred", value: "" },
          ...(part.src ? [{ name: "src", value: part.src }] : []),
        ],
        getAttribute: () => null,
        text: part.text,
        replaceWith(script: any) {
          if (script.src) pending.push(script);
          else executed.push(script.text);
        },
      })),
    };
    if (effect) {
      cleanup?.();
      cleanup = effect();
      if (replay) {
        cleanup?.();
        cleanup = effect();
      }
    }
    hydrating = false;
  }
  return { render, executed, pending, unmount: () => cleanup?.() };
}

test("query variants reuse the generated PageHtml component position", async () => {
  const doc: SiteDoc = {
    siteName: "Query pages", pages: {}, pageOrder: ["a", "b"], nodes: {}, assets: {},
  };
  for (const name of doc.pageOrder) {
    doc.pages[name] = {
      id: name, name, slug: "", query: name === "a" ? "" : "tab=b",
      title: name, description: "", children: [], customTopHtml: inline(name),
    };
  }
  const { files } = generateProject(doc);
  const PageHtml = () => null;
  const variants = Object.fromEntries(doc.pageOrder.map((_, index) => [
    `./_q/p${index}`, evaluate(files[`app/_q/p${index}.tsx`], { "@/components/PageHtml": PageHtml }),
  ]));
  const page = evaluate(files["app/page.tsx"], variants).default;
  const render = async (query: Record<string, string>) =>
    (await page({ params: Promise.resolve({}), searchParams: Promise.resolve(query) })).props.children[1];
  const first = await render({});
  const second = await render({ tab: "b" });
  assert.equal(first.type, PageHtml);
  assert.equal(first.type, second.type);
  assert.equal(first.key, second.key);
  const mounted = mount(true);
  mounted.render(first.props.html, true);
  assert.deepEqual(mounted.executed, ["a"]); // 最初のスクリプトも hydration 後に初めて実行する。
  mounted.render(second.props.html);
  assert.deepEqual(mounted.executed, ["a", "b"]);
});

test("hydration runs initial scripts once, even with effect replay; later changes rerun", () => {
  const mounted = mount(true);
  mounted.render(inline("a"), true);
  mounted.render(inline("a")); // 同じHTMLを再描画しても再実行しない。
  assert.deepEqual(mounted.executed, ["a"]);
  for (const name of ["b", "a", "c"]) mounted.render(inline(name));
  assert.deepEqual(mounted.executed, ["a", "b", "a", "c"]);
  mounted.render(inline("c"));
  assert.deepEqual(mounted.executed, ["a", "b", "a", "c"]);
});

test("client-only mounts still execute scripts on mount and prop changes", () => {
  const mounted = mount(false);
  for (const name of ["a", "b", "a"]) mounted.render(inline(name));
  assert.deepEqual(mounted.executed, ["a", "b", "a"]);
});

test("navigation cancels the old external-script sequence and preserves new script order", async () => {
  const mounted = mount(true);
  mounted.render(inline("server"), true);
  mounted.render('<script src="/old.js"></script>' + inline("old tail"));
  assert.equal(mounted.pending.length, 1);
  mounted.render('<script src="/new.js"></script>' + inline("new tail"));
  assert.equal(mounted.pending.length, 2);
  mounted.pending[0].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["server"]);
  mounted.pending[1].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["server", "new tail"]);
  mounted.render('<script src="/last.js"></script>' + inline("unmounted tail"));
  mounted.unmount();
  mounted.pending[2].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["server", "new tail"]);
});
});

describe("page-kind-confirmation", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const state = () => useEditor.getState();
function fixture(patch: Partial<Page> = {}) {
  const doc = pageKindFixture();
  Object.assign(doc.pages.p, patch);
  state().replaceDoc(doc); state().setActivePage("p");
  const ui = importCallbacks("html");
  const render = () => elements(ui.render()).find(e => e.props?.options?.some((o: any) => o.value === "html"));
  return { ui, render, change: (kind: string) => render().props.onChange(kind) as Promise<void> };
}
function snapshot() {
  const { doc, past, future } = state();
  return structuredClone({ doc, past, future });
}

for (const kind of ["html", "redirect"]) {
  for (const patch of [
    { rawHtml: "<p>Collaborator content</p>" },
    { redirectTo: "/new-target" },
    { rewriteTo: "/new-rewrite" },
  ]) test(`${kind} confirmation cannot replace newer remote ${Object.keys(patch)[0]}`, async () => {
    const f = fixture();
    try {
      const change = f.change(kind);
      assert.equal(f.ui.confirmations.length, 1);
      const remote = structuredClone(state().doc); Object.assign(remote.pages.p, patch);
      state().applyRemoteDoc(remote);
      const before = snapshot();
      // 再描画より先に確認を完了しても、現在のストアで競合を見つける。
      f.ui.confirmations[0].resolve(true); await change;
      assert.deepEqual(snapshot(), before);
    } finally { f.ui.unmount(); }
  });

  for (const interruption of ["undo", "undo-redo", "restore", "replace", "delete", "page", "page-return", "unmount", "cancel"]) {
    test(`${kind} confirmation does not survive ${interruption}`, async () => {
      const f = fixture();
      try {
        state().updatePage("p", { title: "Undo this" });
        const change = f.change(kind);
        if (interruption.startsWith("undo")) state().undo();
        if (interruption === "undo-redo") state().redo();
        if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (interruption === "replace") state().replaceDoc(structuredClone(state().doc));
        if (interruption === "delete") { const remote = structuredClone(state().doc); delete remote.pages.p; remote.pageOrder = ["q"]; state().applyRemoteDoc(remote); }
        if (interruption.startsWith("page")) state().setActivePage("q");
        if (interruption === "page-return") { f.render(); state().setActivePage("p"); f.render(); }
        if (interruption === "unmount") f.ui.unmount();
        const before = snapshot();
        f.ui.confirmations[0].resolve(interruption !== "cancel"); await change;
        assert.deepEqual(snapshot(), before);
      } finally { f.ui.unmount(); }
    });
  }

  test(`${kind} confirmation preserves unrelated remote edits and creates one undo step`, async () => {
    const f = fixture();
    try {
      const change = f.change(kind);
      const remote = structuredClone(state().doc);
      Object.assign(remote.pages.p, { name: "Renamed", title: "New SEO", description: "New description" });
      remote.nodes.a.text!.content = "Collaborator element edit";
      remote.pages.q.name = "Other page";
      state().applyRemoteDoc(remote); f.render();
      const before = structuredClone(state().doc);
      f.ui.confirmations[0].resolve(true); await change;
      const after = structuredClone(state().doc);
      assert.deepEqual(after.pages.p, { ...before.pages.p, rawHtml: kind === "html" ? "" : null, redirectTo: kind === "redirect" ? "" : undefined, rewriteTo: undefined });
      assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.pages.q, before.pages.q);
      assert.equal(state().past.length, 1);
      state().undo(); assert.deepEqual(state().doc, before);
      state().redo(); assert.deepEqual(state().doc, after);
    } finally { f.ui.unmount(); }
  });
}

for (const [from, patch] of Object.entries({ normal: {}, html: { rawHtml: "<p>Approved old HTML</p>" }, redirect: { redirectTo: "/old" }, rewrite: { rewriteTo: "/old" } })) {
  for (const to of ["normal", "html", "redirect"]) {
    if ((from === "rewrite" ? "redirect" : from) === to) continue;
    test(`approved ${from} to ${to} still works`, async () => {
      const f = fixture(patch);
      try {
        const before = structuredClone(state().doc);
        const change = f.change(to);
        for (const dialog of f.ui.confirmations) dialog.resolve(true);
        await change;
        const after = structuredClone(state().doc);
        assert.equal(after.pages.p.rawHtml, to === "html" ? (patch as Partial<Page>).rawHtml || "" : null);
        assert.equal(after.pages.p.redirectTo, to === "redirect" ? "" : undefined);
        assert.equal(after.pages.p.rewriteTo, undefined);
        assert.deepEqual(after.nodes, before.nodes);
        assert.deepEqual(after.pages.p.children, before.pages.p.children);
        state().undo(); assert.deepEqual(state().doc, before);
        state().redo(); assert.deepEqual(state().doc, after);
      } finally { f.ui.unmount(); }
    });
  }
}

test("a newer kind request supersedes a pending confirmation", async () => {
  const f = fixture();
  try {
    const older = f.change("html");
    const newer = f.change("redirect");
    const before = snapshot();
    f.ui.confirmations[0].resolve(true); await older;
    assert.deepEqual(snapshot(), before);
    f.ui.confirmations[1].resolve(true); await newer;
    assert.equal(state().doc.pages.p.redirectTo, "");
    assert.equal(state().past.length, 1);
  } finally { f.ui.unmount(); }
});
});

describe("page-panel-order", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const labels = (doc: SiteDoc) => pagePanelItems(doc).map((item) => item.kind + ":" + item.id);
const example = () => {
  const doc = pageFolderFixture();
  delete doc.pages.p.folderId;
  delete doc.pages.q.folderId;
  doc.pages.r = { ...structuredClone(doc.pages.q), id: "r", name: "R", slug: "r", children: [] };
  doc.pageOrder.push("r");
  return doc;
};

test("a folder can be dragged between two loose pages without changing published page order", () => {
  const doc = example(), pageOrder = [...doc.pageOrder];
  assert.deepEqual(labels(doc), ["page:p", "page:q", "page:r", "folder:first", "folder:second", "folder:third"]);
  placePageFolder(doc, "first", { kind: "page", id: "q", after: false });
  assert.deepEqual(labels(doc), ["page:p", "folder:first", "page:q", "page:r", "folder:second", "folder:third"]);
  assert.equal(doc.pageFolders?.find((f) => f.id === "first")?.beforePageId, "q");
  assert.deepEqual(doc.pageOrder, pageOrder);
  assert.equal(validSiteDoc(doc), true);
});

test("dragging a folder after a page, across other folders and to the end preserves the exact order", () => {
  const doc = example();
  placePageFolder(doc, "first", { kind: "page", id: "q", after: false });
  placePageFolder(doc, "second", { kind: "page", id: "p", after: true });
  assert.deepEqual(labels(doc), ["page:p", "folder:second", "folder:first", "page:q", "page:r", "folder:third"]);
  placePageFolder(doc, "third", { kind: "folder", id: "second", after: true });
  assert.deepEqual(labels(doc), ["page:p", "folder:second", "folder:third", "folder:first", "page:q", "page:r"]);
  placePageFolder(doc, "second", { kind: "end" });
  assert.deepEqual(labels(doc), ["page:p", "folder:third", "folder:first", "page:q", "page:r", "folder:second"]);
  assert.equal(validSiteDoc(doc), true);
});

test("nested children remain in their folder and cannot be used as a top-level drop target", () => {
  const doc = pageFolderFixture();
  placePageFolder(doc, "third", { kind: "page", id: "p", after: false });
  assert.deepEqual(labels(doc), ["folder:first", "folder:second", "folder:third"]);
  assert.equal(doc.pages.p.folderId, "first");
  assert.equal(doc.pages.q.folderId, "second");
  assert.equal(validSiteDoc(doc), true);
});

test("moving or deleting an anchoring page retains the folder slot", () => {
  const doc = example();
  placePageFolder(doc, "first", { kind: "page", id: "q", after: false });
  retainPageFolderSlots(doc, new Set(["q"]));
  doc.pageOrder = ["p", "r"];
  delete doc.pages.q;
  assert.deepEqual(labels(doc), ["page:p", "folder:first", "page:r", "folder:second", "folder:third"]);
  assert.equal(doc.pageFolders?.[0].beforePageId, "r");
  assert.equal(validSiteDoc(doc), true);
});

test("folder drag is one undoable change and survives redo", () => {
  const store = useEditor.getState();
  store.replaceDoc(example());
  const before = structuredClone(useEditor.getState().doc);
  useEditor.getState().moveFolder("second", { kind: "page", id: "q", after: false });
  const after = structuredClone(useEditor.getState().doc);
  assert.deepEqual(labels(after), ["page:p", "folder:second", "page:q", "page:r", "folder:first", "folder:third"]);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc, before);
  useEditor.getState().redo();
  assert.deepEqual(useEditor.getState().doc, after);
});

test("folder positioning and an unrelated concurrent rename both survive a merge", () => {
  const base = example();
  const local = structuredClone(base);
  placePageFolder(local, "third", { kind: "page", id: "q", after: false });
  const remote = structuredClone(base);
  remote.pageFolders![0].name = "Renamed";
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(labels(merged), labels(local));
  assert.equal(merged.pageFolders?.find((f) => f.id === "first")?.name, "Renamed");
  assert.equal(validSiteDoc(merged), true);
});

test("anchors for pages moved inside a folder do not leave dangling references", () => {
  const store = useEditor.getState();
  store.replaceDoc(example());
  useEditor.getState().moveFolder("third", { kind: "page", id: "q", after: false });
  useEditor.getState().movePagesToFolder(["q"], "first");
  const result = useEditor.getState().doc;
  assert.deepEqual(labels(result), ["page:p", "folder:third", "page:r", "folder:first", "folder:second"]);
  assert.equal(result.pageFolders?.find((f) => f.id === "third")?.beforePageId, "r");
  assert.equal(validSiteDoc(result), true);
});
});

describe("page-transfer", () => {
function source(): SiteDoc {
  const box = (id: string, children: string[] = []) => ({ ...makeBox(), id, children });
  return {
    siteName: "From",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["a"] },
      about: { id: "about", name: "About", slug: "about", title: "About", description: "", children: ["c"], folderId: "f1" },
      news: { id: "news", name: "News", slug: "news", title: "News", description: "", children: [] },
    },
    pageOrder: ["home", "about", "news"],
    pageFolders: [{ id: "f1", name: "Info" }],
    nodes: {
      a: { ...box("a", ["b"]), link: { kind: "page", pageId: "about" } },
      b: { ...box("b"), image: { src: "", alt: "", width: 1, height: 1, assetId: "img1" } },
      c: {
        ...box("c"),
        scripts: [{ id: "s", trigger: "click", steps: [{ id: "x", kind: "open-page", pageId: "news" }] }],
      },
    },
    assets: { img1: { id: "img1", name: "a.png", path: "/a.png", width: 1, height: 1 }, unused: { id: "unused", name: "b.png", path: "/b.png", width: 1, height: 1 } },
  };
}

function target(): SiteDoc {
  return {
    siteName: "To",
    pages: {
      t: { id: "t", name: "Home", slug: "", title: "Home", description: "", children: [] },
      tn: { id: "tn", name: "Latest", slug: "news", title: "", description: "", children: [] },
    },
    pageOrder: ["t", "tn"],
    nodes: {},
    assets: {},
  };
}

test("copying pages to another site brings nodes, assets and folders and relinks pages", () => {
  const src = source();
  const dst = target();
  const added = applyPagePayload(dst, buildPagePayload(src, ["about", "home"]));
  assert.equal(added, 2);
  assert.equal(dst.pageOrder.length, 4);
  const [home, about] = dst.pageOrder.slice(2).map((id) => dst.pages[id]);
  // 同じ名前・URL のページがあれば、「のコピー」にする
  assert.notEqual(home.slug, "");
  assert.equal(about.slug, "about");
  assert.equal(about.name, "About");
  // フォルダは、同じ名前で作る
  assert.equal(dst.pageFolders?.find((f) => f.id === about.folderId)?.name, "Info");
  // 要素は新しい ID になり、入れ子もそろっている
  const a = dst.nodes[home.children[0]];
  assert.ok(a && a.id !== "a");
  assert.equal(dst.nodes[a.children[0]]?.image?.assetId, "img1");
  // 一緒にコピーしたページへのリンクは新しいページへ、コピーしなかったページへのリンクは、同じ URL のページへ
  assert.equal(a.link?.pageId, about.id);
  const step = dst.nodes[about.children[0]].scripts?.[0].steps[0];
  assert.equal(step?.kind === "open-page" ? step.pageId : null, "tn");
  // 使っているアセットだけを写す
  assert.deepEqual(Object.keys(dst.assets), ["img1"]);
  // 元のサイトは変わらない
  assert.deepEqual(src, source());
});

test("pages copied to a site in another language keep their language", () => {
  const src = source();
  src.lang = "en";
  src.pages.news.lang = "fr";
  const dst = target();
  dst.lang = "ja";
  applyPagePayload(dst, buildPagePayload(src, ["home", "news"]));
  const [home, news] = dst.pageOrder.slice(2).map((id) => dst.pages[id]);
  assert.equal(home.lang, "en");
  // ページで選んでいた言語は、そのまま
  assert.equal(news.lang, "fr");
  // 同じ言語のサイトへのコピーでは、サイトの言語に従ったまま
  const same = target();
  same.lang = "en";
  applyPagePayload(same, buildPagePayload(src, ["home"]));
  assert.equal(same.pages[same.pageOrder[2]].lang, undefined);
});

test("copied component masters relink copied pages and matching destination slugs", () => {
  const src = source();
  src.nodes.a.type = "instance";
  src.nodes.a.componentId = "header";
  src.nodes.a.children = [];
  src.nodes.master = {
    ...makeBox(), id: "master", children: [],
    link: { kind: "page", pageId: "about" },
    scripts: [{ id: "master-script", trigger: "click", steps: [
      { id: "loop", kind: "repeat", times: 1, then: [
        { id: "open", kind: "open-page", pageId: "news" },
      ] },
    ] }],
  };
  src.components = { header: { id: "header", name: "Header", rootId: "master" } };
  const original = structuredClone(src);
  const dst = target();
  applyPagePayload(dst, buildPagePayload(src, ["home", "about"]));
  const about = dst.pages[dst.pageOrder[3]];
  assert.equal(dst.nodes.master.link?.pageId, about.id);
  const loop = dst.nodes.master.scripts?.[0].steps[0];
  assert.equal(loop?.kind === "repeat" && loop.then[0].kind === "open-page" ? loop.then[0].pageId : null, "tn");
  assert.deepEqual(src, original);

  // 同じコンポーネントがすでにあるときは、コピー先の編集内容を保つ。
  dst.nodes.master.link = { kind: "page", pageId: "t" };
  const existing = structuredClone(dst.nodes.master);
  applyPagePayload(dst, buildPagePayload(src, ["home", "about"]));
  assert.deepEqual(dst.nodes.master, existing);
});

test("page copy remaps equal-width breakpoint IDs without changing the destination", () => {
  const src = source(), dst = target();
  src.breakpoints = [{ id: "narrow", label: "Small", maxWidth: 600 }, { id: "wide", label: "Large", maxWidth: 900 }];
  // ID をわざと入れ替える。その場でキーの名前を変えると、スタイルが上書きされてしまう。
  dst.breakpoints = [{ id: "wide", label: "Small target", maxWidth: 600 }, { id: "narrow", label: "Large target", maxWidth: 900 }];
  src.nodes.a.styles = { base: { default: { color: "red" } }, narrow: { default: { color: "blue" } }, wide: { default: { color: "green" } } };
  src.nodes.a.hiddenOn = ["narrow"];
  src.pages.home.bodyStyles = { wide: { default: { backgroundColor: "yellow" } } };
  src.nodes.a.children = ["instance"];
  src.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "widget" };
  src.nodes.master = { ...makeBox(), id: "master", styles: { narrow: { default: { color: "purple" } } }, hiddenOn: ["wide"] };
  src.components = { widget: { id: "widget", name: "Widget", rootId: "master" } };
  const before = structuredClone(dst), original = structuredClone(src);
  const payload = buildPagePayload(src, ["home"]);
  const payloadBefore = structuredClone(payload);
  applyPagePayload(dst, payload);
  const page = dst.pages[dst.pageOrder.at(-1)!], node = dst.nodes[page.children[0]];
  assert.equal(node.styles.wide?.default?.color, "blue");
  assert.equal(node.styles.narrow?.default?.color, "green");
  assert.deepEqual(node.hiddenOn, ["wide"]);
  assert.equal(page.bodyStyles?.narrow?.default?.backgroundColor, "yellow");
  assert.equal(dst.nodes.master.styles.wide?.default?.color, "purple");
  assert.deepEqual(dst.nodes.master.hiddenOn, ["narrow"]);
  assert.deepEqual(dst.breakpoints, before.breakpoints);
  for (const id of before.pageOrder) assert.deepEqual(dst.pages[id], before.pages[id]);
  assert.deepEqual(src, original);
  assert.deepEqual(payload, payloadBefore);
});

test("incompatible or unknown responsive settings stop before importing any dependencies", () => {
  for (const change of ["width", "node", "page", "component", "limit"] as const) {
    const src = source(), dst = target();
    if (change === "width") src.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
    if (change === "node") src.nodes.a.hiddenOn = ["unknown"];
    if (change === "page") src.pages.home.bodyStyles = { unknown: { default: { color: "red" } } };
    if (change === "component") {
      src.nodes.a.type = "instance"; src.nodes.a.componentId = "widget";
      src.nodes.master = { ...makeBox(), id: "master", styles: { unknown: { default: { color: "red" } } } };
      src.components = { widget: { id: "widget", name: "Widget", rootId: "master" } };
    }
    if (change === "limit") src.breakpoints = Array.from({ length: 7 }, (_, i) => ({ id: `bp${i}`, label: `BP${i}`, maxWidth: 400 + i * 100 }));
    const before = structuredClone(dst);
    assert.throws(() => applyPagePayload(dst, buildPagePayload(src, ["home"])), /画面幅|screen-width/);
    assert.deepEqual(dst, before, change);
  }
});

test("six matching custom screen widths remain usable", () => {
  const src = source(), dst = target();
  src.breakpoints = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, label: "Source", maxWidth: 400 + i * 100 }));
  dst.breakpoints = src.breakpoints.map(b => ({ ...b, id: b.id.replace("a", "b") }));
  src.nodes.a.styles = { a5: { default: { color: "blue" } } };
  applyPagePayload(dst, buildPagePayload(src, ["home"]));
  assert.equal(dst.nodes[dst.pages[dst.pageOrder.at(-1)!].children[0]].styles.b5?.default?.color, "blue");
});

test("conflicting source masters with invalid responsive styles are rejected without modifying the destination", () => {
  const src = source(), dst = target();
  src.nodes.a.type = "instance"; src.nodes.a.componentId = "widget";
  src.nodes.master = { ...makeBox(), id: "master", styles: { obsolete: { default: { color: "red" } } } };
  src.components = { widget: { id: "widget", name: "Widget", rootId: "master" } };
  dst.nodes.existing = { ...makeBox(), id: "existing" };
  dst.components = { widget: { id: "widget", name: "Existing widget", rootId: "existing" } };
  const before = structuredClone(dst);
  assert.throws(() => applyPagePayload(dst, buildPagePayload(src, ["home"])), /画面幅|screen-width/);
  assert.deepEqual(dst, before);
});

test("over-limit destination breakpoints cannot be silently truncated during copy", () => {
  const src = source(), dst = target();
  dst.breakpoints = Array.from({ length: 7 }, (_, i) => ({ id: `bp${i}`, label: "BP", maxWidth: 400 + i * 100 }));
  const before = structuredClone(dst);
  assert.throws(() => applyPagePayload(dst, buildPagePayload(src, ["home"])), /画面幅|screen-width/);
  assert.deepEqual(dst, before);
});


test("repeated page copies give each node and page script independent block identities", () => {
  const src = source(), dst = target();
  const nested = (id: string) => [{ id, trigger: "click" as const, steps: [{
    id: id + "-condition", kind: "if" as const,
    cond: { subject: "visible" as const, target: "@self" },
    then: [{ id: id + "-then", kind: "show" as const, target: "@self" }],
    else: [{ id: id + "-else", kind: "hide" as const, target: "@self" }],
  }] }];
  src.nodes.a.scripts = nested("node-script");
  src.pages.home.pageScripts = nested("page-script");
  const payload = buildPagePayload(src, ["home"]);
  const original = structuredClone(payload);
  applyPagePayload(dst, payload);
  applyPagePayload(dst, payload);

  const seen = new Set<string>();
  for (const id of dst.pageOrder.slice(2)) {
    const page = dst.pages[id];
    const node = dst.nodes[page.children[0]];
    const scripts = [...(node.scripts ?? []), ...(page.pageScripts ?? [])];
    assert.equal(scripts.length, 2);
    for (const script of scripts) {
      assert.ok(!seen.has(script.id), "copied script ID must be unique");
      seen.add(script.id);
      walkSteps(script.steps, (step) => {
        assert.ok(!seen.has(step.id), "copied nested step ID must be unique");
        seen.add(step.id);
      });
    }
  }
  assert.equal(seen.size, 16, "two copies, two scripts each, four identities per script");
  assert.deepEqual(payload, original);
});
});

describe("page-transfer-query", () => {
test("copied links and generated navigation scripts preserve the destination query variant", () => {
  const { source, target } = queryCopyFixture();
  const original = structuredClone(source);
  applyPagePayload(target, buildPagePayload(source, ["home"]));
  const { tree, html } = renderQueryCopyExport(target);
  const [, link, button] = tree.props.children;
  assert.equal(link.props.href, "/blog?tab=news");
  assert.equal(JSON.parse(button.props["data-scripts"])[0].steps[0].href, "/blog?tab=news");
  assert.match(html, /href="\/blog\?tab=news"/);
  assert.deepEqual(source, original);
});

test("query matching ignores parameter order and equivalent encoding, but not values", () => {
  for (const [from, to] of [
    ["tab=news&page=2", "page=2&tab=news"],
    ["q=hello%20world&tab=news", "tab=news&q=hello+world"],
    [undefined, ""],
    ["", undefined],
  ]) {
    const { source, target } = queryCopyFixture();
    source.pages["source-news"].query = from;
    target.pages.news.query = to;
    // slug が同じでクエリが違うページを、最後の項目にする。
    delete target.pages.default;
    target.pageOrder = ["news", "archive"];
    applyPagePayload(target, buildPagePayload(source, ["home"]));
    const home = target.pages[target.pageOrder.at(-1)!];
    assert.equal(target.nodes[home.children[0]].link?.pageId, "news", `${from} → ${to}`);
  }
});

test("missing query matches do not silently retarget links to another variant", () => {
  const { source, target } = queryCopyFixture();
  delete target.pages.news;
  target.pageOrder = ["default", "archive"];
  applyPagePayload(target, buildPagePayload(source, ["home"]));
  const home = target.pages[target.pageOrder.at(-1)!];
  assert.equal(target.nodes[home.children[0]].link?.pageId, "source-news");
});

test("missing required page-copy metadata is rejected without changing the destination", () => {
  const { source, target } = queryCopyFixture();
  const payload = buildPagePayload(source, ["home"]);
  const before = structuredClone(target);
  delete (payload as Partial<typeof payload>).queries;
  assert.throws(() => applyPagePayload(target, payload), /Invalid page copy metadata/);
  assert.deepEqual(target, before);
});

test("pages copied together take priority over matching destination URLs", () => {
  const { source, target } = queryCopyFixture();
  applyPagePayload(target, buildPagePayload(source, ["home", "source-news"]));
  const [home, news] = target.pageOrder.slice(-2).map((id) => target.pages[id]);
  assert.equal(target.nodes[home.children[0]].link?.pageId, news.id);
  assert.notEqual(news.id, "news");
  assert.equal(news.query, "tab=news");
});

test("query-aware relinking covers page scripts and new masters without changing existing masters", () => {
  const { source, target } = queryCopyFixture();
  const scripts: Script[] = [{ id: "nested", trigger: "click", steps: [
    { id: "if", kind: "if", cond: { subject: "var", target: "", left: "yes", op: "eq", value: "yes" }, then: [
      { id: "repeat", kind: "repeat", times: 1, then: [
        { id: "open", kind: "open-page", pageId: "source-news" },
      ] },
    ], else: [{ id: "each", kind: "for-each", array: "items", then: [
      { id: "otherwise", kind: "open-page", pageId: "source-news" },
    ] }] },
  ] }];
  source.pages.home.pageScripts = structuredClone(scripts);
  source.nodes.master = { ...makeBox(), id: "master", link: { kind: "page", pageId: "source-news" }, scripts };
  source.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "header" };
  source.pages.home.children.push("instance");
  source.components = { header: { id: "header", name: "Header", rootId: "master" } };
  const payload = buildPagePayload(source, ["home"]);
  const original = structuredClone(payload);
  applyPagePayload(target, payload);
  const home = target.pages[target.pageOrder.at(-1)!];
  assert.equal(target.nodes.master.link?.pageId, "news");
  for (const script of [...home.pageScripts!, ...target.nodes.master.scripts!]) {
    walkSteps(script.steps, (step) => {
      if (step.kind === "open-page") assert.equal(step.pageId, "news");
    });
  }
  target.nodes.master.link = { kind: "page", pageId: "archive" };
  const existing = structuredClone(target.nodes.master);
  applyPagePayload(target, payload);
  assert.deepEqual(target.nodes.master, existing);
  assert.deepEqual(payload, original);
});

test("copied pages keep compatible query routes and reserve exclusive or equivalent routes", () => {
  const { source, target } = queryCopyFixture();
  // A matching display name alone must not change the public URL.
  target.pages.news.name = source.pages["source-news"].name;
  target.pages.news.query = "view=other";
  source.pages.archive = { ...source.pages["source-news"], id: "archive", name: "Another archive", query: "view=new" };
  source.pageOrder.push("archive");
  applyPagePayload(target, buildPagePayload(source, ["source-news", "archive"]));
  const added = target.pageOrder.slice(-2).map(id => target.pages[id]);
  assert.deepEqual(added.map(p => [p.slug, p.query]), [["blog", "tab=news"], ["blog", "view=new"]]);
  assert.notEqual(added[0].name, target.pages.news.name);

  for (const existing of [
    { slug: "blog/", query: "tab=news&tab=unused" },
    { slug: "blog", query: "different=yes", rawHtml: "<p>Keep me</p>" },
    { slug: "blog", redirectTo: "/about" },
    { slug: "blog", rewriteTo: "https://example.org/" },
    { slug: "404", query: "other=page" },
  ]) {
    const { source, target } = queryCopyFixture();
    target.pages = { news: { ...target.pages.news, ...existing } };
    target.pageOrder = ["news"];
    source.pages["source-news"].slug = existing.slug === "404" ? "404" : "blog";
    applyPagePayload(target, buildPagePayload(source, ["source-news"]));
    assert.equal(target.pages[target.pageOrder[1]].slug, source.pages["source-news"].slug + "-copy");
  }
});
});

describe("page-transfer-storage", () => {
const target = { id: "destination", name: "Destination" };
const source = createInitialDoc();
const payload = buildPagePayload(source, source.pageOrder);

test("server copy retries against the latest revision, preserving concurrent target edits", async () => {
  const before = createInitialDoc();
  const concurrent = structuredClone(before);
  concurrent.siteName = "Concurrent title";
  concurrent.customHeadHtml = "<!-- Concurrent edit -->";
  const bodies: any[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://example.test");
    assert.equal(url.searchParams.get("site"), target.id);
    if (!init) return Response.json({ exists: true, rev: "1", doc: before });
    bodies.push(JSON.parse(String(init.body)));
    assert.equal(url.searchParams.get("base"), String(bodies.length));
    return bodies.length === 1 ? Response.json({ conflict: true, rev: "2", doc: concurrent }, { status: 409 }) : Response.json({ ok: true });
  };
  try {
    await copyPagesToSite(target, payload, "server");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].siteName, concurrent.siteName);
    assert.equal(bodies[1].customHeadHtml, concurrent.customHeadHtml);
    assert.equal(bodies[1].pageOrder.length, concurrent.pageOrder.length + payload.pages.length);
  } finally { globalThis.fetch = oldFetch; }
});

test("server conflict rechecks screen widths before attempting another write", async () => {
  const before = createInitialDoc(), concurrent = createInitialDoc();
  concurrent.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
  let writes = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (!init) return Response.json({ exists: true, rev: "1", doc: before });
    writes++;
    return Response.json({ conflict: true, rev: "2", doc: concurrent }, { status: 409 });
  };
  try {
    await assert.rejects(copyPagesToSite(target, payload, "server"), /画面幅|screen-width/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = oldFetch; }
});


test("a lost server copy reply is confirmed from the new page IDs without repeating the write", async t => {
  for (const reply of ["network", "server", "truncated", "not-saved"] as const) {
    await t.test(reply, async t => {
      let destination = createInitialDoc(), reads = 0, writes = 0;
      const initialCount = destination.pageOrder.length;
      t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
        if (!init) {
          reads++;
          return Response.json({ exists: true, rev: String(reads), doc: destination });
        }
        writes++;
        if (reply !== "not-saved") {
          destination = JSON.parse(String(init.body));
          destination.siteName = "Concurrent rename after the copy";
        }
        if (reply === "network") throw new TypeError("Connection reset after sending");
        if (reply === "server") return Response.json({ error: "Error after write" }, { status: 502 });
        return new Response('{"ok":');
      });
      if (reply === "not-saved") await assert.rejects(copyPagesToSite(target, payload, "server"));
      else await copyPagesToSite(target, payload, "server");
      assert.equal(reads, 2);
      assert.equal(writes, 1);
      assert.equal(destination.pageOrder.length, initialCount + (reply === "not-saved" ? 0 : payload.pages.length));
    });
  }
});

test("an unreadable destination or conflict cannot initiate a copy into a blank site", async t => {
  for (const conflict of [false, true]) {
    await t.test(conflict ? "invalid conflict" : "invalid read", async t => {
      let writes = 0;
      t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
        if (!init) return conflict ? Response.json({ exists: true, rev: "1", doc: createInitialDoc() }) : new Response("");
        writes++;
        return Response.json({}, { status: 409 });
      });
      await assert.rejects(copyPagesToSite(target, payload, "server"));
      assert.equal(writes, conflict ? 1 : 0);
    });
  }
});
});

describe("preview-query-navigation", () => {
const fixture = previewNavigationFixture();
for (const slug of ["blog", "posts/[slug]"]) {
  test(`preview ${slug} links select the same query variant as the generated route`, async () => {
    const navigate = await fixture;
    const doc = previewQueryDoc(slug);
    const variants = doc.pageOrder.filter((id) => id.startsWith("variant")).map((id) => doc.pages[id]);
    for (const query of ["tab=news", "lang=ja&tab=news#section", "tab=archive", "tab=unknown", "", "extra=1&tab=news", "tab=news&tab=archive", "tab=archive&tab=news"]) {
      const url = `/${slug.replace("[slug]", "article")}?${query}`;
      const expected = await publishedQueryPage(variants, url);
      assert.equal(navigate(doc, url), expected, url);
      assert.equal(navigate(doc, `?${query}`, "variant0"), expected, `?${query}`);
    }
  });
}
test("encoded query keys and values, first-value inputs and equally specific ties match publishing", async () => {
  const navigate = await fixture;
  const doc = previewQueryDoc("blog", ["", "q=hello+world", "q=hello%20world&lang=ja", "lang=ja", "q=hello+world&source=mail", "q=first&q=last"]);
  const variants = doc.pageOrder.filter((id) => id.startsWith("variant")).map((id) => doc.pages[id]);
  for (const url of ["/blog?q=hello%20world", "/blog?q=hello+world&lang=ja", "/blog?lang=ja&q=other", "/blog?q=hello%20world&q=other", "/blog?lang=ja&q=hello+world#q=other", "/blog?source=mail&q=hello+world&lang=ja", "/blog?q=last", "/blog?q=first"]) {
    assert.equal(navigate(doc, url), await publishedQueryPage(variants, url), url);
  }
});
test("no default query keeps the first-page fallback and does not affect other routes", async () => {
  const navigate = await fixture;
  const doc = previewQueryDoc("blog", ["tab=archive", "tab=news"]);
  assert.equal(navigate(doc, "/blog?tab=news"), "variant1");
  assert.equal(navigate(doc, "/blog?tab=missing"), "variant0");
  assert.equal(navigate(doc, "/unknown?tab=news"), "missing");
  assert.equal(navigate(doc, "/"), "home");
  doc.pages.start = { ...doc.pages.home, id: "start", slug: "guide/chapter", children: [] };
  doc.pages.next = { ...doc.pages.home, id: "next", slug: "guide/next", children: [] };
  doc.pageOrder.push("start", "next");
  assert.equal(navigate(doc, "../blog?tab=news", "start"), "variant1");
  assert.equal(navigate(doc, "./next", "start"), "next");
  assert.equal(navigate(doc, "#section"), "home");
});


test("malformed escaped dynamic paths use the missing-page fallback without throwing", async () => {
  const navigate = await fixture;
  const doc = previewQueryDoc("posts/[slug]");
  for (const path of ["/posts/%", "/posts/%E0%A4%A", "/posts/%FF", "/posts/%2F"]) {
    assert.equal(navigate(doc, path), "missing", path);
  }
  assert.equal(navigate(doc, "/posts/%E6%97%A5%E6%9C%AC"), "variant0");
});
});

describe("preview-refresh", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
// 実際のフックの状態と依存配列を持つ。実際の Canvas と DOM の操作は、e2e でも検証する。
function mount(initialMode: EditorMode = "preview", doc = previewRefreshDoc()) {
  useEditor.getState().replaceDoc(doc);
  let mode = initialMode;
  let pageId = "home";
  let cursor = 0;
  let writes = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const hooks = {
    ...React,
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { writes++; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn: () => any, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn: any, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { effect: true, deps, cleanup: fn() };
      });
    },
  };
  const requests: { input: any; signal: AbortSignal | null | undefined; finish: (response: Response) => void; fail: (error: Error) => void }[] = [];
  const fetch = (_url: string, options: RequestInit) => new Promise<Response>((finish, fail) => {
    requests.push({ input: JSON.parse(String(options.body)), signal: options.signal, finish, fail });
  });
  const require = createRequire(resolve_2("components/canvas/useCanvasData.ts"));
  const module = { exports: {} as any };
  const code = transformSync(readFileSync("components/canvas/useCanvasData.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "fetch", code)(
    (id: string) => id === "react" ? hooks : id === "../../lib/store" ? { useEditor: (selector: any) => selector(useEditor.getState()) } : require(id),
    module, module.exports, fetch,
  );
  const render = () => {
    cursor = 0;
    const state = useEditor.getState();
    const result = module.exports.useCanvasData({ page: state.doc.pages[pageId], doc: state.doc, activePageId: pageId, previewIndex: 0, mode, setPreviewIndex: state.setPreviewIndex });
    effects.splice(0).forEach((effect) => effect());
    return result;
  };
  const tick = () => new Promise((done) => setTimeout(done, 0));
  render();
  return {
    render, requests, writes: () => writes,
    mode(next: EditorMode) { mode = next; render(); },
    page(next: string) {
      pageId = next;
      render();
    },
    unmount() { for (const slot of slots) if (slot?.effect) slot.cleanup?.(); },
    async finish(index: number, json: unknown, status = 200) {
      requests[index].finish(new Response(JSON.stringify({ json }), { status })); await tick();
    },
    async fail(index: number) { requests[index].fail(new Error("offline")); await tick(); },
  };
}

for (const order of ["newest-first", "oldest-first"] as const) {
  test(`repeated preview submits keep the latest data and its loading state (${order})`, async () => {
    const m = mount();
    m.render().setFieldValues({ q: "new search" });
    void m.render().refreshData();
    assert.equal(new URL(m.requests[1].input.url).searchParams.get("q"), "new search");
    if (order === "newest-first") {
      await m.finish(1, previewRows("new", 35));
      await m.finish(0, previewRows("old", 50));
    } else {
      await m.finish(0, previewRows("old", 50));
      assert.equal(m.render().refreshing, true);
      assert.equal(m.render().pageVars.response.label, "home saved");
      await m.finish(1, previewRows("new", 35));
    }
    assert.equal(m.render().pageVars.response.label, "new");
    assert.equal(m.render().pageVars.response.rows.length, 35, "preview retains full data");
    assert.equal(m.render().pageVars.total, 35);
    assert.equal(m.render().refreshing, false);
    m.mode("design");
    assert.equal(m.render().pageVars.response.rows.length, 20, "design keeps a compact sample");
    assert.equal(m.render().pageVars.total, 35, "sample totals belong to the latest response");
    m.unmount();
  });
}

for (const interruption of ["preview restart", "page round trip"] as const) {
  test(`${interruption} discards responses from the previous visit`, async () => {
    const m = mount();
    if (interruption === "preview restart") { m.mode("design"); m.mode("preview"); }
    else { m.page("other"); await m.finish(1, previewRows("other", 27)); m.page("home"); }
    const latest = m.requests.length - 1;
    await m.finish(latest, previewRows("new", 34));
    await m.finish(0, previewRows("old", 52));
    assert.equal(m.render().pageVars.response.label, "new");
    assert.equal(m.render().pageVars.total, 34);
    m.unmount();
  });
}

test("leaving preview cancels its pending result and loading indicator", async () => {
  const m = mount();
  m.mode("design");
  assert.equal(m.render().refreshing, false);
  await m.finish(0, previewRows("abandoned"));
  assert.equal(m.render().pageVars.response.label, "home saved");
  assert.equal(m.render().pageVars.total, 1);
  m.unmount();
});

test("an older failure cannot end a current refresh; newest failure keeps the last valid data", async () => {
  for (const network of [false, true]) {
    const m = mount();
    await m.finish(0, previewRows("valid", 31));
    void m.render().refreshData();
    void m.render().refreshData();
    if (network) await m.fail(1); else await m.finish(1, null, 502);
    assert.equal(m.render().refreshing, true);
    assert.equal(m.render().pageVars.response.label, "valid");
    await m.finish(2, null, 502);
    assert.equal(m.render().refreshing, false);
    assert.equal(m.render().pageVars.response.rows.length, 31);
    assert.equal(m.render().pageVars.total, 31);
    m.unmount();
  }
});

test("a failed new session uses saved samples instead of accepting an abandoned success", async () => {
  const m = mount();
  m.page("other");
  await m.fail(1);
  assert.equal(m.render().pageVars.response.label, "other saved");
  await m.finish(0, previewRows("abandoned home"));
  assert.equal(m.render().pageVars.response.label, "other saved");
  m.page("home");
  await m.fail(2);
  assert.equal(m.render().pageVars.response.label, "home saved");
  m.unmount();
});

test("unrelated document edits and unsubmitted form changes do not discard a valid refresh", async () => {
  const m = mount("design");
  void m.render().refreshData();
  useEditor.getState().updateDoc((doc) => { doc.siteName = "Unrelated title"; doc.nodes.result.styles.base.color = "red"; });
  m.render().setFieldValues({ q: "not submitted" });
  await m.finish(0, previewRows("valid", 33));
  assert.equal(m.requests.length, 1);
  assert.equal(m.render().pageVars.response.label, "valid");
  assert.equal(m.render().pageVars.response.rows.length, 20);
  assert.equal(m.render().pageVars.total, 33);
  m.unmount();
});

test("unmount prevents late result and loading-state writes", async () => {
  const m = mount();
  m.unmount();
  const writes = m.writes();
  await m.finish(0, previewRows("late"));
  assert.equal(m.writes(), writes);
});

test("parallel fetch blocks settle as one refresh and retain independent fallback data", async () => {
  const m = mount("design");
  useEditor.getState().updateDoc((doc) => { doc.pages.home.pageScripts![0].steps.push({ id: "auxiliary", kind: "fetch", url: "https://example.test/aux", as: "aux", preview: { sample: { label: "aux sample" } } }); });
  void m.render().refreshData();
  await m.finish(0, previewRows("main", 40));
  assert.equal(m.render().refreshing, true);
  assert.equal(m.render().pageVars.response.label, "home saved", "wait for this refresh's other blocks");
  await m.fail(1);
  assert.equal(m.render().refreshing, false);
  assert.equal(m.render().pageVars.response.label, "main");
  assert.equal(m.render().pageVars.aux.label, "aux sample");
  m.unmount();
});

test("a successful obsolete request cannot replace the newest request's failure fallback", async () => {
  const m = mount();
  void m.render().refreshData();
  await m.fail(1);
  assert.equal(m.render().refreshing, false);
  await m.finish(0, previewRows("obsolete success", 45));
  assert.equal(m.render().pageVars.response.label, "home saved");
  assert.equal(m.render().pageVars.total, 1);
  void m.render().refreshData();
  await m.finish(2, previewRows("retry", 32));
  assert.equal(m.render().pageVars.response.label, "retry");
  m.unmount();
});

// 件数の補正は、切り詰めた見本と同じ取得の結果にだけ適用する。
for (const length of [0, 1, 2, 20, 21, 50]) {
  test(`a successful ${length}-row response replaces the previous sample total`, async () => {
    const m = mount();
    await m.finish(0, previewRows("large", 35));
    void m.render().refreshData();
    await m.finish(1, previewRows("latest", length));
    assert.equal(m.render().pageVars.response.rows.length, length, "preview uses the full response");
    assert.equal(m.render().pageVars.total, length);
    m.mode("design");
    assert.equal(m.render().pageVars.response.rows.length, Math.min(length, 20));
    assert.equal(m.render().pageVars.total, length, "design uses the latest response's total");
    m.unmount();
  });
}

test("design refreshes replace nested and aliased totals, including removed or changed array paths", async () => {
  const doc = previewRefreshDoc();
  doc.pages.home.pageScripts![0].steps.push(
    { id: "nested-alias", kind: "set-var", value: "{response.nested}", into: "nested" },
    { id: "nested-count", kind: "transform", source: "nested.rows", into: "nestedTotal", transform: { kind: "length" } },
  );
  const m = mount("design", doc);
  const responses = [
    { rows: previewRows("a", 35).rows, nested: { rows: previewRows("a", 43).rows } },
    { rows: previewRows("b", 2).rows, nested: { rows: [] } },
    { rows: previewRows("c", 22).rows, nested: { rows: previewRows("c", 31).rows } },
    { rows: [], nested: { rows: previewRows("d", 24).rows } },
    { rows: "not an array", nested: { replacement: [1, 2] } },
    { rows: [1], nested: { rows: [1, 2, 3] } },
  ];
  for (const [index, response] of responses.entries()) {
    void m.render().refreshData();
    await m.finish(index, response);
    assert.equal(m.render().pageVars.total, Array.isArray(response.rows) ? response.rows.length : undefined);
    assert.equal(m.render().pageVars.nestedTotal, response.nested.rows?.length);
  }
  m.unmount();
});

test("a root array response clears its previous root sample total", async () => {
  const doc = previewRefreshDoc();
  const count = doc.pages.home.pageScripts![0].steps.find((step) => step.id === "home-count")!;
  if (count.kind === "transform") count.source = "response";
  const m = mount("design", doc);
  for (const [index, length] of [32, 3, 0, 23].entries()) {
    void m.render().refreshData();
    await m.finish(index, Array.from({ length }, (_, id) => ({ id })));
    assert.equal(m.render().pageVars.total, length);
    assert.equal(m.render().pageVars.response.length, Math.min(length, 20));
  }
  m.unmount();
});

test("successful blocks clear only their own totals while failed blocks retain live or saved fallbacks", async () => {
  const doc = previewRefreshDoc();
  const main = doc.pages.home.pageScripts![0].steps[0];
  if (main.kind === "fetch") {
    const made = makeSample(previewRows("saved main", 61));
    main.preview = { sample: made.sample, totals: made.totals };
  }
  const savedAux = makeSample(previewRows("saved aux", 67));
  doc.pages.home.pageScripts![0].steps.push(
    { id: "auxiliary", kind: "fetch", url: "https://example.test/aux", as: "aux", preview: { sample: savedAux.sample, totals: savedAux.totals } },
    { id: "aux-count", kind: "transform", source: "aux.rows", into: "auxTotal", transform: { kind: "length" } },
  );
  const m = mount("design", doc);
  void m.render().refreshData();
  await m.fail(0); await m.finish(1, null, 502);
  assert.equal(m.render().pageVars.total, 61, "initial failure retains saved sample totals");
  assert.equal(m.render().pageVars.auxTotal, 67);
  void m.render().refreshData();
  await m.finish(2, previewRows("main", 35)); await m.finish(3, previewRows("aux", 41));
  void m.render().refreshData();
  await m.finish(4, previewRows("small main", 2)); await m.fail(5);
  assert.equal(m.render().pageVars.total, 2);
  assert.equal(m.render().pageVars.auxTotal, 41, "unrelated network failure retains its live total");
  void m.render().refreshData();
  await m.finish(6, null, 502); await m.finish(7, previewRows("empty aux", 0));
  assert.equal(m.render().pageVars.total, 2, "HTTP failure retains the last successful small response");
  assert.equal(m.render().pageVars.auxTotal, 0);
  assert.equal(m.render().pageVars.response.label, "small main");
  assert.equal(m.render().pageVars.aux.label, "empty aux");
  m.unmount();
});


test("replacing a preview refresh aborts all requests in the old batch", async () => {
  const doc = previewRefreshDoc();
  doc.pages.home.pageScripts![0].steps.push({ id: "aux", kind: "fetch", url: "https://example.test/aux" });
  const m = mount("preview", doc);
  assert.equal(m.requests.length, 2);
  void m.render().refreshData();
  assert.equal(m.requests.length, 4);
  assert.equal(m.requests[0].signal?.aborted, true);
  assert.equal(m.requests[1].signal?.aborted, true);
  assert.equal(m.requests[2].signal?.aborted, false);
  assert.equal(m.requests[3].signal?.aborted, false);
  m.unmount();
});

for (const interruption of ["mode", "page", "unmount"] as const) {
  test(`${interruption} aborts preview requests before they download abandoned data`, () => {
    const m = mount();
    if (interruption === "mode") m.mode("design");
    else if (interruption === "page") m.page("other");
    else m.unmount();
    assert.equal(m.requests[0].signal?.aborted, true);
    if (interruption === "page") assert.equal(m.requests[1].signal?.aborted, false);
    if (interruption !== "unmount") m.unmount();
  });
}

test("the first refresh on another page uses its own field defaults", async () => {
  const doc = previewRefreshDoc();
  doc.nodes["other-query"] = { ...structuredClone(doc.nodes.query), id: "other-query", field: { kind: "input", defaultValue: "other default" } };
  doc.pages.other.children.push("other-query");
  const m = mount("preview", doc);
  m.render().setFieldValues({ q: "home private input" });
  m.page("other");
  assert.equal(new URL(m.requests[1].input.url).searchParams.get("q"), "other default");
  assert.equal(m.render().pageVars.q, "other default");
  m.render().setFieldValues({ q: "other private input" });
  m.page("home");
  assert.equal(new URL(m.requests[2].input.url).searchParams.get("q"), "initial");
  m.unmount();
});


test("a late field callback from the old page cannot overwrite the current page", () => {
  const m = mount();
  const old = m.render();
  m.page("other");
  m.render().setFieldValues({ q: "current" });
  old.setFieldValues({ q: "stale" });
  assert.equal(m.render().pageVars.q, "current");
  m.unmount();
});

test("an obsolete response is skipped before JSON parsing", async () => {
  const m = mount();
  void m.render().refreshData();
  let parsed = false;
  const response = new Response("{}");
  response.json = async () => { parsed = true; return { json: previewRows("stale") }; };
  m.requests[0].finish(response);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(parsed, false);
  assert.equal(m.render().refreshing, true);
  m.unmount();
});

test("preview variable copies follow same-page script edits and Undo", () => {
  const m = mount("design");
  try {
    assert.equal(m.render().pageVars.copied, undefined);
    const state = useEditor.getState();
    state.updateNode("result", { scripts: [{
      id: "click-copy", trigger: "click",      steps: [{ id: "copy", kind: "set-var", value: "{response.label}", into: "copied" }],
    }] });
    assert.equal(m.render().pageVars.copied, "home saved");
    state.undo();
    assert.equal(m.render().pageVars.copied, undefined);
  } finally {
    m.unmount();
  }
});

test("preview copies resolve nested destinations and backward references without retrying forever", () => {
  const doc = previewRefreshDoc();
  const copies = [
    ["result", "nested.value"],
    ["nested.value", "later"],
    ["later", "response.label"],
    ["nested.value", "response.rows"],
    ["response.rows.5", "response.label"],
    ["response.label", "response.rows"],
    ["__proto__", "response.label"],
    ["constructor", "response.rows"],
    ["missing", "otherMissing"],
    ["otherMissing", "missing"],
  ];
  doc.nodes.result.scripts = [{
    id: "copies", trigger: "click",    steps: copies.map(([into, src], i) => ({ id: String(i), kind: "set-var", into, value: `{${src}}` })),
  }];
  // 同期ループが再発してもテストプロセス全体を停止させない。
  const vars = runInNewContext('previewDataVars(doc, "home")', { previewDataVars, doc }, { timeout: 2000 });
  assert.deepEqual(vars.nested.value, [{ id: "saved" }], "first available source wins");
  assert.deepEqual(vars.result, vars.nested.value, "earlier steps see later destinations");
  assert.equal(vars.response.label, "home saved", "keep existing nested values");
  assert.deepEqual(vars.response.rows, [{ id: "saved" }], "invalid array writes stay unapplied");
  assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  assert.ok(Object.hasOwn(vars, "__proto__") && Object.hasOwn(vars, "constructor"));
  assert.equal(vars.__proto__, "home saved");
  assert.deepEqual(vars.constructor, [{ id: "saved" }]);
  assert.ok(!Object.hasOwn(vars, "missing") && !Object.hasOwn(vars, "otherMissing"));
});
});

describe("query-variant-conditions", () => {
describe("query-variant-conditions", () => {
  const require = createRequire(import.meta.url);
  const navigation = previewNavigationFixture();

  function generatedRoute(files: Record<string, string>) {
    const cache = new Map<string, any>();
    function load(path: string): any {
      if (cache.has(path)) return cache.get(path);
      const module = { exports: {} as any };
      const code = transformSync(files[path], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
      new Function("require", "module", "exports", code)(
        (name: string) => name.startsWith(".")
          ? load(posix.normalize(`${dirname(path)}/${name}.tsx`))
          : require(name), module, module.exports,
      );
      cache.set(path, module.exports);
      return module.exports;
    }
    const route = load("app/results/page.tsx");
    return async (url: string) => {
      const params = new URL(url, "https://query.test").searchParams;
      const searchParams = Object.fromEntries([...new Set(params.keys())].map((key) => {
        const values = params.getAll(key);
        return [key, values.length === 1 ? values[0] : values];
      }));
      const props = { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
      return {
        html: renderToStaticMarkup(await route.default(props)),
        metadata: await route.generateMetadata(props),
      };
    };
  }

  for (const [query, first, reversed] of [
    ["category=books&category=music", "category=books", "category=music&category=books"],
    ["category=books&category=books", "category=books", "category=music&category=books"],
    ["q=hello+world&q=later", "q=hello%20world", "q=later&q=hello+world"],
    ["%71=hello%20world&q=later", "q=hello+world", "q=later&%71=hello%20world"],
    ["q=%26%3D%2B&q=other", "q=%26%3D%2B", "q=other&q=%26%3D%2B"],
    ["q=&q=later", "q=", "q=later&q="],
    ["flag&flag=later", "flag=", "flag=later&flag"],
    ["%E7%A8%AE%E9%A1%9E=%E6%9C%AC&種類=音楽", "種類=本", "種類=音楽&種類=本"],
  ] as const) {
    test(`ordinary page links preserve ${query} and select their page, metadata and preview`, async () => {
      const doc = previewQueryDoc("results", ["", query]);
      const selected = doc.pages.variant1;
      selected.description = "Selected page description";
      const link = { ...makeText("Open selected results"), id: "selected-link", link: { kind: "page" as const, pageId: selected.id } };
      doc.nodes[link.id] = link;
      doc.pages.home.children.push(link.id);
      const original = structuredClone(doc);
      assert.deepEqual(runChecks(doc).filter((c) => c.level === "error"), []);
      const { files } = generateProject(doc);
      const href = pageHrefOf(selected);
      assert.equal(href, `/results?${query}`);
      assert.ok(files["app/page.tsx"].includes(`href="${href.replaceAll("&", "&amp;")}"`));
      const visit = generatedRoute(files);
      const navigate = await navigation;
      for (const url of [href, `/results?${first}`, `${href}&extra=ignored#section`]) {
        const actual = await visit(url);
        assert.match(actual.html, /Page variant1/);
        assert.doesNotMatch(actual.html, /Page variant0/);
        assert.equal(actual.metadata.title, "variant1");
        assert.equal(actual.metadata.description, selected.description);
        assert.equal(navigate(doc, url), selected.id);
      }
      for (const url of [`/results?${reversed}`, "/results"]) {
        const actual = await visit(url);
        assert.match(actual.html, /Page variant0/);
        assert.equal(actual.metadata.title, "variant0");
        assert.equal(navigate(doc, url), "variant0");
      }
      assert.deepEqual(doc, original, "routing must not rewrite saved query strings");
    });
  }

  for (const [left, right] of [
    ["category=books", "category=books&category=books"],
    ["category=books", "category=books&category=music"],
    ["category=books&lang=ja", "lang=ja&category=books&category=music"],
    ["q=hello+world", "%71=hello%20world&q=other"],
    ["q=", "q&q=later"],
    ["", "=ignored"],
    ["q=first", "=ignored&q=first&q=last"],
  ]) {
    test(`publish checks reject equivalent routing conditions: ${left} and ${right}`, () => {
      const doc = previewQueryDoc("results", [left, right]);
      const errors = runChecks(doc).filter((c) => c.level === "error");
      assert.equal(errors.length, 1);
      assert.equal(errors[0].help, "page-url");
    });
  }

  test("different first values remain distinct, and repeated keys do not increase specificity", async () => {
    const doc = previewQueryDoc("results", ["", "q=first&q=last", "q=last&q=first", "q=first&lang=ja"]);
    assert.deepEqual(runChecks(doc).filter((c) => c.level === "error"), []);
    const navigate = await navigation;
    const visit = generatedRoute(generateProject(doc).files);
    for (const [url, expected] of [
      ["/results?q=first&q=last", "variant1"],
      ["/results?q=last&q=first", "variant2"],
      ["/results?q=first&q=last&lang=ja", "variant3"],
      ["/results?q=missing", "variant0"],
    ]) {
      assert.equal((await visit(url)).metadata.title, expected);
      assert.equal(navigate(doc, url), expected);
    }
  });

  test("first-page fallback and declaration-order ties are retained", async () => {
    const doc = previewQueryDoc("results", ["q=first&q=last", "q=other", "lang=ja"]);
    const navigate = await navigation;
    const visit = generatedRoute(generateProject(doc).files);
    for (const [url, expected] of [
      ["/results?q=missing", "variant0"],
      ["/results?q=other&lang=ja", "variant1"],
      ["/results?q=last&lang=ja", "variant2"],
    ]) {
      assert.equal((await visit(url)).metadata.title, expected);
      assert.equal(navigate(doc, url), expected);
    }
  });

  test("route selection does not change existing script/data query-variable semantics", () => {
    assert.deepEqual(pageQueryVars("q=first&q=last"), { q: "last" });
  });

  test("condition names are values, including object prototype property names", async () => {
    const doc = previewQueryDoc("results", ["", "__proto__=first&__proto__=last", "constructor=first&constructor=last"]);
    const navigate = await navigation;
    for (const [url, expected] of [
      ["/results?__proto__=first", "variant1"],
      ["/results?__proto__=last", "variant0"],
      ["/results?constructor=first", "variant2"],
    ]) {
      // Next.js と同じく、クエリを自身のプロパティにする（Object.prototype を通して代入しない）。
      assert.equal((await generatedRoute(generateProject(doc).files)(url)).metadata.title, expected);
      assert.equal(navigate(doc, url), expected);
    }
  });
});

describe("query-variant-nomodule", () => {
  // モジュールに対応したブラウザは、classic script の nomodule のスクリプトを、load や error を発生させずに無視する。
  // ルーターは、ブラウザが決して発生させないイベントを待ってはならない。
  async function bootstrap(moduleCapable: boolean, type = "") {
    const inserted: string[] = [];
    const attributes = [{ name: "nomodule", value: "" }, { name: "src", value: "/legacy.js" }, { name: "type", value: type }];
    const old = {
      attributes, textContent: "",
      ...(moduleCapable ? { noModule: true } : {}),
      getAttribute: (name: string) => attributes.find(a => a.name === name)?.value ?? null,
      hasAttribute: (name: string) => attributes.some(a => a.name === name),
      replaceWith(script: any) {
        inserted.push("authored");
        if (!moduleCapable || type === "module") queueMicrotask(() => script.onload?.());
      },
    };
    const document = {
      currentScript: { getAttribute: () => JSON.stringify(["/data-loader.js", "/scripts.js"]) },
      documentElement: {},
      querySelector: (selector: string) => selector === "[data-variant-root]"
        ? { innerHTML: "", querySelectorAll: () => [old] }
        : selector === "script[data-page-variants]"
          ? { textContent: JSON.stringify([{ query: {}, html: "" }]) } : null,
      createElement: () => ({ text: "", src: "", setAttribute() {} }),
      body: { appendChild(script: any) { inserted.push(script.src); queueMicrotask(() => script.onload?.()); } },
    };
    new Function("document", "location", "URLSearchParams", QUERY_VARIANT_RUNTIME)(document, { search: "" }, URLSearchParams);
    await new Promise<void>(resolve => setImmediate(resolve));
    return inserted;
  }

  test("query variants do not wait for ignored classic nomodule scripts", async () => {
    assert.deepEqual(await bootstrap(true), ["/data-loader.js", "/scripts.js"]);
  });

  test("nomodule scripts still run when the browser does not support modules", async () => {
    assert.deepEqual(await bootstrap(false), ["authored", "/data-loader.js", "/scripts.js"]);
  });

  test("the nomodule attribute does not suppress module scripts", async () => {
    assert.deepEqual(await bootstrap(true, "module"), ["authored", "/data-loader.js", "/scripts.js"]);
  });

  test("the nomodule attribute does not suppress import maps", async () => {
    assert.deepEqual(await bootstrap(true, "importmap"), ["authored", "/data-loader.js", "/scripts.js"]);
  });
});

describe("query-variant-script-types", () => {
  // HTML Standard の script の type は、MIME の解析ではなく、本質の部分の *一致* で判定する。
  // text/javascript;charset=utf-8 のようにパラメーターの付いたものは、実行されないデータのブロックになる。
  // https://html.spec.whatwg.org/multipage/scripting.html#attr-script-type
  async function bootstrap(type:string | null, browserExecutes:boolean, language?:string) {
    const inserted:string[]=[];
    const attrs=[...(type === null ? [] : [{name:'type',value:type}]), {name:'src',value:'/authored.js'}, ...(language === undefined ? [] : [{name:'language',value:language}])];
    const old={attributes:attrs,textContent:'',
      getAttribute:(name:string)=>attrs.find(a=>a.name===name)?.value??null,
      hasAttribute:(name:string)=>attrs.some(a=>a.name===name),
      replaceWith(script:any){inserted.push('authored');if(browserExecutes)queueMicrotask(()=>script.onload?.());},
    };
    const document={
      currentScript:{getAttribute:()=>JSON.stringify(['/data-loader.js','/scripts.js'])},documentElement:{},
      querySelector:(sel:string)=>sel==='[data-variant-root]'?{innerHTML:'',querySelectorAll:()=>[old]}:
        sel==='script[data-page-variants]'?{textContent:JSON.stringify([{query:{},html:''}])}:null,
      createElement:()=>({text:'',src:'',setAttribute(){}}),
      body:{appendChild(script:any){inserted.push(script.src);queueMicrotask(()=>script.onload?.());}},
    };
    new Function('document','location','URLSearchParams',QUERY_VARIANT_RUNTIME)(document,{search:''},URLSearchParams);
    await new Promise<void>(resolve=>setImmediate(resolve));
    return inserted;
  }
  for(const type of ['text/javascript; charset=utf-8','application/javascript; charset=utf-8','application/ecmascript;version=1','text/javascript ;','application/json','application/ld+json'])
    test(`inert script type does not stall variant startup: ${type}`,async()=>{
      assert.deepEqual(await bootstrap(type,false),['/data-loader.js','/scripts.js']);
    });
  for(const type of ['text/javascript','application/javascript','text/ecmascript','application/ecmascript',
    'application/x-javascript','application/x-ecmascript','text/x-javascript','text/x-ecmascript',
    'text/javascript1.0','text/javascript1.1','text/javascript1.2','text/javascript1.3','text/javascript1.4','text/javascript1.5',
    'text/jscript','text/livescript','TEXT/JAVASCRIPT'])
    test(`browser-supported classic script type is replayed: ${type}`,async()=>{
      assert.deepEqual(await bootstrap(type,true),['authored','/data-loader.js','/scripts.js']);
    });

  for (const language of ['vbscript', 'python', 'javascript1.6', 'module', 'importmap'])
    test(`unsupported legacy language does not stall startup: ${language}`, async () => {
      assert.deepEqual(await bootstrap(null, false, language), ['/data-loader.js', '/scripts.js']);
    });
  for (const language of ['javascript', 'JavaScript1.2', 'jscript', 'livescript', ''])
    test(`supported legacy language is replayed: ${language}`, async () => {
      assert.deepEqual(await bootstrap(null, true, language), ['authored', '/data-loader.js', '/scripts.js']);
    });
  test('explicit empty type overrides an unsupported legacy language', async () => {
    assert.deepEqual(await bootstrap('', true, 'vbscript'), ['authored', '/data-loader.js', '/scripts.js']);
  });

  for (const type of [' ', '\t', ' module ', ' importmap ', '\u00a0text/javascript\u00a0'])
    test(`non-executable whitespace type does not stall startup: ${JSON.stringify(type)}`, async () => {
      assert.deepEqual(await bootstrap(type, false), ['/data-loader.js', '/scripts.js']);
    });
  for (const language of ['javascript ', ' javascript', 'javascript\t'])
    test(`language does not inherit type attribute whitespace trimming: ${JSON.stringify(language)}`, async () => {
      assert.deepEqual(await bootstrap(null, false, language), ['/data-loader.js', '/scripts.js']);
    });
  test('classic type attributes accept ASCII whitespace only', async () => {
    assert.deepEqual(await bootstrap(' \ttext/javascript\n', true), ['authored', '/data-loader.js', '/scripts.js']);
  });
});
});
