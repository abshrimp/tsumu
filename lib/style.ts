import type {
  Breakpoint,
  BreakpointDef,
  CustomFont,
  DocNode,
  NodeStyles,
  StyleMap,
  StyleState,
} from "./types";
import { tr } from "./i18n";
import { EASING_PRESETS } from "./easing";

export interface BpInfo {
  label: string;
  /** ヘッダーの切替ボタンに出す短い名前 */
  short: string;
  /** 切り替えたときのキャンバス幅（パソコンは表示幅、ほかは区切りの幅 maxWidth ちょうど） */
  width: number;
  /** この幅以下の画面に効く（CSS のメディアクエリの区切り） */
  maxWidth: number | null;
  /** この表示で編集したときに反映される範囲（初心者向けの説明） */
  scope: string;
}

/** 既定のブレークポイント（サイト設定で未設定のとき）。名前は保存される値なので日本語のまま持ち、表示するときに訳す */
export const DEFAULT_BREAKPOINTS: BreakpointDef[] = [
  { id: "lg", label: "タブレット", maxWidth: 1024 },
  { id: "md", label: "スマホ横向き", maxWidth: 767 },
  { id: "sm", label: "スマホ", maxWidth: 478 },
];
export const DEFAULT_BASE_WIDTH = 1280;
/** 追加できるブレークポイントの数 */
export const MAX_BREAKPOINTS = 6;
const SHORT_LABELS: Record<string, string> = { タブレット: tr("タブレット"), スマホ横向き: tr("スマホ横"), スマホ: tr("スマホ") };

/**
 * 表示中のブレークポイントの並び（"base" が先頭、あとは幅の大きい順）と、その情報。
 * サイトの設定に合わせて applyBreakpoints が中身を書き換える
 */
export const BP_ORDER: Breakpoint[] = [];
export const BP_INFO: Record<Breakpoint, BpInfo> = {};

/** 設定値を、幅の大きい順・重ならない幅・重複の無いIDにそろえる */
export function normalizeBreakpoints(raw: unknown): BreakpointDef[] {
  let list: BreakpointDef[];
  if (Array.isArray(raw)) {
    list = raw
      .filter((b): b is BreakpointDef => !!b && typeof b === "object" && typeof b.id === "string")
      .map((b) => ({
        id: b.id,
        label: String(b.label || "").trim() || tr("画面幅"),
        maxWidth: Math.round(Number(b.maxWidth)),
      }));
  } else {
    list = DEFAULT_BREAKPOINTS.map((b) => ({ ...b }));
  }
  const seen = new Set<string>(["base"]);
  const out: BreakpointDef[] = [];
  for (const b of list
    .filter((b) => Number.isFinite(b.maxWidth))
    .map((b) => ({ ...b, maxWidth: Math.max(240, Math.min(2999, b.maxWidth)) }))
    .sort((a, b) => b.maxWidth - a.maxWidth)) {
    if (seen.has(b.id) || out.some((o) => o.maxWidth === b.maxWidth)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out.slice(0, MAX_BREAKPOINTS);
}

/** よく使われる端末の画面幅（CSS px。ヘッダーの「よくある端末の幅で確かめる」に並べる） */
export const DEVICE_WIDTHS: { width: number; label: string }[] = [
  { width: 390, label: tr("スマホ（標準）") },
  { width: 768, label: tr("タブレット縦（小）") },
  { width: 667, label: tr("スマホ横向き") },
  { width: 360, label: tr("スマホ（小）") },
  { width: 430, label: tr("スマホ（大）") },
  { width: 820, label: tr("タブレット縦") },
  { width: 1024, label: tr("タブレット横") },
  { width: 600, label: tr("小型タブレット") },
  { width: 1280, label: tr("ノートパソコン") },
  { width: 1440, label: tr("デスクトップ") },
  { width: 1920, label: tr("大きいデスクトップ") },
];

/** パソコン表示のキャンバス幅（いちばん大きいブレークポイントより広くする） */
export function normalizeBaseWidth(raw: unknown, list: BreakpointDef[]): number {
  const v = Math.round(Number(raw)) || DEFAULT_BASE_WIDTH;
  return Math.max((list[0]?.maxWidth ?? 0) + 1, Math.min(3000, v));
}

/** ブレークポイントの絵柄（幅から選ぶ） */
export function bpIconKind(bp: Breakpoint): "monitor" | "tablet" | "mobileL" | "mobile" {
  if (bp === "base") return "monitor";
  const w = BP_INFO[bp]?.maxWidth ?? 0;
  return w >= 900 ? "tablet" : w >= 600 ? "mobileL" : "mobile";
}

/**
 * サイトのブレークポイントを反映する（BP_ORDER / BP_INFO を書き換える）。
 * エディタはドキュメントが変わるたび、書き出しは生成の最初に呼ぶ
 */
export function applyBreakpoints(cfg: { breakpoints?: unknown; baseWidth?: unknown } | undefined) {
  const list = normalizeBreakpoints(cfg?.breakpoints);
  const base = normalizeBaseWidth(cfg?.baseWidth, list);
  BP_ORDER.splice(0, BP_ORDER.length, "base", ...list.map((b) => b.id));
  for (const k of Object.keys(BP_INFO)) delete BP_INFO[k];
  BP_INFO.base = {
    label: tr("パソコン"),
    short: "PC",
    width: base,
    maxWidth: null,
    scope: tr("すべての画面に反映されます"),
  };
  list.forEach((b, i) => {
    const smaller = list[i + 1];
    BP_INFO[b.id] = {
      label: tr(b.label),
      short: SHORT_LABELS[b.label] ?? tr(b.label),
      // 区切りの幅ちょうどで見せる（その画面用のスタイルが効くいちばん広い幅。崩れやすい幅を確かめられる）
      width: b.maxWidth,
      maxWidth: b.maxWidth,
      scope: smaller
        ? tr("画面幅{maxWidth}px以下（{p2}を含む）に反映されます", { maxWidth: b.maxWidth, p2: list.slice(i + 1).map((x) => tr(x.label)).join(tr("・")) })
        : tr("画面幅{maxWidth}px以下だけに反映されます", { maxWidth: b.maxWidth }),
    };
  });
}

// 読み込んだ時点では既定のブレークポイント
applyBreakpoints(undefined);

/** 画面幅から、その幅で編集するブレークポイント（その幅を含むいちばん小さいもの） */
export function breakpointForWidth(width: number): Breakpoint {
  for (let i = BP_ORDER.length - 1; i > 0; i--) {
    const bp = BP_ORDER[i];
    if (width <= (BP_INFO[bp].maxWidth ?? Infinity)) return bp;
  }
  return "base";
}

export const STATE_INFO: Record<StyleState, { label: string; pseudo: string }> = {
  default: { label: tr("既定"), pseudo: "" },
  hover: { label: tr("ホバー"), pseudo: ":hover" },
  active: { label: tr("押したとき"), pseudo: ":active" },
  focus: { label: tr("フォーカス"), pseudo: ":focus" },
};

export const STATE_ORDER: StyleState[] = ["default", "hover", "active", "focus"];

/** 指定ブレークポイントまでのカスケードチェーン（base → bp） */
export function bpChain(bp: Breakpoint): Breakpoint[] {
  return BP_ORDER.slice(0, BP_ORDER.indexOf(bp) + 1);
}

/**
 * キャンバス表示用にスタイルを解決する。
 * default をカスケードで合成し、state 指定時はその state を上に重ねる。
 */
export function resolveStyleMap(
  styles: NodeStyles | undefined,
  bp: Breakpoint,
  state: StyleState
): StyleMap {
  const out: StyleMap = {};
  const chain = bpChain(bp);
  // 後から効く値をキーの並びでも後ろに置く（キャンバスのインライン style は並び順に当てるため、
  // 大きい画面の padding-top → 小さい画面の padding → さらに小さい画面の padding-top が CSS と同じに効く）
  const put = (map: StyleMap | undefined) => {
    for (const [k, v] of Object.entries(map ?? {})) {
      delete out[k];
      out[k] = v;
    }
  };
  for (const b of chain) put(styles?.[b]?.default);
  if (state !== "default") {
    for (const b of chain) put(styles?.[b]?.[state]);
  }
  return out;
}

/** 実効値がカスケードのどの段から来ているか（大きいほど後。未設定は -1）。まとめ指定と個別指定の優先を決めるのに使う */
function cascadeLayer(
  styles: NodeStyles | undefined,
  bp: Breakpoint,
  state: StyleState,
  prop: string
): number {
  const chain = bpChain(bp);
  let layer = -1;
  chain.forEach((b, i) => {
    if (styles?.[b]?.default?.[prop] !== undefined) layer = i;
  });
  if (state !== "default") {
    chain.forEach((b, i) => {
      if (styles?.[b]?.[state]?.[prop] !== undefined) layer = chain.length + i;
    });
  }
  return layer;
}

export function resolveStyles(
  node: DocNode,
  bp: Breakpoint,
  state: StyleState
): StyleMap {
  return resolveStyleMap(node.styles, bp, state);
}

/** そのデバイスだけに当たる画面幅のメディアクエリ（例: (min-width: 479px) and (max-width: 767px)） */
export function bpRangeQuery(bp: Breakpoint): string {
  const i = BP_ORDER.indexOf(bp);
  const max = BP_INFO[bp].maxWidth;
  const smaller = BP_ORDER[i + 1];
  // 下の範囲は「max-width: Npx」まで。拡大縮小で画面幅が N.5px のような小数になっても
  // どちらかの範囲に入るよう、N+1 ではなく N をわずかに超えたところから始める
  const min = smaller ? BP_INFO[smaller].maxWidth! + 0.02 : null;
  return [
    min !== null ? `(min-width: ${min}px)` : "",
    max !== null ? `(max-width: ${max}px)` : "",
  ]
    .filter(Boolean)
    .join(" and ");
}

/** 指定デバイスで非表示になっているか */
export function isHiddenAt(node: DocNode, bp: Breakpoint): boolean {
  return !!node.hiddenOn?.includes(bp);
}

/**
 * デバイス別の表示を切り替えたあとの hiddenOn を返す（空なら undefined）。
 * andSmaller のときは、スタイル編集と同じく小さい画面にも同じ設定を広げる
 */
export function nextHiddenOn(
  node: DocNode,
  bp: Breakpoint,
  hide: boolean,
  andSmaller = false
): Breakpoint[] | undefined {
  const targets = andSmaller ? BP_ORDER.slice(BP_ORDER.indexOf(bp)) : [bp];
  const out = BP_ORDER.filter((b) =>
    targets.includes(b) ? hide : isHiddenAt(node, b)
  );
  return out.length ? out : undefined;
}

/** 表示切替ボタン・メニューの文言（表示中のデバイスに合わせる） */
export function hideToggleLabel(hiddenHere: boolean, bp: Breakpoint): string {
  if (bp === "base") return hiddenHere ? tr("表示する") : tr("非表示にする");
  const name = BP_INFO[bp].label;
  return hiddenHere ? tr("{name}で表示する", { name }) : tr("{name}で非表示にする", { name });
}

/**
 * 表示切替で「表示」に戻すときの display 値。
 * いずれかのブレークポイントの既定スタイルから none 以外を探す
 */
export function toggleShowDisplay(node: DocNode): string {
  for (const bp of BP_ORDER) {
    const d = node.styles[bp]?.default?.display;
    if (d && d !== "none") return d;
  }
  // none しか無い場合はレイアウト系プロパティから推測する
  for (const bp of BP_ORDER) {
    const m = node.styles[bp]?.default;
    if (!m) continue;
    if (m.gridTemplateColumns || m.gridTemplateRows) return "grid";
    if (m.flexDirection || m.alignItems || m.justifyContent || m.gap) {
      return "flex";
    }
  }
  return "block";
}

/**
 * テキスト選択（::selection）用の仮想プロパティを map から取り出す。
 * 取り出したプロパティは map から削除される
 */
export function extractSelectionStyles(map: StyleMap): StyleMap | null {
  const out: StyleMap = {};
  if (map.selectionBackgroundColor !== undefined) {
    out.backgroundColor = map.selectionBackgroundColor;
    delete map.selectionBackgroundColor;
  }
  if (map.selectionColor !== undefined) {
    out.color = map.selectionColor;
    delete map.selectionColor;
  }
  return Object.keys(out).length ? out : null;
}

/** プレースホルダーのセレクタ（要素自身と、中にある入力欄） */
export function placeholderSelector(sel: string): string {
  return `${sel}::placeholder, ${sel} ::placeholder`;
}

/** 入力欄の一部（疑似要素）に当てる仮想プロパティ → 実際のプロパティ */
const PART_PROPS: {
  selector: (sel: string) => string;
  props: Record<string, string>;
  /** 一緒に入れる宣言（設定したプロパティの名前 → 宣言） */
  extra?: Record<string, StyleMap>;
}[] = [
  { selector: placeholderSelector, props: { placeholderColor: "color" }, extra: { placeholderColor: { opacity: "1" } } },
  {
    selector: (sel) => `${sel}::file-selector-button, ${sel} ::file-selector-button`,
    props: { fileButtonBackground: "backgroundColor", fileButtonColor: "color", fileButtonRadius: "borderRadius" },
    // 背景色を付けたら、ブラウザ標準の枠を消して押しやすい余白にする
    extra: { fileButtonBackground: { border: "none", padding: "6px 12px", cursor: "pointer" } },
  },
  {
    // 訪問済みのリンクの文字色（リンクの中の要素にも効かせる）。:visited で変えられるのは色だけ
    selector: (sel) => `${sel}:visited, :visited ${sel}`,
    props: { visitedColor: "color" },
  },
];

/**
 * 入力欄の一部（::placeholder・::file-selector-button）に当てる仮想プロパティを map から取り出し、
 * 当てる先ごとにまとめて返す（取り出したプロパティは map から削除される）
 */
export function extractPartStyles(map: StyleMap): { selector: (sel: string) => string; map: StyleMap }[] {
  const out: { selector: (sel: string) => string; map: StyleMap }[] = [];
  for (const part of PART_PROPS) {
    const m: StyleMap = {};
    for (const [virt, real] of Object.entries(part.props)) {
      if (map[virt] === undefined) continue;
      Object.assign(m, part.extra?.[virt]);
      m[real] = map[virt];
      delete map[virt];
    }
    if (Object.keys(m).length) out.push({ selector: part.selector, map: m });
  }
  return out;
}

export interface PropInfo {
  /** カスケード解決後の実効値 */
  value: string | undefined;
  /** 現在の (bp, state) に直接設定されているか */
  setHere: boolean;
  /**
   * 変更済みとして色を付けるか（setHere で、かつ比べる相手と値が違う）。
   * パソコンの既定 = 既定値と、他の画面幅 = 1つ大きい画面幅の値と、ホバー等 = 通常時の値と比べる
   */
  changed: boolean;
  /**
   * 比べる相手の値（ホバー等 = 通常時、他の画面幅 = 1つ大きい画面幅で効いている値）。
   * パソコンの既定では undefined
   */
  baseline: string | undefined;
  /** どこかで（継承含め）設定されているか */
  set: boolean;
  /** 実効値がカスケードのどの段から来ているか（大きいほど後。未設定は -1） */
  layer: number;
  /**
   * ここで設定しなかったときに効く値（上位の設定）。比べる相手の値・要素の既定値・
   * 親で効いている値（受け継ぐプロパティ）・CSS の初期値の順に決める（分からなければ undefined）。
   * 欄の表示の状態（自動 / カスタムなど）が上位と違うかを比べるのに使う
   */
  reference: string | undefined;
}

/** スタイルパネル用：1プロパティの実効値と設定状態を返す */
export function getProp(
  node: DocNode,
  bp: Breakpoint,
  state: StyleState,
  prop: string,
  /** 親要素で効いている値（親から受け継ぐプロパティの比べる相手。パソコンの既定で使う） */
  parentValue?: (prop: string) => string | undefined
): PropInfo {
  const resolved = resolveStyles(node, bp, state);
  const here = node.styles[bp]?.[state]?.[prop];
  return {
    value: resolved[prop],
    setHere: here !== undefined,
    changed: here !== undefined && isChangedValue(node, bp, state, prop, here, parentValue),
    baseline: baselineValue(node, bp, state, prop),
    set: resolved[prop] !== undefined,
    layer: cascadeLayer(node.styles, bp, state, prop),
    reference: referenceValue(node, bp, state, prop, parentValue),
  };
}

/** ここで設定しなかったときに効く値（PropInfo.reference） */
function referenceValue(
  node: DocNode,
  bp: Breakpoint,
  state: StyleState,
  prop: string,
  parentValue?: (prop: string) => string | undefined
): string | undefined {
  const baseline = baselineValue(node, bp, state, prop);
  if (baseline !== undefined) return baseline;
  const preset = presetDefault(node, prop);
  if (preset !== undefined) return preset;
  if (INHERITED_PROPS.has(prop)) {
    const inherited = parentValue?.(prop);
    if (inherited !== undefined) return inherited;
  }
  return initialValueOf(prop);
}

/** 2つの値が同じか（"0px" と "0"、空白・大文字の違いは同じとみなす。両方未設定も同じ） */
export function sameValue(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return normValue(a) === normValue(b);
}

/**
 * 欄を空にしたときに書き込む値。パソコン幅以外の通常時は、消すと大きい画面の値が出てくるため、
 * 大きい画面で初期値以外が効いているときだけ CSS の初期値で上書きする（null = 設定を消す）。
 * ホバー等は消せば通常時の値に戻るので、常に消す
 */
export function clearedValue(
  node: DocNode,
  bp: Breakpoint,
  state: StyleState,
  prop: string
): string | null {
  if (bp === "base" || state !== "default") return null;
  const baseline = baselineValue(node, bp, state, prop);
  if (isInitialValue(prop, baseline)) return null;
  return initialValueOf(prop) ?? null;
}

/** 比べるための正規化（"0px" と "0"、空白・大文字の違いなど） */
function normValue(v: string): string {
  const t = v.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^-?0*\.?0+(px|em|rem|%|deg|vw|vh|s|ms)?$/.test(t)) return "0";
  return t;
}

/** CSS の初期値（何も設定しないときの値）。複数あるものはどれでも既定とみなす */
const INITIAL_VALUES: Record<string, string[]> = {
  padding: ["0"], paddingTop: ["0"], paddingRight: ["0"], paddingBottom: ["0"], paddingLeft: ["0"],
  margin: ["0"], marginTop: ["0"], marginRight: ["0"], marginBottom: ["0"], marginLeft: ["0"],
  borderRadius: ["0"], borderTopLeftRadius: ["0"], borderTopRightRadius: ["0"],
  borderBottomRightRadius: ["0"], borderBottomLeftRadius: ["0"],
  opacity: ["1", "100%"],
  fontWeight: ["400", "normal"],
  fontStyle: ["normal"],
  textTransform: ["none"],
  textDecoration: ["none"],
  textAlign: ["start", "left"],
  letterSpacing: ["normal", "0"],
  lineHeight: ["normal"],
  whiteSpace: ["normal", "pre-wrap"],
  position: ["static"],
  zIndex: ["auto"],
  // 「カスタム」「追従」を選んだときに入る 0 も既定とみなす（位置の切り替え自体は position で分かる）
  top: ["auto", "0"], right: ["auto", "0"], bottom: ["auto", "0"], left: ["auto", "0"],
  width: ["auto"], height: ["auto"],
  minWidth: ["auto", "0"], minHeight: ["auto", "0"],
  flexBasis: ["auto"],
  gridTemplateColumns: ["none"], gridTemplateRows: ["none"],
  maxWidth: ["none"], maxHeight: ["none"],
  aspectRatio: ["auto"],
  gap: ["0", "normal"], rowGap: ["0", "normal"], columnGap: ["0", "normal"],
  flexDirection: ["row"],
  flexWrap: ["nowrap"],
  flexGrow: ["0"], flexShrink: ["1"],
  alignItems: ["normal", "stretch"],
  justifyContent: ["normal", "flex-start", "start"],
  alignSelf: ["auto"],
  overflow: ["visible"],
  backgroundColor: ["transparent", "rgba(0, 0, 0, 0)", "#0000", "#00000000"],
  backgroundImage: ["none"],
  border: ["none", "0"],
  borderStyle: ["none"],
  borderWidth: ["0"],
  boxShadow: ["none"],
  textShadow: ["none"],
  transform: ["none"],
  rotate: ["0", "none"],
  filter: ["none"],
  backdropFilter: ["none"],
  mixBlendMode: ["normal"],
  cursor: ["auto"],
  objectFit: ["fill"],
  transition: ["none", "all 0s ease 0s"],
};

/** 親から受け継ぐプロパティ（パソコンの既定では、親で効いている値と比べて変更の色を決める） */
export const INHERITED_PROPS = new Set([
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textAlign",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "cursor",
]);

/** CSS の初期値（消したときに戻る値）。表に無ければ undefined */
export function initialValueOf(prop: string): string | undefined {
  return INITIAL_VALUES[prop]?.[0];
}

/** 値が未設定か CSS の初期値と同じか（隠れた設定に値が入っているかの判定に使う） */
export function isInitialValue(prop: string, value: string | undefined): boolean {
  if (value === undefined) return true;
  const initial = INITIAL_VALUES[prop];
  return !!initial && initial.some((x) => normValue(x) === normValue(value));
}

/** 要素の種類ごとの既定値（追加したときの値。ボックスは最初から縦並び） */
function presetDefault(node: DocNode, prop: string): string | undefined {
  if (node.type === "box" && !node.text) {
    return ({ display: "flex", flexDirection: "column", gap: "0px" } as Record<string, string>)[prop];
  }
  return undefined;
}

/** 変更済みかを比べる相手の値（パソコンの既定なら undefined） */
function baselineValue(
  node: DocNode,
  bp: Breakpoint,
  state: StyleState,
  prop: string
): string | undefined {
  // ホバー等は、同じ画面幅の通常時の値と比べる
  if (state !== "default") return resolveStyles(node, bp, "default")[prop];
  if (bp === "base") return undefined;
  // 画面幅別は、1つ大きい画面幅で効いている値と比べる（パソコンと同じなら色を付けない）
  const larger = BP_ORDER[BP_ORDER.indexOf(bp) - 1] ?? "base";
  return resolveStyles(node, larger, "default")[prop];
}

/** 直接設定した値が、比べる相手（既定値・大きい画面幅の値・通常時の値）と違うか */
export function isChangedValue(
  node: DocNode,
  bp: Breakpoint,
  state: StyleState,
  prop: string,
  here: string,
  parentValue?: (prop: string) => string | undefined
): boolean {
  const baseline = baselineValue(node, bp, state, prop);
  const v = normValue(here);
  if (baseline !== undefined) return normValue(baseline) !== v;
  const preset = presetDefault(node, prop);
  if (preset !== undefined) return normValue(preset) !== v;
  // 親から受け継ぐプロパティは、親で効いている値と比べる（初期値でも親と違えば変更）
  if (INHERITED_PROPS.has(prop)) {
    const inherited = parentValue?.(prop);
    if (inherited !== undefined) return normValue(inherited) !== v;
  }
  const initial = INITIAL_VALUES[prop];
  return !initial || !initial.some((d) => normValue(d) === v);
}

/** camelCase → kebab-case */
export function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

/** "16px" → { num: 16, unit: "px" }。数値でなければ null */
export function parseNumeric(
  value: string | undefined
): { num: number; unit: string } | null {
  if (!value) return null;
  const m = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(value.trim());
  if (!m) return null;
  return { num: parseFloat(m[1]), unit: m[2] || "" };
}

/** 括弧の中を無視してトップレベルのカンマで分割（box-shadow等） */
export function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** transform の分解（位置・エフェクトパネル用）。移動は単位付きの文字（"12px" / "50%"） */
export interface TransformParts {
  x: string;
  y: string;
  /** deg */
  rotate: number;
  scaleX: number;
  scaleY: number;
  /** deg */
  skewX: number;
  /** deg */
  skewY: number;
  /** 読み取れなかった関数（matrix・3D など）。書き直してもそのまま残す */
  rest: string;
}

export const TRANSFORM_DEFAULTS: TransformParts = {
  x: "0px",
  y: "0px",
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  rest: "",
};

/** 角度を deg にする（rad / turn / grad も読む） */
function toDeg(v: string): number | null {
  const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(deg|rad|turn|grad)?$/i.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "deg").toLowerCase();
  const deg = unit === "rad" ? (n * 180) / Math.PI : unit === "turn" ? n * 360 : unit === "grad" ? n * 0.9 : n;
  return Math.round(deg * 100) / 100;
}

/** 長さ（px / % / em など。単位の無い 0 は 0px） */
function toLen(v: string): string | null {
  const t = v.trim();
  if (/^-?\d*\.?\d+$/.test(t)) return parseFloat(t) === 0 ? "0px" : null;
  return /^-?\d*\.?\d+(px|%|em|rem|vw|vh)$/i.test(t) ? t : null;
}

const isZeroLen = (v: string) => parseFloat(v) === 0;

export function parseTransform(value: string | undefined): TransformParts {
  const out: TransformParts = { ...TRANSFORM_DEFAULTS };
  if (!value || value.trim() === "none") return out;
  const rest: string[] = [];
  for (const m of value.matchAll(/([a-zA-Z0-9]+)\(([^()]*)\)/g)) {
    const [whole, fn, raw] = m;
    const args = raw.split(",").map((a) => a.trim()).filter(Boolean);
    let ok = true;
    switch (fn) {
      case "translate": {
        const x = toLen(args[0] ?? "");
        const y = args[1] !== undefined ? toLen(args[1]) : "0px";
        if (x && y) {
          out.x = x;
          out.y = y;
        } else ok = false;
        break;
      }
      case "translateX":
      case "translateY": {
        const v = toLen(args[0] ?? "");
        if (v) out[fn === "translateX" ? "x" : "y"] = v;
        else ok = false;
        break;
      }
      case "rotate":
      case "rotateZ": {
        const d = toDeg(args[0] ?? "");
        if (d !== null) out.rotate = d;
        else ok = false;
        break;
      }
      case "scale": {
        const x = parseFloat(args[0] ?? "");
        const y = args[1] !== undefined ? parseFloat(args[1]) : x;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          out.scaleX = x;
          out.scaleY = y;
        } else ok = false;
        break;
      }
      case "scaleX":
      case "scaleY": {
        const v = parseFloat(args[0] ?? "");
        if (Number.isFinite(v)) out[fn] = v;
        else ok = false;
        break;
      }
      case "skew": {
        const x = toDeg(args[0] ?? "");
        const y = args[1] !== undefined ? toDeg(args[1]) : 0;
        if (x !== null && y !== null) {
          out.skewX = x;
          out.skewY = y;
        } else ok = false;
        break;
      }
      case "skewX":
      case "skewY": {
        const d = toDeg(args[0] ?? "");
        if (d !== null) out[fn] = d;
        else ok = false;
        break;
      }
      default:
        ok = false;
    }
    if (!ok) rest.push(whole);
  }
  out.rest = rest.join(" ");
  return out;
}

/** 分解した値を transform の値に戻す（すべて既定値なら null）。順序は 移動 → 回転 → 拡大 → 傾き */
export function serializeTransform(p: TransformParts): string | null {
  const parts: string[] = [];
  if (!isZeroLen(p.x) || !isZeroLen(p.y)) parts.push(`translate(${p.x}, ${p.y})`);
  if (p.rotate !== 0) parts.push(`rotate(${p.rotate}deg)`);
  if (p.scaleX !== 1 || p.scaleY !== 1) {
    parts.push(p.scaleX === p.scaleY ? `scale(${p.scaleX})` : `scale(${p.scaleX}, ${p.scaleY})`);
  }
  if (p.skewX !== 0 || p.skewY !== 0) {
    parts.push(p.skewY === 0 ? `skewX(${p.skewX}deg)` : p.skewX === 0 ? `skewY(${p.skewY}deg)` : `skew(${p.skewX}deg, ${p.skewY}deg)`);
  }
  if (p.rest.trim()) parts.push(p.rest.trim());
  return parts.length ? parts.join(" ") : null;
}

/** filter プロパティの分解（エフェクトパネル用）。値は既定値なら出力しない */
export interface FilterParts {
  /** px */
  blur: number;
  /** %（既定 100） */
  brightness: number;
  /** %（既定 100） */
  contrast: number;
  /** %（既定 100） */
  saturate: number;
  /** %（既定 0） */
  grayscale: number;
  /** %（既定 0） */
  sepia: number;
  /** deg（既定 0） */
  hueRotate: number;
}

export const FILTER_DEFAULTS: FilterParts = {
  blur: 0,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
};

export function parseFilter(value: string | undefined): FilterParts {
  const out = { ...FILTER_DEFAULTS };
  if (!value) return out;
  const num = (re: RegExp): number | undefined => {
    const m = re.exec(value);
    return m ? parseFloat(m[1]) : undefined;
  };
  out.blur = num(/blur\((-?\d*\.?\d+)px\)/) ?? out.blur;
  out.brightness = num(/brightness\((-?\d*\.?\d+)%\)/) ?? out.brightness;
  out.contrast = num(/contrast\((-?\d*\.?\d+)%\)/) ?? out.contrast;
  out.saturate = num(/saturate\((-?\d*\.?\d+)%\)/) ?? out.saturate;
  out.grayscale = num(/grayscale\((-?\d*\.?\d+)%\)/) ?? out.grayscale;
  out.sepia = num(/sepia\((-?\d*\.?\d+)%\)/) ?? out.sepia;
  out.hueRotate = num(/hue-rotate\((-?\d*\.?\d+)deg\)/) ?? out.hueRotate;
  return out;
}

export function serializeFilter(p: FilterParts): string | null {
  const parts: string[] = [];
  if (p.blur > 0) parts.push(`blur(${p.blur}px)`);
  if (p.brightness !== 100) parts.push(`brightness(${p.brightness}%)`);
  if (p.contrast !== 100) parts.push(`contrast(${p.contrast}%)`);
  if (p.saturate !== 100) parts.push(`saturate(${p.saturate}%)`);
  if (p.grayscale > 0) parts.push(`grayscale(${p.grayscale}%)`);
  if (p.sepia > 0) parts.push(`sepia(${p.sepia}%)`);
  if (p.hueRotate !== 0) parts.push(`hue-rotate(${p.hueRotate}deg)`);
  return parts.length ? parts.join(" ") : null;
}

/** エディタ内蔵フォント。google が真なら next/font 経由で出力 */
export const FONTS: {
  label: string;
  value: string;
  google?: { importName: string; cssVar: string; weights?: string[] };
}[] = [
  { label: tr("システム"), value: "system-ui" },
  {
    label: "Inter",
    value: "Inter",
    google: { importName: "Inter", cssVar: "--font-inter" },
  },
  {
    label: "Noto Sans JP",
    value: "Noto Sans JP",
    google: { importName: "Noto_Sans_JP", cssVar: "--font-noto-sans-jp" },
  },
  {
    label: "Noto Serif JP",
    value: "Noto Serif JP",
    google: { importName: "Noto_Serif_JP", cssVar: "--font-noto-serif-jp" },
  },
  {
    label: "M PLUS Rounded 1c",
    value: "M PLUS Rounded 1c",
    google: {
      importName: "M_PLUS_Rounded_1c",
      cssVar: "--font-m-plus-rounded-1c",
      weights: ["400", "500", "700"],
    },
  },
  {
    label: "Zen Maru Gothic",
    value: "Zen Maru Gothic",
    google: {
      importName: "Zen_Maru_Gothic",
      cssVar: "--font-zen-maru-gothic",
      weights: ["400", "500", "700"],
    },
  },
];

export interface FontOption {
  label: string;
  value: string;
  google?: { importName: string; cssVar: string; weights?: string[] };
}

/** ファミリー名から next/font 用メタデータを導出 */
export function googleFontMeta(
  font: CustomFont
): NonNullable<FontOption["google"]> {
  return {
    importName: font.family.replace(/\s+/g, "_"),
    cssVar: `--font-${font.family.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`,
    // 可変フォントは next/font で weight 指定不要
    weights: font.weights === "variable" ? undefined : font.weights,
  };
}

/** 内蔵フォント + docに追加されたカスタムGoogle Fonts */
export function allFonts(customFonts: CustomFont[] | undefined): FontOption[] {
  const custom = (customFonts ?? [])
    .filter((f) => !FONTS.some((b) => b.value === f.family))
    .map((font) => ({
      label: font.family,
      value: font.family,
      google: googleFontMeta(font),
    }));
  return [...FONTS, ...custom];
}

/** css2 URL のfamilyトークン（プレビュー読み込み用） */
export function css2FamilyToken(font: CustomFont): string {
  const name = encodeURIComponent(font.family).replace(/%20/g, "+");
  if (font.weights === "variable") return `family=${name}:wght@100..900`;
  if (font.weights.length === 1 && font.weights[0] === "400") {
    return `family=${name}`;
  }
  return `family=${name}:wght@${font.weights.join(";")}`;
}

/** モーションのイージングのプリセット（右パネルのドロップダウン。編集画面と同じ一覧） */
export const EASINGS: { label: string; value: string }[] = EASING_PRESETS.map(({ label, value }) => ({ label, value }));
