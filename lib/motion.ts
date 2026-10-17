import type { Motion } from "./types";
import { tr } from "./i18n";

export const TRIGGERS: { value: Motion["trigger"]; label: string }[] = [
  { value: "state", label: tr("状態が変わったとき") },
  { value: "hover", label: tr("ホバーしたときに再生") },
  { value: "active", label: tr("押したときに再生") },
  { value: "load", label: tr("ページを開いたときに再生") },
  { value: "in-view", label: tr("画面に入ったとき") },
];

export function triggerLabel(t: Motion["trigger"]): string {
  return TRIGGERS.find((x) => x.value === t)?.label ?? t;
}

export const TRANSITION_PROPS: { value: string; label: string }[] = [
  { value: "all", label: tr("すべて（all）") },
  { value: "opacity", label: tr("不透明度") },
  { value: "transform", label: tr("変形") },
  { value: "background-color", label: tr("背景色") },
  { value: "color", label: tr("文字色") },
  { value: "border-color", label: tr("線の色") },
  { value: "box-shadow", label: tr("影") },
];

/** ビルトインのキーフレーム。CSSは @keyframes anim-<key> { ... } として出力する */
export const KEYFRAMES: { key: string; label: string; css: string }[] = [
  { key: "fade-in", label: tr("フェードイン"), css: "from { opacity: 0; }" },
  { key: "fade-out", label: tr("フェードアウト"), css: "to { opacity: 0; }" },
  {
    key: "fade-up",
    label: tr("下からフェード"),
    css: "from { opacity: 0; transform: translateY(24px); }",
  },
  {
    key: "fade-down",
    label: tr("上からフェード"),
    css: "from { opacity: 0; transform: translateY(-24px); }",
  },
  {
    key: "slide-left",
    label: tr("左からスライド"),
    css: "from { transform: translateX(-40px); }",
  },
  {
    key: "slide-right",
    label: tr("右からスライド"),
    css: "from { transform: translateX(40px); }",
  },
  {
    key: "slide-up",
    label: tr("下からスライド"),
    css: "from { transform: translateY(40px); }",
  },
  {
    key: "slide-down",
    label: tr("上からスライド"),
    css: "from { transform: translateY(-40px); }",
  },
  { key: "spin", label: tr("回転"), css: "to { transform: rotate(360deg); }" },
  {
    key: "pulse",
    label: tr("パルス"),
    css: "50% { transform: scale(1.06); }",
  },
  {
    key: "bounce",
    label: tr("バウンス"),
    css: "0%, 50%, 85%, 100% { transform: translateY(0); } 30% { transform: translateY(-16px); } 70% { transform: translateY(-8px); }",
  },
  {
    key: "shake",
    label: tr("シェイク"),
    css: "0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); } 20%, 40%, 60%, 80% { transform: translateX(6px); }",
  },
  {
    key: "flip",
    label: tr("フリップ"),
    css: "from { transform: perspective(600px) rotateY(0); } to { transform: perspective(600px) rotateY(360deg); }",
  },
  {
    key: "swing",
    label: tr("スイング"),
    css: "20% { transform: rotate(12deg); } 40% { transform: rotate(-8deg); } 60% { transform: rotate(5deg); } 80% { transform: rotate(-3deg); } 100% { transform: rotate(0); }",
  },
  {
    key: "wobble",
    label: tr("ウォブル"),
    css: "15% { transform: translateX(-12px) rotate(-4deg); } 30% { transform: translateX(8px) rotate(3deg); } 45% { transform: translateX(-6px) rotate(-2deg); } 60% { transform: translateX(4px) rotate(1deg); } 100% { transform: none; }",
  },
  {
    key: "zoom-in",
    label: tr("ズームイン"),
    css: "from { opacity: 0; transform: scale(0.6); }",
  },
  {
    key: "zoom-out",
    label: tr("ズームアウト"),
    css: "from { opacity: 0; transform: scale(1.25); }",
  },
];

export function keyframeLabel(key: string): string {
  if (key === "custom") return tr("カスタム");
  return KEYFRAMES.find((k) => k.key === key)?.label ?? key;
}

export const DIRECTIONS = [
  { value: "normal", label: tr("通常") },
  { value: "reverse", label: tr("逆再生") },
  { value: "alternate", label: tr("交互") },
] as const;

export const FILL_MODES = [
  { value: "both", label: tr("両方を保持") },
  { value: "forwards", label: tr("最後を保持") },
  { value: "backwards", label: tr("最初を保持") },
  { value: "none", label: tr("保持しない") },
] as const;

/**
 * カスタムの @keyframes の名前。要素を複製するとモーションのIDも同じまま写るため、
 * 要素（scope）ごとに分ける（分けないと、複製先でキーフレームを変えても元の動きになる）
 */
export function customKeyframeName(m: Motion, scope?: string): string {
  const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, "_");
  return scope ? `anim-${safe(scope)}-${safe(m.id)}` : `anim-${safe(m.id)}`;
}

/** animation ショートハンドの値を組み立てる */
export function animationValue(m: Motion, paused = false, scope?: string): string {
  const iter = m.repeat === -1 ? "infinite" : String(m.repeat ?? 1);
  return [
    // カスタムはモーションごとに固有の @keyframes 名を使う
    m.keyframes === "custom" ? customKeyframeName(m, scope) : `anim-${m.keyframes}`,
    `${m.duration}s`,
    m.easing || "ease",
    `${m.delay || 0}s`,
    iter,
    m.direction ?? "normal",
    m.fillMode ?? "both",
    ...(paused ? ["paused"] : []),
  ].join(" ");
}

/** transition の値（状態変化時トリガーのモーションをまとめる） */
export function transitionValue(motions: Motion[]): string | null {
  const list = motions.filter((m) => m.trigger === "state");
  if (!list.length) return null;
  return list
    .map(
      (m) =>
        `${m.property || "all"} ${m.duration}s ${m.easing || "ease"} ${m.delay || 0}s`
    )
    .join(", ");
}

export interface MotionCss {
  /** 既定ルールに足す宣言（transition / load・in-view の animation） */
  base: string[];
  /** 擬似クラス → 宣言（hover / active の animation） */
  pseudo: { pseudo: string; decls: string[] }[];
  /** 使用したキーフレームのキー */
  usedKeyframes: string[];
  /** カスタムキーフレーム（名前 → @keyframes 本体） */
  customKeyframes: { name: string; css: string }[];
  /** in-view トリガーを含むか */
  hasInView: boolean;
}

/**
 * モーション設定からCSS宣言を組み立てる。
 * inViewMode: "paused" = 停止で開始し .is-inview で再生（書き出し用）、
 *             "run" = 即時再生（エディタのプレビュー用）
 */
export function motionCss(
  motions: Motion[] | undefined,
  inViewMode: "paused" | "run",
  /** 要素ごとに分けるカスタムの @keyframes 名に付ける名前（要素のIDなど） */
  scope?: string
): MotionCss {
  const out: MotionCss = {
    base: [],
    pseudo: [],
    usedKeyframes: [],
    customKeyframes: [],
    hasInView: false,
  };
  if (!motions?.length) return out;

  const trans = transitionValue(motions);
  if (trans) out.base.push(`transition: ${trans};`);

  const baseAnimations: string[] = [];
  const baseExtras = new Set<string>();
  const pseudoGroups = new Map<
    string,
    { animations: string[]; extras: Set<string> }
  >();

  for (const m of motions) {
    if (m.trigger === "state" || !m.keyframes) continue;
    if (m.keyframes === "custom") {
      if (!m.customKeyframes?.trim()) continue;
      out.customKeyframes.push({
        name: customKeyframeName(m, scope),
        css: m.customKeyframes.trim(),
      });
    } else {
      out.usedKeyframes.push(m.keyframes);
    }
    const extras =
      m.keyframes === "swing" ? ["transform-origin: top center;"] : [];
    if (m.trigger === "load") {
      baseAnimations.push(animationValue(m, false, scope));
      extras.forEach((extra) => baseExtras.add(extra));
    } else if (m.trigger === "in-view") {
      out.hasInView = true;
      baseAnimations.push(animationValue(m, inViewMode === "paused", scope));
      extras.forEach((extra) => baseExtras.add(extra));
    } else {
      const pseudo = `:${m.trigger}`;
      const group = pseudoGroups.get(pseudo) ?? {
        animations: [],
        extras: new Set<string>(),
      };
      group.animations.push(animationValue(m, false, scope));
      extras.forEach((extra) => group.extras.add(extra));
      pseudoGroups.set(pseudo, group);
    }
  }

  if (baseAnimations.length) {
    out.base.push(
      `animation: ${baseAnimations.join(", ")};`,
      ...baseExtras
    );
  }
  for (const [pseudo, group] of pseudoGroups) {
    out.pseudo.push({
      pseudo,
      decls: [
        `animation: ${group.animations.join(", ")};`,
        ...group.extras,
      ],
    });
  }
  return out;
}

/** 使用キーフレーム（ビルトイン + カスタム）の @keyframes CSS を生成 */
export function keyframesCss(
  keys: Iterable<string>,
  customs: { name: string; css: string }[] = []
): string {
  const uniq = [...new Set(keys)];
  const blocks = uniq
    .map((key) => {
      const kf = KEYFRAMES.find((k) => k.key === key);
      return kf ? `@keyframes anim-${key} {\n  ${kf.css}\n}` : "";
    })
    .filter(Boolean);
  const seen = new Set<string>();
  for (const c of customs) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    blocks.push(`@keyframes ${c.name} {\n  ${c.css}\n}`);
  }
  return blocks.join("\n\n");
}

/** 書き出しサイト用の IntersectionObserver スクリプト */
export const INVIEW_SCRIPT = `(function () {
  var io =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("is-inview");
              io.unobserve(entry.target);
            });
          },
          { threshold: 0.15 }
        )
      : null;
  var seen = new WeakSet();
  function scan() {
    document.querySelectorAll("[data-inview]").forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      if (io) io.observe(el);
      else el.classList.add("is-inview");
    });
  }
  scan();
  // ページ遷移（next/link）で差し替わった要素も見張る
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
`;
