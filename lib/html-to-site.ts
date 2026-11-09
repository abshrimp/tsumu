import type { Asset, BreakpointDef, DocNode, NodeStyles, Page, SiteDoc, StyleMap, StyleState } from "./types";
import { genId } from "./presets";
import { escapeStyleContent } from "./css-assets";
import { MAX_NODE_DEPTH } from "./doc-tree";
import { assetSrc } from "./assets";
import { DEFAULT_BREAKPOINTS, MAX_BREAKPOINTS, normalizeBreakpoints } from "./style";
import { zipStylesheet } from "./zip-css";
import { tr } from "./i18n";
import { importedClass, readImportedAttributes } from "./imported-html-attrs";
import { sanitizeImportedSvg } from "./imported-svg";
import { safeNavigationUrl, safeResourceUrl } from "./url-policy";
import { expandZipCss } from "./html-css-import";
import { importedAssetPath, isZipJavascript } from "./generator/imported-assets";

/** A single HTML page converted into individually editable Tsumu elements. */
export type HtmlConversion = { doc: SiteDoc; warnings: string[] };
type Options = { assets?: Asset[]; breakpoints?: BreakpointDef[] };

const TAGS = new Set([
  "div", "section", "header", "footer", "nav", "main", "article", "aside",
  "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "a", "button", "form",
  "ul", "ol", "li", "label", "strong", "b", "em", "i", "small", "pre",
  "blockquote", "figure", "figcaption", "details", "summary", "time",
  "code", "kbd", "mark", "dl", "dt", "dd", "address", "output",
]);
const SEMANTICS = new Set(["div", "section", "header", "footer", "nav", "main", "article", "span", "form", "button"]);
const SKIP_TAGS = new Set(["script", "style", "link", "meta", "title", "base"]);
const UNSAFE_TAGS = new Set(["iframe", "object", "embed", "applet", "template"]);
const MAX_HTML_CHARS = 12 * 1024 * 1024;
const MAX_NODES = 25000;

function camel(key: string): string {
  return key.startsWith("--") ? key : key.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}
function attrStyle(raw: CSSStyleDeclaration, apply: (name: string, value: string, important: boolean) => void) {
  for (let i = 0; i < raw.length; i++) {
    const property = raw.item(i);
    if (property) apply(camel(property), raw.getPropertyValue(property).trim(), raw.getPropertyPriority(property) === "important");
  }
}
function htmlText(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}
function safeUrl(value: string): string {
  // Browsers remove tab/newline characters before interpreting a scheme.
  // Use the same URL policy as the editor and generated sites.
  const safe = safeResourceUrl(value);
  return safe === "#" && value !== "#" ? "" : safe;
}
function htmlName(tag: string): string {
  const names: Record<string, string> = {
    h1: tr("見出し"), h2: tr("見出し"), h3: tr("見出し"), p: tr("文章"), a: tr("リンク"),
    img: tr("画像"), button: tr("ボタン"), nav: tr("ナビゲーション"), header: tr("ヘッダー"),
    footer: tr("フッター"), section: tr("セクション"), main: tr("メイン"), form: tr("フォーム"),
    input: tr("入力欄"), textarea: tr("テキストエリア"), select: tr("選択肢"),
  };
  return names[tag] || tag;
}
function parseSize(raw: string | null, fallback: number): number {
  const num = Number(raw);
  return raw && Number.isFinite(num) && num > 0 ? num : fallback;
}
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const tags = (selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, "").match(/(?:^|[>+~\s])[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + classes * 100 + tags;
}
/** Split selector lists without splitting commas in attributes, strings or functions. */
function splitSelectors(input: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let square = 0, round = 0, start = 0, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "[") square++;
    else if (ch === "]") square = Math.max(0, square - 1);
    else if (ch === "(") round++;
    else if (ch === ")") round = Math.max(0, round - 1);
    else if (ch === "," && !square && !round) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function cssRules(text: string): CSSRuleList | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return sheet.cssRules;
  } catch {
    return null;
  }
}

export function convertHtmlToSite(html: string, options: Options = {}): HtmlConversion {
  if (!html.trim() || html.length > MAX_HTML_CHARS) throw new Error(tr("HTMLのサイズが大きすぎるか、空です。"));
  if (typeof DOMParser === "undefined") throw new Error(tr("この環境ではHTMLを解析できません。"));
  // DOMParser is inert: imported scripts are never executed during conversion.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const assets = options.assets || [];
  const bySrc = new Map<string, Asset>();
  for (const asset of assets) {
    const src = assetSrc(asset);
    if (src) bySrc.set(src, asset);
  }
  const getAsset = (src: string) => bySrc.get(src) ||
    [...bySrc].find(([url]) => src.startsWith(url + "#") || src.startsWith(url + "&"))?.[1];

  // Read inline and packaged stylesheets in document order. Never fetch remote CSS.
  const sheets: string[] = [];
  const unusedHead: string[] = [];
  const unresolvedStyles: string[] = [];
  const scripts: string[] = [];
  let scriptCount = 0;
  const resolveCss = (css: string, owner?: Asset): string => {
    try {
      const expanded = expandZipCss(css, assets, (warning) => {
        // An unresolved CSS import is kept for the published site.
        if (warning.includes("circular")) warn(tr("循環するCSSの@importを読み飛ばしました。"));
        else warn(tr("解決できないCSSの@importをカスタムコードに保持しました。"));
      }, owner);
      unresolvedStyles.push(...expanded.unresolved);
      return expanded.css;
    } catch {
      unresolvedStyles.push(css);
      warn(tr("CSSの依存関係が大きすぎるため、カスタムコードとして保持しました。"));
      return "";
    }
  };
  const mediaCss = (element: Element, css: string): string | null => {
    const condition = (element.getAttribute("media") || "").trim();
    if (!condition || /^(?:all|screen)$/i.test(condition)) return css;
    const query = condition.replace(/^(?:only\s+)?(?:all|screen)\s+and\s+/i, "");
    // Import only width-based conditions Tsumu can express as breakpoints.
    if (/^\(\s*(?:min|max)-width\s*:\s*\d+(?:\.\d+)?px\s*\)(?:\s+and\s+\(\s*(?:min|max)-width\s*:\s*\d+(?:\.\d+)?px\s*\))*$/i.test(query)) {
      return `@media ${condition} {\n${css}\n}`;
    }
    return null;
  };
  for (const element of Array.from(parsed.head.children)) {
    const tag = element.tagName.toLowerCase();
    if (tag === "style") {
      const source = mediaCss(element, resolveCss(element.textContent || ""));
      if (source !== null) sheets.push(source);
      else {
        unusedHead.push(element.outerHTML);
        warn(tr("対応できないCSSのmedia条件をカスタムコードに保持しました。"));
      }
    }
    else if (tag === "link" && (element.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      const href = element.getAttribute("href") || "";
      const match = /^tsumu-zip-css:([^?#]+)/.exec(href);
      let asset: Asset | undefined;
      if (match) {
        try { asset = assets.find((a) => a.id === decodeURIComponent(match[1])); } catch { /* malformed reference */ }
      }
      const source = zipStylesheet(asset);
      if (source) {
        if (element.getAttribute("integrity")?.trim()) throw new Error("Cannot import a stylesheet with unverified integrity metadata.");
        const converted = mediaCss(element, resolveCss(source.source, asset));
        if (converted !== null) sheets.push(converted);
        else {
          unusedHead.push(element.outerHTML);
          warn(tr("対応できないCSSのmedia条件をカスタムコードに保持しました。"));
        }
      } else {
        unusedHead.push(element.outerHTML);
        warn(tr("外部CSSまたは解決できないスタイルシートは、コードとして保持しました。"));
      }
    } else if (tag === "script") {
      // Preserve head scripts *before* page content; appending them to body
      // breaks common dependencies and script initialization order.
      unusedHead.push(element.outerHTML);
      scriptCount++;
    }
    else if (tag !== "title" && tag !== "base") unusedHead.push(element.outerHTML);
  }
  for (const style of Array.from(parsed.body.querySelectorAll("style"))) {
    // SVG styles belong to the sanitised icon, not to the whole page.
    if (style.closest("svg")) continue;
    sheets.push(resolveCss(style.textContent || ""));
  }
  for (const script of Array.from(parsed.body.querySelectorAll("script"))) {
    // Never promote an SVG child script into an executable page script.
    if (script.closest("svg")) continue;
    scripts.push(script.outerHTML);
    scriptCount++;
  }
  if (scriptCount) {
    warn(tr("元のJavaScriptはページのカスタムコードに保存しました。エディタ内では実行されません。公開前に内容を確認してください。"));
    if (assets.some((asset) => isZipJavascript(asset) && !importedAssetPath(asset))) {
      warn(tr("一部のJavaScriptファイルは元の相対パスを保持できません。公開後の動作を確認してください。"));
    }
  }

  const originalBps = normalizeBreakpoints(options.breakpoints || DEFAULT_BREAKPOINTS);
  const breakpoints = originalBps.map((bp) => ({ ...bp }));
  type MediaRange = { min: number; max: number };
  type ParsedRule = {
    element: Element;
    state: StyleState;
    range: MediaRange;
    score: number;
    order: number;
    declarations: { name: string; value: string; important: boolean }[];
  };
  const parsedRules: ParsedRule[] = [];
  let order = 0;
  const unusedRules: string[] = [...unresolvedStyles];
  const getBreakpoint = (width: number): boolean => {
    const w = Math.round(width);
    if (breakpoints.some((bp) => bp.maxWidth === w)) return true;
    if (w < 240 || w > 2999 || breakpoints.length >= MAX_BREAKPOINTS) return false;
    breakpoints.push({ id: "html_" + w, label: "画面幅" + w, maxWidth: w });
    return true;
  };
  const parseRange = (condition: string): MediaRange | null => {
    const clean = condition.trim().replace(/^(?:only\s+)?(?:all|screen)\s+and\s+/i, "");
    if (/^(?:print|speech)\b/i.test(clean) || clean.includes(",")) return null;
    let min = 0, max = Infinity;
    for (const item of clean.split(/\s+and\s+/i)) {
      const m = /^\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i.exec(item.trim());
      if (!m) return null;
      const value = Number(m[2]);
      if (m[1].toLowerCase() === "min") min = Math.max(min, value);
      else max = Math.min(max, value);
    }
    return min <= max ? { min, max } : null;
  };
  let declarationWork = 0, emittedStyleChars = 0;
  const collect = (rules: CSSRuleList, range: MediaRange, retained: string[], depth = 0) => {
    if (depth > 32) throw new Error(tr("HTMLのスタイルが複雑すぎます。"));
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.MEDIA_RULE) {
        const media = rule as CSSMediaRule;
        const next = parseRange(media.conditionText);
        if (!next) {
          retained.push(rule.cssText);
          warn(tr("複雑な@media条件はカスタムCSSとして保持しました。"));
          continue;
        }
        const merged = { min: Math.max(range.min, next.min), max: Math.min(range.max, next.max) };
        if (merged.min > merged.max) continue;
        const limits = [
          ...(Number.isFinite(merged.max) ? [merged.max] : []),
          ...(merged.min > 0 ? [merged.min - 1] : []),
        ];
        if (!limits.every(getBreakpoint)) {
          retained.push(rule.cssText);
          warn(tr("Tsumuのブレークポイント上限により、一部の@mediaは変換できません。"));
          continue;
        }
        const nested: string[] = [];
        collect(media.cssRules, merged, nested, depth + 1);
        if (nested.length) retained.push("@media " + media.conditionText + " {\n" + nested.join("\n") + "\n}");
      } else if (rule.type === CSSRule.STYLE_RULE) {
        const item = rule as CSSStyleRule;
        const declarations: ParsedRule["declarations"] = [];
        attrStyle(item.style, (name, value, important) => {
          declarations.push({ name, value, important });
        });
        if (!declarations.length) continue;
        let retain = false;
        for (const originalSelector of splitSelectors(item.selectorText)) {
          const selector = originalSelector.trim();
          const stateMatch = /:(hover|focus|active)$/i.exec(selector);
          const state = (stateMatch?.[1]?.toLowerCase() || "default") as StyleState;
          const baseSelector = stateMatch ? selector.slice(0, -stateMatch[0].length) : selector;
          if (!baseSelector || /::|(^|[^\\]):/.test(baseSelector)) {
            retain = true;
            warn(tr("一部のCSSセレクターはカスタムCSSとして保持しました。"));
            continue;
          }
          try {
            const matches = parsed.querySelectorAll(baseSelector);
            // Global selectors such as :root do not have a Tsumu node;
            // retain their declarations instead of silently losing variables.
            if (Array.from(matches).some((el) => el === parsed.documentElement || el === parsed.head)) {
              retain = true;
              warn(tr("一部のCSSルールはカスタムCSSとして保持しました。"));
              continue;
            }
            declarationWork += matches.length * declarations.length;
            for (const element of matches) {
              if (parsedRules.length >= 200000 || declarationWork > 2000000) throw new Error("too-many-matches");
              parsedRules.push({
                element, state, range, score: specificity(selector), order: ++order, declarations,
              });
            }
          } catch (error) {
            if (error instanceof Error && error.message === "too-many-matches") {
              throw new Error(tr("HTMLの要素数が多すぎます。"));
            }
            retain = true;
            warn(tr("一部のCSSセレクターを解析できませんでした。"));
          }
        }
        if (retain) retained.push(item.cssText);
      } else {
        retained.push(rule.cssText);
        warn(tr("一部のCSSルールはカスタムCSSとして保持しました。"));
      }
    }
  };
  for (const source of sheets) {
    const rules = cssRules(source);
    if (rules) collect(rules, { min: 0, max: Infinity }, unusedRules);
    else if (source.trim()) {
      unusedRules.push(source);
      warn(tr("解析できないCSSをカスタムコードに保持しました。"));
    }
  }
  // Original inline declarations override authored stylesheet rules unless
  // a stylesheet uses !important. Do not lose that ordering at narrow widths.
  for (const element of Array.from(parsed.querySelectorAll("[style]"))) {
    const raw = (element as HTMLElement).style;
    if (!raw) continue;
    const declarations: ParsedRule["declarations"] = [];
    attrStyle(raw, (name, value, important) => declarations.push({ name, value, important }));
    parsedRules.push({
      element, state: "default", range: { min: 0, max: Infinity },
      score: 1000000, order: ++order, declarations,
    });
  }
  type Selected = { value: string; important: boolean; rank: number; order: number };
  const byElement = new Map<Element, ParsedRule[]>();
  for (const rule of parsedRules) {
    const list = byElement.get(rule.element) || [];
    list.push(rule);
    byElement.set(rule.element, list);
  }
  const widths = [{ id: "base", width: 3000 }, ...[...breakpoints]
    .sort((a, b) => b.maxWidth - a.maxWidth)
    .map((bp) => ({ id: bp.id, width: bp.maxWidth }))];
  const toStyles = (element: Element): NodeStyles => {
    const entries = byElement.get(element) || [];
    const styles: NodeStyles = { base: { default: {} } };
    const previous = new Map<StyleState, Map<string, string>>();
    for (const at of widths) {
      const current = new Map<StyleState, Map<string, Selected>>();
      for (const rule of entries) {
        if (at.width < rule.range.min || at.width > rule.range.max) continue;
        let states = current.get(rule.state);
        if (!states) { states = new Map(); current.set(rule.state, states); }
        for (const declaration of rule.declarations) {
          const rank = (declaration.important ? 100000000 : 0) + rule.score;
          const prior = states.get(declaration.name);
          if (!prior || rank > prior.rank || (rank === prior.rank && rule.order >= prior.order)) {
            states.set(declaration.name, { value: declaration.value, important: declaration.important, rank, order: rule.order });
          }
        }
      }
      const stateNames = new Set<StyleState>([...previous.keys(), ...current.keys()]);
      const next = new Map<StyleState, Map<string, string>>();
      const out: Partial<Record<StyleState, StyleMap>> = {};
      for (const state of stateNames) {
        const values = new Map<string, string>();
        for (const [key, item] of current.get(state) || []) {
          values.set(key, item.value + (item.important ? " !important" : ""));
        }
        // Chromium's CSSOM expands the authored `gap` shorthand into row-gap
        // and column-gap declarations. Normalize equal axes back to a single
        // gap value so the inspector and responsive overrides stay editable.
        const rowGap = values.get("rowGap"), columnGap = values.get("columnGap");
        if (rowGap !== undefined && rowGap === columnGap && !values.has("gap")) {
          values.set("gap", rowGap);
          values.delete("rowGap");
          values.delete("columnGap");
        }
        next.set(state, values);
        const prev = previous.get(state) || new Map<string, string>();
        const props: StyleMap = {};
        for (const key of new Set([...prev.keys(), ...values.keys()])) {
          const before = prev.get(key);
          const after = values.get(key);
          if (at.id === "base" || before !== after) {
            // A rule that only applied at wider widths must be cancelled here.
            emittedStyleChars += key.length + (after?.length ?? 6);
            if (emittedStyleChars > MAX_HTML_CHARS) throw new Error(tr("HTMLのスタイルが複雑すぎます。"));
            if (after !== undefined) props[key] = after;
            else if (at.id !== "base") props[key] = "revert";
          }
        }
        if (Object.keys(props).length) out[state] = props;
      }
      if (Object.keys(out).length) styles[at.id] = out;
      previous.clear();
      for (const [state, values] of next) previous.set(state, values);
    }
    return styles;
  };
  // Class selectors have already been resolved into each element's styles.
  // Keep the original class only if unconverted CSS, linked stylesheets, or
  // JavaScript may still depend on it. Otherwise it is redundant in SiteDoc.
  const keepOriginalClasses = unusedRules.length > 0 || scriptCount > 0 ||
    unusedHead.some((item) => /^<link\b/i.test(item));
  // Unconditional advanced declarations belong to each element's custom CSS,
  // rather than remaining in a class-based global stylesheet. Responsive and
  // pseudo-state declarations must remain in NodeStyles: customCss is base-only.
  const advancedCssProperty = (name: string) =>
    name.startsWith("--") || /^(?:Webkit|Moz|ms)[A-Z]/.test(name) ||
    /^(?:clipPath|clipRule|scrollMargin(?:Top|Right|Bottom|Left)?|scrollPadding(?:Top|Right|Bottom|Left)?|scrollSnapType|mask(?:Image|Size|Position|Repeat|Clip|Origin)?|offset(?:Path|Distance|Rotate)?|container(?:Name|Type)|shapeOutside|shapeMargin)$/.test(name);
  const declName = (name: string) =>
    name.startsWith("--") ? name : name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()).toLowerCase();
  const nodeStyle = (element: Element): { styles: NodeStyles; customCss?: string } => {
    const styles = toStyles(element);
    const defaults = styles.base?.default;
    if (!defaults) return { styles };
    const advanced = Object.entries(defaults).filter(([name]) => advancedCssProperty(name));
    for (const [name] of advanced) delete defaults[name];
    return advanced.length
      ? { styles, customCss: advanced.map(([name, value]) => `${declName(name)}: ${value};`).join("\n") }
      : { styles };
  };
  const nodes: Record<string, DocNode> = {};
  let converted = 0;
  const add = (node: DocNode): string => {
    if (++converted > MAX_NODES) throw new Error(tr("HTMLの要素数が多すぎます。"));
    nodes[node.id] = node;
    return node.id;
  };
  const convert = (element: Element, depth = 1): string | null => {
    const tag = element.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    if (UNSAFE_TAGS.has(tag)) {
      warn(tr("埋め込み要素は安全上の理由で変換対象から除外しました。"));
      return null;
    }
    if (depth > MAX_NODE_DEPTH) throw new Error(tr("HTMLの要素数が多すぎます。"));
    const id = genId("node");
    const visual = nodeStyle(element);
    const sourceClass = keepOriginalClasses
      ? importedClass(element.getAttribute("class") || undefined) : undefined;
    const sourceAttrs = readImportedAttributes(element);
    const common: DocNode = {
      id, type: "box", name: htmlName(tag), semantic: SEMANTICS.has(tag) ? tag as DocNode["semantic"] : "auto",
      text: null, link: null, children: [], ...visual,
      ...(element.id ? { attrId: element.id } : {}),
      ...(sourceClass ? { htmlClass: sourceClass } : {}),
      ...(sourceAttrs ? { htmlAttrs: sourceAttrs } : {}),
    };
    if (tag === "img") {
      common.type = "image";
      const src = safeUrl(element.getAttribute("src") || "");
      const asset = getAsset(src);
      common.image = {
        src: asset ? "" : src,
        alt: element.getAttribute("alt") || "",
        width: parseSize(element.getAttribute("width"), asset?.width || 800),
        height: parseSize(element.getAttribute("height"), asset?.height || 500),
        ...(asset ? { assetId: asset.id } : {}),
      };
      if (!common.styles.base.default?.width) common.styles.base.default = { ...common.styles.base.default, width: "auto" };
      return add(common);
    }
    if (tag === "hr") { common.type = "divider"; return add(common); }
    if (tag === "svg") {
      common.type = "icon";
      common.icon = { name: "imported-svg", svg: sanitizeImportedSvg(element.outerHTML) };
      return add(common);
    }
    if (tag === "input" || tag === "textarea" || tag === "select") {
      common.type = "field";
      const inputType = tag === "input" ? (element.getAttribute("type") || "text").toLowerCase() : "";
      const kind = ["checkbox", "radio", "file", "submit"].includes(inputType)
        ? inputType : tag === "input" ? "input" : tag;
      const supportedInputs = new Set(["text", "email", "password", "number", "tel", "url",
        "search", "date", "time", "datetime-local", "month", "week", "color", "range"]);
      if (tag === "input" && kind === "input" && !supportedInputs.has(inputType)) {
        common.type = "code";
        common.code = { html: element.outerHTML };
        warn(tr("一部のHTML要素をカスタムコードとして保持しました。"));
        return add(common);
      }
      const options = tag === "select" ? Array.from(element.querySelectorAll("option")).map((option) => ({
        label: option.textContent || "",
        value: option.getAttribute("value") ?? option.textContent ?? "",
      })) : undefined;
      if (!common.attrId && element.getAttribute("name")) common.attrId = element.getAttribute("name")!;
      common.field = {
        kind: kind as NonNullable<DocNode["field"]>["kind"],
        ...(kind === "input" ? { inputType: inputType as NonNullable<DocNode["field"]>["inputType"] } : {}),
        ...(options ? { options } : {}),
        ...(element.getAttribute("placeholder") ? { placeholder: element.getAttribute("placeholder")! } : {}),
        ...((tag === "textarea" ? element.textContent || "" :
          tag === "select" ? (element as HTMLSelectElement).selectedOptions[0]?.value || "" :
          element.getAttribute("value") || "") ? {
            defaultValue: tag === "textarea" ? element.textContent || "" :
              tag === "select" ? (element as HTMLSelectElement).selectedOptions[0]?.value || "" :
              element.getAttribute("value") || "",
          } : {}),
        ...(element.hasAttribute("checked") ? { checked: true } : {}),
        ...(element.hasAttribute("required") ? { required: true } : {}),
        ...(element.hasAttribute("disabled") ? { disabled: true } : {}),
        ...(element.getAttribute("name") ? { group: element.getAttribute("name")! } : {}),
      };
      return add(common);
    }
    if (tag === "video" || tag === "audio") {
      common.type = "media";
      const src = safeUrl(element.getAttribute("src") || element.querySelector("source")?.getAttribute("src") || "");
      const asset = getAsset(src);
      common.media = { kind: tag, src: asset ? "" : src, ...(asset ? { assetId: asset.id } : {}),
        autoplay: element.hasAttribute("autoplay"),
        loop: element.hasAttribute("loop"), muted: element.hasAttribute("muted") };
      return add(common);
    }
    if (!TAGS.has(tag)) {
      common.type = "code";
      common.code = { html: element.outerHTML };
      warn(tr("一部のHTML要素をカスタムコードとして保持しました。"));
      return add(common);
    }
    if (tag === "a") {
      common.link = { kind: "url", url: safeNavigationUrl(element.getAttribute("href") || ""), newTab: element.getAttribute("target") === "_blank" };
    } else if (!SEMANTICS.has(tag) && !/^h[1-6]$/.test(tag) && tag !== "p") {
      common.semantic = "custom";
      common.customTag = tag;
    }
    const children = Array.from(element.childNodes).filter((child) =>
      child.nodeType === Node.ELEMENT_NODE ||
      (child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim()));
    if (children.length === 0) {
      if (/^h[1-6]$/.test(tag)) common.text = { content: "", heading: Number(tag.slice(1)) };
      return add(common);
    }
    if (children.every((child) => child.nodeType === Node.TEXT_NODE)) {
      const value = htmlText(element);
      if (/^h[1-6]$/.test(tag)) common.text = { content: value, heading: Number(tag.slice(1)) };
      else if (tag === "p" || tag === "span" || tag === "a" || tag === "button" ||
          tag === "strong" || tag === "b" || tag === "em" || tag === "i" || tag === "small" ||
          tag === "label" || tag === "li" || tag === "pre") common.text = { content: value, heading: 0 };
      else {
        // Preserve text-only containers as editable text; visual descendants remain independent nodes.
        common.text = { content: value, heading: 0 };
      }
      return add(common);
    }
    if (/^h[1-6]$/.test(tag) || tag === "p") {
      common.semantic = "custom";
      common.customTag = tag;
    }
    add(common);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = (child.textContent || "").replace(/\s+/g, " ").trim();
        if (!value) continue;
        if (depth >= MAX_NODE_DEPTH) throw new Error(tr("HTMLの要素数が多すぎます。"));
        const textId = genId("node");
        common.children.push(add({
          id: textId, type: "box", name: tr("テキスト"), semantic: "span",
          text: { content: value, heading: 0 }, link: null, children: [],
          styles: { base: { default: {} } },
        }));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childId = convert(child as Element, depth + 1);
        if (childId) common.children.push(childId);
      }
    }
    return id;
  };
  const roots: string[] = [];
  for (const child of Array.from(parsed.body.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      const id = genId("node");
      roots.push(add({
        id, type: "box", name: tr("テキスト"), semantic: "span",
        text: { content: child.textContent.replace(/\s+/g, " ").trim(), heading: 0 },
        link: null, children: [], styles: { base: { default: {} } },
      }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const id = convert(child as Element);
      if (id) roots.push(id);
    }
  }
  const bodyStyles = toStyles(parsed.body);
  const pageId = genId("page");
  const name = parsed.title.trim() || tr("HTMLから変換したページ");
  const description = parsed.head.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const retainedCss = unusedRules.length ? "<style>\n" + escapeStyleContent(unusedRules.join("\n")) + "\n</style>" : "";
  const headMarkup = [unusedHead.join("\n"), retainedCss].filter(Boolean).join("\n");
  const page: Page = {
    id: pageId, name, title: name, slug: "", description, children: roots,
    ...(Object.values(bodyStyles).some((item) => Object.values(item).some((m) => !!m && Object.keys(m).length)) ? { bodyStyles } : {}),
    ...(headMarkup ? { customTopHtml: headMarkup } : {}),
    ...(scripts.length ? { customEndHtml: scripts.join("\n") } : {}),
  };
  // Unsupported media and selector rules are retained for export; their preview
  // fidelity is limited because arbitrary class attributes are not part of DocNode.
  if (unusedRules.length) warn(tr("変換できなかったCSSはカスタムコードに残しました。編集画面と公開サイトで表示が異なる場合があります。"));
  return {
    doc: {
      schemaVersion: 1, siteName: name, pages: { [pageId]: page }, pageOrder: [pageId],
      nodes, assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
      breakpoints: normalizeBreakpoints(breakpoints),
    },
    warnings,
  };
}
