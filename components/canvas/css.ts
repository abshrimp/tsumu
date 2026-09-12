/**
 * キャンバスに当てる CSS（要素のスタイル・画面幅・状態）と、HTMLページのプレビュー用の本文のスタイル
 */

import { escapeStyleContent } from "../../lib/css-assets";
import { safeCssDeclaration } from "../../lib/css-declaration";
import { keyframesCss, motionCss } from "../../lib/motion";
import type { Breakpoint, DocNode, NodeStyles, SiteDoc, StyleState } from "../../lib/types";
import { customStateSelector } from "../../lib/custom-states";
import { cssQuotedAttributeValue } from "../../lib/css-selector";
import {
  bpChain,
  isHiddenAt,
  extractPartStyles,
  extractSelectionStyles,
  resolveStyleMap,
  resolveStyles,
} from "../../lib/style";

/* ---------- キャンバス用CSS生成 ---------- */

/** 宣言の検証を共通にして、キャンバスと書き出したサイトの CSS を食い違わせない。 */
function cssBody(map: Record<string, string>): string {
  return Object.entries(map)
    .flatMap(([key, value]) => {
      const declaration = safeCssDeclaration(key, value);
      return declaration ? [declaration] : [];
    })
    .join(" ");
}

export function previewHtmlWithBodyStyles(
  html: string,
  styles: NodeStyles | undefined,
  bp: Breakpoint
): string {
  const map = resolveStyleMap(styles, bp, "default");
  map.width ??= "auto";
  map.height ??= "auto";
  const safeCss = escapeStyleContent(cssBody(map));
  const style = `<style data-editor-body-style>body { ${safeCss} }</style>`;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, (end) => `${style}${end}`)
    : `${style}${html}`;
}

interface NodeCss {
  rules: string;
  usedKeyframes: string[];
  customKeyframes: { name: string; css: string }[];
}

/** 現在のキャンバスで、ノードごとに最後に描画したルールだけを残す。 */
export type CanvasCssCache = Map<string, {
  node: DocNode;
  context: string;
  state: StyleState;
  hasAbsChild: boolean;
  css: NodeCss;
}>;

function buildNodeCss(
  node: DocNode,
  id: string,
  bp: Breakpoint,
  mode: "design" | "preview",
  state: StyleState,
  hasAbsChild: boolean
): NodeCss {
  const rules: string[] = [];
  // 通常の data-node と、インスタンス内の data-ghost の両方に適用する
  const safeId = cssQuotedAttributeValue(id);
  const sel = `.cv-root :is([data-node=${safeId}], [data-ghost=${safeId}])`;

  // モーション（transition は常に、animation はプレビューのときだけ。画面に入ったときのきっかけは即座に再生する）
  const mCss = motionCss(node.motions, "run", node.id);
  const motionBase =
    mode === "preview"
      ? mCss.base
      : mCss.base.filter((d) => d.startsWith("transition:"));
  const motionExtra = motionBase.length ? " " + motionBase.join(" ") : "";
  if (mode === "preview") {
    for (const p of mCss.pseudo) {
      rules.push(`${sel}${p.pseudo} { ${p.decls.join(" ")} }`);
    }
  }

  // 直接書いた CSS の宣言（ルールを壊さないよう、波括弧は取り除く）
  const raw = node.customCss?.replace(/[{}]/g, " ").trim() ?? "";
  const extra = raw ? ` ${raw}${raw.endsWith(";") ? "" : ";"}` : "";

  const map = resolveStyles(node, bp, state);
  map.width ??= "auto";
  // 音声はブラウザ標準の操作部の高さを保つ（auto で上書きすると潰れる）。
  if (node.type !== "media" || node.media?.kind !== "audio") map.height ??= "auto";
  const selMap = extractSelectionStyles(map);
  const parts = extractPartStyles(map);
  if (hasAbsChild && !map.position) map.position = "relative";
  if (isHiddenAt(node, bp)) map.display = "none";
  rules.push(`${sel} { ${cssBody(map)}${extra}${motionExtra} }`);
  if (selMap) {
    rules.push(
      `${sel}::selection, ${sel} *::selection { ${cssBody(selMap)} }`
    );
  }
  for (const p of parts) rules.push(`${p.selector(sel)} { ${cssBody(p.map)} }`);
  if (mode === "preview") {
    const customStates = [...new Set(Object.values(node.styles)
      .flatMap((states) => Object.keys(states))
      .filter((state) => customStateSelector(state) !== null))];
    for (const st of [...["hover", "active", "focus"], ...customStates] as StyleState[]) {
      const merged: Record<string, string> = {};
      for (const b of bpChain(bp)) Object.assign(merged, node.styles[b]?.[st]);
      const suffix = customStateSelector(st) ?? `:${st}`;
      const stSel = extractSelectionStyles(merged);
      for (const p of extractPartStyles(merged)) {
        rules.push(`${p.selector(`${sel}${suffix}`)} { ${cssBody(p.map)} }`);
      }
      if (Object.keys(merged).length) {
        rules.push(`${sel}${suffix} { ${cssBody(merged)} }`);
      }
      if (stSel) {
        rules.push(
          `${sel}${suffix}::selection, ${sel}${suffix} *::selection { ${cssBody(stSel)} }`
        );
      }
    }
  }
  return {
    rules: rules.join("\n"),
    usedKeyframes: mCss.usedKeyframes,
    customKeyframes: mCss.customKeyframes,
  };
}

export function buildCanvasCss(
  doc: SiteDoc,
  rootIds: string[],
  bp: Breakpoint,
  mode: "design" | "preview",
  selection: string | null,
  styleState: StyleState,
  bodyStyles?: NodeStyles,
  cache?: CanvasCssCache
): string {
  // 独自のブレークポイントの順序を変えると、ノードを置き換えなくても CSS の優先順位が変わる。
  const chain = bpChain(bp);
  const context = JSON.stringify([mode, bp, ...chain]);
  const rules: string[] = [];
  const walked = new Set<string>();
  const usedKeyframes: string[] = [];
  const customKeyframes: { name: string; css: string }[] = [];
  const walk = (id: string) => {
    if (walked.has(id)) return;
    walked.add(id);
    const node = doc.nodes[id];
    if (!node) return;
    // インスタンス → マスターのツリーの CSS も生成する
    if (node.type === "instance") {
      const comp = doc.components?.[node.componentId ?? ""];
      if (comp) walk(comp.rootId);
      if (isHiddenAt(node, bp)) {
        const safeId = cssQuotedAttributeValue(id);
        rules.push(`.cv-root :is([data-node=${safeId}], [data-instance-node~=${safeId}]) { display: none !important; }`);
      }
      return;
    }
    // 直下に絶対配置の子がある場合、このノードがその配置の基準になる。
    const hasAbsChild = node.children.some((cid) => {
      const styles = doc.nodes[cid]?.styles;
      for (let i = chain.length - 1; i >= 0; i--) {
        const defaults = styles?.[chain[i]]?.default;
        if (defaults && Object.hasOwn(defaults, "position")) return defaults.position === "absolute";
      }
      return false;
    });
    const state = mode === "design" && id === selection ? styleState : "default";
    const cached = cache?.get(id);
    let css: NodeCss;
    if (cached?.node === node && cached.context === context &&
        cached.state === state && cached.hasAbsChild === hasAbsChild) {
      css = cached.css;
    } else {
      css = buildNodeCss(node, id, bp, mode, state, hasAbsChild);
      cache?.set(id, { node, context, state, hasAbsChild, css });
    }
    rules.push(css.rules);
    usedKeyframes.push(...css.usedKeyframes);
    customKeyframes.push(...css.customKeyframes);
    node.children.forEach(walk);
  };
  const bodyMap = resolveStyleMap(bodyStyles, bp, "default");
  bodyMap.width ??= "auto";
  bodyMap.height ??= "auto";
  if (Object.keys(bodyMap).length) {
    rules.push(`.cv-root { ${cssBody(bodyMap)} }`);
  }
  rootIds.forEach(walk);
  if (cache) {
    for (const [id, entry] of cache) {
      if (!walked.has(id) || entry.node !== doc.nodes[id]) cache.delete(id);
    }
  }
  // モーションで使うキーフレーム
  const kf = keyframesCss(usedKeyframes, customKeyframes);
  return (kf ? kf + "\n" : "") + rules.join("\n");
}
