"use client";

/**
 * 効果（影・変形・フィルター・重ね方）
 */

import { useState } from "react";
import {
  Blend,
  Droplet,
  Droplets,
  MoveHorizontal,
  MoveVertical,
  Move,
  Plus,
  RotateCw,
  SquareDashed,
  TextCursor,
  Trash2,
  UnfoldHorizontal,
  UnfoldVertical,
} from "lucide-react";
import {
  parseFilter,
  parseNumeric,
  parseTransform,
  serializeFilter,
  serializeTransform,
  splitTopLevel,
  isInitialValue,
  type FilterParts,
  type TransformParts,
} from "../../lib/style";
import {
  Dropdown,
  FillControl,
  Grp,
  InfoTip,
  NumField,
  PropSelect,
  useInspector,
} from "../controls";
import { tr } from "../../lib/i18n";
import { I, Sec } from "./shared";

/* ---------- エフェクト ---------- */

interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

function parseShadow(s: string): Shadow {
  const inset = s.includes("inset");
  const rest = s.replace("inset", "").trim();
  const nums = [...rest.matchAll(/(-?\d*\.?\d+)px/g)].map((m) => +m[1]);
  const color =
    rest.replace(/(-?\d*\.?\d+)px/g, "").trim() || "rgba(0, 0, 0, 0.15)";
  return {
    inset,
    x: nums[0] ?? 0,
    y: nums[1] ?? 4,
    blur: nums[2] ?? 12,
    spread: nums[3] ?? 0,
    color,
  };
}

function serializeShadow(sh: Shadow): string {
  return `${sh.inset ? "inset " : ""}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread}px ${sh.color}`;
}

function serializeTextShadow(sh: Shadow): string {
  return `${sh.x}px ${sh.y}px ${sh.blur}px ${sh.color}`;
}

function ShadowCard({
  shadow,
  kind,
  onChange,
  onDelete,
  onToggleInset,
  onChangeStart,
}: {
  shadow: Shadow;
  kind: "drop" | "text";
  onChange: (patch: Partial<Shadow>, transient?: boolean) => void;
  onDelete: () => void;
  onToggleInset?: () => void;
  onChangeStart: () => void;
}) {
  const fields = kind === "drop" ? (["x", "y", "blur", "spread"] as const) : (["x", "y", "blur"] as const);
  return (
    <div className="fx-card">
      <div className="fx-head">
        <span className="fx-label">
          {kind === "text"
            ? tr("テキストシャドウ")
            : shadow.inset
              ? tr("内側シャドウ")
              : tr("ドロップシャドウ")}
        </span>
        {kind === "drop" && (
          <button
            className="icon-btn sm"
            data-tip={shadow.inset ? tr("外側にする") : tr("内側にする")}
            onClick={onToggleInset}
          >
            <Blend size={12} />
          </button>
        )}
        <button className="icon-btn sm" data-tip={tr("削除")} onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className={kind === "drop" ? "grid4" : "grid3"}>
        {fields.map((key) => (
          <NumField
            key={key}
            value={`${shadow[key]}px`}
            units={["px"]}
            pre={{ x: "X", y: "Y", blur: "B", spread: "S" }[key]}
            title={{ x: "X", y: "Y", blur: tr("ぼかし"), spread: tr("広がり") }[key]}
            onChange={(value) =>
              onChange({ [key]: value ? (parseNumeric(value)?.num ?? 0) : 0 })
            }
          />
        ))}
      </div>
      <FillControl
        value={shadow.color}
        allowClear={false}
        onChange={(value) => value && onChange({ color: value })}
        onChangeStart={onChangeStart}
        onChangeTransient={(value) => value && onChange({ color: value }, true)}
      />
    </div>
  );
}

/** フィルタ各項目のフィールド定義 */
const FILTER_FIELDS: {
  key: keyof FilterParts;
  label: string;
  unit: string;
  def: number;
  min?: number;
  max?: number;
}[] = [
  { key: "brightness", label: tr("明るさ"), unit: "%", def: 100, min: 0 },
  { key: "contrast", label: tr("コントラスト"), unit: "%", def: 100, min: 0 },
  { key: "saturate", label: tr("彩度"), unit: "%", def: 100, min: 0 },
  { key: "grayscale", label: tr("グレースケール"), unit: "%", def: 0, min: 0, max: 100 },
  { key: "sepia", label: tr("セピア"), unit: "%", def: 0, min: 0, max: 100 },
  { key: "hueRotate", label: tr("色相回転"), unit: "deg", def: 0 },
];

const BLEND_MODES: { value: string; label: string }[] = [
  { value: "multiply", label: tr("乗算") },
  { value: "screen", label: tr("スクリーン") },
  { value: "overlay", label: tr("オーバーレイ") },
  { value: "darken", label: tr("比較（暗）") },
  { value: "lighten", label: tr("比較（明）") },
  { value: "difference", label: tr("差の絶対値") },
  { value: "exclusion", label: tr("除外") },
  { value: "luminosity", label: tr("輝度") },
];

/** 変形の基準点（transform-origin）。3×3 の位置（左上から右下へ） */
const ORIGINS: { value: string; label: string }[] = [
  { value: "top left", label: tr("左上") },
  { value: "top", label: tr("上中央") },
  { value: "top right", label: tr("右上") },
  { value: "left", label: tr("左中央") },
  { value: "center", label: tr("中央") },
  { value: "right", label: tr("右中央") },
  { value: "bottom left", label: tr("左下") },
  { value: "bottom", label: tr("下中央") },
  { value: "bottom right", label: tr("右下") },
];

/** 「50% 0%」「center top」などの書き方を、3×3 のどこかにそろえる（当てはまらなければ null） */
function originCell(v: string | undefined): string | null {
  if (!v || !v.trim()) return "center";
  const word = (t: string) =>
    ({ "0%": "start", left: "start", top: "start", "50%": "mid", center: "mid", "100%": "end", right: "end", bottom: "end" })[t];
  const parts = v.trim().toLowerCase().split(/\s+/);
  let x = "mid";
  let y = "mid";
  if (parts.length === 1) {
    if (parts[0] === "top" || parts[0] === "bottom") y = word(parts[0])!;
    else if (word(parts[0])) x = word(parts[0])!;
    else return null;
  } else {
    // 「top left」のように縦が先でも読む
    const [a, b] = parts[0] === "top" || parts[0] === "bottom" || parts[1] === "left" || parts[1] === "right" ? [parts[1], parts[0]] : [parts[0], parts[1]];
    if (!word(a) || !word(b)) return null;
    x = word(a)!;
    y = word(b)!;
  }
  const xs = { start: "left", mid: "", end: "right" }[x];
  const ys = { start: "top", mid: "", end: "bottom" }[y];
  return [ys, xs].filter(Boolean).join(" ") || "center";
}

function OriginGrid() {
  const insp = useInspector();
  const cur = originCell(insp.get("transformOrigin").value);
  return (
    <div className="align-grid origin-grid" role="radiogroup" aria-label={tr("基準点")}>
      {ORIGINS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={cur === o.value}
          className={cur === o.value ? "is-on" : ""}
          data-tip={o.label}
          // 中央は既定なので、選ぶと設定を外す
          onClick={() => insp.set({ transformOrigin: o.value === "center" ? null : o.value })}
        />
      ))}
    </div>
  );
}

/** 変形（transform）: 移動・回転・拡大・傾きと基準点。まわりの配置は変えずに見た目だけ動かす */
function TransformCard({ onDelete }: { onDelete: () => void }) {
  const insp = useInspector();
  const info = insp.get("transform");
  const tf = parseTransform(info.value);
  const ref = parseTransform(info.reference);
  const set = (patch: Partial<TransformParts>) =>
    insp.set({ transform: serializeTransform({ ...tf, ...patch }) ?? insp.cleared("transform") });
  const changed = (key: keyof TransformParts) => info.setHere && tf[key] !== ref[key];
  const len = (v: string) => (parseFloat(v) === 0 ? undefined : v);
  const pct = (n: number) => (n === 1 ? undefined : `${Math.round(n * 1000) / 10}%`);
  const deg = (n: number) => (n === 0 ? undefined : `${n}deg`);
  const num = (v: string | null, fallback: number) => (v ? (parseNumeric(v)?.num ?? fallback) : fallback);
  return (
    <div className="fx-card">
      <div className="fx-head">
        <span className="fx-label">{tr("変形")}</span>
        <InfoTip
          text={tr("見た目だけを動かす・回す・拡大する・傾けます（まわりの要素の配置は変わりません）。ホバー時などの状態で変えて、モーションの「状態の変化」と組み合わせるとアニメーションになります。")}
        />
        <button className="icon-btn sm" data-tip={tr("削除")} onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className="grid2">
        <Grp label={tr("移動 X")} setHere={changed("x")} onReset={() => set({ x: ref.x })}>
          <NumField
            value={len(tf.x)}
            units={["px", "%", "em"]}
            placeholder="0"
            pre={<MoveHorizontal size={I} />}
            onChange={(v) => set({ x: v || "0px" })}
          />
        </Grp>
        <Grp label={tr("移動 Y")} setHere={changed("y")} onReset={() => set({ y: ref.y })}>
          <NumField
            value={len(tf.y)}
            units={["px", "%", "em"]}
            placeholder="0"
            pre={<MoveVertical size={I} />}
            onChange={(v) => set({ y: v || "0px" })}
          />
        </Grp>
        <Grp label={tr("拡大 横")} setHere={changed("scaleX")} onReset={() => set({ scaleX: ref.scaleX })}>
          <NumField
            value={pct(tf.scaleX)}
            units={["%"]}
            placeholder="100"
            pre={<UnfoldHorizontal size={I} />}
            onChange={(v) => set({ scaleX: num(v, 100) / 100 })}
          />
        </Grp>
        <Grp label={tr("拡大 縦")} setHere={changed("scaleY")} onReset={() => set({ scaleY: ref.scaleY })}>
          <NumField
            value={pct(tf.scaleY)}
            units={["%"]}
            placeholder="100"
            pre={<UnfoldVertical size={I} />}
            onChange={(v) => set({ scaleY: num(v, 100) / 100 })}
          />
        </Grp>
        <Grp label={tr("回転")} setHere={changed("rotate")} onReset={() => set({ rotate: ref.rotate })}>
          <NumField
            value={deg(tf.rotate)}
            units={["deg"]}
            placeholder="0"
            pre={<RotateCw size={I} />}
            onChange={(v) => set({ rotate: num(v, 0) })}
          />
        </Grp>
        <Grp
          label={tr("基準点")}
          info={tr("回転・拡大・傾きの中心になる位置です。")}
          setHere={insp.get("transformOrigin").changed}
          onReset={() => insp.set({ transformOrigin: null })}
        >
          <OriginGrid />
        </Grp>
        <Grp label={tr("傾き 横")} setHere={changed("skewX")} onReset={() => set({ skewX: ref.skewX })}>
          <NumField value={deg(tf.skewX)} units={["deg"]} placeholder="0" pre="X" onChange={(v) => set({ skewX: num(v, 0) })} />
        </Grp>
        <Grp label={tr("傾き 縦")} setHere={changed("skewY")} onReset={() => set({ skewY: ref.skewY })}>
          <NumField value={deg(tf.skewY)} units={["deg"]} placeholder="0" pre="Y" onChange={(v) => set({ skewY: num(v, 0) })} />
        </Grp>
      </div>
      {tf.rest && (
        <p className="hint" style={{ margin: 0 }}>
          {tr("ほかの変形（{rest}）もそのまま残ります。", { rest: tf.rest })}
        </p>
      )}
    </div>
  );
}

export function EffectsSec() {
  const insp = useInspector();
  // 「none」（小さい画面で影を打ち消した値）は影なしとして扱う
  const shadowList = (raw: string | undefined) =>
    raw && !isInitialValue("boxShadow", raw) ? splitTopLevel(raw).map(parseShadow) : [];
  const dropShadows = shadowList(insp.get("boxShadow").value);
  const textShadows = shadowList(insp.get("textShadow").value);

  const commitDrop = (list: Shadow[]) =>
    insp.set({
      boxShadow: list.length ? list.map(serializeShadow).join(", ") : insp.cleared("boxShadow"),
    });
  const commitDropTransient = (list: Shadow[]) =>
    insp.setTransient({
      boxShadow: list.length ? list.map(serializeShadow).join(", ") : insp.cleared("boxShadow"),
    });
  const commitText = (list: Shadow[]) =>
    insp.set({
      textShadow: list.length ? list.map(serializeTextShadow).join(", ") : insp.cleared("textShadow"),
    });
  const commitTextTransient = (list: Shadow[]) =>
    insp.setTransient({
      textShadow: list.length ? list.map(serializeTextShadow).join(", ") : insp.cleared("textShadow"),
    });

  const filterInfo = insp.get("filter");
  const f = parseFilter(filterInfo.value);
  /** 比べる相手（大きい画面・通常時）のフィルタ。項目ごとの変更の色に使う */
  const fBase = parseFilter(filterInfo.baseline);
  const filterChanged = (key: keyof FilterParts) => filterInfo.setHere && f[key] !== fBase[key];
  const setFilter = (patch: Partial<FilterParts>) =>
    insp.set({ filter: serializeFilter({ ...f, ...patch }) ?? insp.cleared("filter") });

  const bdVal = insp.get("backdropFilter").value;
  const bdM = bdVal ? /blur\((\d*\.?\d+)px\)/.exec(bdVal) : null;

  // 変形: 設定済みか、「＋」から足したときに出す
  const tfSet = !!serializeTransform(parseTransform(insp.get("transform").value)) || insp.get("transformOrigin").set;
  const [tfAdded, setTfAdded] = useState(false);

  const anySet =
    dropShadows.length > 0 ||
    textShadows.length > 0 ||
    tfSet ||
    tfAdded ||
    filterInfo.set ||
    insp.get("backdropFilter").set ||
    insp.get("mixBlendMode").set;

  return (
    <Sec
      title={tr("エフェクト")}
      defaultOpen={anySet}
      tutorialTarget="style-effects"
      help="look-effects"
      tools={
        <Dropdown
          value={undefined}
          menuWidth={220}
          title={tr("エフェクトを追加")}
          trigger={<Plus size={13} />}
          options={[
            {
              value: "drop",
              label: tr("ドロップシャドウ"),
              desc: tr("要素の形に沿って影を付けます"),
              icon: <SquareDashed size={13} />,
            },
            {
              value: "text",
              label: tr("テキストシャドウ"),
              desc: tr("文字の形に沿って影を付けます"),
              icon: <TextCursor size={13} />,
            },
            ...(tfSet || tfAdded
              ? []
              : [
                  {
                    value: "transform",
                    label: tr("変形"),
                    desc: tr("移動・拡大・回転・傾き（transform）"),
                    icon: <Move size={13} />,
                  },
                ]),
          ]}
          onChange={(value) => {
            if (value === "transform") {
              setTfAdded(true);
            } else if (value === "text") {
              commitText([
                ...textShadows,
                {
                  inset: false,
                  x: 0,
                  y: 2,
                  blur: 4,
                  spread: 0,
                  color: "rgba(0, 0, 0, 0.25)",
                },
              ]);
            } else {
              commitDrop([
                ...dropShadows,
                {
                  inset: false,
                  x: 0,
                  y: 4,
                  blur: 16,
                  spread: 0,
                  color: "rgba(0, 0, 0, 0.12)",
                },
              ]);
            }
          }}
        />
      }
    >
      {dropShadows.map((shadow, index) => (
        <ShadowCard
          key={`drop-${index}`}
          shadow={shadow}
          kind="drop"
          onDelete={() => commitDrop(dropShadows.filter((_, i) => i !== index))}
          onToggleInset={() => {
            const next = [...dropShadows];
            next[index] = { ...shadow, inset: !shadow.inset };
            commitDrop(next);
          }}
          onChange={(patch, transient) => {
            const next = [...dropShadows];
            next[index] = { ...shadow, ...patch };
            if (transient) commitDropTransient(next);
            else commitDrop(next);
          }}
          onChangeStart={insp.checkpoint}
        />
      ))}
      {textShadows.map((shadow, index) => (
        <ShadowCard
          key={`text-${index}`}
          shadow={shadow}
          kind="text"
          onDelete={() => commitText(textShadows.filter((_, i) => i !== index))}
          onChange={(patch, transient) => {
            const next = [...textShadows];
            next[index] = { ...shadow, ...patch };
            if (transient) commitTextTransient(next);
            else commitText(next);
          }}
          onChangeStart={insp.checkpoint}
        />
      ))}
      {(tfSet || tfAdded) && (
        <TransformCard
          onDelete={() => {
            setTfAdded(false);
            insp.set({ transform: insp.cleared("transform"), transformOrigin: null });
          }}
        />
      )}

      <div className="grid2">
        <Grp
          label={tr("ぼかし")}
          setHere={filterChanged("blur")}
          onReset={() => setFilter({ blur: fBase.blur })}
        >
          <NumField
            value={f.blur > 0 ? `${f.blur}px` : undefined}
            units={["px"]}
            min={0}
            placeholder="0"
            pre={<Droplet size={I} />}
            onChange={(v) =>
              setFilter({ blur: v ? Math.max(0, parseNumeric(v)?.num ?? 0) : 0 })
            }
          />
        </Grp>
        <Grp
          label={tr("背景ぼかし")}
          setHere={insp.get("backdropFilter").changed}
          onReset={() => insp.set({ backdropFilter: null })}
        >
          <NumField
            value={bdM ? `${bdM[1]}px` : undefined}
            units={["px"]}
            min={0}
            placeholder="0"
            pre={<Droplets size={I} />}
            onChange={(v) =>
              insp.set({
                backdropFilter:
                  v && parseNumeric(v)!.num > 0
                    ? `blur(${parseNumeric(v)!.num}px)`
                    : insp.cleared("backdropFilter"),
              })
            }
          />
        </Grp>
        {FILTER_FIELDS.map((ff) => (
          <Grp
            key={ff.key}
            label={ff.label}
            setHere={filterChanged(ff.key)}
            onReset={() => setFilter({ [ff.key]: fBase[ff.key] })}
          >
            <NumField
              value={f[ff.key] !== ff.def ? `${f[ff.key]}${ff.unit}` : undefined}
              units={[ff.unit]}
              min={ff.min}
              max={ff.max}
              placeholder={String(ff.def)}
              onChange={(v) =>
                setFilter({
                  [ff.key]: v ? (parseNumeric(v)?.num ?? ff.def) : ff.def,
                })
              }
            />
          </Grp>
        ))}
      </div>

      <Grp
        label={tr("ブレンドモード")}
        info={tr("後ろにある要素（背景色・画像など）と色を混ぜ合わせます。")}
        setHere={insp.get("mixBlendMode").changed}
        onReset={() => insp.set({ mixBlendMode: null })}
      >
        <PropSelect prop="mixBlendMode" unsetLabel={tr("通常")} options={BLEND_MODES} />
      </Grp>
    </Sec>
  );
}
