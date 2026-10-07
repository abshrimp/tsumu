"use client";

/**
 * 「すること」の流れ。動作を上から順にカードで並べ、カードの間から動作を追加できる。
 * 「もし」「くり返す」は、中に入れた動作を字下げした枠で囲んで表示する。
 */

import {
  createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { MoreHorizontal, Plus, TriangleAlert, X } from "lucide-react";
import { readableValue } from "../DataView";
import { isDataStep, keyOfItem, firstListItem } from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { type ScriptStep } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { AnyArraySelect, itemFieldsOf } from "./arrays";
import { CAT_OF, Ico, STEP_ICON, catStyle } from "./catalog";
import { Ctx, LoopCtx, ScriptStepCtx, type LoopInfo } from "./context";
import { PathMenu } from "./fetch";
import { CondEditor, NumericVariableIn, Phrase } from "./inputs";
import { stepIssue } from "./issues";
import { StepBody } from "./StepBody";
import { chunkScriptSteps, SCRIPT_STEP_WINDOW_THRESHOLD, type StepChunk } from "./step-chunks";
import { type Loc } from "./step-tree";
import { observeScriptViewport } from "./visibility";

/** カードの操作（選択・並べ替え・追加・メニュー）。ScriptEditor が実装を渡す。 */
export interface FlowActions {
  /** 修飾キーを押しながらカードを選択する */
  select: (event: React.PointerEvent | React.KeyboardEvent, stepId: string) => void;
  /** カードの操作部品以外をつかんだ（ドラッグで並べ替える） */
  grab: (event: React.PointerEvent, loc: Loc, stepId: string) => void;
  /** カードにフォーカスして Alt + 上下で並べ替える */
  nudge: (loc: Loc, stepId: string, direction: -1 | 1) => void;
  openPicker: (anchor: HTMLElement, loc: Loc) => void;
  openMenu: (anchor: HTMLElement, loc: Loc, stepId: string) => void;
}

export const FlowCtx = createContext<FlowActions>(null!);
/** 選択中の動作の ID。選択が変わっても、関係の無いカードを描画し直さないよう分けて持つ。 */
export const SelectionCtx = createContext<ReadonlySet<string>>(new Set());

const LOOP_FIELDS = ["ループ.値", "ループ.キー", "ループ.順番"];

function useLoops(array: string | null): LoopInfo[] {
  const { samples } = useContext(Ctx);
  const outer = useContext(LoopCtx);
  const sample = array ? lookupVar(samples, array) : undefined;
  return useMemo(() => {
    const nested = outer.length ? ["ループ.外側.値", "ループ.外側.キー", "ループ.外側.順番"] : [];
    if (array === null) {
      return [{ array: "", fields: [...LOOP_FIELDS, ...nested], roots: ["ループ"], samples: {} }, ...outer];
    }
    const fields = [...itemFieldsOf(sample), ...LOOP_FIELDS, ...nested];
    const item = firstListItem(sample);
    const values = Object.fromEntries(
      fields.map((field) => [field, readableValue(item ? keyOfItem(item, field) : undefined)])
    );
    return [{ array, fields, roots: [...Object.keys(item ?? {}), "ループ"], samples: values }, ...outer];
  }, [sample, array, outer]);
}

function ConditionEditor({ cond, onChange }: {
  cond: Parameters<typeof CondEditor>[0]["cond"];
  onChange: Parameters<typeof CondEditor>[0]["onChange"];
}) {
  return <CondEditor cond={cond} onChange={onChange}
    renderPathMenu={(root, path, onPick) => (
      <PathMenu root={root} path={path} onChange={onPick}
        mode="any" allowRoot={false} portalZIndex={550}
        ariaLabel={tr("Source variable")} placeholder={tr("Select a variable")} />
    )}
  />;
}

/** 動作の見出しと操作メニュー。ドラッグはカード全体から開始できる。 */
function CardChrome({ step, loc, issue, issueId, children }: {
  step: ScriptStep; loc: Loc; issue: string | null; issueId: string; children: React.ReactNode;
}) {
  const flow = useContext(FlowCtx);
  const name = tr("Action {n}", { n: loc.index + 1 });
  return (
    <div className="se-card-head">
      <Ico icon={STEP_ICON[step.kind]} cat={CAT_OF[step.kind]} />
      <div className="se-card-body">{children}</div>
      {/* まだ決めていない欄があることは、文ではなく印で示す（内容はツールチップと読み上げで伝える） */}
      {issue && (
        <span className="se-todo" id={issueId} data-tip={issue}>
          <TriangleAlert size={13} aria-hidden="true" />
          <span className="se-sr">{issue}</span>
        </span>
      )}
      <button
        type="button"
        className="se-icon-btn se-card-more"
        aria-label={tr("More options for {name}", { name })}
        aria-haspopup="dialog"
        onClick={(event) => flow.openMenu(event.currentTarget, loc, step.id)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function Issue({ id, text, warn = true }: { id?: string; text: string; warn?: boolean }) {
  return (
    <p className={`se-issue${warn ? "" : " is-info"}`} id={id}>
      <TriangleAlert size={12} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

function IfHead({ step }: { step: Extract<ScriptStep, { kind: "if" }> }) {
  const { updateStep } = useContext(Ctx);
  const conditions = step.conditions ?? [];
  const update = (fn: (current: Extract<ScriptStep, { kind: "if" }>) => ScriptStep) =>
    updateStep(step.id, (current) => current.kind === "if" ? fn(current) : current);
  const changeCondition = (index: number, patch: Partial<(typeof conditions)[number]>) =>
    update((current) => ({
      ...current, conditions: (current.conditions ?? []).map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition),
    }));
  const addCondition = (and: boolean) => update((current) => ({
    ...current, conditions: [...(current.conditions ?? []), {
      subject: "var" as const, target: "", left: "", op: "eq" as const, value: "", and,
    }],
  }));
  return (
    <div className="se-conds">
      <div className="se-cond-line">
        <Phrase text={conditions.length ? "If {cond}" : "If {cond} then"} parts={{
          cond: <ConditionEditor cond={step.cond} onChange={(cond) => update((current) => ({ ...current, cond }))} />,
        }} />
      </div>
      {conditions.map((condition, index) => (
        <div key={index} className="se-cond-line">
          <Phrase
            text={index === conditions.length - 1 ? "{join} {cond} then" : "{join} {cond}"}
            parts={{
              join: (
                <select className="se-in" aria-label={tr("Join conditions with")}
                  value={condition.and ? "and" : "or"}
                  onChange={(event) => changeCondition(index, { and: event.target.value === "and" })}>
                  <option value="and">{tr("and")}</option>
                  <option value="or">{tr("or")}</option>
                </select>
              ),
              cond: <ConditionEditor cond={condition} onChange={(next) => changeCondition(index, next)} />,
            }}
          />
          <button type="button" className="se-mini" aria-label={tr("Remove this condition")}
            onClick={() => update((current) => ({
              ...current, conditions: (current.conditions ?? []).filter((_, i) => i !== index),
            }))}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="se-cond-actions">
        <button type="button" className="se-mini se-mini-text"
          disabled={conditions.length >= 32} onClick={() => addCondition(true)}>
          <Plus size={12} aria-hidden="true" />{tr("and")}
        </button>
        <button type="button" className="se-mini se-mini-text"
          disabled={conditions.length >= 32} onClick={() => addCondition(false)}>
          <Plus size={12} aria-hidden="true" />{tr("or")}
        </button>
      </div>
    </div>
  );
}

function RepeatHead({ step }: { step: Extract<ScriptStep, { kind: "repeat" }> }) {
  const { updateStep } = useContext(Ctx);
  const forever = typeof step.times === "number" && step.times <= 0;
  const setTimes = (times: number | string) => updateStep(step.id, (s) => ({ ...s, times }) as ScriptStep);
  return (
    <>
      <Phrase
        text="Repeat {times} {mode}"
        parts={{
          times: !forever && (
            <NumericVariableIn value={step.times} onCommit={setTimes} integer min={1} max={1000} width={52} />
          ),
          mode: (
            <select className="se-in" aria-label={tr("How long to repeat")}
              value={forever ? "forever" : "times"}
              onChange={(event) => setTimes(event.target.value === "forever" ? 0 : 3)}>
              <option value="times">{tr("times")}</option>
              <option value="forever">{tr("forever")}</option>
            </select>
          ),
        }}
      />
      {forever && !step.then.some((child) => child.kind === "wait") && (
        <Issue text={tr("Add a \"Wait\" block inside to set the interval")} />
      )}
    </>
  );
}

function ForEachHead({ step, loc }: { step: Extract<ScriptStep, { kind: "for-each" }>; loc: Loc }) {
  const ctx = useContext(Ctx);
  // 事前描画の処理では、くり返しを実行しない。警告するのはページを開いたときのスクリプトだけ。
  const stuck = ctx.pageLoadScriptIds.has(loc.scriptId) && !ctx.serverStepIds.has(step.id);
  return (
    <>
      <Phrase
        text="For each item in list {array}"
        parts={{
          array: <AnyArraySelect value={step.array}
            onChange={(array) => ctx.updateStep(step.id, (s) => ({ ...s, array }) as ScriptStep)} />,
        }}
      />
      {step.array && (
        <span className="se-note">
          {tr("Within the loop you can use {ループ.値}, {ループ.キー}, and {ループ.順番}")}
        </span>
      )}
      {stuck && (
        <Issue text={tr("This loop contains actions or variable references that cannot run before the page is served. Check the nested blocks.")} />
      )}
    </>
  );
}

function Branch({ scriptId, list, steps, label, loops }: {
  scriptId: string; list: string; steps: ScriptStep[]; label: string; loops?: LoopInfo[];
}) {
  const body = <StepList scriptId={scriptId} list={list} steps={steps} label={label} nested />;
  return (
    <div className="se-branch">
      {loops ? <LoopCtx.Provider value={loops}>{body}</LoopCtx.Provider> : body}
    </div>
  );
}

function LoopBranch({ step, scriptId }: {
  step: Extract<ScriptStep, { kind: "repeat" | "for-each" }>; scriptId: string;
}) {
  const loops = useLoops(step.kind === "for-each" ? step.array : null);
  return <Branch scriptId={scriptId} list={`${step.id}:then`} steps={step.then}
    label={tr("Actions to repeat")} loops={loops} />;
}

// 操作欄のクリックや文字入力を、カードの移動として取り扱わない。
const ACTION_CONTROL = "input, select, textarea, button, label, a, [contenteditable]:not([contenteditable='false']), [role='button']";

const StepCard = memo(function StepCard({ step, loc }: { step: ScriptStep; loc: Loc }) {
  const ctx = useContext(Ctx);
  const flow = useContext(FlowCtx);
  const selected = useContext(SelectionCtx).has(step.id);
  const issue = stepIssue(step);
  const misplaced = isDataStep(step) && !ctx.isPageLoadRoot(loc);
  const issueId = `se-issue-${step.id}`;
  const container = step.kind === "if" || step.kind === "repeat" || step.kind === "for-each";
  return (
    <div
      className={`se-card${container ? " is-container" : ""}${selected ? " is-selected" : ""}${issue ? " has-issue" : ""}`}
      style={catStyle(CAT_OF[step.kind])}
      data-step-id={step.id}
      data-step-kind={step.kind}
      role="group"
      tabIndex={0}
      aria-label={tr("Action {n}", { n: loc.index + 1 })}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      aria-describedby={issue ? issueId : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest(ACTION_CONTROL)) return;
        // 入れ子のブロックをつかんだときは、そのブロックだけを動かす。
        if ((event.target as Element).closest("[data-step-id]") !== event.currentTarget) return;
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          flow.select(event, step.id);
          return;
        }
        // 移動するかどうかが決まるまで選択を保持する（複数選択のドラッグに必要）。
        flow.grab(event, loc, step.id);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          event.stopPropagation();
          flow.nudge(loc, step.id, event.key === "ArrowUp" ? -1 : 1);
        } else if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          flow.select(event, step.id);
        }
      }}
      onClick={(event) => {
        // 入力欄や入れ子のカードの操作は通常どおり動作させる。
        if ((event.target as Element).closest(ACTION_CONTROL)) return;
        if ((event.target as Element).closest("[data-step-id]") !== event.currentTarget) return;
        if (window.getSelection()?.toString()) return;
        event.currentTarget.focus({ preventScroll: true });
      }}
    >
      <CardChrome step={step} loc={loc} issue={issue} issueId={issueId}>
        <ScriptStepCtx.Provider value={step.id}>
          {step.kind === "if" ? <IfHead step={step} />
            : step.kind === "repeat" ? <RepeatHead step={step} />
            : step.kind === "for-each" ? <ForEachHead step={step} loc={loc} />
            : <StepBody step={step} />}
        </ScriptStepCtx.Provider>
        {misplaced && (
          <Issue text={tr("Works when placed under the page's \"When the page opens\" script")} />
        )}
      </CardChrome>
      {step.kind === "if" && (
        <>
          <Branch scriptId={loc.scriptId} list={`${step.id}:then`} steps={step.then}
            label={tr("Actions when the condition is met")} />
          {step.else ? (
            <>
              <div className="se-else">
                <span>{tr("Otherwise")}</span>
                {/* 中が空のときだけ外せる（中の動作を消さないように） */}
                {!step.else.length && (
                  <button type="button" className="se-mini" aria-label={tr("Remove \"Else\"")}
                    onClick={() => ctx.updateStep(step.id, (s) => {
                      const { else: _else, ...rest } = s as Extract<ScriptStep, { kind: "if" }>;
                      return rest as ScriptStep;
                    })}>
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
              <Branch scriptId={loc.scriptId} list={`${step.id}:else`} steps={step.else}
                label={tr("Actions when the condition is not met")} />
            </>
          ) : (
            <button type="button" className="se-else-add"
              onClick={() => ctx.updateStep(step.id, (current) =>
                current.kind === "if" ? { ...current, else: [] } : current)}>
              <Plus size={13} aria-hidden="true" />{tr("Add what happens otherwise")}
            </button>
          )}
        </>
      )}
      {(step.kind === "repeat" || step.kind === "for-each") && (
        <LoopBranch step={step} scriptId={loc.scriptId} />
      )}
    </div>
  );
}, (before, after) => before.step === after.step && before.loc.scriptId === after.loc.scriptId &&
  before.loc.list === after.loc.list && before.loc.index === after.loc.index);

/** カードの間。ポインターを近づけるかフォーカスすると「＋」が現れ、そこに動作を足せる。 */
function Gap({ loc }: { loc: Loc }) {
  const flow = useContext(FlowCtx);
  return (
    <div className="se-gap">
      <button type="button" className="se-gap-btn" aria-label={tr("Add an action here")}
        aria-haspopup="dialog"
        onClick={(event) => flow.openPicker(event.currentTarget, loc)}>
        <Plus size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * とても長い並びでは、近くの行だけを描画する。描画していない部分も高さを保ち、
 * 一度表示されたら見積もりの代わりに測った高さを使う。
 */
function StepChunkView({ scriptId, list, chunk }: { scriptId: string; list: string; chunk: StepChunk }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(chunk.start === 0);
  const measured = useRef<{ first: ScriptStep | undefined; last: ScriptStep | undefined; height: number } | null>(null);
  const first = chunk.steps[0];
  const last = chunk.steps[chunk.steps.length - 1];
  const height = measured.current?.first === first && measured.current?.last === last
    ? measured.current.height : chunk.estimatedHeight;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observeScriptViewport(el, setRendered);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!rendered || !el) return;
    const measure = () => {
      if (el.offsetHeight > 0) measured.current = { first, last, height: el.offsetHeight };
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rendered, first, last]);

  return (
    <div className="se-chunk" ref={ref}
      style={rendered ? undefined : { height }}
      aria-hidden={rendered ? undefined : true}>
      {rendered && chunk.steps.map((step, i) => (
        <StepItem key={step.id} step={step} loc={{ scriptId, list, index: chunk.start + i }} />
      ))}
    </div>
  );
}

function StepItem({ step, loc }: { step: ScriptStep; loc: Loc }) {
  return (
    <>
      <Gap loc={loc} />
      <StepCard step={step} loc={loc} />
    </>
  );
}

export function StepList({ scriptId, list, steps, label, nested = false }: {
  scriptId: string;
  list: string;
  steps: ScriptStep[];
  label: string;
  nested?: boolean;
}) {
  const flow = useContext(FlowCtx);
  const chunks = useMemo(
    () => steps.length > SCRIPT_STEP_WINDOW_THRESHOLD ? chunkScriptSteps(steps) : null,
    [steps]
  );
  const end: Loc = { scriptId, list, index: steps.length };
  return (
    <div className={`se-steps${nested ? " is-nested" : ""}${steps.length ? "" : " is-empty"}`}
      data-list={list} role="group" aria-label={label}>
      {chunks
        ? chunks.map((chunk) => (
            <StepChunkView key={chunk.start} scriptId={scriptId} list={list} chunk={chunk} />
          ))
        : steps.map((step, index) => (
            <StepItem key={step.id} step={step} loc={{ scriptId, list, index }} />
          ))}
      <button type="button" className="se-add" aria-haspopup="dialog"
        data-tutorial={nested ? undefined : "se-add"}
        onClick={(event) => flow.openPicker(event.currentTarget, end)}>
        <Plus size={14} aria-hidden="true" />
        {steps.length ? tr("Add an action") : nested ? tr("Add an action here") : tr("Add the first action")}
      </button>
    </div>
  );
}
