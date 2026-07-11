"use client";

/**
 * キャンバスのプレビューで使うデータ（取得したデータ・フォームの値・[slug] のページで表示する項目）と、ページ内の移動
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, type EditorMode } from "../../lib/store";
import {
  type ListOp,
  idVarNodesOf,
  nodeTextTemplate,
  pageDataSteps,
  pagePlan,
  previewDataVars,
  primaryDataStep,
  primaryCandidates,
  keyOfItem,
  sameKey,
  makeSample,
} from "../../lib/data";
import { hasVars, interpolate, interpolateUrl, isSlugPage, pageQueryVars } from "../../lib/vars";
import { fieldDefaults, fieldStateValues } from "../../lib/fields";
import { fetchRequestOf } from "../../lib/fetch-request";
import type { Page, SiteDoc } from "../../lib/types";

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
  /* ---- 変数（要素のデータ / フォーム値 / slug） ---- */
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  /** プレビューで、スクリプトが画面上で値を入れた変数（ストレージ・分解した配列など） */
  const [clientValues, setClientValues] = useState<Record<string, unknown>>({});
  /** 再取得したデータ（取得ブロックのID → JSON） */
  const [liveSamples, setLiveSamples] = useState<Record<string, unknown>>({});
  /** 再取得したデータで切り詰めた配列の元の件数（件数のブロックで使う） */
  const [liveTotals, setLiveTotals] = useState<Record<string, Record<string, number>>>({});
  /**
   * 取り直したデータの全件（切り詰めない）。プレビューのときだけ使い、
   * 表示件数「全て」のリストに全件を並べる（デザイン画面は重くならないよう見本を使う）
   */
  const [fullData, setFullData] = useState<Record<string, unknown>>({});
  const [previewSlug, setPreviewSlug] = useState("1");
  const [refreshing, setRefreshing] = useState(false);

  /** [slug]のプレビュー値・プレビューバーの基準になるデータ（スクリプトで取得するもの） */
  const primary = page ? primaryDataStep(doc, page.id) : null;
  const candidates = useMemo(
    () => (page ? primaryCandidates(doc, page.id, liveSamples) : null),
    [doc, page, liveSamples]
  );
  const primaryFindBy = candidates?.field || undefined;
  const primaryItems = candidates?.items ?? [];

  /** 「表示中のデータ」でslugを直接入力したときの値（null = 一覧から選んだ項目） */
  const [typedSlugOf, setTypedSlugOf] = useState<{ pageId: string; value: string } | null>(
    null
  );
  const typedSlug = typedSlugOf?.pageId === activePageId ? typedSlugOf.value : null;
  const typedIndex =
    primaryFindBy && typedSlug !== null
      ? primaryItems.findIndex((it) => sameKey(keyOfItem(it, primaryFindBy), typedSlug))
      : previewIndex;
  /** 入力したslugに一致するデータがない（公開サイトでは404） */
  const slugNotFound = typedIndex < 0;

  const slugVal = primaryFindBy
    ? (typedSlug ?? String((primaryItems[previewIndex] && keyOfItem(primaryItems[previewIndex], primaryFindBy)) ?? previewSlug))
    : previewSlug;

  /* スクリプト「ページを開いたとき」で取得するデータ → {変数} */
  const dataVars = useMemo(
    () =>
      page
        ? previewDataVars(doc, page.id, {
            index: slugNotFound ? -1 : previewIndex,
            slug: slugVal,
            live: mode === "preview" ? { ...liveSamples, ...fullData } : liveSamples,
            // 全件のデータには件数の補正が要らない
            liveTotals:
              mode === "preview"
                ? Object.fromEntries(
                    Object.entries(liveTotals).filter(([id]) => !(id in fullData))
                  )
                : liveTotals,
            vars: { ...pageQueryVars(page.query), ...fieldValues },
          })
        : {},
    [doc, page, previewIndex, slugNotFound, slugVal, liveSamples, liveTotals, fullData, mode, fieldValues]
  );

  /* ID付きテキスト要素の内容 → {ID} 変数（リスト内は項目ごとのため除外） */
  const textVarNodes = useMemo(
    () => (page ? idVarNodesOf(doc, page.id).filter((n) => n.type !== "field") : []),
    [doc, page]
  );

  const plan = useMemo(
    () =>
      page
        ? pagePlan(doc, page.id)
        : {
            steps: [],
            serverIds: new Set<string>(),
            clientVars: new Set<string>(),
            listOps: new Map<string, ListOp[]>(),
          },
    [doc, page]
  );

  /* ID付きの入力欄 → まだ入力していない欄の {ID} は最初の値（初期値・チェック） */
  const fieldVarNodes = useMemo(
    () => (page ? idVarNodesOf(doc, page.id).filter((n) => n.type === "field") : []),
    [doc, page]
  );

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
    // 入力欄の状態（{ID.checked} など。「.」を含む名前のまま入れると lookupVar がそのまま読む）
    Object.assign(base, fieldStateValues(fieldVarNodes, base, known));
    for (const n of textVarNodes) {
      const tpl = nodeTextTemplate(doc, n);
      base[n.attrId!] = hasVars(tpl) ? interpolate(tpl, base) : tpl;
    }
    return base;
  }, [fieldValues, clientValues, mode, slugVal, dataVars, page?.slug, page?.query, textVarNodes, fieldVarNodes, doc]);

  /** 送信ボタン / 再取得: ページのJSONを取り直す */
  const refreshData = useCallback(async () => {
    if (!page) return;
    setRefreshing(true);
    try {
      const vars = { ...pageVars, slug: slugVal };
      const results: Record<string, unknown> = {};
      const totals: Record<string, Record<string, number>> = {};
      const full: Record<string, unknown> = {};
      await Promise.all(
        pageDataSteps(doc, page.id).map(async (st) => {
          if (st.kind !== "fetch" || !st.url.trim()) return;
          try {
            const res = await fetch("/api/fetch-json", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: interpolateUrl(st.url, vars), ...fetchRequestOf(st, vars) }),
            });
            if (!res.ok) return;
            const data = await res.json();
            full[st.id] = data.json;
            const made = makeSample(data.json);
            results[st.id] = made.sample;
            if (made.totals) totals[st.id] = made.totals;
          } catch {
            // 失敗したデータは保存済みの見本を使い続ける
          }
        })
      );
      setLiveSamples((prev) => ({ ...prev, ...results }));
      setLiveTotals((prev) => ({ ...prev, ...totals }));
      setFullData((prev) => ({ ...prev, ...full }));
    } finally {
      setRefreshing(false);
    }
  }, [page, doc, slugVal, pageVars]);

  // プレビューを始めたら、ページのデータを全件で取り直す（見本は先頭だけのため）
  const refreshRef = useRef(refreshData);
  refreshRef.current = refreshData;
  useEffect(() => {
    if (mode === "preview" && page) void refreshRef.current();
  }, [mode, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setActivePage = useEditor((s) => s.setActivePage);

  /** プレビューのリンク移動: サイト内パスならページ切替へ解決する */
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
      // 通常ページ（URL完全一致）
      for (const pid of doc.pageOrder) {
        const slug = clean(doc.pages[pid].slug);
        if (!slug.includes("[slug]") && slug === path) {
          setActivePage(pid);
          return;
        }
      }
      // [slug]ページ: 値を取り出してプレビュー対象に反映する
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
        const val = decodeURIComponent(
          path.slice(pre.length, path.length - post.length)
        );
        if (!val || val.includes("/")) continue;
        setPreviewSlug(val);
        // setActivePage は previewIndex を0に戻すので、先にページを切り替える
        setActivePage(pid);
        // 移動先の中心のデータが「{slug} のものを探す」なら、一致する項目を選ぶ
        const main = primaryCandidates(doc, pid);
        if (main?.field) {
          const idx = main.items.findIndex((it) => sameKey(keyOfItem(it, main.field), val));
          if (idx >= 0) setPreviewIndex(idx);
          // 一致しない値は入力したslugとして残し、404の状態を確認できるようにする
          setTypedSlugOf(idx >= 0 ? null : { pageId: pid, value: val });
        }
        return;
      }
      // どのページにも一致しない: 404ページ（URLが「404」）があれば表示する
      const nf = doc.pageOrder.find((pid) => clean(doc.pages[pid].slug) === "404");
      if (nf) setActivePage(nf);
    },
    [doc, setActivePage, setPreviewIndex]
  );

  return { fieldValues, setFieldValues, setClientValues, setLiveSamples, setLiveTotals, setFullData, previewSlug, setPreviewSlug, refreshing, primary, primaryFindBy, primaryItems, setTypedSlugOf, slugNotFound, slugVal, plan, fieldVarNodes, pageVars, refreshData, setActivePage, navigateTo };
}
