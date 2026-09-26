"use client";

/**
 * 配置（重なり順・位置）と、親のレイアウトに対する大きさ
 */

import { ArrowDown, ArrowUp, BringToFront, MoveHorizontal, MoveVertical, RotateCw, SendToBack } from "lucide-react";
import { findParentOf, useEditor } from "../../lib/store";
import {
  parseNumeric,
  parseTransform,
  serializeTransform,
  resolveStyles,
  isInitialValue,
  initialValueOf,
} from "../../lib/style";
import { Grp, NumField, PropNum, Seg, unitConverter, useInspector } from "../controls";
import { tr } from "../../lib/i18n";
import { I, Sec } from "./shared";
import { nextStackLevel, type StackAction } from "../../lib/stack-order";

// 明示的に選んだ方式は、通常時や大きい画面の値を上書きしなければならない。
// 右クリックメニューでのリセットと入力欄を空にする操作は、それぞれ別の意味のまま残す。
function explicitDefault(insp: ReturnType<typeof useInspector>, prop: string): string | null {
  return isInitialValue(prop, insp.get(prop).baseline) ? null : initialValueOf(prop) ?? null;
}

/* ---------- 重なり順 ---------- */

/** A parent with its own stacking context may keep its children behind other groups. */
function stackingContextParent(): string | null {
  const { doc, selection, breakpoint } = useEditor.getState();
  if (!selection || !doc.nodes[selection]) return null;
  let parent = findParentOf(doc, selection);
  while (parent?.kind === "node") {
    const node = doc.nodes[parent.id];
    if (!node) break;
    const styles = resolveStyles(node, breakpoint, "default");
    const pos = styles.position ?? "static";
    const z = styles.zIndex;
    const opacity = styles.opacity === undefined ? 1 : Number(styles.opacity);
    if (
      ((pos === "relative" || pos === "absolute") && z && z !== "auto") ||
      pos === "fixed" || pos === "sticky" ||
      (Number.isFinite(opacity) && opacity < 1) ||
      (styles.transform && styles.transform !== "none") ||
      styles.isolation === "isolate"
    ) return parent.id;
    parent = findParentOf(doc, parent.id);
  }
  return null;
}

function siblingStackLevels(): (string | undefined)[] {
  const { doc, selection, breakpoint, styleState } = useEditor.getState();
  if (!selection || !doc.nodes[selection]) return [];
  const parent = findParentOf(doc, selection);
  const children = parent?.kind === "node"
    ? doc.nodes[parent.id]?.children
    : parent?.kind === "page"
      ? doc.pages[parent.id]?.children : undefined;
  if (!children) return [];
  const parentDisplay = parent?.kind === "node" && doc.nodes[parent.id]
    ? resolveStyles(doc.nodes[parent.id], breakpoint, "default").display : "block";
  const flexOrGrid = ["flex", "inline-flex", "grid", "inline-grid"].includes(parentDisplay ?? "");
  return children.filter(id => id !== selection && !!doc.nodes[id]).map(id => {
    const styles = resolveStyles(doc.nodes[id], breakpoint, styleState);
    // For a static child outside flex/grid, CSS ignores its z-index.
    if (!flexOrGrid && (!styles.position || styles.position === "static")) return undefined;
    return styles.zIndex;
  });
}

function ZIndexControl() {
  const insp = useInspector();
  const info = insp.get("zIndex");
  const z = info.value !== undefined && info.value !== "auto" ? parseInt(info.value, 10) || 0 : null;
  const parent = stackingContextParent();
  const peers = siblingStackLevels();

  const write = (next: number | null) => {
    if (next === null) return;
    const props: Record<string, string | null> = { zIndex: String(next) };
    // Automatically participate in z-index ordering for initially static elements.
    if (isInitialValue("position", insp.get("position").value)) props.position = "relative";
    insp.set(props);
  };
  const next = (action: StackAction) => nextStackLevel(info.value, peers, action);
  return (
    <div className="z-control">
      <div className="z-ctl">
        <button type="button" className="icon-btn" aria-label={tr("Send to back")}
          data-tip={tr("Send to back")} disabled={next("back") === null} onClick={() => write(next("back"))}>
          <SendToBack size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label={tr("Send backward")}
          data-tip={tr("Send backward")} disabled={next("backward") === null} onClick={() => write(next("backward"))}>
          <ArrowDown size={14} />
        </button>
        <span className={"z-val" + (info.changed ? " is-set" : "")}
          data-tip={info.setHere ? tr("Right-click to reset") : tr("Stacking order (z-index)")}
          onContextMenu={(e) => { e.preventDefault(); insp.set({ zIndex: null }); }}>
          {z !== null ? z : tr("automatic")}
        </span>
        <button type="button" className="icon-btn" aria-label={tr("Bring forward")}
          data-tip={tr("Bring forward")} disabled={next("forward") === null} onClick={() => write(next("forward"))}>
          <ArrowUp size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label={tr("Bring to front")}
          data-tip={tr("Bring to front")} disabled={next("front") === null} onClick={() => write(next("front"))}>
          <BringToFront size={14} />
        </button>
      </div>
      <details className="z-advanced">
        <summary>{tr("Exact stacking order (z-index)")}</summary>
        <input type="number" step="1" aria-label={tr("Exact stacking order (z-index)")}
          key={info.value ?? "auto"} defaultValue={z ?? ""} placeholder={tr("automatic")}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = z === null ? "" : String(z);
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (!value) insp.set({ zIndex: null });
            else if (/^-?\d+$/.test(value)) {
              const parsed = Number(value);
              if (Number.isSafeInteger(parsed) && parsed >= -2147483647 && parsed <= 2147483647)
                write(parsed);
            }
          }}
        />
      </details>
      {parent && (
        <div className="z-parent-notice">
          {tr("A parent's stacking order can limit this element.")}
          <button type="button" onClick={() => useEditor.getState().select(parent)}>
            {tr("Select parent")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- 位置 ---------- */

/** 位置の欄の表示（自動 / カスタム / 追従）。relative と static は「自動」とする */
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
  // （重なり順を変えたときに付く relative は「自動」のままとする）
  const modeChanged = posInfo.setHere && mode !== positionMode(posInfo.reference);

  const tfInfo = insp.get("transform");
  const tf = parseTransform(tfInfo.value);
  // 回転の欄は回転だけを比べる（transform の移動や拡大が違っても、色を付けない）
  const rotateChanged = tfInfo.setHere && tf.rotate !== parseTransform(tfInfo.reference).rotate;

  return (
    <Sec title={tr("Position")} tutorialTarget="style-position" help="layout-position">
      <Grp
        setHere={modeChanged}
        onReset={() =>
          insp.set({ position: null, left: null, right: null, top: null, bottom: null })
        }
      >
        <Seg
          value={mode}
          options={[
            { label: tr("automatic"), value: "auto" },
            { label: tr("Custom"), value: "custom" },
            { label: tr("Sticky"), value: "sticky" },
          ]}
          onChange={(v) => {
            // display: none が付いていれば（AI の編集などで付くことがある）、位置を選び直したときに外す
            const unhide: Record<string, string | null> = hidden
              ? { display: insp.get("display").baseline?.trim().toLowerCase() === "none" ? "revert" : null }
              : {};
            // 小さい画面では、消すと大きい画面の配置が表示されるため、初期値で打ち消す
            if (v === "auto")
              insp.set({
                ...unhide,
                position: explicitDefault(insp, "position"),
                left: explicitDefault(insp, "left"),
                right: explicitDefault(insp, "right"),
                top: explicitDefault(insp, "top"),
                bottom: explicitDefault(insp, "bottom"),
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
                left: explicitDefault(insp, "left"),
                right: explicitDefault(insp, "right"),
                bottom: explicitDefault(insp, "bottom"),
              });
          }}
        />
      </Grp>

      {mode === "custom" &&
        (() => {
          // 基準点: 反対側の辺だけが設定されていれば、そちらを基準とみなす（auto は未設定として扱う）
          const isSet = (v: string | undefined) => v !== undefined && v !== "auto";
          const anchorOf = (start: string | undefined, end: string | undefined) =>
            isSet(end) && !isSet(start) ? "end" : "start";
          const anchorInfo = (start: string, end: string) => {
            const s = insp.get(start);
            const e = insp.get(end);
            const now = anchorOf(s.value, e.value) === "end" ? end : start;
            // パソコン幅の既定は「左 / 上から」。他の画面幅やホバーなどでは、比べる相手の基準点を使う
            const base =
              anchorOf(s.baseline, e.baseline) === "end" ? end : start;
            return { now, base, changed: (s.setHere || e.setHere) && now !== base };
          };
          const x = anchorInfo("left", "right");
          const y = anchorInfo("top", "bottom");
          const xAnchor = x.now;
          const yAnchor = y.now;
          /**
           * 基準点の切り替え: 現在の値を新しい辺へ引き継ぐ。元の辺の値が大きい画面幅から
           * 受け継がれているときは、消すだけでは残るため、auto で打ち消す
           */
          const swapAnchor = (from: string, to: string) =>
            insp.set({
              [to]: isSet(insp.get(from).value) ? insp.get(from).value! : "0px",
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
                  label={tr("Horizontal anchor")}
                  setHere={x.changed}
                  onReset={() => x.changed && swapAnchor(x.now, x.base)}
                >
                  <Seg
                    value={xAnchor}
                    options={[
                      { label: tr("From left"), value: "left" },
                      { label: tr("From right"), value: "right" },
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
                  label={tr("Vertical anchor")}
                  setHere={y.changed}
                  onReset={() => y.changed && swapAnchor(y.now, y.base)}
                >
                  <Seg
                    value={yAnchor}
                    options={[
                      { label: tr("From top"), value: "top" },
                      { label: tr("From bottom"), value: "bottom" },
                    ]}
                    onChange={(v) => {
                      if (v !== yAnchor) swapAnchor(yAnchor, v);
                    }}
                  />
                </Grp>
              </div>
              <Grp
                label={tr("Relative to", "relative_to_variant_1")}
                setHere={posInfo.setHere && (pos === "fixed") !== (posInfo.reference === "fixed")}
                onReset={() => insp.set({ position: "absolute" })}
              >
                <Seg
                  value={pos}
                  options={[
                    { label: tr("Parent element"), value: "absolute" },
                    { label: tr("Viewport"), value: "fixed" },
                  ]}
                  onChange={(v) => insp.set({ position: v })}
                />
              </Grp>
            </>
          );
        })()}

      {mode === "sticky" && (
        <div className="grid2">
          <Grp label={tr("From the top edge")} props={["top"]}>
            <PropNum prop="top" pre="Y" units={["px"]} />
          </Grp>
        </div>
      )}

      <div className="grid2">
        <Grp
          label={tr("Rotation")}
          setHere={rotateChanged}
          // 回転だけを元に戻す（移動や拡大などはそのまま）
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
                  }) ?? (v === null ? insp.cleared("transform") : explicitDefault(insp, "transform")),
              })
            }
          />
        </Grp>
        <div className="z-grid-wide">
          <Grp
            label={tr("Stacking order")}
            info={tr("Arrange elements within the same parent. Parent stacking can limit the result.")}
            setHere={insp.get("zIndex").changed}
            onReset={() => insp.set({ zIndex: null })}
          >
            <ZIndexControl />
          </Grp>
        </div>
      </div>
    </Sec>
  );
}

/* ---------- レイアウト ---------- */

/** グリッドを選んだときに入る列 */
export const GRID_DEFAULT_COLUMNS = "repeat(2, 1fr)";

/** フローの欄の表示（自動 / 縦 / 横 / グリッド） */
export function flowMode(display: string | undefined, dir: string | undefined): string {
  if (display === "grid" || display === "inline-grid") return "grid";
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
 * 幅と高さの欄。親のフローの向き（axis = main）では「残りを埋める」を選べる。
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
   * 設定を外す。パソコン幅以外では、消すと他の画面幅の値が表示されるため、初期値で上書きする
   * （パソコン幅で「残りを埋める」にした要素を、スマホ幅だけで解除できるように）
   */
  const clear = (p: string): string | null => explicitDefault(insp, p);
  /** 値を入れたときの、伸び縮みの設定 */
  const flexFor = (v: string | null): Record<string, string | null> => {
    if (axis !== "main") return {};
    const px = !!v && /px$/.test(v);
    const reset = v === null ? (p: string) => insp.cleared(p) : clear;
    return {
      flexGrow: reset("flexGrow"),
      flexBasis: reset("flexBasis"),
      // px で決めた大きさは保つ（アイコンなどが、隣の文字に押しつぶされないように）
      flexShrink: px ? "0" : reset("flexShrink"),
      ...(insp.get(minProp).value === "0" ? { [minProp]: reset(minProp) } : {}),
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
        placeholder={fill ? tr("Fill") : "auto"}
        title={fill ? tr("Filling the parent's remaining space (enter a number to fix the size)") : undefined}
        onChange={(v) => {
          const val = v === null ? clear(prop) : v;
          insp.set({ [prop]: val, ...flexFor(v) });
        }}
        onScrubStart={() => useEditor.getState().beginGesture()}
        onScrub={(v) => insp.setTransient({ [prop]: v, ...flexFor(v) })}
        convert={unitConverter(prop)}
      />
      {axis === "main" && (
        <button
          type="button"
          className={`size-fill${fill ? " is-on" : ""}${fill && grow.changed ? " is-set" : ""}`}
          aria-pressed={fill}
          aria-label={tr("Fill remaining space")}
          data-tip={
            fill
              ? tr("Filling remaining space (click to turn off)")
              : prop === "width"
                ? tr("Use all of the parent's remaining width")
                : tr("Use all of the parent's remaining height")
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
 * 閉じた中にある設定の状態（開くボタンの色に使う）。
 * " is-set" = この画面幅・状態で変えた（変更の色）、
 * " has-value" = タブレット以下で、大きい画面から受け継いだ値が既定値と違う（灰色。隠れていると気づきにくいため）
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

/** 選択中の要素の、キャンバス上での実際の幅・高さ（px） */
export function selectedSize(axis: "w" | "h"): number | undefined {
  const id = useEditor.getState().selection;
  if (!id) return undefined;
  const el = document.querySelector<HTMLElement>(`.cv-root [data-node="${CSS.escape(id)}"]`);
  if (!el) return undefined;
  // キャンバスは CSS の zoom で拡大・縮小しているため、その分を戻す
  const zoom = parseFloat(el.closest<HTMLElement>('[style*="zoom"]')?.style.zoom ?? "") || 1;
  const r = el.getBoundingClientRect();
  return Math.round((axis === "w" ? r.width : r.height) / zoom);
}
