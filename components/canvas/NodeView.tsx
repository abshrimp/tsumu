"use client";

import { safeNavigationUrl } from "../../lib/url-policy";
import { canvasHtml } from "../../lib/canvas-html";

/**
 * キャンバス上の1要素（選択・ドラッグ・文字の直接編集）と、ドラッグ中の影
 */

import { isEnterKey } from "../../lib/keys";
import { createElement, useContext, type ReactNode } from "react";
import { useEditor } from "../../lib/store";
import { mediaSrc } from "../../lib/assets";
import { applyList, listFromOf, toListItems } from "../../lib/data";
import { hasVars, interpolate, interpolateUrl, lookupVar } from "../../lib/vars";
import {
  editableText,
  insertEditable,
  normalizeEditable,
  startEditable,
  undoEditable,
} from "../../lib/editable";
import { resolveTag } from "../../lib/tags";
import { tr } from "../../lib/i18n";
import {
  InstanceChainCtx,
  VarsCtx,
  applyButton,
  applyScriptsAttr,
  holdEditing,
  recursiveInstance,
  renderLeafNode,
  renderTpl,
  resolvedListOps,
} from "./render";

/** インスタンス / リスト2件目以降の描画（選択不可・data-ghostでスタイルのみ適用） */
function GhostView({
  id,
  isTop,
  itemVars,
}: {
  id: string;
  isTop: boolean;
  itemVars?: Record<string, unknown>;
}): ReactNode {
  const doc = useEditor((s) => s.doc);
  const setActivePage = useEditor((s) => s.setActivePage);
  const ctx = useContext(VarsCtx);
  const chain = useContext(InstanceChainCtx);
  const node = doc.nodes[id];
  if (!node) return null;

  const scopedVars = itemVars;
  const vars = { ...ctx.pageVars, ...scopedVars };
  const common: Record<string, unknown> = { "data-ghost": id };
  if (node.attrId) common.id = node.attrId;
  if (ctx.preview) applyScriptsAttr(node, common, doc, vars, ctx.clientVars);

  if (node.type === "image" && node.image) {
    const raw = mediaSrc(doc, node.image);
    const src = hasVars(raw) ? interpolate(raw, vars) : raw;
    return createElement("img", {
      ...common,
      src: src || undefined,
      alt: node.image.alt,
      draggable: false,
    });
  }
  if (node.type === "divider") return createElement("hr", common);
  if (node.type === "code" && node.code) {
    return createElement("div", {
      ...common,
      dangerouslySetInnerHTML: { __html: canvasHtml(node.code.html) },
    });
  }
  const leaf = renderLeafNode(node, common, {
    doc,
    interactive: ctx.preview,
    vars: ctx.preview ? vars : undefined,
    fieldValues: ctx.fieldValues,
    onField: ctx.setFieldValue,
    onSubmit: ctx.refresh,
  });
  if (leaf) return leaf;
  if (node.type === "instance") {
    const comp = doc.components?.[node.componentId ?? ""];
    if (!comp) return null;
    if (chain.includes(comp.id)) return recursiveInstance(common);
    return (
      <InstanceChainCtx.Provider value={[...chain, comp.id]}>
        <GhostView key={id} id={comp.rootId} isTop={isTop} itemVars={scopedVars} />
      </InstanceChainCtx.Provider>
    );
  }

  if (node.type === "list") {
    // リストの中のリスト: 項目ごとに並べる（項目が無ければテンプレートだけ）
    const from = listFromOf(node) ?? "";
    const items = node.list
      ? applyList(
          toListItems(lookupVar(vars, from)),
          node.list,
          resolvedListOps(ctx.listOps, from, vars)
        )
      : [];
    return createElement(
      "div",
      common,
      items.length
        ? items.flatMap((item, i) =>
            node.children.map((cid) => (
              <GhostView
                key={`${i}-${cid}`}
                id={cid}
                isTop={false}
                itemVars={{ ...scopedVars, ...item }}
              />
            ))
          )
        : node.children.map((cid) => (
            <GhostView key={cid} id={cid} isTop={false} itemVars={scopedVars} />
          ))
    );
  }

  const tag = resolveTag(node, isTop);
  const children: ReactNode[] = [];
  if (node.text) {
    children.push(
      hasVars(node.text.content)
        ? renderTpl(node.text.content, vars, ctx.preview)
        : node.text.content
    );
  }
  for (const childId of node.children) {
    children.push(
      <GhostView
        key={childId}
        id={childId}
        isTop={false}
        itemVars={scopedVars}
      />
    );
  }
  if (node.link) {
    const rawUrl = node.link.kind === "url" ? (node.link.url || "#") : "#";
    const resolved = hasVars(rawUrl) ? interpolateUrl(rawUrl, vars) : rawUrl;
    const href = safeNavigationUrl(resolved);
    common.href = href;
    if (ctx.preview) {
      // 表示切替のonClickが付いていれば合成する
      const prevClick = common.onClick as
        | ((e: React.MouseEvent) => void)
        | undefined;
      if (node.link.kind === "page" && node.link.pageId) {
        const pageId = node.link.pageId;
        common.onClick = (e: React.MouseEvent) => {
          prevClick?.(e);
          e.preventDefault();
          setActivePage(pageId);
        };
      } else if (node.link.newTab) {
        common.target = "_blank";
        common.rel = "noopener noreferrer";
      } else if (!href.startsWith("#")) {
        common.onClick = (e: React.MouseEvent) => {
          prevClick?.(e);
          e.preventDefault();
          ctx.navigate(href);
        };
      }
    }
  }
  if (tag === "button") applyButton(node, common, ctx.preview, ctx.refresh);
  return createElement(
    node.link ? "a" : tag === "form" ? "div" : tag,
    common,
    children.length ? children : undefined
  );
}

export function NodeView({
  id,
  isTop,
  itemVars,
}: {
  id: string;
  isTop: boolean;
  /** リスト内テンプレートの場合、現在の項目 */
  itemVars?: Record<string, unknown>;
}): ReactNode {
  const doc = useEditor((s) => s.doc);
  const mode = useEditor((s) => s.mode);
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingText = useEditor((s) => s.editingText);
  const setEditingText = useEditor((s) => s.setEditingText);
  const updateDoc = useEditor((s) => s.updateDoc);
  const setActivePage = useEditor((s) => s.setActivePage);
  const ctx = useContext(VarsCtx);
  const chain = useContext(InstanceChainCtx);

  const node = doc.nodes[id];
  if (!node) return null;

  const scopedVars = itemVars;
  const vars = { ...ctx.pageVars, ...scopedVars };

  const common: Record<string, unknown> = {
    "data-node": id,
    key: id,
  };
  if (node.attrId) common.id = node.attrId;
  if (mode === "design" && selectedIds.includes(id)) {
    common["data-sel"] = "true";
    common["data-tutorial"] = "selected-node";
  }
  if (
    hasVars(node.text?.content) ||
    hasVars(node.image?.src) ||
    (node.link?.kind === "url" && hasVars(node.link.url))
  ) {
    common["data-bound"] = "true";
  }
  if (ctx.preview) applyScriptsAttr(node, common, doc, vars, ctx.clientVars);

  // リスト: 1件目は編集可能なテンプレート、2件目以降はゴースト表示
  if (node.type === "list") {
    const from = listFromOf(node);
    const items =
      from && node.list
        ? applyList(
            toListItems(lookupVar(vars, from)),
            node.list,
            resolvedListOps(ctx.listOps, from, vars)
          )
        : [];
    const kids: ReactNode[] = [];
    // 画面上で値が決まる配列（ストレージから読み込んだものなど）
    const live = !!from && ctx.clientVars.has(from.split(".")[0]);
    if (ctx.preview && from) common["data-array"] = from;
    if (!from) {
      kids.push(
        createElement(
          "div",
          { key: "ph", className: "cv-placeholder" },
          tr("リストの設定で、並べる配列を選んでください")
        )
      );
    } else if (!items.length && live) {
      // 編集中はお手本を1件分表示する（プレビューでは値が入るまで何も並べない）
      if (!ctx.preview) {
        kids.push(
          ...node.children.map((cid) => (
            <NodeView key={`t-${cid}`} id={cid} isTop={false} itemVars={scopedVars} />
          ))
        );
      }
    } else if (!items.length) {
      kids.push(
        createElement(
          "div",
          { key: "ph", className: "cv-placeholder" },
          tr("表示できる項目がありません（データの読み込み・絞り込み条件を確認してください）")
        )
      );
    } else {
      const first = node.children.map((cid) => (
        <NodeView
          key={`t-${cid}`}
          id={cid}
          isTop={false}
          itemVars={{ ...scopedVars, ...items[0] }}
        />
      ));
      const rest = items.slice(1).map((item, i) =>
        node.children.map((cid) => (
          <GhostView
            key={`g${i}-${cid}`}
            id={cid}
            isTop={false}
            itemVars={{ ...scopedVars, ...item }}
          />
        ))
      );
      if (ctx.preview) {
        // プレビュー: スクリプトの絞り込み用に、項目ごとに値を持たせて包む
        [first, ...rest].forEach((els, i) =>
          kids.push(
            createElement(
              "div",
              {
                key: `item-${i}`,
                style: { display: "contents" },
                "data-item": JSON.stringify(items[i]),
              },
              els
            )
          )
        );
      } else {
        kids.push(...first, ...rest.flat());
      }
    }
    return createElement("div", common, kids);
  }

  // インスタンス: マスターのルート要素として描画し、中身はゴースト表示
  if (node.type === "instance") {
    const comp = doc.components?.[node.componentId ?? ""];
    const root = comp ? doc.nodes[comp.rootId] : null;
    if (!comp || !root) {
      return createElement("div", {
        ...common,
        style: { padding: 12, color: "#a1a1aa", fontSize: 13 },
        children: tr("（コンポーネントが見つかりません）"),
      });
    }
    if (chain.includes(comp.id)) return recursiveInstance(common);
    const tag = resolveTag(root, isTop);
    const children: ReactNode[] = [];
    if (root.text) {
      children.push(
        hasVars(root.text.content)
          ? renderTpl(root.text.content, vars, ctx.preview)
          : root.text.content
      );
    }
    for (const childId of root.children) {
      children.push(<GhostView key={childId} id={childId} isTop={false} itemVars={scopedVars} />);
    }
    return (
      <InstanceChainCtx.Provider key={id} value={[...chain, comp.id]}>
        {createElement(
          tag === "a" ? "div" : tag,
          { ...common, "data-instance": comp.id, "data-ghost": root.id },
          children.length ? children : undefined
        )}
      </InstanceChainCtx.Provider>
    );
  }

  if (node.type === "image" && node.image) {
    const rawSrc = mediaSrc(doc, node.image);
    const src = hasVars(rawSrc) ? interpolate(rawSrc, vars) : rawSrc;
    return createElement("img", {
      ...common,
      src: src || undefined,
      alt: node.image.alt,
      draggable: false,
      onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => {
        const el = e.currentTarget;
        if (
          el.naturalWidth &&
          (el.naturalWidth !== node.image!.width ||
            el.naturalHeight !== node.image!.height)
        ) {
          updateDoc(
            (d) => {
              const n = d.nodes[id];
              if (n?.image) {
                n.image.width = el.naturalWidth;
                n.image.height = el.naturalHeight;
              }
            },
            { history: false }
          );
        }
      },
    });
  }

  if (node.type === "divider") {
    return createElement("hr", common);
  }

  if (node.type === "code" && node.code) {
    return createElement("div", {
      ...common,
      dangerouslySetInnerHTML: { __html: canvasHtml(node.code.html) },
    });
  }

  const leafView = renderLeafNode(node, common, {
    doc,
    interactive: ctx.preview,
    vars: ctx.preview ? vars : undefined,
    fieldValues: ctx.fieldValues,
    onField: ctx.setFieldValue,
    onSubmit: ctx.refresh,
  });
  if (leafView) return leafView;

  const editing = editingText === id;
  const tag = resolveTag(node, isTop);
  const children: ReactNode[] = [];
  // 子要素の無いテキストは、編集中の中身を lib/editable が直接描く（変数をチップ表示）
  const richEdit = editing && !node.children.length;
  if (node.text && !richEdit) {
    // 編集中は生テンプレート、それ以外は変数を差し込んで表示
    children.push(
      !editing && hasVars(node.text.content)
        ? renderTpl(node.text.content, vars, ctx.preview)
        : node.text.content
    );
  }
  for (const childId of node.children) {
    children.push(
      <NodeView
        key={childId}
        id={childId}
        isTop={false}
        itemVars={scopedVars}
      />
    );
  }

  if (node.link) {
    const rawUrl = node.link.kind === "page" ? "#" : node.link.url || "#";
    const resolved = hasVars(rawUrl) ? interpolateUrl(rawUrl, vars) : rawUrl;
    const href = safeNavigationUrl(resolved);
    common.href = href;
    if (mode === "preview") {
      // 表示切替のonClickが付いていれば合成する
      const prevClick = common.onClick as
        | ((e: React.MouseEvent) => void)
        | undefined;
      if (node.link.kind === "page" && node.link.pageId) {
        const pageId = node.link.pageId;
        common.onClick = (e: React.MouseEvent) => {
          prevClick?.(e);
          e.preventDefault();
          setActivePage(pageId);
        };
      } else if (node.link.newTab) {
        common.target = "_blank";
        common.rel = "noopener noreferrer";
      } else if (!href.startsWith("#")) {
        common.onClick = (e: React.MouseEvent) => {
          prevClick?.(e);
          e.preventDefault();
          ctx.navigate(href);
        };
      }
    }
  }

  if (editing) {
    common.contentEditable = true;
    common.suppressContentEditableWarning = true;
    common["data-editing"] = "true";
    common.ref = (el: HTMLElement | null) => {
      if (el && document.activeElement !== el) {
        el.focus();
        if (richEdit) {
          startEditable(el, node.text?.content ?? "");
        } else {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    };
    if (richEdit) {
      common["data-rich-edit"] = "true";
      common.onInput = (e: React.FormEvent<HTMLElement>) => {
        // 変換中に DOM を書き換えると IME が壊れるため、確定後に付け直す
        if ((e.nativeEvent as InputEvent).isComposing) return;
        normalizeEditable(e.currentTarget);
      };
      common.onCompositionEnd = (e: React.CompositionEvent<HTMLElement>) => {
        normalizeEditable(e.currentTarget);
      };
      common.onPaste = (e: React.ClipboardEvent<HTMLElement>) => {
        e.preventDefault();
        insertEditable(e.currentTarget, e.clipboardData.getData("text/plain"));
      };
    }
    common.onBlur = (e: React.FocusEvent<HTMLElement>) => {
      // 「変数を探す」を開いている間は編集を続ける（選んだ変数をカーソル位置に入れる）
      if (holdEditing.current) return;
      const content = richEdit
        ? editableText(e.currentTarget).replace(/\n$/, "")
        : e.currentTarget.innerText.replace(/\n$/, "");
      updateDoc((d) => {
        const n = d.nodes[id];
        if (!n) return;
        // 空のボックスを編集しただけなら text を作らず、コンテナのまま保つ。
        n.text = content || n.text
          ? { content, heading: n.text?.heading ?? 0 }
          : null;
      });
      setEditingText(null);
    };
    common.onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
      e.stopPropagation();
      if (e.key === "Escape" || (isEnterKey(e) && e.metaKey)) {
        (e.currentTarget as HTMLElement).blur();
        return;
      }
      if (!richEdit || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
      const mod = e.metaKey || e.ctrlKey;
      if (isEnterKey(e) && !mod) {
        // ブラウザ任せだと div/br が入るため、改行文字として入れる
        e.preventDefault();
        insertEditable(e.currentTarget, "\n");
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoEditable(e.currentTarget, e.shiftKey ? 1 : -1);
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        undoEditable(e.currentTarget, 1);
      }
    };
  }

  if (tag === "button") applyButton(node, common, ctx.preview, ctx.refresh);
  // 編集中の中身は lib/editable が DOM に直接描くため、React の管理外のノードが残る。
  // 編集の開始・終了で要素ごと作り直し、終了後に文字が二重に描かれないようにする
  common.key = richEdit ? "rich-edit" : "view";
  // ボタンの文字を書き換えている間は span にする（button の中ではスペースキーなどが押す操作になる）
  return createElement(tag === "button" && editing ? "span" : tag, common, children.length ? children : undefined);
}
