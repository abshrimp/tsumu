"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Search, Undo2, X, Zap } from "lucide-react";
import { componentOf, useEditor } from "../lib/store";
import SafeBoundary from "./SafeBoundary";
import { glyphs } from "./Glyph";
import { InfoTip } from "./controls";
import { applyPageScripts, cloneSteps, pageNodeIds, pageScriptsOf, scriptUid, walkSteps, TRIGGER_LABELS, type PageScript } from "../lib/script";
import { stepText } from "../lib/script-text";
import { pageArrays, pagePlan, pageVariableIndex, previewDataVars, renameVarInPage, type FetchStep } from "../lib/data";
import { PAGE_TARGET, type Script, type ScriptStep } from "../lib/types";
import { tr, trNodes } from "../lib/i18n";
import { HatView, PaletteLabel, PeekModal, StackView, StepList } from "./script-editor/blocks";
import { Ctx, type EdCtx, type FetchPreviewScope } from "./script-editor/context";
import {
  CAT_INFO,
  CAT_OF,
  CAT_ORDER,
  Ico,
  findPaletteItems,
  STEP_ICON,
  TRIGGER_ICON,
  type Payload,
} from "./script-editor/palette";
import { insertAt, listIn, mapStep, numberFilters, removeKeys, takeAt } from "./script-editor/step-tree";
import { buildTree, collectTargets, type MenuTarget } from "./script-editor/targets";
import { useScriptDrag } from "./script-editor/useScriptDrag";
import { useScriptEditorKeys } from "./script-editor/useScriptEditorKeys";

// The global editor context changes when one selected block changes. Scope
// selection and z-order to each script so the other block trees do not redraw.
const EMPTY_SCRIPT_KEYS: readonly string[] = [];
const ScopedStackView = memo(function ScopedStackView({
  script, shared, selectedKeys, zIndex,
}: {
  script: PageScript;
  shared: EdCtx;
  selectedKeys: readonly string[];
  zIndex?: number;
}) {
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const context = useMemo<EdCtx>(() => ({
    ...shared,
    selected,
    zOrder: zIndex === undefined ? new Map<string, number>() : new Map([[script.id, zIndex]]),
  }), [shared, selected, script.id, zIndex]);
  return <Ctx.Provider value={context}><StackView script={script} /></Ctx.Provider>;
});

/* ---------- 設定パネル用の一覧 ---------- */

/**
 * スクリプトを「きっかけ」と、その下に並ぶ動作の一覧として見せる
 * （element = 要素名を添える。onOpen があればクリックでスクリプト画面を開く）
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
        const TrigIcon = s.trigger ? TRIGGER_ICON[s.trigger] : Zap;
        return (
          <li key={s.id} className={`ss-item${s.trigger ? "" : " is-idle"}`}>
            <button
              type="button"
              className="ss-card"
              onClick={() => onOpen?.(s)}
              disabled={!onOpen}
              data-tip={onOpen ? tr("クリックでスクリプトを編集") : undefined}
            >
              <span className="ss-when">
                <Ico icon={TrigIcon} cat="event" />
                {element && <span className="ss-el">{element}</span>}
                <span className="ss-trig">
                  {s.trigger ? TRIGGER_LABELS[s.trigger] : tr("きっかけなし（実行されません）")}
                </span>
              </span>
              <ol className="ss-steps">
                {s.steps.slice(0, MAX).map((step) => (
                  <li key={step.id}>
                    <Ico icon={STEP_ICON[step.kind]} cat={CAT_OF[step.kind]} />
                    <span className="ss-text">{glyphs(stepText(step, doc))}</span>
                  </li>
                ))}
                {s.steps.length > MAX && (
                  <li className="ss-more">{tr("ほか{n}件の動作", { n: s.steps.length - MAX })}</li>
                )}
                {!s.steps.length && <li className="ss-more">{tr("動作がありません")}</li>}
              </ol>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- 本体 ---------- */

export interface Drag {
  pointerId: number;
  make: () => Payload;
  payload: Payload | null;
  started: boolean;
  sx: number;
  sy: number;
  x: number;
  y: number;
  /** つかんだ位置（ブロック左上からのずれ） */
  ox: number;
  oy: number;
  h: number;
  /** 複数選択中のブロックをクリックだけで離したら、そのブロックだけの選択にする */
  clickKey?: string;
}

/** 範囲選択（画面座標） */
export interface Marquee {
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Shift / ⌘ で既存の選択に追加する */
  base: string[];
}

export interface Menu {
  x: number;
  y: number;
  target: MenuTarget;
  key: string;
}

/** キー操作・ドラッグのイベントから参照する、ScriptEditor の最新の状態 */
export interface ScriptEditorLatest {
  setZoom: (next: number, anchor?: { x: number; y: number }) => void;
  stepZoom: (dir: 1 | -1) => void;
  scripts: PageScript[];
  commit: (next: PageScript[]) => void;
  focusNodeId: string | null;
  onClose: () => void;
  selectedList: string[];
  deleteSelected: () => void;
  selectAll: () => void;
  peekId: string | null;
}

const isModifier = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
  e.shiftKey || e.metaKey || e.ctrlKey;

/**
 * ページのスクリプト画面。ページ内の全要素のスクリプトを1つのワークスペースに並べる。
 * focusNodeId: 要素設定から開いたときの要素（強調表示し、新しいきっかけの要素にする）
 */
export default function ScriptEditor(props: {
  focusNodeId?: string | null;
  focusScriptId?: string | null;
  onClose: () => void;
}) {
  return (
    <SafeBoundary label={tr("スクリプト画面")} onClose={props.onClose}>
      <ScriptEditorInner {...props} />
    </SafeBoundary>
  );
}

function ScriptEditorInner({
  focusNodeId = null,
  focusScriptId = null,
  onClose,
}: {
  focusNodeId?: string | null;
  /** 開いたときに選択して見せるスクリプト */
  focusScriptId?: string | null;
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const updateDoc = useEditor((s) => s.updateDoc);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const page = doc.pages[activePageId];

  // コンポーネント編集中・コンポーネント内の要素から開いたときは、そのマスターも含める
  const extraRootsKey = [
    editingComponentId ? doc.components?.[editingComponentId]?.rootId : null,
    focusNodeId
      ? doc.components?.[componentOf(doc, focusNodeId) ?? ""]?.rootId
      : null,
  ]
    .filter(Boolean)
    .join(",");
  const nodeIds = useMemo(
    () =>
      pageNodeIds(doc, activePageId, extraRootsKey ? extraRootsKey.split(",") : []),
    [doc, activePageId, extraRootsKey]
  );
  const scripts = useMemo(
    () => pageScriptsOf(doc, nodeIds, activePageId),
    [doc, nodeIds, activePageId]
  );
  const pageLoadScriptIds = useMemo(() => new Set(
    scripts.filter((s) => s.nodeId === PAGE_TARGET && s.trigger === "load").map((s) => s.id)
  ), [scripts]);
  const serverStepIds = useMemo(() => pagePlan(doc, activePageId).serverIds, [doc, activePageId]);
  const targets = useMemo(() => collectTargets(doc, nodeIds), [doc, nodeIds]);
  const tree = useMemo(() => buildTree(doc, nodeIds), [doc, nodeIds]);
  const arrays = useMemo(() => pageArrays(doc, activePageId), [doc, activePageId]);
  const samples = useMemo(() => previewDataVars(doc, activePageId), [doc, activePageId]);
  const variableIndex = useMemo(() => pageVariableIndex(doc, activePageId), [doc, activePageId]);
  // All transform blocks share the same source values. Building a fresh object
  // of every page variable for each block made large workspaces quadratic.
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
  const elements = useMemo(
    () =>
      nodeIds.map((id) => {
        const n = doc.nodes[id];
        return { id, label: n.attrId ? tr("{name}（#{attrId}）", { name: n.name, attrId: n.attrId }) : n.name };
      }),
    [doc, nodeIds]
  );

  const wsRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const visiblePalette = useMemo(() => findPaletteItems(paletteQuery), [paletteQuery]);
  /** ワークスペースの表示倍率（ブラウザに覚えておく） */
  const [zoom, setZoomState] = useState(() => {
    try {
      return clampZoom(Number(window.localStorage.getItem("se-zoom")) || 1);
    } catch {
      return 1;
    }
  });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    try {
      window.localStorage.setItem("se-zoom", String(zoom));
    } catch {
      // 保存できなくても表示には影響しない
    }
  }, [zoom]);
  /** 倍率を変える。anchor（画面上の点）の位置にある内容が動かないようにスクロールを合わせる */
  const setZoom = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const ws = wsRef.current;
    const prev = zoomRef.current;
    const z = clampZoom(next);
    if (z === prev) return;
    if (ws) {
      const r = ws.getBoundingClientRect();
      const ax = anchor ? anchor.x - r.left : ws.clientWidth / 2;
      const ay = anchor ? anchor.y - r.top : ws.clientHeight / 2;
      const cx = (ws.scrollLeft + ax) / prev;
      const cy = (ws.scrollTop + ay) / prev;
      requestAnimationFrame(() => {
        ws.scrollLeft = cx * z - ax;
        ws.scrollTop = cy * z - ay;
      });
    }
    zoomRef.current = z;
    setZoomState(z);
  }, []);
  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const cur = zoomRef.current;
      const next =
        dir > 0
          ? (ZOOM_STEPS.find((v) => v > cur + 0.001) ?? ZOOM_MAX)
          : ([...ZOOM_STEPS].reverse().find((v) => v < cur - 0.001) ?? ZOOM_MIN);
      setZoom(next);
    },
    [setZoom]
  );
  // ⌘ / Ctrl + スクロール（トラックパッドのピンチも含む）でカーソル位置を中心に拡大縮小
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      // マウスホイールの1目盛り（大きな deltaY）でも変わりすぎないよう抑える
      const factor = Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.006);
      setZoom(Math.round(zoomRef.current * factor * 100) / 100, { x: e.clientX, y: e.clientY });
    };
    ws.addEventListener("wheel", onWheel, { passive: false });
    return () => ws.removeEventListener("wheel", onWheel);
  }, [setZoom]);
  /** パレット（左のブロック一覧）の幅と開閉。ブラウザに覚えておく */
  const [palW, setPalW] = useState(() => {
    try {
      return clampPal(Number(window.localStorage.getItem("se-pal-w")) || 248);
    } catch {
      return 248;
    }
  });
  const [palOpen, setPalOpen] = useState(() => {
    try {
      return window.localStorage.getItem("se-pal-closed") !== "1";
    } catch {
      return true;
    }
  });
  const [palAnim, setPalAnim] = useState(false);
  useEffect(() => {
    try {
      window.localStorage.setItem("se-pal-w", String(palW));
      window.localStorage.setItem("se-pal-closed", palOpen ? "0" : "1");
    } catch {
      // 保存できなくても表示には影響しない
    }
  }, [palW, palOpen]);
  useEffect(() => {
    if (!palAnim) return;
    const t = setTimeout(() => setPalAnim(false), 260);
    return () => clearTimeout(t);
  }, [palAnim]);
  const togglePal = () => {
    setPalAnim(true);
    setPalOpen((o) => !o);
  };
  const dragRef = useRef<Drag | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const marqueeElRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const highlightedSlotRef = useRef<HTMLElement | null>(null);
  // A drag can cross hundreds of insertion slots. Highlight only the changed
  // DOM node; never make the entire block editor render on pointer movement.
  const setActiveSlot = useCallback((key: string | null, measuredElement?: HTMLElement | null) => {
    const old = highlightedSlotRef.current;
    if (old && (old.dataset.slot !== key || !old.isConnected)) {
      old.classList.remove("is-active");
      highlightedSlotRef.current = null;
    }
    if (!key) {
      old?.classList.remove("is-active");
      highlightedSlotRef.current = null;
      return;
    }
    if (highlightedSlotRef.current?.classList.contains("is-active")) return;
    // Reuse the DOM element from the drag hit-test index instead of querying
    // the entire workspace whenever the active drop target changes.
    const el = measuredElement?.isConnected && measuredElement.dataset.slot === key
      ? measuredElement
      : wsRef.current?.querySelector<HTMLElement>(
          `[data-slot="${CSS.escape(key)}"]`
        );
    el?.classList.add("is-active");
    highlightedSlotRef.current = el ?? null;
  }, []);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selectedList, setSelectedList] = useState<string[]>([]);
  const selected = useMemo(() => new Set(selectedList), [selectedList]);
  /** 最後に選んだスクリプトほど後ろ（= 手前に描く）。重なったブロックを選んだら前に出す */
  const [front, setFront] = useState<string[]>([]);
  useEffect(() => {
    if (!selectedList.length) return;
    const owners = scripts
      .filter((sc) =>
        selectedList.some((key) =>
          key === `script:${sc.id}` ||
          (key.startsWith("step:") && stepIn(sc.steps, key.slice(5)))
        )
      )
      .map((sc) => sc.id);
    if (!owners.length) return;
    setFront((prev) => {
      const next = [...prev.filter((id) => !owners.includes(id)), ...owners];
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
    // 選択が変わったときだけ並べ替える（スクリプトの編集では動かさない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList]);
  const zOrder = useMemo(() => new Map(front.map((id, i) => [id, i + 1])), [front]);
  /** 取得したデータを表で見る小窓（取得ブロックのID） */
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekScope, setPeekScope] = useState<FetchPreviewScope>({ nodeId: "", localNames: [] });
  const peekStep = useMemo(() => {
    for (const sc of scripts) {
      const owner = peekScope.owner;
      if (owner && (sc.id !== owner.scriptId || sc.nodeId !== owner.nodeId)) continue;
      if (!owner && peekScope.nodeId && sc.nodeId !== peekScope.nodeId) continue;
      let found: FetchStep | null = null;
      walkSteps(sc.steps, (step) => {
        if (step.kind === "fetch" && step.id === peekId) found = step;
      });
      if (found) return found;
    }
    return null;
  }, [scripts, peekId, peekScope]);

  const commit = useCallback((next: PageScript[]) => {
    updateDoc((d) => applyPageScripts(d, activePageId, nodeIds, numberFilters(next)));
  }, [updateDoc, activePageId, nodeIds]);
  const deleteSelected = () => {
    if (!selectedList.length) return;
    commit(removeKeys(scripts, selectedList));
    setSelectedList([]);
  };
  /** ⌘A: きっかけのあるスクリプトと、きっかけの無い集まりのブロックをすべて選ぶ */
  const selectAll = () =>
    setSelectedList(
      scripts.flatMap((s) =>
        s.trigger ? [`script:${s.id}`] : s.steps.map((x) => `step:${x.id}`)
      )
    );
  // ウィンドウのイベントから最新の状態を参照する
  const latest = useRef<ScriptEditorLatest>({
    setZoom,
    stepZoom,
    scripts,
    commit,
    focusNodeId,
    onClose,
    selectedList,
    deleteSelected,
    selectAll,
    peekId,
  });
  latest.current = {
    setZoom,
    stepZoom,
    scripts,
    commit,
    focusNodeId,
    onClose,
    selectedList,
    deleteSelected,
    selectAll,
    peekId,
  };

  // 要素設定から開いたときは、その要素のスクリプトが見える位置までスクロールする
  useEffect(() => {
    // 一覧から選んだスクリプトがあれば、それを選択して真ん中に見せる
    if (focusScriptId) {
      const el = wsRef.current?.querySelector<HTMLElement>(
        `[data-script-id="${CSS.escape(focusScriptId)}"]`
      );
      if (el) {
        setSelectedList([`script:${focusScriptId}`]);
        el.scrollIntoView({ block: "center", inline: "center" });
        return;
      }
    }
    if (!focusNodeId) return;
    const el = wsRef.current?.querySelector<HTMLElement>(
      `[data-script-node="${CSS.escape(focusNodeId)}"]`
    );
    el?.scrollIntoView({ block: "center", inline: "center" });
    // 開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelGesture = useScriptDrag({
    wsRef,
    zoomRef,
    marqueeRef,
    setMarquee,
    setSelectedList,
    dragRef,
    setMenu,
    setActiveSlot,
    setDrag,
    latest,
    paletteRef,
    ghostRef,
    marqueeElRef,
  });
  useScriptEditorKeys({ dragRef, cancelGesture, latest, setPeekId, setSelectedList });

  /**
   * ブロックを押したとき。key があれば選択も更新する
   * （Shift / ⌘ は選択の追加・解除だけ、選択済みのものはそのまま複数ドラッグ）
   */
  const begin = useCallback((e: React.PointerEvent, make: () => Payload, key?: string) => {
    if (e.button !== 0 || dragRef.current || marqueeRef.current) return;
    const t = e.target as HTMLElement;
    e.stopPropagation();
    if (key && isModifier(e)) {
      e.preventDefault();
      setSelectedList((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      );
      return;
    }
    if (key && !selected.has(key)) setSelectedList([key]);
    if (!key) setSelectedList([]);
    // 入力欄の操作はドラッグにしない
    if (t.closest("input, select, textarea, button, label")) return;
    e.preventDefault();
    // 入力欄にフォーカスが残っていると Backspace が文字の削除になるため外す
    (document.activeElement as HTMLElement | null)?.blur?.();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // つかんだ位置は倍率 1 の大きさで持つ（ワークスペースの中は表示倍率がかかっている）
    const z = wsRef.current?.contains(e.currentTarget as Node) ? zoomRef.current : 1;
    dragRef.current = {
      pointerId: e.pointerId,
      make,
      payload: null,
      started: false,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
      ox: (e.clientX - r.left) / z,
      oy: (e.clientY - r.top) / z,
      h: r.height / z,
      clickKey: key && selected.has(key) && selected.size > 1 ? key : undefined,
    };
  }, [selected]);

  const view = useMemo(() => {
    const p = drag?.payload;
    if (!p) return scripts;
    if (p.type === "steps" && p.from) return takeAt(scripts, p.from)[0];
    if (p.type === "script") {
      const ids = new Set(p.group.map((s) => s.id));
      return scripts.filter((s) => !ids.has(s.id));
    }
    return scripts;
  }, [scripts, drag?.payload]);

  const ctx = useMemo<EdCtx>(() => ({
    doc,
    pageId: activePageId,
    scriptRootIds: extraRootsKey ? extraRootsKey.split(",") : [],
    targets,
    tree,
    scripts,
    variableIndex,
    transformSources,
    pageLoadScriptIds,
    serverStepIds,
    elements,
    focusNodeId,
    readOnly: false,
    activeSlot: null,
    selected,
    zOrder,
    // 取得のように後から呼ばれることがあるため、描画時点ではなく最新の状態に適用する
    updateStep: (stepId, fn) =>
      commit(
        mapStep(
          pageScriptsOf(useEditor.getState().doc, nodeIds, activePageId),
          stepId,
          fn
        )
      ),
    updateScript: (scriptId, patch) =>
      commit(scripts.map((s) => (s.id === scriptId ? { ...s, ...patch } : s))),
    isPageLoadRoot: (loc) => {
      const s = scripts.find((x) => x.id === loc.scriptId);
      return !!s && s.nodeId === PAGE_TARGET && s.trigger === "load" && loc.list === "root";
    },
    // 取得のように後から呼ばれることがあるため、最新の状態に適用する
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
    beginSteps: (e, loc, stepId) =>
      begin(
        e,
        () => ({
          type: "steps",
          steps: takeAt(latest.current.scripts, loc)[1],
          from: loc,
        }),
        `step:${stepId}`
      ),
    beginScript: (e, script) =>
      begin(
        e,
        () => {
          // 選択中のスクリプトがあれば一緒に動かす
          const sel = latest.current.selectedList;
          const group = latest.current.scripts.filter(
            (s) => s.id === script.id || sel.includes(`script:${s.id}`)
          );
          return { type: "script", script, group };
        },
        `script:${script.id}`
      ),
    openMenu: (e, target, key) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(key)) setSelectedList([key]);
      setMenu({ x: e.clientX, y: e.clientY, target, key });
    },
  }), [doc, activePageId, extraRootsKey, targets, tree, scripts,
    variableIndex, transformSources, pageLoadScriptIds, serverStepIds, elements, focusNodeId, selected,
    zOrder, commit, updateDoc, nodeIds, arrays, samples, begin]);

  const runMenu = (action: "delete" | "duplicate") => {
    if (!menu) return;
    const t = menu.target;
    setMenu(null);
    if (action === "delete") {
      // 右クリックしたブロックが選択に含まれていれば、選択中のものをまとめて削除
      const keys = selected.has(menu.key) ? selectedList : [menu.key];
      commit(removeKeys(scripts, keys));
      setSelectedList([]);
      return;
    }
    if (t.type === "script") {
      const s = scripts.find((x) => x.id === t.scriptId);
      if (!s) return;
      const id = scriptUid();
      commit([
        ...scripts,
        {
          ...s,
          id,
          steps: cloneSteps(s.steps),
          pos: { x: s.pos.x + 32, y: s.pos.y + 32 },
        },
      ]);
      setSelectedList([`script:${id}`]);
      return;
    }
    const script = scripts.find((x) => x.id === t.loc.scriptId);
    const list = script && listIn(script, t.loc.list);
    const step = list?.[t.loc.index];
    if (!step) return;
    const [copy] = cloneSteps([step]);
    commit(insertAt(scripts, { ...t.loc, index: t.loc.index + 1 }, [copy]));
    setSelectedList([`step:${copy.id}`]);
  };

  const wsSize = useMemo(() => scripts.reduce(
    (acc, s) => ({
      w: Math.max(acc.w, s.pos.x + 900),
      h: Math.max(acc.h, s.pos.y + 700),
    }),
    { w: 1600, h: 1000 }
  ), [scripts]);

  const ghost = drag?.payload ? (
    <div
      ref={ghostRef}
      className="se-ghost"
      style={{ left: 0, top: 0,
        transform: `translate3d(${drag.x - drag.ox * zoom}px, ${drag.y - drag.oy * zoom}px, 0)` }}
    >
      <div style={{ zoom }}>
      <Ctx.Provider value={{ ...ctx, readOnly: true, activeSlot: null }}>
        {drag.payload.type === "trigger" ? (
          <div className="se-stack">
            <HatView trigger={drag.payload.trigger} />
          </div>
        ) : drag.payload.type === "script" ? (
          (() => {
            const main = drag.payload.script;
            return drag.payload.group.slice(0, 8).map((s) => (
              <div
                key={s.id}
                className="se-ghost-item"
                style={{ left: s.pos.x - main.pos.x, top: s.pos.y - main.pos.y }}
              >
                <StackView script={{ ...s, steps: ghostPreviewSteps(s.steps) }} />
              </div>
            ));
          })()
        ) : (
          <div className="se-stack">
            <StepList scriptId="__ghost" list="root" steps={ghostPreviewSteps(drag.payload.steps)} />
            {drag.payload.steps.length > 8 && (
              <span className="se-ghost-more">
                {tr("ほか{n}件の動作", { n: drag.payload.steps.length - 8 })}
              </span>
            )}
          </div>
        )}
      </Ctx.Provider>
      </div>
    </div>
  ) : null;

  const menuCount = menu && selected.has(menu.key) ? selectedList.length : 1;

  if (!page) return null;

  return createPortal(
    <div
      className="se-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`se${drag?.payload ? " is-dragging" : ""}`}
        data-tutorial="settings-link"
        role="dialog"
        aria-label={tr("スクリプト")}
        onClick={() => setMenu(null)}
      >
        <div className="se-header">
          <button
            className="se-close se-pal-toggle"
            onClick={togglePal}
            aria-label={palOpen ? tr("ブロック一覧を閉じる") : tr("ブロック一覧を開く")}
            aria-pressed={palOpen}
            data-tip={palOpen ? tr("ブロック一覧を閉じる") : tr("ブロック一覧を開く")}
          >
            {palOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <div className="se-title">
            <h2>{tr("スクリプト")}</h2>
            <p>{tr("ページ「{name}」のすべての要素のスクリプト", { name: page.name })}</p>
          </div>
          <div className="se-tools">
            {selectedList.length > 1 && (
              <span className="se-sel-count">{tr("{n}個を選択中", { n: selectedList.length })}</span>
            )}
            <div className="se-zoom" role="group" aria-label={tr("表示倍率")}>
              <button
                className="se-close"
                onClick={() => stepZoom(-1)}
                disabled={zoom <= ZOOM_MIN}
                aria-label={tr("縮小")}
                data-tip={tr("縮小")} data-tip-kbd="⌘-"
              >
                <Minus size={15} />
              </button>
              <button
                className="se-zoom-val"
                onClick={() => setZoom(1)}
                data-tip={tr("100%に戻す")} data-tip-kbd="⌘0"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="se-close"
                onClick={() => stepZoom(1)}
                disabled={zoom >= ZOOM_MAX}
                aria-label={tr("拡大")}
                data-tip={tr("拡大")} data-tip-kbd="⌘+"
              >
                <Plus size={15} />
              </button>
            </div>
            <span className="se-tools-sep" />
            <button
              className="se-close"
              onClick={() => useEditor.getState().undo()}
              disabled={!canUndo}
              aria-label={tr("取り消す")}
              data-tip={tr("取り消す（⌘Z）")}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="se-close"
              onClick={() => useEditor.getState().redo()}
              disabled={!canRedo}
              aria-label={tr("やり直す")}
              data-tip={tr("やり直す（⇧⌘Z）")}
            >
              <Redo2 size={16} />
            </button>
            <span className="se-tools-sep" />
            <button className="se-close" onClick={onClose} aria-label={tr("閉じる")}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div
          className={`se-main${palOpen ? "" : " is-pal-closed"}${palAnim ? " is-pal-anim" : ""}`}
          style={
            {
              "--se-pal-w": `${palOpen ? palW : 0}px`,
              "--se-pal-full": `${palW}px`,
            } as React.CSSProperties
          }
        >
          <div
            ref={paletteRef}
            className={`se-pal-wrap${drag && isFromWorkspace(drag.payload) ? " is-trash-ready" : ""}${drag && isFromWorkspace(drag.payload) && inPaletteHint(drag, paletteRef.current) ? " is-trash" : ""}`}
          >
            <div className="se-palette" data-tutorial="se-palette">
              <div className="se-pal-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  className="se-pal-search-input"
                  aria-label={tr("操作を探す")}
                  placeholder={tr("操作を探す")}
                  value={paletteQuery}
                  onChange={(e) => setPaletteQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setPaletteQuery("");
                    }
                  }}
                />
                {paletteQuery && (
                  <button
                    type="button"
                    className="se-pal-search-clear"
                    aria-label={tr("検索をクリア")}
                    onClick={() => setPaletteQuery("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {CAT_ORDER.map((cat) => {
                const items = visiblePalette.filter((item) => item.cat === cat);
                if (!items.length) return null;
                return (
                  <div key={cat} className="se-pal-group">
                    <div className="se-pal-title">{CAT_INFO[cat].label}</div>
                    {items.map((item) => (
                      <div
                        key={item.key}
                        className="se-blk se-pal-item"
                        data-tutorial={`se-block-${item.key}`}
                        onPointerDown={(e) => begin(e, item.make)}
                      >
                        <Ico icon={item.icon} cat={cat} />
                        <PaletteLabel label={item.label} />
                      </div>
                    ))}
                  </div>
                );
              })}
              {visiblePalette.length === 0 && (
                <p className="se-pal-empty" role="status">{tr("一致する操作がありません")}</p>
              )}
            </div>
            <div className="se-trash">{tr("ここで離すと削除")}</div>
          </div>
          {palOpen && (
            <div
              className="se-pal-resizer"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const target = e.currentTarget;
                target.setPointerCapture(e.pointerId);
                const x0 = e.clientX;
                const w0 = palW;
                const collapse = (x: number) => w0 + x - x0 < PAL_MIN - 80;
                document.body.classList.add("is-resizing-panel");
                const onMove = (ev: PointerEvent) => {
                  target.classList.toggle("is-collapse", collapse(ev.clientX));
                  setPalW(clampPal(w0 + ev.clientX - x0));
                };
                const onUp = (ev: PointerEvent) => {
                  target.removeEventListener("pointermove", onMove);
                  target.removeEventListener("pointerup", onUp);
                  target.removeEventListener("pointercancel", onUp);
                  document.body.classList.remove("is-resizing-panel");
                  if (collapse(ev.clientX)) {
                    setPalW(w0);
                    togglePal();
                  }
                };
                target.addEventListener("pointermove", onMove);
                target.addEventListener("pointerup", onUp);
                target.addEventListener("pointercancel", onUp);
              }}
            />
          )}
          <div
            ref={wsRef}
            className="se-ws"
            data-tutorial="se-workspace"
            // 方眼も倍率に合わせる
            style={{ backgroundSize: `${16 * zoom}px ${16 * zoom}px` }}
            onPointerDown={(e) => {
              // 何もない所からドラッグすると範囲選択（Shift / ⌘ で追加）
              const t = e.target as HTMLElement;
              if (e.button !== 0 || dragRef.current || marqueeRef.current) return;
              if (t !== e.currentTarget && !t.classList.contains("se-ws-inner")) {
                return;
              }
              e.preventDefault();
              (document.activeElement as HTMLElement | null)?.blur?.();
              setMenu(null);
              const base = isModifier(e) ? selectedList : [];
              if (!isModifier(e)) setSelectedList([]);
              marqueeRef.current = {
                pointerId: e.pointerId,
                x0: e.clientX,
                y0: e.clientY,
                x: e.clientX,
                y: e.clientY,
                base,
              };
            }}
          >
            <div
              className="se-ws-inner"
              style={{ width: wsSize.w, height: wsSize.h, zoom }}
            >
              <Ctx.Provider value={ctx}>
                {view.map((s) => (
                  <MemoStackView key={s.id} script={s} />
                ))}
              </Ctx.Provider>
            </div>
            {!scripts.length && (
              <div className="se-empty">
                <p>
                  {tr("左の「きっかけ」をここへドラッグし、どの要素のきっかけかを選んでから、その下に動作のブロックをつなげます。")}
                </p>
                <p>
                  {trNodes("例: 「［ボタン］クリックしたとき」{arrow}「［ページ］を開く」", { arrow: glyphs("→") })}
                </p>
                <p>
                  {tr("データを表示するときは、「［URL］のデータを取得して［名前］とする」の下に「［値］を変数［］とする」をつなげて中身を取り出します（ページを開いたときに実行されます）。リストを入れた変数をリスト表示の設定で選ぶと、1件ずつ並びます。")}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="se-footer">
          <span>{tr("ドラッグでつなげる・並べ替え")}</span>
          <span>
            <kbd>{glyphs("⇧")}</kbd>/<kbd>{glyphs("⌘")}</kbd>{tr("+クリック・空き部分のドラッグで複数選択")}
          </span>
          <span>
            <kbd>Backspace</kbd>{tr("削除")}
          </span>
          <span>
            <kbd>{glyphs("⌘A")}</kbd>{tr("全選択")}
          </span>
          <span>
            <kbd>{glyphs("⌘Z")}</kbd>/<kbd>{glyphs("⇧⌘Z")}</kbd>{tr("取り消し・やり直し")}
          </span>
          <InfoTip
            style={{ marginLeft: "auto" }}
            text={tr("「クリックしたとき」にページやURLを開くだけのスクリプトは、リンク（aタグ）として出力されます。\nストレージは localStorage → このサイトだけのクッキー → メモリ（ページを閉じると消える）の順に、使えるところへ保存します。")}
          />
        </div>
        {peekStep && (
          <div
            className="se-modal-backdrop"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setPeekId(null);
            }}
          >
            <Ctx.Provider value={ctx}>
              <SafeBoundary label={tr("取得したデータ")} onClose={() => setPeekId(null)}>
                <PeekModal step={peekStep} scope={peekScope} onClose={() => setPeekId(null)} />
              </SafeBoundary>
            </Ctx.Provider>
          </div>
        )}
        {ghost}
        {marquee && (
          <div
            ref={marqueeElRef}
            className="se-marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x),
              top: Math.min(marquee.y0, marquee.y),
              width: Math.abs(marquee.x - marquee.x0),
              height: Math.abs(marquee.y - marquee.y0),
            }}
          />
        )}
        {menu && (
          <div
            className="se-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => runMenu("duplicate")}>{tr("複製")}</button>
            <button className="is-danger" onClick={() => runMenu("delete")}>
              {menuCount > 1
                ? tr("{menuCount}個のブロックを削除", { menuCount })
                : menu.target.type === "script"
                  ? tr("スクリプトを削除")
                  : tr("このブロックを削除")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** ワークスペースから持ち出したブロックか（パレットで離すと削除になる） */
function isFromWorkspace(p: Payload | null): boolean {
  return !!p && (p.type === "script" || (p.type === "steps" && !!p.from));
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
}

const PAL_MIN = 180;

function clampPal(w: number): number {
  return Math.max(PAL_MIN, Math.min(420, w));
}

function inPaletteHint(d: Drag, el: HTMLElement | null): boolean {
  const r = el?.getBoundingClientRect();
  return !!r && d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
}

/** Drag previews never mount a second copy of a very long step tree. */
function ghostPreviewSteps(steps: ScriptStep[], depth = 0): ScriptStep[] {
  if (depth >= 3) return [];
  return steps.slice(0, 8).map((step) => {
    if (step.kind === "if") return {
      ...step,
      then: ghostPreviewSteps(step.then, depth + 1),
      ...(step.else ? { else: ghostPreviewSteps(step.else, depth + 1) } : {}),
    };
    if (step.kind === "repeat" || step.kind === "for-each") {
      return { ...step, then: ghostPreviewSteps(step.then, depth + 1) };
    }
    return step;
  });
}
