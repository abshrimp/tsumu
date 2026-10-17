"use client";

/**
 * 背景と枠線
 */

import { RotateCw } from "lucide-react";
import { useEditor } from "../../lib/store";
import { assetSrc } from "../../lib/assets";
import ImagePicker from "../ImagePicker";
import { parseNumeric, isInitialValue, sameValue, type PropInfo } from "../../lib/style";
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
  if (image?.includes("gradient")) return "gradient";
  if (image?.includes("url(")) return "image";
  return color && !isInitialValue("backgroundColor", color) ? "color" : "none";
}

function parseGradient(v: string | undefined) {
  const gm = /linear-gradient\((\d+)deg,\s*(.+?)\s+0%,\s*(.+?)\s+100%\)/.exec(v ?? "");
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

  const um = /url\(["']?(.+?)["']?\)/.exec(bgImage ?? "");

  return (
    <Sec
      title={tr("背景")}
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
          { label: tr("なし"), value: "none" },
          { label: tr("色"), value: "color" },
          { label: tr("グラデーション"), value: "gradient" },
          { label: tr("画像"), value: "image" },
        ]}
        onChange={(v) => {
          // 小さい画面では、消すと大きい画面の背景が出てくるため初期値で打ち消す
          if (v === "none")
            insp.set({
              backgroundColor: insp.cleared("backgroundColor"),
              backgroundImage: insp.cleared("backgroundImage"),
              backgroundSize: null,
              backgroundPosition: null,
              backgroundRepeat: null,
              backgroundAttachment: null,
            });
          else if (v === "color")
            insp.set({ backgroundImage: insp.cleared("backgroundImage"), backgroundColor: BG_DEFAULT_COLOR });
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
            <Grp label={tr("角度")} setHere={gradChanged("angle")}>
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
          <Grp label={tr("開始色")} setHere={gradChanged("c1")}>
            <FillControl
              value={c1}
              allowClear={false}
              onChange={(v) => v && setGradient(angle, v, c2)}
              onChangeStart={insp.checkpoint}
              onChangeTransient={(v) =>
                v && setGradientTransient(angle, v, c2)
              }
            />
          </Grp>
          <Grp label={tr("終了色")} setHere={gradChanged("c2")}>
            <FillControl
              value={c2}
              allowClear={false}
              onChange={(v) => v && setGradient(angle, c1, v)}
              onChangeStart={insp.checkpoint}
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
            label={tr("画像")}
            // 上位が画像でなければ、「画像」を選んだときに入る仮の画像と比べる
            setHere={
              imageInfo.setHere &&
              bgImage !== (backgroundMode(imageInfo.reference, undefined) === "image" ? imageInfo.reference : BG_DEFAULT_IMAGE)
            }
            onReset={() => insp.set({ backgroundImage: null })}
          >
            <ImagePicker
              value={(() => {
                const src = um?.[1];
                if (!src) return null;
                const matched = Object.values(doc.assets).find(
                  (a) => assetSrc(a) === src
                );
                return matched ? { assetId: matched.id } : { url: src };
              })()}
              onChange={(v) => {
                if (!v) {
                  insp.set({ backgroundImage: insp.cleared("backgroundImage") });
                  return;
                }
                // アップロード直後のアセットは描画時の doc にまだ無いため、最新の状態から引く
                const asset = v.assetId ? useEditor.getState().doc.assets[v.assetId] : undefined;
                const src = asset ? assetSrc(asset) : v.url;
                if (src) insp.set({ backgroundImage: `url("${src}")` });
              }}
            />
          </Grp>
          <div className="grid2">
            <Grp label={tr("サイズ")} setHere={differsFrom(insp.get("backgroundSize"), "cover")} onReset={() => insp.set({ backgroundSize: null })}>
              <PropSelect
                prop="backgroundSize"
                unsetLabel={tr("自動")}
                options={[
                  { label: tr("カバー"), value: "cover" },
                  { label: tr("全体を表示"), value: "contain" },
                  { label: tr("幅に合わせる"), value: "100% auto" },
                ]}
              />
            </Grp>
            <Grp label={tr("位置")} setHere={differsFrom(insp.get("backgroundPosition"), "center")} onReset={() => insp.set({ backgroundPosition: null })}>
              <PropSelect
                prop="backgroundPosition"
                unsetLabel={tr("左上")}
                options={[
                  { label: tr("中央"), value: "center" },
                  { label: tr("上"), value: "top" },
                  { label: tr("下"), value: "bottom" },
                ]}
              />
            </Grp>
          </div>
          <div className="grid2">
            <StyleCheck
              prop="backgroundRepeat"
              label={tr("くり返す")}
              on="repeat"
              off="no-repeat"
              // background-repeat は消すと CSS の初期値の「繰り返す」になる
              baseOff="no-repeat"
            />
            <StyleCheck prop="backgroundAttachment" label={tr("固定")} on="fixed" off="scroll" />
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
  { value: "solid", label: tr("実線") },
  { value: "dashed", label: tr("破線") },
  { value: "dotted", label: tr("点線") },
  { value: "double", label: tr("二重線") },
  { value: "groove", label: tr("溝（立体）") },
  { value: "ridge", label: tr("畝（立体）") },
  { value: "inset", label: tr("くぼみ（立体）") },
  { value: "outset", label: tr("浮き出し（立体）") },
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
    <Sec title={tr("線")} defaultOpen={width.set} tutorialTarget="style-border" help="look-border">
      <div className="grid2">
        <Grp
          label={tr("太さ")}
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
                  borderStyle: insp.get("borderStyle").value ?? "solid",
                  borderColor: insp.get("borderColor").value ?? "#e4e4e7",
                });
            }}
          />
        </Grp>
        <Grp label={tr("スタイル")} setHere={differsFrom(insp.get("borderStyle"), "solid")} onReset={() => insp.set({ borderStyle: null })}>
          <Dropdown
            value={insp.get("borderStyle").value ?? "solid"}
            options={BORDER_STYLE_OPTIONS}
            onChange={(v) => insp.set({ borderStyle: v })}
          />
        </Grp>
      </div>
      <PropFill label={tr("色")} prop="borderColor" dflt="#e4e4e7" />
    </Sec>
  );
}
