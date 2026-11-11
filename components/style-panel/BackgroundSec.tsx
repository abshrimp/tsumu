"use client";

/**
 * 背景と枠線
 */

import { RotateCw } from "lucide-react";
import { useEditor } from "../../lib/store";
import { assetSrc } from "../../lib/assets";
import { cssAssetReferences, escapeCssAssetUrl } from "../../lib/css-assets";
import ImagePicker from "../ImagePicker";
import { parseNumeric, isInitialValue, initialValueOf, sameValue, type PropInfo } from "../../lib/style";
import {
  Dropdown,
  FillControl,
  Grp,
  NumField,
  PropFill,
  PropSelect,
  Seg,
  useInspector,
} from "../controls";
import { tr } from "../../lib/i18n";
import { I, Sec } from "./shared";

/* ---------- 背景 ---------- */

/** 「色」「画像」を選んだときに入る値 */
const BG_DEFAULT_COLOR = "#f4f4f5";
const BG_DEFAULT_IMAGE = `url("https://picsum.photos/seed/bg/1200/800")`;

/** 背景の種類。透明（小さい画面で背景を打ち消した値）は「なし」 */
function backgroundMode(image: string | undefined, color: string | undefined) {
  if (/^\s*(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i.test(image ?? "")) return "gradient";
  if (image && cssAssetReferences(image).length) return "image";
  return color && !isInitialValue("backgroundColor", color) ? "color" : "none";
}

export function parseGradient(v: string | undefined) {
  const gm = /linear-gradient\((-?\d*\.?\d+)deg,\s*(.+?)\s+0%,\s*(.+?)\s+100%\)/i.exec(v ?? "");
  return {
    angle: gm ? +gm[1] : 180,
    c1: gm ? gm[2] : "#ffffff",
    c2: gm ? gm[3] : "#e4e4e7",
  };
}

/**
 * ここで設定した値が上位と違うか。上位が未設定のときは、ほかの設定と一緒に
 * パネルが入れる値（dflt）と比べる（線の太さと一緒に入る色・画像と一緒に入るサイズなど）
 */
export function differsFrom(info: PropInfo, dflt: string): boolean {
  if (!info.setHere) return false;
  const ref = info.baseline ?? dflt;
  return !sameValue(info.value, ref);
}

export function BackgroundSec() {
  const insp = useInspector();
  const doc = useEditor((s) => s.doc);
  const explicitDefault = (prop: string) => isInitialValue(prop, insp.get(prop).baseline)
    ? null : initialValueOf(prop) ?? null;
  const imageInfo = insp.get("backgroundImage");
  const colorInfo = insp.get("backgroundColor");
  const bgImage = imageInfo.value;
  const bgColor = colorInfo.value;
  const mode = backgroundMode(bgImage, bgColor);
  // 種類（なし / 色 / グラデ / 画像）が上位と違うときだけ色を付ける（中身の変更は各欄で色を付ける）
  const modeChanged =
    (imageInfo.setHere || colorInfo.setHere) &&
    mode !== backgroundMode(imageInfo.reference, colorInfo.reference);

  const { angle, c1, c2 } = parseGradient(bgImage);
  // グラデーションの角度・色は、それぞれ上位のグラデーションの同じ部分と比べる
  // （上位がグラデーションでなければ、選んだときに入る既定の角度・色と比べる）
  const gBase = parseGradient(imageInfo.reference);
  const gradChanged = (key: "angle" | "c1" | "c2") =>
    imageInfo.setHere && String(gBase[key]) !== String({ angle, c1, c2 }[key]);
  const setGradient = (a: number, s1: string, s2: string) =>
    insp.set({
      backgroundImage: `linear-gradient(${a}deg, ${s1} 0%, ${s2} 100%)`,
    });
  const setGradientTransient = (a: number, s1: string, s2: string) =>
    insp.setTransient({
      backgroundImage: `linear-gradient(${a}deg, ${s1} 0%, ${s2} 100%)`,
    });

  const imageUrl = cssAssetReferences(bgImage ?? "")[0]?.url;

  return (
    <Sec
      title={tr("Background")}
      defaultOpen={mode !== "none"}
      tutorialTarget="style-background"
      help="look-color"
    >
      <Grp setHere={modeChanged} onReset={() =>
        insp.set({
          backgroundColor: null,
          backgroundImage: null,
          backgroundSize: null,
          backgroundPosition: null,
          backgroundRepeat: null,
          backgroundAttachment: null,
        })
      }>
      <Seg
        value={mode}
        options={[
          { label: tr("None"), value: "none" },
          { label: tr("Color"), value: "color" },
          { label: tr("Gradient"), value: "gradient" },
          { label: tr("Image"), value: "image" },
        ]}
        onChange={(v) => {
          // 小さい画面では、消すと大きい画面の背景が出てくるため初期値で打ち消す
          if (v === "none")
            insp.set({
              backgroundColor: explicitDefault("backgroundColor"),
              backgroundImage: explicitDefault("backgroundImage"),
              backgroundSize: null,
              backgroundPosition: null,
              backgroundRepeat: null,
              backgroundAttachment: null,
            });
          else if (v === "color")
            insp.set({ backgroundImage: explicitDefault("backgroundImage"), backgroundColor: BG_DEFAULT_COLOR });
          else if (v === "gradient") setGradient(180, "#ffffff", "#e4e4e7");
          else
            insp.set({
              backgroundImage: BG_DEFAULT_IMAGE,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            });
        }}
      />
      </Grp>

      {mode === "color" && <PropFill prop="backgroundColor" dflt={BG_DEFAULT_COLOR} />}

      {mode === "gradient" && (
        <>
          <div className="grid2">
            <Grp label={tr("Angle")} setHere={gradChanged("angle")}>
              <NumField
                value={`${angle}deg`}
                units={["deg"]}
                pre={<RotateCw size={I} />}
                onChange={(v) =>
                  setGradient(v ? (parseNumeric(v)?.num ?? 180) : 180, c1, c2)
                }
              />
            </Grp>
          </div>
          <Grp label={tr("Start color")} setHere={gradChanged("c1")}>
            <FillControl
              value={c1}
              allowClear={false}
              onChange={(v) => v && setGradient(angle, v, c2)}
              onChangeStart={() => useEditor.getState().beginGesture()}
              onChangeTransient={(v) =>
                v && setGradientTransient(angle, v, c2)
              }
            />
          </Grp>
          <Grp label={tr("End color")} setHere={gradChanged("c2")}>
            <FillControl
              value={c2}
              allowClear={false}
              onChange={(v) => v && setGradient(angle, c1, v)}
              onChangeStart={() => useEditor.getState().beginGesture()}
              onChangeTransient={(v) =>
                v && setGradientTransient(angle, c1, v)
              }
            />
          </Grp>
        </>
      )}

      {mode === "image" && (
        <>
          <Grp
            label={tr("Image")}
            // 上位が画像でなければ、「画像」を選んだときに入る仮の画像と比べる
            setHere={
              imageInfo.setHere &&
              bgImage !== (backgroundMode(imageInfo.reference, undefined) === "image" ? imageInfo.reference : BG_DEFAULT_IMAGE)
            }
            onReset={() => insp.set({ backgroundImage: null })}
          >
            <ImagePicker
              editTarget={insp.editTarget}
              value={(() => {
                const src = imageUrl;
                if (!src) return null;
                const matched = Object.values(doc.assets).find(
                  (a) => assetSrc(a) === src
                );
                return matched ? { assetId: matched.id } : { url: src };
              })()}
              onChange={(v) => {
                if (!v) {
                  insp.set({ backgroundImage: explicitDefault("backgroundImage") });
                  return;
                }
                // アップロード直後のアセットは描画時の doc にまだ無いため、最新の状態から引く
                const asset = v.assetId ? useEditor.getState().doc.assets[v.assetId] : undefined;
                const src = asset ? assetSrc(asset) : v.url;
                if (src) insp.set({ backgroundImage: `url("${escapeCssAssetUrl(src, '"')}")` });
              }}
            />
          </Grp>
          <div className="grid2">
            <Grp label={tr("Size")} setHere={differsFrom(insp.get("backgroundSize"), "cover")} onReset={() => insp.set({ backgroundSize: null })}>
              <PropSelect
                prop="backgroundSize"
                unsetLabel={tr("automatic")}
                options={[
                  { label: tr("Cover"), value: "cover" },
                  { label: tr("Show all", "show_all_variant_1"), value: "contain" },
                  { label: tr("Fit width"), value: "100% auto" },
                ]}
              />
            </Grp>
            <Grp label={tr("Position")} setHere={differsFrom(insp.get("backgroundPosition"), "center")} onReset={() => insp.set({ backgroundPosition: null })}>
              <PropSelect
                prop="backgroundPosition"
                unsetLabel={tr("Top left")}
                options={[
                  { label: tr("Center"), value: "center" },
                  { label: tr("Top"), value: "top" },
                  { label: tr("Bottom"), value: "bottom" },
                ]}
              />
            </Grp>
          </div>
          <div className="grid2">
            <StyleCheck
              prop="backgroundRepeat"
              label={tr("Repeat")}
              on="repeat"
              off="no-repeat"
              // background-repeat は消すと CSS の初期値の「繰り返す」になる
              baseOff="no-repeat"
            />
            <StyleCheck prop="backgroundAttachment" label={tr("Fixed")} on="fixed" off="scroll" />
          </div>
        </>
      )}
    </Sec>
  );
}

/**
 * スタイルのオン・オフのチェックボックス。オンのとき、またはほかの画面幅・状態用に
 * 変えたときは変更の色を付け、右クリックで解除する
 */
export function StyleCheck({
  prop,
  label,
  on,
  off,
  baseOff = null,
}: {
  prop: string;
  label: string;
  on: string;
  /** オフを明示する値（大きい画面・通常時でオンにした設定を、ここだけ外すときに書き込む） */
  off: string;
  /** パソコン幅・通常時でオフにしたときの値（null = 設定を消す） */
  baseOff?: string | null;
}) {
  const insp = useInspector();
  const info = insp.get(prop);
  const inherits = useEditor((s) => s.breakpoint !== "base" || s.styleState !== "default");
  const checked = info.value === on;
  // 消したときに効く値（baseOff があるプロパティは、未設定だと CSS の初期値でオンになる）
  const afterRemove = inherits ? (info.baseline ?? (baseOff !== null ? on : undefined)) : undefined;
  const isSet = info.changed && (checked || inherits);
  return (
    <label
      className={`grp-label${isSet ? " is-set" : ""}`}
      style={{ gap: 6, cursor: "pointer" }}
      onContextMenu={(e) => {
        e.preventDefault();
        // ほかの画面幅・状態では消すと元の設定に戻る。パソコン幅ではオフの値にする
        insp.set({ [prop]: inherits ? null : baseOff });
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) =>
          insp.set({
            // ほかの画面幅・状態で消すと大きい画面・通常時のオンが出てくるときだけ、オフを書き込む
            [prop]: e.target.checked ? on : inherits ? (afterRemove === on ? off : null) : baseOff,
          })
        }
      />
      {label}
    </label>
  );
}

/* ---------- 線 ---------- */

/** 線種の選択肢（アイコンは実際のborder-styleで描画したプレビュー） */
const BORDER_STYLE_OPTIONS = [
  { value: "solid", label: tr("Solid") },
  { value: "dashed", label: tr("Dashed") },
  { value: "dotted", label: tr("Dotted") },
  { value: "double", label: tr("Double") },
  { value: "groove", label: tr("Groove") },
  { value: "ridge", label: tr("Ridge") },
  { value: "inset", label: tr("Inset") },
  { value: "outset", label: tr("Outset") },
].map((o) => ({
  ...o,
  icon: (
    <span
      aria-hidden
      style={{
        width: 16,
        height: 0,
        borderTop: `${o.value === "double" ? "3px" : "2px"} ${o.value} currentColor`,
      }}
    />
  ),
}));

export function BorderSec() {
  const insp = useInspector();
  const width = insp.get("borderWidth");
  return (
    <Sec title={tr("Border")} defaultOpen={width.set} tutorialTarget="style-border" help="look-border">
      <div className="grid2">
        <Grp
          label={tr("Weight")}
          setHere={width.changed}
          onReset={() =>
            insp.set({
              borderWidth: null,
              borderStyle: null,
              borderColor: null,
            })
          }
        >
          <NumField
            value={width.value}
            units={["px"]}
            min={0}
            placeholder="0"
            onChange={(v) => {
              // 小さい画面では、消すと大きい画面の線が出てくるため太さ 0 で打ち消す
              if (v === null)
                insp.set({
                  borderWidth: insp.cleared("borderWidth"),
                  borderStyle: null,
                  borderColor: null,
                });
              else
                insp.set({
                  borderWidth: v,
                  borderStyle: isInitialValue("borderStyle", insp.get("borderStyle").value) ? "solid" : insp.get("borderStyle").value!,
                  borderColor: insp.get("borderColor").value ?? "#e4e4e7",
                });
            }}
          />
        </Grp>
        <Grp label={tr("Style")} setHere={differsFrom(insp.get("borderStyle"), "solid")} onReset={() => insp.set({ borderStyle: null })}>
          <Dropdown
            value={insp.get("borderStyle").value ?? "solid"}
            options={BORDER_STYLE_OPTIONS}
            onChange={(v) => insp.set({ borderStyle: v })}
          />
        </Grp>
      </div>
      <PropFill label={tr("Color")} prop="borderColor" dflt="#e4e4e7" />
    </Sec>
  );
}
