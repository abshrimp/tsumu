"use client";

/**
 * フォーム部品（入力欄・チェックボックスなど）の見た目
 */

import { Scan } from "lucide-react";
import type { DocNode } from "../../lib/types";
import { Grp, PropFill, PropNum, PropSeg, useInspector } from "../controls";
import { tr } from "../../lib/i18n";
import { TEXT_INPUTS } from "../../lib/fields";
import { I, Sec } from "./shared";

/* ---------- 入力欄（種類ごとの見た目） ---------- */

const PICKER_TYPES = new Set(["date", "time", "datetime-local", "month", "week", "color"]);

/** フォーム部品の種類ごとに、ブラウザ標準の部品の色・配色・大きさを変える */
export function FieldStyleSec({ node }: { node: DocNode }) {
  const insp = useInspector();
  const f = node.field;
  if (!f || f.kind === "submit") return null;
  const type = f.kind === "input" ? (f.inputType ?? "text") : f.kind;
  const accent = f.kind === "checkbox" || f.kind === "radio" || type === "range";
  const caret = f.kind === "textarea" || TEXT_INPUTS.has(type) || type === "number";
  const scheme = f.kind === "select" || PICKER_TYPES.has(type);
  const props = [
    "accentColor",
    "caretColor",
    "colorScheme",
    "resize",
    "fileButtonBackground",
    "fileButtonColor",
    "fileButtonRadius",
  ];
  return (
    <Sec title={tr("入力欄")} defaultOpen={props.some((p) => insp.get(p).set)} help="form-fields">
      {accent && (
        <PropFill
          label={f.kind === "checkbox" ? tr("チェックの色") : f.kind === "radio" ? tr("選択の色") : tr("つまみ・バーの色")}
          info={tr("ブラウザ標準の部品の色（accent-color）です。")}
          prop="accentColor"
        />
      )}
      {(f.kind === "checkbox" || f.kind === "radio") && (
        <p className="hint" style={{ margin: 0 }}>
          {tr("チェックの大きさは、文字の大きさに合わせて変わります（テキストの「サイズ」）。")}
        </p>
      )}
      {caret && (
        <PropFill
          label={tr("入力カーソルの色")}
          info={tr("文字を入力するときに点滅する縦線の色（caret-color）です。")}
          prop="caretColor"
        />
      )}
      {scheme && (
        <Grp
          label={tr("ピッカーの配色")}
          info={tr("カレンダー・色選び・選択肢の一覧など、ブラウザが出す部品を明るい配色・暗い配色のどちらで出すか（color-scheme）です。")}
          props={["colorScheme"]}
        >
          <PropSeg
            prop="colorScheme"
            options={[
              { label: tr("明るい"), value: "light" },
              { label: tr("暗い"), value: "dark" },
            ]}
          />
        </Grp>
      )}
      {f.kind === "textarea" && (
        <Grp label={tr("大きさの変更")} info={tr("右下の角をドラッグして、入力欄の大きさを変えられるか（resize）です。")} props={["resize"]}>
          <PropSeg
            prop="resize"
            options={[
              { label: tr("不可"), value: "none" },
              { label: tr("縦"), value: "vertical" },
              { label: tr("横"), value: "horizontal" },
              { label: tr("両方"), value: "both" },
            ]}
          />
        </Grp>
      )}
      {f.kind === "file" && (
        <>
          <PropFill label={tr("ボタンの背景色")} prop="fileButtonBackground" />
          <PropFill label={tr("ボタンの文字色")} prop="fileButtonColor" />
          <Grp label={tr("ボタンの角丸")} props={["fileButtonRadius"]}>
            <PropNum prop="fileButtonRadius" pre={<Scan size={I} />} units={["px"]} />
          </Grp>
        </>
      )}
    </Sec>
  );
}
