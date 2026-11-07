import type { SiteDoc } from "./types";
import { generateProject, type GeneratedProject } from "./generator";
import { buildReactProject } from "./generator/react-export";
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
  let id = "__tsumu_export_component__";
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
    "動的URL（[slug]など）");
  add(pages.some((p) => p.rewriteTo !== undefined || p.redirectTo !== undefined),
    "リダイレクト・リバースプロキシ");
  if (options.framework === "react") {
    add(pages.some((p) => !!p.rawHtml?.trim()), "HTMLページ");
  }
  if (options.framework === "html") {
    add(pages.some((p) => !!p.query?.trim()) ||
      new Set(pages.map((p) => p.slug.replace(/^\/+|\/+$/g, ""))).size !== pages.length,
      "クエリ別ページ");
  }
  const project = existing ?? generateProject(doc);
  add(Object.entries(project.files).some(([path, source]) => {
    if (!/^app\/(?:.*\/)?(?:_q\/p\d+|page)\.tsx$/.test(path)) return false;
    if (options.framework === "react") {
      // Query dispatchers are replaced by React's client-side route table.
      if (source.includes("const variants: Variant[]")) return false;
      // The browser URL can supply the query that Next.js otherwise awaits.
      return needsServerRuntime(source.replaceAll("await searchParams", ""));
    }
    return needsServerRuntime(source);
  }), "サーバーでのデータ取得・変数処理");

  if (options.framework === "react") {
    add(!!doc.customBodyEndHtml?.match(/<script\b/i),
      "body末尾の実行スクリプト");
  }
  return reasons;
}

/** Synchronous generator for tests and normal TS/CSS code output. */
export function generateExportProject(
  doc: SiteDoc,
  request: ExportFormat | ExportOptions = "nextjs",
): GeneratedProject {
  const options = optionsOf(request);
  const scoped = exportScopeDoc(doc, options);
  const next = generateProject(scoped);
  const limitations = exportLimitations(scoped, { ...options, scope: "project" }, next);
  if (limitations.length) {
    throw new Error(tr("選択した形式では次の機能を利用できません。") + "\n" + limitations.join("\n"));
  }
  const generated = options.framework === "react"
    ? buildReactProject(scoped, next)
    : options.framework === "html" ? buildStaticHtmlProject(next) : next;
  return options.style === "css" ? generated
    : applyExportStyle(generated, options.framework, options.style);
}

/** A Next.js build that generates deployable HTML/CSS/JS in out/, not a server app. */
function buildStaticHtmlProject(next: GeneratedProject): GeneratedProject {
  const files = { ...next.files };
  for (const [path, source] of Object.entries(files)) {
    if (/^app\/(?:.*\/)?(?:_q\/p\d+|page)\.tsx$/.test(path) && !needsServerRuntime(source)) {
      files[path] = source.replace(/^export const (?:revalidate|dynamic) = [^\n]*;\n/mg, "");
    }
  }
  files["next.config.mjs"] = files["next.config.mjs"].replace(
    "const nextConfig = {",
    'const nextConfig = {\n  output: "export",\n  trailingSlash: true,'
  );
  if (!files["next.config.mjs"].includes('output: "export"')) {
    throw new Error("Could not configure the static HTML export.");
  }
  const pkg = JSON.parse(files["package.json"]) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
    allowScripts?: Record<string, boolean>;
  };
  pkg.scripts = { dev: "next dev", build: "next build" };
  delete pkg.devDependencies["@opennextjs/cloudflare"];
  delete pkg.devDependencies.wrangler;
  if (pkg.allowScripts) delete pkg.allowScripts["workerd@1.20261019.1"];
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  delete files["wrangler.jsonc"];
  delete files["open-next.config.ts"];
  files["README.md"] = [
    "# Static HTML export", "",
    "Generated by Tsumu (https://github.com/abshrimp/tsumu).", "",
    "Run npm install and npm run build. The out/ directory contains",
    "standalone HTML, CSS, JavaScript and assets for static hosting.",
    "Deploy the contents of out/ at the root of your domain.",
    "This format supports static pages only. For server data, dynamic routes,",
    "redirects or reverse proxies, use the Next.js export.", "",
  ].join("\n");
  return { ...next, files };
}
