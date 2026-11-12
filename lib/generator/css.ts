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
 * Google Fonts の名前の形（英数字と空白）のものだけを使う（他のサイトから貼り付けたフォントもこれで確かめる）
 */
function isSafeGoogleFont(f: { value: string; google?: { importName: string } }): boolean {
  return !!f.google && /^[A-Za-z][A-Za-z0-9 ]*$/.test(f.value) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f.google.importName);
}

function fontFamilyCss(doc: SiteDoc, value: string): string {
  const font = allFonts(doc.customFonts).find((f) => f.value === value);
  if (font?.google && isSafeGoogleFont(font)) return `var(${font.google.cssVar}), "${value}", sans-serif`;
  return value;
}

/* ---------- CSS の生成 ---------- */

/** ZIP の HTML を直列化したときに生じる区切り文字は保ち、追加のクエリの & だけを変換する。 */
function htmlAssetQuerySuffix(suffix: string): string {
  // 任意の &name; を文字参照として扱うと、名前の分からないクエリを壊してしまう。
  // 名前付きの参照は、引用符・空白・山括弧・& だけを扱い、HTML 全体は解析し直さない。
  const entity = /^&(?:#(?:[xX][\da-fA-F]+|\d+);?|(?:apos|Tab|NewLine);|(?:amp|AMP|quot|QUOT|lt|LT|gt|GT)(?:;|(?![A-Za-z\d=])))/.exec(suffix)?.[0];
  if (!entity) return suffix.replace(/^&/, "?");
  const name = entity.slice(1).replace(/;$/, "");
  const point = /^#[xX]/.test(name) ? parseInt(name.slice(2), 16)
    : name.startsWith("#") ? parseInt(name.slice(1), 10) : undefined;
  // &quot; などの引用符・空白や数値文字参照を、クエリと取り違えない。
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
    // 外部のスクリプトファイルには元の ZIP のディレクトリを使い、サイトを書き出した後も
    // 相対的な ESM の import が解決できるようにする。
    const target = prop === "rawHtml" && isZipJavascript(asset)
      ? importedAssetUrl(asset) || `/assets/${name}` : `/assets/${name}`;
    if (source) sources.set(source, target);
    if (zipStylesheet(asset)) sources.set(zipCssUrl(asset.id), `/assets/${name}`);
  }
  if (prop === "rawHtml") {
    // HTML の ZIP の参照は CSS の字句ではないため、既存の HTML の書き出しの処理をそのまま使う。
    const output = value.replace(/tsumu-zip-css:([A-Za-z0-9%._~-]+)/g, (_token, encoded: string) => {
      let id = "";
      try { id = decodeURIComponent(encoded); } catch { /* explicit error below */ }
      const name = assetNames.get(id);
      if (!name || !zipStylesheet(doc.assets[id])) throw new Error(tr("The ZIP stylesheet data could not be read. Import the ZIP again."));
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
    // script・style などの本文では、&quot; も文字どおりのクエリになり得る。
    // 属性の中の引用符や > を保ったまま本文を分け、文字参照の扱いだけを切り替える。
    // title や textarea の中のタグのような文字列も、独立したタグとして解釈しない。
    // <style-card> などのカスタム要素を取り違えないよう、単語の境界ではなくタグ名の終わりで判定する。
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
    // 取り込んだ文書には、不正なイージング・カスタムのキーフレーム・識別子が含まれることがある。
    // 不正なモーションだけを落とし、他のアニメーションは残す。
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
            doc,
            part.selector(`.${cls}${suffix}`),
            part.map,
            assetNames,
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
            doc,
            `${base}::selection, ${base} *::selection`,
            selMap,
            assetNames,
            bp === "base" ? "" : "  "
          );
          if (bp === "base") blocks.push(rule);
          else mediaBlocks[bp].push(rule);
        }
        if (state === "default" && inferredPosition) map.position = inferredPosition;
        // 要素のカスタム CSS とモーションは、base の既定のルールに追記する
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
 * カスタム CSS を宣言ごとに分ける。url(data:image/png;base64,…) や引用符の中の「;」では分けない
 * （エディタのキャンバスは書いたとおりに当てるため、同じ宣言になるようにする）
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
    } else if (c === "\\") {
      cur += c + (css[++i] ?? "");
      continue;
    } else if (c === "/" && css[i + 1] === "*") {
      // コメントは CSS の字句の間の空白であって、宣言の区切りではない。
      // 特に、コメントの中の引用符やセミコロンで、解析の結果を変えてはいけない。
      const end = css.indexOf("*/", i + 2);
      cur += " ";
      if (end < 0) break;
      i = end + 1;
      continue;
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
