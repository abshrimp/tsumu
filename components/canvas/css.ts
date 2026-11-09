/**
 * キャンバスに当てるCSS（要素のスタイル・画面幅・状態）と、HTMLページのプレビュー用の本文スタイル
 */

import { escapeStyleContent } from "../../lib/css-assets";
import { keyframesCss, motionCss } from "../../lib/motion";
import type { Breakpoint, NodeStyles, SiteDoc, StyleState } from "../../lib/types";
import { customStateSelector } from "../../lib/custom-states";
import {
  bpChain,
  isHiddenAt,
  extractPartStyles,
  extractSelectionStyles,
  resolveStyleMap,
  resolveStyles,
} from "../../lib/style";

/* ---------- キャンバス用CSS生成 ---------- */

/** A SiteDoc can contain arbitrary style-map keys and values. Treat each entry as
 * one declaration, not as trusted CSS source that can terminate the canvas rule. */
function safeDeclarationValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let quote = "";
  let depth = 0;
  let comment = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const next = value[i + 1];
    if (comment) {
      if (c === "*" && next === "/") { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && next === "*") { comment = true; i++; continue; }
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") { depth++; continue; }
    if (c === ")") { if (depth === 0) return false; depth--; continue; }
    if (c === "{" || c === "}" || (c === ";" && depth === 0)) return false;
    if (c === "<" && /^<\/style\b/i.test(value.slice(i))) return false;
  }
  return !quote && !comment && depth === 0;
}

function cssBody(map: Record<string, string>): string {
  return Object.entries(map)
    .flatMap(([key, value]) => {
      // Camel-cased React properties, vendor prefixes and CSS custom properties.
      // Reject punctuation/whitespace that could create a new selector or at-rule.
      if (!/^(?:--[\w\u0080-\uFFFF-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/.test(key)) return [];
      if (!safeDeclarationValue(value)) return [];
      const name = key.startsWith("--") ? key : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      return [`${name}: ${value};`];
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

export function buildCanvasCss(
  doc: SiteDoc,
  rootIds: string[],
  bp: Breakpoint,
  mode: "design" | "preview",
  selection: string | null,
  styleState: StyleState,
  bodyStyles?: NodeStyles
): string {
  const rules: string[] = [];
  const walked = new Set<string>();
  const usedKeyframes: string[] = [];
  const customKeyframes: { name: string; css: string }[] = [];
  const walk = (id: string) => {
    if (walked.has(id)) return;
    walked.add(id);
    const node = doc.nodes[id];
    if (!node) return;
    // インスタンス → マスターのツリーのCSSも生成
    if (node.type === "instance") {
      const comp = doc.components?.[node.componentId ?? ""];
      if (comp) walk(comp.rootId);
      if (isHiddenAt(node, bp)) {
        const safeId = JSON.stringify(id);
        rules.push(`.cv-root :is([data-node=${safeId}], [data-instance-node~=${safeId}]) { display: none !important; }`);
      }
      return;
    }
    // 通常の data-node と、インスタンス内の data-ghost の両方に効かせる
    const safeId = JSON.stringify(id);
    const sel = `.cv-root :is([data-node=${safeId}], [data-ghost=${safeId}])`;

    // モーション（transitionは常時、animationはプレビュー時のみ・画面内トリガーは即時再生）
    const mCss = motionCss(node.motions, "run", node.id);
    usedKeyframes.push(...mCss.usedKeyframes);
    customKeyframes.push(...mCss.customKeyframes);
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

    // 生CSS宣言（波括弧はルール破壊防止のため除去）
    const raw = node.customCss?.replace(/[{}]/g, " ").trim() ?? "";
    const extra = raw ? ` ${raw}${raw.endsWith(";") ? "" : ";"}` : "";

    // 「基準: 親要素」= 直接の親。absolute の子を持つ親は包含ブロックにする
    const hasAbsChild = node.children.some(
      (cid) =>
        doc.nodes[cid] &&
        resolveStyles(doc.nodes[cid], bp, "default").position === "absolute"
    );

    if (mode === "design") {
      const state = id === selection ? styleState : "default";
      const map = { ...resolveStyles(node, bp, state) };
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
    } else {
      const base = { ...resolveStyles(node, bp, "default") };
      base.width ??= "auto";
      if (node.type !== "media" || node.media?.kind !== "audio") base.height ??= "auto";
      const selMap = extractSelectionStyles(base);
      const parts = extractPartStyles(base);
      if (hasAbsChild && !base.position) base.position = "relative";
      if (isHiddenAt(node, bp)) base.display = "none";
      rules.push(`${sel} { ${cssBody(base)}${extra}${motionExtra} }`);
      if (selMap) {
        rules.push(
          `${sel}::selection, ${sel} *::selection { ${cssBody(selMap)} }`
        );
      }
      for (const p of parts) rules.push(`${p.selector(sel)} { ${cssBody(p.map)} }`);
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
    node.children.forEach(walk);
  };
  const bodyMap = resolveStyleMap(bodyStyles, bp, "default");
  bodyMap.width ??= "auto";
  bodyMap.height ??= "auto";
  if (Object.keys(bodyMap).length) {
    rules.push(`.cv-root { ${cssBody(bodyMap)} }`);
  }
  rootIds.forEach(walk);
  // モーションで使うキーフレーム
  const kf = keyframesCss(usedKeyframes, customKeyframes);
  return (kf ? kf + "\n" : "") + rules.join("\n");
}
