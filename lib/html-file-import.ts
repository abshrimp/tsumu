import { withImportUploads } from "./import-uploads";
import { openImportZip } from "./zip-directory";
import type { Asset, BreakpointDef, SiteDoc } from "./types";
import { readHtmlZip, readHtmlZipPages } from "./html-zip";
import { convertHtmlToSite, type HtmlConversion } from "./html-to-site";
import { IMPORT_LIMITS } from "./site-import";
import { tr } from "./i18n";

export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

/**
 * Inspect only the archive's file names before routing ZIP imports. An editable
 * Tsumu ZIP is restored losslessly; a regular website ZIP is converted to nodes.
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
  if (!file.size) throw new Error("ファイルが空です。");
  if (file.name.toLowerCase().endsWith(".zip")) {
    if (file.size > IMPORT_LIMITS.zipBytes) throw new Error("インポートするファイルが大きすぎます。");
    // readHtmlZip/readHtmlZipPages share strict path and expansion checks before uploads.
    options.progress?.("HTMLとアセットを読み込み中…");
    return withImportUploads(async paths => {
      if (!options.allPages) {
        const converted = await readHtmlZip(file, options.progress, paths);
        return convertHtmlToSite(converted.html, {
          breakpoints: options.breakpoints, assets: converted.assets,
        });
      }
      const archive = await readHtmlZipPages(file, options.progress, paths);
      return convertHtmlPages(archive.pages, archive.assets, options.breakpoints);
    }, uploaded);
  }
  if (!isHtmlFile(file.name)) throw new Error("HTMLまたはHTMLのZIPファイルを選択してください。");
  if (file.size > IMPORT_LIMITS.docBytes) throw new Error("インポートするファイルが大きすぎます。");
  const html = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  options.progress?.("HTMLを編集可能な要素へ変換中…");
  return convertHtmlToSite(html, { breakpoints: options.breakpoints });
}

/**
 * Create one editable Tsumu page per HTML entry. The ZIP entry point is first;
 * sibling .html and nested index.html files become separate pages.
 */
function convertHtmlPages(
  pages: { name: string; html: string }[],
  assets: Asset[],
  initialBreakpoints?: BreakpointDef[],
): HtmlConversion {
  if (!pages.length) throw new Error(tr("ZIP内にHTMLファイルが見つかりません"));
  const main = pages[0];
  const prefix = main.name.slice(0, main.name.lastIndexOf("/") + 1);
  const result: SiteDoc = {
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
    paths.set(canonical(source.name), { id, slug: unique });
    originForPage.set(id, source.name);
    breakpoints = doc.breakpoints;
    for (const warning of converted.warnings) if (!warnings.includes(warning)) warnings.push(warning);
    if (!result.siteName) result.siteName = doc.siteName;
  }
  if (result.pageOrder.length > 1) {
    // Rewrite local page links to Tsumu page IDs. External URLs and fragments
    // remain untouched, and suffixes are kept as explicit site-relative URLs.
    const visit = (id: string, filename: string) => {
      const node = result.nodes[id];
      if (!node) return;
      if (node.link?.kind === "url" && node.link.url) {
        const href = node.link.url;
        if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) {
          const m = /^([^?#]*)([?#].*)?$/.exec(href);
          const relative = m?.[1] || "";
          const suffix = m?.[2] || "";
          const folder = filename.slice(0, filename.lastIndexOf("/") + 1);
          const candidate = canonical(relative.startsWith("/") ? prefix + relative : folder + relative);
          const matches = [candidate, candidate + ".html", candidate + ".htm",
            candidate.replace(/\/$/, "") + "/index.html"];
          const found = matches.map((name) => paths.get(name)).find(Boolean);
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
