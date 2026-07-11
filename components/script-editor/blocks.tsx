"use client";

/**
 * ワークスペースに並ぶブロックの見た目（きっかけ・動作・繰り返し・差し込み位置）
 */

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Repeat, IterationCw, RefreshCw, Split, X } from "lucide-react";
import { JsonPeek, readableValue } from "../DataView";
import { isLinkScriptId, TRIGGER_LABELS, TRIGGER_ORDER, type PageScript } from "../../lib/script";
import { isDataStep, keyOfItem, pagePlan, toListItems, type FetchStep } from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { PAGE_TARGET, type ScriptStep, type ScriptTrigger } from "../../lib/types";
import { getLang, tr } from "../../lib/i18n";
import { AnyArraySelect, itemFieldsOf } from "./arrays";
import { Ctx, LoopCtx, ScriptNodeCtx } from "./context";
import { fetchWhole, useRefetch, wholeCache, wholeKey } from "./fetch";
import { CondEditor, Phrase, TextIn } from "./inputs";
import { CAT_OF, Ico, STEP_ICON, TRIGGER_ICON } from "./palette";
import { slotKey, type Loc } from "./step-tree";
import { StepBody } from "./StepBody";
import { NodePicker } from "./targets";

/** 「配列［］の要素ごとにくり返す」。中では要素の項目を {項目} で使える */
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
    const fields = itemFieldsOf(sample);
    const item = toListItems(sample)[0];
    const samples = Object.fromEntries(
      fields.map((f) => [f, readableValue(item ? keyOfItem(item, f) : undefined)])
    );
    return [{ array: step.array, fields, samples }, ...outer];
  }, [sample, step.array, outer]);
  // 配信前に値が決まる配列（見本がある）は、配信前に動く形でないと何もしない
  const { doc, pageId } = ctx;
  const stuck = useMemo(
    () => sample !== undefined && !pagePlan(doc, pageId).serverIds.has(step.id),
    [doc, pageId, sample, step.id]
  );
  return (
    <div className={`se-c${sel}`} {...handlers}>
      <div className="se-blk se-c-head" data-sel-key={key}>
        <Ico icon={IterationCw} cat={CAT_OF[step.kind]} />
        <Phrase
          text="配列{array}の要素ごとにくり返す"
          parts={{
            array: (
              <AnyArraySelect
                value={step.array}
                onChange={(array) => ctx.updateStep(step.id, (s) => ({ ...s, array }) as ScriptStep)}
              />
            ),
          }}
        />
        {step.array && <span className="se-blk-note">{tr("中では要素の項目を {項目} で使えます")}</span>}
        {stuck && !ctx.readOnly && (
          <span className="se-badge is-warn">
            {tr("取得したデータの配列は、ページを開いたときのスクリプトの直下で、中を「項目として格納」と変数の「もし」だけにすると動きます")}
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
    const forever = step.times <= 0;
    const setTimes = (times: number) =>
      ctx.updateStep(step.id, (s) => ({ ...s, times }) as ScriptStep);
    return (
      <div className={`se-c${sel}`} {...handlers}>
        <div className="se-blk se-c-head" data-sel-key={key}>
          <Ico icon={Repeat} cat={cat} />
          <Phrase
            text="{times}{mode}"
            parts={{
              times: !forever && (
                <TextIn
                  type="number"
                  value={String(step.times)}
                  width={52}
                  onCommit={(v) => setTimes(Math.max(1, Math.min(1000, Math.round(Number(v) || 1))))}
                />
              ),
              mode: (
                <select
                  className="se-in"
                  value={forever ? "forever" : "times"}
                  onChange={(e) => setTimes(e.target.value === "forever" ? 0 : 3)}
                >
                  <option value="times">{tr("回くり返す")}</option>
                  <option value="forever">{tr("ずっとくり返す")}</option>
                </select>
              ),
            }}
          />
          {forever && !step.then.some((x) => x.kind === "wait") && (
            <span className="se-badge is-warn">{tr("中に「秒待つ」を入れると間隔を決められます")}</span>
          )}
        </div>
        <div className="se-c-body">
          <StepList scriptId={loc.scriptId} list={`${step.id}:then`} steps={step.then} />
        </div>
      </div>
    );
  }
  if (step.kind === "for-each") {
    return <ForEachView step={step} loc={loc} sel={sel} handlers={handlers} />;
  }
  if (step.kind === "if") {
    return (
      <div className={`se-c${sel}`} {...handlers}>
        <div className="se-blk se-c-head" data-sel-key={key}>
          <Ico icon={Split} cat={cat} />
          <Phrase
            text="もし{cond}なら"
            parts={{
              cond: (
                <CondEditor
                  cond={step.cond}
                  onChange={(c) => ctx.updateStep(step.id, (s) => ({ ...s, cond: c }) as ScriptStep)}
                />
              ),
            }}
          />
          {!ctx.readOnly && !step.else && (
            <button
              type="button"
              className="se-mini se-mini-text"
              onClick={() => ctx.updateStep(step.id, (s) => ({ ...s, else: [] }) as ScriptStep)}
            >
              <Plus size={12} />
              {tr("でなければ")}
            </button>
          )}
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
              <span>{tr("でなければ")}</span>
              {/* 中が空のときだけ外せる（中のブロックを消さないように） */}
              {!ctx.readOnly && !step.else.length && (
                <button
                  type="button"
                  className="se-mini"
                  aria-label={tr("「でなければ」を外す")}
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
      className={`se-blk${sel}${step.kind === "filter-array" && step.or?.length ? " has-lines" : ""}`}
      data-sel-key={key}
      {...handlers}
    >
      <Ico icon={STEP_ICON[step.kind]} cat={cat} />
      <StepBody step={step} />
      {isDataStep(step) && !ctx.readOnly && !ctx.isPageLoadRoot(loc) && (
        <span className="se-badge is-warn">
          {tr("ページを開いたときのスクリプトの下に置くと動きます")}
        </span>
      )}
    </div>
  );
}

function Slot({ loc, empty }: { loc: Loc; empty?: boolean }) {
  const { readOnly, activeSlot } = useContext(Ctx);
  if (readOnly) {
    return empty ? <div className="se-slot is-empty">{tr("動作をここへ")}</div> : null;
  }
  const key = slotKey(loc);
  return (
    <div
      className={`se-slot${empty ? " is-empty" : ""}${activeSlot === key ? " is-active" : ""}`}
      data-slot={key}
      data-slot-kind="step"
    >
      {empty ? tr("動作をここへ") : null}
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
  return (
    <div className="se-list">
      <Slot
        loc={{ scriptId, list, index: 0 }}
        empty={!steps.length && list !== "root"}
      />
      {steps.map((s, i) => (
        <div key={s.id} className="se-item">
          <StepView step={s} loc={{ scriptId, list, index: i }} />
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
      special={[{ value: PAGE_TARGET, label: tr("このページ"), on: value === PAGE_TARGET }]}
      onSpecial={(v) => onChange(v)}
      onPick={(r) => onChange(r.id)}
      label={value === PAGE_TARGET ? tr("このページ") : cur ? cur.name : null}
      sub={cur?.attrId ? `#${cur.attrId}` : undefined}
      placeholder={tr("要素を選択")}
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
  badge,
  handlers,
  selKey,
}: {
  trigger: ScriptTrigger;
  onChange?: (t: ScriptTrigger) => void;
  keepOnShown?: boolean;
  onKeepOnShownChange?: (v: boolean) => void;
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
      {onNodeChange ? (
        <ElementSelect value={nodeId ?? null} onChange={onNodeChange} />
      ) : (
        nodeId !== undefined && (
          <span className="se-in se-in-fake se-in-strong">
            {nodeId === PAGE_TARGET
              ? tr("このページ")
              : (elements.find((e) => e.id === nodeId)?.label ?? tr("要素"))}
          </span>
        )
      )}
      {onChange ? (
        <select
          className="se-in"
          value={trigger}
          onChange={(e) => onChange(e.target.value as ScriptTrigger)}
        >
          {(nodeId === PAGE_TARGET ? (["load"] as const) : TRIGGER_ORDER).map((t) => (
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
          {tr("表示した要素の上ではホバー中とみなす")}
        </label>
      )}
      {badge}
    </div>
  );
}

export function StackView({ script }: { script: PageScript }) {
  const ctx = useContext(Ctx);
  const headKey = `${script.id}|head|0`;
  const scriptKey = `script:${script.id}`;
  const runnable = !!script.trigger && !!script.nodeId;
  return (
    <ScriptNodeCtx.Provider value={script.nodeId && script.nodeId !== PAGE_TARGET ? script.nodeId : ""}>
    <div
      className={`se-stack${runnable ? "" : " is-idle"}${
        ctx.selected.has(scriptKey) ? " is-selected" : ""
      }${ctx.focusNodeId && script.nodeId === ctx.focusNodeId ? " is-focus" : ""}`}
      data-script-node={script.nodeId ?? undefined}
      data-script-id={script.id}
      style={
        ctx.readOnly
          ? undefined
          : { left: script.pos.x, top: script.pos.y, zIndex: ctx.zOrder.get(script.id) }
      }
    >
      {script.trigger ? (
        <HatView
          trigger={script.trigger}
          onChange={
            ctx.readOnly
              ? undefined
              : (t) => ctx.updateScript(script.id, { trigger: t })
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
                    // このページのきっかけは「ページを開いたとき」だけ
                    ...(id === PAGE_TARGET ? { trigger: "load" as const } : {}),
                  })
          }
          badge={
            isLinkScriptId(script.id) ? (
              <span className="se-badge">{tr("リンクとして出力")}</span>
            ) : !script.nodeId ? (
              <span className="se-badge is-warn">{tr("要素を選ぶまで実行されません")}</span>
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
            {tr("きっかけが無いため実行されません")}
          </div>
        )
      )}
      <StepList scriptId={script.id} list="root" steps={script.steps} />
    </div>
    </ScriptNodeCtx.Provider>
  );
}

/** 取得したデータを表で見る小窓 */
export function PeekModal({ step, onClose }: { step: FetchStep; onClose: () => void }) {
  const { busy, error, run } = useRefetch(step);
  // 見本は配列を先頭だけに切り詰めているため、開いたら全件を取り直して見せる
  const key = wholeKey(step);
  const [whole, setWhole] = useState<{ key: string; value: unknown } | null>(() =>
    wholeCache.has(key) ? { key, value: wholeCache.get(key) } : null
  );
  const [wholeError, setWholeError] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const st = stepRef.current;
    if (wholeCache.has(key) || !st.url.trim()) return;
    let alive = true;
    setWholeError(false);
    fetchWhole(st.url.trim(), st)
      .then((value) => {
        wholeCache.set(key, value);
        if (alive) setWhole({ key, value });
      })
      .catch(() => {
        if (alive) setWholeError(true);
      });
    return () => {
      alive = false;
    };
  }, [key]);
  const full = whole?.key === key;
  return (
    <div className="se-modal" role="dialog" aria-label={tr("取得したデータ")}>
      <div className="se-modal-head">
        <h3>{tr("取得したデータ")}</h3>
        <button
          className="se-close"
          onClick={() => void run()}
          disabled={busy}
          aria-label={tr("取得し直す")}
          data-tip={tr("取得し直す")}
        >
          <RefreshCw size={15} className={busy ? "spin" : undefined} />
        </button>
        <button className="se-close" onClick={onClose} aria-label={tr("閉じる")}>
          <X size={16} />
        </button>
      </div>
      <p className="hint" style={{ margin: 0, wordBreak: "break-all" }}>
        {step.method && step.method !== "GET" ? `${step.method} ` : ""}
        {step.url}
        {full
          ? ""
          : wholeError
            ? tr("（全件を取得できなかったため、{p1} に取得した見本を表示しています。一覧は先頭20件まで）", {
                p1: new Date(step.fetchedAt ?? Date.now()).toLocaleString(getLang()),
              })
            : tr("（全件を読み込み中… いまは見本の先頭20件を表示しています）")}
      </p>
      {error && <p className="hint is-error" style={{ margin: 0 }}>{error}</p>}
      <JsonPeek value={full ? whole!.value : step.sample} />
    </div>
  );
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
