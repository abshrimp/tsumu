"use client";

/**
 * レイアウト（フレックスボックス・グリッド・すき間）
 */

import { useState } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowRight,
  LayoutGrid,
  Maximize2,
  SquareDashed,
  UnfoldHorizontal,
  UnfoldVertical,
} from "lucide-react";
import { parseNumeric } from "../../lib/style";
import {
  AlignGrid,
  Grp,
  NumField,
  PropNum,
  PropSeg,
  PropSelect,
  Seg,
  TextField,
  useInspector,
} from "../controls";
import { tr, trc } from "../../lib/i18n";
import { StyleCheck, differsFrom } from "./BackgroundSec";
import {
  GRID_DEFAULT_COLUMNS,
  MainSizeField,
  SIZE_LIMIT_PROPS,
  flowMode,
  selectedSize,
  useHiddenState,
  useParentFlexDir,
} from "./PositionSec";
import { I, Sec } from "./shared";

export function LayoutSec() {
  const insp = useInspector();
  const parentDir = useParentFlexDir();
  const [sizeDetail, setSizeDetail] = useState(false);
  const sizeLimitState = useHiddenState(SIZE_LIMIT_PROPS);
  const displayInfo = insp.get("display");
  const dirInfo = insp.get("flexDirection");
  const display = displayInfo.value;
  const dir = dirInfo.value ?? "row";
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid";
  // フローは表示している状態（自動 / 縦 / 横 / グリッド）で比べる
  // （「省略」の折り返しで付く -webkit-box などは「自動」のまま）
  const flowChanged =
    (displayInfo.setHere || dirInfo.setHere) &&
    flowMode(display, dirInfo.value) !== flowMode(displayInfo.reference, dirInfo.reference);
  // 「省略」の折り返しが一緒に付ける overflow: hidden には色を付けない
  const overflowInfo = insp.get("overflow");
  const overflowChanged =
    overflowInfo.changed &&
    !(insp.get("WebkitLineClamp").setHere && overflowInfo.value === "hidden");
  const spaceBetween = (insp.get("justifyContent").value ?? "").startsWith(
    "space"
  );
  /** 均等配置を外す値（消しても大きい画面・通常時の均等配置が残るときだけ左寄せを書き込む） */
  const unsetSpace = () =>
    insp.get("justifyContent").baseline?.startsWith("space") ? "flex-start" : null;

  const colsValue = insp.get("gridTemplateColumns").value;
  const colsMatch = colsValue ? /repeat\((\d+),\s*1fr\)/.exec(colsValue) : null;
  const rowsValue = insp.get("gridTemplateRows").value;
  const rowsMatch = rowsValue ? /repeat\((\d+),\s*1fr\)/.exec(rowsValue) : null;

  return (
    <Sec title={tr("レイアウト")} tutorialTarget="style-layout" help="layout-row">
      <Grp
        label={tr("フロー")}
        setHere={flowChanged}
        onReset={() => insp.set({ display: null, flexDirection: null })}
      >
        <Seg
          value={isGrid ? "grid" : isFlex ? (dir === "column" ? "v" : "h") : "block"}
          options={[
            {
              label: <SquareDashed size={13} />,
              value: "block",
              title: tr("自動（block）"),
            },
            {
              label: <ArrowDown size={13} />,
              value: "v",
              title: tr("垂直フロー（flex column）"),
            },
            {
              label: <ArrowRight size={13} />,
              value: "h",
              title: tr("水平フロー（flex row）"),
            },
            {
              label: <LayoutGrid size={13} />,
              value: "grid",
              title: tr("グリッド"),
            },
          ]}
          onChange={(v) => {
            if (v === "v") insp.set({ display: "flex", flexDirection: "column" });
            else if (v === "h")
              insp.set({ display: "flex", flexDirection: "row" });
            else if (v === "grid")
              insp.set({
                display: "grid",
                flexDirection: null,
                gridTemplateColumns: GRID_DEFAULT_COLUMNS,
              });
            else insp.set({ display: "block", flexDirection: null });
          }}
        />
      </Grp>

      <Grp label={tr("サイズ")} props={["width", "height", "flexGrow"]} onReset={() => insp.set({ width: null, height: null, flexGrow: null, flexShrink: null, flexBasis: null })}>
        <div className="grid2t">
          <MainSizeField prop="width" pre="W" axis={parentDir === "row" ? "main" : "cross"} />
          <MainSizeField prop="height" pre="H" axis={parentDir === "column" ? "main" : "cross"} />
          <button
            className={`icon-btn${sizeDetail ? " is-on" : ""}${sizeLimitState}`}
            data-tip={tr("最小・最大サイズと縦横比")}
            onClick={() => setSizeDetail(!sizeDetail)}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </Grp>

      {sizeDetail && (
        <>
          <div className="grid2">
            <Grp label={tr("最小幅")} props={["minWidth"]}>
              <PropNum prop="minWidth" pre="W" units={["px", "%"]} scrubFrom={() => selectedSize("w")} />
            </Grp>
            <Grp label={tr("最大幅")} props={["maxWidth"]}>
              <PropNum prop="maxWidth" pre="W" units={["px", "%"]} scrubFrom={() => selectedSize("w")} />
            </Grp>
            <Grp label={tr("最小高さ")} props={["minHeight"]}>
              <PropNum prop="minHeight" pre="H" units={["px", "%"]} scrubFrom={() => selectedSize("h")} />
            </Grp>
            <Grp label={tr("最大高さ")} props={["maxHeight"]}>
              <PropNum prop="maxHeight" pre="H" units={["px", "%"]} scrubFrom={() => selectedSize("h")} />
            </Grp>
          </div>
          <Grp
            label={tr("縦横比")}
            setHere={insp.get("aspectRatio").changed}
            onReset={() => insp.set({ aspectRatio: null })}
          >
            <TextField
              value={insp.get("aspectRatio").value}
              placeholder={tr("例: 16 / 9")}
              onChange={(v) =>
                // パソコン幅以外で消したときは、大きい画面の縦横比を受け継がず「なし」にする
                insp.set({ aspectRatio: v || insp.cleared("aspectRatio") })
              }
            />
          </Grp>
        </>
      )}

      {isFlex && (
        <div className="grid2" style={{ alignItems: "start" }}>
          <Grp
            label={tr("配置")}
            setHere={insp.get("alignItems").changed || (insp.get("justifyContent").changed && !spaceBetween)}
            onReset={() =>
              insp.set({ alignItems: null, ...(spaceBetween ? {} : { justifyContent: null }) })
            }
          >
            <AlignGrid isColumn={dir === "column"} />
          </Grp>
          <div className="stack" style={{ gap: 10 }}>
            <Grp
              label={tr("間隔")}
              setHere={insp.get("gap").changed || (spaceBetween && insp.get("justifyContent").changed)}
              onReset={() =>
                insp.set({
                  gap: null,
                  ...(spaceBetween ? { justifyContent: null } : {}),
                })
              }
            >
              <div style={{ display: "flex", gap: 4 }}>
                <NumField
                  value={spaceBetween ? undefined : insp.get("gap").value}
                  units={["px"]}
                  min={0}
                  placeholder={spaceBetween ? tr("自動") : "0"}
                  pre={
                    dir === "column" ? (
                      <UnfoldVertical size={I} />
                    ) : (
                      <UnfoldHorizontal size={I} />
                    )
                  }
                  onChange={(v) => {
                    const props: Record<string, string | null> = { gap: v };
                    // 数値を入れたら「自動（均等配置）」は解除する
                    if (spaceBetween) props.justifyContent = unsetSpace();
                    insp.set(props);
                  }}
                />
                <button
                  className={`icon-btn${spaceBetween ? " is-on" : ""}`}
                  data-tip={tr("自動（両端に寄せて均等に配置）")}
                  onClick={() =>
                    insp.set(
                      spaceBetween
                        ? { justifyContent: unsetSpace() }
                        : { justifyContent: "space-between", gap: null }
                    )
                  }
                >
                  {dir === "column" ? (
                    <AlignVerticalSpaceBetween size={13} />
                  ) : (
                    <AlignHorizontalSpaceBetween size={13} />
                  )}
                </button>
              </div>
            </Grp>
            {dir === "row" && (
              <StyleCheck prop="flexWrap" label={tr("折り返す")} on="wrap" off="nowrap" />
            )}
          </div>
        </div>
      )}

      {isGrid && (
        <>
          <div className="grid2">
            <Grp
              label={tr("列")}
              // グリッドを選んだときに入る2列とは比べない（上位が未設定なら2列と比べる）
              setHere={differsFrom(insp.get("gridTemplateColumns"), GRID_DEFAULT_COLUMNS)}
              onReset={() => insp.set({ gridTemplateColumns: null })}
            >
              <NumField
                value={colsMatch ? colsMatch[1] : undefined}
                units={[""]}
                min={1}
                max={12}
                placeholder="1"
                onChange={(v) => {
                  const n = v
                    ? Math.max(1, Math.round(parseNumeric(v)?.num ?? 2))
                    : null;
                  insp.set({
                    gridTemplateColumns: n ? `repeat(${n}, 1fr)` : insp.cleared("gridTemplateColumns"),
                  });
                }}
              />
            </Grp>
            <Grp label={tr("行")} props={["gridTemplateRows"]}>
              <NumField
                value={rowsMatch ? rowsMatch[1] : undefined}
                units={[""]}
                min={1}
                max={12}
                placeholder={tr("自動")}
                onChange={(v) => {
                  const n = v
                    ? Math.max(1, Math.round(parseNumeric(v)?.num ?? 1))
                    : null;
                  insp.set({ gridTemplateRows: n ? `repeat(${n}, 1fr)` : insp.cleared("gridTemplateRows") });
                }}
              />
            </Grp>
          </div>
          <GridGap />
          <div className="grid2">
            <Grp label={tr("セル内の横揃え")} props={["justifyItems"]}>
              <PropSelect
                prop="justifyItems"
                unsetLabel={tr("伸ばす")}
                options={[
                  { label: tr("左"), value: "start", icon: <AlignLeft size={13} /> },
                  {
                    label: tr("中央"),
                    value: "center",
                    icon: <AlignCenter size={13} />,
                  },
                  { label: tr("右"), value: "end", icon: <AlignRight size={13} /> },
                ]}
              />
            </Grp>
            <Grp label={tr("セル内の縦揃え")} props={["alignItems"]}>
              <PropSelect
                prop="alignItems"
                unsetLabel={tr("伸ばす")}
                options={[
                  {
                    label: tr("上"),
                    value: "start",
                    icon: <AlignStartHorizontal size={13} />,
                  },
                  {
                    label: tr("中央"),
                    value: "center",
                    icon: <AlignCenterHorizontal size={13} />,
                  },
                  {
                    label: tr("下"),
                    value: "end",
                    icon: <AlignEndHorizontal size={13} />,
                  },
                ]}
              />
            </Grp>
          </div>
        </>
      )}

      <Grp
        label={tr("はみ出し")}
        setHere={overflowChanged}
        onReset={() => insp.set({ overflow: null })}
      >
        <PropSeg
          prop="overflow"
          options={[
            { label: trc("はみ出し", "表示"), value: "visible" },
            { label: trc("はみ出し", "隠す"), value: "hidden" },
            { label: tr("スクロール"), value: "auto" },
          ]}
        />
      </Grp>
    </Sec>
  );
}

/* ---------- グリッドの間隔（横 = 列の間 / 縦 = 行の間） ---------- */

function GridGap() {
  const insp = useInspector();
  const gap = insp.get("gap");
  const col = insp.get("columnGap");
  const row = insp.get("rowGap");
  // gap は「縦 横」または1つの値
  const gapPart = (i: 0 | 1) => {
    const parts = gap.value?.trim().split(/\s+/);
    return parts ? parts[Math.min(i, parts.length - 1)] : undefined;
  };
  // 個別指定とまとめ指定は、カスケードで後から効く方を見せる
  const rowValue = row.layer >= gap.layer ? (row.value ?? gapPart(0)) : (gapPart(0) ?? row.value);
  const colValue = col.layer >= gap.layer ? (col.value ?? gapPart(1)) : (gapPart(1) ?? col.value);

  const write = (patch: { rowGap?: string | null; columnGap?: string | null }) => {
    const out: Record<string, string | null> = {};
    // まとめ指定 gap がこの画面幅にあれば、個別指定に置き換える（同じルール内での上書き順を避ける）
    if (gap.setHere) {
      out.rowGap = row.setHere ? row.value ?? null : gapPart(0) ?? null;
      out.columnGap = col.setHere ? col.value ?? null : gapPart(1) ?? null;
      out.gap = null;
    }
    Object.assign(out, patch);
    insp.set(out);
  };

  const tint = (p: typeof row): React.CSSProperties => ({
    ["--field" as string]:
      gap.changed || p.changed ? "var(--field-set)" : "var(--field-base)",
  });

  return (
    <Grp
      label={tr("間隔")}
      setHere={gap.changed || col.changed || row.changed}
      onReset={() => insp.set({ gap: null, rowGap: null, columnGap: null })}
    >
      <div className="grid2">
        <div style={tint(col)}>
          <NumField
            value={colValue}
            placeholder="0"
            pre={<UnfoldHorizontal size={I} />}
            title={tr("列の間隔（横）")}
            units={["px"]}
            min={0}
            onChange={(v) => write({ columnGap: v })}
          />
        </div>
        <div style={tint(row)}>
          <NumField
            value={rowValue}
            placeholder="0"
            pre={<UnfoldVertical size={I} />}
            title={tr("行の間隔（縦）")}
            units={["px"]}
            min={0}
            onChange={(v) => write({ rowGap: v })}
          />
        </div>
      </div>
    </Grp>
  );
}
