import { fieldSubmissionAttributes, submissionAttributes } from "../imported-form";
import { imageSrcset } from "../srcset";
import { assetMediaUrl } from "../media-url";
import { socialImageSrc } from "./social-image";
import type { PublishTarget } from "../generator";
import type { SiteDoc, Page, DocNode } from "../types";
import { idVarNodesOf, listFromOf, obfuscateVarNames, pagePlan } from "../data";
import { buildClassNames, buildAssetNames } from "./names";
import { unnestLinks } from "./page";
import { applyBreakpoints, toggleShowDisplay } from "../style";
import { crispSvgSize, hasBlockDescendant, raiseOverCrispSvg, showsSelf } from "./render-helpers";
import { selectDefaultValue, fieldDefaults, fieldSubmissionName, fieldVarName, RANGED_INPUTS, TEXT_INPUTS } from "../fields";
import { resolveTag } from "../tags";
import { hasVars } from "../vars";
import { pageQueryConditions } from "../page-query";
import { compileScripts, EMPTY_GIF, hasRunnableScripts, listFilterFields, scriptTargetIds } from "../script";
import { embedSrc, YOUTUBE_ALLOW } from "../embed";
import { safeMediaUrl, safeNavigationUrl, safeResourceUrl } from "../url-policy";
import { serializePageDataPlan } from "./browser-data";
import { importedAttributes, importedClass } from "../imported-html-attrs";
import { rewriteHtmlAssetUrls } from "./css";

type NativeLanguage = "typescript" | "javascript";
type NativeView = "vue" | "sveltekit";

type Context = {
  doc: SiteDoc;
  vue: boolean;
  classes: Map<string, string>;
  assets: Map<string, string>;
  components: Map<string, string>;
  toggles: Set<string>;
  filterFields: Map<string, Set<string>>;
  imports: Set<string>;
  code: string[];
  seen: Set<string>;
  inForm: boolean;
  rows: string[];
  componentRootId?: string;
  level: number;
};

// JavaScript の文字列リテラルの中でも、SFC の区切りをエスケープする。Vue では、
// 差し込みは {{...}} で区切られ、そのままの </script> は SFC を終わらせてしまう。
const q = (value: unknown) => JSON.stringify(value)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
  .replace(/\{/g, "\\u007b").replace(/\}/g, "\\u007d");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Vue はテキストの中の {{...}} を、Svelte はテキストと属性の中の {...} を解析する。
// 書かれたプレーンテキストが決して実行されないよう、波括弧を HTML の文字参照にする。
const staticText = (s: string) => esc(s).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");

function literal(key: string, value: string | number | undefined | null): string {
  return value == null ? "" : " " + key + '="' + staticText(String(value)) + '"';
}
function truth(key: string, value: boolean | undefined): string {
  return value ? " " + key : "";
}
function expr(ctx: Context, fn: string, template: string): string {
  return fn + "(" + q(template) + ", scope" +
    (ctx.rows.length ? ", " + ctx.rows.join(", ") : "") + ")";
}
function dynamicAttr(ctx: Context, name: string, expression: string): string {
  if (!ctx.vue) return " " + name + "={" + expression + "}";
  // vue-tsc reads bound expressions as TypeScript. Keep JSON string delimiters literal.
  const quote = expression.includes('"') ? "'" : '"';
  const source = expression.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
  return " :" + name + "=" + quote + source + quote;
}
function valueAttr(ctx: Context, name: string, value: string | undefined): string {
  if (!value) return value === "" ? literal(name, "") : "";
  if (hasVars(value)) return dynamicAttr(ctx, name, expr(ctx, "resolveText", value));
  return literal(name, value);
}
function srcAttr(ctx: Context, name: string, value: string, mediaResource = false): string {
  return hasVars(value)
    ? dynamicAttr(ctx, name, expr(ctx, mediaResource ? "resolveResourceUrl" : "resolveUrl", value))
    : literal(name, mediaResource ? safeResourceUrl(value) : safeNavigationUrl(value));
}

function pageHref(ctx: Context, id: string): string {
  const page = ctx.doc.pages[id];
  if (!page) return "#";
  const base = "/" + page.slug.replace(/^\/+|\/+$/g, "");
  return page.query ? base + "?" + page.query.replace(/^\?/, "") : base;
}

function compiled(ctx: Context, node: Pick<DocNode, "scripts">, skip?: Set<string>): string {
  if (!hasRunnableScripts(node)) return "";
  const scripts = compileScripts(node, (id) => pageHref(ctx, id), (str) => str, false, skip);
  return scripts.length ? literal("data-scripts", JSON.stringify(scripts)) : "";
}

function common(ctx: Context, node: DocNode, className: string): string {
  const root = node.id === ctx.componentRootId && node.type !== "instance";
  const show = (node.attrId && ctx.toggles.has(node.attrId)) || showsSelf(node);
  const retained = Object.entries(importedAttributes(node.htmlAttrs))
    .map(([key, value]) => literal(key === "htmlFor" ? "for" : key === "tabIndex" ? "tabindex" : key, value))
    .join("");
  return literal("class", className) + (root ? ' data-component-root=""' : "") +
    (root && !node.attrId ? dynamicAttr(ctx, "id", "instanceId") : literal("id", node.attrId)) + retained +
    (show ? literal("data-toggle-show", node.type === "instance" ? "contents" : toggleShowDisplay(node)) : root && !node.attrId
      ? dynamicAttr(ctx, "data-toggle-show", "instanceId ? " + q(toggleShowDisplay(node)) + " : undefined") : "") +
    (node.motions?.some((m) => m.trigger === "in-view") ? " data-inview" : "") +
    compiled(ctx, node);
}

/** フレームワーク固有の要素のテンプレートの唯一の例外は、利用者が書いた生の HTML。 */
function rawNode(ctx: Context, html: string, attrs = "", tag = "div"): string {
  const name = "rawBlock" + ctx.code.length;
  // 埋め込みの HTML や SVG も、通常のメディアのノードと同じ書き出したリソースを使う。
  ctx.code.push("const " + name + " = " + q(rewriteHtmlAssetUrls(ctx.doc, html, ctx.assets)) + ";");
  if (ctx.vue) return "<" + tag + attrs + ' v-html="' + name + '"></' + tag + ">";
  return "<" + tag + attrs + ">{@html " + name + "}</" + tag + ">";
}

function node(ctx: Context, id: string, top = false): string {
  const n = ctx.doc.nodes[id];
  if (!n || ctx.seen.has(id)) return "";
  ctx.seen.add(id);
  try {
    if (n.type === "instance") {
      const comp = ctx.components.get(n.componentId || "");
      if (!comp) return "";
      ctx.imports.add(comp);
      const scope = ctx.rows.length ? "scopeOf(scope, " + ctx.rows.join(", ") + ")" : "scope";
      const master = ctx.doc.components?.[n.componentId || ""];
      const root = master && ctx.doc.nodes[master.rootId];
      const anchor = !ctx.componentRootId && root && root.type !== "instance" && !root.attrId ? n.attrId : undefined;
      const placement = literal(ctx.vue ? "instance-id" : "instanceId", anchor);
      const body = ctx.vue ? "<" + comp + ' :scope="' + esc(scope) + '" :list-ops="listOps"' + placement + " />"
        : "<" + comp + " scope={" + scope + "} {listOps}" + placement + " />";
      // Instance-specific attributes and handlers retain their wrapper; the visible master owns the anchor.
      const wrapper = common(ctx, { ...n, attrId: undefined }, [ctx.classes.get(id) || "el", importedClass(n.htmlClass)].filter(Boolean).join(" "));
      const hidden = n.hiddenOn?.length ? literal("data-instance-hidden", ctx.classes.get(id) || "el") : "";
      return '<div style="display:contents"' + wrapper + hidden + ">" + body + "</div>";
    }

    const cls = [ctx.classes.get(id) || "el", importedClass(n.htmlClass)].filter(Boolean).join(" ");
    const attrs = common(ctx, n, cls);
    if (n.type === "divider") return "<hr" + attrs + (ctx.vue ? ">" : " />");
    if (n.type === "image" && n.image) {
      const im = n.image;
      const source = im.assetId && ctx.assets.get(im.assetId) ?
        assetMediaUrl("/assets/" + ctx.assets.get(im.assetId), im.assetSuffix) : im.src;
      const safeStatic = source ? safeResourceUrl(source) : "";
      const candidates = imageSrcset(im.candidates, item => item.assetId && ctx.assets.has(item.assetId)
        ? assetMediaUrl("/assets/" + ctx.assets.get(item.assetId), item.assetSuffix) : item.src);
      const imageSrc = literal("loading", im.loading) + literal("sizes", im.sizes) + literal("srcset", candidates) + (hasVars(source)
        ? srcAttr(ctx, "src", source, true)
        : literal("src", !safeStatic || safeStatic === "#" ? (candidates ? undefined : EMPTY_GIF) : safeStatic));
      const crisp = crispSvgSize(ctx.doc, n);
      if (crisp) {
        return "<span" + attrs.replace(literal("class", cls), literal("class", "crisp-svg " + cls)) +
          literal("style", "--crisp-svg-width:" + crisp.width + "px;--crisp-svg-ratio:" + crisp.width + "/" + crisp.height) + ">" +
          '<svg aria-hidden="true"' + literal("width", crisp.width) + literal("height", crisp.height) +
          literal("viewBox", "0 0 " + crisp.width + " " + crisp.height) + "></svg>" +
          "<img" + imageSrc + literal("alt", im.alt) +
          literal("width", crisp.width * 2) + literal("height", crisp.height * 2) +
          literal("fetchpriority", im.priority ? "high" : undefined) +
          (ctx.vue ? ">" : " />") + "</span>";
      }
      return "<img" + attrs + imageSrc + literal("alt", im.alt) +
        literal("width", im.width || 800) + literal("height", im.height || 500) +
        literal("fetchpriority", im.priority ? "high" : undefined) +
        (ctx.vue ? ">" : " />");
    }
    if (n.type === "code" && n.code) return rawNode(ctx, n.code.html, attrs);
    if (n.type === "icon" && n.icon) return rawNode(ctx, n.icon.svg, attrs + ' aria-hidden="true"', "span");
    if (n.type === "media" && n.media) {
      const media = n.media;
      const tag = media.kind === "audio" ? "audio" : "video";
      const source = media.assetId && ctx.assets.get(media.assetId) ?
        assetMediaUrl("/assets/" + ctx.assets.get(media.assetId), media.assetSuffix) : media.src;
      const safeSrc = source.trim() ? safeMediaUrl(source) : "";
      const sources = (media.sources ?? []).map((item) => {
        const url = item.assetId && ctx.assets.get(item.assetId) ?
          assetMediaUrl("/assets/" + ctx.assets.get(item.assetId), item.assetSuffix) : item.src;
        return url.trim() ? "<source" + literal("src", safeMediaUrl(url)) + literal("type", item.type) +
          literal("media", item.media) + (ctx.vue ? ">" : " />") : "";
      }).join("");
      if (!safeSrc && !sources) return "";
      return "<" + tag + attrs + (safeSrc ? literal("src", safeSrc) : "") + " controls" +
        truth("autoplay", media.autoplay) + truth("loop", media.loop) +
        truth("muted", media.muted || media.autoplay) +
        (tag === "video" ? " playsinline" : "") + ">" + sources + "</" + tag + ">";
    }
    if (n.type === "embed" && n.embed) {
      const url = embedSrc(n.embed);
      if (!url) return "";
      return "<div" + attrs + "><iframe" + literal("src", safeNavigationUrl(url)) +
        ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"' +
        (n.embed.kind === "youtube" ? literal("allow", YOUTUBE_ALLOW) : "") +
        truth("allowfullscreen", n.embed.kind !== "map") +
        ' style="width:100%;height:100%;border:0;display:block"></iframe></div>';
    }
    if (n.type === "field" && n.field) {
      const f = n.field;
      const name = fieldVarName(n);
      const formAttrs = Object.entries(fieldSubmissionAttributes(n)).map(([key, value]) => literal(key, value)).join("");
      const fields = formAttrs + literal("name", fieldSubmissionName(n) || undefined) + truth("disabled", f.disabled) + truth("required", f.required);
      const fieldEvent = (event: "input" | "change"): string => !name ? "" :
        ctx.vue
          ? " @" + event + '="setField(scope, ' + esc(q(name)) + ', $event)"'
          : " on" + event + "={(event) => setField(scope, " + q(name) + ", event)}";
      if (f.kind === "submit") {
        const label = f.label ?? "送信";
        const body = hasVars(label) ? (ctx.vue ? "{{ " + expr(ctx, "resolveText", label) + " }}"
          : "{" + expr(ctx, "resolveText", label) + "}") : staticText(label);
        return "<button" + attrs + fields + literal("value", f.submitValue) + ' type="submit">' + body + "</button>";
      }
      if (f.kind === "textarea") {
        const val = f.defaultValue || "";
        const resolved = hasVars(val) ? expr(ctx, "resolveText", val) : q(val);
        const textarea = "textareaText(" + resolved + ")";
        const contents = ctx.vue ? "{{ " + textarea + " }}" : "{" + textarea + "}";
        return "<textarea" + attrs + fields + fieldEvent("input") + valueAttr(ctx, "placeholder", f.placeholder) +
          literal("rows", f.rows) + literal("maxlength", f.maxLength) + (ctx.vue ? "" : dynamicAttr(ctx, "defaultValue", resolved)) + ">" + contents + "</textarea>";
      }
      if (f.kind === "select") {
        const optionValues = (f.options || []).map((option) => option.value);
        const initial = selectDefaultValue(f);
        const defaultIndex = initial !== undefined ? optionValues.indexOf(initial) : 0;
        const def = Math.max(0, defaultIndex);
        const dynamic = hasVars(f.defaultValue) || (f.options || []).some((option) =>
          hasVars(option.label) || hasVars(option.value));
        const selected = "selectedOption(" + q(optionValues) + ", " + q(initial ?? null) + ", scope" +
          (ctx.rows.length ? ", " + ctx.rows.join(", ") : "") + ")";
        const options = (f.options || []).map((opt, index) => {
          const contents = hasVars(opt.label) ? (ctx.vue ? "{{ " + expr(ctx, "resolveText", opt.label) + " }}"
            : "{" + expr(ctx, "resolveText", opt.label) + "}") : staticText(opt.label);
          return "<option" + valueAttr(ctx, "value", opt.value) +
            (dynamic ? dynamicAttr(ctx, "selected", selected + " === " + index) : truth("selected", index === def)) +
            ">" + contents + "</option>";
        }).join("\n");
        return "<select" + attrs + fields + fieldEvent("change") + ">" + options + "</select>";
      }
      if (f.kind === "checkbox" || f.kind === "radio") {
        const label = f.label || "";
        const body = hasVars(label) ? (ctx.vue ? "{{ " + expr(ctx, "resolveText", label) + " }}"
          : "{" + expr(ctx, "resolveText", label) + "}") : staticText(label);
        const bare = f.submitValue !== undefined && !f.label;
        const value = f.submitValue !== undefined ? literal("value", f.submitValue) :
          valueAttr(ctx, "value", f.kind === "checkbox" ? "true" : label);
        const input = "<input" + (bare ? attrs : "") + literal("type", f.kind) + fields + fieldEvent("change") +
          truth("checked", f.checked) + (!ctx.vue && f.checked ? " defaultChecked={true}" : "") + value + (ctx.vue ? ">" : " />");
        return bare ? input : "<label" + attrs + ">" + input + "<span>" + body + "</span></label>";
      }
      if (f.kind === "file") {
        return "<input" + attrs + fields + ' type="file"' + literal("accept", f.accept) +
          truth("multiple", f.multiple) + (ctx.vue ? ">" : " />");
      }
      const inputType = f.inputType || "text";
      const bounds = RANGED_INPUTS.has(inputType)
        ? valueAttr(ctx, "min", f.min) + valueAttr(ctx, "max", f.max) + valueAttr(ctx, "step", f.step) : "";
      return "<input" + attrs + fields + fieldEvent("input") + literal("type", inputType) +
        (inputType === "color" || inputType === "range" ? "" : valueAttr(ctx, "placeholder", f.placeholder)) +
        (!ctx.vue ? valueAttr(ctx, "defaultValue", f.defaultValue) : "") +
        (ctx.vue && hasVars(f.defaultValue) ? dynamicAttr(ctx, "value.attr", expr(ctx, "resolveText", f.defaultValue!)) : valueAttr(ctx, "value", f.defaultValue)) + bounds +
        (TEXT_INPUTS.has(inputType) ? literal("maxlength", f.maxLength) : "") + (ctx.vue ? ">" : " />");
    }
    if (n.type === "list" && n.list) {
      const row = "row" + ctx.level;
      const index = "index" + ctx.level;
      const from = listFromOf(n) || "";
      const fields = [...(ctx.filterFields.get(from) ?? [])];
      const itemAttr = fields.length ? dynamicAttr(ctx, "data-item", "serializeListItem(" + row + ", " + q(fields) + ")") : "";
      const listExpr = "listItemsWithOps(listOps, scope, " + q(from) + ", " + (n.list.limit || 0) +
        (ctx.rows.length ? ", " + ctx.rows.join(", ") : "") + ")";
      const prior = ctx.rows, level = ctx.level;
      ctx.rows = [...ctx.rows, row];
      ctx.level = level + 1;
      let inner = "";
      try { inner = n.children.map((child) => node(ctx, child)).join("\n"); }
      finally { ctx.rows = prior; ctx.level = level; }
      if (ctx.vue) {
        return "<div" + attrs + literal("data-array", from) + ">" +
          '<div v-for="(' + row + ", " + index + ") in " + esc(listExpr) +
          '" :key="' + index + '" data-row style="display:contents" v-row-item="' + row + '"' + itemAttr + ">" + inner + "</div></div>";
      }
      return "<div" + attrs + literal("data-array", from) + ">" +
        "{#each " + listExpr + " as " + row + ", " + index + " (" + index + ")}" +
        '<div data-row style="display:contents" use:bindRowItem={' + row + '}' + itemAttr + ">" + inner + "</div>" +
        "{/each}</div>";
    }

    let tag = resolveTag(n, top);
    const paragraphWrapper = tag === "p" && hasBlockDescendant(ctx.doc, n);
    if (paragraphWrapper) tag = "div";
    if (tag === "form" && ctx.inForm) tag = "div";
    const wasForm = ctx.inForm;
    if (tag === "form") ctx.inForm = true;
    let children = "";
    try { children = n.children.map((child) => node(ctx, child)).join("\n"); }
    finally { ctx.inForm = wasForm; }
    const value = n.text?.content ?? "";
    const contents = hasVars(value)
      ? ctx.vue ? "{{ " + expr(ctx, "resolveText", value) + " }}" :
        "{" + expr(ctx, "resolveText", value) + "}"
      : staticText(value);
    const submission = submissionAttributes(n.htmlAttrs, tag);
    let extra = Object.entries(submission).map(([key, value]) => literal(key, value)).join("");
    if (tag === "form") extra += ctx.vue ? ' @reset="resetFields($event)"' : ' onreset={(event) => resetFields(event)}';
    if (tag === "form" && !submission.method) extra += ' method="get" data-search-form';
    if (paragraphWrapper) extra += ' data-p=""';
    if (tag === "button" && !submission.type) extra += literal("type", wasForm && !n.scripts?.some(script => script.trigger === "click") ? "submit" : "button");
    if (n.link) {
      tag = "a";
      const dest = n.link.kind === "page" && n.link.pageId ?
        pageHref(ctx, n.link.pageId) : n.link.url || "#";
      extra += srcAttr(ctx, "href", dest);
      if (n.link.newTab) extra += ' target="_blank" rel="noopener noreferrer"';
    }
    return "<" + tag + attrs + extra + ">" + contents + children + "</" + tag + ">";
  } finally {
    ctx.seen.delete(id);
  }
}

export interface NotFoundMetadata {
  title: string;
  description: string;
  language: string;
  ogImage: string | null;
  noindex: boolean;
}

interface NativeFiles {
  doc: SiteDoc;
  pages: { id: string; name: string; title: string; description: string; noindex: boolean; ogImage: string | null; slug: string;
    query: Record<string, string>; language: string; plan: ReturnType<typeof serializePageDataPlan> }[];
  pageFiles: Record<string, string>;
  componentFiles: Record<string, string>;
  notFound?: string;
  notFoundMetadata: NotFoundMetadata;
}

/** 書かれたすべてのページとコンポーネントについて、フレームワーク固有の明示的なテンプレートのツリーを生成する。 */
export function generateNativeFiles(
  doc: SiteDoc,
  lang: NativeLanguage,
  target: PublishTarget,
  mode: NativeView,
  classes = buildClassNames(doc),
): NativeFiles {
  const normalized = obfuscateVarNames(doc);
  unnestLinks(normalized);
  applyBreakpoints(normalized);
  raiseOverCrispSvg(normalized);
  const assets = buildAssetNames(normalized);
  const components = new Map(Object.values(normalized.components ?? {})
    .map((component, index) => [component.id, "Widget" + index]));
  const toggles = new Set([
    ...Object.values(normalized.nodes).flatMap((n) => scriptTargetIds(n, ["show", "toggle"])),
    ...Object.values(normalized.pages).flatMap((p) =>
      scriptTargetIds({ scripts: p.pageScripts }, ["show", "toggle"])),
  ]);
  const filterFields = listFilterFields(normalized);
  const pageFiles: Record<string, string> = {};
  const componentFiles: Record<string, string> = {};
  const makeCtx = (): Context => ({
    doc: normalized, vue: mode === "vue", classes, assets, components, toggles, filterFields,
    imports: new Set(), code: [], seen: new Set(), inForm: false, rows: [], level: 0,
  });
  type PageRenderPlan = Pick<Page, "id" | "pageScripts"> & {
    serverIds: Set<string>;
    listOps: ReturnType<typeof serializePageDataPlan>["listOps"];
  };
  const build = (ids: string[], page?: PageRenderPlan, id?: string) => {
    const ctx = makeCtx();
    if (!page) ctx.componentRootId = ids[0];
    let tree = ids.map((nid) => node(ctx, nid, !!page)).join("\n");
    if (page) {
      const script = compiled(ctx, { scripts: page.pageScripts }, page.serverIds);
      tree = "<span hidden" + literal("data-page-body", page.id) + script + "></span>\n" + tree;
    }
    const ext = ctx.vue ? ".vue" : ".svelte";
    const dependencyImports = [...ctx.imports].filter((name) => name !== id).map((name) =>
      'import ' + name + ' from "../components/' + name + ext + '";');
    const helper = 'import { resolveText, resolveUrl, resolveResourceUrl, scopeOf, listItemsWithOps, serializeListItem, selectedOption, setField, resetFields, formScope, textareaText' + (ctx.vue ? ', vRowItem' : ', bindRowItem') + ' } from "../site-data.js";';
    const constants = ctx.code;
    if (page) {
      constants.push("const listOps = JSON.parse(" + q(JSON.stringify(page.listOps)) + ");");
    }
    const props = page ? "scope: Record<string, unknown>" : "scope: Record<string, unknown>; listOps?: Record<string, unknown>; instanceId?: string";
    const fields = page ? idVarNodesOf(normalized, page.id).filter(node => node.field) : [];
    const defaults = fieldDefaults(fields);
    const selectOptions = new Map(fields.flatMap(node => node.field?.kind === "select"
      ? [[fieldVarName(node), node.field] as const] : []));
    const seeds = Object.entries(defaults).map(([name, value]) => {
      const select = selectOptions.get(name);
      return select ? [name, selectDefaultValue(select) ?? null, (select.options ?? []).map(option => option.value)] : [name, value];
    });
    const withFields = seeds.length > 0;
    if (withFields) constants.push("const defaults = " + q(seeds) + ";");
    const propNames = page ? (withFields ? "scope: suppliedScope" : "scope") : "scope, listOps, instanceId";

    if (ctx.vue) return [
      '<script setup' + (lang === "typescript" ? ' lang="ts"' : "") + '>',
      helper, ...dependencyImports,
      ...(withFields ? ['import { computed } from "vue";'] : []),
      (withFields ? "const props = " : "") + (lang === "typescript" ?
        "defineProps<{ " + props + " }>();" :
        "defineProps({ scope: { type: Object, required: true }" + (page ? "" : ", listOps: Object, instanceId: String") + " });"),
      ...(withFields ? ["const scope = computed(() => formScope(props.scope, defaults));"] : []),
      ...constants,
      "</script>",
      "<template>", tree, "</template>", "",
    ].join("\n");
    return [
      '<script' + (lang === "typescript" ? ' lang="ts"' : "") + '>',
      helper, ...dependencyImports,
      lang === "typescript" ?
        "let { " + propNames + " }: { " + props + " } = $props();" :
        "let { " + propNames + " } = $props();",
      ...constants,
      ...(withFields ? ["const scope = $derived(formScope(suppliedScope, defaults));"] : []),
      "</script>",
      tree, "",
    ].join("\n");
  };
  for (const [compId, name] of components) {
    const master = normalized.components?.[compId];
    if (!master) continue;
    componentFiles[name] = build([master.rootId], undefined, name);
  }
  const cleanSlug = (slug: string) => slug.replace(/^\/+|\/+$/g, "");
  const published = normalized.pageOrder.map((id) => normalized.pages[id])
    .filter((p) => p && !p.unpublished && !p.rawHtml?.trim());
  const custom404 = published.find((p) => cleanSlug(p.slug) === "404");
  let notFound: string | undefined;
  if (custom404) {
    const model = pagePlan(normalized, custom404.id);
    const plan = serializePageDataPlan(model);
    notFound = build(custom404.children, {
      id: custom404.id, pageScripts: custom404.pageScripts, serverIds: model.serverIds, listOps: plan.listOps,
    });
  }
  const pages = published
    .filter((p) => cleanSlug(p.slug) !== "404")
    .map((page, index) => {
      const name = "Page" + index;
      const model = pagePlan(normalized, page.id);
      const plan = serializePageDataPlan(model);
      const view = { id: page.id, pageScripts: page.pageScripts, serverIds: model.serverIds, listOps: plan.listOps };
      pageFiles[name] = build(page.children, view);
      return { id: page.id, name, title: page.title || page.name,
        ogImage: socialImageSrc(normalized, page, assets), description: page.description, noindex: target === "production" && !!page.noindex, slug: page.slug,
        query: Object.fromEntries(pageQueryConditions(page.query)),
        language: page.lang || normalized.lang || "ja", plan };
    });
  const notFoundMetadata = {
    title: custom404 ? (custom404.title || custom404.name) + " | " + normalized.siteName : "Not Found",
    description: custom404?.description || "", language: custom404?.lang || normalized.lang || "ja",
    ogImage: socialImageSrc(normalized, custom404, assets), noindex: target === "production",
  };
  return { doc: normalized, pages, pageFiles, componentFiles, notFound, notFoundMetadata };
}
