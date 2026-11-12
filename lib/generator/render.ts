/**
 * 要素のツリーを JSX に書き出す
 */

import { assetMediaUrl } from "../assets";
import { safeNavigationUrl } from "../url-policy";
import type { SiteDoc } from "../types";
import { toggleShowDisplay } from "../style";
import { embedSrc, YOUTUBE_ALLOW } from "../embed";
import { fieldVarName, RANGED_INPUTS, TEXT_INPUTS } from "../fields";
import { hasVars, KEEP_ESCAPES } from "../vars";
import { type ListOp } from "../data";
import { resolveTag } from "../tags";
import { importedAttributes, importedClass } from "../imported-html-attrs";
import { keepTokens } from "../script";
import {
  assetPath,
  crispSvgSize,
  fieldExpr,
  hasBlockDescendant,
  hasScriptsInside,
  isNextPageUrl,
  jsxString,
  listItemsExpr,
  livesHere,
  pageHref,
  scriptsAttr,
  showsSelf,
} from "./render-helpers";
import { EMPTY_GIF } from "./templates";
import { cssValue } from "./css";

/** 文字列として参照する値だけを、代替値として残す。項目の値は、ブラウザで優先する。 */
function textParts(value: string, base: string, url = false, isLive?: (name: string) => boolean): string {
  const parts: string[] = [];
  let end = 0;
  for (const m of value.matchAll(/\\\{|\{([^{}\s"'<>`]+)\}|\[slug\]/g)) {
    parts.push(JSON.stringify(value.slice(end, m.index)));
    if (m[0] === "\\{") parts.push(JSON.stringify("{"));
    else {
      const token = m[1] ?? "slug";
      const name = JSON.stringify(token), head = JSON.stringify(token.split(".")[0]);
      parts.push(`{ name: ${name}, ${url ? `at: ${m.index}, ` : ""}${isLive?.(token) ? "live: true, " : ""}...(Object.prototype.hasOwnProperty.call(${base}, ${name}) || Object.prototype.hasOwnProperty.call(${base}, ${head}) ? { fallback: interpolate(${JSON.stringify(m[0])}, { ...${base} }) } : {}) }`);
    }
    end = m.index + m[0].length;
  }
  parts.push(JSON.stringify(value.slice(end)));
  return `[${parts.join(", ")}]`;
}

/* ---------- JSX の生成 ---------- */

export interface JsxContext {
  doc: SiteDoc;
  /** 余分な DOM の包みを作らずに、インスタンスごとの表示の切り替えを受け取るコンポーネントのルート。 */
  componentRootId?: string;
  /** リストを含む部品は、ページのデータの範囲で展開する。 */
  inlineComponents?: Set<string>;
  /** 展開している使用箇所。通常の部品のファイルでは props を使う。 */
  inlineInstance?: { visibilityClass: string; anchor?: string };
  classNames: Map<string, string>;
  /** コンポーネントの ID → 出力するコンポーネント名（PascalCase） */
  componentNames: Map<string, string>;
  usesImage: boolean;
  usesLink: boolean;
  /** 表示するときの値で Link か a かを選ぶリンク（{変数} を含む URL）を使ったか */
  usesSmartLink?: boolean;
  /** リストの項目を Fragment で並べたか（react から import する） */
  usesFragment?: boolean;
  usesSearchForm: boolean;
  usedComponents: Set<string>;
  /** スクリプトで表示される対象の ID 属性（data-toggle-show の出力先） */
  toggleTargets: Set<string>;
  /** スクリプトで絞り込む配列の名前 → 項目名 */
  listFilterFields: Map<string, Set<string>>;
  /** スクリプトの {変数} のうち、画面上で値を入れるもの（ページを配信するときも残す） */
  isLive: (name: string, usage?: "length") => boolean;
  /** 検索フォームの中を描いているか（中のボタンを送信ボタンにする） */
  inForm?: boolean;
  /** アセットの ID → 一意にした出力ファイル名 */
  assetNames: Map<string, string>;
  /** 変数の解決に使うオブジェクトの式（ページでは "vars"、リストの中では "iv"） */
  varsExpr?: string;
  /** 配信する前に確定した項目だけの範囲（ページの変数は含めない）。 */
  serverItemScope?: { expr: string; used: boolean };
  /** interpolate のランタイムを使ったか */
  usesInterpolate: boolean;
  /** スクリプトの値に lookupVar を使ったか */
  usesLookup?: boolean;
  /** ブラウザで並べるリストのお手本を出力したか */
  usesTemplate?: boolean;
  /** スクリプトを含むページ専用コードを PageHtml で出力したか */
  usesPageHtml?: boolean;
  /** いま描いている要素の並び（壊れた文書の循環で止まらなくならないように） */
  renderPath?: Set<string>;
  /**
   * ブラウザで並べるリストのお手本の中を描いているか（varsExpr は templateVars の Proxy。
   * 展開する（{ ...iv }）と、項目の {名前} を残す働きが失われる）
   */
  inTemplate?: boolean;
  /**
   * リストのノードの ID → 生成するコードの中の、項目の範囲を表す変数名と、並べる配列（ページの外では未設定）。
   * client = 画面上で値が決まる配列（ブラウザでお手本を複製して並べる）
   */
  listVars?: Map<string, { ivar: string; from: string; client: boolean }>;
  /** 配列の名前 → ページを開いたときのスクリプトで決まる絞り込みと並べ替え（ページの外では未設定） */
  listOps?: Map<string, ListOp[]>;
}

export function renderNode(
  ctx: JsxContext,
  id: string,
  indent: string,
  isTop: boolean
): string {
  // 壊れた文書（要素が自分の中に入っている）でも、描き続けて止まらなくなることがないようにする
  const path = (ctx.renderPath ??= new Set());
  if (path.has(id)) return "";
  path.add(id);
  try {
    return renderNodeInner(ctx, id, indent, isTop);
  } finally {
    path.delete(id);
  }
}

function renderNodeInner(
  ctx: JsxContext,
  id: string,
  indent: string,
  isTop: boolean
): string {
  const node = ctx.doc.nodes[id];
  if (!node) return "";

  if (node.type === "instance") {
    const name = ctx.componentNames.get(node.componentId ?? "");
    if (!name) return "";
    const visibilityClass = node.hiddenOn?.length ? ctx.classNames.get(id)! : "";
    const visibility = id === ctx.componentRootId
      ? ` hiddenClassName={[${JSON.stringify(visibilityClass)}, hiddenClassName].filter(Boolean).join(" ")}`
      : visibilityClass ? ` hiddenClassName=${jsxString(visibilityClass)}` : "";
    const master = ctx.doc.components?.[node.componentId ?? ""];
    const root = master ? ctx.doc.nodes[master.rootId] : undefined;
    // ページ上の使用箇所のアンカー。マスター自身の ID と入れ子の参照は変えない。
    const anchor = !ctx.componentRootId && node.attrId && root && root.type !== "instance" && !root.attrId
      ? ` instanceId=${jsxString(node.attrId)}` : "";
    // 部品の中のリストも、置かれたページや外側の項目の変数と、実行の計画を使う。
    // 新しいデータの props は作らず、通常の部品の出力とローディング画面は変えない。
    if (root && ctx.listVars && ctx.inlineComponents?.has(node.componentId!)) {
      const previousRoot = ctx.componentRootId;
      const previousInstance = ctx.inlineInstance;
      const previousForm = ctx.inForm;
      ctx.inForm = false;
      ctx.inlineInstance = {
        visibilityClass: [visibilityClass, id === previousRoot ? previousInstance?.visibilityClass : ""].filter(Boolean).join(" "),
        anchor: anchor ? node.attrId : undefined,
      };
      ctx.componentRootId = root.id;
      try {
        return renderNode(ctx, root.id, indent, false);
      } finally {
        ctx.componentRootId = previousRoot;
        ctx.inlineInstance = previousInstance;
        ctx.inForm = previousForm;
      }
    }
    ctx.usedComponents.add(node.componentId!);
    return `${indent}<${name}${visibility}${anchor} />`;
  }

  const cls = [ctx.classNames.get(id)!, importedClass(node.htmlClass)].filter(Boolean).join(" ");
  const preserved = importedAttributes(node.htmlAttrs);
  const importedAttrs = Object.keys(preserved).length ? ` {...${JSON.stringify(preserved)}}` : "";
  const anchorAttr = node.attrId ? ` id=${jsxString(node.attrId)}`
    : id === ctx.componentRootId
      ? ctx.inlineInstance
        ? ctx.inlineInstance.anchor ? ` id=${jsxString(ctx.inlineInstance.anchor)}` : ""
        : " id={instanceId || undefined}"
      : "";
  const instanceVisibilityAttr = id === ctx.componentRootId
    ? ctx.inlineInstance
      ? ctx.inlineInstance.visibilityClass ? ` data-instance-hidden=${jsxString(ctx.inlineInstance.visibilityClass)}` : ""
      : " data-instance-hidden={hiddenClassName || undefined}"
    : "";

  // スクリプト: 実行する側には data-scripts を、表示される側には表示に戻すときの display の値を出力する
  const toggleAttrs =
    scriptsAttr(ctx, node) +
    ((node.attrId && ctx.toggleTargets.has(node.attrId)) || showsSelf(node)
      ? ` data-toggle-show=${jsxString(toggleShowDisplay(node))}`
      : id === ctx.componentRootId && !node.attrId
        ? ctx.inlineInstance
          ? ctx.inlineInstance.anchor ? ` data-toggle-show=${jsxString(toggleShowDisplay(node))}` : ""
          : ` data-toggle-show={instanceId ? ${JSON.stringify(toggleShowDisplay(node))} : undefined}`
        : "");

  // 「画面に入ったとき」は data-inview を見張り、.is-inview で再生する（リストにも付ける）
  const inViewAttr = node.motions?.some((m) => m.trigger === "in-view") ? " data-inview" : "";

  if (node.type === "list" && node.list) {
    const lv = ctx.listVars?.get(id);
    if (!lv) return "";
    const { ivar } = lv;
    // 外側の項目がブラウザで決まるなら、項目の中の配列も、配信する前には展開しない。
    const client = lv.client || !!ctx.inTemplate;
    const base = ctx.varsExpr ?? "vars";
    const filterFields = [...(ctx.listFilterFields.get(lv.from) ?? [])];
    const hasListDisplayControl = ctx.listFilterFields.has(lv.from);
    const listIdAttr = instanceVisibilityAttr +
      anchorAttr +
      toggleAttrs +
      inViewAttr + importedAttrs +
      (hasListDisplayControl || client ? ` data-array=${jsxString(lv.from)}` : "");
    const serverItems = (forceWrap = false) => {
      const wrap = forceWrap || hasListDisplayControl || node.children.some((cid) => hasScriptsInside(ctx.doc, cid, ctx.inlineComponents));
      const itemsExpr = listItemsExpr(node.list!, base, lv.from, ctx.listOps?.get(lv.from) ?? []);
      const prevVars = ctx.varsExpr;
      const prevTemplate = ctx.inTemplate;
      const prevItem = ctx.serverItemScope;
      const itemScope = { expr: `${ivar}Item`, used: false };
      ctx.varsExpr = ivar;
      ctx.serverItemScope = itemScope;
      ctx.inTemplate = false;
      const inner = node.children
        .map((cid) => renderNode(ctx, cid, indent + "        ", false))
        .join("\n");
      ctx.varsExpr = prevVars;
      ctx.serverItemScope = prevItem;
      ctx.inTemplate = prevTemplate;
      if (itemScope.used && prevItem) prevItem.used = true;
      // スクリプトの絞り込みで使う項目だけを、各項目の data-item に持たせる
      const itemAttr = hasListDisplayControl
        ? ` data-item={JSON.stringify({ ${filterFields
            .map((f) => `${JSON.stringify(f)}: ${fieldExpr("item", f)}`)
            .join(", ")} })}`
        : "";
      // 項目の中にスクリプトがあれば、項目ごとに包む（ID が指す要素を、同じ項目の中から探すため）
      return `${indent}  {${itemsExpr}.map((item, i) => {
${indent}    const ${ivar} = { ...${base}, ...item };${itemScope.used ? `\n${indent}    const ${itemScope.expr} = { ${prevItem ? `...${prevItem.expr}, ` : ""}...item };` : ""}
${indent}    return (
${indent}      ${wrap ? `<div key={i} style={{ display: "contents" }} data-row${itemAttr}>` : ((ctx.usesFragment = true), "<Fragment key={i}>")}
${inner}
${indent}      ${wrap ? "</div>" : "</Fragment>"}
${indent}    );
${indent}  })}`;
    };
    if (client) {
      // ページではブラウザが持つ配列でも、配信済みの親の項目が同じルートを持つときは、項目を優先する。
      // 行そのものを配信し、生の配列や使わない項目はブラウザへ渡さない。
      const itemScope = !ctx.inTemplate ? ctx.serverItemScope : undefined;
      const owned = itemScope ? `Object.prototype.hasOwnProperty.call(${itemScope.expr}, ${JSON.stringify(lv.from)}) || Object.prototype.hasOwnProperty.call(${itemScope.expr}, ${JSON.stringify(lv.from.split(".")[0])})` : "";
      if (itemScope) itemScope.used = true;
      const ownedRows = owned ? serverItems() : "";
      // ブラウザで並べる: お手本を {名前} を残したまま出力し、項目ごとに複製して置き換える
      const l = node.list;
      // 項目に配列が無いときは、配信済みの表示を使う。
      // 取得した生の配列は渡さず、もともと表示する項目だけをお手本に残す。
      const fallback = ctx.inTemplate && !lv.client ? serverItems(true) : "";
      const ops = ctx.listOps?.get(lv.from) ?? [];
      // 項目の値を優先し、配信するときの代替値は文字列として保つ（波括弧を解決し直さない）。
      const filterParts = (value: string) => {
        const whole = /^(?:\{([^{}\s"'<>`]+)\}|\[slug\])$/.exec(value.trim());
        if (whole) {
          ctx.usesLookup = true;
          const token = whole[1] ?? "slug", name = JSON.stringify(token), head = JSON.stringify(token.split(".")[0]);
          return `[{ name: ${name}, ...(Object.prototype.hasOwnProperty.call(${base}, ${name}) || Object.prototype.hasOwnProperty.call(${base}, ${head}) ? { fallback: lookupVar({ ...${base} }, ${name}) } : {}) }]`;
        }
        const parts: string[] = [];
        let end = 0;
        for (const m of value.matchAll(/\\\{|\{([^{}\s"'<>`]+)\}|\[slug\]/g)) {
          parts.push(JSON.stringify(value.slice(end, m.index)));
          if (m[0] === "\\{") parts.push(JSON.stringify("{"));
          else {
            const token = m[1] ?? "slug";
            const name = JSON.stringify(token), head = JSON.stringify(token.split(".")[0]);
            parts.push(`{ name: ${name}, ...(Object.prototype.hasOwnProperty.call(${base}, ${name}) || Object.prototype.hasOwnProperty.call(${base}, ${head}) ? { fallback: interpolate(${JSON.stringify(m[0])}, { ...${base} }) } : {}) }`);
          }
          end = m.index + m[0].length;
        }
        parts.push(JSON.stringify(value.slice(end)));
        return `[${parts.join(", ")}]`;
      };
      const opExpr = ops.map((op) => op.kind === "sort" ? JSON.stringify(op) :
        `{ ...${JSON.stringify(op)}, conds: [${op.conds.map((c) =>
          `{ ...${JSON.stringify(c)}, raw: ${/^(?:\{([^{}\s"'<>`]+)\}|\[slug\])$/.test(c.value.trim())}, parts: ${filterParts(c.value)} }`
        ).join(", ")}] }`
      ).join(", ");
      if (ops.length) ctx.usesInterpolate = true;
      const listAttrs = [
        " data-client-list",
        ctx.inTemplate && ops.length ? ` data-list-ops={JSON.stringify([${opExpr}])}` : "",
        l.limit && l.limit > 0 ? ` data-limit="${l.limit}"` : "",
      ].join("");
      const prevVars = ctx.varsExpr;
      const prevTemplate = ctx.inTemplate;
      const prevItem = ctx.serverItemScope;
      ctx.varsExpr = ivar;
      ctx.serverItemScope = undefined;
      ctx.inTemplate = true;
      const inner = node.children
        .map((cid) => renderNode(ctx, cid, indent + "      ", false))
        .join("\n");
      ctx.varsExpr = prevVars;
      ctx.serverItemScope = prevItem;
      ctx.inTemplate = prevTemplate;
      ctx.usesTemplate = true;
      const template = `${indent}<div${listIdAttr}${listAttrs} className=${jsxString(cls)}>
${indent}  <div data-tpl hidden style={{ display: "none" }}>
${indent}    {((${ivar}: Vars) => (
${indent}      <>
${inner}
${indent}      </>
${indent}    ))(templateVars(${base}))}
${indent}  </div>${fallback ? `\n${indent}  <div data-tpl data-list-fallback hidden style={{ display: "none" }}>\n${fallback}\n${indent}  </div>` : ""}
${indent}</div>`;
      return owned ? `${indent}{${owned} ? (
${indent}<div${listIdAttr} className=${jsxString(cls)}>
${ownedRows}
${indent}</div>
${indent}) : (
${template}
${indent})}` : template;
    }
    return `${indent}<div${listIdAttr} className=${jsxString(cls)}>
${serverItems()}
${indent}</div>`;
  }

  const idAttr = instanceVisibilityAttr +
    anchorAttr +
    toggleAttrs +
    inViewAttr + importedAttrs;

  if (node.type === "image" && node.image) {
    const width = Number.isFinite(node.image.width) && node.image.width > 0 ? node.image.width : 800;
    const height = Number.isFinite(node.image.height) && node.image.height > 0 ? node.image.height : 500;
    ctx.usesImage = true;
    const src = node.image.assetId
      ? assetMediaUrl(assetPath(ctx, node.image.assetId), node.image.assetSuffix)
      : node.image.src;
    let srcAttr = `src=${jsxString(src)}`;
    if (hasVars(src)) {
      ctx.usesInterpolate = true;
      const base = ctx.varsExpr ?? "vars";
      srcAttr = `src={interpolate(${JSON.stringify(src)}, ${base}) || "${EMPTY_GIF}"}`;
      if (ctx.inTemplate) {
        // 項目が届いてから一度だけ解決する。代替値に含まれる波括弧は、文字として残す。
        srcAttr += ` data-image-src-parts={JSON.stringify(${textParts(src, base)})}`;
      }
    }
    // Next.js 16 では priority が非推奨のため、preload を使い、取得の優先度も上げる
    const priority = (pad: string) =>
      node.image!.priority ? `\n${pad}preload\n${pad}fetchPriority="high"` : "";
    const crisp = crispSvgSize(ctx.doc, node);
    if (crisp) {
      // iOS Safari の SVG フィルターを鮮明に描くため、画像だけを2倍で描画して縮小する。
      // 枠の元の実寸・縦横比は CSS カスタムプロパティで保持する（空の SVG は不要）。
      // クリックで display:block に変更されても画像が消えないよう、グリッドには依存しない。
      const { width: w, height: h } = crisp;
      return `${indent}<span${idAttr}\n${indent}  className=${jsxString("crisp-svg " + cls)}\n${indent}  style={{ ["--crisp-svg-width"]: "${w}px", ["--crisp-svg-ratio"]: "${w} / ${h}" }}\n${indent}>\n${indent}  <Image\n${indent}    ${srcAttr}\n${indent}    alt=${jsxString(node.image.alt)}\n${indent}    width={${w * 2}}\n${indent}    height={${h * 2}}${priority(indent + "    ")}\n${indent}  />\n${indent}</span>`;
    }
    // 実際の大きさが分からない画像（読み込む前など）でも、next/image の width と height は必須
    return `${indent}<Image${idAttr}\n${indent}  ${srcAttr}\n${indent}  alt=${jsxString(node.image.alt)}\n${indent}  width={${width}}\n${indent}  height={${height}}\n${indent}  className=${jsxString(cls)}${priority(indent + "  ")}\n${indent}/>`;
  }

  if (node.type === "divider") {
    return `${indent}<hr${idAttr} className=${jsxString(cls)} />`;
  }

  // ブラウザで並べるリストのお手本では、HTML の中身を {名前} の置き換えの対象から外す（data-raw）
  const rawAttr = ctx.inTemplate ? " data-raw" : "";

  if (node.type === "icon" && node.icon) {
    const html = cssValue(ctx.doc, "rawHtml", node.icon.svg, ctx.assetNames);
    return `${indent}<span${idAttr}${rawAttr}\n${indent}  className=${jsxString(cls)}\n${indent}  aria-hidden="true"\n${indent}  dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)} }}\n${indent}/>`;
  }

  if (node.type === "field" && node.field) {
    const f = node.field;
    const base = ctx.varsExpr ?? "vars";
    /** 文字の式（{変数} は、配信するときに置き換える） */
    const textExpr = (v: string): string => {
      if (!hasVars(v)) return JSON.stringify(v);
      ctx.usesInterpolate = true;
      return `interpolate(${JSON.stringify(v)}, ${base})`;
    };
    /** 画面上で値が決まる {変数}（入力欄の値など）を含むなら、ブラウザで書き直すための属性を返す */
    const liveOf = (name: string, v: string | undefined): string => {
      if (ctx.inTemplate || !v || !livesHere(ctx) || !hasVars(v)) return "";
      const keep = keepTokens(v, ctx.isLive);
      if (!Object.keys(keep).length) return "";
      ctx.usesInterpolate = true;
      return ` ${name}={interpolate(${JSON.stringify(v)}, { ...${base}, ...${JSON.stringify({ ...keep, [KEEP_ESCAPES]: true })} })}`;
    };
    // お手本には元の区切りを残し、値・案内文・選択肢を、項目の値で一度だけ解決する。
    const partsOf = (name: string, v: string | undefined, force = false): string => {
      if (!ctx.inTemplate || v == null || (!force && !hasVars(v))) return "";
      ctx.usesInterpolate = true;
      return ` data-field-${name}-parts={JSON.stringify(${textParts(v, base, false, ctx.isLive)})}`;
    };
    const attr = (name: string, v: string | undefined): string => {
      if (!v) return "";
      return hasVars(v) ? ` ${name}={${textExpr(v)}}` + partsOf(name === "defaultValue" ? "value" : name, v) : ` ${name}=${jsxString(v)}`;
    };
    // ID 属性（ラジオではグループ名）が、フォームを送信するときの項目名（= {変数} の名前）を兼ねる
    const fieldName = fieldVarName(node);
    const nameAttr = fieldName ? ` name=${jsxString(fieldName)}` : "";
    const reqAttr = (f.required ? " required" : "") + (f.disabled ? " disabled" : "");
    const phAttr = attr("placeholder", f.placeholder) + liveOf("data-live-placeholder", f.placeholder);
    const defaultValueAttr = attr("defaultValue", f.defaultValue) + liveOf("data-live-value", f.defaultValue) +
      (!hasVars(f.defaultValue) && (
        (f.kind === "select" && f.defaultValue && (f.options ?? []).some((o) => hasVars(o.label) || hasVars(o.value))) ||
        (f.kind === "input" && RANGED_INPUTS.has(f.inputType ?? "text") && [f.min, f.max, f.step].some(hasVars))
      ) ? partsOf("value", f.defaultValue ?? "", true) : "");
    const lenAttr = f.maxLength && f.maxLength > 0 ? ` maxLength={${Math.round(f.maxLength)}}` : "";
    if (f.kind === "textarea") {
      const rowsAttr = f.rows && f.rows > 0 ? ` rows={${Math.round(f.rows)}}` : "";
      return `${indent}<textarea${idAttr} className=${jsxString(cls)}${nameAttr}${phAttr}${defaultValueAttr}${rowsAttr}${lenAttr}${reqAttr} />`;
    }
    if (f.kind === "select") {
      const opts = (f.options ?? [])
        .map((o) => `${indent}  <option${attr("value", o.value)}${liveOf("data-live-value", o.value)}${partsOf("value", o.value)}${liveOf("data-live", o.label)}${partsOf("text", o.label)}>{${textExpr(o.label)}}</option>`)
        .join("\n");
      return `${indent}<select${idAttr} className=${jsxString(cls)}${nameAttr}${defaultValueAttr}${reqAttr}>\n${opts}\n${indent}</select>`;
    }
    if (f.kind === "checkbox" || f.kind === "radio") {
      // ラジオは表示テキストを値にする（プレビューの {変数} とそろえる）。
      // チェックボックスは、送信するときに「true」になる（{ID} の値とそろえる）
      const valueAttr =
        f.kind === "radio"
          ? (attr("value", f.label ?? "") || ` value=""`) + liveOf("data-live-value", f.label)
          : ` value="true"`;
      const checkedAttr = f.checked ? " defaultChecked" : "";
      const liveLbl = liveOf("data-live", f.label) + partsOf("text", f.label);
      const lblBody = liveLbl
        ? `<span${liveLbl}>{${textExpr(f.label ?? "")}}</span>`
        : `{${textExpr(f.label ?? "")}}`;
      return `${indent}<label${idAttr} className=${jsxString(cls)}>\n${indent}  <input type="${f.kind}"${nameAttr}${valueAttr}${checkedAttr}${reqAttr} />\n${indent}  ${lblBody}\n${indent}</label>`;
    }
    if (f.kind === "submit") {
      const label = f.label ?? "送信";
      return `${indent}<button${idAttr} type="submit" className=${jsxString(cls)}${f.disabled ? " disabled" : ""}${liveOf("data-live", label)}${partsOf("text", label)}>\n${indent}  {${textExpr(label)}}\n${indent}</button>`;
    }
    if (f.kind === "file") {
      const acceptAttr = attr("accept", f.accept);
      return `${indent}<input${idAttr} type="file" className=${jsxString(cls)}${nameAttr}${acceptAttr}${f.multiple ? " multiple" : ""}${reqAttr} />`;
    }
    const type = f.inputType ?? "text";
    const ranged = RANGED_INPUTS.has(type);
    const rangeAttr = ranged ? attr("min", f.min) + attr("max", f.max) + attr("step", f.step) : "";
    const textLen = TEXT_INPUTS.has(type) ? lenAttr : "";
    // 色と範囲は空の値を持てないため、案内文は出さない
    const ph = type === "color" || type === "range" ? "" : phAttr;
    return `${indent}<input${idAttr} type=${jsxString(type)} className=${jsxString(cls)}${nameAttr}${ph}${defaultValueAttr}${rangeAttr}${textLen}${reqAttr} />`;
  }

  if (node.type === "media" && node.media) {
    const m = node.media;
    const src = m.assetId ? assetMediaUrl(assetPath(ctx, m.assetId), m.assetSuffix) : m.src;
    const safeMedia = (value: string): string => {
      const normalized = value.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
      return /^(?:javascript:|vbscript:|data:text\/html(?:[;,]|$))/.test(normalized) ? "#" : value;
    };
    const sources = (m.sources ?? []).map((source) => {
      const url = source.assetId ? assetMediaUrl(assetPath(ctx, source.assetId), source.assetSuffix) : source.src;
      if (!url.trim()) return "";
      return `${indent}  <source src=${jsxString(safeMedia(url))}${source.type != null ? ` type=${jsxString(source.type)}` : ""}${source.media != null ? ` media=${jsxString(source.media)}` : ""} />`;
    }).filter(Boolean);
    if (!src.trim() && !sources.length) return "";
    const mediaSrc = src.trim() ? `\n${indent}  src=${jsxString(safeMedia(src))}` : "";
    const extra = [
      m.loop ? " loop" : "",
      m.autoplay ? " autoPlay" : "",
      m.muted || m.autoplay ? " muted" : "",
      m.kind === "video" ? " playsInline" : "",
    ].join("");
    const tag = m.kind === "audio" ? "audio" : "video";
    const opening = `${indent}<${tag}${idAttr}\n${indent}  className=${jsxString(cls)}${mediaSrc}\n${indent}  controls${extra}`;
    return sources.length ? `${opening}>\n${sources.join("\n")}\n${indent}</${tag}>` : `${opening}\n${indent}/>`;
  }

  if (node.type === "embed" && node.embed) {
    const src = embedSrc(node.embed);
    if (!src) return "";
    const allow =
      node.embed.kind === "youtube"
        ? `\n${indent}    allow=${jsxString(YOUTUBE_ALLOW)}\n${indent}    allowFullScreen`
        : node.embed.kind === "url"
          ? `\n${indent}    allowFullScreen`
          : "";
    return `${indent}<div${idAttr} className=${jsxString(cls)}>\n${indent}  <iframe\n${indent}    src=${jsxString(src)}\n${indent}    loading="lazy"\n${indent}    referrerPolicy="strict-origin-when-cross-origin"${allow}\n${indent}    style={{ width: "100%", height: "100%", border: 0, display: "block" }}\n${indent}  />\n${indent}</div>`;
  }

  if (node.type === "code" && node.code) {
    const html = cssValue(ctx.doc, "rawHtml", node.code.html, ctx.assetNames);
    return `${indent}<div${idAttr}${rawAttr}\n${indent}  className=${jsxString(cls)}\n${indent}  dangerouslySetInnerHTML={{ __html: ${JSON.stringify(html)} }}\n${indent}/>`;
  }

  let tag = resolveTag(node, isTop);
  // フォームの中のフォームはブラウザが無視して食い違うため、外側のフォームの一部として <div> で出力する
  if (tag === "form" && ctx.inForm) tag = "div";
  // <p> の中にブロック要素（ボックス・見出しなど）があると、ブラウザが <p> を途中で閉じて、
  // サーバーの HTML と React の描画が食い違う（ハイドレーションエラー）。その場合は <div> で出力し、
  // data-p で <p> と同じ見た目（改行を保つ・余白なし）を当てる
  let pAttr = "";
  if (tag === "p" && hasBlockDescendant(ctx.doc, node)) {
    tag = "div";
    pAttr = ` data-p=""`;
  }
  const inner: string[] = [];
  let liveAttr = "";
  // フォームの中のボタンは送信ボタンにする（中の要素を描く前に知らせる）
  const prevInForm = ctx.inForm;
  if (tag === "form") ctx.inForm = true;
  if (node.text?.content) {
    if (hasVars(node.text.content)) {
      ctx.usesInterpolate = true;
      const base = ctx.varsExpr ?? "vars";
      if (ctx.inTemplate) {
        // 最初のテキストだけを埋める。子要素は壊さず、データの中の波括弧も解決し直さない。
        liveAttr = ` data-text-parts={JSON.stringify(${textParts(node.text.content, base)})}`;
      }
      inner.push(`${indent}  {interpolate(${JSON.stringify(node.text.content)}, ${base})}`);
      // 画面上で値が決まる {変数}（件数など）は、値が変わるたびにブラウザで書き直す
      //（リストの項目の中はお手本の複製で埋めるため、対象外）
      const keep = livesHere(ctx) ? keepTokens(node.text.content, ctx.isLive) : {};
      if (Object.keys(keep).length) {
        liveAttr = ` data-live={interpolate(${JSON.stringify(node.text.content)}, { ...${base}, ...${JSON.stringify({ ...keep, [KEEP_ESCAPES]: true })} })}`;
      }
    } else {
      inner.push(`${indent}  {${JSON.stringify(node.text.content)}}`);
    }
  }
  for (const childId of node.children) {
    inner.push(renderNode(ctx, childId, indent + "  ", false));
  }
  ctx.inForm = prevInForm;

  let attrs = `${idAttr} className=${jsxString(cls)}${liveAttr}${pAttr}`;
  if (tag === "button") {
    // 「クリックしたとき」のスクリプトがあるボタンは、フォームの中でも送信しない
    const submit = ctx.inForm && !node.scripts?.some((s) => s.trigger === "click");
    attrs += ` type="${submit ? "submit" : "button"}"`;
  }
  let openTag = tag;
  let closeTag = tag;
  if (tag === "form") {
    ctx.usesSearchForm = true;
    openTag = "SearchForm";
    closeTag = "SearchForm";
  }
  const target = node.link?.newTab ? ` target="_blank" rel="noopener noreferrer"` : "";
  if (
    node.link?.kind === "url" &&
    hasVars(node.link.url ?? "")
  ) {
    ctx.usesInterpolate = true;
    const base = ctx.varsExpr ?? "vars";
    const href = `{safeNavigationUrl(interpolateUrl(${JSON.stringify(node.link.url)}, ${base}))}`;
    if (ctx.inTemplate) {
      // URL の元の区切りと参照した値だけを残し、行の値で一度だけ解決する。
      attrs += ` data-href-parts={JSON.stringify(${textParts(node.link.url!, base, true)})}`;
    }
    if (!node.link.newTab) {
      // 行き先は値が入るまで分からない（{link} が外部の URL のこともある）ため、
      // 表示するときの値がサイト内のページなら Link に、それ以外なら a にする
      ctx.usesSmartLink = true;
      openTag = `SmartLink href=${href}`;
      closeTag = "SmartLink";
    } else {
      openTag = `a href=${href}${target}`;
      closeTag = "a";
    }
  } else if (node.link) {
    const rawHref =
      node.link.kind === "page" && node.link.pageId
        ? pageHref(ctx, node.link.pageId)
        : (node.link.url || "#");
    const href = safeNavigationUrl(rawHref);
    if (ctx.inTemplate) attrs += ` data-href-parts={JSON.stringify([${JSON.stringify(href)}])}`;
    // サイト内の Next.js のページ（/〜）は Link にして、ページの遷移を速くする。リダイレクト・中継・
    // HTMLページは Next.js のページではなく、先読みが別のドメインへ転送されて失敗するため、a にする
    if (!node.link.newTab && isNextPageUrl(ctx, href)) {
      ctx.usesLink = true;
      openTag = `Link href=${jsxString(href)}`;
      closeTag = "Link";
    } else {
      openTag = `a href=${jsxString(href)}${target}`;
      closeTag = "a";
    }
  }

  if (!inner.length) {
    return `${indent}<${openTag}${attrs} />`;
  }
  return `${indent}<${openTag}${attrs}>\n${inner.join("\n")}\n${indent}</${closeTag}>`;
}
