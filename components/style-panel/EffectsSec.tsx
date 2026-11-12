"use client";

/**
 * 効果（影・変形・フィルター・重ね方）
 */

import { useState } from "react";
import { useEditor } from "../../lib/store";
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
import { editFilterFunction, filterFunctions } from "../../lib/filter-edit";
import { I, Sec } from "./shared";

/** 明示的な削除はリセットとは違う。既定や大きい画面の効果を、上書きを消して再び
 * 表示させるのではなく、この状態では無効にする。 */
function disabledEffect(insp: ReturnType<typeof useInspector>, prop: string): string | null {
  return isInitialValue(prop, insp.get(prop).baseline) ? null : "none";
}

/* ---------- エフェクト ---------- */

interface Shadow {
  inset: boolean;
  x: number | string;
  y: number | string;
  blur: number | string;
  spread: number | string;
  color: string;
}

export function parseShadow(s: string): Shadow {
  // 区切るのは色の関数の外側だけにする。単位の無い 0 は長さだが、
  // rgb() や color() の成分、var() や calc() の中の数値は長さではない。
  const tokens: string[] = [];
  let depth = 0, token = "";
  for (const ch of s.trim()) {
    if (/\s/.test(ch) && depth === 0) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += ch;
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
  }
  if (token) tokens.push(token);
  const nums: (number | string)[] = [];
  const colors: string[] = [];
  let inset = false;
  for (const part of tokens) {
    if (part.toLowerCase() === "inset") inset = true;
    else if (/^[+-]?(?:\d*\.)?\d+px$/i.test(part) || /^[+-]?(?:0*\.)?0+$/.test(part)) nums.push(parseFloat(part));
    // 相対的な長さや物理的な長さは、色の字句として扱わずにそのまま残す。
    // 色を編集したときに、em・rem・ビューポート基準の大きさを平らにしてはいけない。
    else if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px|em|rem|ex|rex|cap|rcap|ch|rch|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|[sld]v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|cm|mm|q|in|pt|pc)$/i.test(part) || /^(?:calc|min|max|clamp)\(/i.test(part)) nums.push(part);
    else colors.push(part);
  }
  return {
    inset,
    x: nums[0] ?? 0,
    y: nums[1] ?? 0,
    blur: nums[2] ?? 0,
    spread: nums[3] ?? 0,
    color: colors.join(" ") || "currentColor",
  };
}

function shadowLength(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

export function serializeShadow(sh: Shadow): string {
  return `${sh.inset ? "inset " : ""}${shadowLength(sh.x)} ${shadowLength(sh.y)} ${shadowLength(sh.blur)} ${shadowLength(sh.spread)} ${sh.color}`;
}

function serializeTextShadow(sh: Shadow): string {
  return `${shadowLength(sh.x)} ${shadowLength(sh.y)} ${shadowLength(sh.blur)} ${sh.color}`;
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
  onChangeStart: () => void | (() => void);
}) {
  const fields = kind === "drop" ? (["x", "y", "blur", "spread"] as const) : (["x", "y", "blur"] as const);
  return (
    <div className="fx-card">
      <div className="fx-head">
        <span className="fx-label">
          {kind === "text"
            ? tr("Text shadow")
            : shadow.inset
              ? tr("Inner shadow")
              : tr("Drop shadow")}
        </span>
        {kind === "drop" && (
          <button
            className="icon-btn sm"
            data-tip={shadow.inset ? tr("Make outer") : tr("Make inner")}
            onClick={onToggleInset}
          >
            <Blend size={12} />
          </button>
        )}
        <button className="icon-btn sm" data-tip={tr("Delete")} onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className={kind === "drop" ? "grid4" : "grid3"}>
        {fields.map((key) => (
          <NumField
            key={key}
            value={shadowLength(shadow[key])}
            units={["px"]}
            pre={{ x: "X", y: "Y", blur: "B", spread: "S" }[key]}
            title={{ x: "X", y: "Y", blur: tr("Blur"), spread: tr("Spread") }[key]}
            onChange={(value) =>
              onChange({ [key]: value ? (parseNumeric(value)?.unit === "px" ? parseNumeric(value)!.num : value) : 0 })
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

/** フィルターの各項目の入力欄の定義 */
const FILTER_FIELDS: {
  key: keyof FilterParts;
  label: string;
  unit: string;
  def: number;
  min?: number;
  max?: number;
}[] = [
  { key: "brightness", label: tr("Brightness"), unit: "%", def: 100, min: 0 },
  { key: "contrast", label: tr("Contrast"), unit: "%", def: 100, min: 0 },
  { key: "saturate", label: tr("Saturation"), unit: "%", def: 100, min: 0 },
  { key: "grayscale", label: tr("Grayscale"), unit: "%", def: 0, min: 0, max: 100 },
  { key: "sepia", label: tr("Sepia"), unit: "%", def: 0, min: 0, max: 100 },
  { key: "hueRotate", label: tr("Hue rotate"), unit: "deg", def: 0 },
];

const BLEND_MODES: { value: string; label: string }[] = [
  { value: "multiply", label: tr("Multiply") },
  { value: "screen", label: tr("Screen") },
  { value: "overlay", label: tr("Overlay") },
  { value: "darken", label: tr("Darken") },
  { value: "lighten", label: tr("Lighten") },
  { value: "difference", label: tr("Difference") },
  { value: "exclusion", label: tr("Exclusion") },
  { value: "luminosity", label: tr("Luminosity") },
];

/** 変形の基準点（transform-origin）。3×3 の位置（左上から右下へ） */
const ORIGINS: { value: string; label: string }[] = [
  { value: "top left", label: tr("Top left") },
  { value: "top", label: tr("Top center") },
  { value: "top right", label: tr("Top right") },
  { value: "left", label: tr("Middle left") },
  { value: "center", label: tr("Center") },
  { value: "right", label: tr("Middle right") },
  { value: "bottom left", label: tr("Bottom left") },
  { value: "bottom", label: tr("Bottom center") },
  { value: "bottom right", label: tr("Bottom right") },
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
    // 「top left」のように縦が先に書かれていても読む
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
    <div className="align-grid origin-grid" role="radiogroup" aria-label={tr("Origin")}>
      {ORIGINS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={cur === o.value}
          className={cur === o.value ? "is-on" : ""}
          data-tip={o.label}
          // 中央も明示的に指定する（設定を消すと、大きい画面や通常時の基準点が再び効いてしまう）。
          onClick={() => insp.set({ transformOrigin: o.value })}
        />
      ))}
    </div>
  );
}

/** 変形（transform）: 移動・回転・拡大・傾きと基準点。周りの配置は変えずに、見た目だけを動かす */
function TransformCard({ onDelete }: { onDelete: () => void }) {
  const insp = useInspector();
  const info = insp.get("transform");
  const tf = parseTransform(info.value);
  const ref = parseTransform(info.reference);
  const set = (patch: Partial<TransformParts>) =>
    insp.set({ transform: serializeTransform({ ...tf, ...patch }) ?? disabledEffect(insp, "transform") });
  const changed = (key: keyof TransformParts) => info.setHere && tf[key] !== ref[key];
  const len = (v: string) => (parseFloat(v) === 0 ? undefined : v);
  const pct = (n: number) => (n === 1 ? undefined : `${Math.round(n * 1000) / 10}%`);
  const deg = (n: number) => (n === 0 ? undefined : `${n}deg`);
  const num = (v: string | null, fallback: number) => (v ? (parseNumeric(v)?.num ?? fallback) : fallback);
  return (
    <div className="fx-card">
      <div className="fx-head">
        <span className="fx-label">{tr("Transform", "transform_variant_1")}</span>
        <InfoTip
          text={tr("Moves, rotates, scales or skews only how the element looks; the layout around it doesn't change. Change it in a state such as Hover and combine it with a “state change” motion to animate it.")}
        />
        <button className="icon-btn sm" data-tip={tr("Delete")} onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className="grid2">
        <Grp label={tr("Move X", "move_x_variant_1")} setHere={changed("x")} onReset={() => set({ x: ref.x })}>
          <NumField
            value={len(tf.x)}
            units={["px", "%", "em"]}
            placeholder="0"
            pre={<MoveHorizontal size={I} />}
            onChange={(v) => set({ x: v || "0px" })}
          />
        </Grp>
        <Grp label={tr("Move Y", "move_y_variant_1")} setHere={changed("y")} onReset={() => set({ y: ref.y })}>
          <NumField
            value={len(tf.y)}
            units={["px", "%", "em"]}
            placeholder="0"
            pre={<MoveVertical size={I} />}
            onChange={(v) => set({ y: v || "0px" })}
          />
        </Grp>
        <Grp label={tr("Scale X")} setHere={changed("scaleX")} onReset={() => set({ scaleX: ref.scaleX })}>
          <NumField
            value={pct(tf.scaleX)}
            units={["%"]}
            placeholder="100"
            pre={<UnfoldHorizontal size={I} />}
            onChange={(v) => set({ scaleX: num(v, 100) / 100 })}
          />
        </Grp>
        <Grp label={tr("Scale Y")} setHere={changed("scaleY")} onReset={() => set({ scaleY: ref.scaleY })}>
          <NumField
            value={pct(tf.scaleY)}
            units={["%"]}
            placeholder="100"
            pre={<UnfoldVertical size={I} />}
            onChange={(v) => set({ scaleY: num(v, 100) / 100 })}
          />
        </Grp>
        <Grp label={tr("Rotation")} setHere={changed("rotate")} onReset={() => set({ rotate: ref.rotate })}>
          <NumField
            value={deg(tf.rotate)}
            units={["deg"]}
            placeholder="0"
            pre={<RotateCw size={I} />}
            onChange={(v) => set({ rotate: num(v, 0) })}
          />
        </Grp>
        <Grp
          label={tr("Origin")}
          info={tr("The point that rotation, scaling and skewing happen around.")}
          setHere={insp.get("transformOrigin").changed}
          onReset={() => insp.set({ transformOrigin: null })}
        >
          <OriginGrid />
        </Grp>
        <Grp label={tr("Skew X")} setHere={changed("skewX")} onReset={() => set({ skewX: ref.skewX })}>
          <NumField value={deg(tf.skewX)} units={["deg"]} placeholder="0" pre="X" onChange={(v) => set({ skewX: num(v, 0) })} />
        </Grp>
        <Grp label={tr("Skew Y")} setHere={changed("skewY")} onReset={() => set({ skewY: ref.skewY })}>
          <NumField value={deg(tf.skewY)} units={["deg"]} placeholder="0" pre="Y" onChange={(v) => set({ skewY: num(v, 0) })} />
        </Grp>
      </div>
      {tf.rest && (
        <p className="hint" style={{ margin: 0 }}>
          {tr("Other transforms ({rest}) are kept as they are.", { rest: tf.rest })}
        </p>
      )}
    </div>
  );
}

export function EffectsSec() {
  const insp = useInspector();
  // 「none」（小さい画面で影を打ち消した値）は、影なしとして扱う
  const shadowList = (raw: string | undefined) =>
    raw && !isInitialValue("boxShadow", raw) ? splitTopLevel(raw).map(parseShadow) : [];
  const dropShadows = shadowList(insp.get("boxShadow").value);
  const textShadows = shadowList(insp.get("textShadow").value);

  const commitDrop = (list: Shadow[]) =>
    insp.set({
      boxShadow: list.length ? list.map(serializeShadow).join(", ") : disabledEffect(insp, "boxShadow"),
    });
  const commitDropTransient = (list: Shadow[]) =>
    insp.setTransient({
      boxShadow: list.length ? list.map(serializeShadow).join(", ") : disabledEffect(insp, "boxShadow"),
    });
  const commitText = (list: Shadow[]) =>
    insp.set({
      textShadow: list.length ? list.map(serializeTextShadow).join(", ") : disabledEffect(insp, "textShadow"),
    });
  const commitTextTransient = (list: Shadow[]) =>
    insp.setTransient({
      textShadow: list.length ? list.map(serializeTextShadow).join(", ") : disabledEffect(insp, "textShadow"),
    });

  const filterInfo = insp.get("filter");
  const f = parseFilter(filterInfo.value);
  /** 比べる相手（大きい画面・通常時）のフィルター。項目ごとの変更の色に使う */
  const fBase = parseFilter(filterInfo.baseline);
  const filterChanged = (key: keyof FilterParts) => filterInfo.setHere && f[key] !== fBase[key];
  const setFilter = (patch: Partial<FilterParts>) => {
    let value = filterInfo.value;
    for (const [key, amount] of Object.entries(patch)) {
      const name = key === "hueRotate" ? "hue-rotate" : key;
      const replacement = serializeFilter({ ...parseFilter(undefined), [key]: amount });
      value = editFilterFunction(value, name, replacement) ?? undefined;
    }
    insp.set({ filter: value ?? disabledEffect(insp, "filter") });
  };

  const bdVal = insp.get("backdropFilter").value;
  const bdM = /blur\(\s*(\d*\.?\d+)px\s*\)/i.exec(filterFunctions(bdVal ?? "").find(fn => fn.name === "blur")?.text ?? "");

  // 変形: 設定済みのとき、または「＋」から追加したときに表示する
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
      title={tr("Effects")}
      defaultOpen={anySet}
      tutorialTarget="style-effects"
      help="look-effects"
      tools={
        <Dropdown
          value={undefined}
          menuWidth={220}
          title={tr("Add effect")}
          trigger={<Plus size={13} />}
          options={[
            {
              value: "drop",
              label: tr("Drop shadow"),
              desc: tr("Adds a shadow around the element's shape"),
              icon: <SquareDashed size={13} />,
            },
            {
              value: "text",
              label: tr("Text shadow"),
              desc: tr("Adds a shadow along the letter shapes"),
              icon: <TextCursor size={13} />,
            },
            ...(tfSet || tfAdded
              ? []
              : [
                  {
                    value: "transform",
                    label: tr("Transform", "transform_variant_1"),
                    desc: tr("Move, scale, rotate, skew (transform)"),
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
          onChangeStart={() => useEditor.getState().beginGesture()}
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
          onChangeStart={() => useEditor.getState().beginGesture()}
        />
      ))}
      {(tfSet || tfAdded) && (
        <TransformCard
          onDelete={() => {
            setTfAdded(false);
            insp.set({ transform: disabledEffect(insp, "transform"), transformOrigin: null });
          }}
        />
      )}

      <div className="grid2">
        <Grp
          label={tr("Blur")}
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
          label={tr("Background blur")}
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
                  editFilterFunction(bdVal, "blur",
                    v && (parseNumeric(v)?.num ?? 1) > 0 ? `blur(${v})` : null,
                  ) ?? disabledEffect(insp, "backdropFilter"),
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
        label={tr("Blend mode")}
        info={tr("Blends colors with what's behind the element (background colors, images and so on).")}
        setHere={insp.get("mixBlendMode").changed}
        onReset={() => insp.set({ mixBlendMode: null })}
      >
        <PropSelect prop="mixBlendMode" unsetLabel={tr("Standard")} options={BLEND_MODES} />
      </Grp>
    </Sec>
  );
}
