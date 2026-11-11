"use client";

/**
 * 文字（フォント・大きさ・行間など）
 */

import { isEnterKey } from "../../lib/keys";
import { useState } from "react";
import { usePendingImport } from "../../lib/use-pending-import";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  Pilcrow,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";
import { ancestorsOf, findParentOf, useEditor } from "../../lib/store";
import type { Breakpoint, CustomFont, DocNode, SiteDoc, StyleState } from "../../lib/types";
import { allFonts, getProp, resolveStyleMap, isInitialValue, initialValueOf } from "../../lib/style";
import {
  Dropdown,
  Grp,
  PropFill,
  PropNum,
  PropSeg,
  PropSelect,
  Seg,
  useInspector,
} from "../controls";
import { tr, trc } from "../../lib/i18n";
import { differsFrom } from "./BackgroundSec";
import { Sec } from "./shared";

/* ---------- フォント（カスタムGoogle Fonts対応） ---------- */

function FontPicker({ inheritedValue }: { inheritedValue: string }) {
  const insp = useInspector();
  const doc = useEditor((s) => s.doc);
  const updateDoc = useEditor((s) => s.updateDoc);
  const [adding, setAdding] = useState(false);
  const [family, setFamily] = useState("");
  const pending = usePendingImport(JSON.stringify([insp.editTarget, insp.get("fontFamily").value]));
  const { busy } = pending;
  const [error, setError] = useState<string | null>(null);

  const fonts = allFonts(doc.customFonts);

  const addFont = async () => {
    const name = family.trim().replace(/\s+/g, " ");
    if (!name) return;
    const request = pending.begin();
    setError(null);
    try {
      // 利用可能なウェイトを実際のcss2応答から解析する
      //（css2は存在しないウェイトを黙って間引くが、next/fontは厳格なため）
      const enc = encodeURIComponent(name).replace(/%20/g, "+");
      const tryFetch = async (axis: string): Promise<string | null> => {
        if (!request.current()) return null;
        try {
          // css2のエラー応答はCORSヘッダーを持たず例外になる
          const res = await fetch(
            `https://fonts.googleapis.com/css2?family=${enc}${axis}&display=swap`
          );
          return res.ok ? await res.text() : null;
        } catch {
          return null;
        }
      };

      let found: CustomFont | null = null;
      if (await tryFetch(":wght@100..900")) {
        found = { family: name, weights: "variable" };
      } else {
        const body =
          (await tryFetch(":wght@400;500;600;700")) ?? (await tryFetch(""));
        if (body) {
          const weights = [
            ...new Set(
              [...body.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1])
            ),
          ].sort();
          found = {
            family: name,
            weights: weights.length ? weights : ["400"],
          };
        }
      }
      if (!request.current()) return;
      if (!found) {
        setError(
          tr("Not found on Google Fonts. Enter the name exactly as shown on fonts.google.com")
        );
        return;
      }
      updateDoc((d) => {
        d.customFonts = [
          ...(d.customFonts ?? []).filter((f) => f.family !== name),
          found!,
        ];
      });
      insp.set({ fontFamily: name });
      setAdding(false);
      setFamily("");
    } catch {
      if (!request.current()) return;
      setError(tr("Couldn't check. Check your network connection"));
    } finally {
      request.finish();
    }
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PropSelect
            prop="fontFamily"
            unsetLabel={tr("Inherited ({inheritedValue})", { inheritedValue })}
            options={fonts.map((f) => ({
              label: f.label,
              value: f.value,
              labelStyle: { fontFamily: `"${f.value}", sans-serif` },
            }))}
          />
        </div>
        <button
          className={`icon-btn${adding ? " is-on" : ""}`}
          data-tip={tr("Add from Google Fonts")}
          onClick={() => {
            pending.cancel();
            setAdding(!adding);
          }}
        >
          <Plus size={13} />
        </button>
      </div>
      {adding && (
        <div className="stack" style={{ gap: 4 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              className="input"
              value={family}
              placeholder={tr("Name on fonts.google.com (e.g. Playfair Display)")}
              onChange={(e) => {
                pending.cancel();
                setFamily(e.target.value);
              }}
              onKeyDown={(e) => {
                if (isEnterKey(e)) void addFont();
              }}
            />
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void addFont()}
              style={{ flex: "none" }}
            >
              {busy ? tr("Checking…") : tr("Add")}
            </button>
          </div>
          {error && (
            <p className="hint" style={{ margin: 0, color: "var(--danger)" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- テキスト ---------- */

export function inheritedPropValue(
  doc: SiteDoc,
  nodeId: string,
  breakpoint: Breakpoint,
  styleState: StyleState,
  prop: string
): string | undefined {
  let parent = findParentOf(doc, nodeId);
  while (parent?.kind === "node") {
    const parentNode = doc.nodes[parent.id];
    if (!parentNode) break;
    const value = getProp(parentNode, breakpoint, styleState, prop).value;
    if (value) return value;
    parent = findParentOf(doc, parent.id);
  }
  // ページ直下まで来たら、そのページの body の設定を受け継ぐ
  if (parent?.kind === "page") {
    const body = doc.pages[parent.id]?.bodyStyles;
    return resolveStyleMap(body, breakpoint, "default")[prop] || undefined;
  }
  return undefined;
}

/** 文字の入力欄（プレースホルダーを出せるもの）か、それを中に持つ要素か */
function hasTextField(doc: SiteDoc, nodeId: string): boolean {
  const n = doc.nodes[nodeId];
  if (!n) return false;
  if (n.type === "field") return n.field?.kind === "input" || n.field?.kind === "textarea";
  return n.children.some((c) => hasTextField(doc, c));
}

/** リンクか、リンクの中の要素か */
function inLink(doc: SiteDoc, nodeId: string): boolean {
  return [nodeId, ...ancestorsOf(doc, nodeId)].some((id) => !!doc.nodes[id]?.link);
}

export function TypographySec({ node }: { node: DocNode }) {
  const insp = useInspector();
  const doc = useEditor((s) => s.doc);
  const breakpoint = useEditor((s) => s.breakpoint);
  const styleState = useEditor((s) => s.styleState);
  const updateTargets = useEditor((s) => s.updateTargets);
  // Choosing an off state is not a reset: hover/focus may need to override
  // the normal state's styling explicitly instead of inheriting it again.
  const explicitDefault = (prop: string) => isInitialValue(prop, insp.get(prop).baseline)
    ? null : initialValueOf(prop) ?? null;
  const clamp = !isInitialValue("WebkitLineClamp", insp.get("WebkitLineClamp").value);
  // Removing the local clamp must also override one inherited from a wider
  // breakpoint. display has element-specific defaults, not a global clear value.
  const unclampedDisplay = insp.get("display").baseline === "-webkit-box" ? "block" : null;
  const nowrap = insp.get("whiteSpace").value === "nowrap";
  const deco = insp.get("textDecoration").value;
  const italic = insp.get("fontStyle").value === "italic";
  const inheritedFontFamily = inheritedPropValue(
    doc,
    node.id,
    breakpoint,
    styleState,
    "fontFamily"
  ) ?? "system-ui";
  const inheritedFontWeight = inheritedPropValue(
    doc,
    node.id,
    breakpoint,
    styleState,
    "fontWeight"
  ) ?? "400";

  return (
    <Sec
      title={tr("Text", "text_variant_1")}
      defaultOpen={!!node.text || node.type === "field"}
      tutorialTarget="style-typography"
      help="text-size"
    >
      {node.text && (
        <Grp label={tr("Heading level")}>
          <Dropdown
            value={String(node.text.heading)}
            options={[
              { value: "0", label: tr("Body"), icon: <Pilcrow size={13} /> },
              { value: "1", label: tr("Heading 1", "heading_1_variant_1"), icon: <Heading1 size={14} /> },
              { value: "2", label: tr("Heading 2", "heading_2_variant_1"), icon: <Heading2 size={14} /> },
              { value: "3", label: tr("Heading 3", "heading_3_variant_1"), icon: <Heading3 size={14} /> },
              { value: "4", label: tr("Heading 4"), icon: <Heading4 size={14} /> },
              { value: "5", label: tr("Heading 5"), icon: <Heading5 size={14} /> },
              { value: "6", label: tr("Heading 6"), icon: <Heading6 size={14} /> },
            ]}
            onChange={(v) =>
              // 複数選択中は、選択中のテキスト要素すべての見出しレベルを変える
              updateTargets(node.id, (n) => {
                if (n.text) n.text = { ...n.text, heading: +v };
              })
            }
          />
        </Grp>
      )}

      <Grp
        label={tr("Font")}
        setHere={insp.get("fontFamily").changed}
        onReset={() => insp.set({ fontFamily: null })}
      >
        <FontPicker inheritedValue={inheritedFontFamily} />
      </Grp>

      <div className="grid2">
        <Grp label={tr("Size")} props={["fontSize"]}>
          <PropNum prop="fontSize" pre="A" units={["px", "rem"]} />
        </Grp>
        <Grp
          label={tr("Weight")}
          setHere={insp.get("fontWeight").changed}
          onReset={() => insp.set({ fontWeight: null })}
        >
          <PropSelect
            prop="fontWeight"
            unsetLabel={tr("Inherited ({inheritedFontWeight})", { inheritedFontWeight })}
            options={[
              { label: tr("Light 300"), value: "300", labelStyle: { fontWeight: 300 } },
              { label: tr("Regular 400"), value: "400", labelStyle: { fontWeight: 400 } },
              { label: tr("Medium 500"), value: "500", labelStyle: { fontWeight: 500 } },
              {
                label: tr("Semibold 600"),
                value: "600",
                labelStyle: { fontWeight: 600 },
              },
              { label: tr("Bold 700"), value: "700", labelStyle: { fontWeight: 700 } },
              { label: tr("Black 900"), value: "900", labelStyle: { fontWeight: 900 } },
            ]}
          />
        </Grp>
        <Grp label={tr("Line height")} props={["lineHeight"]}>
          <PropNum prop="lineHeight" pre={trc("line_height", "LH")} units={["", "px"]} />
        </Grp>
        <Grp label={tr("Letter spacing")} props={["letterSpacing"]}>
          <PropNum prop="letterSpacing" pre={trc("letter_spacing", "LS")} units={["px", "em"]} />
        </Grp>
      </div>

      <PropFill label={tr("Color")} prop="color" />
      {inLink(doc, node.id) && (
        <PropFill
          label={tr("Visited color")}
          info={tr("The text color of links that have already been opened. You can also set it on elements inside a link.")}
          prop="visitedColor"
        />
      )}
      {hasTextField(doc, node.id) && (
        <PropFill
          label={tr("Placeholder color")}
          info={tr("The color of the hint text shown in empty fields. Set it on a box or form to apply it to every field inside.")}
          prop="placeholderColor"
        />
      )}

      <div className="grid2" style={{ alignItems: "end" }}>
        <Grp
          label={tr("Align")}
          setHere={insp.get("textAlign").changed}
          onReset={() => insp.set({ textAlign: null })}
        >
          <PropSeg
            prop="textAlign"
            options={[
              { label: <AlignLeft size={13} />, value: "left", title: tr("Align left") },
              {
                label: <AlignCenter size={13} />,
                value: "center",
                title: tr("Align center"),
              },
              {
                label: <AlignRight size={13} />,
                value: "right",
                title: tr("Align right"),
              },
            ]}
          />
        </Grp>
        <Grp label={tr("Decoration")} props={["fontStyle", "textDecoration"]}>
          <div className="seg seg-full">
            <button
              className={italic ? "is-on" : ""}
              data-tip={tr("Italic")}
              onClick={() =>
                insp.set({ fontStyle: italic ? explicitDefault("fontStyle") : "italic" })
              }
            >
              <Italic size={13} />
            </button>
            <button
              className={deco === "underline" ? "is-on" : ""}
              data-tip={tr("Underline")}
              onClick={() =>
                insp.set({
                  textDecoration: deco === "underline" ? explicitDefault("textDecoration") : "underline",
                })
              }
            >
              <Underline size={13} />
            </button>
            <button
              className={deco === "line-through" ? "is-on" : ""}
              data-tip={tr("Strikethrough")}
              onClick={() =>
                insp.set({
                  textDecoration:
                    deco === "line-through" ? explicitDefault("textDecoration") : "line-through",
                })
              }
            >
              <Strikethrough size={13} />
            </button>
          </div>
        </Grp>
      </div>

      <div className="grid2">
        <Grp
          label={tr("Transform")}
          setHere={insp.get("textTransform").changed}
          onReset={() => insp.set({ textTransform: null })}
        >
          <PropSelect
            prop="textTransform"
            unsetLabel={tr("None")}
            options={[
              {
                label: tr("Uppercase"),
                value: "uppercase",
                icon: <CaseUpper size={14} />,
              },
              {
                label: tr("Lowercase"),
                value: "lowercase",
                icon: <CaseLower size={14} />,
              },
              {
                label: tr("Capitalize"),
                value: "capitalize",
                icon: <CaseSensitive size={14} />,
              },
            ]}
          />
        </Grp>
        <Grp
          label={tr("Wrapping")}
          props={["whiteSpace", "WebkitLineClamp"]}
          onReset={() =>
            insp.set({
              whiteSpace: null,
              WebkitLineClamp: null,
              WebkitBoxOrient: null,
              ...(clamp ? { display: null, overflow: null } : {}),
            })
          }
        >
          <Seg
            value={clamp ? "clamp" : nowrap ? "nowrap" : "wrap"}
            options={[
              { label: tr("Wrap"), value: "wrap" },
              { label: tr("None"), value: "nowrap" },
              { label: tr("Truncate"), value: "clamp" },
            ]}
            onChange={(v) => {
              if (v === "wrap") {
                const props: Record<string, string | null> = {
                  // 大きい画面の「なし」を打ち消すときは、文字要素の既定（改行を保つ）に戻す
                  whiteSpace: explicitDefault("whiteSpace") && node.text ? "pre-wrap" : explicitDefault("whiteSpace"),
                  WebkitLineClamp: explicitDefault("WebkitLineClamp"),
                  WebkitBoxOrient: explicitDefault("WebkitBoxOrient"),
                };
                if (clamp) {
                  props.display = unclampedDisplay;
                  props.overflow = explicitDefault("overflow");
                }
                insp.set(props);
              } else if (v === "nowrap")
                insp.set({
                  whiteSpace: "nowrap",
                  WebkitLineClamp: explicitDefault("WebkitLineClamp"),
                  WebkitBoxOrient: explicitDefault("WebkitBoxOrient"),
                  ...(clamp ? { display: unclampedDisplay, overflow: explicitDefault("overflow") } : {}),
                });
              else
                insp.set({
                  whiteSpace: explicitDefault("whiteSpace") && node.text ? "pre-wrap" : explicitDefault("whiteSpace"),
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: "2",
                  overflow: "hidden",
                });
            }}
          />
        </Grp>
      </div>

      {clamp && (
        <div className="grid2">
          <Grp
            label={tr("Lines before truncating")}
            setHere={differsFrom(insp.get("WebkitLineClamp"), "2")}
            onReset={() => insp.set({ WebkitLineClamp: "2" })}
          >
            <PropNum prop="WebkitLineClamp" units={[""]} min={1} max={10} />
          </Grp>
        </div>
      )}
    </Sec>
  );
}
