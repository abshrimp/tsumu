"use client";

/**
 * 配置（重なり順・位置）と、親のレイアウトに対する大きさ
 */

import { BringToFront, MoveHorizontal, MoveVertical, RotateCw, SendToBack } from "lucide-react";
import { findParentOf, useEditor } from "../../lib/store";
import {
  parseNumeric,
  parseTransform,
  serializeTransform,
  resolveStyles,
  isInitialValue,
} from "../../lib/style";
import { Grp, NumField, PropNum, Seg, unitConverter, useInspector } from "../controls";
import { tr } from "../../lib/i18n";
import { I, Sec } from "./shared";

/* ---------- 重なり順 ---------- */

function ZIndexControl() {
  const insp = useInspector();
  const info = insp.get("zIndex");
  const z = info.value !== undefined && info.value !== "auto" ? parseInt(info.value, 10) || 0 : null;

  const bump = (d: number) => {
    const next = (z ?? 0) + d;
    const props: Record<string, string | null> = { zIndex: String(next) };
    // z-index を効かせるため、未配置の要素には relative を付ける
    if (!insp.get("position").value) props.position = "relative";
    insp.set(props);
  };

  return (
    <div className="z-ctl">
      <button
        className="icon-btn"
        data-tip={tr("背面へ移動")}
        onClick={() => bump(-1)}
      >
        <SendToBack size={14} />
      </button>
      <span
        className={`z-val${info.changed ? " is-set" : ""}`}
        data-tip={info.setHere ? tr("右クリックでリセット") : tr("重なり順（z-index）")}
        onContextMenu={(e) => {
          e.preventDefault();
          insp.set({ zIndex: null });
        }}
      >
        {z !== null ? z : tr("自動")}
      </span>
      <button
        className="icon-btn"
        data-tip={tr("前面へ移動")}
        onClick={() => bump(1)}
      >
        <BringToFront size={14} />
      </button>
    </div>
  );
}

/* ---------- 位置 ---------- */

/** 位置の欄の表示（自動 / カスタム / 追従）。relative・static は「自動」 */
function positionMode(pos: string | undefined): "auto" | "custom" | "sticky" {
  return pos === "absolute" || pos === "fixed" ? "custom" : pos === "sticky" ? "sticky" : "auto";
}

export function PositionSec() {
  const insp = useInspector();
  const posInfo = insp.get("position");
  const pos = posInfo.value;
  const hidden = insp.get("display").value === "none";
  const mode = positionMode(pos);
  // 表示している状態（自動 / カスタム / 追従）が上位と違うときだけ色を付ける
  // （重なり順を変えたときに付く relative は「自動」のまま）
  const modeChanged = posInfo.setHere && mode !== positionMode(posInfo.reference);

  const tfInfo = insp.get("transform");
  const tf = parseTransform(tfInfo.value);
  // 回転の欄は回転だけを比べる（transform の移動・拡大が違っても色を付けない）
  const rotateChanged = tfInfo.setHere && tf.rotate !== parseTransform(tfInfo.reference).rotate;

  return (
    <Sec title={tr("位置")} tutorialTarget="style-position" help="layout-position">
      <Grp
        setHere={modeChanged}
        onReset={() =>
          insp.set({ position: null, left: null, right: null, top: null, bottom: null })
        }
      >
        <Seg
          value={mode}
          options={[
            { label: tr("自動"), value: "auto" },
            { label: tr("カスタム"), value: "custom" },
            { label: tr("追従"), value: "sticky" },
          ]}
          onChange={(v) => {
            // display: none が付いていれば（AIの編集などで付くことがある）、位置を選び直したときに外す
            const unhide: Record<string, string | null> = hidden
              ? { display: null }
              : {};
            // 小さい画面では、消すと大きい画面の配置が出てくるため初期値で打ち消す
            if (v === "auto")
              insp.set({
                ...unhide,
                position: insp.cleared("position"),
                left: insp.cleared("left"),
                right: insp.cleared("right"),
                top: insp.cleared("top"),
                bottom: insp.cleared("bottom"),
              });
            else if (v === "custom")
              insp.set({
                ...unhide,
                position: "absolute",
                left: "0px",
                top: "0px",
              });
            else
              insp.set({
                ...unhide,
                position: "sticky",
                top: "0px",
                left: insp.cleared("left"),
                right: insp.cleared("right"),
                bottom: insp.cleared("bottom"),
              });
          }}
        />
      </Grp>

      {mode === "custom" &&
        (() => {
          // 基準点: 反対側の辺だけが設定されていればそちらを基準とみなす（auto は未設定扱い）
          const isSet = (v: string | undefined) => v !== undefined && v !== "auto";
          const anchorOf = (start: string | undefined, end: string | undefined) =>
            isSet(end) && !isSet(start) ? "end" : "start";
          const anchorInfo = (start: string, end: string) => {
            const s = insp.get(start);
            const e = insp.get(end);
            const now = anchorOf(s.value, e.value) === "end" ? end : start;
            // パソコンの既定は「左 / 上から」。他の画面幅・ホバー等は比べる相手の基準点
            const base =
              anchorOf(s.baseline, e.baseline) === "end" ? end : start;
            return { now, base, changed: (s.setHere || e.setHere) && now !== base };
          };
          const x = anchorInfo("left", "right");
          const y = anchorInfo("top", "bottom");
          const xAnchor = x.now;
          const yAnchor = y.now;
          /**
           * 基準点の切替: 現在の値を新しい辺へ引き継ぐ。元の辺が大きい画面幅から
           * 引き継がれているときは、消すだけでは残るため auto で打ち消す
           */
          const swapAnchor = (from: string, to: string) =>
            insp.set({
              [to]: insp.get(from).value ?? "0px",
              [from]: isSet(insp.get(from).baseline) ? "auto" : null,
            });
          return (
            <>
              <div className="grid2">
                <Grp label="X" props={[xAnchor]}>
                  <PropNum
                    prop={xAnchor}
                    pre="X"
                    units={["px", "%"]}
                    placeholder="0"
                  />
                </Grp>
                <Grp
                  label={tr("横の基準点")}
                  setHere={x.changed}
                  onReset={() => x.changed && swapAnchor(x.now, x.base)}
                >
                  <Seg
                    value={xAnchor}
                    options={[
                      { label: tr("左から"), value: "left" },
                      { label: tr("右から"), value: "right" },
                    ]}
                    onChange={(v) => {
                      if (v !== xAnchor) swapAnchor(xAnchor, v);
                    }}
                  />
                </Grp>
                <Grp label="Y" props={[yAnchor]}>
                  <PropNum
                    prop={yAnchor}
                    pre="Y"
                    units={["px", "%"]}
                    placeholder="0"
                  />
                </Grp>
                <Grp
                  label={tr("縦の基準点")}
                  setHere={y.changed}
                  onReset={() => y.changed && swapAnchor(y.now, y.base)}
                >
                  <Seg
                    value={yAnchor}
                    options={[
                      { label: tr("上から"), value: "top" },
                      { label: tr("下から"), value: "bottom" },
                    ]}
                    onChange={(v) => {
                      if (v !== yAnchor) swapAnchor(yAnchor, v);
                    }}
                  />
                </Grp>
              </div>
              <Grp
                label={tr("基準にする要素")}
                setHere={posInfo.setHere && (pos === "fixed") !== (posInfo.reference === "fixed")}
                onReset={() => insp.set({ position: "absolute" })}
              >
                <Seg
                  value={pos}
                  options={[
                    { label: tr("親要素"), value: "absolute" },
                    { label: tr("画面全体"), value: "fixed" },
                  ]}
                  onChange={(v) => insp.set({ position: v })}
                />
              </Grp>
            </>
          );
        })()}

      {mode === "sticky" && (
        <div className="grid2">
          <Grp label={tr("上端から")} props={["top"]}>
            <PropNum prop="top" pre="Y" units={["px"]} />
          </Grp>
        </div>
      )}

      <div className="grid2">
        <Grp
          label={tr("回転")}
          setHere={rotateChanged}
          // 回転だけを元に戻す（移動・拡大などはそのまま）
          onReset={() =>
            insp.set({
              transform:
                serializeTransform({ ...tf, rotate: parseTransform(tfInfo.reference).rotate }) ??
                insp.cleared("transform"),
            })
          }
        >
          <NumField
            value={tf.rotate ? `${tf.rotate}deg` : undefined}
            units={["deg"]}
            pre={<RotateCw size={I} />}
            placeholder="0"
            onChange={(v) =>
              insp.set({
                transform:
                  serializeTransform({
                    ...tf,
                    rotate: v ? (parseNumeric(v)?.num ?? 0) : 0,
                  }) ?? insp.cleared("transform"),
              })
            }
          />
        </Grp>
        <Grp
          label={tr("重なり順")}
          setHere={insp.get("zIndex").changed}
          onReset={() => insp.set({ zIndex: null })}
        >
          <ZIndexControl />
        </Grp>
      </div>
    </Sec>
  );
}

/* ---------- レイアウト ---------- */

/** グリッドを選んだときに入る列 */
export const GRID_DEFAULT_COLUMNS = "repeat(2, 1fr)";

/** フローの欄の表示（自動 / 縦 / 横 / グリッド） */
export function flowMode(display: string | undefined, dir: string | undefined): string {
  if (display === "grid") return "grid";
  if (display === "flex" || display === "inline-flex") return dir?.startsWith("column") ? "v" : "h";
  return "block";
}

/** 選択中の要素の親が並べる向き（親がフローでなければ null） */
export function useParentFlexDir(): "row" | "column" | null {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const breakpoint = useEditor((s) => s.breakpoint);
  if (!selection) return null;
  const parent = findParentOf(doc, selection);
  if (parent?.kind !== "node") return null;
  const parentNode = doc.nodes[parent.id];
  if (!parentNode) return null;
  const resolved = resolveStyles(parentNode, breakpoint, "default");
  if (resolved.display !== "flex" && resolved.display !== "inline-flex") return null;
  return resolved.flexDirection?.startsWith("column") ? "column" : "row";
}

/**
 * 幅・高さの欄。親のフローの向き（axis = main）では「残りを埋める」を選べ、
 * px で固定したときは、隣の要素に押されて縮まないようにする（flex-shrink: 0）
 */
export function MainSizeField({
  prop,
  pre,
  axis,
}: {
  prop: "width" | "height";
  pre: string;
  /** main = 親のフローの向き（残りを埋められる） / cross = それ以外 */
  axis: "main" | "cross";
}) {
  const insp = useInspector();
  const info = insp.get(prop);
  const minProp = prop === "width" ? "minWidth" : "minHeight";
  const grow = insp.get("flexGrow");
  const fill = axis === "main" && !!grow.value && parseFloat(grow.value) > 0;
  const changed = info.changed || (axis === "main" && (grow.changed || insp.get("flexShrink").changed));

  /**
   * 設定を外す。パソコン幅以外では、消すとほかの画面幅の値が出てくるため初期値で上書きする
   * （パソコン幅で「残りを埋める」にした要素を、スマホ幅だけ解除できるように）
   */
  const clear = (p: string): string | null => insp.cleared(p);
  /** 値を入れたときの、伸び縮みの設定 */
  const flexFor = (v: string | null): Record<string, string | null> => {
    if (axis !== "main") return {};
    const px = !!v && /px$/.test(v);
    return {
      flexGrow: clear("flexGrow"),
      flexBasis: clear("flexBasis"),
      // px で決めた大きさは保つ（アイコンなどが隣の文字に押しつぶされないように）
      flexShrink: px ? "0" : clear("flexShrink"),
      ...(insp.get(minProp).value === "0" ? { [minProp]: clear(minProp) } : {}),
    };
  };
  const setFill = (on: boolean) =>
    insp.set(
      on
        ? {
            flexGrow: "1",
            flexShrink: "1",
            flexBasis: "0%",
            [prop]: null,
            // 中の文字が長くてもはみ出さず、残りの幅に収める
            [minProp]: "0",
          }
        : {
            flexGrow: clear("flexGrow"),
            flexShrink: clear("flexShrink"),
            flexBasis: clear("flexBasis"),
            [minProp]: clear(minProp),
          }
    );

  return (
    <div
      className={`size-field${axis === "main" ? " has-fill" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        insp.set({ [prop]: null, ...(axis === "main" ? { flexGrow: null, flexShrink: null, flexBasis: null } : {}) });
      }}
      style={{ ["--field" as string]: changed ? "var(--field-set)" : "var(--field-base)" }}
    >
      <NumField
        value={fill ? undefined : (info.value ?? "auto")}
        units={["px", "%"]}
        pre={pre}
        placeholder={fill ? tr("残り") : "auto"}
        title={fill ? tr("親の残りを埋めています（数値を入れると固定されます）") : undefined}
        onChange={(v) => {
          const val = v === null ? clear(prop) : v;
          insp.set({ [prop]: val, ...flexFor(v) });
        }}
        onScrubStart={() => insp.checkpoint()}
        onScrub={(v) => insp.setTransient({ [prop]: v, ...flexFor(v) })}
        convert={unitConverter(prop)}
      />
      {axis === "main" && (
        <button
          type="button"
          className={`size-fill${fill ? " is-on" : ""}${fill && grow.changed ? " is-set" : ""}`}
          aria-pressed={fill}
          aria-label={tr("残りを埋める")}
          data-tip={
            fill
              ? tr("残りを埋めています（押すと解除）")
              : prop === "width"
                ? tr("親の残りの幅をすべて使う")
                : tr("親の残りの高さをすべて使う")
          }
          onClick={() => setFill(!fill)}
        >
          {prop === "width" ? <MoveHorizontal size={12} /> : <MoveVertical size={12} />}
        </button>
      )}
    </div>
  );
}

/**
 * 閉じた中の設定の状態（開くボタンの色に使う）。
 * " is-set" = この画面幅・状態で変えた（変更の色）、
 * " has-value" = タブレット以下で、大きい画面から受け継いだ値が既定値と違う（灰色。隠れていると分かりにくいため）
 */
export function useHiddenState(props: string[]): string {
  const insp = useInspector();
  const smaller = useEditor((s) => s.breakpoint !== "base");
  const infos = props.map((p) => [p, insp.get(p)] as const);
  if (infos.some(([, info]) => info.changed)) return " is-set";
  if (smaller && infos.some(([p, info]) => !isInitialValue(p, info.value))) return " has-value";
  return "";
}

export const SIZE_LIMIT_PROPS = ["minWidth", "maxWidth", "minHeight", "maxHeight", "aspectRatio"];

/** 選択中の要素のキャンバス上の実際の幅・高さ（px） */
export function selectedSize(axis: "w" | "h"): number | undefined {
  const id = useEditor.getState().selection;
  if (!id) return undefined;
  const el = document.querySelector<HTMLElement>(`.cv-root [data-node="${CSS.escape(id)}"]`);
  if (!el) return undefined;
  // キャンバスは CSS の zoom で拡大縮小しているので、その分を戻す
  const zoom = parseFloat(el.closest<HTMLElement>('[style*="zoom"]')?.style.zoom ?? "") || 1;
  const r = el.getBoundingClientRect();
  return Math.round((axis === "w" ? r.width : r.height) / zoom);
}
