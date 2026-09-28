"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, CircleCheck, ClipboardPaste, Copy, FileText, Plus, Redo2, Scissors, Trash2, TriangleAlert, Undo2, X, Zap,
} from "lucide-react";
import { componentOf, useEditor } from "../lib/store";
import SafeBoundary from "./SafeBoundary";
import { glyphs } from "./Glyph";
import {
  applyPageScripts, cloneSteps, isLinkScriptId, pageScriptsOf, scriptUid, walkSteps,
  TRIGGER_LABELS, type PageScript,
} from "../lib/script";
import { stepText } from "../lib/script-text";
import { pageArrays, pagePlan, pageVariableIndex, previewDataVars, renameVarInPage, type FetchStep } from "../lib/data";
import { PAGE_TARGET, type Script, type ScriptStep, type ScriptTrigger } from "../lib/types";
import { tr } from "../lib/i18n";
import { ActionPicker } from "./script-editor/ActionPicker";
import { CAT_OF, Ico, STEP_ICON, TRIGGER_ICON, isPageTrigger } from "./script-editor/catalog";
import { copyScriptBlocks, pasteScriptBlocks, type ScriptBlockClipboard } from "./script-editor/clipboard";
import { Ctx, ScriptNodeCtx, ScriptOwnerCtx, type EdCtx, type FetchPreviewScope } from "./script-editor/context";
import { FetchResult } from "./script-editor/fetch";
import { indexFieldTargets } from "./script-editor/field-index";
import { FlowCtx, SelectionCtx, StepList, type FlowActions } from "./script-editor/Flow";
import { scriptStatus } from "./script-editor/issues";
import { Popover } from "./script-editor/Popover";
import { ScriptList } from "./script-editor/ScriptList";
import {
  connectNewTransform, findStepLoc, insertAt, listIn, listInsideLoop, mapStep, nudgeStep,
  numberFilters, removeKeys, type Loc,
} from "./script-editor/step-tree";
import { buildTree, collectTargets } from "./script-editor/targets";
import { TriggerCard, TriggerChooser, type TriggerValue } from "./script-editor/TriggerCard";
import { readScriptClipboard, rememberScriptClipboard, useEditorKeys, type EditorKeyState } from "./script-editor/useEditorKeys";
import { useStepDrag } from "./script-editor/useStepDrag";

/* ---------- 設定パネル用の一覧 ---------- */

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

/* ---------- 本体 ---------- */

/**
 * ページのスクリプトの画面。左にページ内のスクリプトの一覧、右に選んだスクリプトの
 * 「いつ」と「すること」を上から順に並べる。
 * focusNodeId: 要素の設定から開いたときの要素（新しいスクリプトのきっかけの要素にする）
 */
export default function ScriptEditor(props: {
  focusNodeId?: string | null;
  focusScriptId?: string | null;
  onClose: () => void;
}) {
  return (
    <SafeBoundary label={tr("Script editor")} onClose={props.onClose}>
      <ScriptEditorInner {...props} />
    </SafeBoundary>
  );
}

interface AnchoredMenu<T> {
  anchor: { current: HTMLElement | null };
  value: T;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ScriptEditorInner({
  focusNodeId = null,
  focusScriptId = null,
  onClose,
}: {
  focusNodeId?: string | null;
  /** 開いたときに表示するスクリプト */
  focusScriptId?: string | null;
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const updateDoc = useEditor((s) => s.updateDoc);
  const updatePageScripts = useEditor((s) => s.updatePageScripts);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const page = doc.pages[activePageId];

  // コンポーネント編集中・コンポーネント内の要素から開いたときは、そのマスターも含める
  const extraRootIds = useMemo(() => [
    editingComponentId ? doc.components?.[editingComponentId]?.rootId : null,
    focusNodeId ? doc.components?.[componentOf(doc, focusNodeId) ?? ""]?.rootId : null,
  ].filter((id): id is string => !!id), [doc, editingComponentId, focusNodeId]);
  const tree = useMemo(() => buildTree(doc, activePageId, extraRootIds), [doc, activePageId, extraRootIds]);
  const nodeIds = useMemo(() => tree.map((row) => row.id), [tree]);
  const scripts = useMemo(() => pageScriptsOf(doc, nodeIds, activePageId), [doc, nodeIds, activePageId]);
  const pageLoadScriptIds = useMemo(() => new Set(
    scripts.filter((s) => s.nodeId === PAGE_TARGET && s.trigger === "load").map((s) => s.id)
  ), [scripts]);
  const serverStepIds = useMemo(() => pagePlan(doc, activePageId).serverIds, [doc, activePageId]);
  const targets = useMemo(() => collectTargets(doc, nodeIds), [doc, nodeIds]);
  const targetLookup = useMemo(() => {
    const firstByAttr = new Map<string, (typeof tree)[number]>();
    const firstNodeIds = new Set<string>();
    for (const row of tree) {
      if (!row.attrId || firstByAttr.has(row.attrId)) continue;
      firstByAttr.set(row.attrId, row);
      firstNodeIds.add(row.id);
    }
    return { firstByAttr, firstNodeIds };
  }, [tree]);
  const fieldLookup = useMemo(() => indexFieldTargets(doc, tree), [doc, tree]);
  const arrays = useMemo(() => pageArrays(doc, activePageId), [doc, activePageId]);
  const { samples, listCounts } = useMemo(() => {
    const listCounts: Record<string, number> = {};
    return { samples: previewDataVars(doc, activePageId, { listCounts }), listCounts };
  }, [doc, activePageId]);
  const variableIndex = useMemo(() => pageVariableIndex(doc, activePageId), [doc, activePageId]);
  // 値の加工は、すべて同じ値の候補を使う。動作ごとにページの全変数のオブジェクトを作り直さない。
  const transformSources = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(samples)) {
      if (!name.startsWith("#")) Object.defineProperty(values, name, {
        value, enumerable: true, configurable: true, writable: true,
      });
    }
    for (const name of variableIndex.names) {
      if (!Object.hasOwn(values, name)) Object.defineProperty(values, name, {
        value: undefined, enumerable: true, configurable: true, writable: true,
      });
    }
    return values;
  }, [samples, variableIndex]);

  const rootRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const announce = useCallback((text: string) => {
    const live = liveRef.current;
    if (!live) return;
    // 同じ文が続いても読み上げられるよう、いったん空にしてから入れる
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = text; });
  }, []);

  /* ---------- 開いているスクリプト ---------- */

  const [openId, setOpenId] = useState<string | null>(() =>
    (focusScriptId && scripts.some((s) => s.id === focusScriptId) ? focusScriptId : null) ??
    (focusNodeId ? scripts.find((s) => s.nodeId === focusNodeId)?.id : undefined) ??
    (focusNodeId ? null : scripts[0]?.id ?? null));
  /** 作り始めたが、まだ要素を選んでいないスクリプト（保存しない） */
  const [draft, setDraft] = useState<TriggerValue | null>(null);
  const [choosing, setChoosing] = useState(() => openId === null);
  const open = scripts.find((s) => s.id === openId) ?? null;

  // 「クリックしたとき → 開く」だけのスクリプトは保存するとリンクになり、ID が変わる。
  // 開いていたスクリプトを見失ったら、同じ要素の新しい ID のもの（無ければ同じ順番のもの）を開く。
  const seen = useRef<{ ids: Set<string>; nodeId: string; ordinal: number } | null>(null);
  useEffect(() => {
    if (open) {
      const siblings = scripts.filter((s) => s.nodeId === open.nodeId);
      seen.current = { ids: new Set(scripts.map((s) => s.id)), nodeId: open.nodeId, ordinal: siblings.indexOf(open) };
      return;
    }
    const previous = seen.current;
    if (!openId || !previous) return;
    const siblings = scripts.filter((s) => s.nodeId === previous.nodeId);
    // 消えた（元に戻す・削除など）ときは、同じ要素の近くのもの、無ければページの最初のものを開く
    const next = siblings.find((s) => !previous.ids.has(s.id)) ??
      siblings[Math.min(previous.ordinal, siblings.length - 1)] ?? scripts[0] ?? null;
    seen.current = null;
    setOpenId(next?.id ?? null);
    if (!next) setChoosing(true);
  }, [scripts, open, openId]);

  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  // 元に戻す操作や共同編集で消えた動作を、選択に残さない
  useEffect(() => {
    if (!selected.length) return;
    const ids = new Set<string>();
    if (open) walkSteps(open.steps, (step) => { ids.add(step.id); });
    const valid = selected.filter((id) => ids.has(id));
    if (valid.length !== selected.length) setSelected(valid);
  }, [open, selected]);

  const [picker, setPicker] = useState<AnchoredMenu<Loc> | null>(null);
  const [stepMenu, setStepMenu] = useState<AnchoredMenu<{ loc: Loc; stepId: string }> | null>(null);
  const [scriptMenu, setScriptMenu] = useState<AnchoredMenu<string> | null>(null);
  // 外側を押して閉じた直後の同じクリックで、同じボタンから開き直さない
  const closed = useRef<{ anchor: HTMLElement | null; at: number }>({ anchor: null, at: 0 });
  const reopening = (anchor: HTMLElement) =>
    closed.current.anchor === anchor && performance.now() - closed.current.at < 250;
  const noteClosed = (menu: AnchoredMenu<unknown> | null) => {
    closed.current = { anchor: menu?.anchor.current ?? null, at: performance.now() };
  };

  /** 取得したデータを確認する小窓（取得の動作の ID） */
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekScope, setPeekScope] = useState<FetchPreviewScope>({ nodeId: "", localNames: [] });
  const peekStep = useMemo(() => {
    if (!peekId) return null;
    for (const sc of scripts) {
      const owner = peekScope.owner;
      if (owner && (sc.id !== owner.scriptId || sc.nodeId !== owner.nodeId)) continue;
      let found: FetchStep | null = null;
      walkSteps(sc.steps, (step) => {
        if (step.kind === "fetch" && step.id === peekId) found = step;
      });
      if (found) return found;
    }
    return null;
  }, [scripts, peekId, peekScope]);

  /* ---------- 編集 ---------- */

  const commit = useCallback((next: PageScript[]) => {
    updatePageScripts(activePageId, nodeIds, numberFilters(next));
  }, [updatePageScripts, activePageId, nodeIds]);
  const scriptsRef = useRef(scripts);
  scriptsRef.current = scripts;
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // 並びが変わったカードを、元の位置から新しい位置へ動いて見せる（FLIP）
  const layout = useRef<Map<string, number> | null>(null);
  const captureLayout = useCallback(() => {
    const flow = flowRef.current;
    if (!flow || reducedMotion()) return;
    const tops = new Map<string, number>();
    flow.querySelectorAll<HTMLElement>("[data-step-id]").forEach((card) => {
      tops.set(card.dataset.stepId!, card.getBoundingClientRect().top);
    });
    layout.current = tops;
  }, []);
  useLayoutEffect(() => {
    const before = layout.current;
    const flow = flowRef.current;
    layout.current = null;
    if (!before || !flow) return;
    flow.querySelectorAll<HTMLElement>("[data-step-id]").forEach((card) => {
      const from = before.get(card.dataset.stepId!);
      if (from === undefined) return;
      const distance = from - card.getBoundingClientRect().top;
      // 親のカードと一緒に動く分は、親のアニメーションに任せる
      const parent = card.parentElement?.closest<HTMLElement>("[data-step-id]");
      const parentFrom = parent ? before.get(parent.dataset.stepId!) : undefined;
      const parentDistance = parent && parentFrom !== undefined ? parentFrom - parent.getBoundingClientRect().top : 0;
      const own = distance - parentDistance;
      if (Math.abs(own) < 1) return;
      card.animate([{ translate: `0 ${own}px` }, { translate: "0 0" }], {
        duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    });
  }, [scripts]);

  const openScript = (id: string | null) => {
    setOpenId(id);
    setDraft(null);
    setChoosing(id === null);
    setSelected([]);
    flowRef.current?.scrollTo({ top: 0 });
  };

  const createScript = (value: TriggerValue & { nodeId: string }) => {
    const id = scriptUid();
    const { nodeId, ...rest } = value;
    commit([...scriptsRef.current, { id, steps: [], ...rest, nodeId }]);
    openScript(id);
    announce(tr("Created a script. Add the first action."));
  };
  const startScript = (trigger: ScriptTrigger) => {
    if (isPageTrigger(trigger)) createScript({ trigger, nodeId: PAGE_TARGET });
    else if (focusNodeId && nodeIds.includes(focusNodeId)) createScript({ trigger, nodeId: focusNodeId });
    else {
      setChoosing(false);
      setOpenId(null);
      setDraft({ trigger, nodeId: null });
    }
  };
  const changeTrigger = (script: PageScript, value: TriggerValue & { nodeId: string }) => {
    const { id, steps } = script;
    commit(scriptsRef.current.map((s) => s.id === id ? { id, steps, ...value } : s));
  };
  const deleteScript = (id: string) => {
    const list = scriptsRef.current;
    const index = list.findIndex((s) => s.id === id);
    commit(removeKeys(list, [`script:${id}`]));
    if (id === openId) openScript(list[index + 1]?.id ?? list[index - 1]?.id ?? null);
    announce(tr("Deleted the script. Press Undo to bring it back."));
  };
  const duplicateScript = (id: string) => {
    const source = scriptsRef.current.find((s) => s.id === id);
    if (!source) return;
    const copy = { ...source, id: scriptUid(), steps: cloneSteps(source.steps) };
    commit([...scriptsRef.current, copy]);
    openScript(copy.id);
  };

  const deleteSteps = (ids: readonly string[]) => {
    if (!ids.length) return;
    commit(removeKeys(scriptsRef.current, ids.map((id) => `step:${id}`)));
    setSelected([]);
    announce(ids.length > 1
      ? tr("Deleted {n} actions. Press Undo to bring them back.", { n: ids.length })
      : tr("Deleted the action. Press Undo to bring it back."));
  };
  /** 選んだ動作のうち、他の選んだ動作の中に入っていないものだけを、それぞれの直後に複製する。 */
  const duplicateSteps = (ids: readonly string[]) => {
    if (!open || !ids.length) return;
    let next = scriptsRef.current;
    const made: string[] = [];
    const chosen = new Set(ids);
    const roots: string[] = [];
    const collect = (steps: ScriptStep[]) => {
      for (const step of steps) {
        if (chosen.has(step.id)) roots.push(step.id);
        else if ("then" in step) {
          collect(step.then);
          if (step.kind === "if" && step.else) collect(step.else);
        }
      }
    };
    collect(open.steps);
    for (const id of roots) {
      const script = next.find((s) => s.id === open.id);
      const loc = script && findStepLoc(script, id);
      const source = loc && listIn(script, loc.list)?.[loc.index];
      if (!loc || !source) continue;
      const [copy] = cloneSteps([source]);
      next = insertAt(next, { ...loc, index: loc.index + 1 }, [copy]);
      made.push(copy.id);
    }
    if (!made.length) return;
    captureLayout();
    commit(next);
    setSelected(made);
  };
  const nudge = (loc: Loc, stepId: string, direction: -1 | 1) => {
    const next = nudgeStep(scriptsRef.current, loc, direction);
    if (next === scriptsRef.current) return;
    captureLayout();
    commit(next);
    setSelected([stepId]);
    refocus.current = { stepId, selector: ".se-grip" };
    announce(direction < 0
      ? tr("Moved up to position {n}.", { n: loc.index })
      : tr("Moved down to position {n}.", { n: loc.index + 2 }));
  };

  /** 追加や移動の後に、描画し直されたカードへフォーカスを戻す */
  const refocus = useRef<{ stepId: string; selector: string } | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const card = flowRef.current?.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(target.stepId)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "nearest", inline: "nearest" });
    card.querySelector<HTMLElement>(target.selector)?.focus({ preventScroll: true });
  }, [scripts]);

  const addStep = (loc: Loc, step: ScriptStep) => {
    const steps = connectNewTransform(scriptsRef.current, loc, [step]);
    captureLayout();
    commit(insertAt(scriptsRef.current, loc, steps));
    setPicker(null);
    setSelected([steps[0].id]);
    // まだ決めていない欄（要素やリストを選ぶボタン）があれば、そこから続けて選べるようにする。
    // 文字の入力欄には移さない（フォーカスしただけで候補の一覧が開き、次の操作の邪魔になる）。
    refocus.current = { stepId: steps[0].id, selector: ".se-card-body button.se-in.is-empty" };
    announce(tr("Added the action. Fill in its settings."));
  };

  const clipboardIds = (focusedStepId?: string): string[] =>
    focusedStepId && !selectedRef.current.includes(focusedStepId)
      ? [focusedStepId] : selectedRef.current;
  const copySelection = (focusedStepId?: string): ScriptBlockClipboard | null =>
    copyScriptBlocks(scriptsRef.current, clipboardIds(focusedStepId).map((id) => `step:${id}`));
  const pasteSelection = (copied: ScriptBlockClipboard, focusedStepId?: string) => {
    const result = pasteScriptBlocks(scriptsRef.current,
      clipboardIds(focusedStepId).map((id) => `step:${id}`), copied, openIdRef.current);
    if (!result) return;
    captureLayout();
    commit(result.scripts);
    const added = result.selection.filter((key) => key.startsWith("step:")).map((key) => key.slice(5));
    setSelected(added);
    if (added.length) refocus.current = { stepId: added[0], selector: ".se-grip" };
  };
  const copySteps = (ids: readonly string[]): boolean => {
    const copied = copyScriptBlocks(scriptsRef.current, ids.map((id) => `step:${id}`));
    if (!copied) return false;
    rememberScriptClipboard(copied);
    return true;
  };
  const cutSteps = (ids: readonly string[]) => {
    if (copySteps(ids)) deleteSteps(ids);
  };
  const pasteFromClipboard = () => {
    // Clipboard API は非同期。読み込み中に別のスクリプトを開いた場合は、
    // 常にその時点の開いているスクリプトへ貼り付ける。
    void readScriptClipboard().then((copied) => {
      if (copied && rootRef.current?.isConnected) pasteSelection(copied);
    });
  };

  const drag = useStepDrag({
    rootRef, flowRef, lineRef,
    getScripts: () => scriptsRef.current,
    getSelected: () => selectedRef.current,
    setSelected,
    commit,
    captureLayout,
    announce,
  });

  const keys = useRef<EditorKeyState>(null!);
  keys.current = {
    selected,
    cancelDrag: drag.cancel,
    dragging: drag.active,
    clearSelection: () => setSelected([]),
    deleteSelected: (focusedStepId) => deleteSteps(clipboardIds(focusedStepId)),
    duplicateSelected: () => duplicateSteps(selected),
    selectAll: () => setSelected(open ? open.steps.map((step) => step.id) : []),
    copySelection,
    pasteSelection,
    onClose,
  };
  useEditorKeys(keys);
  // キャンバスの選択枠などを、この画面を開閉した後の大きさに合わせ直させる
  useEffect(() => {
    const opened = setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    return () => {
      clearTimeout(opened);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    };
  }, []);

  const flow = useMemo<FlowActions>(() => ({
    select: (event, stepId) => {
      // 入力欄にフォーカスが残っていると Backspace が文字の削除になるため、フォーカスを外す
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        setSelected((previous) => previous.includes(stepId)
          ? previous.filter((id) => id !== stepId) : [...previous, stepId]);
      } else setSelected([stepId]);
    },
    grab: drag.grab,
    nudge: (loc, stepId, direction) => nudgeRef.current(loc, stepId, direction),
    openPicker: (anchor, loc) => {
      if (reopening(anchor)) return;
      setPicker({ anchor: { current: anchor }, value: loc });
    },
    openMenu: (anchor, loc, stepId) => {
      if (reopening(anchor)) return;
      setSelected((previous) => previous.includes(stepId) ? previous : [stepId]);
      setStepMenu({ anchor: { current: anchor }, value: { loc, stepId } });
    },
    // drag.grab は変わらない。メニューを開き直さない判定は ref を読む。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [drag.grab]);
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;

  const ctx = useMemo<EdCtx>(() => ({
    doc,
    pageId: activePageId,
    scriptRootIds: extraRootIds,
    targets,
    tree,
    targetLookup,
    fieldLookup,
    scripts,
    variableIndex,
    transformSources,
    listCounts,
    pageLoadScriptIds,
    serverStepIds,
    // 取得のように後から呼ばれることがあるため、描画した時点ではなく最新の状態に適用する
    updateStep: (stepId, fn) =>
      commit(mapStep(pageScriptsOf(useEditor.getState().doc, nodeIds, activePageId), stepId, fn)),
    isPageLoadRoot: (loc) => loc.list === "root" && pageLoadScriptIds.has(loc.scriptId),
    renameVar: (stepId, from, to) =>
      updateDoc((d) => {
        applyPageScripts(
          d,
          activePageId,
          nodeIds,
          mapStep(numberFilters(pageScriptsOf(d, nodeIds, activePageId)), stepId, (x) =>
            (x.kind === "fetch" ? { ...x, as: to } : { ...x, into: to }) as ScriptStep
          )
        );
        if (from) renameVarInPage(d, activePageId, from, to);
      }),
    openPeek: (fetchStepId, scope) => {
      setPeekScope(scope);
      setPeekId(fetchStepId);
    },
    arrays,
    samples,
  }), [doc, activePageId, extraRootIds, targets, tree, targetLookup, fieldLookup, scripts,
    variableIndex, transformSources, pageLoadScriptIds, serverStepIds, commit, updateDoc,
    nodeIds, arrays, samples, listCounts]);

  if (!page) return null;

  const status = open ? scriptStatus(open) : null;
  const menuStep = stepMenu && open ? listIn(open, stepMenu.value.loc.list)?.[stepMenu.value.loc.index] : null;
  const menuList = stepMenu && open ? listIn(open, stepMenu.value.loc.list) : null;
  const menuCount = stepMenu && selected.includes(stepMenu.value.stepId) ? selected.length : 1;
  const closeStepMenu = () => {
    noteClosed(stepMenu);
    setStepMenu(null);
  };

  return createPortal(
    <div
      className="se-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={rootRef}
        className="se"
        data-tutorial="settings-link"
        role="dialog"
        aria-modal="true"
        aria-labelledby="se-title"
      >
        <header className="se-header">
          <div className="se-title">
            <h2 id="se-title">{tr("Scripts")}</h2>
            <span className="se-page"><FileText size={12} aria-hidden="true" />{page.name}</span>
          </div>
          <div className="se-tools">
            <button className="se-icon-btn" onClick={() => useEditor.getState().undo()} disabled={!canUndo}
              aria-label={tr("Undo")} data-tip={tr("Undo (⌘Z)")}>
              <Undo2 size={16} aria-hidden="true" />
            </button>
            <button className="se-icon-btn" onClick={() => useEditor.getState().redo()} disabled={!canRedo}
              aria-label={tr("Redo")} data-tip={tr("Redo (⇧⌘Z)")}>
              <Redo2 size={16} aria-hidden="true" />
            </button>
            <span className="se-tools-sep" />
            <button className="se-icon-btn" onClick={pasteFromClipboard} disabled={!open}
              aria-label={tr("Paste")} data-tip={tr("Paste")}>
              <ClipboardPaste size={16} aria-hidden="true" />
            </button>
            <span className="se-tools-sep" />
            <button className="se-icon-btn" onClick={onClose} aria-label={tr("Close")}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <Ctx.Provider value={ctx}>
          <div className="se-main">
            <ScriptList
              doc={doc}
              scripts={scripts}
              tree={tree}
              openId={open?.id ?? null}
              focusNodeId={focusNodeId}
              creating={choosing || !!draft}
              onOpen={openScript}
              onNew={() => openScript(null)}
              onMenu={(anchor, scriptId) => {
                if (reopening(anchor)) return;
                setScriptMenu({ anchor: { current: anchor }, value: scriptId });
              }}
            />
            <div
              ref={flowRef}
              className="se-flow"
              data-tutorial="se-workspace"
              onPointerDown={(e) => {
                // 何もない所を押したら、選択を外す
                if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("se-flow-inner")) {
                  setSelected([]);
                }
              }}
            >
              <div className="se-flow-inner">
                {open ? (
                  <ScriptOwnerCtx.Provider value={{ scriptId: open.id, nodeId: open.nodeId }}>
                    <ScriptNodeCtx.Provider value={open.nodeId === PAGE_TARGET ? "" : open.nodeId}>
                      <TriggerCard
                        key={open.id}
                        value={open}
                        isLink={isLinkScriptId(open.id)}
                        onChange={(value) => changeTrigger(open, value)}
                      />
                      <section className="se-do" aria-label={tr("Then do")}>
                        <div className="se-do-head">
                          <h3 className="se-section-title">{tr("Then do")}</h3>
                          {status && (
                            <p className={`se-status${status.ready ? " is-ready" : ""}`} role="status">
                              {status.ready
                                ? <CircleCheck size={13} aria-hidden="true" />
                                : <TriangleAlert size={13} aria-hidden="true" />}
                              {status.message}
                            </p>
                          )}
                        </div>
                        <FlowCtx.Provider value={flow}>
                          <SelectionCtx.Provider value={selectedSet}>
                            <StepList scriptId={open.id} list="root" steps={open.steps}
                              label={tr("Actions, in the order they run")} />
                          </SelectionCtx.Provider>
                        </FlowCtx.Provider>
                      </section>
                    </ScriptNodeCtx.Provider>
                  </ScriptOwnerCtx.Provider>
                ) : draft ? (
                  <>
                    <TriggerCard
                      key={`draft:${draft.trigger}`}
                      value={draft}
                      autoPick
                      onChange={createScript}
                      onCancel={() => {
                        setDraft(null);
                        setChoosing(true);
                      }}
                    />
                    <section className="se-do is-waiting" aria-label={tr("Then do")} aria-disabled="true">
                      <h3 className="se-section-title">{tr("Then do")}</h3>
                      <div className="se-add" aria-hidden="true"><Plus size={14} />{tr("Add the first action")}</div>
                    </section>
                  </>
                ) : (
                  <TriggerChooser
                    onPick={startScript}
                    onCancel={scripts.length ? () => openScript(scripts[0].id) : undefined}
                  />
                )}
              </div>
            </div>
          </div>
          {peekStep && (
            <SafeBoundary label={tr("Fetched data")} onClose={() => setPeekId(null)}>
              <FetchResult step={peekStep} scope={peekScope} onClose={() => setPeekId(null)} />
            </SafeBoundary>
          )}
        </Ctx.Provider>
        <div ref={lineRef} className="se-drop-line" hidden aria-hidden="true" />
        <p ref={liveRef} className="se-live" aria-live="polite" />
        {picker && open && (
          <ActionPicker
            anchor={picker.anchor}
            place={{
              pageLoadRoot: picker.value.list === "root" && pageLoadScriptIds.has(open.id),
              insideLoop: listInsideLoop(open, picker.value.list),
            }}
            onPick={(step) => addStep(picker.value, step)}
            onClose={() => {
              noteClosed(picker);
              setPicker(null);
            }}
          />
        )}
        {stepMenu && menuStep && menuList && (
          <Popover anchor={stepMenu.anchor} width={220} height={300} className="se-menu"
            label={tr("Action options")} onClose={closeStepMenu}>
            <button type="button" disabled={menuCount > 1 || stepMenu.value.loc.index === 0}
              onClick={() => {
                closeStepMenu();
                nudge(stepMenu.value.loc, stepMenu.value.stepId, -1);
              }}>
              <ArrowUp size={14} aria-hidden="true" />{tr("Move up")}<kbd>{glyphs("⌥↑")}</kbd>
            </button>
            <button type="button"
              disabled={menuCount > 1 || stepMenu.value.loc.index >= menuList.length - 1}
              onClick={() => {
                closeStepMenu();
                nudge(stepMenu.value.loc, stepMenu.value.stepId, 1);
              }}>
              <ArrowDown size={14} aria-hidden="true" />{tr("Move down")}<kbd>{glyphs("⌥↓")}</kbd>
            </button>
            <button type="button" onClick={() => {
              const ids = menuCount > 1 ? selected : [stepMenu.value.stepId];
              closeStepMenu();
              copySteps(ids);
            }}>
              <Copy size={14} aria-hidden="true" />{tr("Copy")}<kbd>{glyphs("⌘C")}</kbd>
            </button>
            <button type="button" onClick={() => {
              const ids = menuCount > 1 ? selected : [stepMenu.value.stepId];
              closeStepMenu();
              cutSteps(ids);
            }}>
              <Scissors size={14} aria-hidden="true" />{tr("Cut")}<kbd>{glyphs("⌘X")}</kbd>
            </button>
            <button type="button" onClick={() => {
              closeStepMenu();
              pasteFromClipboard();
            }}>
              <ClipboardPaste size={14} aria-hidden="true" />{tr("Paste")}<kbd>{glyphs("⌘V")}</kbd>
            </button>
            <button type="button" onClick={() => {
              closeStepMenu();
              duplicateSteps(menuCount > 1 ? selected : [stepMenu.value.stepId]);
            }}>
              <Copy size={14} aria-hidden="true" />{tr("Duplicate")}<kbd>{glyphs("⌘D")}</kbd>
            </button>
            <button type="button" className="is-danger" onClick={() => {
              closeStepMenu();
              deleteSteps(menuCount > 1 ? selected : [stepMenu.value.stepId]);
            }}>
              <Trash2 size={14} aria-hidden="true" />
              {menuCount > 1 ? tr("Delete {menuCount} actions", { menuCount }) : tr("Delete")}<kbd>⌫</kbd>
            </button>
          </Popover>
        )}
        {scriptMenu && (
          <Popover anchor={scriptMenu.anchor} width={200} height={110} className="se-menu"
            label={tr("Script options")}
            onClose={() => {
              noteClosed(scriptMenu);
              setScriptMenu(null);
            }}>
            <button type="button" onClick={() => {
              setScriptMenu(null);
              duplicateScript(scriptMenu.value);
            }}>
              <Copy size={14} aria-hidden="true" />{tr("Duplicate")}
            </button>
            <button type="button" className="is-danger" onClick={() => {
              setScriptMenu(null);
              deleteScript(scriptMenu.value);
            }}>
              <Trash2 size={14} aria-hidden="true" />{tr("Delete script")}
            </button>
          </Popover>
        )}
      </div>
    </div>,
    document.body
  );
}
