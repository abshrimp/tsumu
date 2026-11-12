"use client";

/**
 * キャンバスのプレビューで使うデータ（取得したデータ・フォームの値・[slug] のページで表示する項目）と、ページ内の移動
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useEditor, type EditorMode } from "../../lib/store";
import {
  idVarNodesOf,
  nodeTextTemplate,
  preparePreviewData,
  pagePlan,
  previewDataVars,
  primaryDataStep,
  primaryCandidates,
  keyOfItem,
  sameKey,
  makeSample,
} from "../../lib/data";
import { hasVars, interpolate, interpolateUrl, isSlugPage, pageQueryVars } from "../../lib/vars";
import { pageQueryConditions } from "../../lib/page-query";
import { fieldDefaults, fieldStateValues, type FieldValues } from "../../lib/fields";
import { fetchRequestOf } from "../../lib/fetch-request";
import type { Page, SiteDoc } from "../../lib/types";

/** 公開サイトと同じく、クエリの条件が最も多く一致するページを選ぶ。 */
function queryPage(pages: Page[], query: URLSearchParams): Page | undefined {
  let best = pages[0];
  let score = -1;
  for (const page of pages) {
    const conditions = pageQueryConditions(page.query);
    if (conditions.length > score && conditions.every(([key, value]) => query.get(key) === value)) {
      best = page;
      score = conditions.length;
    }
  }
  return best;
}

/** ページを切り替えた最初の描画から、前のページのフォームの値や取得結果を使わない。 */
function usePageValues<T extends object>(pageId: string): [T, Dispatch<SetStateAction<T>>] {
  const empty = useMemo(() => ({} as T), [pageId]);
  const [state, setState] = useState(() => ({ pageId, value: empty }));
  const currentPage = useRef(pageId);
  currentPage.current = pageId;
  useEffect(() => {
    setState((previous) => previous.pageId === pageId ? previous : { pageId, value: empty });
  }, [pageId, empty]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setState((previous) => {
      // 古いページの非同期処理が、移動先の値を消さないようにする。
      if (currentPage.current !== pageId) return previous;
      const value = previous.pageId === pageId ? previous.value : empty;
      const result = typeof next === "function" ? next(value) : next;
      return previous.pageId === pageId && result === value ? previous : { pageId, value: result };
    });
  }, [pageId, empty]);
  return [state.pageId === pageId ? state.value : empty, setValue];
}

/** Canvas から受け取る値 */
export interface UseCanvasDataDeps {
  page: Page;
  doc: SiteDoc;
  activePageId: string;
  previewIndex: number;
  mode: EditorMode;
  setPreviewIndex: (i: number) => void;
}

export function useCanvasData({
  page,
  doc,
  activePageId,
  previewIndex,
  mode,
  setPreviewIndex,
}: UseCanvasDataDeps) {
  /* ---- 変数（要素のデータ・フォームの値・slug） ---- */
  const [fieldValues, setFieldValues] = usePageValues<FieldValues>(activePageId);
  /** プレビューで、スクリプトが画面上で値を入れた変数（ストレージ・分解した配列など） */
  const [clientValues, setClientValues] = usePageValues<Record<string, unknown>>(activePageId);
  /** 取得し直したデータ（取得ブロックの ID → JSON） */
  const [liveSamples, setLiveSamples] = usePageValues<Record<string, unknown>>(activePageId);
  /** 取得し直したデータで、切り詰めた配列の元の件数（件数のブロックで使う） */
  const [liveTotals, setLiveTotals] = usePageValues<Record<string, Record<string, number>>>(activePageId);
  /**
   * 取得し直したデータの全件（切り詰めない）。プレビューのときだけ使い、
   * 表示件数が「すべて」のリストに全件を並べる（デザイン画面では、重くならないよう見本を使う）
   */
  const [fullData, setFullData] = usePageValues<Record<string, unknown>>(activePageId);
  const [previewSlug, setPreviewSlug] = useState("1");
  const [refreshing, setRefreshing] = useState(false);
  /** 取得し直し・ページの切り替え・プレビューの開始と終了で、以前の応答を無効にする。 */
  const refreshRequest = useRef(0);
  const refreshController = useRef<AbortController | null>(null);

  const { plan, previewPlan, fieldVarNodes, textVarNodes } = useMemo(() => {
    const nodes = idVarNodesOf(doc, activePageId);
    const plan = pagePlan(doc, activePageId, nodes);
    return {
      plan,
      previewPlan: preparePreviewData(doc, activePageId, plan.steps),
      fieldVarNodes: nodes.filter((n) => n.type === "field"),
      textVarNodes: nodes.filter((n) => n.type !== "field"),
    };
  }, [doc, activePageId]);
  /** [slug]のプレビュー値・プレビューバーの基準になるデータ（スクリプトで取得するもの） */
  const primary = useMemo(
    () => primaryDataStep(doc, activePageId, plan.steps),
    [doc, activePageId, plan],
  );
  const candidates = useMemo(
    () => (page ? primaryCandidates(doc, page.id, liveSamples, previewPlan) : null),
    [doc, page, liveSamples, previewPlan]
  );
  const primaryFindBy = candidates?.field || undefined;
  const primaryItems = candidates?.items ?? [];

  /** 「表示中のデータ」で slug を直接入力したときの値（null = 一覧から選んだ項目） */
  const [typedSlugOf, setTypedSlugOf] = useState<{ pageId: string; value: string } | null>(
    null
  );
  const typedSlug = typedSlugOf?.pageId === activePageId ? typedSlugOf.value : null;
  const typedIndex =
    primaryFindBy && typedSlug !== null
      ? primaryItems.findIndex((it) => sameKey(keyOfItem(it, primaryFindBy), typedSlug))
      : previewIndex;
  /** 入力した slug に一致するデータが無い（公開サイトでは 404 になる） */
  const slugNotFound = typedIndex < 0;

  const slugVal = primaryFindBy
    ? (typedSlug ?? String((primaryItems[previewIndex] && keyOfItem(primaryItems[previewIndex], primaryFindBy)) ?? previewSlug))
    : previewSlug;

  /* スクリプトの「ページを開いたとき」で取得するデータ → {変数} */
  const dataVars = useMemo(
    () =>
      page
        ? previewDataVars(doc, page.id, {
            index: slugNotFound ? -1 : previewIndex,
            slug: slugVal,
            live: mode === "preview" ? { ...liveSamples, ...fullData } : liveSamples,
            // 全件のデータでは、件数を補正する必要がない
            liveTotals:
              mode === "preview"
                ? Object.fromEntries(
                    Object.entries(liveTotals).filter(([id]) => !(id in fullData))
                  )
                : liveTotals,
            vars: { ...pageQueryVars(page.query), ...fieldValues },
          }, previewPlan)
        : {},
    [doc, page, previewPlan, previewIndex, slugNotFound, slugVal, liveSamples, liveTotals, fullData, mode, fieldValues]
  );

  const fetchedVars = useMemo(() => Object.fromEntries(plan.steps.flatMap(step =>
    step.kind === "fetch" && step.as && Object.hasOwn(dataVars, step.as)
      ? [[step.as, dataVars[step.as]]] : []
  )), [plan, dataVars]);

  const pageVars = useMemo(() => {
    const known = {
      ...pageQueryVars(page?.query),
      ...(isSlugPage(page?.slug ?? "") ? { slug: slugVal } : {}),
      ...dataVars,
    } as Record<string, unknown>;
    const base = {
      ...known,
      ...fieldDefaults(fieldVarNodes, known),
      ...fieldValues,
      ...(mode === "preview" ? clientValues : {}),
    } as Record<string, unknown>;
    // 入力欄の状態（{ID.checked} など）。「.」を含む名前のまま入れれば、lookupVar がそのまま読む
    Object.assign(base, fieldStateValues(fieldVarNodes, base, known));
    for (const n of textVarNodes) {
      const tpl = nodeTextTemplate(doc, n);
      base[n.attrId!] = hasVars(tpl) ? interpolate(tpl, base) : tpl;
    }
    return base;
  }, [fieldValues, clientValues, mode, slugVal, dataVars, page?.slug, page?.query, textVarNodes, fieldVarNodes, doc]);

  /** 送信ボタン / 取得し直し: ページの JSON を取得し直す */
  const refreshData = useCallback(async () => {
    if (!page) return;
    const request = ++refreshRequest.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshing(true);
    try {
      const vars = { ...pageVars, slug: slugVal };
      const results: Record<string, unknown> = {};
      const totals: Record<string, Record<string, number>> = {};
      const full: Record<string, unknown> = {};
      await Promise.all(
        plan.steps.map(async (st) => {
          if (st.kind !== "fetch" || !st.url.trim()) return;
          try {
            const res = await fetch("/api/fetch-json", {
              method: "POST",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: interpolateUrl(st.url, vars), ...fetchRequestOf(st, vars) }),
            });
            if (!res.ok || controller.signal.aborted) return;
            const data = await res.json();
            if (controller.signal.aborted) return;
            full[st.id] = data.json;
            const made = makeSample(data.json);
            results[st.id] = made.sample;
            // 切り詰める必要がなくなった応答でも、以前の件数を残さない。
            totals[st.id] = made.totals ?? {};
          } catch {
            // 取得に失敗したデータは、保存済みの見本を使い続ける
          }
        })
      );
      if (request !== refreshRequest.current) return;
      setLiveSamples((prev) => ({ ...prev, ...results }));
      setLiveTotals((prev) => ({ ...prev, ...totals }));
      setFullData((prev) => ({ ...prev, ...full }));
    } finally {
      if (request === refreshRequest.current) {
        refreshController.current = null;
        setRefreshing(false);
      }
    }
  }, [page, plan, slugVal, pageVars]);

  // プレビューを始めたら、ページのデータを全件で取得し直す（見本は先頭の数件だけのため）
  const refreshRef = useRef(refreshData);
  refreshRef.current = refreshData;
  useEffect(() => {
    setRefreshing(false);
    if (mode === "preview" && page) void refreshRef.current();
    return () => {
      refreshRequest.current++;
      refreshController.current?.abort();
      refreshController.current = null;
    };
  }, [mode, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setActivePage = useEditor((s) => s.setActivePage);

  /** プレビューでのリンクの移動: サイト内のパスなら、ページの切り替えとして扱う */
  const navigateTo = useCallback(
    (url: string) => {
      const raw = url.trim();
      if (!raw || raw.startsWith("#")) return;
      if (/^(https?:)?\/\//i.test(raw) || /^(mailto|tel):/i.test(raw)) {
        window.open(raw, "_blank", "noopener");
        return;
      }
      const clean = (s: string) => s.replace(/^\/+|\/+$/g, "");
      const path = clean(raw.split(/[?#]/)[0]);
      const query = new URLSearchParams(raw.split("#")[0].split("?").slice(1).join("?"));
      const pages = doc.pageOrder.map((pid) => doc.pages[pid]);
      // 通常のページ（URL が完全に一致するもの）。同じパスのページは、クエリで振り分ける。
      const normal = queryPage(pages.filter((p) => !p.slug.includes("[slug]") && clean(p.slug) === path), query);
      if (normal) {
        setActivePage(normal.id);
        return;
      }
      // [slug] のページ: 値を取り出して、プレビューの対象に反映する
      for (const pid of doc.pageOrder) {
        const slug = clean(doc.pages[pid].slug);
        const at = slug.indexOf("[slug]");
        if (at < 0) continue;
        const pre = slug.slice(0, at);
        const post = slug.slice(at + "[slug]".length);
        if (
          path.length < pre.length + post.length + 1 ||
          !path.startsWith(pre) ||
          !path.endsWith(post)
        ) {
          continue;
        }
        let val: string;
        try {
          val = decodeURIComponent(path.slice(pre.length, path.length - post.length));
        } catch {
          // 壊れたエスケープを含むリンクも、他の一致しない URL と同じく 404 へ進める。
          continue;
        }
        if (!val || val.includes("/")) continue;
        const target = queryPage(pages.filter((p) => clean(p.slug) === slug), query)!;
        setPreviewSlug(val);
        // setActivePage は previewIndex を 0 に戻すため、先にページを切り替える
        setActivePage(target.id);
        // 移動先の中心となるデータが「{slug} のものを探す」なら、一致する項目を選ぶ
        const main = primaryCandidates(doc, target.id);
        if (main?.field) {
          const idx = main.items.findIndex((it) => sameKey(keyOfItem(it, main.field), val));
          if (idx >= 0) setPreviewIndex(idx);
          // 一致しない値は入力した slug として残し、404 の状態を確認できるようにする
          setTypedSlugOf(idx >= 0 ? null : { pageId: target.id, value: val });
        }
        return;
      }
      // どのページにも一致しない: 404 のページ（URL が「404」）があれば表示する
      const nf = doc.pageOrder.find((pid) => clean(doc.pages[pid].slug) === "404");
      if (nf) setActivePage(nf);
    },
    [doc, setActivePage, setPreviewIndex]
  );

  return { fetchedVars, fieldValues, setFieldValues, setClientValues, setLiveSamples, setLiveTotals, setFullData, previewSlug, setPreviewSlug, refreshing, primary, primaryFindBy, primaryItems, setTypedSlugOf, slugNotFound, slugVal, plan, fieldVarNodes, pageVars, refreshData, setActivePage, navigateTo };
}
