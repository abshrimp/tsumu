import { fieldSubmissionAttributes, submissionAttributes } from "../imported-form";
import { assetMediaUrl } from "../assets";
import type { PublishTarget } from "../generator";
import type { SiteDoc, Page, DocNode } from "../types";
import { obfuscateVarNames, pagePlan } from "../data";
import { buildClassNames, buildAssetNames } from "./names";
import { unnestLinks } from "./page";
import { applyBreakpoints, toggleShowDisplay } from "../style";
import { hasBlockDescendant, raiseOverCrispSvg, showsSelf } from "./render-helpers";
import { fieldVarName } from "../fields";
import { resolveTag } from "../tags";
import { hasVars } from "../vars";
import { pageQueryConditions } from "../page-query";
import { compileScripts, hasRunnableScripts, scriptTargetIds } from "../script";
import { embedSrc, YOUTUBE_ALLOW } from "../embed";
import { safeNavigationUrl, safeResourceUrl } from "../url-policy";
import { serializePageDataPlan } from "./browser-data";
import { importedAttributes, importedClass } from "../imported-html-attrs";
import { cssValue } from "./css";

export type NativeLanguage = "typescript" | "javascript";
export type NativeView = "vue" | "sveltekit";

type Context = {
  doc: SiteDoc;
  vue: boolean;
  classes: Map<string, string>;
  assets: Map<string, string>;
  components: Map<string, string>;
  toggles: Set<string>;
  imports: Set<string>;
  code: string[];
  seen: Set<string>;
  inForm: boolean;
  rows: string[];
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
  return ctx.vue
    ? " :" + name + '="' + esc(expression) + '"'
    : " " + name + "={" + expression + "}";
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
  const show = (node.attrId && ctx.toggles.has(node.attrId)) || showsSelf(node);
  const retained = Object.entries(importedAttributes(node.htmlAttrs))
    .map(([key, value]) => literal(key === "htmlFor" ? "for" : key === "tabIndex" ? "tabindex" : key, value))
    .join("");
  return literal("class", className) +
    literal("id", node.attrId) + retained +
    (show ? literal("data-toggle-show", toggleShowDisplay(node)) : "") +
    (node.motions?.some((m) => m.trigger === "in-view") ? " data-inview" : "") +
    compiled(ctx, node);
}

/** フレームワーク固有の要素のテンプレートの唯一の例外は、利用者が書いた生の HTML。 */
function rawNode(ctx: Context, html: string, attrs = ""): string {
  const name = "rawBlock" + ctx.code.length;
  // 埋め込みの HTML や SVG も、通常のメディアのノードと同じ書き出したリソースを使う。
  ctx.code.push("const " + name + " = " + q(cssValue(ctx.doc, "rawHtml", html, ctx.assets)) + ";");
  if (ctx.vue) return "<div" + attrs + ' v-html="' + name + '"></div>';
  return "<div" + attrs + ">{@html " + name + "}</div>";
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
      const body = ctx.vue ? "<" + comp + ' :scope="' + esc(scope) + '" :list-ops="listOps" />'
        : "<" + comp + " scope={" + scope + "} {listOps} />";
      return '<div style="display:contents"' + common(ctx, n, [ctx.classes.get(id) || "el", importedClass(n.htmlClass)].filter(Boolean).join(" ")) +
        (n.hiddenOn?.length ? literal("data-instance-hidden", ctx.classes.get(id) || "el") : "") +
        ">" + body + "</div>";
    }

    const cls = [ctx.classes.get(id) || "el", importedClass(n.htmlClass)].filter(Boolean).join(" ");
    const attrs = common(ctx, n, cls);
    if (n.type === "divider") return "<hr" + attrs + (ctx.vue ? ">" : " />");
    if (n.type === "image" && n.image) {
      const im = n.image;
      const source = im.assetId && ctx.assets.get(im.assetId) ?
        assetMediaUrl("/assets/" + ctx.assets.get(im.assetId), im.assetSuffix) : im.src;
      return "<img" + attrs + srcAttr(ctx, "src", source, true) + valueAttr(ctx, "alt", im.alt) +
        literal("width", im.width || 800) + literal("height", im.height || 500) +
        literal("fetchpriority", im.priority ? "high" : undefined) +
        (ctx.vue ? ">" : " />");
    }
    if (n.type === "code" && n.code) return rawNode(ctx, n.code.html, attrs);
    if (n.type === "icon" && n.icon) return rawNode(ctx, n.icon.svg, attrs);
    if (n.type === "media" && n.media) {
      const media = n.media;
      const tag = media.kind === "audio" ? "audio" : "video";
      const source = media.assetId && ctx.assets.get(media.assetId) ?
        assetMediaUrl("/assets/" + ctx.assets.get(media.assetId), media.assetSuffix) : media.src;
      const sources = (media.sources ?? []).map((item) => {
        const url = item.assetId && ctx.assets.get(item.assetId) ?
          assetMediaUrl("/assets/" + ctx.assets.get(item.assetId), item.assetSuffix) : item.src;
        return url.trim() ? "<source" + srcAttr(ctx, "src", url, true) + literal("type", item.type) +
          literal("media", item.media) + (ctx.vue ? ">" : " />") : "";
      }).join("");
      return "<" + tag + attrs + (source.trim() ? srcAttr(ctx, "src", source, true) : "") + " controls" +
        truth("autoplay", media.autoplay) + truth("loop", media.loop) +
        truth("muted", media.muted || media.autoplay) +
        (tag === "video" ? " playsinline" : "") + ">" + sources + "</" + tag + ">";
    }
    if (n.type === "embed" && n.embed) {
      const url = embedSrc(n.embed);
      if (!url) return "";
      return "<div" + attrs + "><iframe" + srcAttr(ctx, "src", url) +
        ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"' +
        (n.embed.kind === "youtube" ? literal("allow", YOUTUBE_ALLOW) : "") +
        truth("allowfullscreen", n.embed.kind !== "map") +
        ' style="width:100%;height:100%;border:0;display:block"></iframe></div>';
    }
    if (n.type === "field" && n.field) {
      const f = n.field;
      const name = fieldVarName(n);
      const formAttrs = Object.entries(fieldSubmissionAttributes(n)).map(([key, value]) => literal(key, value)).join("");
      const fields = formAttrs + literal("name", f.name ?? name) + truth("disabled", f.disabled) + truth("required", f.required);
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
        const contents = hasVars(val) ? (ctx.vue ? "{{ " + expr(ctx, "resolveText", val) + " }}"
          : "{" + expr(ctx, "resolveText", val) + "}") : staticText(val);
        return "<textarea" + attrs + fields + fieldEvent("input") + valueAttr(ctx, "placeholder", f.placeholder) +
          literal("rows", f.rows) + literal("maxlength", f.maxLength) + ">" + contents + "</textarea>";
      }
      if (f.kind === "select") {
        const optionValues = (f.options || []).map((option) => option.value);
        const defaultIndex = f.defaultValue !== undefined ? optionValues.indexOf(f.defaultValue) : 0;
        const def = Math.max(0, defaultIndex);
        const dynamic = hasVars(f.defaultValue) || (f.options || []).some((option) =>
          hasVars(option.label) || hasVars(option.value));
        const selected = "selectedOption(" + q(optionValues) + ", " + q(f.defaultValue ?? null) + ", scope" +
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
          truth("checked", f.checked) + value + (ctx.vue ? ">" : " />");
        return bare ? input : "<label" + attrs + ">" + input + "<span>" + body + "</span></label>";
      }
      if (f.kind === "file") {
        return "<input" + attrs + fields + ' type="file"' + literal("accept", f.accept) +
          truth("multiple", f.multiple) + (ctx.vue ? ">" : " />");
      }
      return "<input" + attrs + fields + fieldEvent("input") + literal("type", f.inputType || "text") +
        valueAttr(ctx, "placeholder", f.placeholder) + valueAttr(ctx, "value", f.defaultValue) +
        valueAttr(ctx, "min", f.min) + valueAttr(ctx, "max", f.max) + valueAttr(ctx, "step", f.step) +
        literal("maxlength", f.maxLength) + (ctx.vue ? ">" : " />");
    }
    if (n.type === "list" && n.list) {
      const row = "row" + ctx.level;
      const index = "index" + ctx.level;
      const from = n.list.from || "";
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
          '" :key="' + index + '" data-row style="display:contents">' + inner + "</div></div>";
      }
      return "<div" + attrs + literal("data-array", from) + ">" +
        "{#each " + listExpr + " as " + row + ", " + index + " (" + index + ")}" +
        '<div data-row style="display:contents">' + inner + "</div>" +
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
    if (tag === "form" && !submission.method) extra += ' method="get"';
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

export interface NativeFiles {
  pages: { id: string; name: string; title: string; description: string; noindex: boolean; slug: string;
    query: Record<string, string>; language: string; plan: ReturnType<typeof serializePageDataPlan> }[];
  vuePages: Record<string, string>;
  vueComponents: Record<string, string>;
  sveltePages: Record<string, string>;
  svelteComponents: Record<string, string>;
}

/** 書かれたすべてのページとコンポーネントについて、フレームワーク固有の明示的なテンプレートのツリーを生成する。 */
export function generateNativeFiles(doc: SiteDoc, lang: NativeLanguage, target: PublishTarget): NativeFiles {
  const normalized = obfuscateVarNames(doc);
  unnestLinks(normalized);
  applyBreakpoints(normalized);
  raiseOverCrispSvg(normalized);
  const classes = buildClassNames(normalized);
  const assets = buildAssetNames(normalized);
  const components = new Map(Object.values(normalized.components ?? {})
    .map((component, index) => [component.id, "Widget" + index]));
  const toggles = new Set([
    ...Object.values(normalized.nodes).flatMap((n) => scriptTargetIds(n, ["show", "toggle"])),
    ...Object.values(normalized.pages).flatMap((p) =>
      scriptTargetIds({ scripts: p.pageScripts }, ["show", "toggle"])),
  ]);
  const vuePages: Record<string, string> = {};
  const vueComponents: Record<string, string> = {};
  const sveltePages: Record<string, string> = {};
  const svelteComponents: Record<string, string> = {};
  const makeCtx = (vue: boolean): Context => ({
    doc: normalized, vue, classes, assets, components, toggles,
    imports: new Set(), code: [], seen: new Set(), inForm: false, rows: [], level: 0,
  });
  type PageRenderPlan = Pick<Page, "id" | "pageScripts"> & {
    serverIds: Set<string>;
    listOps: ReturnType<typeof serializePageDataPlan>["listOps"];
  };
  const build = (ids: string[], mode: NativeView, page?: PageRenderPlan, id?: string) => {
    const ctx = makeCtx(mode === "vue");
    let tree = ids.map((nid) => node(ctx, nid, true)).join("\n");
    if (page) {
      const script = compiled(ctx, { scripts: page.pageScripts }, page.serverIds);
      tree = "<span hidden" + literal("data-page-body", page.id) + script + "></span>\n" + tree;
    }
    const ext = ctx.vue ? ".vue" : ".svelte";
    const dependencyImports = [...ctx.imports].filter((name) => name !== id).map((name) =>
      'import ' + name + ' from "../components/' + name + ext + '";');
    const helper = 'import { resolveText, resolveUrl, resolveResourceUrl, scopeOf, listItemsWithOps, selectedOption, setField } from "../site-data.js";';
    const constants = ctx.code;
    if (page) {
      constants.push("const listOps = JSON.parse(" + q(JSON.stringify(page.listOps)) + ");");
    }
    const props = page ? "scope: Record<string, unknown>" : "scope: Record<string, unknown>; listOps?: Record<string, unknown>";
    const propNames = page ? "scope" : "scope, listOps";

    if (ctx.vue) return [
      '<script setup' + (lang === "typescript" ? ' lang="ts"' : "") + '>',
      helper, ...dependencyImports,
      lang === "typescript" ?
        "defineProps<{ " + props + " }>();" :
        "defineProps({ scope: { type: Object, required: true }" + (page ? "" : ", listOps: Object") + " });",
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
      ...constants, "</script>",
      tree, "",
    ].join("\n");
  };
  for (const [compId, name] of components) {
    const master = normalized.components?.[compId];
    if (!master) continue;
    vueComponents[name] = build([master.rootId], "vue", undefined, name);
    svelteComponents[name] = build([master.rootId], "sveltekit", undefined, name);
  }
  const pages = normalized.pageOrder.map((id) => normalized.pages[id])
    .filter((p) => p && !p.unpublished && !p.rawHtml?.trim() && p.slug !== "404")
    .map((page, index) => {
      const name = "Page" + index;
      const model = pagePlan(normalized, page.id);
      const plan = serializePageDataPlan(model);
      const view = { id: page.id, pageScripts: page.pageScripts, serverIds: model.serverIds, listOps: plan.listOps };
      vuePages[name] = build(page.children, "vue", view);
      sveltePages[name] = build(page.children, "sveltekit", view);
      return { id: page.id, name, title: page.title || page.name,
        description: page.description, noindex: target === "production" && !!page.noindex, slug: page.slug,
        query: Object.fromEntries(pageQueryConditions(page.query)),
        language: page.lang || normalized.lang || "ja", plan };
    });
  return { pages, vuePages, vueComponents, sveltePages, svelteComponents };
}
