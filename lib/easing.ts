/**
 * イージング（animation-timing-function / transition-timing-function）の値の読み書き。
 * イージング編集画面のグラフと再生プレビューに使う
 */

export type Bezier = [number, number, number, number];

export type StepPosition = "jump-start" | "jump-end" | "jump-none" | "jump-both";

export type Easing =
  | { kind: "bezier"; b: Bezier }
  | { kind: "steps"; n: number; pos: StepPosition };

/** CSS のキーワードが表す曲線 */
const KEYWORDS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

const STEP_ALIASES: Record<string, StepPosition> = {
  start: "jump-start",
  end: "jump-end",
  "jump-start": "jump-start",
  "jump-end": "jump-end",
  "jump-none": "jump-none",
  "jump-both": "jump-both",
};

const num = (s: string): number | null => {
  const t = s.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
};

/** 値を読む。グラフで表せない値（linear() など）は null */
export function parseEasing(value: string | undefined): Easing | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return { kind: "bezier", b: [...KEYWORDS.ease] };
  if (KEYWORDS[v]) return { kind: "bezier", b: [...KEYWORDS[v]] };
  if (v === "step-start") return { kind: "steps", n: 1, pos: "jump-start" };
  if (v === "step-end") return { kind: "steps", n: 1, pos: "jump-end" };
  const bez = /^cubic-bezier\(([^)]*)\)$/.exec(v);
  if (bez) {
    const parts = bez[1].split(",").map(num);
    if (parts.length !== 4 || parts.some((p) => p === null)) return null;
    const b = parts as Bezier;
    // x は 0〜1 の範囲でなければ CSS として無効
    if (b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1) return null;
    return { kind: "bezier", b };
  }
  const steps = /^steps\(([^)]*)\)$/.exec(v);
  if (steps) {
    const [countRaw, posRaw] = steps[1].split(",");
    const n = num(countRaw ?? "");
    const pos = posRaw === undefined ? "jump-end" : STEP_ALIASES[posRaw.trim()];
    if (n === null || !Number.isInteger(n) || !pos) return null;
    if (n < (pos === "jump-none" ? 2 : 1)) return null;
    return { kind: "steps", n, pos };
  }
  return null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** CSS の値にする。キーワードやプリセットと同じ曲線なら、その書き方を使う */
export function easingValue(e: Easing): string {
  if (e.kind === "steps") {
    return e.pos === "jump-end" ? `steps(${e.n})` : `steps(${e.n}, ${e.pos})`;
  }
  const b = e.b.map(round) as Bezier;
  for (const [name, kb] of Object.entries(KEYWORDS)) {
    if (kb.every((v, i) => v === b[i])) return name;
  }
  const value = `cubic-bezier(${b.join(", ")})`;
  const preset = EASING_PRESETS.find((p) => {
    const pe = parseEasing(p.value);
    return pe?.kind === "bezier" && pe.b.every((v, i) => v === b[i]);
  });
  return preset?.value ?? value;
}

/** 編集画面で選べる曲線（右パネルのドロップダウンと同じ値を含む） */
export const EASING_PRESETS: { label: string; value: string; group: "basic" | "smooth" | "back" }[] = [
  { label: "linear", value: "linear", group: "basic" },
  { label: "ease", value: "ease", group: "basic" },
  { label: "ease-in", value: "ease-in", group: "basic" },
  { label: "ease-out", value: "ease-out", group: "basic" },
  { label: "ease-in-out", value: "ease-in-out", group: "basic" },
  { label: "ease-out-quart", value: "cubic-bezier(0.25, 1, 0.5, 1)", group: "smooth" },
  { label: "ease-out-expo", value: "cubic-bezier(0.16, 1, 0.3, 1)", group: "smooth" },
  { label: "ease-in-out-cubic", value: "cubic-bezier(0.65, 0, 0.35, 1)", group: "smooth" },
  { label: "ease-in-out-quart", value: "cubic-bezier(0.76, 0, 0.24, 1)", group: "smooth" },
  { label: "ease-out-back", value: "cubic-bezier(0.34, 1.56, 0.64, 1)", group: "back" },
  { label: "ease-in-back", value: "cubic-bezier(0.36, 0, 0.66, -0.56)", group: "back" },
  { label: "ease-in-out-back", value: "cubic-bezier(0.68, -0.6, 0.32, 1.6)", group: "back" },
];

/** 3次ベジェの1軸（始点0・終点1）の、パラメータ s での値 */
function axis(p1: number, p2: number, s: number): number {
  const r = 1 - s;
  return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s;
}

/** 進み具合 x（0〜1）での値。CSS と同じく、x から曲線のパラメータを求めて y を返す */
export function easeAt(e: Easing, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  if (e.kind === "steps") {
    const { n, pos } = e;
    // CSS Easing の steps() の定義どおりに、いまの段と段の数を決める
    let step = Math.floor(t * n);
    if (pos === "jump-start" || pos === "jump-both") step += 1;
    const jumps = pos === "jump-none" ? n - 1 : pos === "jump-both" ? n + 1 : n;
    return Math.min(step, jumps) / jumps;
  }
  const [x1, y1, x2, y2] = e.b;
  // 二分法で x(s) = t となる s を探す（x は単調増加なので必ず収束する）
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 40; i++) {
    const xs = axis(x1, x2, s);
    if (Math.abs(xs - t) < 1e-6) break;
    if (xs < t) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return axis(y1, y2, s);
}
