/**
 * Native, build-free HTML/CSS/JavaScript export. No framework source is shipped.
 * Use the same normalized document and generated CSS/assets as the Next.js export.
 */
import type { DocNode, Page, SiteDoc } from "../types";
import type { GeneratedProject } from "../generator";
import { obfuscateVarNames, pagePlan } from "../data";
import { applyBreakpoints, toggleShowDisplay } from "../style";
import { buildAssetNames, buildClassNames } from "./names";
import { assetSrc } from "../assets";
import { importedAssetUrl, isZipJavascript } from "./imported-assets";
import { usedGoogleFonts } from "./css";
import { crispSvgSize, hasBlockDescendant, raiseOverCrispSvg, showsSelf } from "./render-helpers";
import { unnestLinks } from "./page";
import { hasVars } from "../vars";
import { fieldVarName, RANGED_INPUTS, TEXT_INPUTS } from "../fields";
import { resolveTag } from "../tags";
import { compileScripts, hasRunnableScripts, scriptTargetIds } from "../script";
import { embedSrc, YOUTUBE_ALLOW } from "../embed";
import { EMPTY_GIF, pwaIconType } from "./templates";
import { scriptsFile } from "../script-runtime";
import { PAGE_DATA_RUNTIME, pageDataPlan, pageDataServerIds } from "./browser-data";
import { QUERY_VARIANT_RUNTIME } from "./query-route";
import { safeNavigationUrl, safeResourceUrl } from "../url-policy";
import { importedAttributes, importedClass } from "../imported-html-attrs";
import { rewriteCssAssetUrls } from "../css-assets";

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

/** Rewrite only root-relative CSS resource references. */
function rewriteCssRootUrls(source: string, prefix: string): string {
  return rewriteCssAssetUrls(source, (url) =>
    url.startsWith("/") && !url.startsWith("//") ? prefix + url.slice(1) : undefined
  );
}

function importedScriptSources(doc: SiteDoc): Map<string, string> {
  const sources = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    if (!isZipJavascript(asset)) continue;
    const url = importedAssetUrl(asset), src = assetSrc(asset);
    if (url && src) sources.set(src, sources.has(src) && sources.get(src) !== url ? "" : url);
  }
  return sources;
}

/**
 * Rewrite actual HTML attributes and inline CSS, never script text, comments,
 * text nodes, or values of unrelated attributes that happen to contain markup.
 */
function rewriteRootUrls(source: string, prefix: string, scriptSources: Map<string, string>): string {
  const rewriteTag = (tag: string) => tag.replace(
    /(\s)([^\s=/>]+)(\s*=\s*)(["'])([\s\S]*?)\4/g,
    (whole, space: string, name: string, eq: string, quote: string, value: string) => {
      const attribute = name.toLowerCase();
      if (attribute === "src" && /^<script(?=[\t\n\f\r />])/i.test(tag)) {
        const suffix = value.startsWith("/api/assets/file?path=") ? value.search(/[&#]/) : value.indexOf("#");
        const source = suffix < 0 ? value : value.slice(0, suffix);
        const mapped = scriptSources.get(source);
        if (mapped === "") throw new Error("Ambiguous ZIP script location. Give the imported entry scripts distinct URLs.");
        if (mapped) {
          const tail = suffix < 0 ? "" : value.slice(suffix).replace(/^&(?:amp;)?/, "?");
          return space + name + eq + quote + prefix + mapped.slice(1) + tail + quote;
        }
      }
      const next = attribute === "style"
        ? rewriteCssRootUrls(value, prefix)
        : (attribute === "src" || attribute === "href" || attribute === "poster") &&
          value.startsWith("/") && !value.startsWith("//")
          ? prefix + value.slice(1)
          : value;
      return next === value ? whole : space + name + eq + quote + next + quote;
    },
  );
  return source.replace(
    /<!--[\s\S]*?(?:-->|$)|(<(script|style|textarea|title|xmp|iframe|noembed|noframes)(?=[\t\n\f\r />])(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)(<\/\2\s*>|$)|<[a-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/gi,
    (whole, open: string | undefined, kind: string | undefined, body: string | undefined, close: string | undefined) => {
      if (whole.startsWith("<!--")) return whole;
      if (!open) return rewriteTag(whole);
      return rewriteTag(open) +
        (kind?.toLowerCase() === "style" ? rewriteCssRootUrls(body ?? "", prefix) : body ?? "") +
        (close ?? "");
    },
  );
}

/** Preserve list item tokens until Tsumu's browser runtime clones each row. */
function templateParts(value: string): string {
  const out: (string | { name: string })[] = [];
  let from = 0;
  for (const m of value.matchAll(/\\\{|\{([^{}\s"'<>]+)\}|\[slug\]/g)) {
    const at = m.index ?? 0;
    out.push(value.slice(from, at));
    out.push(m[0] === "\\{" ? "{" : { name: m[1] ?? "slug" });
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
  scriptSources: Map<string, string>;
  toggles: Set<string>;
  seen: Set<string>;
  form: boolean;
  template: boolean;
  instance?: { id?: string; hidden?: string };
  spa?: boolean;
};

function resource(ctx: Context, assetId?: string): string {
  const name = ctx.assets.get(assetId || "");
  return name ? (ctx.spa ? "/assets/" : ctx.prefix + "assets/") + name : "";
}

function href(ctx: Context, value: string): string {
  const safe = safeNavigationUrl(value);
  if (ctx.spa || !/^\/(?!\/)/.test(safe)) return safe;
  const match = /^([^?#]*)(.*)$/.exec(safe);
  const slug = (match?.[1] ?? safe).replace(/^\/+|\/+$/g, "");
  const page = Object.values(ctx.doc.pages).find((p) =>
    !p.unpublished && p.slug.replace(/^\/+|\/+$/g, "") === slug
  );
  if (page) return pageHref(ctx, page.id) + (match?.[2] ?? "");
  return ctx.prefix + safe.replace(/^\/+/, "");
}

/** A media source can be inline data or a site-local file, never an active URL scheme. */
function sourceHref(ctx: Context, value: string): string {
  const safe = safeResourceUrl(value);
  // Media paths are file references, not page links. Never resolve a coincident
  // page slug to index.html when the source actually points to an asset.
  return !ctx.spa && /^\/(?!\/)/.test(safe)
    ? ctx.prefix + safe.replace(/^\/+/, "") : safe;
}

function pageHref(ctx: Context, id: string): string {
  const p = ctx.doc.pages[id];
  if (!p) return "#";
  const suffix = p.query?.trim().replace(/^\?/, "");
  const withQuery = (url: string) => suffix ? url + (url.includes("?") ? "&" : "?") + suffix : url;
  if (ctx.spa) return withQuery("/" + p.slug.replace(/^\/+|\/+$/g, ""));
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
  const name = fieldVarName(n);
  const shared = attr("name", name || undefined) + flag("required", f.required) + flag("disabled", f.disabled);
  const dynamic = (key: string, value?: string) => value && hasVars(value)
    ? attr("data-live-" + key, value) : "";
  if (f.kind === "submit") {
    const label = f.label || "送信";
    return "<button" + attrs + ' type="submit"' + shared +
      (hasVars(label) ? attr("data-live", label) : "") + ">" + escapeHtml(label) + "</button>";
  }
  if (f.kind === "textarea") {
    return "<textarea" + attrs + shared + attr("placeholder", f.placeholder) +
      dynamic("placeholder", f.placeholder) +
      attr("rows", f.rows) + attr("maxlength", f.maxLength) +
      dynamic("value", f.defaultValue) +
      (f.defaultValue && ctx.template && hasVars(f.defaultValue) ? attr("data-field-value-parts", templateParts(f.defaultValue)) : "") + ">" +
      escapeHtml(f.defaultValue || "") + "</textarea>";
  }
  if (f.kind === "select") {
    const values = f.options || [];
    const selected = f.defaultValue && values.some((o) => o.value === f.defaultValue)
      ? f.defaultValue : values[0]?.value;
    return "<select" + attrs + shared + ">" + values.map((o) =>
      "<option" + attr("value", o.value) + flag("selected", o.value === selected) +
      (hasVars(o.value) ? attr("data-live-value", o.value) : "") +
      (hasVars(o.label) ? attr("data-static-option", o.label) : "") +
      (hasVars(o.label) && ctx.template ? attr("data-field-text-parts", templateParts(o.label)) : "") +
      ">" + escapeHtml(o.label) + "</option>").join("") + "</select>";
  }
  if (f.kind === "checkbox" || f.kind === "radio") {
    const text = f.label || "";
    return "<label" + attrs + "><input" + attr("type", f.kind) + shared +
      attr("value", f.kind === "checkbox" ? "true" : text) + flag("checked", f.checked) + ">" +
      "<span" + (hasVars(text) ? attr("data-live", text) : "") +
      (hasVars(text) && ctx.template ? attr("data-field-text-parts", templateParts(text)) : "") + ">" +
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
      attr("placeholder", f.placeholder) + dynamic("placeholder", f.placeholder)) +
    attr("value", f.defaultValue) + dynamic("value", f.defaultValue) +
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
      const src = im.assetId ? resource(ctx, im.assetId) : sourceHref(ctx, im.src);
      const imageAttrs = attr("src", hasVars(src) ? EMPTY_GIF : (src || EMPTY_GIF)) +
        (hasVars(src) ? attr("data-static-src", src) : "") +
        (hasVars(src) && ctx.template ? attr("data-image-src-parts", templateParts(src)) : "") +
        attr("alt", im.alt);
      const crisp = crispSvgSize(ctx.doc, n);
      if (crisp) return "<span" + commonAttrs.replace(attr("class", cls), attr("class", "crisp-svg " + cls)) + ">" +
        '<svg aria-hidden="true" width="' + crisp.width + '" height="' + crisp.height +
        '" viewBox="0 0 ' + crisp.width + " " + crisp.height + '"></svg>' +
        "<img" + imageAttrs + attr("width", crisp.width * 2) + attr("height", crisp.height * 2) + "></span>";
      return "<img" + commonAttrs + imageAttrs +
        attr("width", im.width || 800) + attr("height", im.height || 500) +
        attr("fetchpriority", im.priority ? "high" : undefined) + ">";
    }
    if (n.type === "code" && n.code) {
      return "<div" + commonAttrs + ' data-raw="">' +
        rewriteRootUrls(n.code.html, ctx.prefix, ctx.scriptSources) + "</div>";
    }
    if (n.type === "icon" && n.icon) {
      return "<span" + commonAttrs + ' data-raw="" aria-hidden="true">' + n.icon.svg + "</span>";
    }
    if (n.type === "media" && n.media) {
      const media = n.media;
      const tag = media.kind === "audio" ? "audio" : "video";
      const src = media.assetId ? resource(ctx, media.assetId) : sourceHref(ctx, media.src);
      if (!src) return "";
      return "<" + tag + commonAttrs + attr("src", src) + " controls" +
        flag("loop", media.loop) + flag("autoplay", media.autoplay) +
        flag("muted", media.muted || media.autoplay) + (tag === "video" ? " playsinline" : "") +
        "></" + tag + ">";
    }
    if (n.type === "embed" && n.embed) {
      const src = embedSrc(n.embed);
      if (!src) return "";
      return "<div" + commonAttrs + "><iframe" + attr("src", src) +
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
      return "<div" + commonAttrs + attr("data-array", n.list.from) +
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
    if (tag === "form") extra += ' method="get"';
    if (tag === "button") extra += attr("type",
      ctx.form && !n.scripts?.some((s) => s.trigger === "click") ? "submit" : "button");
    if (n.link) {
      tag = "a";
      const destination = n.link.kind === "page" && n.link.pageId
        ? pageHref(ctx, n.link.pageId) : href(ctx, n.link.url || "#");
      extra += attr("href", destination) +
        (hasVars(destination) ? attr("data-static-href", destination) : "");
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

/** Raw HTML pages already contain their complete original document. */
function importedHtml(next: GeneratedProject, page: Page): string {
  const slug = page.slug.replace(/^\/+|\/+$/g, "");
  const source = next.files["app/" + (slug ? slug + "/" : "") + "route.ts"];
  const match = /^const html = (.+);$/m.exec(source || "");
  if (!match) throw new Error("Could not read HTML page: " + page.name);
  return JSON.parse(match[1]) as string;
}

/**
 * Render a data-driven page body that the shared browser runtime can populate.
 * React can mount it through a component, and static HTML can embed it directly.
 */
function pageFragment(ctx: Context, page: Page): string {
  const dataPlan = JSON.stringify(pageDataPlan(ctx.doc, page)).replace(/</g, "\\u003c");
  const pageScripts = compiledAttr(ctx, { scripts: page.pageScripts }, pageDataServerIds(ctx.doc, page));
  const body = page.children.map((id) => render(ctx, id, true)).join("\n");
  return [
    "<span hidden" + attr("data-page-body", page.id) + pageScripts + "></span>",
    '<script type="application/json" data-page-plan>' + dataPlan + "</script>",
    page.customTopHtml ? rewriteRootUrls(page.customTopHtml, ctx.prefix, ctx.scriptSources) : "",
    body,
    page.customEndHtml ? rewriteRootUrls(page.customEndHtml, ctx.prefix, ctx.scriptSources) : "",
  ].filter(Boolean).join("\n");
}

export function reactClientPageFragment(doc: SiteDoc, page: Page): string {
  const normalized = obfuscateVarNames(doc);
  unnestLinks(normalized);
  applyBreakpoints(normalized);
  raiseOverCrispSvg(normalized);
  const ctx: Context = {
    doc: normalized,
    page: normalized.pages[page.id],
    prefix: "/",
    single: false,
    spa: true,
    classes: buildClassNames(normalized),
    assets: buildAssetNames(normalized),
    scriptSources: importedScriptSources(normalized),
    toggles: new Set([
      ...Object.values(normalized.nodes).flatMap((n) => scriptTargetIds(n, ["show", "toggle"])),
      ...Object.values(normalized.pages).flatMap((p) =>
        scriptTargetIds({ scripts: p.pageScripts }, ["show", "toggle"])),
    ]),
    seen: new Set(),
    form: false,
    template: false,
  };
  return pageFragment(ctx, ctx.page);
}

/** Quote a font name as a single CSS string token. */
function cssQuoted(value: string): string {
  return '"' + value.replace(/[\x00-\x1f\x7f"\\]/g, (char) =>
    "\\" + char.codePointAt(0)!.toString(16) + " ") + '"';
}

function fontsCss(doc: SiteDoc): string {
  const fonts = usedGoogleFonts(doc);
  const imports = fonts.map((f) => {
    const g = f.google!;
    return '@import url("https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(f.value).replace(/%20/g, "+") + ':wght@' +
      (g.weights?.length ? g.weights.join(";") : "400") + '&display=swap");';
  });
  const variables = fonts.filter((f) => /^--[\w-]+$/.test(f.google!.cssVar)).map((f) =>
    "  " + f.google!.cssVar + ": " + cssQuoted(f.value) + ", sans-serif;");
  return imports.join("\n") + (variables.length ? "\n:root {\n" + variables.join("\n") + "\n}" : "");
}

export function generateStandaloneHtml(doc: SiteDoc, next: GeneratedProject): GeneratedProject {
  const normalized = obfuscateVarNames(doc);
  unnestLinks(normalized);
  applyBreakpoints(normalized);
  raiseOverCrispSvg(normalized);
  const classes = buildClassNames(normalized);
  const assets = buildAssetNames(normalized);
  const scriptSources = importedScriptSources(normalized);
  const files: Record<string, string> = {};
  const binaries: Record<string, string> = {};
  const remoteAssets: Record<string, string> = {};

  for (const [path, source] of Object.entries(next.files)) {
    if (!path.startsWith("public/")) continue;
    const output = path.slice(7);
    // Service workers are not usable from file://. The rest is directly readable.
    files[output] = output.endsWith(".css")
      ? rewriteCssRootUrls(source, output.startsWith("assets/") ? "./" : "../") : source;
  }
  for (const [path, binary] of Object.entries(next.binaries)) {
    if (path.startsWith("public/")) binaries[path.slice(7)] = binary;
  }
  for (const [path, source] of Object.entries(next.remoteAssets)) {
    if (path.startsWith("public/")) remoteAssets[path.slice(7)] = source;
  }
  if (normalized.pwa?.enabled) {
    const pwa = normalized.pwa;
    const candidate = [pwa.icon, normalized.appleTouchIcon, normalized.favicon]
      .find((x) => x && (x.assetId ? assets.has(x.assetId) : !!x.url));
    const iconSrc = candidate?.assetId ? "/assets/" + assets.get(candidate.assetId) : candidate?.url || "";
    const iconAsset = candidate?.assetId ? normalized.assets[candidate.assetId] : undefined;
    files["manifest.webmanifest"] = JSON.stringify({
      name: pwa.name?.trim() || normalized.siteName,
      short_name: pwa.shortName?.trim() || normalized.siteName,
      start_url: "/", scope: "/",
      display: pwa.display ?? "standalone",
      lang: normalized.lang || "ja",
      ...(pwa.themeColor?.trim() ? { theme_color: pwa.themeColor.trim() } : {}),
      ...(pwa.backgroundColor?.trim() ? { background_color: pwa.backgroundColor.trim() } : {}),
      icons: iconSrc ? [{
        src: iconSrc,
        sizes: iconAsset?.width && iconAsset?.height ?
          iconAsset.width + "x" + iconAsset.height : "any",
        ...(pwaIconType(iconAsset?.mimeType, iconSrc) ?
          { type: pwaIconType(iconAsset?.mimeType, iconSrc) } : {}),
        purpose: "any",
      }] : [],
    }, null, 2) + "\n";
  }
  files["styles/site.css"] = rewriteCssRootUrls(next.files["styles/site.css"], "../");
  files["styles/globals.css"] = fontsCss(normalized) + "\n" + next.files["app/globals.css"];
  // The page plan runs before the shared DOM runtime installs listeners,
  // so its fetched variables are available for live text and client lists.
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
    groups.set(key, [...(groups.get(key) ?? []), page]);
  }
  const outputPaths = new Set<string>();
  const toggles = new Set([
    ...Object.values(normalized.nodes).flatMap((n) => scriptTargetIds(n, ["show", "toggle"])),
    ...Object.values(normalized.pages).flatMap((p) =>
      scriptTargetIds({ scripts: p.pageScripts }, ["show", "toggle"])),
  ]);
  for (const group of groups.values()) {
    const page = group[0];
    const path = pageFilename(page, single);
    if (outputPaths.has(path)) throw new Error("Duplicate HTML output: " + path);
    outputPaths.add(path);
    const prefix = pagePrefix(path);
    if (page.rawHtml?.trim()) {
      files[path] = rewriteRootUrls(importedHtml(next, page), prefix, scriptSources);
      continue;
    }
    const ctx: Context = {
      doc: normalized, page, prefix, single, classes, assets, scriptSources, toggles,
      seen: new Set(), form: false, template: false,
    };
    const body = group.length === 1
      ? pageFragment(ctx, page)
      : (() => {
          files["query-router.js"] = QUERY_VARIANT_RUNTIME;
          const variants = group.map((variant) => {
            const context = { ...ctx, page: variant, seen: new Set<string>() };
            return {
              query: Object.fromEntries(new URLSearchParams(variant.query ?? "")),
              title: variant.title || variant.name,
              description: variant.description,
              lang: variant.lang || normalized.lang || "ja",
              html: pageFragment(context, variant),
            };
          });
          return '<script type="application/json" data-page-variants>' +
            JSON.stringify(variants).replace(/</g, "\\u003c") + '</script>' +
            '<div data-variant-root style="display:contents"></div>';
        })();
    const icon = normalized.favicon?.assetId ? resource(ctx, normalized.favicon.assetId) :
      normalized.favicon?.url ? href(ctx, normalized.favicon.url) : "";
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>" + escapeHtml(page.title || page.name) + "</title>",
      page.description ? '<meta name="description" content="' + escapeHtml(page.description) + '">' : "",
      page.noindex ? '<meta name="robots" content="noindex,nofollow">' : "",
      icon ? '<link rel="icon"' + attr("href", icon) + ">" : "",
      normalized.pwa?.enabled ? '<link rel="manifest" href="' + prefix + 'manifest.webmanifest">' : "",
      '<link rel="stylesheet" href="' + prefix + 'styles/globals.css">',
      '<link rel="stylesheet" href="' + prefix + 'styles/site.css">',
      normalized.customHeadHtml || "",
    ].filter(Boolean).join("\n");
    const scriptNames = ["inview.js", "data-loader.js", "scripts.js", "pwa.js"]
      .filter((name) => name in files);
    // Query variants insert authored page fragments at runtime. Their scripts
    // are otherwise inert, so route selection must replay them first and then
    // load the shared data/event runtimes in the usual order.
    const scripts = group.length > 1
      ? '<script defer src="' + prefix + 'query-router.js"' +
        attr("data-runtime-sources", JSON.stringify(scriptNames.map((name) => prefix + name))) +
        '></script>'
      : scriptNames.map((name) =>
          '<script defer src="' + prefix + name + '"></script>').join("\n");
    files[path] = [
      "<!doctype html>",
      '<html lang="' + escapeHtml(page.lang || normalized.lang || "ja") + '">',
      "<head>", rewriteRootUrls(head, prefix, scriptSources), "</head>",
      "<body>",
      body,
      normalized.customBodyEndHtml ? rewriteRootUrls(normalized.customBodyEndHtml, prefix, scriptSources) : "",
      scripts, "</body>", "</html>", "",
    ].join("\n");
  }
  // Ensure the archive always has an openable entry point, even when the
  // published pages have no dedicated root route.
  if (!files["index.html"] && pages.length) {
    const first = pageFilename(pages[0], false);
    const target = "./" + first;
    files["index.html"] = '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="0;url=' + escapeHtml(target) + '">' +
      '</head><body><a href="' + escapeHtml(target) + '">Open site</a></body></html>';
  }
  return { files, binaries, remoteAssets };
}
