"use client";

import { Zap } from "lucide-react";
import { useEditor } from "../lib/store";
import { glyphs } from "./Glyph";
import { TRIGGER_LABELS } from "../lib/script";
import { stepText } from "../lib/script-text";
import type { Script } from "../lib/types";
import { tr } from "../lib/i18n";
import { CAT_OF, Ico, STEP_ICON, TRIGGER_ICON } from "./script-editor/catalog";

/**
 * スクリプトを、「きっかけ」とその下に並ぶ動作の一覧として表示する
 * （element = 要素名を添える。onOpen があれば、クリックでスクリプトの画面を開く）
 */
export function ScriptSummary({
  items,
  onOpen,
}: {
  items: { script: Script; element?: string }[];
  onOpen?: (script: Script) => void;
}) {
  const doc = useEditor((s) => s.doc);
  const MAX = 3;
  return (
    <ul className="ss">
      {items.map(({ script: s, element }) => {
        const TrigIcon = TRIGGER_ICON[s.trigger] ?? Zap;
        return (
          <li key={s.id} className="ss-item">
            <button
              type="button"
              className="ss-card"
              onClick={() => onOpen?.(s)}
              disabled={!onOpen}
              data-tip={onOpen ? tr("Click to edit scripts") : undefined}
            >
              <span className="ss-when">
                <Ico icon={TrigIcon} cat="event" />
                {s.trigger === "change" && s.changeVariable !== undefined
                  ? <span className="ss-el">{s.changeVariable || tr("Select a variable")}</span>
                  : element && <span className="ss-el">{element}</span>}
                <span className="ss-trig">{TRIGGER_LABELS[s.trigger]}</span>
              </span>
              <ol className="ss-steps">
                {s.steps.slice(0, MAX).map((step) => (
                  <li key={step.id}>
                    <Ico icon={STEP_ICON[step.kind]} cat={CAT_OF[step.kind]} />
                    <span className="ss-text">{glyphs(stepText(step, doc))}</span>
                  </li>
                ))}
                {s.steps.length > MAX && (
                  <li className="ss-more">{tr("and {n} more actions", { n: s.steps.length - MAX })}</li>
                )}
                {!s.steps.length && <li className="ss-more">{tr("No actions")}</li>}
              </ol>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
