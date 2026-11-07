import type { SiteDoc } from "./types";
import { pagePlan } from "./data";
import { generateProject, type GeneratedProject, type PublishTarget } from "./generator";
import { buildReactProject } from "./generator/react-export";
import { generateStandaloneHtml } from "./generator/html-export";
import { applyExportStyle } from "./generator/style-export";
import { tr } from "./i18n";

export type ExportFormat = "nextjs" | "react" | "html";
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

/** Export a page or selection without editing the source site. */
export function exportScopeDoc(doc: SiteDoc, options: ExportOptions): SiteDoc {
  if (options.scope === "project") return doc;
  const page = options.pageId ? doc.pages[options.pageId] : undefined;
  if (!page) throw new Error(tr("書き出すページを選択してください。"));
  if (options.scope === "page") {
    return { ...doc, pages: { [page.id]: page }, pageOrder: [page.id] };
  }
  const node = options.nodeId ? doc.nodes[options.nodeId] : undefined;
  if (!node) throw new Error(tr("書き出すコンポーネントを選択してください。"));
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
  return { ...doc, pages: { [id]: scopedPage }, pageOrder: [id] };
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
  existing?: GeneratedProject,
): string[] {
  const options = optionsOf(request);
  try {
    doc = exportScopeDoc(doc, options);
  } catch (e) {
    return [(e as Error).message];
  }
  if (options.framework === "nextjs") return [];
  const pages = publishedPages(doc);
  const reasons: string[] = [];
  const add = (bad: boolean, message: string) => {
    if (bad) reasons.push(tr(message));
  };
  add(pages.some((p) => /\[[^\]]+\]/.test(p.slug)),
    "動的URL（[slug]など）は、アクセス時にURLから値を取り出す必要があります。固定URLのページに変更するか、Next.js形式を選択してください。");
  add(pages.some((p) => p.rewriteTo !== undefined || p.redirectTo !== undefined),
    "リダイレクトとリバースプロキシにはサーバーの処理が必要です。転送先への通常のリンクに変更するか、Next.js形式を選択してください。");
  if (options.framework === "react") {
    add(pages.some((p) => !!p.rawHtml?.trim()),
      "取り込んだHTMLページをReactコンポーネントへ安全に変換できません。HTML形式なら元のHTMLをそのまま出力できます。");
  }
  if (options.framework === "html") {
    add(pages.some((p) => !!p.query?.trim()) ||
      new Set(pages.map((p) => p.slug.replace(/^\/+|\/+$/g, ""))).size !== pages.length,
      "同じURLをクエリ文字列で切り替えるページは、静的ファイルだけでは振り分けられません。ページごとに異なるURLに変更してください。");
  }
  const project = existing ?? generateProject(doc);
  if (options.framework === "react") {
    add(Object.entries(project.files).some(([path, source]) => {
      if (!/^app\/(?:.*\/)?(?:_q\/p\d+|page)\.tsx$/.test(path)) return false;
      // React query dispatchers are replaced with a browser routing table.
      if (source.includes("const variants: Variant[]")) return false;
      return needsServerRuntime(source.replaceAll("await searchParams", ""));
    }), "ページの表示前にサーバーでデータを取得・加工する設定があります。Reactのクライアント描画では現在この処理を移行できません。Next.jsまたはHTML形式を選択してください。");
  }
  if (options.framework === "html") {
    const fetched = pages.flatMap((page) => pagePlan(doc, page.id).steps)
      .filter((step) => step.kind === "fetch");
    const secret = fetched.some((step) => {
      const credentialHeader = (step.headers ?? []).some((h) =>
        /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-client-secret)$/i.test(h.name.trim())
      );
      const secretUrl = /[?&](?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)=/i.test(step.url);
      return credentialHeader || secretUrl;
    });
    add(secret,
      "データ取得に認証用ヘッダーや秘密のAPIキーが含まれています。HTMLに直接書き出すと第三者にも見えるため、公開APIに変更するかサーバー側で安全に中継してください。");
  }

  if (options.framework === "react") {
    add(!!doc.customBodyEndHtml?.match(/<script\b/i),
      "body末尾のカスタムスクリプトは、Reactの画面更新時に実行タイミングが異なります。HTML形式で書き出すか、React用の処理へ移行してください。");
  }
  if (options.framework === "html") {
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
    : options.framework === "html" ? generateStandaloneHtml(scoped, next) : next;
  return options.style === "css" ? generated
    : applyExportStyle(generated, options.framework, options.style);
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
  let project = generateExportProject(doc, options, target);
  if (options.framework !== "html" && options.language === "javascript") {
    const { toJavaScriptProject } = await import("./generator/javascript-export");
    project = await toJavaScriptProject(project, options.framework);
  }
  if (target !== "test" || options.framework === "nextjs") return project;

  const files = { ...project.files };
  const robots = "noindex, nofollow, noarchive, nosnippet, noimageindex";
  const robotsMeta = '<meta name="robots" content="' + robots + '">';
  const htmlFiles = options.framework === "html"
    ? Object.keys(files).filter((path) => /\.html?$/i.test(path))
    : ["index.html"];
  for (const path of htmlFiles) {
    if (!files[path]) continue;
    if (/<head(?:\s[^>]*)?>/i.test(files[path])) {
      files[path] = files[path].replace(/<head(?:\s[^>]*)?>/i, (head) => head + "\n" + robotsMeta);
    } else {
      files[path] = robotsMeta + "\n" + files[path];
    }
  }
  files[options.framework === "html" ? "robots.txt" : "public/robots.txt"] =
    "User-agent: *\nDisallow: /\n";
  files[options.framework === "html" ? "_headers" : "public/_headers"] =
    "/*\n  X-Robots-Tag: " + robots + "\n";
  return { ...project, files };
}
