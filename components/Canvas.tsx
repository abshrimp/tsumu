"use client";

import { isEnterKey } from "../lib/keys";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpLeft } from "lucide-react";
import NodeContextMenu, { type CtxMenuState } from "./NodeContextMenu";
import FrameStage from "./FrameStage";
import { CommentLayer } from "./Comments";
import { useEditor, type ParentRef } from "../lib/store";
import { useHtmlPreview } from "./canvas/useHtmlPreview";
import { keyOfItem, sameKey, varNamesAt, varSamplesAt } from "../lib/data";
import { findVarQuery, varQueryEnd, isSlugPage, isVarListShortcut, matchVarNames } from "../lib/vars";
import { editableText, selectionOffsets, setEditable } from "../lib/editable";
import { fieldDefaults, fieldValuePatch } from "../lib/fields";
import {
  isVarAcceptKey,
  moveVarSuggest,
  pickedVar,
  shouldShowVarSuggest,
  varSuggestPos,
  varSuggestionAnchorVisible,
  VarSuggestMenu,
  type VarSuggest,
} from "./controls";
import { createScriptRuntime, type ScriptEnv } from "../lib/script-runtime";
import { BODY_NODE_ID } from "../lib/types";
import { cssQuotedAttributeValue } from "../lib/css-selector";
import { BP_INFO, toggleShowDisplay } from "../lib/style";
import { pageLangOf, siteLangOf } from "../lib/site-lang";
import VarExplorer from "./VarExplorer";
import { tr } from "../lib/i18n";
import { buildCanvasCss, previewHtmlWithBodyStyles, type CanvasCssCache } from "./canvas/css";
import { MemoNodeView } from "./canvas/NodeView";
import {
  InstanceChainCtx,
  SCROLL_KEY,
  VarsCtx,
  applyScriptsAttr,
  holdEditing,
  type CanvasVars,
} from "./canvas/render";
import { useCanvasDrag } from "./canvas/useCanvasDrag";
import { useCanvasData } from "./canvas/useCanvasData";

/* ---------- 選択オーバーレイ ---------- */

interface SelRect {
  left: number;
  top: number;
  width: number;
  height: number;
  realW: number;
  realH: number;
}

/** クリックした場所を含む要素（data-node）を、外側から内側の順に並べる */
function nodeElementsOf(target: Element): Element[] {
  const out: Element[] = [];
  let el: Element | null = target.closest("[data-node]");
  while (el) {
    out.unshift(el);
    el = el.parentElement?.closest("[data-node]") ?? null;
  }
  return out;
}

/** 2つの枠が（1px未満の差で）同じ位置・大きさか */
function sameRect(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.right - b.right) < 1 &&
    Math.abs(a.bottom - b.bottom) < 1
  );
}

/* ---------- キャンバス本体 ---------- */

export default function Canvas() {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const selection = useEditor((s) => s.selection);
  const breakpoint = useEditor((s) => s.breakpoint);
  const setBreakpoint = useEditor((s) => s.setBreakpoint);
  const styleState = useEditor((s) => s.styleState);
  const mode = useEditor((s) => s.mode);
  const zoom = useEditor((s) => s.zoom);
  const editingText = useEditor((s) => s.editingText);
  const select = useEditor((s) => s.select);
  const toggleSelection = useEditor((s) => s.toggleSelection);
  const setEditingText = useEditor((s) => s.setEditingText);
  const setStyleProps = useEditor((s) => s.setStyleProps);
  const insertNodes = useEditor((s) => s.insertNodes);
  const [dropState, setDropState] = useState<"none" | "over">(
    "none"
  );
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [elemDropTarget, setElemDropTarget] = useState<string | null>(null);
  /** キャンバス内でドラッグして移動するときの表示状態 */
  const [moveDrag, setMoveDrag] = useState<{
    /** 動かしている要素（複数選択のうちの1つをつかんだ場合は、選択中のすべての要素） */
    dragIds: string[];
    line: { left: number; top: number; width: number; height: number } | null;
    insideId: string | null;
  } | null>(null);
  const moveDropRef = useRef<{ parent: ParentRef; index: number } | null>(null);
  const moveState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    id: string;
    ids: string[];
    active: boolean;
  } | null>(null);
  const movedJustNow = useRef(false);

  const areaRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [rect, setRect] = useState<SelRect | null>(null);

  const page = doc.pages[activePageId];
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const setEditingComponent = useEditor((s) => s.setEditingComponent);
  const previewIndex = useEditor((s) => s.previewIndex);
  const setPreviewIndex = useEditor((s) => s.setPreviewIndex);
  const editingComp = editingComponentId
    ? doc.components?.[editingComponentId]
    : null;
  const hasVisualFrame = !!page && (!!editingComp || (
    page.rawHtml == null && page.redirectTo === undefined && page.rewriteTo === undefined
  ));
  /** キャンバスに描画するルートの一覧（ページ、またはコンポーネントのマスター） */
  const rootIds = editingComp ? [editingComp.rootId] : (page?.children ?? []);
  /** 編集中のコンポーネントの中に、そのコンポーネント自身のインスタンスがあっても、際限なく描画しない */
  const editingCompKey = editingComp?.id ?? null;
  const instanceChain = useMemo(() => (editingCompKey ? [editingCompKey] : []), [editingCompKey]);

  /**
   * HTMLページのプレビュー。中のスクリプトがエディタの権限を使えないよう、別オリジンの iframe で表示する。
   * その iframe には Cookie が送られないため、アセットは期限付きの署名URLに置き換えて読ませる
   */
  const rawHtmlSrc = !editingComp && mode === "preview" ? (page?.rawHtml ?? "") : "";
  const { html: rawHtmlForPreview, error: rawHtmlError, needsRefresh, refreshing: refreshingHtml, refresh } = useHtmlPreview(rawHtmlSrc, doc.assets, page?.htmlZip);

  const {
    fieldValues,
    setFieldValues,
    setClientValues,
    previewSlug,
    setPreviewSlug,
    refreshing,
    primary,
    primaryFindBy,
    primaryItems,
    setTypedSlugOf,
    slugNotFound,
    slugVal,
    plan,
    fieldVarNodes,
    fetchedVars,
    pageVars,
    refreshData,
    setActivePage,
    navigateTo,
  } = useCanvasData({
    page,
    doc,
    activePageId,
    previewIndex,
    mode,
    setPreviewIndex,
  });

  const varsCtxValue = useMemo<CanvasVars>(
    () => ({
      pageVars,
      fieldValues,
      setFieldValue: (name, v) =>
        setFieldValues((prev) => ({ ...prev, [name]: v })),
      refresh: () => void refreshData(),
      preview: mode === "preview",
      navigate: navigateTo,
      clientVars: plan.clientVars,
      listOps: plan.listOps,
    }),
    [pageVars, fieldValues, refreshData, mode, navigateTo, plan]
  );

  // 画面上の変数は、プレビューを始めるたびに空に戻す
  useEffect(() => {
    setClientValues({});
  }, [mode]);

  /* ---- テキスト編集中の変数の予測変換 ---- */
  const [autoComp, setAutoComp] = useState<VarSuggest | null>(null);
  const autoCompMenuRef = useRef<HTMLDivElement>(null);
  const autoCompRef = useRef(autoComp);
  autoCompRef.current = autoComp;

  const editingVarNames = useMemo(
    () => editingText ? varNamesAt(doc, activePageId, editingText) : [],
    [doc, activePageId, editingText]
  );
  // 値の見本は、候補を表示している間だけ計算する
  const autoCompOpen = !!autoComp;
  const varSamples = useMemo(
    () =>
      autoCompOpen && editingText ? varSamplesAt(doc, activePageId, editingText) : undefined,
    [autoCompOpen, editingText, doc, activePageId]
  );

  const editingEl = () =>
    document.querySelector<HTMLElement>('.cv-root [data-rich-edit="true"]');

  /** manual = ショートカットで開いた候補（開いている間は、入力に合わせて絞り込む） */
  const updateAutoComp = useCallback(
    (manual = autoCompRef.current?.query.mode === "manual") => {
      const el = editingEl();
      const off = el && selectionOffsets(el);
      if (!editingText || !el || !off) {
        setAutoComp(null);
        return;
      }
      const before = editableText(el).slice(0, off[0]);
      const query = findVarQuery(before, editingVarNames, manual);
      const matches = query ? matchVarNames(editingVarNames, query).slice(0, 50) : [];
      if (!query || !shouldShowVarSuggest(query, matches, true)) {
        setAutoComp(null);
        return;
      }
      const range = window.getSelection()!.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      // 空の行などで範囲の矩形を取れなければ、要素の位置を使う
      if (!rect.height) rect = el.getBoundingClientRect();
      setAutoComp({
        pos: varSuggestPos(rect, matches.length + 1),
        query,
        matches,
        index: 0,
        explore: true,
      });
    },
    [editingText, editingVarNames]
  );

  const insertVar = useCallback((name: string) => {
    const el = editingEl();
    const ac = autoCompRef.current;
    const off = el && selectionOffsets(el);
    if (!el || !ac || !off) return;
    const text = editableText(el);
    const start = Math.min(ac.query.start, off[0]);
    const tok = `{${name}}`;
    const end = off[0] === off[1] ? varQueryEnd(text, ac.query, off[1]) : off[1];
    setEditable(el, text.slice(0, start) + tok + text.slice(end), start + tok.length);
    setAutoComp(null);
  }, []);

  useEffect(() => {
    if (!editingText) setAutoComp(null);
  }, [editingText]);

  useEffect(() => {
    if (!autoCompOpen) return;
    const closeOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (editingEl()?.contains(target) || autoCompMenuRef.current?.contains(target)) return;
      setAutoComp(null);
    };
    const closeOnFocusChange = (e: FocusEvent) => {
      if (editingEl()?.contains(e.target as Node) || autoCompMenuRef.current?.contains(e.target as Node)) return;
      setAutoComp(null);
    };
    const onScrollOrResize = (e: Event) => {
      if (autoCompMenuRef.current?.contains(e.target as Node)) return;
      const editor = editingEl();
      if (!editor || !editor.isConnected) { setAutoComp(null); return; }
      const selection = window.getSelection();
      let rect = editor.getBoundingClientRect();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
          const caret = range.getBoundingClientRect();
          if (caret.height) rect = caret;
        }
      }
      if (!varSuggestionAnchorVisible(editor, rect)) { setAutoComp(null); return; }
      setAutoComp((previous) => previous && ({
        ...previous,
        pos: varSuggestPos(rect, previous.matches.length + (previous.explore ? 1 : 0)),
      }));
    };
    const loseWindowFocus = () => setAutoComp(null);
    window.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOnFocusChange, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("blur", loseWindowFocus);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOnFocusChange, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("blur", loseWindowFocus);
    };
  }, [autoCompOpen]);

  /** 「変数を探す」で置き換える範囲（開いている間もテキストの編集は続ける） */
  const [explore, setExplore] = useState<{ nodeId: string; start: number; end: number } | null>(
    null
  );
  const openExplore = useCallback(() => {
    const el = editingEl();
    const ac = autoCompRef.current;
    const off = el && selectionOffsets(el);
    if (!el || !ac || !off || !editingText) return;
    holdEditing.current = true;
    const end = off[0] === off[1] ? varQueryEnd(editableText(el), ac.query, off[1]) : off[1];
    setExplore({ nodeId: editingText, start: Math.min(ac.query.start, off[0]), end });
    setAutoComp(null);
  }, [editingText]);
  const exploreRef = useRef(explore);
  exploreRef.current = explore;
  const closeExplore = useCallback((name: string | null) => {
    const el = editingEl();
    const ex = exploreRef.current;
    if (el && ex) {
      const text = editableText(el);
      el.focus();
      if (name) {
        const tok = `{${name}}`;
        setEditable(el, text.slice(0, ex.start) + tok + text.slice(ex.end), ex.start + tok.length);
      } else {
        setEditable(el, text, ex.end);
      }
    }
    setExplore(null);
    holdEditing.current = false;
  }, []);

  const customWidth = useEditor((s) => s.customWidth);
  const frameWidth = customWidth ?? BP_INFO[breakpoint].width;
  // 幅のハンドルをドラッグしている間は倍率を固定する（画面に収める倍率が追従すると、幅の変化が見えなくなる）
  const [dragScale, setDragScale] = useState<number | null>(null);
  const scale = dragScale ?? (zoom > 0 ? zoom : fitScale);

  // ページごとのスクロール位置を記憶し、ページを開き直したときや、次にエディタを開いたときに戻す
  const editingCompId = useEditor((s) => s.editingComponentId);
  useEffect(() => {
    const area = areaRef.current;
    if (!area || editingCompId) return;
    const key = activePageId;
    const read = (): Record<string, [number, number]> => {
      try {
        return JSON.parse(window.localStorage.getItem(SCROLL_KEY) ?? "{}");
      } catch {
        return {};
      }
    };
    const saved = read()[key];
    // 内容の高さが決まってから戻す
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        if (saved) {
          area.scrollTop = saved[0];
          area.scrollLeft = saved[1];
        }
      });
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const all = read();
          all[key] = [Math.round(area.scrollTop), Math.round(area.scrollLeft)];
          window.localStorage.setItem(SCROLL_KEY, JSON.stringify(all));
        } catch {
          // 保存できなくても、編集は続けられる
        }
      }, 250);
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      area.removeEventListener("scroll", onScroll);
    };
  }, [activePageId, editingCompId]);

  // Cmd/Ctrl + スクロールで拡大・縮小する（ピンチ操作も ctrlKey 付きのイベントとして届く）
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const s = useEditor.getState();
      const cur = s.zoom > 0 ? s.zoom : fitScale;
      const next = Math.min(3, Math.max(0.1, cur * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      s.setZoom(Math.round(next * 100) / 100);
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [fitScale]);

  // 画面に収まる倍率を計算する
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    // clientWidth はスクロールバーの表示の有無で変わる。それを基準にすると、倍率の変更 →
    // 内容の高さの変化 → スクロールバーの表示の切り替え…が繰り返し起きるため、
    // スクロールバーを含む offsetWidth を基準にする
    const update = () =>
      setFitScale(Math.min(1, (area.offsetWidth - 56) / frameWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(area);
    return () => ro.disconnect();
  }, [frameWidth]);

  // プレビューの「表示の切り替え」で付いたインラインの display を、デザインに戻るときに取り除く
  useEffect(() => {
    if (mode === "preview") return;
    frameRef.current
      ?.querySelectorAll<HTMLElement>("[data-tgl-touched]")
      .forEach((el) => {
        el.style.display = "";
        delete el.dataset.tglTouched;
      });
  }, [mode]);

  // プレビュー: スクリプトを、書き出したサイトと同じランタイムで動かす
  const scriptEnvRef = useRef<ScriptEnv>({});
  scriptEnvRef.current = {
    getPageData: () => fetchedVars,
    touch: (el) => {
      el.dataset.tglTouched = "1";
    },
    showDisplay: (el) => {
      const id = el.getAttribute("data-node") ?? el.getAttribute("data-ghost");
      const n = id ? doc.nodes[id] : undefined;
      return n ? toggleShowDisplay(n) : "block";
    },
    openPage: (st) => setActivePage(st.pageId),
    openUrl: (url, newTab) => {
      if (/^\s*(?:javascript|vbscript|data):/i.test(url)) return;
      if (newTab) window.open(url, "_blank", "noopener");
      else navigateTo(url);
    },
    // フォーム部品の値は React の状態で持つ
    setValue: (id, v) => {
      // ID 属性やラジオのグループ名で入力欄を探す（グループのボタン1つには true / false を渡す）
      const defaults = fieldDefaults(fieldVarNodes, pageVars);
      if (!fieldValuePatch(fieldVarNodes, id, v, defaults, pageVars)) return false;
      // 同じスクリプトで続けて設定した場合も、直前の更新を含む値をもとに選択・解除する。
      setFieldValues((prev) => ({
        ...prev,
        ...fieldValuePatch(fieldVarNodes, id, v, { ...defaults, ...prev }, pageVars),
      }));
      return true;
    },
  };
  // リスナーと保留中のスクリプトは、ページやマスターを開くたびに用意し直す。HTMLページや
  // リダイレクト・リバースプロキシの表示では frameRef が外れるため、戻ったときに入れ直す必要がある。
  // doc には依存させない（通常のデータやスタイルの更新で「開いたとき」を再実行しないため）。
  useEffect(() => {
    if (mode !== "preview" || !hasVisualFrame) return;
    const root = frameRef.current;
    if (!root) return;
    // 最新の state を参照するため、ref を介して呼ぶ（入れ直すと「開いたとき」が再実行される）
    const env: ScriptEnv = {
      touch: (el) => scriptEnvRef.current.touch?.(el),
      showDisplay: (el) => scriptEnvRef.current.showDisplay?.(el) ?? "block",
      openPage: (st) => scriptEnvRef.current.openPage?.(st),
      openUrl: (url, newTab) => scriptEnvRef.current.openUrl?.(url, newTab),
      setValue: (id, v) => scriptEnvRef.current.setValue?.(id, v) ?? false,
      getPageData: () => scriptEnvRef.current.getPageData?.() ?? {},
      setVar: (root, value) => setClientValues((prev) => ({ ...prev, [root]: value })),
      // エディタ自身の保存と混ざらないよう、プレビューのストレージには別のキーを使う
      storePrefix: "site-preview:",
    };
    return createScriptRuntime(env).install(root);
  }, [mode, activePageId, editingComponentId, hasVisualFrame]);

  // テキストの編集中に一部を選択した範囲を追跡する（スタイルパネルで span に分けるときに使う）
  const setTextSel = useEditor((s) => s.setTextSel);
  useEffect(() => {
    if (!editingText) return;
    const onSel = () => {
      const el = frameRef.current?.querySelector<HTMLElement>(
        '[data-editing="true"]'
      );
      if (!el) return;
      const sel = window.getSelection();
      if (!sel?.rangeCount) return;
      const range = sel.getRangeAt(0);
      // 編集中の要素の外の選択は無視する（パネルの操作で選択が移っても、直前の範囲を残す）
      if (
        !el.contains(range.startContainer) ||
        !el.contains(range.endContainer)
      ) {
        return;
      }
      if (range.collapsed) {
        setTextSel(null);
        return;
      }
      const pre = document.createRange();
      pre.selectNodeContents(el);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const text = range.toString();
      const total = (el.textContent ?? "").length;
      if (start <= 0 && start + text.length >= total) {
        // 全体を選択した場合は、要素全体へのスタイルの変更として扱う
        setTextSel(null);
        return;
      }
      setTextSel({ nodeId: editingText, start, end: start + text.length, text });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editingText, setTextSel]);

  // 選択枠の測定は、変更があったときだけ行う。要素が多くても、何もしていない間に
  // 毎フレーム getBoundingClientRect や offsetWidth でレイアウトを読まないようにする。
  useEffect(() => {
    if (!selection || mode !== "design") {
      setRect(null);
      return;
    }
    const frame = frameRef.current;
    const inner = innerRef.current;
    if (!frame || !inner) {
      setRect(null);
      return;
    }

    let pendingFrame = 0;
    let motionFrame = 0;
    let activeMotions = 0;
    let observedNode: HTMLElement | null = null;
    const selector = selection === BODY_NODE_ID
      ? ".cv-root"
      : `[data-node=${cssQuotedAttributeValue(selection)}]`;

    const measure = () => {
      const el = frame.querySelector<HTMLElement>(selector);
      // 選択した要素は、選択中の ID が変わらないまま、編集や元に戻す操作で別の要素に置き換わることがある。
      // 古い要素ではなく、新しい要素を監視する。
      if (observedNode !== el) {
        if (observedNode) resizeObserver.unobserve(observedNode);
        if (el) resizeObserver.observe(el);
        observedNode = el;
      }
      if (!el) {
        setRect(null);
        return;
      }
      const er = el.getBoundingClientRect();
      const ir = inner.getBoundingClientRect();
      const next: SelRect = {
        left: er.left - ir.left,
        top: er.top - ir.top,
        width: er.width,
        height: er.height,
        realW: el.offsetWidth,
        realH: el.offsetHeight,
      };
      setRect((prev) =>
        prev &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5 &&
        prev.realW === next.realW &&
        prev.realH === next.realH
          ? prev
          : next
      );
    };
    const schedule = () => {
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        measure();
      });
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(inner);
    resizeObserver.observe(frame);

    // 兄弟の要素が変わると、選択した要素の大きさが変わらなくても選択枠の位置がずれることがある。
    // DOM とストアの更新を1フレームにまとめて処理する。
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(frame, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      characterData: true,
    });
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.doc !== previous.doc || state.zoom !== previous.zoom ||
          state.breakpoint !== previous.breakpoint ||
          state.customWidth !== previous.customWidth ||
          state.styleState !== previous.styleState) schedule();
    });

    // トランジションやアニメーションが実際に動いている間は毎フレーム追跡し、
    // 終わったらすぐにイベントで更新する待機の状態へ戻る。
    const trackMotion = () => {
      if (!activeMotions) return;
      measure();
      motionFrame = requestAnimationFrame(trackMotion);
    };
    const onMotionStart = () => {
      activeMotions++;
      if (activeMotions === 1) trackMotion();
    };
    const onMotionEnd = () => {
      activeMotions = Math.max(0, activeMotions - 1);
      if (!activeMotions) {
        cancelAnimationFrame(motionFrame);
        motionFrame = 0;
        schedule();
      }
    };
    const starts = ["transitionrun", "animationstart"] as const;
    const ends = ["transitionend", "transitioncancel", "animationend", "animationcancel"] as const;
    for (const type of starts) frame.addEventListener(type, onMotionStart, true);
    for (const type of ends) frame.addEventListener(type, onMotionEnd, true);

    const area = areaRef.current;
    area?.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    frame.addEventListener("pointerover", schedule, true);
    frame.addEventListener("pointerout", schedule, true);
    schedule();

    return () => {
      cancelAnimationFrame(pendingFrame);
      cancelAnimationFrame(motionFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      unsubscribe();
      for (const type of starts) frame.removeEventListener(type, onMotionStart, true);
      for (const type of ends) frame.removeEventListener(type, onMotionEnd, true);
      area?.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      frame.removeEventListener("pointerover", schedule, true);
      frame.removeEventListener("pointerout", schedule, true);
    };
  }, [selection, mode, activePageId, editingComponentId, page?.rawHtml, page?.redirectTo, page?.rewriteTo]);

  // クリックした位置までの経路（最上位から最も内側まで）を求める
  const pathTo = useCallback((target: Element): string[] => {
    return nodeElementsOf(target).map((el) => el.getAttribute("data-node")!);
  }, []);

  /**
   * クリックで選ぶ要素を決める（Figma に近い選び方）。
   * - ⌘/Ctrl+クリック: 最も内側の要素を直接選ぶ
   * - 選んでいる要素の中: 1階層ずつ内側へ進む
   * - 兄弟・いとこ: 選んでいる要素と同じ階層
   * - 無関係な要素・未選択: 最上位の要素
   * いずれの場合も、親と同じ大きさで見分けがつかない階層（1つだけ入れたラッパーなど）は飛ばし、
   * クリックしても選択枠が変わらない、ということが起きないようにする
   */
  const onCanvasClick = (e: React.MouseEvent) => {
    if (mode !== "design") return;
    if (movedJustNow.current) return;
    if (editingText) return;
    e.preventDefault();
    const els = nodeElementsOf(e.target as Element);
    const ids = els.map((el) => el.getAttribute("data-node")!);
    if (!ids.length) {
      select((e.target as Element).closest(".cv-root") ? BODY_NODE_ID : null);
      return;
    }
    const deepest = ids[ids.length - 1];
    if (e.shiftKey) {
      toggleSelection(deepest);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      select(deepest);
      return;
    }
    const rects = els.map((el) => el.getBoundingClientRect());
    /** i 番目の階層が、すぐ外側の階層と見た目で区別できないか */
    const sameAsParent = (i: number) => i > 0 && sameRect(rects[i], rects[i - 1]);
    /** i から内側へ進み、見た目で区別できる最初の階層を返す */
    const visible = (i: number) => {
      while (i < ids.length - 1 && sameAsParent(i)) i++;
      return i;
    };
    const selIndex = selection ? ids.indexOf(selection) : -1;
    if (selIndex >= 0) {
      // 選んでいる要素の中をクリックした → 1階層（見た目が異なる階層まで）内側へ進む
      select(ids[selIndex === ids.length - 1 ? selIndex : visible(selIndex + 1)]);
      return;
    }
    // 兄弟・いとこ（共通の祖先がある）→ 選んでいる要素と同じ階層 / 無関係 → 最上位
    const selEl = selection
      ? frameRef.current?.querySelector(`[data-node=${cssQuotedAttributeValue(selection)}]`)
      : null;
    const selPath = selEl ? pathTo(selEl) : [];
    let k = 0;
    while (k < ids.length && k < selPath.length && ids[k] === selPath[k]) k++;
    const depth = k > 0 ? Math.max(k, selPath.length - 1) : 0;
    select(ids[visible(Math.min(depth, ids.length - 1))]);
  };

  const onCanvasDblClick = (e: React.MouseEvent) => {
    if (mode !== "design" || editingText) return;
    const ids = pathTo(e.target as Element);
    if (!ids.length) return;
    const deepest = ids[ids.length - 1];
    const node = doc.nodes[deepest];
    select(deepest);
    if (node?.type === "instance" && node.componentId) {
      // インスタンスをダブルクリックした → マスターの編集に移る
      setEditingComponent(node.componentId);
      return;
    }
    if (node && node.type === "box" && node.children.length === 0) {
      setEditingText(deepest);
    }
  };

  const { resizing, onCvPointerDown, startResize, dropHandlers, uploading } = useCanvasDrag({
    innerRef,
    doc,
    editingComp,
    activePageId,
    mode,
    editingText,
    moveState,
    select,
    moveDropRef,
    setMoveDrag,
    movedJustNow,
    selection,
    frameRef,
    scale,
    setStyleProps,
    setDropState,
    insertNodes,
    elemDropTarget,
    setElemDropTarget,
    dropState,
  });

  // 大きくなり得るスタイルシートは、文書のスタイルが変わったときだけ作り直す。
  // 選択の変更でスタイルシートを作り直すのは、既定以外の状態を確認しているときだけ。
  const cssSelection = mode === "design" && styleState !== "default" ? selection : null;
  const cssCache = useMemo<CanvasCssCache>(() => new Map(), []);
  const css = useMemo(
    () => page
      ? buildCanvasCss(doc, rootIds, breakpoint, mode, cssSelection, styleState, page.bodyStyles, cssCache)
      : "",
    // rootIds and page are derived from doc, activePageId and editingComponentId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, activePageId, editingComponentId, breakpoint, mode, cssSelection, styleState, cssCache]
  );

  if (!page) return <div className="canvas-area" ref={areaRef} />;

  if (
    !editingComp &&
    (page.redirectTo !== undefined || page.rewriteTo !== undefined)
  ) {
    return (
      <div className="canvas-area" ref={areaRef}>
        <div className="canvas-inner">
          <FrameStage frameWidth={frameWidth} scale={scale} areaRef={areaRef} onDragScale={setDragScale}>
          <div
            className="canvas-frame is-preview"
            style={{ width: frameWidth, zoom: scale } as React.CSSProperties}
          >
            <div className="cv-placeholder" style={{ minHeight: 320 }}>
              {page.redirectTo?.trim()
                ? tr("This page redirects (301) to \"{redirectTo}\"", { redirectTo: page.redirectTo })
                : page.rewriteTo?.trim()
                  ? tr("This page shows content from the external site \"{rewriteTo}\"", { rewriteTo: page.rewriteTo })
                  : tr("Set a 301 redirect target or an external site in the right panel")}
            </div>
          </div>
          </FrameStage>
        </div>
      </div>
    );
  }

  // HTMLページは、デザインの編集中はコードを実行せず、プレビューのときだけ iframe で表示する。
  if (!editingComp && page.rawHtml != null) {
    return (
      <div className="canvas-area" ref={areaRef}>
        <div className="canvas-inner">
          <FrameStage frameWidth={frameWidth} scale={scale} areaRef={areaRef} onDragScale={setDragScale}>
          <div
            className="canvas-frame is-preview"
            style={{ width: frameWidth, zoom: scale } as React.CSSProperties}
          >
            {mode === "design" ? (
              <div className="cv-placeholder" style={{ minHeight: 320 }}>
                {page.rawHtml.trim()
                  ? tr("This is an HTML page. Edit its code in the right panel and check how it works in preview mode.")
                  : tr("Enter HTML code in the right panel, or load a file")}
              </div>
            ) : (
              <>
                {needsRefresh && <div role="status" className="cv-placeholder">
                  {tr("The preview asset URLs will expire soon. Refreshing resets form entries and the current state of the page.")}
                  <button type="button" disabled={refreshingHtml} onClick={refresh}>{tr("Refresh preview")}</button>
                </div>}
                {rawHtmlError ? <div role="alert" className="cv-placeholder">
                  {rawHtmlError}
                  <button type="button" disabled={refreshingHtml} onClick={refresh}>{tr("Refresh preview")}</button>
                </div> : page.rawHtml.trim() ? (
                  <iframe
                    className="rawhtml-frame"
                    srcDoc={previewHtmlWithBodyStyles(
                      rawHtmlForPreview,
                      page.bodyStyles,
                      breakpoint
                    )}
                    // allow-same-origin は付けない（付けると、中のスクリプトがエディタと同じオリジンで動き、
                    // ログイン中の権限で公開やアカウントの追加などができてしまう）
                    sandbox="allow-scripts allow-forms allow-popups"
                    title={page.name}
                  />
                ) : (
                  <div className="cv-placeholder" style={{ minHeight: 320 }}>
                    {tr("Enter HTML code in the right panel, or load a file")}
                  </div>
                )}
              </>
            )}
          </div>
          </FrameStage>
        </div>
      </div>
    );
  }

  const selNode =
    selection === BODY_NODE_ID
      ? { name: "body", locked: true }
      : selection
        ? doc.nodes[selection]
        : null;

  return (
    <div
      className="canvas-area"
      ref={areaRef}
      data-tutorial="canvas"
      {...dropHandlers}
    >
      <VarsCtx.Provider value={varsCtxValue}>
      {(uploading || dropState !== "none") && (
        <div className="canvas-drop-overlay">
          {uploading
            ? tr("Uploading…")
            : tr("Drop to add images")}
        </div>
      )}
      <div className="canvas-bars">
      {mode === "design" && (breakpoint !== "base" || customWidth !== null) && (
        <div className={`bp-bar${breakpoint === "base" ? "" : " is-bp"}`} data-tutorial="bp-bar">
          <span className="bp-bar-name">
            {customWidth !== null
              ? tr("Editing at {customWidth}px ({label})", { customWidth, label: BP_INFO[breakpoint].label })
              : tr("Editing {label} ({width}px)", { label: BP_INFO[breakpoint].label, width: BP_INFO[breakpoint].width })}
          </span>
          <span className="bp-bar-scope">
            {breakpoint !== "base"
              ? tr("{scope}. The desktop layout won't change", { scope: BP_INFO[breakpoint].scope })
              : tr("{scope}", { scope: BP_INFO[breakpoint].scope })}
          </span>
          <button className="btn btn-sm" onClick={() => setBreakpoint("base")}>
            {tr("Back to desktop")}
          </button>
        </div>
      )}
      {editingComp && (
        <div className="comp-edit-bar" data-tutorial="comp-edit-bar">
          <span>
            {tr("Editing component:")} <strong>{editingComp.name}</strong>
            {tr(" (changes apply to every instance)")}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => setEditingComponent(null)}
          >
            {tr("Done")}
          </button>
        </div>
      )}
      {!editingComp && page && (primary || isSlugPage(page.slug)) && (
        <div className="dyn-bar">
          {primaryFindBy ? (
            <>
              <label htmlFor="canvas-preview-data">{tr("Showing data:")}</label>
              <select
                id="canvas-preview-data"
                className="select dyn-select"
                value={slugNotFound ? "" : previewIndex}
                onChange={(e) => {
                  setTypedSlugOf(null);
                  setPreviewIndex(+e.target.value);
                }}
              >
                {slugNotFound && <option value="">{tr("(No match)")}</option>}
                {primaryItems.map((item, i) => (
                  <option key={i} value={i}>
                    {String(keyOfItem(item, primaryFindBy) ?? tr("Item {p1}", { p1: i + 1 })).slice(0, 40)}
                  </option>
                ))}
              </select>
              <label htmlFor="canvas-preview-slug">slug:</label>
              <input
                id="canvas-preview-slug"
                className="input dyn-select dyn-slug"
                value={slugVal}
                onChange={(e) => {
                  const v = e.target.value;
                  setTypedSlugOf({ pageId: activePageId, value: v });
                  const idx = primaryItems.findIndex((it) =>
                    sameKey(keyOfItem(it, primaryFindBy), v)
                  );
                  if (idx >= 0) setPreviewIndex(idx);
                }}
              />
              {slugNotFound && (
                <span className="dyn-note">
                  {tr("No matching data (shows 404 on the live site)")}
                </span>
              )}
            </>
          ) : (
            <>
              <label htmlFor="canvas-preview-slug">slug:</label>
              <input
                id="canvas-preview-slug"
                className="input dyn-select"
                value={previewSlug}
                onChange={(e) => setPreviewSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (isEnterKey(e)) void refreshData();
                }}
              />
              {primary && (
                <button
                  className="btn btn-sm"
                  disabled={refreshing}
                  onClick={() => void refreshData()}
                  style={{
                    background: "rgba(255,255,255,0.95)",
                    color: "var(--text)",
                    borderColor: "transparent",
                  }}
                >
                  {refreshing ? tr("Loading…") : tr("Reload", "reload_variant_1")}
                </button>
              )}
            </>
          )}
        </div>
      )}
      </div>
      <div
        className="canvas-inner"
        ref={innerRef}
        onClick={(e) => {
          // フレームの外側（余白）をクリックしたら、選択を解除する。
          // ただし、リサイズのドラッグ直後に発生する合成クリックでは解除しない
          if (
            mode === "design" &&
            !editingText &&
            !resizing.current &&
            !movedJustNow.current &&
            !(e.target as Element).closest(".canvas-frame, .frame-handle")
          ) {
            select(null);
          }
        }}
      >
        <style>{css}</style>
        {elemDropTarget && (
          <style>{`.cv-root [data-node=${cssQuotedAttributeValue(elemDropTarget)}] { outline: 2px dashed var(--accent) !important; outline-offset: -2px; background-color: rgba(13, 153, 255, 0.06); }`}</style>
        )}
        {moveDrag && (
          <style>{`
            body { cursor: grabbing !important; }
            .cv-root { user-select: none; }
            ${moveDrag.dragIds.map((id) => `.cv-root [data-node=${cssQuotedAttributeValue(id)}]`).join(", ")} { opacity: 0.35; }
            ${moveDrag.insideId ? `.cv-root [data-node=${cssQuotedAttributeValue(moveDrag.insideId)}] { outline: 2px dashed var(--accent) !important; outline-offset: -2px; background-color: rgba(13, 153, 255, 0.06); }` : ""}
          `}</style>
        )}
        {moveDrag?.line && (
          <div
            className="move-line"
            style={{
              left: moveDrag.line.left,
              top: moveDrag.line.top,
              width: moveDrag.line.width,
              height: moveDrag.line.height,
            }}
          />
        )}
        <FrameStage frameWidth={frameWidth} scale={scale} areaRef={areaRef} onDragScale={setDragScale}>
        <div
          ref={frameRef}
          className={`canvas-frame${mode === "preview" ? " is-preview" : ""}`}
          style={{ width: frameWidth, zoom: scale } as React.CSSProperties}
        >
          <div
            className={`cv-root${mode === "design" ? " cv-design" : ""}`}
            // 公開サイトと同じ言語の字形（日本語と中国語で異なる漢字など）で表示する
            lang={editingComp ? siteLangOf(doc) : pageLangOf(doc, page)}
            data-body="true"
            data-elem-drop={elemDropTarget ?? undefined}
            onClickCapture={onCanvasClick}
            onPointerDown={onCvPointerDown}
            onInputCapture={(e) => {
              if (!(e.nativeEvent as InputEvent).isComposing) updateAutoComp();
            }}
            onCompositionEndCapture={() => updateAutoComp()}
            onKeyDownCapture={(e) => {
              if (!editingText || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              if (isVarListShortcut(e)) {
                e.preventDefault();
                e.stopPropagation();
                updateAutoComp(true);
                return;
              }
              if (!autoComp) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                setAutoComp((p) => p && moveVarSuggest(p, e.key === "ArrowDown" ? 1 : -1));
              } else if (isVarAcceptKey(autoComp, e.key)) {
                e.preventDefault();
                e.stopPropagation();
                const name = pickedVar(autoComp);
                if (name) insertVar(name);
                else openExplore();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setAutoComp(null);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                setAutoComp(null);
              }
            }}
            onSubmitCapture={(e) => e.preventDefault()}
            onMouseDownCapture={(e) => {
              // デザインの編集中は、フォーム部品へのフォーカスなどを止める（テキストの編集中は除く）
              if (mode === "design" && !editingText) {
                e.preventDefault();
                // 既定の動作を止めると選択範囲が残り、要素のコピーより優先されてしまうため、選択範囲を外す
                window.getSelection()?.removeAllRanges();
              }
            }}
            onDoubleClickCapture={onCanvasDblClick}
            onContextMenu={(e) => {
              if (mode !== "design" || editingText) return;
              e.preventDefault();
              const ids = pathTo(e.target as Element);
              const nodeId = ids.length ? ids[ids.length - 1] : null;
              if (nodeId) select(nodeId);
              setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
            }}
          >
            {mode === "preview" && !editingComp && page && (
              // 「このページ」のスクリプト（データの読み込み以外）を動かすための目印
              <span
                key={page.id}
                data-page-body={page.id}
                hidden
                {...(() => {
                  const attrs: Record<string, unknown> = {};
                  applyScriptsAttr(
                    { scripts: page.pageScripts },
                    attrs,
                    doc,
                    pageVars,
                    plan.clientVars,
                    plan.serverIds
                  );
                  return attrs;
                })()}
              />
            )}
            {rootIds.length ? (
              <InstanceChainCtx.Provider value={instanceChain}>
                {rootIds.map((id) => (
                  <MemoNodeView key={id} id={id} isTop={!editingComp} />
                ))}
              </InstanceChainCtx.Provider>
            ) : (
              <div
                style={{
                  padding: "120px 40px",
                  textAlign: "center",
                  color: "#a1a1aa",
                  fontSize: 14,
                }}
              >
                {tr("Add elements from the Add tab on the left")}
              </div>
            )}
          </div>
        </div>
        </FrameStage>

        {rect && selNode && (
          <div
            className="sel-overlay"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          >
            <span className="sel-name">
              {selection !== BODY_NODE_ID && (
                <button
                  type="button"
                  className="sel-parent"
                  data-tutorial="sel-parent"
                  aria-label={tr("Select parent", "select_parent_variant_1")}
                  data-tip={tr("Select parent (⇧Enter)")}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    useEditor.getState().selectParent();
                  }}
                >
                  <ArrowUpLeft size={11} />
                </button>
              )}
              {selNode.name}
            </span>
            <span className="sel-badge">
              {rect.realW} × {rect.realH}
            </span>
            {!selNode.locked && (
              <>
                {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((dir) => (
                  <span
                    key={dir}
                    className={`handle h-${dir}`}
                    onPointerDown={(e) => startResize(e, dir)}
                  />
                ))}
              </>
            )}
          </div>
        )}
        <CommentLayer frameRef={frameRef} innerRef={innerRef} />
      </div>
      {ctxMenu && (
        <NodeContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
      {autoComp && (
        <VarSuggestMenu
          menuRef={autoCompMenuRef}
          suggest={autoComp}
          samples={varSamples}
          onPick={insertVar}
          onExplore={openExplore}
        />
      )}
      {explore && (
        <VarExplorer
          nodeId={explore.nodeId}
          onPick={(name) => closeExplore(name)}
          onClose={() => closeExplore(null)}
        />
      )}
      </VarsCtx.Provider>
    </div>
  );
}
