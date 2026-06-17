/**
 * カスタムキーフレーム（@keyframes の中身）の読み書き。
 * キーフレーム編集画面は、不透明度・移動・拡大・回転を項目として編集し、
 * それ以外の宣言は「そのほかのCSS」として文字のまま持つ
 */

export interface Keyframe {
  /** 画面の中で区別するためのID（CSSには出さない） */
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
  /** 上の項目にない宣言（"filter: blur(4px); color: red;" など） */
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
  // 単位なしは 0 だけ許される
  if (!m[2] && n !== 0) return null;
  return n;
}

function parseAngle(v: string): number | null {
  const m = new RegExp(`^(${NUM})(deg|turn|rad|grad)?$`, "i").exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (!unit) return n === 0 ? 0 : null;
  if (unit === "turn") return n * 360;
  if (unit === "rad") return (n * 180) / Math.PI;
  if (unit === "grad") return n * 0.9;
  return n;
}

function parseNumber(v: string): number | null {
  const m = new RegExp(`^(${NUM})(%)?$`).exec(v.trim());
  if (!m) return null;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
}

/**
 * transform の値を項目に分ける。項目にない関数を含む・順番が違う
 * （回転してから移動するなど、項目に分けると見た目が変わる）ときは null
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
    const kind = KINDS[fn];
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
      // 縦横で違う拡大は項目で表せない
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
  let cur = "";
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = "";
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

/**
 * @keyframes の中身を読む。読めない書き方（入れ子・セレクタの誤りなど）なら null。
 * 「0%, 50% { ... }」のようにまとめて書いたものは1つずつに分け、同じ位置は1つにまとめる
 */
export function parseKeyframes(css: string): Keyframe[] | null {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const byOffset = new Map<number, Keyframe>();
  /** transform: none と書かれたキーフレーム（ほかで使っている変形だけを初期値にする） */
  const nones = new Set<Keyframe>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of src.matchAll(re)) {
    const offsets = m[1].split(",").map(parseOffset);
    if (!offsets.length || offsets.some((o) => o === null)) return null;
    for (const offset of offsets as number[]) {
      const kf = byOffset.get(offset) ?? emptyKeyframe(offset);
      const extras = kf.extra ? [kf.extra] : [];
      for (const decl of splitDecls(m[2])) {
        const i = decl.indexOf(":");
        if (i <= 0) return null;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();
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
        extras.push(`${prop}: ${value};`);
      }
      kf.extra = extras.join(" ");
      byOffset.set(offset, kf);
    }
  }
  // 規則として読めなかった文字が残っていれば、書き方の誤り
  if (src.replace(re, "").trim()) return null;
  const list = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
  const used = new Set(list.filter((kf) => !nones.has(kf)).flatMap((kf) => TRANSFORM_KEYS.filter((k) => kf[k] !== undefined)));
  if (!used.size) used.add("x");
  for (const kf of nones) for (const k of TRANSFORM_KEYS) if (!used.has(k)) delete kf[k];
  return list;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function selector(offset: number): string {
  if (offset === 0) return "from";
  if (offset === 100) return "to";
  return `${fmt(offset)}%`;
}

const hasTransform = (kf: Keyframe) => TRANSFORM_KEYS.some((k) => kf[k] !== undefined);

/**
 * CSS に書き出す。transform を持つキーフレームは、どれかのキーフレームで使っている変形を
 * すべて同じ順で書き、未設定のものは等倍・0 で埋める（関数の並びをそろえると、なめらかにつながる）
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
