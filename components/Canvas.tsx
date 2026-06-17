"use client";

import { isEnterKey } from "../lib/keys";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpLeft } from "lucide-react";
import NodeContextMenu, { type CtxMenuState } from "./NodeContextMenu";
import FrameStage from "./FrameStage";
import { CommentLayer } from "./Comments";
import { useEditor, type ParentRef } from "../lib/store";
import { withSignedAssetUrls } from "../lib/assets";
import { keyOfItem, sameKey, setVarPath, varNamesAt, varSamplesAt } from "../lib/data";
import { findVarQuery, varQueryEnd, isSlugPage, isVarListShortcut, matchVarNames } from "../lib/vars";
import { editableText, selectionOffsets, setEditable } from "../lib/editable";
import { fieldDefaults, fieldValuePatch } from "../lib/fields";
import {
  isVarAcceptKey,
  moveVarSuggest,
  pickedVar,
  shouldShowVarSuggest,
  varSuggestPos,
  VarSuggestMenu,
  type VarSuggest,
} from "./controls";
import { createScriptRuntime, type ScriptEnv } from "../lib/script-runtime";
import { BODY_NODE_ID } from "../lib/types";
import { BP_INFO, toggleShowDisplay } from "../lib/style";
import { pageLangOf, siteLangOf } from "../lib/site-lang";
import VarExplorer from "./VarExplorer";
import { tr } from "../lib/i18n";
import { buildCanvasCss, previewHtmlWithBodyStyles } from "./canvas/css";
import { NodeView } from "./canvas/NodeView";
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

/** クリックした場所から外側へ、要素（data-node）を外側→内側の順に並べる */
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
  const checkpoint = useEditor((s) => s.checkpoint);
  const setStyleProps = useEditor((s) => s.setStyleProps);
  const insertNodes = useEditor((s) => s.insertNodes);
  const updateDoc = useEditor((s) => s.updateDoc);
  const [dropState, setDropState] = useState<"none" | "over" | "uploading">(
    "none"
  );
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [elemDropTarget, setElemDropTarget] = useState<string | null>(null);
  /** キャンバス内ドラッグ移動の表示状態 */
  const [moveDrag, setMoveDrag] = useState<{
    /** 動かしている要素（複数選択の中をつかんだら選択中の全要素） */
    dragIds: string[];
    line: { left: number; top: number; width: number; height: number } | null;
    insideId: string | null;
  } | null>(null);
  const moveDropRef = useRef<{ parent: ParentRef; index: number } | null>(null);
  const moveState = useRef<{
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
  /** キャンバスに描画するルート群（ページ or コンポーネントのマスター） */
  const rootIds = editingComp ? [editingComp.rootId] : (page?.children ?? []);
  /** 編集中のコンポーネントの中に、そのコンポーネント自身のインスタンスがあっても描き続けない */
  const editingCompKey = editingComp?.id ?? null;
  const instanceChain = useMemo(() => (editingCompKey ? [editingCompKey] : []), [editingCompKey]);

  /**
   * HTMLページのプレビュー。中のスクリプトがエディタの権限を使えないよう別オリジンの iframe で表示するため、
   * アセットは期限付きの署名URLに置き換えて読ませる（Cookie が送られないので）
   */
  const rawHtmlSrc = !editingComp ? (page?.rawHtml ?? "") : "";
  const [signedRawHtml, setSignedRawHtml] = useState<{ src: string; html: string } | null>(null);
  useEffect(() => {
    if (!rawHtmlSrc.trim()) return;
    let cancelled = false;
    withSignedAssetUrls(rawHtmlSrc)
      .then((html) => {
        if (!cancelled) setSignedRawHtml({ src: rawHtmlSrc, html });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rawHtmlSrc]);
  const rawHtmlForPreview = signedRawHtml?.src === rawHtmlSrc ? signedRawHtml.html : rawHtmlSrc;

  const {
    fieldValues,
    setFieldValues,
    setClientValues,
    setLiveSamples,
    setLiveTotals,
    setFullData,
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

  // ページ切替でフォーム値・再取得データをリセット
  useEffect(() => {
    setFieldValues({});
    setLiveSamples({});
    setLiveTotals({});
    setFullData({});
    setClientValues({});
  }, [activePageId]);

  // 画面上の変数はプレビューを始めるたびに空から
  useEffect(() => {
    setClientValues({});
  }, [mode]);

  /* ---- テキスト編集の変数予測変換 ---- */
  const [autoComp, setAutoComp] = useState<VarSuggest | null>(null);
  const autoCompRef = useRef(autoComp);
  autoCompRef.current = autoComp;

  const varNamesFor = useCallback(
    (nodeId: string): string[] => varNamesAt(doc, activePageId, nodeId),
    [doc, activePageId]
  );
  // 値の見本は候補を出している間だけ計算する
  const autoCompOpen = !!autoComp;
  const varSamples = useMemo(
    () =>
      autoCompOpen && editingText ? varSamplesAt(doc, activePageId, editingText) : undefined,
    [autoCompOpen, editingText, doc, activePageId]
  );

  const editingEl = () =>
    document.querySelector<HTMLElement>('.cv-root [data-rich-edit="true"]');

  /** manual = ショートカットで開いた（開いている間は入力に合わせて絞り込む） */
  const updateAutoComp = useCallback(
    (manual = autoCompRef.current?.query.mode === "manual") => {
      const el = editingEl();
      const off = el && selectionOffsets(el);
      if (!editingText || !el || !off) {
        setAutoComp(null);
        return;
      }
      const names = varNamesFor(editingText);
      const before = editableText(el).slice(0, off[0]);
      const query = findVarQuery(before, names, manual);
      const matches = query ? matchVarNames(names, query).slice(0, 50) : [];
      if (!query || !shouldShowVarSuggest(query, matches, true)) {
        setAutoComp(null);
        return;
      }
      const range = window.getSelection()!.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      // 空の行などで矩形が取れなければ要素の位置にする
      if (!rect.height) rect = el.getBoundingClientRect();
      setAutoComp({
        pos: varSuggestPos(rect, matches.length + 1),
        query,
        matches,
        index: 0,
        explore: true,
      });
    },
    [editingText, varNamesFor]
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

  /** 「変数を探す」: 置き換える範囲（開いている間もテキスト編集は続ける） */
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
  // 幅ハンドルのドラッグ中は倍率を固定する（フィット倍率が追従すると幅が変わって見えない）
  const [dragScale, setDragScale] = useState<number | null>(null);
  const scale = dragScale ?? (zoom > 0 ? zoom : fitScale);

  // ページごとのスクロール位置を記憶し、ページを開き直したとき・次にエディタを開いたときに戻す
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
          // 保存できなくても編集は続けられる
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

  // Cmd/Ctrl + スクロールでズーム（ピンチ操作も ctrlKey として届く）
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

  // フィットスケール計算
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    // clientWidth はスクロールバーの出没で変わり、スケール変更→
    // 内容の高さ変化→スクロールバー出没…の振動ループになるため、
    // スクロールバーを含む offsetWidth を基準にする
    const update = () =>
      setFitScale(Math.min(1, (area.offsetWidth - 56) / frameWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(area);
    return () => ro.disconnect();
  }, [frameWidth]);

  // プレビューの「表示切替」で付いた inline display をデザインへ戻るとき掃除
  useEffect(() => {
    if (mode === "preview") return;
    frameRef.current
      ?.querySelectorAll<HTMLElement>("[data-tgl-touched]")
      .forEach((el) => {
        el.style.display = "";
        delete el.dataset.tglTouched;
      });
  }, [mode]);

  // プレビュー: スクリプトを書き出しサイトと同じランタイムで動かす
  const scriptEnvRef = useRef<ScriptEnv>({});
  scriptEnvRef.current = {
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
    // フォーム部品の値はReactの状態で持つ
    setValue: (id, v) => {
      // ID属性・ラジオのグループ名で入力欄を探す（グループのボタン1つには true / false）
      const patch = fieldValuePatch(fieldVarNodes, id, v, { ...fieldDefaults(fieldVarNodes), ...fieldValues });
      if (patch) setFieldValues((prev) => ({ ...prev, ...patch }));
      return !!patch;
    },
  };
  useEffect(() => {
    if (mode !== "preview") return;
    const root = frameRef.current;
    if (!root) return;
    // 最新の state を参照するため ref 経由で呼ぶ（入れ直すと「開いたとき」が再実行される）
    const env: ScriptEnv = {
      touch: (el) => scriptEnvRef.current.touch?.(el),
      showDisplay: (el) => scriptEnvRef.current.showDisplay?.(el) ?? "block",
      openPage: (st) => scriptEnvRef.current.openPage?.(st),
      openUrl: (url, newTab) => scriptEnvRef.current.openUrl?.(url, newTab),
      setValue: (id, v) => scriptEnvRef.current.setValue?.(id, v) ?? false,
      setVar: (name, v) =>
        setClientValues((prev) => {
          const next = { ...prev };
          setVarPath(next, name, v);
          return next;
        }),
      // エディタ自身の保存と混ざらないよう、プレビューのストレージは別のキーにする
      storePrefix: "site-preview:",
    };
    return createScriptRuntime(env).install(root);
  }, [mode]);

  // テキスト編集中の部分選択を追跡（スタイルパネルでのspan分割に使う）
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
      // 編集要素の外の選択は無視（パネル操作で選択が移っても直前の範囲を保持）
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
        // 全選択は要素全体へのスタイル変更として扱う
        setTextSel(null);
        return;
      }
      setTextSel({ nodeId: editingText, start, end: start + text.length, text });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editingText, setTextSel]);

  // 選択オーバーレイの位置測定（rAFループ）
  useEffect(() => {
    if (!selection || mode !== "design") {
      setRect(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const frame = frameRef.current;
      const inner = innerRef.current;
      const el = (selection === BODY_NODE_ID
        ? frame?.querySelector(".cv-root")
        : frame?.querySelector(`[data-node="${selection}"]`)) as HTMLElement | null;
      if (el && inner) {
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
      } else {
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selection, mode]);

  // クリック経路（トップレベル→最深）を求める
  const pathTo = useCallback((target: Element): string[] => {
    return nodeElementsOf(target).map((el) => el.getAttribute("data-node")!);
  }, []);

  /**
   * クリックで選ぶ要素（Figma に近い選び方）。
   * - ⌘/Ctrl+クリック: いちばん奥の要素を直接選ぶ
   * - 選んでいる要素の中: 1階層ずつ掘り下げる
   * - 兄弟・いとこ: 選んでいる要素と同じ階層
   * - 無関係・未選択: トップレベル
   * どの場合も、親と同じ大きさで見分けのつかない階層（1つだけ入れたラッパーなど）は飛ばし、
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
    /** i から奥へ、見た目で区別できる最初の階層まで進む */
    const visible = (i: number) => {
      while (i < ids.length - 1 && sameAsParent(i)) i++;
      return i;
    };
    const selIndex = selection ? ids.indexOf(selection) : -1;
    if (selIndex >= 0) {
      // 選んでいる要素の中をクリック → 1階層（見た目で違う階層まで）掘り下げる
      select(ids[selIndex === ids.length - 1 ? selIndex : visible(selIndex + 1)]);
      return;
    }
    // 兄弟・いとこ（共通の祖先がある）→ 選んでいる要素と同じ階層 / 無関係 → トップレベル
    const selEl = selection
      ? frameRef.current?.querySelector(`[data-node="${selection}"]`)
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
      // インスタンスをダブルクリック → マスターの編集へ
      setEditingComponent(node.componentId);
      return;
    }
    if (node && node.type === "box" && node.children.length === 0) {
      setEditingText(deepest);
    }
  };

  const { resizing, onCvPointerDown, startResize, dropHandlers } = useCanvasDrag({
    innerRef,
    doc,
    editingComp,
    activePageId,
    rootIds,
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
    checkpoint,
    setStyleProps,
    setDropState,
    updateDoc,
    insertNodes,
    elemDropTarget,
    setElemDropTarget,
    dropState,
  });

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
                ? tr("このページは「{redirectTo}」へ301リダイレクトします", { redirectTo: page.redirectTo })
                : page.rewriteTo?.trim()
                  ? tr("このページは外部サイト「{rewriteTo}」の内容を中継して表示します", { rewriteTo: page.rewriteTo })
                  : tr("右パネルで301リダイレクト先または表示する外部サイトを設定してください")}
            </div>
          </div>
          </FrameStage>
        </div>
      </div>
    );
  }

  // HTMLページ: iframeでそのままプレビュー（script実行込み）
  if (!editingComp && page.rawHtml != null) {
    return (
      <div className="canvas-area" ref={areaRef}>
        <div className="canvas-inner">
          <FrameStage frameWidth={frameWidth} scale={scale} areaRef={areaRef} onDragScale={setDragScale}>
          <div
            className="canvas-frame is-preview"
            style={{ width: frameWidth, zoom: scale } as React.CSSProperties}
          >
            {page.rawHtml.trim() ? (
              <iframe
                className="rawhtml-frame"
                srcDoc={previewHtmlWithBodyStyles(
                  rawHtmlForPreview,
                  page.bodyStyles,
                  breakpoint
                )}
                // allow-same-origin は付けない（付けると中のスクリプトがエディタと同じオリジンで動き、
                // ログイン中の権限で公開・アカウントの追加などができてしまう）
                sandbox="allow-scripts allow-forms allow-popups"
                title={page.name}
              />
            ) : (
              <div className="cv-placeholder" style={{ minHeight: 320 }}>
                {tr("右パネルにHTMLコードを入力するか、ファイルを読み込んでください")}
              </div>
            )}
          </div>
          </FrameStage>
        </div>
      </div>
    );
  }

  const css = buildCanvasCss(
    doc,
    rootIds,
    breakpoint,
    mode,
    selection,
    styleState,
    page.bodyStyles
  );

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
      {dropState !== "none" && (
        <div className="canvas-drop-overlay">
          {dropState === "uploading"
            ? tr("アップロード中…")
            : tr("ドロップして画像を追加")}
        </div>
      )}
      <div className="canvas-bars">
      {mode === "design" && (breakpoint !== "base" || customWidth !== null) && (
        <div className={`bp-bar${breakpoint === "base" ? "" : " is-bp"}`} data-tutorial="bp-bar">
          <span className="bp-bar-name">
            {customWidth !== null
              ? tr("幅 {customWidth}px（{label}）を編集中", { customWidth, label: BP_INFO[breakpoint].label })
              : tr("{label}（{width}px）を編集中", { label: BP_INFO[breakpoint].label, width: BP_INFO[breakpoint].width })}
          </span>
          <span className="bp-bar-scope">
            {breakpoint !== "base"
              ? tr("変更は{scope}。パソコンの見た目は変わりません", { scope: BP_INFO[breakpoint].scope })
              : tr("変更は{scope}", { scope: BP_INFO[breakpoint].scope })}
          </span>
          <button className="btn btn-sm" onClick={() => setBreakpoint("base")}>
            {tr("パソコン表示に戻る")}
          </button>
        </div>
      )}
      {editingComp && (
        <div className="comp-edit-bar" data-tutorial="comp-edit-bar">
          <span>
            {tr("コンポーネントを編集中:")} <strong>{editingComp.name}</strong>
            {tr("（変更はすべてのインスタンスに反映されます）")}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => setEditingComponent(null)}
          >
            {tr("完了")}
          </button>
        </div>
      )}
      {!editingComp && page && (primary || isSlugPage(page.slug)) && (
        <div className="dyn-bar">
          {primaryFindBy ? (
            <>
              <span>{tr("表示中のデータ:")}</span>
              <select
                className="select dyn-select"
                value={slugNotFound ? "" : previewIndex}
                onChange={(e) => {
                  setTypedSlugOf(null);
                  setPreviewIndex(+e.target.value);
                }}
              >
                {slugNotFound && <option value="">{tr("（該当なし）")}</option>}
                {primaryItems.map((item, i) => (
                  <option key={i} value={i}>
                    {String(keyOfItem(item, primaryFindBy) ?? tr("項目 {p1}", { p1: i + 1 })).slice(0, 40)}
                  </option>
                ))}
              </select>
              <span>slug:</span>
              <input
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
                  {tr("一致するデータがありません（公開サイトでは404）")}
                </span>
              )}
            </>
          ) : (
            <>
              <span>slug:</span>
              <input
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
                  {refreshing ? tr("読み込み中…") : tr("読み込み直す")}
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
          // フレームの外側（余白）をクリックしたら選択解除。
          // リサイズドラッグ直後の合成クリックでは解除しない
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
          <style>{`.cv-root [data-node="${elemDropTarget}"] { outline: 2px dashed var(--accent) !important; outline-offset: -2px; background-color: rgba(13, 153, 255, 0.06); }`}</style>
        )}
        {moveDrag && (
          <style>{`
            body { cursor: grabbing !important; }
            .cv-root { user-select: none; }
            ${moveDrag.dragIds.map((id) => `.cv-root [data-node="${id}"]`).join(", ")} { opacity: 0.35; }
            ${moveDrag.insideId ? `.cv-root [data-node="${moveDrag.insideId}"] { outline: 2px dashed var(--accent) !important; outline-offset: -2px; background-color: rgba(13, 153, 255, 0.06); }` : ""}
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
            // 公開サイトと同じ言語の字形（日本語・中国語の漢字など）で表示する
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
              // デザイン中はフォーム部品へのフォーカス等を抑止（テキスト編集中は除く）
              if (mode === "design" && !editingText) {
                e.preventDefault();
                // 既定動作を止めると選択が残るので、要素のコピーより優先されないよう外す
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
            {mode === "preview" && !editingComp && page?.pageScripts && (
              // 「このページ」のスクリプト（データの読み込み以外）を動かす目印
              <span
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
                  <NodeView key={id} id={id} isTop={!editingComp} />
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
                {tr("左の「追加」タブから要素を置いてください")}
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
                  aria-label={tr("親要素を選択")}
                  data-tip={tr("親要素を選択（⇧Enter）")}
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
