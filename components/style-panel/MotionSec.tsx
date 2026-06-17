"use client";

/**
 * モーション（表示時・スクロール・ホバーなどの動き）
 */

import { useState } from "react";
import { Diamond, Hourglass, Infinity, Plus, Timer, Trash2 } from "lucide-react";
import { useEditor } from "../../lib/store";
import type { DocNode, Motion } from "../../lib/types";
import {
  DIRECTIONS,
  FILL_MODES,
  KEYFRAMES,
  keyframeLabel,
  TRANSITION_PROPS,
  TRIGGERS,
  triggerLabel,
} from "../../lib/motion";
import { genId } from "../../lib/presets";
import { EasingCurve, EasingEditorModal, KeyframeEditorModal } from "../MotionEditors";
import { parseKeyframes } from "../../lib/keyframes";
import { EASINGS, parseNumeric } from "../../lib/style";
import { Dropdown, Grp, NumField } from "../controls";
import { tr } from "../../lib/i18n";
import { I, Sec } from "./shared";

/* ---------- モーション ---------- */

export function MotionSec({ node }: { node: DocNode }) {
  const updateNode = useEditor((s) => s.updateNode);
  const motions = node.motions ?? [];
  /** 編集画面を開いているモーション（ID） */
  const [kfEdit, setKfEdit] = useState<string | null>(null);
  const [easeEdit, setEaseEdit] = useState<string | null>(null);
  const kfMotion = motions.find((m) => m.id === kfEdit);
  const easeMotion = motions.find((m) => m.id === easeEdit);
  const updateById = (id: string, patch: Partial<Motion>) => {
    const i = motions.findIndex((m) => m.id === id);
    if (i >= 0) update(i, patch);
  };

  const update = (i: number, patch: Partial<Motion>) => {
    const next = motions.map((m, j) => (j === i ? { ...m, ...patch } : m));
    updateNode(node.id, { motions: next });
  };
  const remove = (i: number) =>
    updateNode(node.id, {
      motions: motions.filter((_, j) => j !== i),
    });
  const add = () =>
    updateNode(node.id, {
      motions: [
        ...motions,
        {
          id: genId("motion"),
          trigger: motions.length ? "load" : "state",
          property: "all",
          keyframes: "fade-up",
          duration: 0.3,
          delay: 0,
          easing: "ease-out",
          repeat: 1,
          direction: "normal",
          fillMode: "both",
        },
      ],
    });

  return (
    <Sec
      key={motions.length > 0 ? "has-motion" : "no-motion"}
      title={tr("モーション")}
      defaultOpen={motions.length > 0}
      tutorialTarget="style-motion"
      help="look-animation"
      tools={
        <button className="icon-btn sm" data-tip={tr("モーションを追加")} onClick={add}>
          <Plus size={13} />
        </button>
      }
    >
      {motions.map((m, i) => (
        <div key={m.id} className="fx-card">
          <div className="fx-head">
            <span className="fx-label">
              {triggerLabel(m.trigger)}
              <span className="motion-summary">
                {m.trigger === "state" ? (m.property ?? "all") : keyframeLabel(m.keyframes ?? "")}
                {" · "}
                {m.duration}s
              </span>
            </span>
            <button
              className="icon-btn sm"
              data-tip={tr("削除")}
              onClick={() => remove(i)}
            >
              <Trash2 size={12} />
            </button>
          </div>

          <Grp
            label={tr("きっかけ")}
            info={
              m.trigger === "state"
                ? tr("スタイルの変化をなめらかにします。パネル上部の「状態」を切り替えて、変化したあとのスタイルを設定してください。")
                : m.trigger === "in-view"
                  ? tr("スクロールして要素が画面に入ったときに1回再生されます（キャンバスではすぐに再生されます）。")
                  : undefined
            }
          >
            <Dropdown
              value={m.trigger}
              options={TRIGGERS.map((t) => ({ value: t.value, label: t.label }))}
              onChange={(v) => update(i, { trigger: v as Motion["trigger"] })}
            />
          </Grp>

          {m.trigger === "state" ? (
            <>
              <Grp label={tr("どのスタイルが変わったとき？")}>
                <Dropdown
                  value={m.property ?? "all"}
                  options={TRANSITION_PROPS.map((p) => ({
                    value: p.value,
                    label: p.label,
                  }))}
                  onChange={(v) => update(i, { property: v })}
                />
              </Grp>
            </>
          ) : (
            <>
              <Grp label={tr("動き")}>
                <Dropdown
                  value={m.keyframes ?? "fade-up"}
                  options={[
                    ...KEYFRAMES.map((k) => ({
                      value: k.key,
                      label: k.label,
                    })),
                    { value: "custom", label: tr("カスタム…") },
                  ]}
                  onChange={(v) => {
                    if (v !== "custom") {
                      update(i, { keyframes: v });
                      return;
                    }
                    // カスタムにしたら、それまでの動きを元に編集を始める
                    const seed = m.customKeyframes?.trim()
                      ? m.customKeyframes
                      : KEYFRAMES.find((k) => k.key === m.keyframes)?.css ?? "";
                    update(i, { keyframes: "custom", customKeyframes: seed });
                    setKfEdit(m.id);
                  }}
                />
              </Grp>
              {m.keyframes === "custom" && (
                <button type="button" className="btn me-open" onClick={() => setKfEdit(m.id)}>
                  <Diamond size={13} />
                  <span>{tr("キーフレームを編集")}</span>
                  <span className="me-open-meta">
                    {(() => {
                      const n = parseKeyframes(m.customKeyframes ?? "")?.length;
                      return n === undefined ? tr("CSS") : tr("{n}個", { n });
                    })()}
                  </span>
                </button>
              )}
            </>
          )}

          <div className="grid2">
            <Grp label={tr("時間")}>
              <NumField
                value={`${m.duration}s`}
                units={["s"]}
                min={0}
                pre={<Timer size={I} />}
                onChange={(v) =>
                  update(i, {
                    duration: v ? Math.max(0, parseNumeric(v)?.num ?? 0.3) : 0.3,
                  })
                }
              />
            </Grp>
            <Grp label={tr("遅延")}>
              <NumField
                value={m.delay ? `${m.delay}s` : undefined}
                units={["s"]}
                min={0}
                placeholder="0"
                pre={<Hourglass size={I} />}
                onChange={(v) =>
                  update(i, {
                    delay: v ? Math.max(0, parseNumeric(v)?.num ?? 0) : 0,
                  })
                }
              />
            </Grp>
          </div>
          <Grp label={tr("動きの緩急")}>
            {(() => {
              const isPreset = EASINGS.some((e) => e.value === m.easing);
              return (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="me-ease-row">
                  <Dropdown
                    value={isPreset ? m.easing : "custom"}
                    options={[
                      ...EASINGS.map((e) => ({
                        value: e.value,
                        label: e.label,
                        labelStyle: {
                          fontFamily: "ui-monospace, Menlo, monospace",
                          fontSize: 11,
                        } as const,
                      })),
                      { value: "custom", label: tr("カスタム…") },
                    ]}
                    onChange={(v) => {
                      if (v === "custom") setEaseEdit(m.id);
                      else update(i, { easing: v });
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn me-ease-btn"
                    data-tip={tr("イージングを編集")}
                    aria-label={tr("イージングを編集")}
                    onClick={() => setEaseEdit(m.id)}
                  >
                    <EasingCurve value={m.easing} size={20} />
                  </button>
                  </div>
                  {!isPreset && (
                    <button type="button" className="me-ease-value" onClick={() => setEaseEdit(m.id)}>
                      {m.easing}
                    </button>
                  )}
                </div>
              );
            })()}
          </Grp>

          {m.trigger !== "state" && (
            <>
              <div className="grid2">
                <Grp label={tr("くり返す回数")}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <NumField
                      value={m.repeat === -1 ? undefined : String(m.repeat ?? 1)}
                      units={[""]}
                      min={1}
                      placeholder={m.repeat === -1 ? "∞" : "1"}
                      onChange={(v) =>
                        update(i, {
                          repeat: v ? Math.max(1, Math.round(parseNumeric(v)?.num ?? 1)) : 1,
                        })
                      }
                    />
                    <button
                      className={`icon-btn${m.repeat === -1 ? " is-on" : ""}`}
                      data-tip={tr("ずっとくり返す")}
                      onClick={() =>
                        update(i, { repeat: m.repeat === -1 ? 1 : -1 })
                      }
                    >
                      <Infinity size={14} />
                    </button>
                  </div>
                </Grp>
                <Grp label={tr("向き")}>
                  <Dropdown
                    value={m.direction ?? "normal"}
                    options={DIRECTIONS.map((d) => ({
                      value: d.value,
                      label: d.label,
                    }))}
                    onChange={(v) =>
                      update(i, { direction: v as Motion["direction"] })
                    }
                  />
                </Grp>
              </div>
              <Grp label={tr("再生前後のスタイル")}>
                <Dropdown
                  value={m.fillMode ?? "both"}
                  options={FILL_MODES.map((f) => ({
                    value: f.value,
                    label: f.label,
                  }))}
                  onChange={(v) =>
                    update(i, { fillMode: v as Motion["fillMode"] })
                  }
                />
              </Grp>
            </>
          )}
        </div>
      ))}

      {!motions.length && (
        <p className="hint" style={{ margin: 0 }}>
          {tr("右上の + からモーションを追加できます。")}
        </p>
      )}

      {kfMotion && (
        <KeyframeEditorModal
          css={kfMotion.customKeyframes ?? ""}
          duration={kfMotion.duration}
          easing={kfMotion.easing}
          onClose={() => setKfEdit(null)}
          onApply={(css) => {
            updateById(kfMotion.id, { customKeyframes: css });
            setKfEdit(null);
          }}
        />
      )}
      {easeMotion && (
        <EasingEditorModal
          value={easeMotion.easing}
          duration={easeMotion.duration}
          onClose={() => setEaseEdit(null)}
          onApply={(value) => {
            updateById(easeMotion.id, { easing: value });
            setEaseEdit(null);
          }}
        />
      )}
    </Sec>
  );
}
