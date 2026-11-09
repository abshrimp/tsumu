import { zipCssUrl, zipStylesheet } from "../zip-css";
import { importedAssetUrl, isZipJavascript } from "./imported-assets";
import { tr } from "../i18n";
/**
 * サイト全体のCSS（要素のスタイル・画面幅・状態・フォント）の書き出し
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
  STATE_INFO,
  STATE_ORDER,
} from "../style";
import { KEYFRAMES, keyframesCss, motionCss } from "../motion";
import { customStateSelector } from "../custom-states";
import { safeCssDeclaration, safeCssDeclarationValue, safeCssPropertyName, safeCssKeyframesBody } from "../css-declaration";

/* ---------- フォント ---------- */

export function usedGoogleFonts(doc: SiteDoc) {
  const families = new Set<string>();
  for (const page of Object.values(doc.pages)) {
    for (const bp of Object.values(page.bodyStyles ?? {})) {
      for (const map of Object.values(bp)) {
        if (map?.fontFamily) families.add(map.fontFamily);
      }
    }
  }
  for (const node of Object.values(doc.nodes)) {
    for (const bp of Object.values(node.styles)) {
      for (const map of Object.values(bp)) {
        if (map?.fontFamily) families.add(map.fontFamily);
      }
    }
  }
  return allFonts(doc.customFonts).filter(
    (f) => isSafeGoogleFont(f) && families.has(f.value)
  );
}

/**
 * next/font で読み込む Google フォントか。名前は生成するコード（import の名前・CSS）にそのまま入るため、
 * Google Fonts の名前の形（英数字と空白）だけを使う（ほかのサイトから貼り付けたフォントも通る）
 */
function isSafeGoogleFont(f: { value: string; google?: { importName: string } }): boolean {
  return !!f.google && /^[A-Za-z][A-Za-z0-9 ]*$/.test(f.value) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.google.importName);
}

function fontFamilyCss(doc: SiteDoc, value: string): string {
  const font = allFonts(doc.customFonts).find((f) => f.value === value);
  if (font?.google && isSafeGoogleFont(font)) return `var(${font.google.cssVar}), "${value}", sans-serif`;
  return value;
}

/* ---------- CSS生成 ---------- */

/** ZIPのHTML直列化で生じる区切り文字を保ち、追加クエリの & だけを変換する。 */
function htmlAssetQuerySuffix(suffix: string): string {
  // 任意の &name; を文字参照扱いすると、未知の名前のクエリを壊す。
  // 名前付き参照は引用符・空白・山括弧・& を扱い、HTML全体は再パースしない。
  const entity = /^&(?:#(?:[xX][\da-fA-F]+|\d+);?|(?:apos|Tab|NewLine);|(?:amp|AMP|quot|QUOT|lt|LT|gt|GT)(?:;|(?![A-Za-z\d=])))/.exec(suffix)?.[0];
  if (!entity) return suffix.replace(/^&/, "?");
  const name = entity.slice(1).replace(/;$/, "");
  const point = /^#[xX]/.test(name) ? parseInt(name.slice(2), 16)
    : name.startsWith("#") ? parseInt(name.slice(1), 10) : undefined;
  // &quot; 等の引用符・空白や数値文字参照をクエリと誤認しない。
  // &amp;quot; は二重にデコードせず、実際の区切りの1文字分だけを取り除く。
  return name === "amp" || name === "AMP" || point === 38
    ? "?" + suffix.slice(entity.length) : suffix;
}

export function cssValue(
  doc: SiteDoc,
  prop: string,
  value: string,
  assetNames: Map<string, string>
): string {
  if (prop === "fontFamily") return fontFamilyCss(doc, value);
  const sources = new Map<string, string>();
  for (const asset of Object.values(doc.assets)) {
    const name = assetNames.get(asset.id);
    if (!name) continue;
    const source = asset.path
      ? `/api/assets/file?path=${encodeURIComponent(asset.path)}`
      : asset.dataUrl;
    // Use the original ZIP directory for external script files so relative
    // ESM imports continue to resolve after the site is exported.
    const target = prop === "rawHtml" && isZipJavascript(asset)
      ? importedAssetUrl(asset) || `/assets/${name}` : `/assets/${name}`;
    if (source) sources.set(source, target);
    if (zipStylesheet(asset)) sources.set(zipCssUrl(asset.id), `/assets/${name}`);
  }
  if (prop === "rawHtml") {
    // HTML ZIPの参照はCSSトークンではないため、既存のHTML書き出し処理を保つ。
    const output = value.replace(/tsumu-zip-css:([A-Za-z0-9%._~-]+)/g, (_token, encoded: string) => {
      let id = "";
      try { id = decodeURIComponent(encoded); } catch { /* explicit error below */ }
      const name = assetNames.get(id);
      if (!name || !zipStylesheet(doc.assets[id])) throw new Error(tr("ZIPのCSSデータを読み込めません。ZIPを再読み込みしてください。"));
      return `/assets/${name}`;
    });
    const rewrite = (text: string, entities = true) => {
      for (const [source, target] of sources) {
        if (source.startsWith("tsumu-zip-css:")) continue;
        text = text.split(source).map((part, index) =>
          index && source.startsWith("/api/assets/file?path=")
            ? entities ? htmlAssetQuerySuffix(part) : part.replace(/^&(?:amp;)?/, "?")
            : part
        ).join(target);
      }
      return text;
    };
    // script/style等の本文では &quot; も文字通りのクエリになり得る。
    // 属性内の引用符や > を保ったまま本文を分け、文字参照の扱いだけを切り替える。
    // title/textarea内のタグ風文字列も、独立したタグとして解釈しない。
    // <style-card> 等のカスタム要素を誤認しないよう、単語境界でなくタグ名の終端を使う。
    const tokens = /<!--[\s\S]*?(?:-->|$)|(<(script|style|xmp|iframe|noembed|noframes|title|textarea)(?=[\t\n\f\r />])(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)(<\/\2\s*>|$)|<[A-Za-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    let result = "";
    let from = 0;
    for (const match of output.matchAll(tokens)) {
      result += rewrite(output.slice(from, match.index));
      result += match[1]
        ? rewrite(match[1]) + rewrite(match[3], /^(?:title|textarea)$/i.test(match[2])) + match[4]
        : rewrite(match[0], !match[0].startsWith("<!--"));
      from = match.index + match[0].length;
    }
    return result + rewrite(output.slice(from));
  }
  return replaceCssAssetUrls(value, sources, { proxyQueries: true });
}

function ruleFor(
  doc: SiteDoc,
  selector: string,
  map: StyleMap,
  assetNames: Map<string, string>,
  indent = ""
): string {
  const body = Object.entries(map)
    .flatMap(([key, value]) => {
      if (!safeCssPropertyName(key) || !safeCssDeclarationValue(value)) return [];
      const css = safeCssDeclaration(key, cssValue(doc, key, value, assetNames));
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
  const blocks: string[] = [];
  // ブレークポイントごとのルール（サイトの設定で追加・削除できる）
  const mediaBlocks: Record<Breakpoint, string[]> = Object.fromEntries(
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
        doc,
        selector,
        map,
        assetNames,
        bp === "base" ? "" : "  "
      );
      if (bp === "base") blocks.push(rule);
      else mediaBlocks[bp].push(rule);
    }
  }

  for (const node of Object.values(doc.nodes)) {
    const cls = classNames.get(node.id)!;
    // モーション（transition + animation）
    // Imported documents can carry malformed easing, custom keyframes or
    // identifiers. Drop only the invalid motion; preserve other animations.
    const safeMotions = node.motions?.filter((m) =>
      ["state", "hover", "active", "load", "in-view"].includes(m.trigger) &&
      Number.isFinite(m.duration) && Number.isFinite(m.delay) &&
      (m.repeat === undefined || Number.isFinite(m.repeat)) &&
      safeCssDeclarationValue(m.easing) &&
      (!m.property || m.property.split(",").every((part) =>
        safeCssPropertyName(part.trim()) !== null)) &&
      (!m.direction || ["normal", "reverse", "alternate"].includes(m.direction)) &&
      (!m.fillMode || ["both", "forwards", "backwards", "none"].includes(m.fillMode)) &&
      (!m.keyframes || m.keyframes === "custom" && (!m.customKeyframes?.trim() ||
          safeCssKeyframesBody(m.customKeyframes)) ||
        KEYFRAMES.some((keyframe) => keyframe.key === m.keyframes))
    );
    const mCss = motionCss(safeMotions, "paused", node.id);
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
    // 「基準: 親要素」= 直接の親。absolute の子を持つ親は包含ブロックにする
    const hasAbsChild = node.children.some((cid) => {
      const child = doc.nodes[cid];
      if (!child) return false;
      return Object.values(child.styles).some(
        (bpStyles) => bpStyles.default?.position === "absolute"
      );
    });
    const parentPositioned = Object.values(node.styles).some(
      (bpStyles) => bpStyles.default?.position
    );
    for (const bp of BP_ORDER) {
      // base はカスタムCSS・自動relativeの注入先になるため styles が空でも処理する
      const bpStyles =
        node.styles[bp] ?? (bp === "base" ? {} : undefined);
      if (!bpStyles) continue;
      const customStates = Object.keys(bpStyles).filter((state) => customStateSelector(state) !== null) as Array<keyof typeof bpStyles>;
      for (const state of [...STATE_ORDER, ...customStates]) {
        const map = { ...bpStyles[state] };
        const suffix = customStateSelector(state) ?? STATE_INFO[state as keyof typeof STATE_INFO].pseudo;
        const isBaseDefault = bp === "base" && state === "default";
        // 画像・動画は width / height 属性の大きさで表示されるため、未指定なら auto に戻す
        //（他の要素は auto が既定値なので書かない）
        if (isBaseDefault && (node.type === "image" || node.type === "media")) {
          map.width ??= "auto";
          // 音声の未指定の高さはブラウザ標準の操作部に任せる。
          if (node.type !== "media" || node.media?.kind !== "audio") map.height ??= "auto";
        }
        // 入力欄のプレースホルダー・ファイル選択ボタン（疑似要素）のスタイルは専用ルールに分離する
        for (const part of extractPartStyles(map)) {
          const rule = ruleFor(
            doc,
            part.selector(`.${cls}${suffix}`),
            part.map,
            assetNames,
            bp === "base" ? "" : "  "
          );
          if (bp === "base") blocks.push(rule);
          else mediaBlocks[bp].push(rule);
        }
        // テキスト選択（::selection）の色は専用ルールに分離する
        const selMap = extractSelectionStyles(map);
        if (selMap) {
          const base = `.${cls}${suffix}`;
          const rule = ruleFor(
            doc,
            `${base}::selection, ${base} *::selection`,
            selMap,
            assetNames,
            bp === "base" ? "" : "  "
          );
          if (bp === "base") blocks.push(rule);
          else mediaBlocks[bp].push(rule);
        }
        if (
          bp === "base" &&
          state === "default" &&
          hasAbsChild &&
          !parentPositioned
        ) {
          map.position = "relative";
        }
        // 要素のカスタムCSS・モーションは base の既定ルールに追記
        const raw = isBaseDefault
          ? (node.customCss?.replace(/[{}]/g, " ").trim() ?? "")
          : "";
        const extraDecls = [
          ...cssDecls(raw).flatMap((declaration) => {
            const colon = declaration.indexOf(":");
            if (colon < 1) return [];
            const key = declaration.slice(0, colon).trim();
            const value = declaration.slice(colon + 1).trim();
            if (!safeCssPropertyName(key) || !safeCssDeclarationValue(value)) return [];
            const css = safeCssDeclaration(key, cssValue(doc, "customCss", value, assetNames));
            return css ? [css] : [];
          }),
          ...(isBaseDefault ? motionDecls : []),
        ];
        if (!Object.keys(map).length && !extraDecls.length) continue;
        const selector = `.${cls}${suffix}`;
        let rule = ruleFor(
          doc,
          selector,
          map,
          assetNames,
          bp === "base" ? "" : "  "
        );
        if (extraDecls.length) {
          const indent = bp === "base" ? "  " : "    ";
          const lines = extraDecls.map((d) => `${indent}${d}`).join("\n");
          // 置き換えの文字列にすると、CSS の中の「$&」「$1」が置き換えの記号として読まれる
          rule = rule.replace(/\n(\s*)}$/, (_, sp: string) => `\n${lines}\n${sp}}`);
        }
        if (bp === "base") {
          blocks.push(rule);
        } else {
          mediaBlocks[bp].push(rule);
        }
      }
    }
    // デバイス別の非表示は、その画面幅の範囲だけに効かせる
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
 * 別のクラス同士のルールの順番を入れ替えても見た目は変わらない。
 * 擬似クラス付き・複数のルールを含むものはそのまま残す
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

/** htmlに背景を置くとbodyの背景は画面全体に広がらないため、bodyを画面の高さまで伸ばす */
function htmlBackgroundCss(color: string, htmlSel: string, bodySel: string): string {
  const background = safeCssDeclarationValue(color) ? color : "transparent";
  return `${htmlSel} {\n  background: ${background};\n}\n\n${bodySel} {\n  min-height: 100vh;\n}`;
}

export function rawHtmlWithBodyStyles(
  doc: SiteDoc,
  page: Page,
  html: string,
  assetNames: Map<string, string>
): string {
  const base: string[] = [];
  const responsive: string[] = [];
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
    const rule = ruleFor(doc, "body", map, assetNames, bp === "base" ? "" : "  ");
    if (bp === "base") base.push(rule);
    else {
      responsive.push(
        `@media (max-width: ${BP_INFO[bp].maxWidth}px) {\n${rule}\n}`
      );
    }
  }
  const css = escapeStyleContent([...base, ...responsive].join("\n\n"));
  if (!css) return html;
  const style = `<style data-editor-body-style>\n${css}\n</style>`;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, (end) => `${style}\n${end}`)
    : `${style}\n${html}`;
}

/**
 * カスタムCSSを宣言ごとに分ける。url(data:image/png;base64,…) や引用符の中の「;」では分けない
 * （エディタのキャンバスは書いたまま当てるので、同じ宣言になるようにする）
 */
function cssDecls(css: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") {
        cur += c + (css[++i] ?? "");
        continue;
      }
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
    } else if (c === ";" && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
