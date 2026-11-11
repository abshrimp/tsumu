"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { nodeAssetSrc, uploadAsset } from "./assets";
import { showAlert } from "./dialog";
import { userMessage } from "./errors";
import { tr } from "./i18n";
import { makeImage } from "./presets";
import { ancestorsOf, collectDescendants, useEditor, type ParentRef } from "./store";
import { canContainElements } from "./tags";
import { MAX_NODE_DEPTH } from "./doc-tree";
import type { Asset, SiteDoc, DocNode } from "./types";

export interface ImageDropPoint { parent: ParentRef; index?: number }
let latestDrop = 0;

/** 落とした位置を保ったまま読み込み、画像とアセットを1回の操作として追加する。 */
export function startImageDrop(files: Iterable<File>, point: ImageDropPoint) {
  const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
  if (!images.length) return { done: Promise.resolve(), cancel: () => {} };
  return startImageInsertion(() => images, point);
}

/** クリップボードのデコードや画像アップロードの前に、配置先と履歴を確定する。 */
export function startImageInsertion(
  loadFiles: () => Iterable<File> | Promise<Iterable<File>>,
  point: ImageDropPoint,
  options: { prepareNode?: (node: DocNode, asset: Asset, file: File) => void; quiet?: boolean } = {},
) {
  const { doc: initialDoc, activePageId, editingComponentId: componentId, historyRevision } = useEditor.getState();
  const rootId = componentId ? initialDoc.components?.[componentId]?.rootId : undefined;
  const children = (doc: SiteDoc) => point.parent.kind === "page"
    ? doc.pages[point.parent.id]?.children : doc.nodes[point.parent.id]?.children;
  const validTarget = (doc: SiteDoc) => {
    if (point.parent.kind === "page") return !componentId && !!doc.pages[point.parent.id];
    const parent = doc.nodes[point.parent.id];
    if (!parent || !canContainElements(parent)) return false;
    // Uploads may complete after the target is moved deeper. Keep the uploaded
    // asset, but never insert a leaf beyond the persisted document depth limit.
    if (ancestorsOf(doc, parent.id).length + 2 > MAX_NODE_DEPTH) return false;
    const roots = componentId
      ? (doc.components?.[componentId]?.rootId === rootId && rootId ? [rootId] : [])
      : doc.pages[activePageId]?.children ?? [];
    return roots.some((id) => collectDescendants(doc, id).includes(point.parent.id));
  };
  const original = children(initialDoc) ?? [];
  const beforeId = point.index === undefined ? undefined : original[point.index];
  const afterId = point.index === undefined ? undefined : original[point.index - 1];
  let place = validTarget(initialDoc);
  if (!place) return { done: Promise.resolve({ inserted: false, files: [] as File[], error: undefined as unknown }), cancel: () => {} };
  const own = ++latestDrop;
  let select = true;
  let cancelled = false;
  let mounted = true;
  let wakePlacement: (() => void) | undefined;
  const unsubscribe = useEditor.subscribe((next, previous) => {
    // 再描画を待たずに記録する。別の場所を選んで戻っても、古い完了で選択を奪わない。
    if (next.activePageId !== previous.activePageId || next.editingComponentId !== previous.editingComponentId ||
        next.selection !== previous.selection || next.selectedIds !== previous.selectedIds ||
        next.mode !== previous.mode || next.editingText !== previous.editingText) select = false;
    // 通常の編集は続けられる。履歴を戻した場合だけ、まだ完了していない配置を取り消す。
    if (next.historyRevision !== historyRevision) {
      cancelled = true;
      unsubscribe();
      wakePlacement?.();
      return;
    }
    if (!validTarget(next.doc)) { place = false; unsubscribe(); }
    if (!place || !next.gestureActive) wakePlacement?.();
  });
  const cancel = () => { cancelled = true; mounted = false; select = false; unsubscribe(); wakePlacement?.(); };
  const done = (async () => {
    const assets: Asset[] = [];
    let failure: unknown;
    let images: File[] = [];
    let inserted = false;
    try {
      images = Array.from(await loadFiles());
      for (const file of images) {
        if (cancelled || !place) break;
        assets.push(await uploadAsset(file));
        if (cancelled || !place) break;
      }
      // ドラッグ編集中の履歴へ混ぜない。終了通知の後のmicrotaskで、現在の文書へ配置する。
      while (!cancelled && place && useEditor.getState().gestureActive) {
        await new Promise<void>((resolve) => { wakePlacement = resolve; });
        wakePlacement = undefined;
      }
    } catch (error) {
      failure = error;
    } finally {
      unsubscribe();
      const state = useEditor.getState();
      if (assets.length) {
        const nodes = !failure && !cancelled && place && validTarget(state.doc) ? assets.map((asset, index) => {
          const node = makeImage();
          node.name = asset.name;
          node.image = { src: nodeAssetSrc(asset), alt: "", width: asset.width, height: asset.height, assetId: asset.id };
          options.prepareNode?.(node, asset, images[index]);
          return node;
        }) : [];
        if (!nodes.length) state.retainUploadedAssets(assets);
        else state.updateDoc((doc) => {
          for (const asset of assets) doc.assets[asset.id] = asset;
          for (const node of nodes) doc.nodes[node.id] = node;
          const list = children(doc)!;
          // 待っている間の追加・並べ替えで数値位置がずれても、元の隣接要素に寄せる。
          const before = beforeId ? list.indexOf(beforeId) : -1;
          const after = afterId ? list.indexOf(afterId) : -1;
          const index = point.index === undefined ? list.length : before >= 0 ? before : after >= 0 ? after + 1 : Math.min(point.index, list.length);
          list.splice(index, 0, ...nodes.map((node) => node.id));
        });
        inserted = nodes.length > 0;
        if (nodes.length && select && own === latestDrop) state.select(nodes[nodes.length - 1].id);
      }
      if (failure && mounted && !options.quiet) {
        void showAlert(userMessage(failure, tr("Couldn't upload")), { title: tr("Couldn't upload") });
      }
    }
    return { inserted, files: images, error: !cancelled && place ? failure : undefined };
  })();
  return { done, cancel };
}

/** 複数のdropが重なっても、先に終わった処理で読み込み表示を消さない。 */
export function useImageDrop() {
  const pending = useRef(new Set<ReturnType<typeof startImageDrop>>());
  const mounted = useRef(true);
  const [uploading, setUploading] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const task of pending.current) task.cancel();
    };
  }, []);
  const dropFiles = (files: Iterable<File>, point: ImageDropPoint) => {
    const task = startImageDrop(files, point);
    pending.current.add(task);
    setUploading(true);
    void task.done.finally(() => {
      pending.current.delete(task);
      if (mounted.current) setUploading(pending.current.size > 0);
    });
    return task.done;
  };
  return { uploading, dropFiles };
}
