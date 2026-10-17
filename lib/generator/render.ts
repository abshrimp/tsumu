/**
 * 要素の木を JSX に書き出す
 */

import { safeNavigationUrl } from "../url-policy";
import type { SiteDoc } from "../types";
import { toggleShowDisplay } from "../style";
import { embedSrc, YOUTUBE_ALLOW } from "../embed";
import { fieldVarName, RANGED_INPUTS, TEXT_INPUTS } from "../fields";
import { hasVars, KEEP_ESCAPES } from "../vars";
import { type ListOp } from "../data";
import { resolveTag } from "../tags";
import { keepTokens } from "../script";
import {
  assetPath,
  crispWouldCover,
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

/* ---------- JSX生成 ---------- */

export interface JsxContext {
  doc: SiteDoc;
  classNames: Map<string, string>;
  /** コンポーネントID → 出力コンポーネント名（PascalCase） */
  componentNames: Map<string, string>;
  usesImage: boolean;
  usesLink: boolean;
  /** 表示するときの値で Link / a を選ぶリンク（{変数} 入りのURL）を使ったか */
  usesSmartLink?: boolean;
  /** リストの項目を Fragment で並べた（react から import する） */
  usesFragment?: boolean;
  usesSearchForm: boolean;
  usedComponents: Set<string>;
  /** スクリプトで表示される対象のID属性（data-toggle-show の出力先） */
  toggleTargets: Set<string>;
  /** スクリプトで絞り込む配列の名前 → 項目名 */
  listFilterFields: Map<string, Set<string>>;
  /** スクリプトの {変数} のうち、画面上で値を入れるもの（ページを配信するときは残す） */
  liveNames: Set<string>;
  /** 検索フォームの中を描いているか（中のボタンを送信ボタンにする） */
  inForm?: boolean;
  /** アセットID → 一意化した出力ファイル名 */
  assetNames: Map<string, string>;
  /** 変数解決に使うオブジェクト式（ページ = "vars"、リスト内 = "iv"） */
  varsExpr?: string;
  /** interpolate ランタイムを使ったか */
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
   * 展開（{ ...iv }）すると、項目の {名前} を残す働きが消える）
   */
  inTemplate?: boolean;
  /**
   * リストノードID → 生成コード内の項目スコープ変数名と並べる配列（ページ外では未設定）。
   * client = 画面上で値が決まる配列（ブラウザでお手本を複製して並べる）
   */
  listVars?: Map<string, { ivar: string; from: string; client: boolean }>;
  /** 配列の名前 → ページを開いたときのスクリプトで決まる絞り込み・並べ替え（ページ外では未設定） */
  listOps?: Map<string, ListOp[]>;
}

export function renderNode(
  ctx: JsxContext,
  id: string,
  indent: string,
  isTop: boolean
): string {
  // 壊れた文書（要素が自分の中に入っている）でも、描き続けて止まらなくならないようにする
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
    ctx.usedComponents.add(node.componentId!);
    return `${indent}<${name} />`;
  }

  const cls = ctx.classNames.get(id)!;

  // スクリプト: 実行側は data-scripts、表示される側は表示に戻すdisplay値を出力
  const toggleAttrs =
    scriptsAttr(ctx, node) +
    ((node.attrId && ctx.toggleTargets.has(node.attrId)) || showsSelf(node)
      ? ` data-toggle-show=${jsxString(toggleShowDisplay(node))}`
      : "");

  // 「画面に入ったとき」は data-inview を見張って .is-inview で再生する（リストにも付ける）
  const inViewAttr = node.motions?.some((m) => m.trigger === "in-view") ? " data-inview" : "";

  if (node.type === "list" && node.list) {
    const lv = ctx.listVars?.get(id);
    if (!lv) return "";
    const { ivar } = lv;
    const base = ctx.varsExpr ?? "vars";
    const filterFields = [...(ctx.listFilterFields.get(lv.from) ?? [])];
    const listIdAttr =
      (node.attrId ? ` id=${jsxString(node.attrId)}` : "") +
      toggleAttrs +
      inViewAttr +
      (filterFields.length || lv.client ? ` data-array=${jsxString(lv.from)}` : "");
    if (lv.client) {
      // ブラウザで並べる: お手本を {名前} を残したまま出力し、項目ごとに複製して置き換える
      const l = node.list;
      const listAttrs = [
        " data-client-list",
        l.limit && l.limit > 0 ? ` data-limit="${l.limit}"` : "",
      ].join("");
      const prevVars = ctx.varsExpr;
      const prevTemplate = ctx.inTemplate;
      ctx.varsExpr = ivar;
      ctx.inTemplate = true;
      const inner = node.children
        .map((cid) => renderNode(ctx, cid, indent + "      ", false))
        .join("\n");
      ctx.varsExpr = prevVars;
      ctx.inTemplate = prevTemplate;
      ctx.usesTemplate = true;
      return `${indent}<div${listIdAttr}${listAttrs} className="${cls}">
${indent}  <div data-tpl hidden style={{ display: "none" }}>
${indent}    {((${ivar}: Vars) => (
${indent}      <>
${inner}
${indent}      </>
${indent}    ))(templateVars(${base}))}
${indent}  </div>
${indent}</div>`;
    }
    const itemsExpr = listItemsExpr(node.list, base, lv.from, ctx.listOps?.get(lv.from) ?? []);
    const prevVars = ctx.varsExpr;
    const prevTemplate = ctx.inTemplate;
    ctx.varsExpr = ivar;
    ctx.inTemplate = false;
    const inner = node.children
      .map((cid) => renderNode(ctx, cid, indent + "        ", false))
      .join("\n");
    ctx.varsExpr = prevVars;
    ctx.inTemplate = prevTemplate;
    // スクリプトの絞り込みで使う項目だけを、各項目の data-item に持たせる
    const itemAttr = filterFields.length
      ? ` data-item={JSON.stringify({ ${filterFields
          .map((f) => `${JSON.stringify(f)}: ${fieldExpr("item", f)}`)
          .join(", ")} })}`
      : "";
    // 項目の中にスクリプトがあれば、項目ごとに包む（IDの指す要素を同じ項目の中から探すため）
    const wrap = !!itemAttr || node.children.some((cid) => hasScriptsInside(ctx.doc, cid));
    return `${indent}<div${listIdAttr} className="${cls}">
${indent}  {${itemsExpr}.map((item, i) => {
${indent}    const ${ivar} = { ...${base}, ...item };
${indent}    return (
${indent}      ${wrap ? `<div key={i} style={{ display: "contents" }} data-row${itemAttr}>` : ((ctx.usesFragment = true), "<Fragment key={i}>")}
${inner}
${indent}      ${wrap ? "</div>" : "</Fragment>"}
${indent}    );
${indent}  })}
${indent}</div>`;
  }

  const idAttr =
    (node.attrId ? ` id=${jsxString(node.attrId)}` : "") +
    toggleAttrs +
    inViewAttr;

  if (node.type === "image" && node.image) {
    const width = Number.isFinite(node.image.width) && node.image.width > 0 ? node.image.width : 800;
    const height = Number.isFinite(node.image.height) && node.image.height > 0 ? node.image.height : 500;
    ctx.usesImage = true;
    const src = node.image.assetId
      ? assetPath(ctx, node.image.assetId)
      : node.image.src;
    let srcAttr = `src=${jsxString(src)}`;
    if (hasVars(src)) {
      ctx.usesInterpolate = true;
      srcAttr = `src={interpolate(${JSON.stringify(src)}, ${ctx.varsExpr ?? "vars"}) || "${EMPTY_GIF}"}`;
    }
    const priority = node.image.priority ? "\n" + indent + "  priority" : "";
    const asset = node.image.assetId ? ctx.doc.assets[node.image.assetId] : null;
    if (
      asset?.svgFilter &&
      node.image.crispShadow !== false &&
      node.image.width &&
      node.image.height &&
      !crispWouldCover(ctx.doc, id)
    ) {
      // iOS SafariはSVGのfilterを低解像度で描くため、2倍で描いて0.5倍に縮める。
      // 元画像と同じ実寸・縦横比を持つ透明なsvgで箱の大きさを決め、レイアウトは変えない
      const w = width, h = height;
      return `${indent}<span${idAttr}\n${indent}  className="crisp-svg ${cls}"\n${indent}>\n${indent}  <svg aria-hidden="true" width={${w}} height={${h}} viewBox="0 0 ${w} ${h}" />\n${indent}  <Image\n${indent}    ${srcAttr}\n${indent}    alt=${jsxString(node.image.alt)}\n${indent}    width={${w * 2}}\n${indent}    height={${h * 2}}${priority ? "\n" + indent + "    priority" : ""}\n${indent}  />\n${indent}</span>`;
    }
    // 実寸が分からない画像（読み込み前など）でも next/image の width・height は必須
    return `${indent}<Image${idAttr}\n${indent}  ${srcAttr}\n${indent}  alt=${jsxString(node.image.alt)}\n${indent}  width={${width}}\n${indent}  height={${height}}\n${indent}  className="${cls}"${priority}\n${indent}/>`;
  }

  if (node.type === "divider") {
    return `${indent}<hr${idAttr} className="${cls}" />`;
  }

  // ブラウザで並べるリストのお手本では、HTMLの中身を {名前} の置き換えから外す（data-raw）
  const rawAttr = ctx.inTemplate ? " data-raw" : "";

  if (node.type === "icon" && node.icon) {
    return `${indent}<span${idAttr}${rawAttr}\n${indent}  className="${cls}"\n${indent}  aria-hidden="true"\n${indent}  dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.icon.svg)} }}\n${indent}/>`;
  }

  if (node.type === "field" && node.field) {
    const f = node.field;
    const base = ctx.varsExpr ?? "vars";
    /** 文字の式（{変数} は配信するときに置き換える） */
    const textExpr = (v: string): string => {
      if (!hasVars(v)) return JSON.stringify(v);
      ctx.usesInterpolate = true;
      return `interpolate(${JSON.stringify(v)}, ${base})`;
    };
    /** 画面上で値が決まる {変数}（入力欄の値など）を含むなら、ブラウザで書き直すための属性 */
    const liveOf = (name: string, v: string | undefined): string => {
      if (!v || !livesHere(ctx) || !hasVars(v)) return "";
      const keep = keepTokens(v, ctx.liveNames);
      if (!Object.keys(keep).length) return "";
      ctx.usesInterpolate = true;
      return ` ${name}={interpolate(${JSON.stringify(v)}, { ...${base}, ...${JSON.stringify({ ...keep, [KEEP_ESCAPES]: true })} })}`;
    };
    const attr = (name: string, v: string | undefined): string => {
      if (!v) return "";
      return hasVars(v) ? ` ${name}={${textExpr(v)}}` : ` ${name}=${jsxString(v)}`;
    };
    // ID属性（ラジオはグループ名）がフォーム送信時の項目名（= {変数} 名）を兼ねる
    const fieldName = fieldVarName(node);
    const nameAttr = fieldName ? ` name=${jsxString(fieldName)}` : "";
    const reqAttr = (f.required ? " required" : "") + (f.disabled ? " disabled" : "");
    const phAttr = attr("placeholder", f.placeholder) + liveOf("data-live-placeholder", f.placeholder);
    const defaultValueAttr = attr("defaultValue", f.defaultValue) + liveOf("data-live-value", f.defaultValue);
    const lenAttr = f.maxLength && f.maxLength > 0 ? ` maxLength={${Math.round(f.maxLength)}}` : "";
    if (f.kind === "textarea") {
      const rowsAttr = f.rows && f.rows > 0 ? ` rows={${Math.round(f.rows)}}` : "";
      return `${indent}<textarea${idAttr} className="${cls}"${nameAttr}${phAttr}${defaultValueAttr}${rowsAttr}${lenAttr}${reqAttr} />`;
    }
    if (f.kind === "select") {
      const opts = (f.options ?? [])
        .map((o) => `${indent}  <option${liveOf("data-live", o)}>{${textExpr(o)}}</option>`)
        .join("\n");
      return `${indent}<select${idAttr} className="${cls}"${nameAttr}${defaultValueAttr}${reqAttr}>\n${opts}\n${indent}</select>`;
    }
    if (f.kind === "checkbox" || f.kind === "radio") {
      // ラジオは表示テキストを値にする（プレビューの {変数} と揃える）
      // チェックボックスは送信するとき「true」になる（{ID} の値とそろえる）
      const valueAttr =
        f.kind === "radio"
          ? (attr("value", f.label ?? "") || ` value=""`) + liveOf("data-live-value", f.label)
          : ` value="true"`;
      const checkedAttr = f.checked ? " defaultChecked" : "";
      const liveLbl = liveOf("data-live", f.label);
      const lblBody = liveLbl
        ? `<span${liveLbl}>{${textExpr(f.label ?? "")}}</span>`
        : `{${textExpr(f.label ?? "")}}`;
      return `${indent}<label${idAttr} className="${cls}">\n${indent}  <input type="${f.kind}"${nameAttr}${valueAttr}${checkedAttr}${reqAttr} />\n${indent}  ${lblBody}\n${indent}</label>`;
    }
    if (f.kind === "submit") {
      const label = f.label ?? "送信";
      return `${indent}<button${idAttr} type="submit" className="${cls}"${liveOf("data-live", label)}>\n${indent}  {${textExpr(label)}}\n${indent}</button>`;
    }
    if (f.kind === "file") {
      const acceptAttr = attr("accept", f.accept);
      return `${indent}<input${idAttr} type="file" className="${cls}"${nameAttr}${acceptAttr}${f.multiple ? " multiple" : ""}${reqAttr} />`;
    }
    const type = f.inputType ?? "text";
    const ranged = RANGED_INPUTS.has(type);
    const rangeAttr = ranged ? attr("min", f.min) + attr("max", f.max) + attr("step", f.step) : "";
    const textLen = TEXT_INPUTS.has(type) ? lenAttr : "";
    // 色・範囲は空の値を持てないため、案内文は出さない
    const ph = type === "color" || type === "range" ? "" : phAttr;
    return `${indent}<input${idAttr} type=${jsxString(type)} className="${cls}"${nameAttr}${ph}${defaultValueAttr}${rangeAttr}${textLen}${reqAttr} />`;
  }

  if (node.type === "media" && node.media) {
    const m = node.media;
    const src = m.assetId ? assetPath(ctx, m.assetId) : m.src;
    if (!src.trim()) return "";
    const extra = [
      m.loop ? " loop" : "",
      m.autoplay ? " autoPlay" : "",
      m.muted || m.autoplay ? " muted" : "",
      m.kind === "video" ? " playsInline" : "",
    ].join("");
    return `${indent}<${m.kind === "audio" ? "audio" : "video"}${idAttr}\n${indent}  className="${cls}"\n${indent}  src=${jsxString(src)}\n${indent}  controls${extra}\n${indent}/>`;
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
    return `${indent}<div${idAttr} className="${cls}">\n${indent}  <iframe\n${indent}    src=${jsxString(src)}\n${indent}    loading="lazy"\n${indent}    referrerPolicy="strict-origin-when-cross-origin"${allow}\n${indent}    style={{ width: "100%", height: "100%", border: 0, display: "block" }}\n${indent}  />\n${indent}</div>`;
  }

  if (node.type === "code" && node.code) {
    return `${indent}<div${idAttr}${rawAttr}\n${indent}  className="${cls}"\n${indent}  dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.code.html)} }}\n${indent}/>`;
  }

  let tag = resolveTag(node, isTop);
  // フォームの中のフォームはブラウザが無視して食い違うため、外側のフォームの一部として <div> で出す
  if (tag === "form" && ctx.inForm) tag = "div";
  // <p> の中にブロック要素（ボックス・見出しなど）があると、ブラウザが <p> を途中で閉じて
  // サーバーの HTML と React の描画が食い違う（ハイドレーションエラー）。そのときは <div> で出し、
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
      inner.push(
        `${indent}  {interpolate(${JSON.stringify(node.text.content)}, ${base})}`
      );
      // 画面上で値が決まる {変数}（件数など）は、値が変わるたびにブラウザで書き直す
      //（リストの項目内はお手本の複製で埋めるので対象外）
      const keep = livesHere(ctx) ? keepTokens(node.text.content, ctx.liveNames) : {};
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

  let attrs = `${idAttr} className="${cls}"${liveAttr}${pAttr}`;
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
    hasVars(node.link.url ?? "") &&
    safeNavigationUrl(node.link.url ?? "") !== "#"
  ) {
    ctx.usesInterpolate = true;
    const href = `{safeNavigationUrl(interpolateUrl(${JSON.stringify(node.link.url)}, ${ctx.varsExpr ?? "vars"}))}`;
    if (!node.link.newTab) {
      // 行き先は値が入るまで分からない（{link} が外部URLのこともある）ため、
      // 表示するときの値でサイト内のページなら Link、それ以外は a にする
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
    // サイト内の Next.js のページ（/〜）は Link にしてページ遷移を速くする。リダイレクト・中継・
    // HTMLページは Next.js のページではなく、先読みが別ドメインへ転送されて失敗するため a にする
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
