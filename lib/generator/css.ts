import { decodeHTMLAttribute } from "entities/decode";
import type { PublishTarget } from "../generator";
import { insertIntoHtmlHead } from "./head";
import { zipCssUrl, zipStylesheet } from "../zip-css";
import { importedAssetUrl, isZipJavascript } from "./imported-assets";
import { tr } from "../i18n";
/**
 * サイト全体の CSS（要素のスタイル・画面幅・状態・フォント）の書き出し
 */

import { escapeStyleContent, replaceCssAssetUrls } from "../css-assets";
import type { Breakpoint, Page, SiteDoc, StyleMap } from "../types";
import {
  allFonts,
  BP_INFO,
  BP_ORDER,
  bpRangeQuery,
  extractPartStyles,
  extractSelectionStyles,
  isHiddenAt,
  resolveStyles,
  STATE_INFO,
  STATE_ORDER,
} from "../style";
import { keyframesCss, motionCss } from "../motion";
import { customStateSelector } from "../custom-states";
import { cssDecls, safeCssDeclaration, safeCssDeclarationValue, safeCssPropertyName, safeCustomCssDeclarations } from "../css-declaration";

/* ---------- フォント ---------- */

function usedFontFamilies(doc: SiteDoc) {
  const families = new Set<string>();
  for (const page of Object.values(doc.pages)) {
    for (const styles of [page.bodyStyles, page.bodyDarkStyles]) {
      for (const bp of Object.values(styles ?? {})) {
        for (const map of Object.values(bp)) {
          if (map?.fontFamily) families.add(map.fontFamily);
        }
      }
    }
  }
  for (const node of Object.values(doc.nodes)) {
    for (const styles of [node.styles, node.darkStyles]) {
      for (const bp of Object.values(styles ?? {})) {
        for (const map of Object.values(bp)) {
          if (map?.fontFamily) families.add(map.fontFamily);
        }
      }
    }
  }
  return families;
}

export function usedGoogleFonts(doc: SiteDoc) {
  const families = usedFontFamilies(doc);
  return allFonts(doc.customFonts).filter(
    (f) => isSafeGoogleFont(f) && families.has(f.value)
  );
}

/** Only referenced uploaded fonts are emitted into generated stylesheets. */
export function usedUploadedFonts(doc: SiteDoc) {
  const families = usedFontFamilies(doc);
  return (doc.uploadedFonts ?? []).filter(font => families.has(font.family) &&
    Object.hasOwn(doc.assets, font.assetId));
}

/** Bundle local fonts as first-party static files. Missing fonts retain CSS fallback. */
export function uploadedFontsCss(doc: SiteDoc, assetNames: Map<string, string>): string {
  return usedUploadedFonts(doc).map(font => {
    const asset = doc.assets[font.assetId];
    const name = assetNames.get(font.assetId);
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) return "";
    const ext = name.split(".").pop()?.toLowerCase();
    const format = ext === "woff2" ? "woff2" : ext === "woff" ? "woff" :
      ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : null;
    if (!format || !asset || !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(font.family)) return "";
    return "@font-face { font-family: " + cssQuoted(font.family) +
      "; src: url(" + cssQuoted("/assets/" + name) + ") format(" + cssQuoted(format) +
      "); font-style: normal; font-weight: 400; font-display: swap; }\n";
  }).join("");
}

export function usedAdobeFonts(doc: SiteDoc) {
  if (!doc.adobeFonts?.length) return [];
  const families = usedFontFamilies(doc);
  return doc.adobeFonts.filter((f) => families.has(f.family));
}

/**
 * next/font で読み込む Google フォントか。名前は生成するコード（import の名前・CSS）にそのまま入るため、
 * Google Fonts の名前の形（英数字と空白）のものだけを使う（他のサイトから貼り付けたフォントもこれで確かめる）
 */
function isSafeGoogleFont(f: { value: string; google?: { importName: string } }): boolean {
  return !!f.google && /^[A-Za-z][A-Za-z0-9 ]*$/.test(f.value) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.google.importName);
}

/** フォント名を、1つの CSS の文字列の字句として引用符で囲む。 */
function cssQuoted(value: string): string {
  return '"' + value.replace(/[\x00-\x1f\x7f"\\]/g, (char) =>
    "\\" + char.codePointAt(0)!.toString(16) + " ") + '"';
}

/** Google Fonts の @import と CSS 変数の宣言をまとめて出力する。 */
export function googleFontsCss(doc: SiteDoc): string {
  const fonts = usedGoogleFonts(doc);
  if (!fonts.length) return "";
  const imports = fonts.map((font) =>
    '@import url("https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(font.value).replace(/%20/g, "+") +
    ':wght@' + (font.google?.weights?.length ? font.google.weights.join(";") : "400") +
    '&display=swap");');
  const declarations = fonts.filter((font) => /^--[\w-]+$/.test(font.google!.cssVar)).map((font) =>
    "  " + font.google!.cssVar + ": " + cssQuoted(font.value) + ", sans-serif;");
  return imports.join("\n") + (declarations.length ? "\n:root {\n" + declarations.join("\n") + "\n}\n" : "\n");
}

/* ---------- CSS の生成 ---------- */

/** ZIP の HTML を直列化したときに生じる区切り文字は保ち、追加のクエリの & だけを変換する。 */
function htmlAssetQuerySeparator(suffix: string, entities: boolean): number {
  if (!suffix.startsWith("&")) return 0;
  if (!entities) return suffix.startsWith("&amp;") ? 5 : 1;
  // 任意の &name; を文字参照として扱うと、名前の分からないクエリを壊してしまう。
  // 名前付きの参照は、引用符・空白・山括弧・& だけを扱い、HTML 全体は解析し直さない。
  const entity = /^&(?:#(?:[xX][\da-fA-F]+|\d+);?|(?:apos|Tab|NewLine);|(?:amp|AMP|quot|QUOT|lt|LT|gt|GT)(?:;|(?![A-Za-z\d=])))/.exec(suffix)?.[0];
  if (!entity) return 1;
  const name = entity.slice(1).replace(/;$/, "");
  const point = /^#[xX]/.test(name) ? parseInt(name.slice(2), 16)
    : name.startsWith("#") ? parseInt(name.slice(1), 10) : undefined;
  // &quot; などの引用符・空白や数値文字参照を、クエリと取り違えない。
  // &amp;quot; は二重にデコードせず、実際の区切りの1文字分だけを取り除く。
  return name === "amp" || name === "AMP" || point === 38
    ? entity.length : 0;
}

function buildAssetSources(doc: SiteDoc, assetNames: Map<string, string>, format: "css" | "html") {
  const sources = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    const name = assetNames.get(asset.id);
    if (!name) continue;
    const source = asset.path
      ? `/api/assets/file?path=${encodeURIComponent(asset.path)}`
      : asset.dataUrl;
    // 外部のスクリプトファイルには元の ZIP のディレクトリを使い、サイトを書き出した後も
    // 相対的な ESM の import が解決できるようにする。
    const target = format === "html" && isZipJavascript(asset)
      ? importedAssetUrl(asset) || `/assets/${name}` : `/assets/${name}`;
    if (source) sources.set(source, target);
    if (zipStylesheet(asset)) sources.set(zipCssUrl(asset.id), `/assets/${name}`);
  }
  return sources;
}

type CssValueResolver = (prop: string, value: string) => string;

export function createCssValueResolver(doc: SiteDoc, assetNames: Map<string, string>): CssValueResolver {
  let sources: Map<string, string> | undefined;
  let fonts: ReturnType<typeof allFonts> | undefined;
  return (prop, value) => {
    if (prop === "fontFamily") {
      fonts ??= allFonts(doc.customFonts, doc.adobeFonts, doc.uploadedFonts);
      const font = fonts.find(f => f.value === value);
      if (font?.google && isSafeGoogleFont(font)) return `var(${font.google.cssVar}), "${value}", sans-serif`;
      if ((font?.adobe || font?.uploaded) && /^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(value)) {
        return `"${value}", sans-serif`;
      }
      return value;
    }
    // A CSS URL occurs in a function or a quoted @import.
    if (!assetNames.size || !/[(@]/.test(value)) return value;
    sources ??= buildAssetSources(doc, assetNames, "css");
    return replaceCssAssetUrls(value, sources, { proxyQueries: true });
  };
}

export function rewriteHtmlAssetUrls(doc: SiteDoc, value: string, assetNames: Map<string, string>): string {
  const sources = [...buildAssetSources(doc, assetNames, "html")].filter(([source]) => !source.startsWith("tsumu-zip-css:"));
  // HTML の ZIP の参照は CSS の字句ではないため、既存の HTML の書き出しの処理をそのまま使う。
  const output = value.replace(/tsumu-zip-css:([A-Za-z0-9%._~-]+)/g, (_token, encoded: string) => {
    let id = "";
    try { id = decodeURIComponent(encoded); } catch { /* explicit error below */ }
    const name = assetNames.get(id);
    if (!name || !zipStylesheet(doc.assets[id])) throw new Error(tr("The ZIP stylesheet data could not be read. Import the ZIP again."));
    return `/assets/${name}`;
  });
  if (!sources.length) return output;
  const rewrite = (text: string, entities = true, urlAttribute = false) => {
    if (!text) return text;
    const edits: { start: number; end: number; value: string }[] = [];
    for (const [source, target] of sources) {
      const proxy = source.startsWith("/api/assets/file?path=");
      let start = text.indexOf(source);
      while (start >= 0) {
        const end = start + source.length;
        const suffix = text.slice(end);
        const separator = proxy ? htmlAssetQuerySeparator(suffix, entities) : 0;
        const after = urlAttribute && suffix.includes("&") ? decodeHTMLAttribute(suffix) : suffix;
        const complete = urlAttribute
          ? !text.slice(0, start).trim() && (!after.trimEnd() || /^[?#]/.test(after) || (separator > 0 && after.startsWith("&")))
          : (!start || !/[\p{L}\p{N}._~:/%+-]/u.test(text[start - 1]) || /&(?:quot|apos|#(?:\d+|x[\da-f]+));?$/i.test(text.slice(0, start))) &&
            /^(?:$|[\s"'\x60<>)#,?&]|\\+["'\x60]|--!?>)/.test(suffix);
        if (complete) {
          edits.push({ start, end: end + separator, value: target + (separator ? "?" : "") });
        }
        start = text.indexOf(source, end);
      }
    }
    if (!edits.length) return text;
    // Use original offsets so a longer match wins, and emitted URLs are never rewritten again.
    const parts: string[] = [];
    let from = 0;
    for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (edit.start < from) continue;
      parts.push(text.slice(from, edit.start), edit.value);
      from = edit.end;
    }
    return parts.join("") + text.slice(from);
  };
  // A quoted src/href is a single URL: punctuation, entities and surrounding paths are part of its value.
  const rewriteTag = (tag: string) => {
    const attrs = /[\t\n\f\r ]+([^\t\n\f\r />=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*("[^"]*"|'[^']*'|[^\t\n\f\r >]+))?/g;
    const parts: string[] = [];
    let from = 0;
    for (const match of tag.matchAll(attrs)) {
      const raw = match[2];
      if (!raw || !/^(?:src|href|poster|xlink:href|action|formaction|data)$/i.test(match[1])) continue;
      const quoted = raw[0] === '"' || raw[0] === "'";
      const end = match.index + match[0].length - (quoted ? 1 : 0);
      const start = end - raw.length + (quoted ? 2 : 0);
      parts.push(rewrite(tag.slice(from, start)), rewrite(tag.slice(start, end), true, true));
      from = end;
    }
    return parts.join("") + rewrite(tag.slice(from));
  };
  // script・style などの本文では、&quot; も文字どおりのクエリになり得る。
  // 属性の中の引用符や > を保ったまま本文を分け、文字参照の扱いだけを切り替える。
  // title や textarea の中のタグのような文字列も、独立したタグとして解釈しない。
  // <style-card> などのカスタム要素を取り違えないよう、単語の境界ではなくタグ名の終わりで判定する。
  const tokens = /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|(<(script|style|xmp|iframe|noembed|noframes|title|textarea)(?=[\t\n\f\r />])(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)(<\/\2\s*>|$)|<[A-Za-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  let result = "";
  let from = 0;
  for (const match of output.matchAll(tokens)) {
    result += rewrite(output.slice(from, match.index));
    result += match[1]
      ? rewriteTag(match[1]) + rewrite(match[3], /^(?:title|textarea)$/i.test(match[2])) + match[4]
      : match[0].startsWith("<!--") ? rewrite(match[0], false) : rewriteTag(match[0]);
    from = match.index + match[0].length;
  }
  return result + rewrite(output.slice(from));
}

function ruleFor(
  resolveValue: CssValueResolver,
  selector: string,
  map: StyleMap,
  indent = ""
): string {
  const body = Object.entries(map)
    .flatMap(([key, value]) => {
      if (!safeCssPropertyName(key) || !safeCssDeclarationValue(value)) return [];
      const css = safeCssDeclaration(key, resolveValue(key, value));
      return css ? [`${indent}  ${css}`] : [];
    })
    .join("\n");
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

export function generateSiteCss(
  doc: SiteDoc,
  classNames: Map<string, string>,
  assetNames: Map<string, string>
): string {
  const resolveValue = createCssValueResolver(doc, assetNames);
  const blocks: string[] = [];
  // ブレークポイントごとのルール（サイトの設定で追加・削除できる）
  const mediaBlocks: Record<Breakpoint, string[]> = Object.fromEntries(
    BP_ORDER.map((bp) => [bp, [] as string[]])
  );
  const darkMediaBlocks: Record<Breakpoint, string[]> = Object.fromEntries(
    BP_ORDER.map((bp) => [bp, [] as string[]])
  );
  const hideRules: Record<Breakpoint, string[]> = Object.fromEntries(
    BP_ORDER.map((bp) => [bp, [] as string[]])
  );
  const usedKeyframes: string[] = [];
  const customKeyframes: { name: string; css: string }[] = [];

  for (const page of Object.values(doc.pages)) {
    const pageAttr = `[data-page-body=${JSON.stringify(page.id)}]`;
    const selector = `body:has(${pageAttr})`;
    if (page.htmlBackground) {
      blocks.push(htmlBackgroundCss(page.htmlBackground, `html:has(${pageAttr})`, selector));
    }
    for (const bp of BP_ORDER) {
      const map = { ...(page.bodyStyles?.[bp]?.default ?? {}) };
      if (!Object.keys(map).length) continue;
      const rule = ruleFor(
        resolveValue,
        selector,
        map,
        bp === "base" ? "" : "  "
      );
      if (bp === "base") blocks.push(rule);
      else mediaBlocks[bp].push(rule);
    }
    for (const bp of BP_ORDER) {
      const map = { ...(page.bodyDarkStyles?.[bp]?.default ?? {}) };
      if (!Object.keys(map).length) continue;
      darkMediaBlocks[bp].push(ruleFor(resolveValue, selector, map, bp === "base" ? "" : "  "));
    }
  }

  for (const node of Object.values(doc.nodes)) {
    const cls = classNames.get(node.id)!;
    // モーション（transition + animation）
    const mCss = motionCss(node.motions, "paused", node.id);
    usedKeyframes.push(...mCss.usedKeyframes);
    customKeyframes.push(...mCss.customKeyframes);
    const motionDecls = mCss.base;
    for (const p of mCss.pseudo) {
      if (p.pseudo !== ":hover" && p.pseudo !== ":active") continue;
      blocks.push(`.${cls}${p.pseudo} {\n${p.decls.map((d) => `  ${d}`).join("\n")}\n}`);
    }
    if (mCss.hasInView) {
      blocks.push(`.${cls}.is-inview {\n  animation-play-state: running;\n}`);
    }
    // 各幅でキャンバスと同じにする。配置の基準を推定する必要があるのは、その
    // ブレークポイントで絶対配置の子がある場合だけ。書かれた配置の指定を優先する。
    const hasCustomPosition = cssDecls(node.customCss?.replace(/[{}]/g, " ") ?? "").some((declaration) => {
      const colon = declaration.indexOf(":");
      return declaration.slice(0, colon).trim().toLowerCase() === "position" &&
        safeCssDeclarationValue(declaration.slice(colon + 1).trim());
    });
    let wasAutoPositioned = false;
    for (const bp of BP_ORDER) {
      const position = resolveStyles(node, bp, "default").position;
      const autoPositioned = !position && !hasCustomPosition && node.children.some((cid) => {
        const child = doc.nodes[cid];
        return child && resolveStyles(child, bp, "default").position === "absolute";
      });
      const inferredPosition = autoPositioned && !wasAutoPositioned ? "relative"
        : !autoPositioned && wasAutoPositioned && !position ? "static" : undefined;
      wasAutoPositioned = autoPositioned;
      // それ以外にスタイルの無い親でも、切り替わる幅ではルールが必要になる。
      const bpStyles = node.styles[bp] ?? (bp === "base" || inferredPosition ? {} : undefined);
      if (!bpStyles) continue;
      const customStates = Object.keys(bpStyles).filter((state) => customStateSelector(state) !== null) as Array<keyof typeof bpStyles>;
      for (const state of [...STATE_ORDER, ...customStates]) {
        const map = { ...bpStyles[state] };
        const suffix = customStateSelector(state) ?? STATE_INFO[state as keyof typeof STATE_INFO].pseudo;
        const isBaseDefault = bp === "base" && state === "default";
        // 画像と動画は width / height 属性の大きさで表示されるため、未指定なら auto に戻す
        //（他の要素は auto が既定値なので書かない）
        if (isBaseDefault && (node.type === "image" || node.type === "media")) {
          map.width ??= "auto";
          // 音声の高さが未指定なら、ブラウザ標準の操作部に任せる。
          if (node.type !== "media" || node.media?.kind !== "audio") map.height ??= "auto";
        }
        // 入力欄のプレースホルダーとファイル選択ボタン（擬似要素）のスタイルは、専用のルールに分ける
        for (const part of extractPartStyles(map)) {
          const rule = ruleFor(
            resolveValue,
            part.selector(`.${cls}${suffix}`),
            part.map,
            bp === "base" ? "" : "  "
          );
          if (bp === "base") blocks.push(rule);
          else mediaBlocks[bp].push(rule);
        }
        // テキストを選択したとき（::selection）の色は、専用のルールに分ける
        const selMap = extractSelectionStyles(map);
        if (selMap) {
          const base = `.${cls}${suffix}`;
          const rule = ruleFor(
            resolveValue,
            `${base}::selection, ${base} *::selection`,
            selMap,
            bp === "base" ? "" : "  "
          );
          if (bp === "base") blocks.push(rule);
          else mediaBlocks[bp].push(rule);
        }
        if (state === "default" && inferredPosition) map.position = inferredPosition;
        // 要素のカスタム CSS とモーションは、base の既定のルールに追記する
        const extraDecls = [
          ...(isBaseDefault
            ? safeCustomCssDeclarations(node.customCss, (value) => resolveValue("customCss", value))
            : []),
          ...(isBaseDefault ? motionDecls : []),
        ];
        if (!Object.keys(map).length && !extraDecls.length) continue;
        const selector = `.${cls}${suffix}`;
        let rule = ruleFor(
          resolveValue,
          selector,
          map,
          bp === "base" ? "" : "  "
        );
        if (extraDecls.length) {
          const indent = bp === "base" ? "  " : "    ";
          const lines = extraDecls.map((d) => `${indent}${d}`).join("\n");
          // 置き換えの文字列にすると、CSS の中の「$&」「$1」が置き換えの記号として読まれてしまう
          rule = rule.replace(/\n(\s*)}$/, (_, sp: string) => `\n${lines}\n${sp}}`);
        }
        if (bp === "base") {
          blocks.push(rule);
        } else {
          mediaBlocks[bp].push(rule);
        }
      }
    }
    // ダーク時の差分。ライトの基本ルールとレスポンシブ指定を残したまま上書きする。
    for (const bp of BP_ORDER) {
      const lightPosition = resolveStyles(node, bp, "default").position;
      const darkPosition = resolveStyles(node, bp, "default", "dark").position;
      const hasAbsoluteChild = (theme: "light" | "dark") => node.children.some((id) => {
        const child = doc.nodes[id];
        return child && resolveStyles(child, bp, "default", theme).position === "absolute";
      });
      // ダーク側だけで子が絶対配置になる場合も、キャンバスと同じ配置基準にする。
      // ライト側の自動配置が不要になった場合は static へ明示的に戻す。
      const lightEffective = lightPosition ??
        (!hasCustomPosition && hasAbsoluteChild("light") ? "relative" : "static");
      const darkEffective = darkPosition ??
        (!hasCustomPosition && hasAbsoluteChild("dark") ? "relative" : "static");
      const inferredDarkPosition = lightEffective === darkEffective ? undefined : darkEffective;
      const bpStyles = node.darkStyles?.[bp] ?? (inferredDarkPosition ? {} : undefined);
      if (!bpStyles) continue;
      const customStates = Object.keys(bpStyles)
        .filter((state) => customStateSelector(state) !== null) as Array<keyof typeof bpStyles>;
      for (const state of [...STATE_ORDER, ...customStates]) {
        const map = { ...bpStyles[state] };
        if (state === "default" && inferredDarkPosition && !Object.hasOwn(map, "position")) {
          map.position = inferredDarkPosition;
        }
        if (!Object.keys(map).length) continue;
        const suffix = customStateSelector(state) ?? STATE_INFO[state as keyof typeof STATE_INFO].pseudo;
        const selector = `.${cls}${suffix}`;
        for (const part of extractPartStyles(map)) {
          darkMediaBlocks[bp].push(ruleFor(resolveValue, part.selector(selector), part.map, bp === "base" ? "" : "  "));
        }
        const selection = extractSelectionStyles(map);
        if (selection) {
          darkMediaBlocks[bp].push(ruleFor(
            resolveValue, `${selector}::selection, ${selector} *::selection`,
            selection, bp === "base" ? "" : "  "
          ));
        }
        darkMediaBlocks[bp].push(ruleFor(resolveValue, selector, map, bp === "base" ? "" : "  "));
      }
    }
    // デバイスごとの非表示は、その画面幅の範囲だけに効かせる
    for (const bp of BP_ORDER) {
      if (isHiddenAt(node, bp)) {
        const selector = node.type === "instance"
          ? `[data-instance-hidden~=${JSON.stringify(cls)}]`
          : `.${cls}`;
        hideRules[bp].push(`  ${selector} {\n    display: none${node.type === "instance" ? " !important" : ""};\n  }`);
      }
    }
  }

  const merged = mergeIdenticalRules(blocks);
  blocks.length = 0;
  blocks.push(...merged);
  for (const bp of BP_ORDER.slice(1)) {
    if (!mediaBlocks[bp].length) continue;
    blocks.push(
      `@media (max-width: ${BP_INFO[bp].maxWidth}px) {\n${mergeIdenticalRules(mediaBlocks[bp]).join("\n\n")}\n}`
    );
  }
  const darkRules: string[] = mergeIdenticalRules(darkMediaBlocks.base);
  for (const bp of BP_ORDER.slice(1)) {
    if (!darkMediaBlocks[bp].length) continue;
    darkRules.push(
      `@media (max-width: ${BP_INFO[bp].maxWidth}px) {\n${mergeIdenticalRules(darkMediaBlocks[bp]).join("\n\n")}\n}`
    );
  }
  if (darkRules.length) {
    blocks.push(`@media (prefers-color-scheme: dark) {\n${darkRules.join("\n\n")}\n}`);
  }
  // 非表示は各デバイスのスタイルより後に置き、画面幅の範囲で区切る
  for (const bp of BP_ORDER) {
    if (!hideRules[bp].length) continue;
    blocks.push(
      `@media ${bpRangeQuery(bp)} {\n${mergeIdenticalRules(hideRules[bp]).join("\n\n")}\n}`
    );
  }
  const kf = keyframesCss(usedKeyframes, customKeyframes);
  if (kf) blocks.push(kf);
  return blocks.join("\n\n") + "\n";
}

/**
 * 宣言がまったく同じクラスのルールを、最初に出てきた位置で1つにまとめる
 * （例: .text, .text-2 { … }）。要素はクラスを1つずつしか持たないため、
 * 別のクラスどうしのルールの順序を入れ替えても、見た目は変わらない。
 * 擬似クラス付きのものと、複数のルールを含むものは、そのまま残す
 */
function mergeIdenticalRules(rules: string[]): string[] {
  const RULE = /^(\s*)(\.[\w-]+) \{\n([^{}]*)\n\s*\}$/;
  const out: (string | { indent: string; selectors: string[]; body: string })[] = [];
  const byBody = new Map<string, { indent: string; selectors: string[]; body: string }>();
  for (const rule of rules) {
    const m = RULE.exec(rule);
    if (!m) {
      out.push(rule);
      continue;
    }
    const [, indent, selector, body] = m;
    const key = `${indent}\n${body}`;
    const hit = byBody.get(key);
    if (hit) {
      hit.selectors.push(selector);
      continue;
    }
    const group = { indent, selectors: [selector], body };
    byBody.set(key, group);
    out.push(group);
  }
  return out.map((r) =>
    typeof r === "string"
      ? r
      : `${r.indent}${r.selectors.join(`,\n${r.indent}`)} {\n${r.body}\n${r.indent}}`
  );
}

/** html に背景を置くと body の背景は画面全体に広がらないため、body を画面の高さまで伸ばす */
function htmlBackgroundCss(color: string, htmlSel: string, bodySel: string): string {
  const background = safeCssDeclarationValue(color) ? color : "transparent";
  return `${htmlSel} {\n  background: ${background};\n}\n\n${bodySel} {\n  min-height: 100vh;\n}`;
}

export function rawHtmlWithBodyStyles(
  doc: SiteDoc,
  page: Page,
  html: string,
  assetNames: Map<string, string>,
  target: PublishTarget
): string {
  const resolveValue = createCssValueResolver(doc, assetNames);
  const base: string[] = [];
  const responsive: string[] = [];
  const darkBase: string[] = [];
  const darkResponsive: string[] = [];
  if (page.htmlBackground) {
    base.push(htmlBackgroundCss(page.htmlBackground, "html", "body"));
  }
  for (const bp of BP_ORDER) {
    const map = { ...(page.bodyStyles?.[bp]?.default ?? {}) };
    if (bp === "base") {
      map.width ??= "auto";
      map.height ??= "auto";
    }
    if (!Object.keys(map).length) continue;
    const rule = ruleFor(resolveValue, "body", map, bp === "base" ? "" : "  ");
    if (bp === "base") base.push(rule);
    else {
      responsive.push(
        `@media (max-width: ${BP_INFO[bp].maxWidth}px) {\n${rule}\n}`
      );
    }
  }
  for (const bp of BP_ORDER) {
    const map = { ...(page.bodyDarkStyles?.[bp]?.default ?? {}) };
    if (!Object.keys(map).length) continue;
    const rule = ruleFor(resolveValue, "body", map, bp === "base" ? "" : "  ");
    if (bp === "base") darkBase.push(rule);
    else darkResponsive.push(`@media (max-width: ${BP_INFO[bp].maxWidth}px) {\n${rule}\n}`);
  }
  const darkCss = [...darkBase, ...darkResponsive];
  const css = escapeStyleContent([...base, ...responsive,
    ...(darkCss.length ? [`@media (prefers-color-scheme: dark) {\n${darkCss.join("\n\n")}\n}`] : [])
  ].join("\n\n"));
  const head = [
    css ? `<style data-editor-body-style>\n${css}\n</style>` : "",
    target === "production" && page.noindex ? '<meta name="robots" content="noindex, nofollow">' : "",
  ].filter(Boolean).join("\n");
  return head ? insertIntoHtmlHead(html, head) : html;
}
