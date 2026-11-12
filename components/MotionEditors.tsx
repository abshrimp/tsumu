"use client";

/**
 * モーションの編集画面（右パネルのモーションから開く）。
 * - イージング: 曲線のハンドルをドラッグし、動く点で緩急を確かめながら決める
 * - カスタムキーフレーム: タイムラインに置いた各時点の見た目を、見本を動かしながら決める
 * どちらも画面の中だけで編集し、「適用」で1回の変更として書き込む（「元に戻す」1回で戻せる）
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Code, Diamond, Ghost, Pause, Play, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { tr } from "../lib/i18n";
import { easeAt, easingValue, EASING_PRESETS, parseEasing, type Bezier, type Easing, type StepPosition } from "../lib/easing";
import { emptyKeyframe, parseKeyframes, serializeKeyframes, type Keyframe } from "../lib/keyframes";
import { KEYFRAMES } from "../lib/motion";
import { parseNumeric } from "../lib/style";
import { CommitInput, CommitTextarea, Dropdown, NumField, Seg } from "./controls";
import { isEnterKey } from "../lib/keys";
import { trackMotionPointer } from "../lib/motion-pointer-drag";

/* ---------- 共通 ---------- */

/** 入力中やメニューを開いている間の Esc はそちらに任せ、それ以外のときは画面を閉じる */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select") || document.querySelector(".dd-menu")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

const SPEEDS = [
  { value: "1", label: "1×" },
  { value: "0.5", label: "0.5×" },
  { value: "0.25", label: "0.25×" },
];

/** プレビューの再生時間（短すぎても長すぎても動きが分からないため、一定の範囲に収める） */
const previewSeconds = (duration: number) => Math.min(10, Math.max(0.1, duration || 0.3));

/**
 * 再生の時計。time は 0〜duration（秒）で、最後まで進んだら少し止めてから最初に戻る。
 * speed は見た目の速さ（0.25 = 4倍ゆっくり）
 */
function usePlayback(duration: number, speed: number) {
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const clock = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const lead = 0.25;
    const hold = 0.6;
    // 時計は「止め」の時間を含めて進め、表示する時刻は 0〜duration に収める
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      clock.current += dt;
      const cycle = lead + duration + hold;
      if (clock.current >= cycle) clock.current %= cycle;
      setTime(Math.min(duration, Math.max(0, clock.current - lead)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, speed]);
  const seek = useCallback(
    (t: number) => {
      setPlaying(false);
      const v = Math.min(duration, Math.max(0, t));
      clock.current = v + 0.25;
      setTime(v);
    },
    [duration]
  );
  const toggle = useCallback(() => {
    setPlaying((p) => {
      // 最後で止めていたら、最初から再生する
      if (!p && clock.current >= 0.25 + duration) clock.current = 0;
      return !p;
    });
  }, [duration]);
  return { playing, time, seek, toggle };
}

interface History<T> {
  value: T;
  /** 値を変える。mergeKey が続けて同じなら（文字の入力など）、1つの履歴にまとめる */
  set: (next: T | ((v: T) => T), mergeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 編集を受け付けたポインターを、履歴上のドラッグ操作の持ち主として明示的に記録する */
  beginGesture: (pointerId: number) => void;
  /** キャンセルやキャプチャの喪失で終わった操作を、次の操作とは別の履歴にする */
  endGesture: () => void;
}

/**
 * 編集画面の中だけで使う「元に戻す / やり直す」。
 * エディタ本体の履歴とは別で、「適用」したときに1回の変更として本体の履歴に入る。
 * ドラッグ（押してから離すまで）の間の変更は、1つの履歴にまとめる
 */
function useHistory<T>(init: () => T): History<T> {
  const ref = useRef<{
    past: T[];
    value: T;
    future: T[];
    mergeKey: string | null;
    pressed: boolean;
    pointerId: number | null;
    gestureOwned: boolean;
    moved: boolean;
    dragPushed: boolean;
  } | null>(null);
  ref.current ??= { past: [], value: init(), future: [], mergeKey: null, pressed: false, pointerId: null, gestureOwned: false, moved: false, dragPushed: false };
  const [, render] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const h = ref.current!;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const down = (event: PointerEvent) => {
      if (h.gestureOwned) return;
      clearTimeout(releaseTimer);
      h.pointerId = event.pointerId;
      h.pressed = true;
      h.moved = false;
      h.dragPushed = false;
    };
    const move = (event: PointerEvent) => {
      if (h.pressed && (!h.gestureOwned || event.pointerId === h.pointerId)) h.moved = true;
    };
    // 離したときの後始末（重なった位置を戻すなど）も同じドラッグに含めるため、少し遅らせて終える
    const up = (event: Event) => {
      if (h.gestureOwned && "pointerId" in event && event.pointerId !== h.pointerId) return;
      h.pointerId = null;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => (h.pressed = false));
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", up);
    return () => {
      clearTimeout(releaseTimer);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", up);
    };
  }, []);

  const set = useCallback((next: T | ((v: T) => T), mergeKey?: string) => {
    const h = ref.current!;
    const v = typeof next === "function" ? (next as (v: T) => T)(h.value) : next;
    // 欄に触れただけなど、中身が変わらないときは履歴に積まない
    if (JSON.stringify(v) === JSON.stringify(h.value)) return;
    const dragging = h.pressed && h.moved;
    const merge = (dragging && h.dragPushed) || (mergeKey !== undefined && h.mergeKey === mergeKey);
    if (!merge) {
      h.past.push(h.value);
      if (h.past.length > 200) h.past.shift();
    }
    if (dragging) h.dragPushed = true;
    h.mergeKey = mergeKey ?? null;
    h.future = [];
    h.value = v;
    render();
  }, []);

  const undo = useCallback(() => {
    const h = ref.current!;
    const prev = h.past.pop();
    if (prev === undefined) return;
    h.future.push(h.value);
    h.value = prev;
    h.mergeKey = null;
    // ポインターを押したままでも、元に戻す・やり直すは履歴の区切りになる。
    // その後のポインターの動きを、移動した先の履歴にまとめてはいけない。
    h.pressed = false;
    h.moved = false;
    h.dragPushed = false;
    h.gestureOwned = false;
    h.pointerId = null;
    render();
  }, []);

  const redo = useCallback(() => {
    const h = ref.current!;
    const next = h.future.pop();
    if (next === undefined) return;
    h.past.push(h.value);
    h.value = next;
    h.mergeKey = null;
    // ポインターを押したままでも、元に戻す・やり直すは履歴の区切りになる。
    // その後のポインターの動きを、移動した先の履歴にまとめてはいけない。
    h.pressed = false;
    h.moved = false;
    h.dragPushed = false;
    h.gestureOwned = false;
    h.pointerId = null;
    render();
  }, []);

  const beginGesture = useCallback((pointerId: number) => {
    const h = ref.current!;
    h.pointerId = pointerId;
    h.gestureOwned = true;
    h.pressed = true;
    h.moved = false;
    h.dragPushed = false;
  }, []);

  const endGesture = useCallback(() => {
    const h = ref.current!;
    h.pointerId = null;
    h.gestureOwned = false;
    h.pressed = false;
  }, []);

  const h = ref.current;
  return { value: h.value, set, undo, redo, beginGesture, endGesture, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

/** ⌘Z / ⇧⌘Z（Ctrl+Z / Ctrl+Y）で、編集画面の中の履歴を移動する。入力欄の中では、文字の取り消しに任せる */
function useHistoryKeys(history: Pick<History<unknown>, "undo" | "redo">) {
  const { undo, redo } = history;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || (key === "y" && !e.metaKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
}

function ModalFrame({
  title,
  className,
  history,
  onClose,
  onApply,
  children,
}: {
  title: string;
  className: string;
  history: History<unknown>;
  onClose: () => void;
  onApply: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  useHistoryKeys(history);
  // 右パネルの中から開くため、パネルの重なりやはみ出しの影響を受けないよう、body に描画する
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal me-modal ${className}`} role="dialog" aria-label={title}>
        <div className="me-head">
          <h2>{title}</h2>
          <button
            className="icon-btn"
            data-tip={tr("Undo")}
            data-tip-kbd="⌘Z"
            aria-label={tr("Undo")}
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 size={15} />
          </button>
          <button
            className="icon-btn"
            data-tip={tr("Redo")}
            data-tip-kbd="⇧⌘Z"
            aria-label={tr("Redo")}
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 size={15} />
          </button>
        </div>
        {children}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button className="btn btn-primary" onClick={onApply}>
            {tr("Apply")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------- イージング ---------- */

/** 曲線の小さな絵（右パネルのボタンや、プリセットの一覧に使う） */
export function EasingCurve({ value, size = 22 }: { value: string; size?: number }) {
  const e = parseEasing(value);
  const pad = 2;
  const w = size - pad * 2;
  if (!e) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ease-thumb" aria-hidden>
        <path d={`M${pad} ${size / 2}h${w}`} strokeDasharray="2 2" />
      </svg>
    );
  }
  // 行き過ぎる曲線も枠に収まるよう、縦の範囲を広げる
  const ys = e.kind === "bezier" ? [0, 1, e.b[1], e.b[3]] : [0, 1];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const sy = (y: number) => pad + ((hi - y) / (hi - lo || 1)) * w;
  const sx = (x: number) => pad + x * w;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ease-thumb" aria-hidden>
      <path d={curvePath(e, sx, sy)} />
    </svg>
  );
}

function curvePath(e: Easing, sx: (x: number) => number, sy: (y: number) => number): string {
  if (e.kind === "bezier") {
    const [x1, y1, x2, y2] = e.b;
    return `M${sx(0)} ${sy(0)} C${sx(x1)} ${sy(y1)} ${sx(x2)} ${sy(y2)} ${sx(1)} ${sy(1)}`;
  }
  // 段階的に変わる値は、区間ごとの水平線を縦の線でつなぐ
  const pts: string[] = [];
  const N = 400;
  let prev = easeAt(e, 0);
  pts.push(`M${sx(0)} ${sy(prev)}`);
  for (let i = 1; i <= N; i++) {
    const x = i / N;
    const y = easeAt(e, x);
    if (y !== prev) pts.push(`L${sx(x)} ${sy(prev)} L${sx(x)} ${sy(y)}`);
    prev = y;
  }
  pts.push(`L${sx(1)} ${sy(prev)}`);
  return pts.join(" ");
}

const STEP_POSITIONS: { value: StepPosition; label: string; desc: string }[] = [
  { value: "jump-end", label: tr("Change at the end"), desc: "steps(n, end)" },
  { value: "jump-start", label: tr("Change at the start"), desc: "steps(n, start)" },
  { value: "jump-none", label: tr("Include the first and last step"), desc: "steps(n, jump-none)" },
  { value: "jump-both", label: tr("Change at both ends"), desc: "steps(n, jump-both)" },
];

const PRESET_GROUPS: { group: (typeof EASING_PRESETS)[number]["group"]; label: string }[] = [
  { group: "basic", label: tr("Basic") },
  { group: "smooth", label: tr("Smooth") },
  { group: "back", label: tr("Overshoot") },
];

/** グラフの大きさ（x の 0〜1 を横幅に、y は値に合わせて広げた範囲を縦幅に描く） */
const GW = 240;
const GH = 240;
const GPAD = 14;

export function EasingEditorModal({
  value,
  duration,
  onApply,
  onClose,
}: {
  value: string;
  /** モーションの再生時間（秒）。プレビューの速さに使う */
  duration: number;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  /** raw = グラフで表せない値を直接書いたときの、その文字列 */
  const history = useHistory<{ easing: Easing | null; raw: string | null }>(() => {
    const e = parseEasing(value);
    return { easing: e, raw: e ? null : value };
  });
  const { easing, raw } = history.value;
  const setEasing = (e: Easing | null) => history.set({ easing: e, raw: null });
  const [speed, setSpeed] = useState("1");
  const current = raw ?? (easing ? easingValue(easing) : "ease");
  const dur = previewSeconds(duration);
  const { time, playing, toggle } = usePlayback(dur, Number(speed));
  const p = time / dur;

  // 縦の範囲。ドラッグ中は固定し（グラフが伸び縮みしてハンドルが指から離れないように）、離したら合わせ直す
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  const rangeRef = useRef<[number, number]>([0, 1]);
  if (dragging === null) {
    const ys = easing?.kind === "bezier" ? [easing.b[1], easing.b[3]] : [];
    rangeRef.current = [Math.min(-0.15, ...ys.map((y) => y - 0.12)), Math.max(1.15, ...ys.map((y) => y + 0.12))];
  }
  const [lo, hi] = rangeRef.current;
  const sx = (x: number) => GPAD + x * (GW - GPAD * 2);
  const sy = (y: number) => GPAD + ((hi - y) / (hi - lo)) * (GH - GPAD * 2);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const endGesture = history.endGesture;
  useEffect(() => () => {
    dragCleanup.current?.();
    dragCleanup.current = null;
    endGesture();
  }, [endGesture]);

  const setBezier = (b: Bezier) => setEasing({ kind: "bezier", b });

  const dragHandle = (which: 0 | 1) => (e: React.PointerEvent) => {
    if (e.button !== 0 || dragCleanup.current || easing?.kind !== "bezier") return;
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    history.beginGesture(e.pointerId);
    setDragging(which);
    const start = easing.b;
    const move = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      // 画面上の位置を、描画の座標（viewBox）を経由して曲線の値に戻す
      const vx = ((ev.clientX - r.left) / r.width) * GW;
      const vy = ((ev.clientY - r.top) / r.height) * GH;
      const x = Math.min(1, Math.max(0, (vx - GPAD) / (GW - GPAD * 2)));
      const y = Math.min(3, Math.max(-2, hi - ((vy - GPAD) / (GH - GPAD * 2)) * (hi - lo)));
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const next = [...start] as Bezier;
      next[which * 2] = r2(x);
      next[which * 2 + 1] = r2(y);
      setBezier(next);
    };
    dragCleanup.current = trackMotionPointer(e, svg, move, () => {
      dragCleanup.current = null;
      endGesture();
      setDragging(null);
    });
  };

  const y = easing ? easeAt(easing, p) : p;
  const b = easing?.kind === "bezier" ? easing.b : null;
  const mode = easing?.kind ?? "bezier";

  return (
    <ModalFrame
      title={tr("Edit easing")}
      className="ee-modal"
      history={history as History<unknown>}
      onClose={onClose}
      onApply={() => onApply(current)}
    >
      <p className="modal-desc">{tr("Set how the speed changes over the motion. Horizontal is time, vertical is progress.")}</p>
      <div className="ee-body">
        <div className="ee-graph-col">
          <svg
            ref={svgRef}
            className={`ee-graph${dragging !== null ? " is-dragging" : ""}`}
            viewBox={`0 0 ${GW} ${GH}`}
            role="img"
            aria-label={current}
          >
            {/* 0〜1 の枠と目盛り */}
            <rect className="ee-box" x={sx(0)} y={sy(1)} width={sx(1) - sx(0)} height={sy(0) - sy(1)} />
            {[0.25, 0.5, 0.75].map((g) => (
              <g key={g} className="ee-grid">
                <line x1={sx(g)} x2={sx(g)} y1={sy(0)} y2={sy(1)} />
                <line x1={sx(0)} x2={sx(1)} y1={sy(g)} y2={sy(g)} />
              </g>
            ))}
            <line className="ee-linear" x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} />
            {easing && (
              <>
                {b && (
                  <g className="ee-arms">
                    <line x1={sx(0)} y1={sy(0)} x2={sx(b[0])} y2={sy(b[1])} />
                    <line x1={sx(1)} y1={sy(1)} x2={sx(b[2])} y2={sy(b[3])} />
                  </g>
                )}
                <path className="ee-curve" d={curvePath(easing, sx, sy)} />
                {/* 再生中の位置 */}
                <line className="ee-time" x1={sx(p)} x2={sx(p)} y1={sy(lo)} y2={sy(hi)} />
                <circle className="ee-dot" cx={sx(p)} cy={sy(y)} r={4} />
                {b &&
                  ([0, 1] as const).map((i) => (
                    <circle
                      key={i}
                      className={`ee-handle${dragging === i ? " is-active" : ""}`}
                      cx={sx(b[i * 2])}
                      cy={sy(b[i * 2 + 1])}
                      r={7}
                      onPointerDown={dragHandle(i)}
                    >
                      <title>{i === 0 ? tr("Start handle") : tr("End handle")}</title>
                    </circle>
                  ))}
              </>
            )}
          </svg>
          {b && (
            <div className="ee-nums">
              {(["x1", "y1", "x2", "y2"] as const).map((label, i) => (
                <label key={label} className="ee-num">
                  <span>{label}</span>
                  <NumField
                    value={String(b[i])}
                    units={[""]}
                    min={i % 2 === 0 ? 0 : -2}
                    max={i % 2 === 0 ? 1 : 3}
                    onChange={(v) => {
                      const n = parseNumeric(v ?? "")?.num;
                      if (n === undefined) return;
                      const next = [...b] as Bezier;
                      next[i] = n;
                      setBezier(next);
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <label className="lbl">{tr("CSS value")}</label>
          <CommitInput
            key={current}
            className="input mono"
            value={current}
            spellCheck={false}
            onCommit={(v) => {
              const t = v.trim() || "ease";
              const parsed = parseEasing(t);
              if (parsed) setEasing(parsed);
              else history.set((h) => ({ ...h, raw: t }));
            }}
            onKeyDown={(e) => {
              if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
            }}
          />
          {raw !== null && <p className="hint">{tr("This value can't be shown as a graph, but it can be used as is.")}</p>}
        </div>

        <div className="ee-side">
          <Seg
            value={raw !== null ? "" : mode}
            options={[
              { value: "bezier", label: tr("Curve") },
              { value: "steps", label: tr("Steps") },
            ]}
            onChange={(v) =>
              setEasing(
                v === "steps"
                  ? easing?.kind === "steps" ? easing : { kind: "steps", n: 4, pos: "jump-end" }
                  : easing?.kind === "bezier" ? easing : parseEasing("ease")
              )
            }
          />

          {mode === "steps" && easing?.kind === "steps" && raw === null ? (
            <div className="ee-steps">
              <label className="lbl">{tr("Number of steps")}</label>
              <NumField
                value={String(easing.n)}
                units={[""]}
                min={easing.pos === "jump-none" ? 2 : 1}
                max={60}
                onChange={(v) => {
                  const n = Math.round(parseNumeric(v ?? "")?.num ?? easing.n);
                  setEasing({ ...easing, n: Math.max(easing.pos === "jump-none" ? 2 : 1, n) });
                }}
              />
              <label className="lbl">{tr("When each step changes")}</label>
              <Dropdown
                value={easing.pos}
                options={STEP_POSITIONS}
                onChange={(v) => {
                  const pos = v as StepPosition;
                  setEasing({ ...easing, pos, n: pos === "jump-none" ? Math.max(2, easing.n) : easing.n });
                }}
              />
              <p className="hint">{tr("Jumps from step to step instead of moving smoothly, like a clock hand or frame-by-frame animation.")}</p>
            </div>
          ) : (
            <div className="ee-presets">
              {PRESET_GROUPS.map(({ group, label }) => (
                <div key={group}>
                  <div className="ee-group">{label}</div>
                  <div className="ee-preset-grid">
                    {EASING_PRESETS.filter((pr) => pr.group === group).map((pr) => (
                      <button
                        key={pr.value}
                        type="button"
                        className={`ee-preset${pr.value === current ? " is-on" : ""}`}
                        onClick={() => setEasing(parseEasing(pr.value))}
                      >
                        <EasingCurve value={pr.value} size={24} />
                        <span>{pr.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      <div className="ee-preview">
        <div className="ee-lane">
          <span className="ee-lane-label">{tr("Constant speed")}</span>
          <div className="ee-track">
            <span className="ee-ball is-ghost" style={{ left: `${p * 100}%` }} />
          </div>
        </div>
        <div className="ee-lane">
          <span className="ee-lane-label">{tr("This easing")}</span>
          <div className="ee-track">
            <span className="ee-ball" style={{ left: `${y * 100}%` }} />
          </div>
        </div>
        <div className="me-transport">
          <button className="icon-btn" data-tip={playing ? tr("Pause") : tr("Play")} onClick={toggle}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="me-time">
            {(time).toFixed(2)}s / {dur.toFixed(2)}s
          </span>
          <Seg value={speed} options={SPEEDS} onChange={setSpeed} full={false} />
        </div>
      </div>
    </ModalFrame>
  );
}

/* ---------- カスタムキーフレーム ---------- */

type NumKey = "opacity" | "x" | "y" | "scale" | "rotate";

/** 項目（表示用の単位に換算して表示する。不透明度と拡大は % で表示する） */
const KF_FIELDS: { key: NumKey; label: string; unit: string; pre: string; toView: (n: number) => number; fromView: (n: number) => number; min?: number; max?: number }[] = [
  { key: "opacity", label: tr("Opacity"), unit: "%", pre: "α", toView: (n) => n * 100, fromView: (n) => n / 100, min: 0, max: 100 },
  { key: "x", label: tr("Move X"), unit: "px", pre: "X", toView: (n) => n, fromView: (n) => n },
  { key: "y", label: tr("Move Y"), unit: "px", pre: "Y", toView: (n) => n, fromView: (n) => n },
  { key: "scale", label: tr("Zoom in"), unit: "%", pre: "S", toView: (n) => n * 100, fromView: (n) => n / 100, min: 0 },
  { key: "rotate", label: tr("Rotation"), unit: "deg", pre: "R", toView: (n) => n, fromView: (n) => n },
];

const round = (n: number) => Math.round(n * 1000) / 1000;

export function KeyframeEditorModal({
  css,
  duration,
  easing,
  onApply,
  onClose,
}: {
  css: string;
  duration: number;
  easing: string;
  onApply: (css: string) => void;
  onClose: () => void;
}) {
  const initial = useMemo(() => parseKeyframes(css), [css]);
  /** cssText = CSS を直接書いているときの、その文字列（読み取れない書き方でも、そのまま適用できる） */
  const history = useHistory<{ list: Keyframe[]; cssText: string | null }>(() => ({
    list: initial ?? [emptyKeyframe(0), emptyKeyframe(100)],
    cssText: initial ? null : css,
  }));
  const { list, cssText } = history.value;
  const setList = (next: Keyframe[] | ((l: Keyframe[]) => Keyframe[])) =>
    history.set((h) => ({ ...h, list: typeof next === "function" ? next(h.list) : next }));
  const [cssError, setCssError] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => list[0]?.id ?? null);
  const [speed, setSpeed] = useState("1");
  const [ghosts, setGhosts] = useState(true);
  const dur = previewSeconds(duration);
  const { time, playing, toggle, seek } = usePlayback(dur, Number(speed));

  const output = cssText ?? serializeKeyframes(list);
  const sorted = [...list].sort((a, b) => a.offset - b.offset);
  // 元に戻す操作で、選んでいたキーフレームが消えたときは、先頭を選ぶ
  const sel = list.find((k) => k.id === selected) ?? list[0] ?? null;

  const rawId = useId();
  const animName = `kfe-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const stageRef = useRef<HTMLDivElement>(null);

  // 見本の CSS アニメーションは止めたまま、時刻を直接合わせて描く（タイムラインと同じ時刻の見た目を表示する）
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const el of stage.querySelectorAll<HTMLElement>("[data-at]")) {
      const at = Number(el.dataset.at) * 1000;
      for (const a of el.getAnimations?.() ?? []) a.currentTime = at;
    }
  });

  const update = (id: string, patch: Partial<Keyframe>) =>
    setList((l) => l.map((k) => (k.id === id ? { ...k, ...patch } : k)));

  /** 同じ位置に2つ置かない（CSS では後のものだけが効き、見分けが付かないため） */
  const freeOffset = (offset: number, except?: string) =>
    !list.some((k) => k.id !== except && Math.abs(k.offset - offset) < 0.001);

  const addAt = (offset: number) => {
    const o = Math.round(Math.min(100, Math.max(0, offset)));
    if (!freeOffset(o)) {
      setSelected(list.find((k) => Math.abs(k.offset - o) < 0.001)!.id);
      return;
    }
    const kf = emptyKeyframe(o);
    setList((l) => [...l, kf]);
    setSelected(kf.id);
    seek((o / 100) * dur);
  };

  const select = (kf: Keyframe) => {
    setSelected(kf.id);
    seek((kf.offset / 100) * dur);
  };

  const laneRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const cssMode = cssText !== null;
  const endGesture = history.endGesture;
  useEffect(() => () => {
    dragCleanup.current?.();
    dragCleanup.current = null;
    endGesture();
  }, [cssMode, endGesture]);

  const pct = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };

  const dragMarker = (kf: Keyframe) => (e: React.PointerEvent) => {
    if (e.button !== 0 || dragCleanup.current || !laneRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    history.beginGesture(e.pointerId);
    select(kf);
    const from = kf.offset;
    let offset = from;
    let moved = false;
    const move = (ev: PointerEvent) => {
      offset = Math.round(pct(ev.clientX));
      if (offset === from && !moved) return;
      moved = true;
      update(kf.id, { offset });
      seek((offset / 100) * dur);
    };
    const finish = (ev: PointerEvent | null) => {
      dragCleanup.current = null;
      if (moved) {
        // キャンセルには有効な座標が無いため、最後に動かした位置で終える。
        const o = ev ? Math.round(pct(ev.clientX)) : offset;
        // 重なったら元の位置に戻す（この後始末も、同じドラッグの履歴に含める）
        setList((l) =>
          l.map((k) => (k.id === kf.id ? { ...k, offset: l.some((x) => x.id !== kf.id && x.offset === o) ? from : o } : k))
        );
      }
      endGesture();
    };
    dragCleanup.current = trackMotionPointer(e, laneRef.current, move, finish);
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0 || dragCleanup.current) return;
    e.preventDefault();
    history.beginGesture(e.pointerId);
    const set = (x: number) => seek((pct(x) / 100) * dur);
    set(e.clientX);
    dragCleanup.current = trackMotionPointer(e, e.currentTarget, (ev) => set(ev.clientX), () => {
      dragCleanup.current = null;
      endGesture();
    });
  };

  const sample = (at: number, ghost: boolean, key?: string) => (
    <div
      key={key}
      className={`kfe-sample${ghost ? " is-ghost" : ""}`}
      data-at={at}
      style={{ animation: `${animName} ${dur}s ${easing || "ease"} 0s 1 normal both paused` }}
    >
      {!ghost && "Aa"}
    </div>
  );

  return (
    <ModalFrame
      title={tr("Edit keyframes")}
      className="kfe-modal"
      history={history as History<unknown>}
      onClose={onClose}
      onApply={() => onApply(output)}
    >
      <style>{`@keyframes ${animName} {\n${output}\n}`}</style>
      <div className="kfe-toolbar">
        <p className="modal-desc">{tr("Set how the element looks at points on the timeline, and the motion in between is filled in automatically.")}</p>
        <Dropdown
          value={undefined}
          placeholder={tr("Start from a preset")}
          options={KEYFRAMES.map((k) => ({ value: k.key, label: k.label }))}
          style={{ width: 180 }}
          onChange={(key) => {
            const parsed = parseKeyframes(KEYFRAMES.find((k) => k.key === key)?.css ?? "");
            if (!parsed) return;
            history.set({ list: parsed, cssText: null });
            setCssError(false);
            setSelected(parsed[0]?.id ?? null);
            seek(0);
            if (!playing) toggle();
          }}
        />
      </div>

      <div className="kfe-stage" ref={stageRef}>
        <div className="kfe-origin" aria-hidden />
        {ghosts && cssText === null && sorted.map((kf) => sample((kf.offset / 100) * dur, true, kf.id))}
        {sample(time, false)}
      </div>

      <div className="me-transport">
        <button className="icon-btn" data-tip={playing ? tr("Pause") : tr("Play")} onClick={toggle}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="me-time">
          {time.toFixed(2)}s / {dur.toFixed(2)}s
        </span>
        <Seg value={speed} options={SPEEDS} onChange={setSpeed} full={false} />
        <span style={{ flex: 1 }} />
        <button
          className={`icon-btn${ghosts ? " is-on" : ""}`}
          data-tip={tr("Show each keyframe as an outline")}
          onClick={() => setGhosts((g) => !g)}
        >
          <Ghost size={14} />
        </button>
        <button
          className={`icon-btn${cssText !== null ? " is-on" : ""}`}
          data-tip={tr("Edit as CSS")}
          onClick={() => {
            if (cssText === null) {
              history.set({ list, cssText: serializeKeyframes(list) });
              setCssError(false);
              return;
            }
            const parsed = parseKeyframes(cssText);
            if (!parsed) {
              setCssError(true);
              return;
            }
            history.set({ list: parsed, cssText: null });
            setSelected(parsed[0]?.id ?? null);
          }}
        >
          <Code size={14} />
        </button>
      </div>

      {cssText === null ? (
        <>
          <div className="kfe-timeline">
            <div className="kfe-ruler" onPointerDown={scrub}>
              {[0, 25, 50, 75, 100].map((t) => (
                <span key={t} style={{ left: `${t}%` }}>
                  {t}%
                </span>
              ))}
            </div>
            <div
              className="kfe-lane"
              ref={laneRef}
              onPointerDown={(e) => {
                if (e.button === 0 && !dragCleanup.current && e.target === e.currentTarget) addAt(pct(e.clientX));
              }}
            >
              {sorted.map((kf) => (
                <button
                  key={kf.id}
                  type="button"
                  className={`kfe-marker${kf.id === sel?.id ? " is-sel" : ""}`}
                  style={{ left: `${kf.offset}%` }}
                  aria-label={`${round(kf.offset)}%`}
                  onPointerDown={dragMarker(kf)}
                >
                  <Diamond size={12} />
                </button>
              ))}
              <span className="kfe-playhead" style={{ left: `${(time / dur) * 100}%` }} />
            </div>
            <p className="hint">{tr("Drag the scale to move the playhead, click an empty spot on the bar below to add a keyframe, and drag ◆ to move it.")}</p>
          </div>

          {sel ? (
            <div className="kfe-inspector">
              <div className="kfe-ins-head">
                <span className="kfe-ins-title">
                  <Diamond size={12} />
                  {tr("At {offset}%", { offset: round(sel.offset) })}
                </span>
                <button
                  className="btn"
                  onClick={() => addAt((time / dur) * 100)}
                  data-tip={tr("Add a keyframe at the playhead")}
                >
                  <Plus size={13} />
                  {tr("Add")}
                </button>
                <button
                  className="icon-btn"
                  data-tip={tr("Delete this keyframe")}
                  disabled={list.length <= 1}
                  onClick={() => {
                    const rest = list.filter((k) => k.id !== sel.id);
                    setList(rest);
                    setSelected(rest[0]?.id ?? null);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="kfe-fields">
                <label className="kfe-field">
                  <span className="lbl">{tr("Position")}</span>
                  <NumField
                    value={`${round(sel.offset)}%`}
                    units={["%"]}
                    min={0}
                    max={100}
                    onChange={(v) => {
                      const o = parseNumeric(v ?? "")?.num;
                      if (o !== undefined && freeOffset(o, sel.id)) {
                        update(sel.id, { offset: o });
                        seek((o / 100) * dur);
                      }
                    }}
                  />
                </label>
                {KF_FIELDS.map((f) => {
                  const v = sel[f.key];
                  return (
                    <label key={f.key} className={`kfe-field${v !== undefined ? " is-set" : ""}`}>
                      <span className="lbl">{f.label}</span>
                      <NumField
                        value={v === undefined ? undefined : `${round(f.toView(v))}${f.unit}`}
                        units={[f.unit]}
                        min={f.min}
                        max={f.max}
                        pre={<span className="kfe-pre">{f.pre}</span>}
                        scrubFrom={() => f.toView(f.key === "scale" || f.key === "opacity" ? 1 : 0)}
                        onScrubStart={() => {}}
                        onScrub={(raw) => {
                          const n = parseNumeric(raw)?.num;
                          if (n !== undefined) update(sel.id, { [f.key]: round(f.fromView(n)) });
                        }}
                        onChange={(raw) => {
                          const n = raw === null ? undefined : parseNumeric(raw)?.num;
                          update(sel.id, { [f.key]: n === undefined ? undefined : round(f.fromView(n)) });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
              <label className="lbl">{tr("Other CSS")}</label>
              <CommitTextarea
                key={sel.id}
                className="textarea mono"
                rows={2}
                value={sel.extra}
                placeholder="filter: blur(4px); background-color: #0b57d0;"
                spellCheck={false}
                onCommit={(v) => update(sel.id, { extra: v.trim() })}
              />
              <p className="hint">{tr("Empty fields blend smoothly from the keyframes before and after.")}</p>
            </div>
          ) : (
            <p className="hint">{tr("Click the timeline to add a keyframe.")}</p>
          )}
        </>
      ) : (
        <div className="kfe-css">
          <textarea
            className="textarea mono"
            rows={9}
            value={cssText}
            spellCheck={false}
            onChange={(e) => {
              // 続けて入力した文字は、1つの履歴にまとめる
              const text = e.target.value;
              history.set((h) => ({ ...h, cssText: text }), "css-text");
              setCssError(false);
            }}
          />
          <p className={`hint${cssError ? " is-error" : ""}`}>
            {cssError
              ? tr("This can't be split into fields. Write it as from / to / 0%–100% followed by { }.")
              : tr("Write the body of @keyframes (from / to / 0%–100%). Press the button again to go back to the fields.")}
          </p>
        </div>
      )}
    </ModalFrame>
  );
}
