/**
 * ビルド不要の HTML / CSS / JavaScript の書き出し。フレームワークのソースは含めない。
 * Next.js の書き出しと同じ、正規化した文書と、生成した CSS・アセットを使う。
 */
import { fieldSubmissionAttributes, submissionAttributes } from "../imported-form";
import type { DocNode, Page, SiteDoc } from "../types";
import type { GeneratedProject, PublishTarget } from "../generator";
import { listFromOf, obfuscateVarNames, pagePlan } from "../data";
import { applyBreakpoints, toggleShowDisplay } from "../style";
import { buildAssetNames, buildClassNames } from "./names";
import { assetSrc } from "../assets";
import { assetMediaUrl } from "../media-url";
import { htmlZipExportSource, htmlZipExportUrl, importedAssetUrl, isZipJavascript } from "./imported-assets";
import { googleFontsCss, rewriteHtmlAssetUrls, rawHtmlWithBodyStyles } from "./css";
import { adobeFontHead } from "./adobe-fonts";
import { htmlResourceElements, htmlZipSource, rewriteHtmlResourceUrls } from "../html-zip-source";
import { rewriteHtmlZipScriptUrls } from "../html-zip-script-assets";
import { crispSvgSize, hasBlockDescendant, raiseOverCrispSvg, showsSelf } from "./render-helpers";
import { unnestLinks } from "./page";
import { hasVars } from "../vars";
import { pageQueryConditions } from "../page-query";
import { selectDefaultValue, fieldVarName, RANGED_INPUTS, TEXT_INPUTS } from "../fields";
import { resolveTag } from "../tags";
import { compileScripts, hasRunnableScripts, scriptTargetIds } from "../script";
import { embedSrc, YOUTUBE_ALLOW } from "../embed";
import { EMPTY_GIF, buildPwaManifest } from "./templates";
import { scriptsFile } from "../script-runtime";
import { PAGE_DATA_RUNTIME, serializePageDataPlan } from "./browser-data";
import { QUERY_VARIANT_RUNTIME } from "./query-route";
import { safeMediaUrl, safeNavigationUrl, safeResourceUrl } from "../url-policy";
import { importedAttributes, importedClass } from "../imported-html-attrs";
import { rewriteCssAssetUrls } from "../css-assets";
import { archiveBaseUrl, archiveFileUrl } from "../zip-references";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]!);
const attr = (key: string, value: string | number | undefined | null) =>
  value == null ? "" : " " + key + '="' + escapeHtml(String(value)) + '"';
const flag = (key: string, value: boolean | undefined) => value ? " " + key : "";

function pageFilename(page: Page, single: boolean): string {
  if (single) return "index.html";
  const slug = page.slug.replace(/^\/+|\/+$/g, "");
  if (slug === "404") return "404.html";
  if (slug.split("/").some((s) => s === "." || s === ".." || /[\\?#:]/.test(s))) {
    throw new Error("Invalid static page path: " + page.slug);
  }
  return slug ? slug + "/index.html" : "index.html";
}

function pagePrefix(path: string): string {
  return "../".repeat(path.split("/").length - 1) || "./";
}

/**
 * 単独のページは、どのホスティングのディレクトリの下でも、file:// でも開ける。
 * 出力したアセットのリンクを、ファイル名で終わる base も含めた有効な base から解決し、
 * ルート相対の base は、書き出したページからの相対パスで表す。
 */
function standaloneZipBase(html: string, path: string) {
  if (!/<base[\s>]/i.test(html)) return undefined;
  const { baseElement } = htmlResourceElements(html);
  const href = baseElement?.attrs.find(attr => attr.name === "href");
  const location = baseElement?.sourceCodeLocation?.attrs?.href;
  const base = archiveBaseUrl(path, href?.value);
  if (!location || base?.protocol !== "file:") return undefined;
  return {
    prefix: pagePrefix(base.pathname.slice(1)),
    href: pagePrefix(path) + base.pathname.slice(1) + base.search + base.hash,
    location,
  };
}

/** ルート相対の CSS のリソースの参照だけを書き換える。 */
function rewriteCssRootUrls(source: string, prefix: string): string {
  return rewriteCssAssetUrls(source, (url) =>
    url.startsWith("/") && !url.startsWith("//") ? prefix + url.slice(1) : undefined
  );
}

function exportedAssetSources(doc: SiteDoc, names: Map<string, string>) {
  const files = new Map<string, string>();
  const scripts = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    const src = assetSrc(asset);
    const name = names.get(asset.id);
    if (!src || !name) continue;
    files.set(src, "/assets/" + name);
    const alias = isZipJavascript(asset) && importedAssetUrl(asset);
    if (alias) scripts.set(src, scripts.has(src) && scripts.get(src) !== alias ? "" : alias);
  }
  return { files, scripts };
}

/**
 * 実際の HTML の属性とインラインの CSS だけを書き換える。スクリプトの本文、コメント、
 * テキストノード、たまたまマークアップを含む無関係な属性の値は、決して書き換えない。
 */
function rewriteRootUrls(
  source: string, prefix: string, sources: ReturnType<typeof exportedAssetSources>,
  mode: "fragment" | "document" = "fragment",
): string {
  const resource = (value: string, script = false) => {
    const suffix = value.startsWith("/api/assets/file?path=") ? value.search(/[&#]/) : value.indexOf("#");
    const key = suffix < 0 ? value : value.slice(0, suffix);
    const mapped = (script ? sources.scripts.get(key) : undefined) ?? sources.files.get(key);
    if (mapped === "") throw new Error("Ambiguous ZIP script location. Give the imported entry scripts distinct URLs.");
    if (mapped) {
      const tail = suffix < 0 ? "" : value.slice(suffix).replace(/^&/, "?");
      return prefix + mapped.slice(1) + tail;
    }
    return value.startsWith("/") && !value.startsWith("//") ? prefix + value.slice(1) : value;
  };
  const { elements } = htmlResourceElements(source, mode);
  return rewriteHtmlResourceUrls(source, elements, resource, (_name, value, original) => {
    // Preserve the original assignment and quote style. Newly quoted values can contain decoded spaces.
    const assignment = /^[^=]+=[\t\n\f\r ]*/.exec(original)![0];
    const quote = original[assignment.length] === "'" ? "'" : '"';
    return assignment + quote + escapeHtml(value) + quote;
  });
}

/** Tsumu のブラウザのランタイムが各行を複製するまで、リストの項目の字句を残す。 */
function templateParts(value: string, includeOffset = false): string {
  const out: (string | { name: string; at?: number })[] = [];
  let from = 0;
  for (const m of value.matchAll(/\\\{|\{([^{}\s"'<>]+)\}|\[slug\]/g)) {
    const at = m.index ?? 0;
    out.push(value.slice(from, at));
    out.push(m[0] === "\\{" ? "{" : includeOffset ? { name: m[1] ?? "slug", at } : { name: m[1] ?? "slug" });
    from = at + m[0].length;
  }
  out.push(value.slice(from));
  return JSON.stringify(out);
}

type Context = {
  doc: SiteDoc;
  page: Page;
  prefix: string;
  single: boolean;
  classes: Map<string, string>;
  assets: Map<string, string>;
  assetSources: ReturnType<typeof exportedAssetSources>;
  toggles: Set<string>;
  seen: Set<string>;
  form: boolean;
  template: boolean;
  instance?: { id?: string; hidden?: string };
  staticRoutes?: ReadonlyMap<string, Page[]>;
  authoredBase?: boolean;
};

function resource(ctx: Context, assetId?: string): string {
  const name = ctx.assets.get(assetId || "");
  return name ? ctx.prefix + "assets/" + name : "";
}

function href(ctx: Context, value: string, formAction = false): string {
  const safe = safeNavigationUrl(value);
  if (!ctx.staticRoutes || /^(?:[a-z][a-z0-9+.-]*:|[?#])/i.test(safe)) return safe;
  const [, pathname, suffix] = /^([^?#]*)([\s\S]*)$/.exec(safe)!;
  const rootRelative = pathname.startsWith("/");
  if (!rootRelative) {
    // An explicit base or a leading variable can supply an entirely different destination.
    if (ctx.authoredBase || (!formAction && hasVars(pathname))) return safe;
    // Relative form actions can be server endpoints even when a page has the same clean URL.
    if (formAction) return ctx.prefix + new URL(safe, archiveFileUrl(ctx.page.slug)).href.slice("file:///".length);
  }
  // A clean editor URL and its exported directory/index.html have different bases for relative links.
  const path = rootRelative ? pathname : new URL(pathname, archiveFileUrl(ctx.page.slug)).pathname;
  const slug = path.replace(/^\/+|\/+$/g, "");
  let route = ctx.staticRoutes.get(slug);
  if (!route && slug.includes("%")) {
    try { route = ctx.staticRoutes.get(decodeURI(slug)); } catch { /* Keep the authored URL. */ }
  }
  // URL links retain their own query even when several page variants share the same file.
  if (route) return ctx.prefix + pageFilename(route[0], ctx.single) + suffix;
  return formAction ? safe : ctx.prefix + path.replace(/^\/+/, "") + suffix;
}

/** メディアのソースは、インラインのデータか、サイト内のファイルに限る。動作するような URL のスキームは使わない。 */
function sourceHref(ctx: Context, value: string): string {
  const safe = safeResourceUrl(value);
  // メディアのパスはファイルへの参照で、ページへのリンクではない。ソースが実際にアセットを
  // 指しているときに、たまたま一致したページの slug を index.html に解決してはいけない。
  return /^\/(?!\/)/.test(safe)
    ? ctx.prefix + safe.replace(/^\/+/, "") : safe;
}

function mediaHref(ctx: Context, value: string): string {
  const safe = safeMediaUrl(value);
  return /^\/(?!\/)/.test(safe)
    ? ctx.prefix + safe.replace(/^\/+/, "") : safe;
}

function pageHref(ctx: Context, id: string): string {
  const p = ctx.doc.pages[id];
  if (!p) return "#";
  const suffix = p.query?.trim().replace(/^\?/, "");
  const withQuery = (url: string) => suffix ? url + (url.includes("?") ? "&" : "?") + suffix : url;
  if (!ctx.staticRoutes) return withQuery("/" + p.slug.replace(/^\/+|\/+$/g, ""));
  if (ctx.single && p.id === ctx.page.id) return withQuery(ctx.prefix + "index.html");
  if (p.slug.replace(/^\/+|\/+$/g, "") === "404") return withQuery(ctx.prefix + "404.html");
  const slug = p.slug.replace(/^\/+|\/+$/g, "");
  return withQuery(ctx.prefix + (slug ? slug + "/index.html" : "index.html"));
}

function compiledAttr(ctx: Context, node: Pick<DocNode, "scripts">, skip?: Set<string>): string {
  if (!hasRunnableScripts(node)) return "";
  const scripts = compileScripts(node, (id) => pageHref(ctx, id), (s) => s, false, skip);
  return scripts.length ? attr("data-scripts", JSON.stringify(scripts)) : "";
}

function common(ctx: Context, n: DocNode, cls: string): string {
  const id = n.attrId || ctx.instance?.id;
  const toggle = (!!id && ctx.toggles.has(id)) || showsSelf(n);
  const retained = Object.entries(importedAttributes(n.htmlAttrs))
    .map(([key, value]) => attr(key === "htmlFor" ? "for" : key === "tabIndex" ? "tabindex" : key, value))
    .join("");
  return attr("class", cls) + attr("id", id) + retained +
    attr("data-instance-hidden", ctx.instance?.hidden) +
    (toggle ? attr("data-toggle-show", toggleShowDisplay(n)) : "") +
    compiledAttr(ctx, n) +
    flag("data-inview", n.motions?.some((m) => m.trigger === "in-view"));
}

function field(ctx: Context, n: DocNode, attrs: string): string {
  const f = n.field!;
  const name = f.name ?? fieldVarName(n);
  const formAttrs = Object.entries(fieldSubmissionAttributes(n, action => href(ctx, action, true)))
    .map(([key, value]) => attr(key, value)).join("");
  const shared = formAttrs + attr("name", name || undefined) + flag("required", f.required) + flag("disabled", f.disabled);
  const dynamic = (key: string, value?: string) => !ctx.template && value && hasVars(value)
    ? attr("data-live-" + key, value) : "";
  const fieldParts = (key: string, value?: string) => ctx.template && value && hasVars(value)
    ? attr("data-field-" + key + "-parts", templateParts(value)) : "";
  if (f.kind === "submit") {
    const label = f.label ?? "送信";
    return "<button" + attrs + ' type="submit"' + attr("value", f.submitValue) + shared +
      (!ctx.template && hasVars(label) ? attr("data-live", label) : "") + fieldParts("text", label) + ">" + escapeHtml(label) + "</button>";
  }
  if (f.kind === "textarea") {
    return "<textarea" + attrs + shared + attr("placeholder", f.placeholder) +
      dynamic("placeholder", f.placeholder) + fieldParts("placeholder", f.placeholder) +
      attr("rows", f.rows) + attr("maxlength", f.maxLength) +
      dynamic("value", f.defaultValue) + fieldParts("value", f.defaultValue) + ">" +
      escapeHtml(f.defaultValue || "") + "</textarea>";
  }
  if (f.kind === "select") {
    const values = f.options || [];
    const initial = selectDefaultValue(f);
    const selected = Math.max(0, values.findIndex((o) => o.value === initial));
    return "<select" + attrs + shared + ">" + values.map((o, index) =>
      "<option" + attr("value", o.value) + flag("selected", index === selected) +
      dynamic("value", o.value) + fieldParts("value", o.value) +
      (!ctx.template && hasVars(o.label) ? attr("data-live", o.label) : "") + fieldParts("text", o.label) +
      ">" + escapeHtml(o.label) + "</option>").join("") + "</select>";
  }
  if (f.kind === "checkbox" || f.kind === "radio") {
    const text = f.label || "";
    const bare = f.submitValue !== undefined && !f.label;
    const input = "<input" + (bare ? attrs : "") + attr("type", f.kind) + shared +
      attr("value", f.submitValue ?? (f.kind === "checkbox" ? "true" : text)) + flag("checked", f.checked) + ">";
    if (bare) return input;
    return "<label" + attrs + ">" + input + "<span" + (!ctx.template && hasVars(text) ? attr("data-live", text) : "") +
      fieldParts("text", text) + ">" +
      escapeHtml(text) + "</span></label>";
  }
  if (f.kind === "file") {
    return "<input" + attrs + ' type="file"' + shared + attr("accept", f.accept) +
      flag("multiple", f.multiple) + ">";
  }
  const type = f.inputType || "text";
  const bounds = RANGED_INPUTS.has(type)
    ? attr("min", f.min) + attr("max", f.max) + attr("step", f.step) : "";
  return "<input" + attrs + attr("type", type) + shared + bounds +
    (type === "color" || type === "range" ? "" :
      attr("placeholder", f.placeholder) + dynamic("placeholder", f.placeholder) + fieldParts("placeholder", f.placeholder)) +
    attr("value", f.defaultValue) + dynamic("value", f.defaultValue) + fieldParts("value", f.defaultValue) +
    (TEXT_INPUTS.has(type) ? attr("maxlength", f.maxLength) : "") + ">";
}

function render(ctx: Context, id: string, top: boolean): string {
  const n = ctx.doc.nodes[id];
  if (!n || ctx.seen.has(id)) return "";
  ctx.seen.add(id);
  try {
    if (n.type === "instance") {
      const comp = ctx.doc.components?.[n.componentId || ""];
      if (!comp) return "";
      const master = ctx.doc.nodes[comp.rootId];
      if (!master) return "";
      const old = ctx.instance;
      const hidden = n.hiddenOn?.length ? ctx.classes.get(n.id) : "";
      ctx.instance = {
        id: master.attrId ? undefined : n.attrId,
        hidden: [old?.hidden, hidden].filter(Boolean).join(" "),
      };
      try { return render(ctx, comp.rootId, false); }
      finally { ctx.instance = old; }
    }
    const cls = [ctx.classes.get(id) || "el", importedClass(n.htmlClass)].filter(Boolean).join(" ");
    const commonAttrs = common(ctx, n, cls);
    if (n.type === "divider") return "<hr" + commonAttrs + ">";
    if (n.type === "image" && n.image) {
      const im = n.image;
      const src = im.assetId ? assetMediaUrl(resource(ctx, im.assetId), im.assetSuffix) : sourceHref(ctx, im.src);
      const imageAttrs = attr("src", hasVars(src) ? EMPTY_GIF : (src || EMPTY_GIF)) +
        (!ctx.template && hasVars(src) ? attr("data-live-src", src) : "") +
        (hasVars(src) && ctx.template ? attr("data-image-src-parts", templateParts(src)) : "") +
        attr("alt", im.alt);
      const crisp = crispSvgSize(ctx.doc, n);
      if (crisp) return "<span" + commonAttrs.replace(attr("class", cls), attr("class", "crisp-svg " + cls)) +
        attr("style", "--crisp-svg-width:" + crisp.width + "px;--crisp-svg-ratio:" + crisp.width + "/" + crisp.height) + ">" +
        '<svg aria-hidden="true"' + attr("width", crisp.width) + attr("height", crisp.height) +
        attr("viewBox", "0 0 " + crisp.width + " " + crisp.height) + "></svg>" +
        "<img" + imageAttrs + attr("width", crisp.width * 2) + attr("height", crisp.height * 2) + "></span>";
      return "<img" + commonAttrs + imageAttrs +
        attr("width", im.width || 800) + attr("height", im.height || 500) +
        attr("fetchpriority", im.priority ? "high" : undefined) + ">";
    }
    if (n.type === "code" && n.code) {
      const html = rewriteHtmlAssetUrls(ctx.doc, n.code.html, ctx.assets);
      return "<div" + commonAttrs + ' data-raw="">' +
        rewriteRootUrls(html, ctx.prefix, ctx.assetSources) + "</div>";
    }
    if (n.type === "icon" && n.icon) {
      const html = rewriteHtmlAssetUrls(ctx.doc, n.icon.svg, ctx.assets);
      return "<span" + commonAttrs + ' data-raw="" aria-hidden="true">' +
        rewriteRootUrls(html, ctx.prefix, ctx.assetSources) + "</span>";
    }
    if (n.type === "media" && n.media) {
      const media = n.media;
      const tag = media.kind === "audio" ? "audio" : "video";
      const src = media.assetId ? assetMediaUrl(resource(ctx, media.assetId), media.assetSuffix) : media.src.trim() ? mediaHref(ctx, media.src) : "";
      const sources = (media.sources ?? []).map((source) => {
        const url = source.assetId ? assetMediaUrl(resource(ctx, source.assetId), source.assetSuffix) : source.src.trim() ? mediaHref(ctx, source.src) : "";
        return url.trim() ? "<source" + attr("src", url) + attr("type", source.type) + attr("media", source.media) + ">" : "";
      }).join("");
      if (!src.trim() && !sources) return "";
      return "<" + tag + commonAttrs + attr("src", src.trim() ? src : undefined) + " controls" +
        flag("loop", media.loop) + flag("autoplay", media.autoplay) +
        flag("muted", media.muted || media.autoplay) + (tag === "video" ? " playsinline" : "") +
        ">" + sources + "</" + tag + ">";
    }
    if (n.type === "embed" && n.embed) {
      const src = embedSrc(n.embed);
      if (!src) return "";
      return "<div" + commonAttrs + "><iframe" + attr("src", safeNavigationUrl(src)) +
        ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"' +
        (n.embed.kind === "youtube" ? attr("allow", YOUTUBE_ALLOW) + " allowfullscreen" :
          n.embed.kind === "url" ? " allowfullscreen" : "") +
        ' style="width:100%;height:100%;border:0;display:block"></iframe></div>';
    }
    if (n.type === "field" && n.field) return field(ctx, n, commonAttrs);
    if (n.type === "list" && n.list) {
      const old = ctx.template;
      ctx.template = true;
      let inside = "";
      try { inside = n.children.map((cid) => render(ctx, cid, false)).join("\n"); }
      finally { ctx.template = old; }
      return "<div" + commonAttrs + attr("data-array", listFromOf(n)) +
        attr("data-limit", n.list.limit) + " data-client-list>" +
        '<div data-tpl hidden style="display:none">' + inside + "</div></div>";
    }
    let tag = resolveTag(n, top);
    if (tag === "form" && ctx.form) tag = "div";
    let extra = "";
    if (tag === "p" && hasBlockDescendant(ctx.doc, n)) {
      tag = "div"; extra = ' data-p=""';
    }
    const text = n.text?.content || "";
    if (hasVars(text)) extra += ctx.template
      ? attr("data-text-parts", templateParts(text)) : attr("data-live", text);
    const submission = submissionAttributes(n.htmlAttrs, tag, action => href(ctx, action, true));
    for (const [key, value] of Object.entries(submission)) extra += attr(key, value);
    if (tag === "form" && !submission.method) extra += ' method="get"';
    if (tag === "button" && !submission.type) extra += attr("type",
      ctx.form && !n.scripts?.some((s) => s.trigger === "click") ? "submit" : "button");
    if (n.link) {
      tag = "a";
      const destination = n.link.kind === "page" && n.link.pageId
        ? pageHref(ctx, n.link.pageId) : href(ctx, n.link.url || "#");
      extra += attr("href", destination) +
        (hasVars(destination) ? (ctx.template ? attr("data-href-parts", templateParts(destination, true)) : attr("data-live-href", destination)) : "");
      if (n.link.newTab) extra += ' target="_blank" rel="noopener noreferrer"';
    }
    const wasForm = ctx.form;
    if (tag === "form") ctx.form = true;
    let body = "";
    try {
      body = escapeHtml(text) +
        n.children.map((cid) => render(ctx, cid, false)).join("\n");
    } finally { ctx.form = wasForm; }
    return "<" + tag + commonAttrs + extra + ">" + body + "</" + tag + ">";
  } finally { ctx.seen.delete(id); }
}

/**
 * 共通のブラウザのランタイムが中身を入れられる、データを使うページの本文を描画する。
 * React ではコンポーネントからマウントでき、静的な HTML ではそのまま埋め込める。
 */
function pageFragment(ctx: Context, page: Page): string {
  const plan = pagePlan(ctx.doc, page.id);
  const dataPlan = JSON.stringify(serializePageDataPlan(plan)).replace(/</g, "\\u003c");
  const pageScripts = compiledAttr(ctx, { scripts: page.pageScripts }, plan.serverIds);
  const body = page.children.map((id) => render(ctx, id, true)).join("\n");
  return [
    "<span hidden" + attr("data-page-body", page.id) + pageScripts + "></span>",
    '<script type="application/json" data-page-plan>' + dataPlan + "</script>",
    page.customTopHtml ? rewriteRootUrls(page.customTopHtml, ctx.prefix, ctx.assetSources) : "",
    body,
    page.customEndHtml ? rewriteRootUrls(page.customEndHtml, ctx.prefix, ctx.assetSources) : "",
  ].filter(Boolean).join("\n");
}

function hasBaseHref(html: string | undefined): boolean {
  return !!html && /<base[\t\n\f\r />]/i.test(html) && !!htmlResourceElements(html).baseElement;
}

function staticPageFragment(ctx: Context, page: Page): string {
  const html = pageFragment(ctx, page);
  // A custom code block or a page snippet can also set the base for the whole page.
  return !ctx.authoredBase && hasBaseHref(html) ? pageFragment({ ...ctx, authoredBase: true }, page) : html;
}

function prepareHtmlExport(doc: SiteDoc) {
  const normalized = obfuscateVarNames(doc);
  unnestLinks(normalized);
  applyBreakpoints(normalized);
  raiseOverCrispSvg(normalized);
  const assets = buildAssetNames(normalized);
  return {
    doc: normalized,
    classes: buildClassNames(normalized),
    assets,
    assetSources: exportedAssetSources(normalized, assets),
    toggles: new Set([
      ...Object.values(normalized.nodes).flatMap((n) => scriptTargetIds(n, ["show", "toggle"])),
      ...Object.values(normalized.pages).flatMap((p) =>
        scriptTargetIds({ scripts: p.pageScripts }, ["show", "toggle"])),
    ]),
  };
}

export function createReactPageRenderer(doc: SiteDoc) {
  const shared = prepareHtmlExport(doc);
  return {
    doc: shared.doc,
    renderPage: (pageId: string) => {
      const page = shared.doc.pages[pageId];
      return pageFragment({
        ...shared, page, prefix: "/", single: false, seen: new Set(), form: false, template: false,
      }, page);
    },
  };
}

export function generateStandaloneHtml(doc: SiteDoc, next: GeneratedProject, target: PublishTarget = "production"): GeneratedProject {
  const shared = prepareHtmlExport(doc);
  const { doc: normalized, assets, assetSources } = shared;
  const files: Record<string, string> = {};
  const binaries: Record<string, string> = {};
  const remoteAssets: Record<string, string> = {};

  for (const [path, source] of Object.entries(next.files)) {
    if (!path.startsWith("public/")) continue;
    const output = path.slice(7);
    // Service Worker は file:// からは使えない。それ以外は、そのまま読める。
    files[output] = output.endsWith(".css")
      ? rewriteCssRootUrls(source, pagePrefix(output)) : source;
  }
  for (const [path, binary] of Object.entries(next.binaries)) {
    if (path.startsWith("public/")) binaries[path.slice(7)] = binary;
  }
  for (const [path, source] of Object.entries(next.remoteAssets)) {
    if (path.startsWith("public/")) remoteAssets[path.slice(7)] = source;
  }
  const manifest = buildPwaManifest(normalized, assets);
  if (manifest) {
    files["manifest.webmanifest"] = JSON.stringify(manifest, null, 2) + "\n";
  }
  files["styles/site.css"] = rewriteCssRootUrls(next.files["styles/site.css"], "../");
  files["styles/globals.css"] = googleFontsCss(normalized) + rewriteCssRootUrls(next.files["app/globals.css"], "../");
  // ページの計画は、共通の DOM のランタイムがリスナーを登録する前に実行するため、
  // 取得した変数を、動的なテキストやクライアントのリストで使える。
  files["data-loader.js"] = PAGE_DATA_RUNTIME;
  files["scripts.js"] = scriptsFile(normalized, true);
  files["README.txt"] = [
    "Tsumu standalone HTML export", "",
    "Open index.html directly or copy all files to static hosting.",
    "No npm install, compilation or server framework is required.",
    "Keep folders and asset names intact so relative paths resolve.",
    "Some browser features may require static hosting instead of file://.", "",
  ].join("\n");

  const pages = normalized.pageOrder.map((id) => normalized.pages[id])
    .filter((p) => p && !p.unpublished);
  const single = pages.length === 1;
  const groups = new Map<string, Page[]>();
  for (const page of pages) {
    const key = page.slug.replace(/^\/+|\/+$/g, "");
    const group = groups.get(key);
    if (group) group.push(page);
    else groups.set(key, [page]);
  }
  const authoredBase = hasBaseHref(normalized.customHeadHtml) || hasBaseHref(normalized.customBodyEndHtml);
  let adobeHead: string | undefined;
  const outputPaths = new Set<string>();
  for (const group of groups.values()) {
    const page = group[0];
    const path = pageFilename(page, single);
    if (outputPaths.has(path)) throw new Error("Duplicate HTML output: " + path);
    outputPaths.add(path);
    const prefix = pagePrefix(path);
    if (page.rawHtml?.trim()) {
      // 共通の HTML / CSS の生成処理で描画する。Next.js のルートのファイル名と、
      // 直列化した TypeScript はフレームワークの出力で、ページのデータの元ではない。
      const source = htmlZipSource(page.rawHtml, page.htmlZip, normalized.assets,
        asset => htmlZipExportSource(asset, assets));
      const html = rawHtmlWithBodyStyles(normalized, page, rewriteHtmlAssetUrls(normalized, source, assets), assets, target);
      const base = page.htmlZip && standaloneZipBase(html, path);
      const assetPrefix = base?.prefix ?? prefix;
      let htmlWithScriptAssets = rewriteHtmlZipScriptUrls(html, page.htmlZip, normalized.assets, asset => {
        const url = htmlZipExportUrl(asset, assets);
        return url ? assetPrefix + url.slice(1) : "";
      });
      if (base) {
        // <base> より前にあるスクリプトは、ソースの位置を変えることがある。
        const updated = htmlWithScriptAssets === html ? base : standaloneZipBase(htmlWithScriptAssets, path)!;
        htmlWithScriptAssets = htmlWithScriptAssets.slice(0, updated.location.startOffset) +
          'href="' + escapeHtml(base.href) + '"' + htmlWithScriptAssets.slice(updated.location.endOffset);
      }
      files[path] = rewriteRootUrls(htmlWithScriptAssets, assetPrefix, assetSources, "document");
      continue;
    }
    const ctx: Context = {
      ...shared, page, prefix, single, staticRoutes: groups, authoredBase,
      seen: new Set(), form: false, template: false,
    };
    const allNoindex = target === "production" && group.every((variant) => variant.noindex);
    const body = group.length === 1
      ? staticPageFragment(ctx, page)
      : (() => {
          files["query-router.js"] = QUERY_VARIANT_RUNTIME;
          const variants = group.map((variant) => {
            const context = { ...ctx, page: variant, seen: new Set<string>() };
            return {
              query: Object.fromEntries(pageQueryConditions(variant.query)),
              title: variant.title || variant.name,
              description: variant.description,
              noindex: target === "production" && !allNoindex && !!variant.noindex,
              lang: variant.lang || normalized.lang || "ja",
              html: staticPageFragment(context, variant),
            };
          });
          return '<script type="application/json" data-page-variants>' +
            JSON.stringify(variants).replace(/</g, "\\u003c") + '</script>' +
            '<div data-variant-root style="display:contents"></div>';
        })();
    const icon = normalized.favicon?.assetId ? resource(ctx, normalized.favicon.assetId) :
      normalized.favicon?.url ? sourceHref(ctx, normalized.favicon.url) : "";
    const appleIcon = normalized.appleTouchIcon?.assetId ? resource(ctx, normalized.appleTouchIcon.assetId) :
      normalized.appleTouchIcon?.url ? sourceHref(ctx, normalized.appleTouchIcon.url) : "";
    const ogRef = page.ogImage ?? normalized.ogImage;
    const ogSrc = ogRef?.assetId ? resource(ctx, ogRef.assetId) :
      ogRef?.url ? sourceHref(ctx, ogRef.url) : "";
    const pwaThemeColor = normalized.pwa?.enabled ? normalized.pwa.themeColor?.trim() : "";
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>" + escapeHtml(page.title || page.name) + "</title>",
      group.some((variant) => variant.description) ? '<meta name="description" content="' + escapeHtml(page.description || "") + '">' : "",
      allNoindex ? '<meta name="robots" content="noindex,nofollow">' : "",
      icon && icon !== "#" ? '<link rel="icon"' + attr("href", icon) + ">" : "",
      appleIcon && appleIcon !== "#" ? '<link rel="apple-touch-icon"' + attr("href", appleIcon) + ">" : "",
      ogSrc && ogSrc !== "#" ? '<meta property="og:image"' + attr("content", ogSrc) + ">" : "",
      ogSrc && ogSrc !== "#" ? '<meta name="twitter:card" content="summary_large_image">' : "",
      normalized.pwa?.enabled ? '<link rel="manifest" href="' + prefix + 'manifest.webmanifest">' : "",
      pwaThemeColor ? '<meta name="theme-color"' + attr("content", pwaThemeColor) + ">" : "",
      '<link rel="stylesheet" href="' + prefix + 'styles/globals.css">',
      '<link rel="stylesheet" href="' + prefix + 'styles/site.css">',
      adobeHead ??= adobeFontHead(normalized),
      normalized.customHeadHtml || "",
    ].filter(Boolean).join("\n");
    const scriptNames = ["inview.js", "data-loader.js", "scripts.js", "pwa.js"]
      .filter((name) => name in files);
    // クエリ違いのページは、書かれたページの断片を実行時に挿入する。その中のスクリプトは
    // そのままでは動かないため、ルートの選択でそれらを先に再実行し、
    // その後で、共通のデータとイベントのランタイムを通常の順序で読み込む。
    const scripts = group.length > 1
      ? '<script defer src="' + prefix + 'query-router.js"' +
        attr("data-runtime-sources", JSON.stringify(scriptNames.map((name) => prefix + name))) +
        '></script>'
      : scriptNames.map((name) =>
          '<script defer src="' + prefix + name + '"></script>').join("\n");
    files[path] = [
      "<!doctype html>",
      '<html lang="' + escapeHtml(page.lang || normalized.lang || "ja") + '">',
      "<head>", rewriteRootUrls(head, prefix, assetSources), "</head>",
      "<body>",
      body,
      normalized.customBodyEndHtml ? rewriteRootUrls(normalized.customBodyEndHtml, prefix, assetSources) : "",
      scripts, "</body>", "</html>", "",
    ].join("\n");
  }
  // 公開するページに専用のルートが無くても、アーカイブに必ず開ける入口を用意する。
  if (!files["index.html"] && pages.length) {
    const first = pageFilename(pages[0], false);
    const target = "./" + first;
    files["index.html"] = '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="0;url=' + escapeHtml(target) + '">' +
      '</head><body><a href="' + escapeHtml(target) + '">Open site</a></body></html>';
  }
  return { files, binaries, remoteAssets };
}
