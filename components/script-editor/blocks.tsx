"use client";

/**
 * ワークスペースに並ぶブロックの見た目（きっかけ・動作・くり返し・差し込み位置）
 */

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Repeat, IterationCw, Split, X } from "lucide-react";
import { readableValue } from "../DataView";
import { isLinkScriptId, TRIGGER_LABELS, TRIGGER_ORDER, type PageScript } from "../../lib/script";
import { isDataStep, keyOfItem, firstListItem, type FetchStep } from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { singleValueReference } from "../../lib/variable-choice";
import { PAGE_TARGET, type ScriptStep, type ScriptTrigger } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { AnyArraySelect, itemFieldsOf } from "./arrays";
import { Ctx, LoopCtx, ScriptNodeCtx, ScriptOwnerCtx, ScriptStepCtx, type FetchPreviewScope } from "./context";
import { FetchResult } from "./fetch";
import { CondEditor, NumericVariableIn, Phrase, TextIn } from "./inputs";
import { CAT_OF, Ico, STEP_ICON, TRIGGER_ICON } from "./palette";
import { slotKey, type Loc } from "./step-tree";
import { StepBody } from "./StepBody";
import { chunkScriptSteps, estimateScriptStackHeight, SCRIPT_STEP_WINDOW_THRESHOLD, type StepChunk } from "./step-chunks";
import { observeScriptViewport } from "./visibility";
import { NodePicker } from "./targets";

/** 「リスト［］の要素ごとにくり返す」。中では要素の項目を {項目} で使える */
function ForEachView({
  step,
  loc,
  sel,
  handlers,
}: {
  step: Extract<ScriptStep, { kind: "for-each" }>;
  loc: Loc;
  sel: string;
  handlers: React.HTMLAttributes<HTMLDivElement>;
}) {
  const ctx = useContext(Ctx);
  const outer = useContext(LoopCtx);
  const key = `step:${step.id}`;
  const sample = step.array ? lookupVar(ctx.samples, step.array) : undefined;
  const loops = useMemo(() => {
    const fields = [...itemFieldsOf(sample), "ループ.値", "ループ.キー", "ループ.順番",
      ...(outer.length ? ["ループ.外側.値", "ループ.外側.キー", "ループ.外側.順番"] : [])];
    const item = firstListItem(sample);
    const samples = Object.fromEntries(
      fields.map((f) => [f, readableValue(item ? keyOfItem(item, f) : undefined)])
    );
    return [{ array: step.array, fields, roots: [...Object.keys(item ?? {}), "ループ"], samples }, ...outer];
  }, [sample, step.array, outer]);
  // 事前描画の処理では、くり返しを実行しない。警告するのはページを開いたときのスクリプトだけで、
  // 画面上のリストをくり返せるクリック時や変更時のスクリプトでは警告しない。
  const stuck = ctx.pageLoadScriptIds.has(loc.scriptId) && !ctx.serverStepIds.has(step.id);
  return (
    <div className={`se-c${sel}`} {...handlers}>
      <div className="se-blk se-c-head" data-sel-key={key}>
        <Ico icon={IterationCw} cat={CAT_OF[step.kind]} />
        <Phrase
          text="For each item in list {array}"
          parts={{
            array: (
              <AnyArraySelect
                value={step.array}
                onChange={(array) => ctx.updateStep(step.id, (s) => ({ ...s, array }) as ScriptStep)}
              />
            ),
          }}
        />
        {step.array && <span className="se-blk-note">{tr("Within the loop you can use {ループ.値}, {ループ.キー}, and {ループ.順番}")}</span>}
        {stuck && !ctx.readOnly && (
          <span className="se-badge is-warn">
            {tr("This loop contains actions or variable references that cannot run before the page is served. Check the nested blocks.")}
          </span>
        )}
      </div>
      <div className="se-c-body">
        <LoopCtx.Provider value={loops}>
          <StepList scriptId={loc.scriptId} list={`${step.id}:then`} steps={step.then} />
        </LoopCtx.Provider>
      </div>
    </div>
  );
}

function StepView({ step, loc }: { step: ScriptStep; loc: Loc }) {
  const ctx = useContext(Ctx);
  const outer = useContext(LoopCtx);
  const cat = CAT_OF[step.kind];
  const key = `step:${step.id}`;
  const sel = ctx.selected.has(key) ? " is-selected" : "";
  const handlers = ctx.readOnly
    ? {}
    : {
        onPointerDown: (e: React.PointerEvent) =>
          ctx.beginSteps(e, loc, step.id),
        onContextMenu: (e: React.MouseEvent) =>
          ctx.openMenu(e, { type: "step", loc }, key),
      };
  if (step.kind === "repeat") {
    const forever = typeof step.times === "number" && step.times <= 0;
    const setTimes = (times: number | string) =>
      ctx.updateStep(step.id, (s) => ({ ...s, times }) as ScriptStep);
    return (
      <div className={`se-c${sel}`} {...handlers}>
        <div className="se-blk se-c-head" data-sel-key={key}>
          <Ico icon={Repeat} cat={cat} />
          <Phrase
            text="Repeat {times} {mode}"
            parts={{
              times: !forever && (
                <NumericVariableIn value={step.times} onCommit={setTimes}
                  integer min={1} max={1000} width={52} />
              ),
              mode: (
                <select
                  className="se-in"
                  value={forever ? "forever" : "times"}
                  onChange={(e) => setTimes(e.target.value === "forever" ? 0 : 3)}
                >
                  <option value="times">{tr("times")}</option>
                  <option value="forever">{tr("forever")}</option>
                </select>
              ),
            }}
          />
          {forever && !step.then.some((x) => x.kind === "wait") && (
            <span className="se-badge is-warn">{tr("Add a \"Wait\" block inside to set the interval")}</span>
          )}
        </div>
        <div className="se-c-body">
          <LoopCtx.Provider value={[{ array: "", fields: ["ループ.値", "ループ.キー", "ループ.順番"], roots: ["ループ"], samples: {} }, ...outer]}>
            <StepList scriptId={loc.scriptId} list={`${step.id}:then`} steps={step.then} />
          </LoopCtx.Provider>
        </div>
      </div>
    );
  }
  if (step.kind === "for-each") {
    return <ForEachView step={step} loc={loc} sel={sel} handlers={handlers} />;
  }
  if (step.kind === "if") {
    const conditions = step.conditions ?? [];
    const changeCondition = (index: number, patch: Partial<(typeof conditions)[number]>) =>
      ctx.updateStep(step.id, (current) => current.kind !== "if" ? current : {
        ...current, conditions: (current.conditions ?? []).map((condition, i) =>
          i === index ? { ...condition, ...patch } : condition),
      });
    const removeCondition = (index: number) =>
      ctx.updateStep(step.id, (current) => current.kind !== "if" ? current : {
        ...current, conditions: (current.conditions ?? []).filter((_, i) => i !== index),
      });
    const addCondition = (and: boolean) =>
      ctx.updateStep(step.id, (current) => current.kind !== "if" ? current : {
        ...current, conditions: [...(current.conditions ?? []), {
          subject: "var" as const, target: "", left: "", op: "eq" as const, value: "", and,
        }],
      });
    return (
      <div className={`se-c${sel}`} {...handlers}>
        <div className="se-blk se-c-head" data-sel-key={key}>
          <Ico icon={Split} cat={cat} />
          <div className="se-if-conditions">
            <div className="se-if-condition-line">
              <Phrase text={conditions.length ? "If {cond}" : "If {cond} then"} parts={{
                cond: <CondEditor cond={step.cond}
                  onChange={(cond) => ctx.updateStep(step.id, (current) =>
                    current.kind === "if" ? { ...current, cond } : current)} />,
              }} />
            </div>
            {conditions.map((condition, index) => (
              <div key={index} className="se-if-condition-line">
                <Phrase
                  text={index === conditions.length - 1 ? "{join} {cond} then" : "{join} {cond}"}
                  parts={{
                    join: (
                      <select className="se-in se-fixed-select"
                        aria-label={tr("Join conditions with")}
                        value={condition.and ? "and" : "or"}
                        disabled={ctx.readOnly}
                        onChange={(event) => changeCondition(index, { and: event.target.value === "and" })}>
                        <option value="and">{tr("and")}</option>
                        <option value="or">{tr("or")}</option>
                      </select>
                    ),
                    cond: <CondEditor cond={condition}
                      onChange={(next) => changeCondition(index, next)} />,
                  }}
                />
                {!ctx.readOnly && (
                  <button type="button" className="se-mini"
                    aria-label={tr("Remove this condition")}
                    onClick={() => removeCondition(index)}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {!ctx.readOnly && (
              <div className="se-composer-condition-actions">
                <button type="button" className="se-mini se-mini-text"
                  disabled={conditions.length >= 32} onClick={() => addCondition(true)}>
                  <Plus size={12} />{tr("and")}
                </button>
                <button type="button" className="se-mini se-mini-text"
                  disabled={conditions.length >= 32} onClick={() => addCondition(false)}>
                  <Plus size={12} />{tr("or")}
                </button>
                {!step.else && (
                  <button type="button" className="se-mini se-mini-text"
                    onClick={() => ctx.updateStep(step.id, (current) =>
                      current.kind === "if" ? { ...current, else: [] } : current)}>
                    <Plus size={12} />{tr("Else")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="se-c-body">
          <StepList
            scriptId={loc.scriptId}
            list={`${step.id}:then`}
            steps={step.then}
          />
        </div>
        {step.else && (
          <>
            <div className="se-blk se-c-mid">
              <span>{tr("Else")}</span>
              {/* 中が空のときだけ外せる（中のブロックを消さないように） */}
              {!ctx.readOnly && !step.else.length && (
                <button
                  type="button"
                  className="se-mini"
                  aria-label={tr("Remove \"Else\"")}
                  onClick={() =>
                    ctx.updateStep(step.id, (s) => {
                      const { else: _else, ...rest } = s as Extract<ScriptStep, { kind: "if" }>;
                      return rest as ScriptStep;
                    })
                  }
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="se-c-body">
              <StepList
                scriptId={loc.scriptId}
                list={`${step.id}:else`}
                steps={step.else}
              />
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div
      className={`se-blk${sel}${step.kind === "list-display" && step.mode === "filter" ? " has-lines" : ""}`}
      data-sel-key={key}
      {...handlers}
    >
      <Ico icon={STEP_ICON[step.kind]} cat={cat} />
      <ScriptStepCtx.Provider value={step.id}><StepBody step={step} /></ScriptStepCtx.Provider>
      {isDataStep(step) && !ctx.readOnly && !ctx.isPageLoadRoot(loc) && (
        <span className="se-badge is-warn">
          {tr("Works when placed under the page's \"When the page opens\" script")}
        </span>
      )}
    </div>
  );
}

function Slot({ loc, empty }: { loc: Loc; empty?: boolean }) {
  const { readOnly, activeSlot } = useContext(Ctx);
  if (readOnly) {
    return empty ? <div className="se-slot is-empty">{tr("Drop actions here")}</div> : null;
  }
  const key = slotKey(loc);
  return (
    <div
      className={`se-slot${empty ? " is-empty" : ""}${activeSlot === key ? " is-active" : ""}`}
      data-slot={key}
      data-slot-kind="step"
    >
      {empty ? tr("Drop actions here") : null}
    </div>
  );
}

/**
 * 大きなワークスペースでは、近くの行だけをマウントする。どの代わりの要素も
 * 一覧全体のスクロールの高さを保ち、一度表示されたら見積もりの代わりに測った大きさを使う。
 * ブロックの ID と挿入位置の番号には、常に絞り込む前の元の一覧を使う。
 */
function StepChunkView({ scriptId, list, chunk }: {
  scriptId: string; list: string; chunk: StepChunk;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(chunk.start === 0);
  const measuredHeight = useRef<{ first: ScriptStep | undefined; last: ScriptStep | undefined; height: number } | null>(null);
  const first = chunk.steps[0];
  const last = chunk.steps[chunk.steps.length - 1];
  const placeholderHeight = measuredHeight.current?.first === first &&
    measuredHeight.current?.last === last
    ? measuredHeight.current.height : chunk.estimatedHeight;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observeScriptViewport(el, setRendered);
  }, []);

  useLayoutEffect(() => {
    if (!rendered || !ref.current) return;
    const el = ref.current;
    const measure = () => {
      const next = el.offsetHeight;
      if (next > 0) measuredHeight.current = { first, last, height: next };
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rendered, first, last]);

  return (
    <div className="se-virtual-chunk" ref={ref}
      style={rendered ? undefined : { height: placeholderHeight }}
      aria-hidden={rendered ? undefined : true}>
      {rendered && chunk.steps.map((step, i) => (
        <div key={step.id} className="se-item">
          <StepView step={step} loc={{ scriptId, list, index: chunk.start + i }} />
          <Slot loc={{ scriptId, list, index: chunk.start + i + 1 }} />
        </div>
      ))}
    </div>
  );
}

export function StepList({
  scriptId,
  list,
  steps,
}: {
  scriptId: string;
  list: string;
  steps: ScriptStep[];
}) {
  const chunks = useMemo(
    () => steps.length > SCRIPT_STEP_WINDOW_THRESHOLD ? chunkScriptSteps(steps) : null,
    [steps]
  );
  return (
    <div className="se-list">
      <Slot loc={{ scriptId, list, index: 0 }}
        empty={!steps.length && list !== "root"} />
      {chunks
        ? chunks.map((chunk) => (
            <StepChunkView key={chunk.start} scriptId={scriptId} list={list} chunk={chunk} />
          ))
        : steps.map((step, i) => (
            <div key={step.id} className="se-item">
              <StepView step={step} loc={{ scriptId, list, index: i }} />
              <Slot loc={{ scriptId, list, index: i + 1 }} />
            </div>
          ))}
    </div>
  );
}

function ElementSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { tree } = useContext(Ctx);
  const cur = value && value !== PAGE_TARGET ? tree.find((r) => r.id === value) : undefined;
  return (
    <NodePicker
      rows={tree}
      pickable={() => true}
      selectedId={cur?.id ?? null}
      special={[{ value: PAGE_TARGET, label: tr("This page"), on: value === PAGE_TARGET }]}
      onSpecial={(v) => onChange(v)}
      onPick={(r) => onChange(r.id)}
      label={value === PAGE_TARGET ? tr("This page") : cur ? cur.name : null}
      sub={cur?.attrId ? `#${cur.attrId}` : undefined}
      placeholder={tr("Select an element")}
      strong
    />
  );
}

export function HatView({
  trigger,
  onChange,
  nodeId,
  onNodeChange,
  keepOnShown,
  onKeepOnShownChange,
  changeVariable,
  onChangeVariable,
  onChangeSource,
  badge,
  handlers,
  selKey,
}: {
  trigger: ScriptTrigger;
  onChange?: (t: ScriptTrigger) => void;
  keepOnShown?: boolean;
  onKeepOnShownChange?: (v: boolean) => void;
  /** 定義されていれば（空でも）、変数の変更をきっかけにするスクリプトであることを表す。 */
  changeVariable?: string;
  onChangeVariable?: (name: string) => void;
  onChangeSource?: (source: "element" | "variable") => void;
  nodeId?: string | null;
  onNodeChange?: (id: string | null) => void;
  badge?: ReactNode;
  handlers?: Record<string, unknown>;
  selKey?: string;
}) {
  const { elements } = useContext(Ctx);
  return (
    <div className="se-blk se-hat" data-sel-key={selKey} {...handlers}>
      <Ico icon={TRIGGER_ICON[trigger]} cat="event" />
      {trigger === "change" && (
        <select className="se-in" aria-label={tr("When the value changes")}
          value={changeVariable === undefined ? "element" : "variable"}
          disabled={!onChangeSource}
          onChange={(e) => onChangeSource?.(e.target.value as "element" | "variable")}>
          <option value="element">{tr("Element")}</option>
          <option value="variable">{tr("Variables")}</option>
        </select>
      )}
      {trigger === "change" && changeVariable !== undefined ? (
        <TextIn vars value={changeVariable ? "{" + changeVariable + "}" : ""}
          placeholder={tr("Select a variable")} width={170}
          onCommit={(input) => {
            const raw = input.trim();
            const selected = singleValueReference(raw);
            // このきっかけが見張るのは、変数の位置1つだけで、文字が混じったものは扱わない。
            const name = selected ?? (!/[{}\s"'<>`]/.test(raw) ? raw : null);
            if (name !== null) onChangeVariable?.(name);
          }} />
      ) : onNodeChange ? (
        <ElementSelect value={nodeId ?? null} onChange={onNodeChange} />
      ) : (
        nodeId !== undefined && (
          <span className="se-in se-in-fake se-in-strong">
            {nodeId === PAGE_TARGET
              ? tr("This page")
              : (elements.find((e) => e.id === nodeId)?.label ?? tr("Element"))}
          </span>
        )
      )}
      {onChange ? (
        <select
          className="se-in"
          value={trigger}
          onChange={(e) => onChange(e.target.value as ScriptTrigger)}
        >
          {(nodeId === PAGE_TARGET
            ? (changeVariable !== undefined ? (["change", "load"] as const) : (["load"] as const))
            : TRIGGER_ORDER).map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
      ) : (
        <span>{TRIGGER_LABELS[trigger]}</span>
      )}
      {trigger === "hover-end" && (
        <label className="se-check">
          <input
            type="checkbox"
            checked={!!keepOnShown}
            disabled={!onKeepOnShownChange}
            onChange={(e) => onKeepOnShownChange?.(e.target.checked)}
          />
          {tr("Treat hovering over shown elements as still hovering")}
        </label>
      )}
      {badge}
    </div>
  );
}

export function StackView({ script, fixedWidth }: { script: PageScript; fixedWidth?: number }) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  const [inViewport, setInViewport] = useState(false);
  const measured = useRef<{
    steps: ScriptStep[]; width: number; height: number;
  } | null>(null);
  const estimatedHeight = useMemo(() => estimateScriptStackHeight(script.steps), [script.steps]);
  const mounted = ctx.readOnly || !ctx.virtualizeStacks || inViewport;
  const placeholder = measured.current?.steps === script.steps
    ? measured.current : { width: 320, height: estimatedHeight };

  useEffect(() => {
    const el = ref.current;
    if (!el || ctx.readOnly || !ctx.virtualizeStacks) return;
    return observeScriptViewport(el, setInViewport);
  }, [ctx.readOnly, ctx.virtualizeStacks]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !mounted || !ctx.virtualizeStacks || ctx.readOnly) return;
    const measure = () => {
      const height = el.offsetHeight;
      const width = el.offsetWidth;
      if (height > 0 && width > 0) {
        measured.current = { steps: script.steps, height, width };
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, script.steps, ctx.readOnly, ctx.virtualizeStacks]);

  const headKey = slotKey({ scriptId: script.id, list: "head", index: 0 });
  const scriptKey = `script:${script.id}`;
  const runnable = !!script.trigger && !!script.nodeId &&
    (script.trigger !== "change" || script.changeVariable === undefined || !!script.changeVariable.trim());
  return (
    <ScriptOwnerCtx.Provider value={{ scriptId: script.id, nodeId: script.nodeId }}>
    <ScriptNodeCtx.Provider value={script.nodeId && script.nodeId !== PAGE_TARGET ? script.nodeId : ""}>
    <div
      ref={ref}
      className={`se-stack${runnable ? "" : " is-idle"}${
        ctx.selected.has(scriptKey) ? " is-selected" : ""
      }${ctx.focusNodeId && script.nodeId === ctx.focusNodeId ? " is-focus" : ""}`}
      data-script-node={script.nodeId ?? undefined}
      data-script-id={script.id}
      style={
        ctx.readOnly
          ? (fixedWidth === undefined ? undefined : { width: fixedWidth })
          : { left: script.pos.x, top: script.pos.y, zIndex: ctx.zOrder.get(script.id),
              ...(!mounted ? { width: placeholder.width, height: placeholder.height } : {}),
              ...(fixedWidth !== undefined ? { width: fixedWidth } : {}) }
      }
    >
      {mounted && (script.trigger ? (
        <HatView
          trigger={script.trigger}
          onChange={
            ctx.readOnly
              ? undefined
              : (t) => ctx.updateScript(script.id, {
                  trigger: t,
                  ...(script.changeVariable !== undefined && t !== "change"
                    ? { changeVariable: undefined, nodeId: t === "load" ? PAGE_TARGET : null }
                    : {}),
                })
          }
          changeVariable={script.changeVariable}
          onChangeVariable={
            ctx.readOnly ? undefined : (name) => ctx.updateScript(script.id, { changeVariable: name })
          }
          onChangeSource={
            ctx.readOnly ? undefined : (source) => ctx.updateScript(script.id, {
              changeVariable: source === "variable" ? "" : undefined,
              nodeId: source === "variable" ? PAGE_TARGET : null,
            })
          }
          keepOnShown={script.keepOnShown}
          onKeepOnShownChange={
            ctx.readOnly
              ? undefined
              : (v) => ctx.updateScript(script.id, { keepOnShown: v || undefined })
          }
          nodeId={script.nodeId}
          onNodeChange={
            ctx.readOnly
              ? undefined
              : (id) =>
                  ctx.updateScript(script.id, {
                    nodeId: id,
                    // 「このページ」のきっかけは「ページを開いたとき」だけ
                    ...(id === PAGE_TARGET ? { trigger: "load" as const } : {}),
                  })
          }
          badge={
            isLinkScriptId(script.id) ? (
              <span className="se-badge">{tr("Output as a link")}</span>
            ) : script.trigger === "change" && script.changeVariable === "" ? (
              <span className="se-badge is-warn">{tr("Select a variable")}</span>
            ) : !script.nodeId ? (
              <span className="se-badge is-warn">{tr("Won't run until an element is chosen")}</span>
            ) : undefined
          }
          selKey={ctx.readOnly ? undefined : scriptKey}
          handlers={
            ctx.readOnly
              ? undefined
              : {
                  onPointerDown: (e: React.PointerEvent) =>
                    ctx.beginScript(e, script),
                  onContextMenu: (e: React.MouseEvent) =>
                    ctx.openMenu(
                      e,
                      { type: "script", scriptId: script.id },
                      scriptKey
                    ),
                }
          }
        />
      ) : (
        !ctx.readOnly && (
          <div
            className={`se-hat-slot${ctx.activeSlot === headKey ? " is-active" : ""}`}
            data-slot={headKey}
            data-slot-kind="head"
          >
            {tr("Won't run without a trigger")}
          </div>
        )
      ))}
      {mounted && <StepList scriptId={script.id} list="root" steps={script.steps} />}
    </div>
    </ScriptNodeCtx.Provider>
    </ScriptOwnerCtx.Provider>
  );
}

/** 取得したデータを表で確認する小窓 */
export function PeekModal({ step, scope, onClose }: { step: FetchStep; scope: FetchPreviewScope; onClose: () => void }) {
  return <FetchResult step={step} scope={scope} onClose={onClose} />;
}

export function PaletteLabel({ label }: { label: string }) {
  const parts = label.split(/(［[^］]*］)/).filter(Boolean);
  return (
    <span className="se-pal-text">
      {parts.map((p, i) =>
        p.startsWith("［") ? (
          <span key={i} className="se-in se-in-fake">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
}
