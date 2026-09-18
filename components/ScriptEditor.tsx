"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Undo2, X, Zap } from "lucide-react";
import { componentOf, useEditor } from "../lib/store";
import SafeBoundary from "./SafeBoundary";
import { glyphs } from "./Glyph";
import { InfoTip } from "./controls";
import { applyPageScripts, cloneSteps, pageScriptsOf, scriptUid, walkSteps, TRIGGER_LABELS, type PageScript } from "../lib/script";
import { stepText } from "../lib/script-text";
import { pageArrays, pagePlan, pageVariableIndex, previewDataVars, renameVarInPage, type FetchStep } from "../lib/data";
import { PAGE_TARGET, type Script, type ScriptStep } from "../lib/types";
import { tr, trNodes } from "../lib/i18n";
import { HatView, PeekModal, StackView, StepList } from "./script-editor/blocks";
import { Ctx, type EdCtx, type FetchPreviewScope } from "./script-editor/context";
import { indexFieldTargets } from "./script-editor/field-index";
import {
  CAT_OF,
  Ico,
  STEP_ICON,
  TRIGGER_ICON,
  type Payload,
} from "./script-editor/palette";
import { insertAt, listIn, mapStep, numberFilters, removeKeys, takeAt } from "./script-editor/step-tree";
import { copyScriptBlocks, pasteScriptBlocks, type ScriptBlockClipboard } from "./script-editor/clipboard";
import { buildTree, collectTargets, type MenuTarget } from "./script-editor/targets";
import { useScriptDrag } from "./script-editor/useScriptDrag";
import { useScriptEditorKeys } from "./script-editor/useScriptEditorKeys";
import { ScriptPalette } from "./script-editor/ScriptPalette";

// 選択したブロックが1つ変わるだけで、エディタ全体の context は変わってしまう。選択と重なり順を
// スクリプトごとに分け、他のブロックのツリーを描画し直さないようにする。
const EMPTY_SCRIPT_KEYS: readonly string[] = [];
const ScopedStackView = memo(function ScopedStackView({
  script, shared, selectedKeys, zIndex, frozenWidth,
}: {
  script: PageScript;
  shared: EdCtx;
  selectedKeys: readonly string[];
  zIndex?: number;
  frozenWidth?: number;
}) {
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const context = useMemo<EdCtx>(() => ({
    ...shared,
    selected,
    zOrder: zIndex === undefined ? new Map<string, number>() : new Map([[script.id, zIndex]]),
  }), [shared, selected, script.id, zIndex]);
  return <Ctx.Provider value={context}><StackView script={script} fixedWidth={frozenWidth} /></Ctx.Provider>;
});

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
        const TrigIcon = s.trigger ? TRIGGER_ICON[s.trigger] : Zap;
        return (
          <li key={s.id} className={`ss-item${s.trigger ? "" : " is-idle"}`}>
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
                <span className="ss-trig">
                  {s.trigger ? TRIGGER_LABELS[s.trigger] : tr("No trigger (won't run)")}
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

export interface Drag {
  pointerId: number;
  make: () => Payload;
  payload: Payload | null;
  started: boolean;
  sx: number;
  sy: number;
  x: number;
  y: number;
  /** つかんだ位置（ブロックの左上からのずれ） */
  ox: number;
  oy: number;
  h: number;
  /** ドラッグを始める前のブロックの幅（倍率 1 での値） */
  w?: number;
  /** モーダルの登場アニメーション中もプレビューの見た目の倍率を揃える。 */
  modalScale?: number;
  /** ブロックを取り除いた後も、元のスタックの幅を保つ */
  sourceStackWidth?: number;
  /** 複数のスタックをドラッグするときは、各スタックの幅を保つ */
  scriptWidths?: Record<string, number>;
  /** 実際の DOM の写しを使い、ドラッグ中も表示中の部品と行の折り返しを変えないようにする。 */
  previewNodes?: HTMLElement[];
  sourceStackIdle?: boolean;
  /** 複数選択中のブロックをクリックしただけで離したら、そのブロックだけを選択する */
  clickKey?: string;
}

/** 範囲選択（画面上の座標） */
export interface Marquee {
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Shift / ⌘ を押していれば、既存の選択に追加する */
  base: string[];
}

export interface Menu {
  x: number;
  y: number;
  target: MenuTarget;
  key: string;
}

/** キー操作やドラッグのイベントから参照する、ScriptEditor の最新の状態 */
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
  copySelection: () => ScriptBlockClipboard | null;
  pasteSelection: (copied: ScriptBlockClipboard) => void;
  peekId: string | null;
}

const isModifier = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
  e.shiftKey || e.metaKey || e.ctrlKey;

/**
 * ページのスクリプトの画面。ページ内のすべての要素のスクリプトを、1つのワークスペースに並べる。
 * focusNodeId: 要素の設定から開いたときの要素（強調表示し、新しいきっかけの要素にする）
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

function ScriptEditorInner({
  focusNodeId = null,
  focusScriptId = null,
  onClose,
}: {
  focusNodeId?: string | null;
  /** 開いたときに選択して表示するスクリプト */
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
  // Component ownership indexes the node tree. Recompute it only when the
  // document or editor focus changes, never on every drag/selection render.
  const extraRootIds = useMemo(() => [
    editingComponentId ? doc.components?.[editingComponentId]?.rootId : null,
    focusNodeId
      ? doc.components?.[componentOf(doc, focusNodeId) ?? ""]?.rootId
      : null,
  ]
    .filter((id): id is string => !!id), [doc, editingComponentId, focusNodeId]);
  const tree = useMemo(() => buildTree(doc, activePageId, extraRootIds), [doc, activePageId, extraRootIds]);
  const nodeIds = useMemo(() => tree.map((row) => row.id), [tree]);
  const scripts = useMemo(
    () => pageScriptsOf(doc, nodeIds, activePageId),
    [doc, nodeIds, activePageId]
  );
  const stepOwners = useMemo(() => {
    const owners = new Map<string, string[]>();
    for (const script of scripts) {
      walkSteps(script.steps, (step) => {
        const matches = owners.get(step.id) ?? [];
        if (!matches.includes(script.id)) {
          matches.push(script.id);
          owners.set(step.id, matches);
        }
      });
    }
    return owners;
  }, [scripts]);
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
  const samples = useMemo(() => previewDataVars(doc, activePageId), [doc, activePageId]);
  const variableIndex = useMemo(() => pageVariableIndex(doc, activePageId), [doc, activePageId]);
  // 値の加工のブロックは、すべて同じ値の候補を使う。ブロックごとにページの全変数の
  // オブジェクトを作り直すと、大きなワークスペースで処理量が2乗に増えてしまう。
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
        return { id, label: n.attrId ? tr("{name} (#{attrId})", { name: n.name, attrId: n.attrId }) : n.name };
      }),
    [doc, nodeIds]
  );

  const wsRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  /** ワークスペースの表示倍率（ブラウザに保存しておく） */
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
      // 保存できなくても、表示には影響しない
    }
  }, [zoom]);
  /** 倍率を変える。anchor（画面上の点）の位置にある内容が動かないよう、スクロールを合わせる */
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
  // ⌘ / Ctrl + スクロール（トラックパッドのピンチも含む）で、カーソルの位置を中心に拡大・縮小する
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      // マウスホイールの1目盛り（大きな deltaY）でも変わりすぎないよう、変化量を抑える
      const factor = Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.006);
      setZoom(Math.round(zoomRef.current * factor * 100) / 100, { x: e.clientX, y: e.clientY });
    };
    ws.addEventListener("wheel", onWheel, { passive: false });
    return () => ws.removeEventListener("wheel", onWheel);
  }, [setZoom]);
  /** パレット（左のブロック一覧）の幅と開閉の状態。ブラウザに保存しておく */
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
      // 保存できなくても、表示には影響しない
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
  // 1回のドラッグで数百の挿入位置をまたぐことがある。変わった DOM ノードだけを強調表示し、
  // ポインターが動くたびにブロックエディタ全体を描画し直すことはしない。
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
    // ドロップ先が変わるたびにワークスペース全体を検索せず、
    // ドラッグの当たり判定の索引にある DOM 要素を使い回す。
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
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const scopedSelections = useMemo(() => {
    const byScript = new Map<string, string[]>();
    for (const key of selectedList) {
      const owners = key.startsWith("script:") ? [key.slice(7)] :
        key.startsWith("step:") ? (stepOwners.get(key.slice(5)) ?? []) : [];
      for (const owner of owners) {
        const values = byScript.get(owner) ?? [];
        values.push(key);
        byScript.set(owner, values);
      }
    }
    return byScript;
  }, [selectedList, stepOwners]);
  /** 最後に選んだスクリプトほど後ろに置く（= 手前に描く）。重なったブロックを選んだら、前に出す */
  const [front, setFront] = useState<string[]>([]);
  useEffect(() => {
    if (!selectedList.length) return;
    const ids = new Set(selectedList.flatMap((key) => key.startsWith("script:") ? [key.slice(7)] :
      key.startsWith("step:") ? (stepOwners.get(key.slice(5)) ?? []) : []));
    const owners = scripts.filter((script) => ids.has(script.id)).map((script) => script.id);
    if (!owners.length) return;
    setFront((prev) => {
      const next = [...prev.filter((id) => !ids.has(id)), ...owners];
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
    // 選択が変わったときだけ並べ替える（スクリプトの編集では動かさない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList]);
  const zOrder = useMemo(() => new Map(front.map((id, i) => [id, i + 1])), [front]);
  /** 取得したデータを表で確認する小窓（取得ブロックの ID） */
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
    updatePageScripts(activePageId, nodeIds, numberFilters(next));
  }, [updatePageScripts, activePageId, nodeIds]);
  const deleteSelected = () => {
    if (!selectedList.length) return;
    commit(removeKeys(scripts, selectedList));
    setSelectedList([]);
  };
  const copySelection = () => copyScriptBlocks(scripts, selectedList);
  const pasteSelection = (copied: ScriptBlockClipboard) => {
    const result = pasteScriptBlocks(scripts, selectedList, copied);
    if (!result) return;
    commit(result.scripts);
    setSelectedList(result.selection);
  };
  /** ⌘A: きっかけのあるスクリプトと、きっかけの無いブロックの集まりをすべて選ぶ */
  const selectAll = () =>
    setSelectedList(
      scripts.flatMap((s) =>
        s.trigger ? [`script:${s.id}`] : s.steps.map((x) => `step:${x.id}`)
      )
    );
  // ウィンドウのイベントから、最新の状態を参照する
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
    copySelection,
    pasteSelection,
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
    copySelection,
    pasteSelection,
    peekId,
  };

  // 要素の設定から開いたときは、その要素のスクリプトが見える位置までスクロールする
  useEffect(() => {
    // 一覧から選んだスクリプトがあれば、それを選択して中央に表示する
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
   * ブロックを押したときの処理。key があれば選択も更新する
   * （Shift / ⌘ では選択の追加・解除だけを行い、選択済みのブロックはそのまま複数でドラッグする）
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
    if (key && !selectedRef.current.has(key)) setSelectedList([key]);
    if (!key) setSelectedList([]);
    // 入力欄の操作はドラッグとして扱わない
    if (t.closest("input, select, textarea, button, label")) return;
    e.preventDefault();
    // 入力欄にフォーカスが残っていると Backspace が文字の削除になるため、フォーカスを外す
    (document.activeElement as HTMLElement | null)?.blur?.();
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    // つかんだ位置は倍率 1 での大きさで持つ（ワークスペースの中には表示倍率がかかっている）
    const z = wsRef.current?.contains(target) ? zoomRef.current : 1;
    // エディタの登場アニメーションは DOM 全体を拡大・縮小する。getBoundingClientRect の矩形には
    // その一時的な倍率が含まれるため、それを CSS の幅として保存すると、ドラッグ中にゴーストが
    // さらに縮み、元のスタックも誤った大きさで固定されてしまう。
    // offsetWidth はレイアウト上の幅を測るため、モーダルの拡大アニメーションにも、
    // ワークスペースの CSS の倍率にも左右されない。
    const sourceStack = target.closest<HTMLElement>(".se-stack");
    const sourceStackWidth = sourceStack?.offsetWidth;
    // ドラッグ用の層はモーダルの外へ出すため、登場アニメーション中の
    // scale を別途引き継ぐ。元のブロックとプレビューの大きさを揃える。
    const dialog = target.closest<HTMLElement>(".se");
    const modalScale = dialog?.offsetWidth
      ? dialog.getBoundingClientRect().width / dialog.offsetWidth
      : 1;
    const sourceStackIdle = sourceStack?.classList.contains("is-idle") ?? false;
    let scriptWidths: Record<string, number> | undefined;
    if (key?.startsWith("script:") && selectedRef.current.has(key)) {
      const ids = new Set([...selectedRef.current]
        .filter((selectedKey) => selectedKey.startsWith("script:"))
        .map((selectedKey) => selectedKey.slice("script:".length)));
      if (ids.size > 1) {
        scriptWidths = {};
        wsRef.current?.querySelectorAll<HTMLElement>(".se-stack[data-script-id]").forEach((stack) => {
          const id = stack.dataset.scriptId;
          if (id && ids.has(id)) scriptWidths![id] = stack.offsetWidth;
        });
      }
    }
    dragRef.current = {
      pointerId: e.pointerId,
      make: () => {
        const payload = make();
        // エディタがブロックを一時的に取り除く前に、実際のブロックの DOM を写し取る。
        // 読み取り専用のプレビューを作り直すと、データが変わっていなくても、
        // ドロップダウン・入力欄・条件の行の見た目が変わってしまう。
        if (payload.type === "script") {
          const nodes = payload.group.slice(0, 8).map((script) => {
            const element = wsRef.current?.querySelector<HTMLElement>(
              `.se-stack[data-script-id="${CSS.escape(script.id)}"]`
            );
            return element ? cloneDragElement(element) : null;
          });
          if (nodes.every((node): node is HTMLElement => node !== null)) {
            dragRef.current!.previewNodes = nodes;
          }
        } else if (payload.type === "steps" && payload.from) {
          const item = target.closest<HTMLElement>(".se-item");
          const count = Math.min(8, payload.steps.length);
          // 手順の一覧では、ドロップ先の枠と項目が交互に並ぶ。実際のブロックだけを索引にし、
          // 仮想化したチャンクの中で表示されている項目も含める。こうすることで、連なったブロックを
          // ドラッグしたときもすべての実際のブロックを写し取り、気づかないうちに別の読み取り専用の
          // 描画に切り替わることがない。
          const list = item?.closest<HTMLElement>(".se-list");
          const siblings = list ? Array.from(list.querySelectorAll<HTMLElement>(
            ":scope > .se-item, :scope > .se-virtual-chunk > .se-item"
          )) : [];
          const index = item ? siblings.indexOf(item) : -1;
          if (index >= 0) {
            const nodes = siblings.slice(index, index + count).map(cloneDragElement);
            if (nodes.length === count && nodes.every((node): node is HTMLElement => node !== null)) {
              dragRef.current!.previewNodes = nodes;
            }
          }
        }
        return payload;
      },
      payload: null,
      started: false,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
      ox: (e.clientX - r.left) / z,
      oy: (e.clientY - r.top) / z,
      h: r.height / z,
      // プレビューは左右に 1px ずつ枠線を加える。一時的にアニメーションしている矩形ではなく、
      // ドラッグした行の、倍率のかかっていないレイアウト上の幅を使う。
      w: sourceStackWidth ?? target.offsetWidth + 2,
      modalScale,
      sourceStackWidth,
      sourceStackIdle,
      scriptWidths,
      clickKey: key && selectedRef.current.has(key) && selectedRef.current.size > 1 ? key : undefined,
    };
  }, []);

  const view = useMemo(() => {
    const p = drag?.payload;
    if (!p) return scripts;
    if (p.type === "steps" && p.from) return p.from.remaining;
    if (p.type === "script") {
      const ids = new Set(p.group.map((s) => s.id));
      return scripts.filter((s) => !ids.has(s.id));
    }
    return scripts;
  }, [scripts, drag?.payload]);

  const sharedCtx = useMemo<EdCtx>(() => ({
    doc,
    pageId: activePageId,
    scriptRootIds: extraRootIds,
    targets,
    tree,
    targetLookup,
    fieldLookup,
    scripts,
    // ツリー全体をもう一度たどらず、手順を持つ要素の数を数えて判定する。
    virtualizeStacks: scripts.length > 40 || stepOwners.size > 320,
    variableIndex,
    transformSources,
    pageLoadScriptIds,
    serverStepIds,
    elements,
    focusNodeId,
    readOnly: false,
    activeSlot: null,
    selected: new Set<string>(),
    zOrder: new Map<string, number>(),
    // 取得のように後から呼ばれることがあるため、描画した時点ではなく最新の状態に適用する
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
    isPageLoadRoot: (loc) => loc.list === "root" && pageLoadScriptIds.has(loc.scriptId),
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
        () => {
          const [remaining, steps] = takeAt(latest.current.scripts, loc);
          return { type: "steps", steps, from: { loc, remaining } };
        },
        `step:${stepId}`
      ),
    beginScript: (e, script) =>
      begin(
        e,
        () => {
          // 選択中のスクリプトがあれば一緒に動かす
          // 選択数がプレビューの表示上限を超えても、つかんだブロックは必ず表示する。
          const group = [script, ...latest.current.scripts.filter(
            (s) => s.id !== script.id && selectedRef.current.has(`script:${s.id}`)
          )];
          return { type: "script", script, group };
        },
        `script:${script.id}`
      ),
    openMenu: (e, target, key) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedRef.current.has(key)) setSelectedList([key]);
      setMenu({ x: e.clientX, y: e.clientY, target, key });
    },
  }), [doc, activePageId, extraRootIds, targets, tree, targetLookup, fieldLookup, scripts,
    stepOwners, variableIndex, transformSources, pageLoadScriptIds, serverStepIds, elements, focusNodeId,
    commit, updateDoc, nodeIds, arrays, samples, begin]);
  const ctx = useMemo<EdCtx>(() => ({ ...sharedCtx, selected, zOrder }),
    [sharedCtx, selected, zOrder]);

  const runMenu = (action: "delete" | "duplicate") => {
    if (!menu) return;
    const t = menu.target;
    setMenu(null);
    if (action === "delete") {
      // 右クリックしたブロックが選択に含まれていれば、選択中のものをまとめて削除する
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
    if (!list) return;
    // A collaborative edit can insert or remove siblings while the menu is open.
    const stepId = menu.key.slice("step:".length);
    const index = list[t.loc.index]?.id === stepId
      ? t.loc.index : list.findIndex((step) => step.id === stepId);
    if (index < 0) return;
    const [copy] = cloneSteps([list[index]]);
    commit(insertAt(scripts, { ...t.loc, index: index + 1 }, [copy]));
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
      aria-hidden="true"
      inert
      style={{ left: 0, top: 0,
        transform: `translate3d(${drag.x - drag.ox * zoom}px, ${drag.y - drag.oy * zoom}px, 0)` }}
    >
      <div style={{ zoom, scale: drag.modalScale ?? 1, transformOrigin: "top left" }}>
      <Ctx.Provider value={{ ...ctx, readOnly: true, activeSlot: null }}>
        {drag.payload.type === "trigger" ? (
          <div className="se-stack" style={{ width: drag.w }}>
            <HatView trigger={drag.payload.trigger} />
          </div>
        ) : drag.payload.type === "script" ? (
          (() => {
            const main = drag.payload.script;
            return drag.payload.group.slice(0, 8).map((s, i) => (
              <div
                key={s.id}
                className="se-ghost-item"
                style={{
                  left: s.pos.x - main.pos.x,
                  top: s.pos.y - main.pos.y,
                  width: drag.scriptWidths?.[s.id] ?? (s.id === main.id ? drag.w : undefined),
                }}
              >
                {drag.previewNodes?.[i] ? (
                  <div ref={(host) => {
                    const node = drag.previewNodes?.[i];
                    if (host && node && host.firstChild !== node) host.replaceChildren(node);
                  }} />
                ) : (
                  <StackView script={{ ...s, steps: ghostPreviewSteps(s.steps) }}
                    fixedWidth={drag.scriptWidths?.[s.id] ?? (s.id === main.id ? drag.w : undefined)} />
                )}
              </div>
            ));
          })()
        ) : (
          <div className={`se-stack${drag.sourceStackIdle ? " is-idle" : ""}`} style={{ width: drag.w }}>
            {drag.previewNodes?.length ? (
              <div className="se-list" ref={(host) => {
                if (host && host.firstChild !== drag.previewNodes?.[0]) {
                  host.replaceChildren(...(drag.previewNodes ?? []));
                }
              }} />
            ) : (
              <StepList scriptId="__ghost" list="root" steps={ghostPreviewSteps(drag.payload.steps)} />
            )}
            {drag.payload.steps.length > 8 && (
              <span className="se-ghost-more">
                {tr("and {n} more actions", { n: drag.payload.steps.length - 8 })}
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
        aria-label={tr("Scripts")}
        onClick={() => setMenu(null)}
      >
        <div className="se-header">
          <button
            className="se-close se-pal-toggle"
            onClick={togglePal}
            aria-label={palOpen ? tr("Close block list") : tr("Open block list")}
            aria-pressed={palOpen}
            data-tip={palOpen ? tr("Close block list") : tr("Open block list")}
          >
            {palOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <div className="se-title">
            <h2>{tr("Scripts")}</h2>
            <p>{tr("Scripts for all elements on \"{name}\"", { name: page.name })}</p>
          </div>
          <div className="se-tools">
            {selectedList.length > 1 && (
              <span className="se-sel-count">{tr("{n} selected", "n_selected_variant_1", { n: selectedList.length })}</span>
            )}
            <div className="se-zoom" role="group" aria-label={tr("Zoom")}>
              <button
                className="se-close"
                onClick={() => stepZoom(-1)}
                disabled={zoom <= ZOOM_MIN}
                aria-label={tr("Zoom out")}
                data-tip={tr("Zoom out")} data-tip-kbd="⌘-"
              >
                <Minus size={15} />
              </button>
              <button
                className="se-zoom-val"
                onClick={() => setZoom(1)}
                data-tip={tr("Reset to 100%")} data-tip-kbd="⌘0"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="se-close"
                onClick={() => stepZoom(1)}
                disabled={zoom >= ZOOM_MAX}
                aria-label={tr("Zoom in")}
                data-tip={tr("Zoom in")} data-tip-kbd="⌘+"
              >
                <Plus size={15} />
              </button>
            </div>
            <span className="se-tools-sep" />
            <button
              className="se-close"
              onClick={() => useEditor.getState().undo()}
              disabled={!canUndo}
              aria-label={tr("Remove")}
              data-tip={tr("Undo (⌘Z)")}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="se-close"
              onClick={() => useEditor.getState().redo()}
              disabled={!canRedo}
              aria-label={tr("Redo")}
              data-tip={tr("Redo (⇧⌘Z)")}
            >
              <Redo2 size={16} />
            </button>
            <span className="se-tools-sep" />
            <button className="se-close" onClick={onClose} aria-label={tr("Close")}>
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
            <ScriptPalette begin={begin} />
            <div className="se-trash">{tr("Release here to delete")}</div>
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
              // 何もない所からドラッグすると範囲選択になる（Shift / ⌘ で既存の選択に追加）
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
              {view.map((s) => (
                <ScopedStackView key={s.id} script={s} shared={sharedCtx}
                  selectedKeys={scopedSelections.get(s.id) ?? EMPTY_SCRIPT_KEYS}
                  zIndex={zOrder.get(s.id)}
                  frozenWidth={drag?.payload?.type === "steps" && drag.payload.from?.loc.scriptId === s.id
                    ? drag.sourceStackWidth : undefined} />
              ))}
            </div>
            {!scripts.length && (
              <div className="se-empty">
                <p>
                  {tr("Drag a trigger from the left onto this area, choose its element, then attach action blocks below it.")}
                </p>
                <p>
                  {trNodes("Example: \"［Button］ When clicked\" {arrow} \"Open ［page］\"", { arrow: glyphs("→") })}
                </p>
                <p>
                  {tr("To show data, attach \"Set variable ［］ to ［value］\" under \"Fetch data from ［URL］ as ［name］\" to pull out what you need (this runs when the page opens). Then select a variable that holds a list in a List display element's settings to show each item.")}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="se-footer">
          <span>{tr("Drag to connect and reorder")}</span>
          <span>
            <kbd>{glyphs("⇧")}</kbd>/<kbd>{glyphs("⌘")}</kbd>{tr("+click or drag on empty space to multi-select")}
          </span>
          <span>
            <kbd>Backspace</kbd>{tr("Delete")}
          </span>
          <span>
            <kbd>{glyphs("⌘A")}</kbd>{tr("Select all")}
          </span>
          <span>
            <kbd>{glyphs("⌘C")}</kbd>/<kbd>{glyphs("⌘X")}</kbd>/<kbd>{glyphs("⌘V")}</kbd>
            {tr("Copy")}・{tr("Cut")}・{tr("Paste")}
          </span>
          <span>
            <kbd>{glyphs("⌘Z")}</kbd>/<kbd>{glyphs("⇧⌘Z")}</kbd>{tr("Undo/redo")}
          </span>
          <InfoTip
            style={{ marginLeft: "auto" }}
            text={tr("Scripts that only open a page or URL \"When clicked\" are output as links (a tags).\nStorage uses localStorage, then a cookie for this site only, then memory (cleared when the page closes), whichever is available first.")}
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
              <SafeBoundary label={tr("Fetched data")} onClose={() => setPeekId(null)}>
                <PeekModal step={peekStep} scope={peekScope} onClose={() => setPeekId(null)} />
              </SafeBoundary>
            </Ctx.Provider>
          </div>
        )}
        {/* A fixed child of the animated, overflow-clipped modal can disappear
            at its edges. Put the preview in the viewport layer instead. */}
        {ghost && createPortal(ghost, document.body)}
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
            <button onClick={() => runMenu("duplicate")}>{tr("Duplicate")}</button>
            <button className="is-danger" onClick={() => runMenu("delete")}>
              {menuCount > 1
                ? tr("Delete {menuCount} blocks", { menuCount })
                : menu.target.type === "script"
                  ? tr("Delete script")
                  : tr("Delete this block")}
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

/** 大きなツリーは見えている部分だけを複製する。元の見出しは残し、すべての入力欄を
 * 気づかないうちに別の読み取り専用の表示に置き換えることはしない。 */
function boundedDragCopy(source: HTMLElement): HTMLElement | null {
  if (source.classList.contains("se-stack")) {
    const copy = source.cloneNode(false) as HTMLElement;
    const head = source.querySelector<HTMLElement>(":scope > .se-hat, :scope > .se-hat-slot");
    if (head) copy.appendChild(cloneDragElement(head) ?? head.cloneNode(true));
    const list = source.querySelector<HTMLElement>(":scope > .se-list");
    if (list) {
      const preview = list.cloneNode(false) as HTMLElement;
      // 仮想化したスタックでは、項目の行が直接ではなくチャンクの中にあることがある。
      const items = list.querySelectorAll<HTMLElement>(":scope > .se-item, :scope > .se-virtual-chunk > .se-item");
      for (const item of Array.from(items).slice(0, 8)) {
        const copyItem = cloneDragElement(item);
        if (copyItem) preview.appendChild(copyItem);
      }
      copy.appendChild(preview);
    }
    return copy;
  }
  if (source.classList.contains("se-item")) {
    const copy = source.cloneNode(false) as HTMLElement;
    const first = source.firstElementChild;
    if (!(first instanceof HTMLElement)) return copy;
    if (first.classList.contains("se-c")) {
      const structure = first.cloneNode(false) as HTMLElement;
      const head = first.querySelector<HTMLElement>(":scope > .se-c-head");
      if (head) structure.appendChild(cloneDragElement(head) ?? head.cloneNode(true));
      copy.appendChild(structure);
    } else {
      const row = cloneDragElement(first);
      if (row) copy.appendChild(row);
    }
    return copy;
  }
  return null;
}

/** 行を元の兄弟やループの中から取り出してドラッグ用の層に浮かせても、
 * 元と同じ形と装飾になるようにする。 */
function freezeDragAppearance(source: HTMLElement, copy: HTMLElement, shallow = false) {
  const selector = ".se-stack, .se-item, .se-blk, .se-c, .se-c-mid, .se-if-conditions, .se-if-condition-line, .np-btn";
  // 短くしたプレビューは、元より子孫の数が少ない。その子要素は個別に複製したときに
  // すでに固定済みのため、別のツリーで同じ位置にあるというだけで無関係な行を対応させない。
  const original = [source, ...(shallow ? [] : source.querySelectorAll<HTMLElement>(selector))]
    .filter((el) => el.matches(selector));
  const cloned = [copy, ...(shallow ? [] : copy.querySelectorAll<HTMLElement>(selector))]
    .filter((el) => el.matches(selector));
  for (let i = 0; i < Math.min(original.length, cloned.length); i++) {
    const from = original[i];
    const to = cloned[i];
    const computed = getComputedStyle(from);
    // 枠線や字下げは :first-child や .se-c-body に左右されることがあり、
    // ブロックを切り離した後のゴーストではそれを再現できない。
    for (const property of [
      "padding-top", "padding-right", "padding-bottom", "padding-left",
      "border-top-width", "border-top-style", "border-top-color",
      "border-bottom-width", "border-bottom-style", "border-bottom-color",
      "border-top-left-radius", "border-top-right-radius",
      "border-bottom-left-radius", "border-bottom-right-radius",
      "background-color", "color",
    ]) to.style.setProperty(property, computed.getPropertyValue(property));
    // こうしないと、drag.w でゴーストの外形を固定していても、入れ子の項目や折り返した条件が
    // 新しい親に合わせて大きさを変えてしまう。条件のブロックがドラッグ用の層に入ると、
    // 選択済みの要素の選択欄や、折り返した条件の行もフレックスの幅を計算し直してしまう。
    if (from.matches(".se-blk, .se-item, .se-stack, .se-if-conditions, .se-if-condition-line, .np-btn")) {
      to.style.boxSizing = "border-box";
      to.style.width = `${from.offsetWidth}px`;
    }
  }
}

/** 実際に描画されている部品をそのまま使い、読み取り専用の代わりの表示に作り直さない。
 * 巨大なツリーは、先頭の見えている行だけに限る。 */
function cloneDragElement(source: HTMLElement): HTMLElement | null {
  const cap = 350;
  let count = 0;
  const walker = document.createTreeWalker(source, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    if (++count > cap) break;
  }
  const copy = count > cap ? boundedDragCopy(source) : source.cloneNode(true) as HTMLElement;
  if (!copy) return null;
  if (count <= cap) {
    const actual = source.querySelectorAll("input, select, textarea");
    const cloned = copy.querySelectorAll("input, select, textarea");
    for (let i = 0; i < actual.length; i++) {
      const original = actual[i];
      const target = cloned[i];
      if (original instanceof HTMLInputElement && target instanceof HTMLInputElement) {
        target.value = original.value;
        target.checked = original.checked;
      } else if (original instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
        target.selectedIndex = original.selectedIndex;
      } else if (original instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
        target.value = original.value;
      }
    }
  }
  freezeDragAppearance(source, copy, count > cap);
  // この操作できない複製に、label の対象や編集可能な内容の ID を重複させない。
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  return copy;
}

/** ドラッグのプレビューでは、とても長い手順のツリーの複製を2つ目としてマウントしない。 */
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
