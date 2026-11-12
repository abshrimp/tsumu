import { withImportUploads } from "./import-uploads";
import { openImportZip } from "./zip-directory";
import type { Asset, BreakpointDef, SiteDoc } from "./types";
import { readHtmlZip, readHtmlZipPages } from "./html-zip";
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

/**
 * ZIP の取り込み先を決める前に、アーカイブのファイル名だけを調べる。編集可能な Tsumu の
 * ZIP は損なわずに復元し、通常のウェブサイトの ZIP はノードに変換する。
 */
export async function isEditableSiteZip(data: Uint8Array): Promise<boolean> {
  const zip = await openImportZip(data, IMPORT_LIMITS.entries);
  const names = Object.values(zip.files).filter((item) => !item.dir).map((item) => item.name);
  return names.some((name) => /^(?:[^/]+\/)?_tsumu\/doc\.json$/i.test(name));
}

export async function convertHtmlFile(
  file: File,
  options: { breakpoints?: BreakpointDef[]; progress?: (message: string) => void; allPages?: boolean } = {},
  uploaded?: string[],
): Promise<HtmlConversion> {
  if (!file.size) throw new Error(tr("The file is empty."));
  if (file.name.toLowerCase().endsWith(".zip")) {
    if (file.size > IMPORT_LIMITS.zipBytes) throw new Error(tr("The import file is too large."));
    // readHtmlZip / readHtmlZipPages は、アップロードの前に、同じ厳格なパスと展開の検査を行う。
    options.progress?.(tr("Reading HTML and assets…"));
    return withImportUploads(async paths => {
      if (!options.allPages) {
        const converted = await readHtmlZip(file, options.progress, paths);
        return requireEditableHtmlContent(convertHtmlToSite(converted.html, {
          breakpoints: options.breakpoints, assets: converted.assets,
        }));
      }
      const archive = await readHtmlZipPages(file, options.progress, paths);
      return requireEditableHtmlContent(convertHtmlPages(archive.pages, archive.assets, options.breakpoints));
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
  pages: { name: string; html: string }[],
  assets: Asset[],
  initialBreakpoints?: BreakpointDef[],
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
  const warnings: string[] = [];
  const originForPage = new Map<string, string>();
  let breakpoints = initialBreakpoints;
  const canonical = (raw: string) => {
    const parts: string[] = [];
    for (const part of raw.replace(/\\/g, "/").split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
  };
  for (const source of pages) {
    const converted = convertHtmlToSite(source.html, { assets, breakpoints });
    const doc = converted.doc;
    const id = doc.pageOrder[0];
    const page = doc.pages[id];
    let slug = source.name.startsWith(prefix) ? source.name.slice(prefix.length) : source.name;
    slug = slug.replace(/\.html?$/i, "").replace(/\/index$/i, "").replace(/^index$/i, "");
    slug = slug.replace(/[^A-Za-z0-9/_-]/g, "-").replace(/^\/+|\/+$/g, "");
    let unique = slug;
    for (let n = 2; slugs.has(unique); n++) unique = (slug || "page") + "-" + n;
    slugs.add(unique);
    page.slug = unique;
    result.pages[id] = page;
    result.pageOrder.push(id);
    Object.assign(result.nodes, doc.nodes);
    const path = canonical(source.name);
    const target = { id, slug: unique };
    paths.set(path, target);
    if (isHtmlIndex(path)) {
      const directory = path.slice(0, path.lastIndexOf("/") + 1);
      if (!paths.has(directory)) paths.set(directory, target);
    }
    originForPage.set(id, source.name);
    breakpoints = doc.breakpoints;
    for (const warning of converted.warnings) if (!warnings.includes(warning)) warnings.push(warning);
    if (!result.siteName) result.siteName = doc.siteName;
  }
  if (result.pageOrder.length > 1) {
    // ローカルのページへのリンクを、Tsumu のページ ID に書き換える。外部の URL とフラグメントは
    // そのまま残し、続く部分は、サイト内の明示的な相対 URL として保つ。
    const visit = (id: string, filename: string) => {
      const node = result.nodes[id];
      if (!node) return;
      if (node.link?.kind === "url" && node.link.url) {
        const href = node.link.url;
        if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) {
          const m = /^([^?#]*)([?#].*)?$/.exec(href);
          let relative = m?.[1] || "";
          // URL のパスだけを一度デコードし、ZIP の中の元のファイル名と照合する。
          try { relative = decodeURIComponent(relative); } catch { /* 不正なエスケープは元の表記を保つ。 */ }
          const suffix = m?.[2] || "";
          const folder = filename.slice(0, filename.lastIndexOf("/") + 1);
          // パスの無いクエリは、親のフォルダではなく、現在の HTML のページを指す。
          const candidate = canonical(relative
            ? relative.startsWith("/") ? prefix + relative : folder + relative
            : filename);
          const directoryPage = paths.get(candidate ? candidate + "/" : "");
          const directoryLink = /(?:\/|(?:^|\/)\.{1,2})$/.test(relative);
          const found = directoryLink ? directoryPage :
            paths.get(candidate) ?? paths.get(candidate + ".html") ?? paths.get(candidate + ".htm") ?? directoryPage;
          if (found) {
            node.link = suffix
              ? { kind: "url", url: "/" + found.slug + suffix, newTab: node.link.newTab }
              : { kind: "page", pageId: found.id, newTab: node.link.newTab };
          }
        }
      }
      node.children.forEach((child) => visit(child, filename));
    };
    for (const [id, filename] of originForPage) result.pages[id].children.forEach((child) => visit(child, filename));
  }
  result.breakpoints = breakpoints;
  return { doc: result, warnings };
}
