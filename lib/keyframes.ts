/**
 * カスタムキーフレーム（@keyframes の中身）の読み書き。
 * キーフレームの編集画面は、不透明度・移動・拡大・回転を項目として編集し、
 * それ以外の宣言は「そのほかのCSS」として文字のまま持つ
 */

export interface Keyframe {
  /** 画面の中で区別するための ID（CSS には出力しない） */
  id: string;
  /** 0〜100（%） */
  offset: number;
  opacity?: number;
  /** 移動（px） */
  x?: number;
  y?: number;
  /** 拡大率（1 = 等倍） */
  scale?: number;
  /** 回転（deg） */
  rotate?: number;
  /** 上の項目に無い宣言（"filter: blur(4px); color: red;" など） */
  extra: string;
}

/** 項目として編集できる変形（この順で transform に書く） */
const TRANSFORM_KEYS = ["x", "y", "rotate", "scale"] as const;
type TransformKey = (typeof TRANSFORM_KEYS)[number];

let seq = 0;
export const keyframeId = () => `kf${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyKeyframe(offset: number): Keyframe {
  return { id: keyframeId(), offset, extra: "" };
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;

function parseLength(v: string): number | null {
  const m = new RegExp(`^(${NUM})(px)?$`, "i").exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  // 単位の無い値は、0 だけが許される
  if (!Number.isFinite(n) || (!m[2] && n !== 0)) return null;
  return n;
}

function parseAngle(v: string): number | null {
  const m = new RegExp(`^(${NUM})(deg|turn|rad|grad)?$`, "i").exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (!unit) return n === 0 ? 0 : null;
  const degrees = unit === "turn" ? n * 360 : unit === "rad" ? (n * 180) / Math.PI : unit === "grad" ? n * 0.9 : n;
  return Number.isFinite(degrees) ? degrees : null;
}

function parseNumber(v: string): number | null {
  const m = new RegExp(`^(${NUM})(%)?$`).exec(v.trim());
  if (!m) return null;
  const n = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * transform の値を項目に分ける。項目に無い関数を含む場合や、順序が違う場合
 * （回転してから移動するなど、項目に分けると見た目が変わる）は null を返す
 */
function parseTransform(value: string): Partial<Record<TransformKey, number>> | null {
  const v = value.trim();
  if (v === "none") return { x: 0, y: 0, rotate: 0, scale: 1 };
  const out: Partial<Record<TransformKey, number>> = {};
  const re = /([a-zA-Z]+)\(([^()]*)\)/g;
  let rest = v;
  let rank = 0;
  const KINDS: Record<string, "translate" | "rotate" | "scale"> = {
    translate: "translate",
    translatex: "translate",
    translatey: "translate",
    rotate: "rotate",
    rotatez: "rotate",
    scale: "scale",
  };
  const rankOf = { translate: 0, rotate: 1, scale: 2 };
  for (const m of v.matchAll(re)) {
    rest = rest.replace(m[0], "");
    const fn = m[1].toLowerCase();
    const args = m[2].split(",").map((a) => a.trim());
    const kind = Object.hasOwn(KINDS, fn) ? KINDS[fn] : undefined;
    if (!kind || rankOf[kind] < rank) return null;
    rank = rankOf[kind];
    if (fn === "translatex" || fn === "translatey") {
      const n = args.length === 1 ? parseLength(args[0]) : null;
      if (n === null) return null;
      const key = fn === "translatex" ? "x" : "y";
      if (out[key] !== undefined) return null;
      out[key] = n;
    } else if (fn === "translate") {
      if (args.length > 2 || out.x !== undefined || out.y !== undefined) return null;
      const x = parseLength(args[0]);
      const y = args.length === 2 ? parseLength(args[1]) : 0;
      if (x === null || y === null) return null;
      out.x = x;
      out.y = y;
    } else if (kind === "rotate") {
      const n = args.length === 1 ? parseAngle(args[0]) : null;
      if (n === null || out.rotate !== undefined) return null;
      out.rotate = n;
    } else {
      // 縦と横で異なる拡大は、項目では表せない
      const nums = args.map(parseNumber);
      if (nums.length > 2 || nums.some((n) => n === null) || out.scale !== undefined) return null;
      if (nums.length === 2 && nums[0] !== nums[1]) return null;
      out.scale = nums[0]!;
    }
  }
  if (rest.trim() || !Object.keys(out).length) return null;
  return out;
}

function parseOffset(sel: string): number | null {
  const s = sel.trim().toLowerCase();
  if (s === "from") return 0;
  if (s === "to") return 100;
  const m = new RegExp(`^(${NUM})%$`).exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** 宣言を「;」で区切る（url(...) や文字列の中の「;」では区切らない） */
function splitDecls(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let escaped = false;
  let cur = "";
  for (const ch of body) {
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((d) => d.trim()).filter(Boolean);
}

/** コメントだけを取り除き、文字列の中の /* やエスケープした引用符はそのまま残す。 */
function stripComments(css: string): string | null {
  let out = "";
  let quote = "";
  let escaped = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return null;
      // コメントの両側をつないで、別の識別子や数値にしない。
      out += " ";
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return quote ? null : out;
}

/**
 * @keyframes の中身を読む。読めない書き方（入れ子やセレクターの誤りなど）なら null を返す。
 * 「0%, 50% { ... }」のようにまとめて書いたものは1つずつに分け、同じ位置のものは1つにまとめる
 */
export function parseKeyframes(css: string): Keyframe[] | null {
  const src = stripComments(css);
  if (src === null) return null;
  const byOffset = new Map<number, Keyframe>();
  const declarations = new Map<number, { prop: string; value: string }[]>();
  /** transform: none と書かれたキーフレーム（他で使っている変形だけを初期値にする） */
  const nones = new Set<Keyframe>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of src.matchAll(re)) {
    const offsets = m[1].split(",").map(parseOffset);
    if (!offsets.length || offsets.some((o) => o === null)) return null;
    for (const offset of offsets as number[]) {
      const items = declarations.get(offset) ?? [];
      for (const decl of splitDecls(m[2])) {
        const i = decl.indexOf(":");
        if (i <= 0) return null;
        const name = decl.slice(0, i).trim();
        // カスタムプロパティの名前は、大文字と小文字を区別する。
        const prop = name.startsWith("--") || name.includes("\\") ? name : name.toLowerCase();
        const value = decl.slice(i + 1).trim();
        items.push({ prop, value });
      }
      declarations.set(offset, items);
    }
  }
  // 規則として読めなかった文字が残っていれば、書き方の誤り
  if (src.replace(re, "").trim()) return null;
  for (const [offset, items] of declarations) {
    const kf = emptyKeyframe(offset);
    const extras: string[] = [];
    const counts = new Map<string, number>();
    for (const { prop } of items) counts.set(prop, (counts.get(prop) ?? 0) + 1);
    // エスケープした名前は、opacity や --customName と同じ名前を表すことがある。
    // CSS の識別子を不完全に解釈せず、この位置の宣言はすべて順序どおりに残す。
    const escapedName = items.some(({ prop }) => prop.includes("\\"));
    for (const { prop, value } of items) {
      // 同じ宣言の代わりの指定は、順序にも意味がある。項目と生の CSS に分けて並べ替えず、
      // 同じ位置の別のルールにあるものも含めて、「そのほかのCSS」にそのまま残す。
      const hasAlias = items.some((item) => item.prop.endsWith(`-${prop}`) && item.prop.startsWith("-"));
      if (counts.get(prop) === 1 && !counts.has("all") && !hasAlias && !escapedName) {
        if (prop === "opacity" && !/!important/i.test(value)) {
          const n = parseNumber(value);
          if (n !== null) {
            kf.opacity = n;
            continue;
          }
        }
        if (prop === "transform") {
          const t = parseTransform(value);
          if (t) {
            for (const key of TRANSFORM_KEYS) delete kf[key];
            Object.assign(kf, t);
            if (value.trim() === "none") nones.add(kf);
            else nones.delete(kf);
            continue;
          }
        }
      }
      extras.push(`${prop}: ${value};`);
    }
    kf.extra = extras.join(" ");
    byOffset.set(offset, kf);
  }
  const list = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
  const used = new Set(list.filter((kf) => !nones.has(kf)).flatMap((kf) => TRANSFORM_KEYS.filter((k) => kf[k] !== undefined)));
  if (!used.size) used.add("x");
  for (const kf of nones) for (const k of TRANSFORM_KEYS) if (!used.has(k)) delete kf[k];
  return list;
}

// 適用するときは、読み取った精度を保つ。丸めるのはエディタでの明示的な操作のときで、
// 直列化のときではない（近い位置どうしで、意図した瞬間的な変化を表していることがある）。
const fmt = (n: number) => String(n);

function selector(offset: number): string {
  if (offset === 0) return "from";
  if (offset === 100) return "to";
  return `${fmt(offset)}%`;
}

const hasTransform = (kf: Keyframe) => TRANSFORM_KEYS.some((k) => kf[k] !== undefined);

/**
 * CSS に書き出す。transform を持つキーフレームでは、どれかのキーフレームで使っている変形を
 * すべて同じ順序で書き、未設定のものは等倍や 0 で埋める（関数の並びをそろえると、なめらかにつながる）
 */
export function serializeKeyframes(list: Keyframe[]): string {
  const used = new Set<TransformKey>();
  for (const kf of list) for (const k of TRANSFORM_KEYS) if (kf[k] !== undefined) used.add(k);
  return [...list]
    .sort((a, b) => a.offset - b.offset)
    .map((kf) => {
      const decls: string[] = [];
      if (kf.opacity !== undefined) decls.push(`opacity: ${fmt(kf.opacity)};`);
      if (hasTransform(kf)) {
        const fns: string[] = [];
        const x = kf.x ?? 0;
        const y = kf.y ?? 0;
        if (used.has("x") && used.has("y")) fns.push(`translate(${fmt(x)}px, ${fmt(y)}px)`);
        else if (used.has("x")) fns.push(`translateX(${fmt(x)}px)`);
        else if (used.has("y")) fns.push(`translateY(${fmt(y)}px)`);
        if (used.has("rotate")) fns.push(`rotate(${fmt(kf.rotate ?? 0)}deg)`);
        if (used.has("scale")) fns.push(`scale(${fmt(kf.scale ?? 1)})`);
        decls.push(`transform: ${fns.join(" ")};`);
      }
      const extra = kf.extra.trim();
      if (extra) decls.push(/;\s*$/.test(extra) ? extra : `${extra};`);
      return `${selector(kf.offset)} { ${decls.join(" ")}${decls.length ? " " : ""}}`;
    })
    .join("\n");
}
