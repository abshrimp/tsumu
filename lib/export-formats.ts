import type { SiteDoc } from "./types";
import { pagePlan } from "./data";
import { generateProject, type GeneratedProject, type PublishTarget } from "./generator";
import { buildReactProject } from "./generator/react-export";
import { generateStandaloneHtml } from "./generator/html-export";
import { buildAdditionalFramework } from "./generator/framework-export";
import { toSingleHtmlProject } from "./generator/single-html";
import { applyExportStyle } from "./generator/style-export";
import { zipAssetClosure } from "./zip-css";
import { scopedAssetIds } from "./generator/scoped-assets";
import { assertGeneratedPaths } from "./generator/output-paths";
import { hasPublishCredentials } from "./publish-security";
import { tr } from "./i18n";

export type ExportFormat = "nextjs" | "react" | "html" | "single-html" | "vue" | "nuxt" | "sveltekit";
export const EXPORT_FRAMEWORK_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "nextjs", label: "Next.js" },
  { value: "react", label: "React + Vite" },
  { value: "vue", label: "Vue 3 + Vite" },
  { value: "nuxt", label: "Nuxt" },
  { value: "sveltekit", label: "SvelteKit" },
  { value: "html", label: "HTML / CSS / JavaScript" },
  { value: "single-html", label: "単一のHTML" },
];

export type ExportLanguage = "typescript" | "javascript";
export type ExportStyle = "css" | "css-modules" | "tailwind";
export type ExportScope = "project" | "page" | "component";

export interface ExportOptions {
  framework: ExportFormat;
  language: ExportLanguage;
  style: ExportStyle;
  scope: ExportScope;
  pageId?: string;
  nodeId?: string;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  framework: "nextjs",
  language: "typescript",
  style: "css",
  scope: "project",
};

function optionsOf(options: ExportFormat | ExportOptions): ExportOptions {
  return typeof options === "string"
    ? { ...DEFAULT_EXPORT_OPTIONS, framework: options }
    : options;
}

/**
 * Partial exports must not contain other pages' editable nodes or unrelated
 * assets. Reusing the complete SiteDoc in an exported ZIP exposes unpublished
 * content and uploaded media even though the generated code has one page.
 */
function prunePartialDoc(doc: SiteDoc): SiteDoc {
  const nodes: SiteDoc["nodes"] = Object.create(null);
  const components: NonNullable<SiteDoc["components"]> = Object.create(null);
  const visiting = new Set<string>();
  const collectNode = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    const node = Object.prototype.hasOwnProperty.call(doc.nodes, id) ? doc.nodes[id] : undefined;
    if (!node) return;
    nodes[id] = node;
    for (const child of node.children ?? []) collectNode(child);
    if (node.componentId) {
      const component = doc.components && Object.prototype.hasOwnProperty.call(doc.components, node.componentId)
        ? doc.components[node.componentId] : undefined;
      if (component && !components[component.id]) {
        components[component.id] = component;
        collectNode(component.rootId);
      }
    }
  };
  for (const page of Object.values(doc.pages)) {
    for (const id of page.children ?? []) collectNode(id);
  }
  const scoped: SiteDoc = {
    ...doc, nodes, components,
    assets: {},
    pageFolders: doc.pageFolders?.filter((folder) =>
      Object.values(doc.pages).some((page) => page.folderId === folder.id)),
  };
  const assetIds = scopedAssetIds(scoped, doc.assets);
  const assets: SiteDoc["assets"] = Object.create(null);
  for (const id of zipAssetClosure(doc.assets, assetIds)) assets[id] = doc.assets[id];
  return { ...scoped, assets };
}

/** A selected node must actually be reachable from the selected page.
 * Checking only that its ID exists can export content from an unrelated or
 * unpublished page when the selection is stale (or supplied programmatically).
 * Component instances are traversed because their masters are valid selections.
 */
function pageContainsNode(doc: SiteDoc, page: SiteDoc["pages"][string], target: string): boolean {
  const pending = [...(page.children ?? [])];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = Object.prototype.hasOwnProperty.call(doc.nodes, id) ? doc.nodes[id] : undefined;
    if (!node) continue;
    if (id === target) return true;
    pending.push(...(node.children ?? []));
    const component = node.componentId && doc.components &&
      Object.prototype.hasOwnProperty.call(doc.components, node.componentId)
      ? doc.components[node.componentId] : undefined;
    if (component) pending.push(component.rootId);
  }
  return false;
}

/** Export a page or selection without editing the source site. */
export function exportScopeDoc(doc: SiteDoc, options: ExportOptions): SiteDoc {
  if (options.scope === "project") return doc;
  const page = options.pageId && Object.prototype.hasOwnProperty.call(doc.pages, options.pageId)
    ? doc.pages[options.pageId] : undefined;
  if (!page) throw new Error(tr("書き出すページを選択してください。"));
  if (options.scope === "page") {
    // An explicitly selected page can be exported even when it is excluded
    // from whole-project publication. Otherwise the ZIP contains no page
    // markup despite having a valid selected page.
    return prunePartialDoc({ ...doc, pages: { [page.id]: { ...page, unpublished: false } },
      pageOrder: [page.id] });
  }
  const node = options.nodeId && Object.prototype.hasOwnProperty.call(doc.nodes, options.nodeId)
    ? doc.nodes[options.nodeId] : undefined;
  if (!node || !pageContainsNode(doc, page, node.id)) {
    throw new Error(tr("書き出すコンポーネントを選択してください。"));
  }
  let id = "__export_component__";
  while (doc.pages[id]) id += "_";
  const scopedPage = {
    ...page,
    id,
    name: node.name || "Component",
    title: node.name || "Component",
    slug: "",
    description: "",
    query: undefined,
    unpublished: false,
    rawHtml: undefined,
    redirectTo: undefined,
    rewriteTo: undefined,
    customTopHtml: undefined,
    customEndHtml: undefined,
    pageScripts: undefined,
    children: [node.id],
  };
  return prunePartialDoc({ ...doc, pages: { [id]: scopedPage }, pageOrder: [id] });
}

/**
 * A component marked async solely for Next.js ISR/variable handling can be
 * rendered synchronously if it never awaits request data.
 */
export function needsServerRuntime(source: string): boolean {
  return /\bawait\b/.test(source) || /\bfetchPublic\b/.test(source);
}

function publishedPages(doc: SiteDoc) {
  return doc.pageOrder.map((id) => doc.pages[id]).filter((page) => page && !page.unpublished);
}

/** Return concise unsupported feature names; the UI shows one shared explanation. */
export function exportLimitations(
  doc: SiteDoc,
  request: ExportFormat | ExportOptions,
  _existing?: GeneratedProject,
): string[] {
  const options = optionsOf(request);
  try {
    doc = exportScopeDoc(doc, options);
  } catch (e) {
    return [(e as Error).message];
  }
  if (options.framework === "nextjs") {
    // Route handlers for imported HTML cannot share a Next.js path with
    // page.tsx. Multiple imported HTML pages also overwrite one another's
    // route.ts silently; query parameters do not distinguish build routes.
    const routeKinds = new Map<string, { imported: number; regular: number }>();
    for (const page of publishedPages(doc)) {
      if (page.redirectTo !== undefined || page.rewriteTo !== undefined) continue;
      const slug = page.slug.replace(/^\/+|\/+$/g, "");
      const existing = routeKinds.get(slug) ?? { imported: 0, regular: 0 };
      if (page.rawHtml?.trim()) existing.imported++;
      else if (slug !== "404") existing.regular++;
      routeKinds.set(slug, existing);
    }
    if ([...routeKinds.values()].some(({ imported, regular }) =>
      imported > 1 || (imported > 0 && regular > 0))) {
      return [tr("同じパスに取り込んだHTMLページと通常ページ、または複数の取り込んだHTMLページがあります。Next.jsでは同じルートに両方を書き出せません。ページのURLを分けてください。")];
    }
    return [];
  }
  const pages = publishedPages(doc);
  const reasons: string[] = [];
  const add = (bad: boolean, message: string) => {
    if (bad) reasons.push(tr(message));
  };
  add(pages.some((p) => /\[[^\]]+\]/.test(p.slug)),
    "動的パス（[slug]など）は、静的ホスティングで任意のURLへ直接アクセスできる設定が必要です。固定パスに変更するか、Next.js形式を選択してください。");
  add(pages.some((p) => p.rewriteTo !== undefined || p.redirectTo !== undefined),
    "リダイレクトとリバースプロキシにはサーバーの処理が必要です。転送先への通常のリンクに変更するか、Next.js形式を選択してください。");
  if (!["html", "single-html"].includes(options.framework)) {
    add(pages.some((p) => !!p.rawHtml?.trim()),
      "取り込んだHTMLページをReactコンポーネントへ安全に変換できません。HTML形式なら元のHTMLをそのまま出力できます。");
  }
  if (["html", "single-html"].includes(options.framework)) {
    // A query variant cannot share its output with an imported HTML document,
    // because imported documents are opaque and may contain arbitrary scripts.
    const grouped = new Map<string, typeof pages>();
    for (const page of pages) {
      const key = page.slug.replace(/^\/+|\/+$/g, "");
      grouped.set(key, [...(grouped.get(key) ?? []), page]);
    }
    add([...grouped.values()].some((group) =>
      group.length > 1 && group.some((page) => !!page.rawHtml?.trim())),
      "同じパスに取り込んだHTMLページとクエリ別ページが混在しています。通常ページに変更するか、別の固定URLに分けてください。");
  }
  if (options.framework === "single-html") {
    add(pages.length !== 1,
      "単一HTMLは1ページだけを書き出せます。複数ページがある場合は出力範囲を「現在のページ」に変更するか、HTML ZIP形式を選択してください。");
  }
  // Browser-facing source and ZIP exports must share the same credential
  // scanner as GitHub Push. The earlier regex missed percent-encoded query
  // names, nested JSON credentials, and URL-encoded form bodies.
  // Next.js is handled separately because existing server-side authenticated
  // fetching needs an explicit environment-variable migration design.
  // Metadata service headers were blocked by the previous export-specific
  // rule and must remain denied even though they are not typical user secrets.
  const metadataHeaders = pages.some((page) => pagePlan(doc, page.id).steps.some(
    (step) => step.kind === "fetch" && (step.headers ?? []).some((header) =>
      /^(?:metadata-flavor|x-metadata-token)$/i.test(header.name.trim()))
  ));
  add(hasPublishCredentials(doc) || metadataHeaders,
    "データ取得に認証用ヘッダーや秘密のAPIキーが含まれています。ブラウザ向けコードに書き出すと第三者にも見えるため、公開APIに変更するかサーバー側で安全に中継してください。");

  if (["react", "vue", "nuxt", "sveltekit"].includes(options.framework)) {
    add(!!doc.customBodyEndHtml?.match(/<script\b/i),
      "body末尾のカスタムスクリプトは、画面更新時に実行タイミングが異なります。HTML形式で書き出すか、利用するフレームワーク用の処理へ移行してください。");
  }
  if (["vue", "nuxt", "sveltekit"].includes(options.framework)) {
    // Native components currently render page nodes only. Dropping authored
    // custom <head>, footer, or per-page markup would silently alter the site.
    add(!!doc.customHeadHtml?.trim() || !!doc.customBodyEndHtml?.trim() ||
      pages.some((page) => !!page.customTopHtml?.trim() || !!page.customEndHtml?.trim()),
      "カスタムHTMLはこのフレームワーク形式の生成結果に含まれません。Next.js形式またはHTML形式を選択してください。");
  }
  if (options.framework === "react") {
    // Data-driven React pages use dangerouslySetInnerHTML for their DOM
    // runtime. Scripts inserted this way do not execute in browsers.
    add(pages.some((page) => {
      const plan = pagePlan(doc, page.id);
      const needsClientRuntime = plan.steps.length > 0 || plan.listOps.size > 0 ||
        plan.clientVars.size > 0;
      return needsClientRuntime &&
        /<script\b(?![^>]*\btype\s*=\s*["']?application\/(?:ld\+)?json)/i
          .test((page.customTopHtml ?? "") + (page.customEndHtml ?? ""));
    }), "動的データを使うページのカスタムスクリプトはReact形式では実行されません。Next.js形式またはHTML形式を選択してください。");
  }
  if (["html", "single-html"].includes(options.framework)) {
    add(options.style === "css-modules",
      "CSS Modulesはモジュールを読み込むビルド工程が必要です。ビルド不要のHTML形式ではCSSを選択してください。");
    add(options.style === "tailwind",
      "Tailwind CSSのユーティリティ生成にはビルド工程が必要です。ビルド不要のHTML形式ではCSSを選択してください。");
  }
  return reasons;
}

/** Synchronous generator for tests and normal TS/CSS code output. */
export function generateExportProject(
  doc: SiteDoc,
  request: ExportFormat | ExportOptions = "nextjs",
  target: PublishTarget = "production",
): GeneratedProject {
  const options = optionsOf(request);
  const scoped = exportScopeDoc(doc, options);
  const next = generateProject(scoped, target);
  const limitations = exportLimitations(scoped, { ...options, scope: "project" }, next);
  if (limitations.length) {
    throw new Error(tr("選択した形式では次の機能を利用できません。") + "\n" + limitations.join("\n"));
  }
  const generated = options.framework === "react"
    ? buildReactProject(scoped, next)
    : (options.framework === "html" || options.framework === "single-html")
      ? generateStandaloneHtml(scoped, next)
      : (options.framework === "vue" || options.framework === "nuxt" || options.framework === "sveltekit")
        ? buildAdditionalFramework(scoped, next, options.framework, options.language)
        : next;
  const styled = options.style === "css" ? generated
    : applyExportStyle(generated, options.framework, options.style);
  assertGeneratedPaths(styled);
  return styled;
}

/** Preserve only the ZIP dependencies reachable from the selected page or component. */
export async function prepareExportScopeDoc(doc: SiteDoc, options: ExportOptions): Promise<SiteDoc> {
  const scoped = exportScopeDoc(doc, options);
  if (scoped !== doc && Object.keys(scoped.assets).length) {
    const { retainImportedDependencies } = await import("./generator/imported-dependencies");
    await retainImportedDependencies(scoped, doc.assets);
  }
  return scoped;
}

/**
 * Common ZIP / GitHub Push pipeline: identical output files for both actions.
 * The preview branch retains non-indexing protections even without Next.js.
 */
export async function prepareExportProject(
  doc: SiteDoc,
  request: ExportFormat | ExportOptions = "nextjs",
  target: PublishTarget = "production",
): Promise<GeneratedProject> {
  const options = optionsOf(request);
  const scoped = await prepareExportScopeDoc(doc, options);
  let project = generateExportProject(scoped, { ...options, scope: "project" }, target);
  if (["nextjs", "react"].includes(options.framework) && options.language === "javascript") {
    const { toJavaScriptProject } = await import("./generator/javascript-export");
    project = await toJavaScriptProject(project, options.framework);
  }
  if (target === "test" && options.framework !== "nextjs") {
    const files = { ...project.files };
    const robots = "noindex, nofollow, noarchive, nosnippet, noimageindex";
    const robotsMeta = '<meta name="robots" content="' + robots + '">';
    const htmlFiles = options.framework === "html" || options.framework === "single-html"
      ? Object.keys(files).filter((path) => /\.html?$/i.test(path))
      : ["index.html", "src/app.html"];
    for (const path of htmlFiles) {
      if (!files[path]) continue;
      if (/<head(?:\s[^>]*)?>/i.test(files[path])) {
        files[path] = files[path].replace(/<head(?:\s[^>]*)?>/i, (head) => head + "\n" + robotsMeta);
      } else files[path] = robotsMeta + "\n" + files[path];
    }
    const assetRoot = options.framework === "html" || options.framework === "single-html" ? ""
      : options.framework === "sveltekit" ? "static/" : "public/";
    if (options.framework !== "single-html") {
      files[assetRoot + "robots.txt"] = "User-agent: *\nDisallow: /\n";
      files[assetRoot + "_headers"] = "/*\n  X-Robots-Tag: " + robots + "\n";
    }
    project = { ...project, files };
  }
  const ready = options.framework === "single-html" ? await toSingleHtmlProject(project) : project;
  assertGeneratedPaths(ready);
  return ready;

}
