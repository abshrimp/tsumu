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
    <Sec title={trc("input_variant_2", "Input")} defaultOpen={props.some((p) => insp.get(p).set)} help="form-fields">
      {accent && (
        <PropFill
          label={f.kind === "checkbox" ? tr("Check color") : f.kind === "radio" ? tr("Selection color") : tr("Thumb and track color")}
          info={tr("The color of the browser's built-in control (accent-color).")}
          prop="accentColor"
        />
      )}
      {(f.kind === "checkbox" || f.kind === "radio") && (
        <p className="hint" style={{ margin: 0 }}>
          {tr("The checkbox grows with the text size (Text → Size).")}
        </p>
      )}
      {caret && (
        <PropFill
          label={tr("Caret color")}
          info={tr("The color of the blinking line while typing (caret-color).")}
          prop="caretColor"
        />
      )}
      {scheme && (
        <Grp
          label={tr("Picker theme")}
          info={tr("Whether the browser's pop-ups such as the calendar, color picker and option list use a light or dark theme (color-scheme).")}
          props={["colorScheme"]}
        >
          <PropSeg
            prop="colorScheme"
            options={[
              { label: tr("Light"), value: "light" },
              { label: tr("Dark"), value: "dark" },
            ]}
          />
        </Grp>
      )}
      {f.kind === "textarea" && (
        <Grp label={tr("Resize")} info={tr("Whether visitors can resize the field by dragging its bottom-right corner (resize).")} props={["resize"]}>
          <PropSeg
            prop="resize"
            options={[
              { label: trc("none_variant_2", "None"), value: "none" },
              { label: tr("Vertical"), value: "vertical" },
              { label: tr("Horizontal"), value: "horizontal" },
              { label: tr("Both"), value: "both" },
            ]}
          />
        </Grp>
      )}
      {f.kind === "file" && (
        <>
          <PropFill label={tr("Button background")} prop="fileButtonBackground" />
          <PropFill label={tr("Button text color")} prop="fileButtonColor" />
          <Grp label={tr("Button radius")} props={["fileButtonRadius"]}>
            <PropNum prop="fileButtonRadius" pre={<Scan size={I} />} units={["px"]} />
          </Grp>
        </>
      )}
    </Sec>
  );
}
