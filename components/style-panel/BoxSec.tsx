"use client";

/**
 * 画像・余白・見た目（角丸・不透明度など）・選択時の見た目
 */

import { useState } from "react";
import {
  Ban,
  Blend,
  Copy as CopyIcon,
  Crosshair,
  EyeOff,
  Grab,
  HelpCircle,
  Hourglass,
  MousePointer2,
  Move,
  Pointer,
  Scan,
  TextCursor,
  UnfoldHorizontal,
  UnfoldVertical,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEditor } from "../../lib/store";
import { parseNumeric, isInitialValue } from "../../lib/style";
import {
  Dropdown,
  Grp,
  NumField,
  PropFill,
  PropNum,
  PropSelect,
  Seg,
  shorthandSide,
  useInspector,
} from "../controls";
import { tr } from "../../lib/i18n";
import { StyleCheck } from "./BackgroundSec";
import { useHiddenState } from "./PositionSec";
import { I, Sec } from "./shared";

/* ---------- 画像（縦横比・切り抜き方） ---------- */

const ASPECT_PRESETS = [
  { value: "1 / 1", label: tr("1:1（正方形）") },
  { value: "4 / 3", label: "4:3" },
  { value: "3 / 2", label: "3:2" },
  { value: "16 / 9", label: tr("16:9（横長）") },
  { value: "3 / 4", label: tr("3:4（縦長）") },
  { value: "2 / 3", label: tr("2:3（縦長）") },
];

/** "16/9" と "16 / 9" を同じものとして比べる */
const ratioKey = (v: string | undefined) => (v ?? "").replace(/\s+/g, "");

const OBJECT_POSITIONS = [
  { value: "top", label: tr("上") },
  { value: "bottom", label: tr("下") },
  { value: "left", label: tr("左") },
  { value: "right", label: tr("右") },
  { value: "left top", label: tr("左上") },
  { value: "right top", label: tr("右上") },
];

/** 画像・動画を枠にどう収めるか。比率の違う写真を同じ形にそろえるときに使う */
export function ImageSec() {
  const insp = useInspector();
  const fit = insp.get("objectFit");
  const ratio = insp.get("aspectRatio");
  // 画像の初期値（CSS の fill）は、枠に合わせてゆがめる
  const fitValue = fit.value ?? "fill";
  const preset = ASPECT_PRESETS.find((p) => ratioKey(p.value) === ratioKey(ratio.value));

  return (
    <Sec title={tr("画像")} tutorialTarget="style-image" help="img-fit">
      <Grp
        label={tr("縦横比")}
        setHere={ratio.changed}
        onReset={() => insp.set({ aspectRatio: null })}
      >
        <Dropdown
          value={ratio.value ? (preset?.value ?? ratio.value) : ""}
          options={[
            { value: "", label: tr("元の比率") },
            ...ASPECT_PRESETS,
            ...(ratio.value && !preset ? [{ value: ratio.value, label: tr("{value}（カスタム）", { value: ratio.value }) }] : []),
          ]}
          onChange={(v) => {
            const props: Record<string, string | null> = {
              aspectRatio: v || insp.cleared("aspectRatio"),
            };
            if (v) {
              // 高さが決まっていると比率が効かないので外し、ゆがまないよう枠を埋める切り抜きにする
              if (insp.get("height").value && insp.get("height").value !== "auto") {
                props.height = insp.cleared("height");
              }
              if (!fit.value || fit.value === "fill") props.objectFit = "cover";
            }
            insp.set(props);
          }}
        />
      </Grp>
      <Grp
        label={tr("切り抜き方")}
        setHere={fit.changed}
        onReset={() => insp.set({ objectFit: null, objectPosition: null })}
      >
        <Seg
          value={fitValue}
          options={[
            { label: tr("枠を埋める"), value: "cover", title: tr("はみ出した部分を切り取って、枠いっぱいに表示します（写真向け）") },
            { label: tr("全体を表示"), value: "contain", title: tr("画像全体が枠に収まるように表示します（ロゴ向け）") },
            { label: tr("引き伸ばす"), value: "fill", title: tr("枠に合わせて縦横を引き伸ばします") },
          ]}
          onChange={(v) => insp.set({ objectFit: v === "fill" ? insp.cleared("objectFit") : v })}
        />
      </Grp>
      {fitValue !== "fill" && (
        <Grp label={tr("見せる位置")} props={["objectPosition"]}>
          <PropSelect prop="objectPosition" unsetLabel={tr("中央")} options={OBJECT_POSITIONS} />
        </Grp>
      )}
    </Sec>
  );
}

/* ---------- 余白（横 / 縦 + 個別展開） ---------- */

function PairSides({
  label,
  shorthand,
  props,
  min,
}: {
  /** ドラッグ・入力の下限（内側余白は 0。外側余白は負の値も使える） */
  min?: number;
  label: string;
  /** 例: "padding" */
  shorthand: string;
  /** 上・右・下・左の順 */
  props: [string, string, string, string];
}) {
  const insp = useInspector();
  const sh = insp.get(shorthand);
  /** 辺ごとの実効値（個別指定とまとめ指定は、カスケードで後から効く方） */
  const side = (i: number) => {
    const long = insp.get(props[i]);
    return long.layer >= sh.layer
      ? (long.value ?? shorthandSide(sh.value, i))
      : (shorthandSide(sh.value, i) ?? long.value);
  };
  /** 2辺が同じ値か（未設定と 0 は同じとみなす） */
  const same = (a: string | undefined, b: string | undefined) =>
    a === b || (isInitialValue(shorthand, a) && isInitialValue(shorthand, b));
  const anySet = sh.changed || props.some((p) => insp.get(p).changed);
  const [expanded, setExpanded] = useState(false);

  const write = (patch: Record<number, string | null>) => {
    const out: Record<string, string | null> = {};
    if (sh.setHere) {
      for (let i = 0; i < 4; i++) {
        out[props[i]] = shorthandSide(sh.value, i) ?? "0px";
      }
      out[shorthand] = null;
    }
    for (const [k, v] of Object.entries(patch)) out[props[+k]] = v;
    insp.set(out);
  };

  const reset = () => {
    const out: Record<string, string | null> = { [shorthand]: null };
    for (const p of props) out[p] = null;
    insp.set(out);
  };

  const pairValue = (a: number, b: number) => {
    const va = side(a);
    const vb = side(b);
    return same(va, vb) ? (va ?? vb) : undefined;
  };
  /** 欄ごとの「変更済み」の色（まとめ欄は、どちらかの辺かまとめ指定が変わっていれば） */
  const fieldTint = (...sides: number[]): React.CSSProperties => ({
    ["--field" as string]:
      sh.changed || sides.some((i) => insp.get(props[i]).changed)
        ? "var(--field-set)"
        : "var(--field-base)",
  });
  const pairPlaceholder = (a: number, b: number) => (same(side(a), side(b)) ? "0" : tr("混在"));

  const LABELS = [tr("上"), tr("右"), tr("下"), tr("左")];
  /** まとめ欄では見えない、辺ごとに違う値がある */
  const smaller = useEditor((s) => s.breakpoint !== "base");
  const mixed = !same(side(1), side(3)) || !same(side(0), side(2));
  const sidesState = !mixed ? "" : anySet ? " is-set" : smaller ? " has-value" : "";

  return (
    <Grp label={label} setHere={anySet} onReset={reset}>
      {!expanded ? (
        <div className="grid2t">
          <div style={fieldTint(1, 3)}>
          <NumField
            value={pairValue(3, 1)}
            placeholder={pairPlaceholder(3, 1)}
            pre={<UnfoldHorizontal size={I} />}
            title={tr("左右")}
            units={["px"]}
            min={min}
            onChange={(v) => write({ 1: v, 3: v })}
          />
          </div>
          <div style={fieldTint(0, 2)}>
          <NumField
            value={pairValue(0, 2)}
            placeholder={pairPlaceholder(0, 2)}
            pre={<UnfoldVertical size={I} />}
            title={tr("上下")}
            units={["px"]}
            min={min}
            onChange={(v) => write({ 0: v, 2: v })}
          />
          </div>
          <button
            className={`icon-btn${sidesState}`}
            data-tip={tr("4方向を個別に設定")}
            onClick={() => setExpanded(true)}
          >
            <Scan size={13} />
          </button>
        </div>
      ) : (
        <div className="grid2t" style={{ gridTemplateColumns: "1fr 1fr 28px" }}>
          <div className="grid4" style={{ gridColumn: "1 / 3" }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={props[i]} style={fieldTint(i)}>
              <NumField
                value={side(i)}
                pre={LABELS[i]}
                units={["px"]}
                min={min}
                placeholder="0"
                onChange={(v) => write({ [i]: v })}
              />
              </div>
            ))}
          </div>
          <button
            className="icon-btn is-on"
            data-tip={tr("まとめて設定に戻す")}
            onClick={() => setExpanded(false)}
            style={{ alignSelf: "start" }}
          >
            <Scan size={13} />
          </button>
        </div>
      )}
    </Grp>
  );
}

export function SpacingSec() {
  return (
    <Sec title={tr("余白")} tutorialTarget="style-spacing" help="layout-spacing">
      <PairSides
        label={tr("内側余白")}
        shorthand="padding"
        min={0}
        props={["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]}
      />
      <PairSides
        label={tr("外側余白")}
        shorthand="margin"
        props={["marginTop", "marginRight", "marginBottom", "marginLeft"]}
      />
    </Sec>
  );
}

/* ---------- 外見 ---------- */

export function AppearanceSec() {
  const insp = useInspector();
  const [corners, setCorners] = useState(false);
  const opacity = insp.get("opacity");
  const radius = insp.get("borderRadius");
  const cornerProps = [
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomLeftRadius",
    "borderBottomRightRadius",
  ];
  const CORNER_PRE = ["⌜", "⌝", "⌞", "⌟"];
  const cornersState = useHiddenState(cornerProps);

  return (
    <Sec title={tr("外見")} tutorialTarget="style-appearance" help="look-radius">
      <div className="grid2t">
        <Grp
          label={tr("不透明度")}
          setHere={opacity.changed}
          onReset={() => insp.set({ opacity: null })}
        >
          <NumField
            value={
              opacity.value !== undefined
                ? `${Math.round(parseFloat(opacity.value) * 100)}%`
                : undefined
            }
            units={["%"]}
            min={0}
            max={100}
            placeholder="100"
            pre={<Blend size={I} />}
            onChange={(v) => {
              const n = v ? (parseNumeric(v)?.num ?? 100) : 100;
              insp.set({ opacity: n >= 100 ? insp.cleared("opacity") : String(n / 100) });
            }}
          />
        </Grp>
        <Grp
          label={tr("角の丸み")}
          setHere={radius.changed}
          onReset={() => {
            const out: Record<string, string | null> = { borderRadius: null };
            for (const p of cornerProps) out[p] = null;
            insp.set(out);
          }}
        >
          <PropNum
            prop="borderRadius"
            pre={<Scan size={I} />}
            units={["px"]}
            min={0}
            placeholder="0"
          />
        </Grp>
        <button
          className={`icon-btn${corners ? " is-on" : ""}${cornersState}`}
          data-tip={tr("4隅を個別に設定")}
          onClick={() => setCorners(!corners)}
          style={{ alignSelf: "end", marginBottom: 0 }}
        >
          <Scan size={13} />
        </button>
      </div>

      {corners && (
        <div className="grid4">
          {cornerProps.map((p, i) => (
            <PropNum
              key={p}
              prop={p}
              pre={CORNER_PRE[i]}
              units={["px"]}
              min={0}
              placeholder="0"
            />
          ))}
        </div>
      )}

    </Sec>
  );
}

/* ---------- 選択（カーソル / テキスト選択色） ---------- */

export function SelectionSec() {
  const insp = useInspector();
  const anySet =
    insp.get("cursor").set ||
    insp.get("selectionBackgroundColor").set ||
    insp.get("selectionColor").set ||
    insp.get("userSelect").set;

  return (
    <Sec title={tr("選択")} defaultOpen={anySet}>
      <div className="grid2">
        <Grp
          label={tr("カーソル")}
          setHere={insp.get("cursor").changed}
          onReset={() => insp.set({ cursor: null })}
        >
          <PropSelect
            prop="cursor"
            options={[
              {
                label: tr("default（矢印）"),
                value: "default",
                icon: <MousePointer2 size={13} />,
              },
              {
                label: tr("pointer（指）"),
                value: "pointer",
                icon: <Pointer size={13} />,
              },
              {
                label: tr("text（文字）"),
                value: "text",
                icon: <TextCursor size={13} />,
              },
              { label: tr("move（移動）"), value: "move", icon: <Move size={13} /> },
              { label: tr("grab（つかむ）"), value: "grab", icon: <Grab size={13} /> },
              {
                label: tr("grabbing（つかんでいる）"),
                value: "grabbing",
                icon: <Grab size={13} />,
              },
              {
                label: tr("crosshair（十字）"),
                value: "crosshair",
                icon: <Crosshair size={13} />,
              },
              {
                label: tr("zoom-in（拡大）"),
                value: "zoom-in",
                icon: <ZoomIn size={13} />,
              },
              {
                label: tr("zoom-out（縮小）"),
                value: "zoom-out",
                icon: <ZoomOut size={13} />,
              },
              {
                label: tr("help（ヘルプ）"),
                value: "help",
                icon: <HelpCircle size={13} />,
              },
              {
                label: tr("wait（待機）"),
                value: "wait",
                icon: <Hourglass size={13} />,
              },
              {
                label: tr("copy（コピー）"),
                value: "copy",
                icon: <CopyIcon size={13} />,
              },
              {
                label: tr("not-allowed（禁止）"),
                value: "not-allowed",
                icon: <Ban size={13} />,
              },
              {
                label: tr("none（非表示）"),
                value: "none",
                icon: <EyeOff size={13} />,
              },
            ]}
            menuWidth={200}
          />
        </Grp>
      </div>

      <PropFill
        label={tr("選択したときの背景色")}
        info={tr("テキストをドラッグして選択したときのハイライト色です。")}
        prop="selectionBackgroundColor"
      />
      <PropFill label={tr("選択したときの文字色")} prop="selectionColor" />
      <StyleCheck
        prop="userSelect"
        label={tr("文字を選択できないようにする")}
        on="none"
        off="auto"
      />
    </Sec>
  );
}
