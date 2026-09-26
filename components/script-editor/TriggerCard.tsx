"use client";

/**
 * 「いつ」のカード。きっかけの種類と、その対象（要素か変数）を選ぶ。
 * 新しいスクリプトを作るときの、きっかけを選ぶ画面もここに置く。
 */

import { useContext, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { singleValueReference } from "../../lib/variable-choice";
import { PAGE_TARGET, type ScriptTrigger } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { InfoTip } from "../controls";
import { Ico, TRIGGERS, TRIGGER_HINT, TRIGGER_ICON, TRIGGER_LABELS, catStyle, isPageTrigger } from "./catalog";
import { Ctx } from "./context";
import { TextIn } from "./inputs";
import { Popover } from "./Popover";
import { NodePicker } from "./targets";
import { TriggerArt } from "./TriggerArt";

export interface TriggerValue {
  trigger: ScriptTrigger;
  /** きっかけの要素（PAGE_TARGET = このページ、null = まだ選んでいない） */
  nodeId: string | null;
  /** 定義されていれば（空でも）、変数の変更をきっかけにする */
  changeVariable?: string;
  keepOnShown?: boolean;
}

/** きっかけを切り替えたときに、その種類では使わない設定を残さない。 */
function withTrigger(value: TriggerValue, trigger: ScriptTrigger): TriggerValue {
  if (isPageTrigger(trigger)) return { trigger, nodeId: PAGE_TARGET };
  const watchesVariable = trigger === "change" && value.changeVariable !== undefined;
  return {
    trigger,
    nodeId: watchesVariable ? PAGE_TARGET : value.nodeId === PAGE_TARGET ? null : value.nodeId,
    ...(watchesVariable ? { changeVariable: value.changeVariable } : {}),
    ...(trigger === "hover-end" && value.keepOnShown ? { keepOnShown: true } : {}),
  };
}

export function TriggerCard({ value, isLink, autoPick, onChange, onCancel }: {
  value: TriggerValue;
  /** 「クリックしたとき → 開く」だけなので、リンクとして書き出される */
  isLink?: boolean;
  /** 表示と同時に要素の一覧を開く（作り始めたばかりで、まだ要素を選んでいない） */
  autoPick?: boolean;
  /** 要素まで決まったときだけ呼ぶ（決まるまでは、この中で保留する） */
  onChange: (next: TriggerValue & { nodeId: string }) => void;
  /** 作り始めたスクリプトを、要素を選ばずにやめた */
  onCancel?: () => void;
}) {
  const { tree } = useContext(Ctx);
  const [menu, setMenu] = useState(false);
  // 要素が必要なきっかけに切り替えた直後は、要素を選ぶまで保存しない
  const [pending, setPending] = useState<TriggerValue | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closedAt = useRef(0);
  const shown = pending ?? value;
  const TriggerIcon = TRIGGER_ICON[shown.trigger];
  const element = shown.nodeId && shown.nodeId !== PAGE_TARGET ? tree.find((row) => row.id === shown.nodeId) : undefined;
  const watchesVariable = shown.trigger === "change" && shown.changeVariable !== undefined;

  const apply = (next: TriggerValue) => {
    if (next.nodeId === null) {
      setPending(next);
      return;
    }
    setPending(null);
    onChange({ ...next, nodeId: next.nodeId });
  };

  return (
    <section className="se-when" aria-label={tr("When")} style={catStyle("event")}>
      <h3 className="se-section-title">{tr("When")}</h3>
      <div className="se-when-card">
        <Ico icon={TriggerIcon} cat="event" size={16} />
        <div className="se-when-main">
          <div className="se-when-line">
            {!isPageTrigger(shown.trigger) && !watchesVariable && (
              <NodePicker
                // 保留が変わるたびに作り直し、開いたままの一覧を引き継がない
                key={pending ? `pending:${pending.trigger}` : "saved"}
                rows={tree}
                pickable={() => true}
                selectedId={element?.id ?? null}
                special={[]}
                onSpecial={() => {}}
                onPick={(row) => apply({ ...shown, nodeId: row.id })}
                label={element ? element.name : null}
                kind={element?.kind}
                missing={!!shown.nodeId && shown.nodeId !== PAGE_TARGET && !element}
                placeholder={tr("Select an element")}
                autoOpen={!!pending || (autoPick && shown.nodeId === null)}
                onDismiss={() => {
                  if (pending) setPending(null);
                  else if (shown.nodeId === null) onCancel?.();
                }}
              />
            )}
            {watchesVariable && (
              <TextIn vars value={shown.changeVariable ? `{${shown.changeVariable}}` : ""}
                placeholder={tr("Select a variable")} width={150}
                onCommit={(input) => {
                  const raw = input.trim();
                  const selected = singleValueReference(raw);
                  // 見張るのは変数の位置1つだけで、文字が混じったものは扱わない。
                  const name = selected ?? (!/[{}\s"'<>`]/.test(raw) ? raw : null);
                  if (name !== null) apply({ ...shown, changeVariable: name });
                }} />
            )}
            {isPageTrigger(shown.trigger) && (
              <span className="se-when-page"><FileText size={13} aria-hidden="true" />{tr("This page")}</span>
            )}
            <button
              ref={menuButton}
              type="button"
              className={`se-in se-when-trigger${menu ? " is-open" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={menu}
              onClick={() => {
                // 外側を押して閉じた直後の同じクリックで、開き直さない
                if (!menu && performance.now() - closedAt.current < 250) return;
                setMenu(!menu);
              }}
            >
              <span>{TRIGGER_LABELS[shown.trigger]}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          </div>
          {shown.trigger === "change" && (
            <div className="se-when-line">
              <span className="se-when-label">{tr("Watch")}</span>
              <select className="se-in" aria-label={tr("What to watch for changes")}
                value={watchesVariable ? "variable" : "element"}
                onChange={(event) => apply(event.target.value === "variable"
                  ? { trigger: "change", nodeId: PAGE_TARGET, changeVariable: "" }
                  : { trigger: "change", nodeId: null })}>
                <option value="element">{tr("an input field")}</option>
                <option value="variable">{tr("a variable")}</option>
              </select>
            </div>
          )}
          {shown.trigger === "hover-end" && shown.nodeId && (
            <label className="se-check">
              <input type="checkbox" checked={!!shown.keepOnShown}
                onChange={(event) => apply({ ...shown, keepOnShown: event.target.checked || undefined })} />
              {tr("Treat hovering over shown elements as still hovering")}
            </label>
          )}
          {isLink && (
            <p className="se-note">
              {tr("Output as a link")}
              <InfoTip text={tr("A script that only opens a page or web address when clicked is published as an ordinary link, so it also works for search engines and without JavaScript.")} />
            </p>
          )}
        </div>
      </div>
      {menu && (
        <Popover anchor={menuButton} width={240} height={270} className="se-trigger-menu"
          label={tr("Choose when this runs")}
          onClose={() => {
            closedAt.current = performance.now();
            setMenu(false);
          }}>
          {TRIGGERS.map((trigger) => {
            const Icon = TRIGGER_ICON[trigger];
            return (
              <button key={trigger} type="button"
                className={`se-picker-item${trigger === shown.trigger ? " is-current" : ""}`}
                style={catStyle("event")}
                aria-current={trigger === shown.trigger ? "true" : undefined}
                title={TRIGGER_HINT[trigger]}
                data-autofocus={trigger === shown.trigger ? "" : undefined}
                onClick={() => {
                  setMenu(false);
                  if (trigger !== shown.trigger) apply(withTrigger(shown, trigger));
                }}>
                <span className="se-ico" aria-hidden="true"><Icon size={15} strokeWidth={2} /></span>
                <span className="se-picker-title">{TRIGGER_LABELS[trigger]}</span>
              </button>
            );
          })}
        </Popover>
      )}
    </section>
  );
}

/** 新しいスクリプトの最初の一歩。「いつ動かすか」を、説明付きの大きなボタンから選ぶ。 */
export function TriggerChooser({ onPick, onCancel }: {
  onPick: (trigger: ScriptTrigger) => void;
  onCancel?: () => void;
}) {
  return (
    <section className="se-chooser" aria-labelledby="se-chooser-title">
      <h3 id="se-chooser-title">{tr("When should it run?")}</h3>
      <div className="se-chooser-grid">
        {TRIGGERS.map((trigger) => {
          const Icon = TRIGGER_ICON[trigger];
          return (
            <button key={trigger} type="button" className="se-chooser-item" style={catStyle("event")}
              data-trigger={trigger} data-tutorial={`se-trigger-${trigger}`}
              title={TRIGGER_HINT[trigger]} onClick={() => onPick(trigger)}>
              <TriggerArt trigger={trigger} />
              <span className="se-chooser-name">
                <Icon size={15} strokeWidth={2} aria-hidden="true" />{TRIGGER_LABELS[trigger]}
              </span>
            </button>
          );
        })}
      </div>
      {onCancel && (
        <button type="button" className="se-text-btn" onClick={onCancel}>{tr("Cancel")}</button>
      )}
    </section>
  );
}
