import type { SiteDoc } from "./types";
import { pagePlan } from "./data";
import { generateProject, type GeneratedProject, type PublishTarget } from "./generator";
import { buildReactProject, needsReactPageRuntime } from "./generator/react-export";
import { buildAssetNames } from "./generator/names";
import { generateStandaloneHtml } from "./generator/html-export";
import { buildAdditionalFramework } from "./generator/framework-export";
import { toSingleHtmlProject } from "./generator/single-html";
import { applyExportStyle } from "./generator/style-export";
import { zipMediaMime } from "./zip-mime";
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
  { value: "single-html", label: "Single HTML" },
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
 * 一部だけを書き出す場合は、他のページの編集可能なノードや無関係なアセットを含めてはいけない。
 * 書き出す ZIP に SiteDoc 全体を入れると、生成したコードが1ページ分だけでも、
 * 非公開の内容やアップロードしたメディアが外に出てしまう。
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

/** 選択したノードは、選択したページから実際にたどれなければならない。
 * ID が存在するかだけを確かめると、選択が古い場合（またはプログラムから渡された場合）に、
 * 無関係なページや非公開のページの内容を書き出してしまう。
 * マスターも正しい選択の対象になるため、コンポーネントのインスタンスもたどる。
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

/** 元のサイトを変えずに、ページや選択した範囲を書き出す。 */
export function exportScopeDoc(doc: SiteDoc, options: ExportOptions): SiteDoc {
  if (options.scope === "project") return doc;
  const page = options.pageId && Object.prototype.hasOwnProperty.call(doc.pages, options.pageId)
    ? doc.pages[options.pageId] : undefined;
  if (!page) throw new Error(tr("Select a page to export."));
  if (options.scope === "page") {
    // 明示的に選んだページは、プロジェクト全体の公開から除外されていても書き出せる。
    // そうしないと、選んだページが正しくても、ZIP にページのマークアップが入らない。
    return prunePartialDoc({ ...doc, pages: { [page.id]: { ...page, unpublished: false } },
      pageOrder: [page.id] });
  }
  const node = options.nodeId && Object.prototype.hasOwnProperty.call(doc.nodes, options.nodeId)
    ? doc.nodes[options.nodeId] : undefined;
  if (!node || !pageContainsNode(doc, page, node.id)) {
    throw new Error(tr("Select an element or component to export."));
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
    htmlZip: undefined,
    redirectTo: undefined,
    rewriteTo: undefined,
    customTopHtml: undefined,
    customEndHtml: undefined,
    pageScripts: undefined,
    children: [node.id],
  };
  return prunePartialDoc({ ...doc, pages: { [id]: scopedPage }, pageOrder: [id] });
}

function publishedPages(doc: SiteDoc) {
  return doc.pageOrder.map((id) => doc.pages[id]).filter((page) => page && !page.unpublished);
}

/** 対応していない機能の名前を短く返す。画面では、共通の説明を1つだけ表示する。 */
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
  // サーバー側だけで取得しても、埋め込んだトークンは秘密にならない。生成したソースと、
  // ZIP の中の編集可能な doc.json の両方に値が含まれるため。
  // エディタでの取得の動作は変えずに、生成処理を直接呼ぶ場合や GitHub への公開も含め、
  // すべての出力形式で同じく、安全側に倒して拒否する。
  const pages = publishedPages(doc);
  const metadataHeaders = pages.some((page) => pagePlan(doc, page.id).steps.some(
    (step) => step.kind === "fetch" && (step.headers ?? []).some((header) =>
      /^(?:metadata-flavor|x-metadata-token)$/i.test(header.name.trim()))
  ));
  if (hasPublishCredentials(doc) || metadataHeaders) {
    return [tr("The fetch settings contain credentials, a secret API key, or an internal-service header that is not allowed. Even with server-side Next.js output, these values can appear in the generated source files or the editable ZIP. Remove the sensitive values and use server environment variables or a secure API proxy.")];
  }
  if (options.framework === "nextjs") {
    // 取り込んだ HTML のルートハンドラーは、page.tsx と同じ Next.js のパスを使えない。
    // 取り込んだ HTML のページが複数あると、互いの route.ts を黙って上書きしてしまう。
    // クエリの違いでは、ビルド時のルートを区別できない。
    const routeKinds = new Map<string, { imported: number; regular: number }>();
    for (const page of pages) {
      if (page.redirectTo !== undefined || page.rewriteTo !== undefined) continue;
      const slug = page.slug.replace(/^\/+|\/+$/g, "");
      const existing = routeKinds.get(slug) ?? { imported: 0, regular: 0 };
      if (page.rawHtml?.trim()) existing.imported++;
      else if (slug !== "404") existing.regular++;
      routeKinds.set(slug, existing);
    }
    if ([...routeKinds.values()].some(({ imported, regular }) =>
      imported > 1 || (imported > 0 && regular > 0))) {
      return [tr("Imported HTML and regular pages, or multiple imported HTML pages, share a path. Next.js cannot export both to the same route. Give each page a different URL.")];
    }
    return [];
  }
  const reasons: string[] = [];
  if (pages.some((p) => /\[[^\]]+\]/.test(p.slug))) {
    reasons.push(tr("Dynamic paths such as [slug] need a static host that can serve any URL. Use a fixed path or export to Next.js."));
  }
  if (pages.some((p) => p.rewriteTo !== undefined || p.redirectTo !== undefined)) {
    reasons.push(tr("Redirects and reverse proxies require a server. Link directly to the destination or export to Next.js."));
  }
  if (!["html", "single-html"].includes(options.framework) && pages.some((p) => p.rawHtml?.trim())) {
    reasons.push(tr("Imported HTML pages cannot be safely converted to React components. Export to HTML to keep the original markup."));
  }
  if (["html", "single-html"].includes(options.framework)) {
    // 取り込んだ文書は中身を解釈できず、任意のスクリプトを含むことがあるため、
    // クエリ違いのページと、取り込んだ HTML の文書で出力を共有できない。
    const grouped = new Map<string, typeof pages>();
    for (const page of pages) {
      const key = page.slug.replace(/^\/+|\/+$/g, "");
      grouped.set(key, [...(grouped.get(key) ?? []), page]);
    }
    if ([...grouped.values()].some((group) =>
      group.length > 1 && group.some((page) => !!page.rawHtml?.trim()))) {
      reasons.push(tr("An imported HTML page and a query variant share a path. Use a regular page or assign separate URLs."));
    }
  }
  if (options.framework === "single-html" && pages.length !== 1) {
    reasons.push(tr("A single HTML file can contain only one page. Select the current page or export an HTML ZIP."));
  }
  if (["react", "vue", "nuxt", "sveltekit"].includes(options.framework) && /<script\b/i.test(doc.customBodyEndHtml ?? "")) {
    reasons.push(tr("Custom scripts at the end of the body run at a different time when navigating between pages. Export to HTML or move the scripts into framework-specific code."));
  }
  if (["vue", "nuxt", "sveltekit"].includes(options.framework)) {
    // 今のところ、フレームワーク固有のコンポーネントはページのノードしか描画しない。書かれた
    // カスタムの <head>、フッター、ページごとのマークアップを落とすと、サイトが黙って変わってしまう。
    if (!!doc.customHeadHtml?.trim() || !!doc.customBodyEndHtml?.trim() ||
      pages.some((page) => !!page.customTopHtml?.trim() || !!page.customEndHtml?.trim())) {
      reasons.push(tr("Custom HTML is omitted from this framework format. Export to Next.js or HTML."));
    }
  }
  if (options.framework === "react") {
    // Data-driven React pages use dangerouslySetInnerHTML for their DOM
    // runtime. Scripts inserted this way do not execute in browsers.
    if (pages.some((page) =>
      /<script\b(?![^>]*\btype\s*=\s*["']?application\/(?:ld\+)?json)/i
        .test((page.customTopHtml ?? "") + (page.customEndHtml ?? "")) &&
      needsReactPageRuntime(doc, page.id)
    )) {
      reasons.push(tr("Custom scripts on pages with dynamic data cannot run in the React export. Export to Next.js or HTML."));
    }
  }
  if (["html", "single-html"].includes(options.framework)) {
    if (options.style === "css-modules") {
      reasons.push(tr("CSS Modules require a build step. For an HTML export that needs no build, select CSS."));
    }
    if (options.style === "tailwind") {
      reasons.push(tr("Tailwind CSS needs a build step to generate its utilities. For an HTML export that needs no build, select CSS."));
    }
  }
  return reasons;
}

/** テストと、通常の TS / CSS のコードの出力に使う、同期的な生成処理。 */
export function generateExportProject(
  doc: SiteDoc,
  request: ExportFormat | ExportOptions = "nextjs",
  target: PublishTarget = "production",
): GeneratedProject {
  const options = optionsOf(request);
  const scoped = exportScopeDoc(doc, options);
  // 秘密を含む値をソースに描き出す *前に*、安全でない出力を拒否する。
  const limitations = exportLimitations(scoped, { ...options, scope: "project" });
  if (limitations.length) {
    throw new Error(tr("This export format does not yet support these features:") + "\n" + limitations.join("\n"));
  }
  const next = generateProject(scoped, target);
  const generated = options.framework === "react"
    ? buildReactProject(scoped, next)
    : (options.framework === "html" || options.framework === "single-html")
      ? generateStandaloneHtml(scoped, next)
      : (options.framework === "vue" || options.framework === "nuxt" || options.framework === "sveltekit")
        ? buildAdditionalFramework(scoped, next, options.framework, options.language, target)
        : next;
  const styled = options.style === "css" ? generated
    : applyExportStyle(generated, options.framework, options.style);
  assertGeneratedPaths(styled);
  return styled;
}

/** 選んだページやコンポーネントからたどれる ZIP の依存ファイルだけを残す。 */
export async function prepareExportScopeDoc(doc: SiteDoc, options: ExportOptions): Promise<SiteDoc> {
  const scoped = exportScopeDoc(doc, options);
  if (scoped !== doc && Object.keys(scoped.assets).length) {
    const { retainImportedDependencies } = await import("./generator/imported-dependencies");
    await retainImportedDependencies(scoped, doc.assets);
  }
  return scoped;
}

/**
 * ZIP での書き出しと GitHub への公開で共通の処理。どちらの操作でも、同じファイルを出力する。
 * テスト公開のブランチでは、Next.js 以外でも、検索エンジンに載せないための保護を保つ。
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
  let ready = project;
  if (options.framework === "single-html") {
    const zip = publishedPages(scoped)[0]?.htmlZip;
    const media = new Set<string>();
    if (zip) {
      const names = buildAssetNames(scoped);
      for (const id of zip.assetIds) {
        const name = names.get(id);
        const asset = scoped.assets[id];
        if (name && asset && (/^(?:image|audio|video|font)\//i.test(asset.mimeType ?? "") ||
            zipMediaMime(asset.zip?.path ?? name))) media.add("/assets/" + name);
      }
    }
    ready = await toSingleHtmlProject(project, undefined, media);
  }
  assertGeneratedPaths(ready);
  return ready;

}
