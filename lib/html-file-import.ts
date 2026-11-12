import { withImportUploads } from "./import-uploads";
import type JSZip from "jszip";
import type { Asset, BreakpointDef, LinkSetting, SiteDoc } from "./types";
import { readHtmlZip, readHtmlZipPages } from "./html-zip";
import { safeNavigationUrl } from "./url-policy";
import { genId } from "./presets";
import { archiveBaseUrl, archiveFileUrl } from "./zip-references";
import { isHtmlIndex } from "./html-zip-guard";
import { convertHtmlToSite, type HtmlConversion } from "./html-to-site";
import { IMPORT_LIMITS } from "./site-import";
import { tr } from "./i18n";

export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

/** 編集可能な要素が1つもできない取り込みで、取り込み先のページを消してはいけない。 */
export function requireEditableHtmlContent(result: HtmlConversion): HtmlConversion {
  for (const id of result.doc.pageOrder) {
    if (!result.doc.pages[id]?.children.length) {
      throw new Error(tr("The HTML conversion produced no editable elements. Switch the page type to HTML and load the ZIP there to keep its original code."));
    }
  }
  return result;
}

/** ホームからの HTML ZIP 取り込みでは、開いたアーカイブの全ページを変換する。 */
export async function convertHtmlZipSite(
  zip: JSZip, progress: (message: string) => void, paths: string[],
): Promise<HtmlConversion> {
  progress(tr("Reading HTML and assets…"));
  const archive = await readHtmlZipPages(zip, progress, paths);
  return requireEditableHtmlContent(convertHtmlPages(archive.pages, archive.assets));
}

export async function convertHtmlFile(
  file: File,
  options: { breakpoints?: BreakpointDef[]; progress?: (message: string) => void } = {},
  uploaded?: string[],
): Promise<HtmlConversion> {
  if (!file.size) throw new Error(tr("The file is empty."));
  if (file.name.toLowerCase().endsWith(".zip")) {
    options.progress?.(tr("Reading HTML and assets…"));
    return withImportUploads(async paths => {
      const converted = await readHtmlZip(file, options.progress, paths);
      return requireEditableHtmlContent(convertHtmlToSite(converted.html, {
        breakpoints: options.breakpoints, assets: converted.assets,
      }));
    }, uploaded);
  }
  if (!isHtmlFile(file.name)) throw new Error(tr("Choose an HTML file or ZIP containing HTML."));
  if (file.size > IMPORT_LIMITS.docBytes) throw new Error(tr("The import file is too large."));
  const html = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  options.progress?.(tr("Converting HTML into editable elements…"));
  return requireEditableHtmlContent(convertHtmlToSite(html, { breakpoints: options.breakpoints }));
}

/**
 * HTML のファイルごとに、編集可能な Tsumu のページを1つずつ作る。ZIP の入口のファイルが最初で、
 * 同じ階層の .html と、入れ子の index.html は、それぞれ別のページになる。
 */
function convertHtmlPages(
  pages: { name: string; html: string; baseHref?: string | null }[],
  assets: Asset[],
): HtmlConversion {
  if (!pages.length) throw new Error(tr("No HTML file found in the zip"));
  const main = pages[0];
  const prefix = main.name.slice(0, main.name.lastIndexOf("/") + 1);
  const result: SiteDoc = {
    schemaVersion: 1,
    siteName: "", pageOrder: [], pages: {}, nodes: {},
    assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
  };
  const paths = new Map<string, { id: string; slug: string }>();
  const slugs = new Set<string>();
  const routes = pages.map(source => {
    let slug = source.name.startsWith(prefix) ? source.name.slice(prefix.length) : source.name;
    slug = slug.replace(/\.html?$/i, "").replace(/\/index$/i, "").replace(/^index$/i, "");
    slug = slug.replace(/[^A-Za-z0-9/_-]/g, "-").replace(/^\/+|\/+$/g, "");
    let unique = slug;
    for (let n = 2; slugs.has(unique); n++) unique = (slug || "page") + "-" + n;
    slugs.add(unique);
    const target = { id: genId("page"), slug: unique };
    paths.set(source.name, target);
    if (isHtmlIndex(source.name)) {
      const directory = source.name.slice(0, source.name.lastIndexOf("/") + 1);
      if (!paths.has(directory)) paths.set(directory, target);
    }
    return { source, target };
  });

  const lookup = (path: string) => {
    if (!path || path.endsWith("/")) return paths.get(path);
    return paths.get(path) ?? paths.get(path + ".html") ?? paths.get(path + ".htm") ?? paths.get(path + "/");
  };
  const lookupUrl = (url: URL, root: string) => {
    // An encoded slash belongs to the URL segment; it is not a ZIP path separator.
    if (/%2f|%5c/i.test(url.pathname)) return undefined;
    try { return lookup(root + decodeURIComponent(url.pathname.slice(1))); }
    catch { return undefined; }
  };
  const warnings = new Set<string>();
  let breakpoints: BreakpointDef[] | undefined;
  for (const { source, target } of routes) {
    // Inside a wrapped site, / and excess .. segments resolve from its entry directory.
    const root = source.name.startsWith(prefix) ? prefix : "";
    const name = source.name.slice(root.length);
    const base = archiveBaseUrl(name, source.baseHref);
    const pageBase = base ?? archiveFileUrl(name);
    const archiveFile = root ? archiveBaseUrl(source.name, source.baseHref) ?? archiveFileUrl(source.name) : undefined;
    const resolvePageLink = (href: string): LinkSetting | undefined => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || (!base && (!href || href.startsWith("#")))) return;
      const url = new URL(href, pageBase);
      if (url.protocol !== "file:") return { kind: "url", url: url.href };
      // An archive can also contain sibling pages outside the entry directory.
      const page = lookupUrl(url, root) ?? (archiveFile && lookupUrl(new URL(href, archiveFile), ""));
      const suffixAt = url.href.search(/[?#]/);
      const suffix = suffixAt < 0 ? "" : url.href.slice(suffixAt);
      if (page) return suffix ? { kind: "url", url: "/" + page.slug + suffix } : { kind: "page", pageId: page.id };
      if (base) return { kind: "url", url: safeNavigationUrl(url.pathname + suffix) };
    };
    const converted = convertHtmlToSite(source.html, { assets, breakpoints, pageId: target.id, resolvePageLink });
    const page = converted.doc.pages[target.id];
    page.slug = target.slug;
    result.pages[target.id] = page;
    result.pageOrder.push(target.id);
    Object.assign(result.nodes, converted.doc.nodes);
    breakpoints = converted.doc.breakpoints;
    for (const warning of converted.warnings) warnings.add(warning);
    if (!result.siteName) result.siteName = converted.doc.siteName;
  }
  result.breakpoints = breakpoints;
  return { doc: result, warnings: [...warnings] };
}
