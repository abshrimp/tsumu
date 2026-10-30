"use client";

/**
 * キャンバスでの要素の描画（変数・リスト・コンポーネントの展開と、中身を持つ要素の描画）
 */

import { createContext, createElement, type ReactNode } from "react";
import { type ListOp } from "../../lib/data";
import {
  hasVars,
  interpolate,
  interpolateUrl,
  KEEP_ESCAPES,
  lookupVar,
  pageHrefOf,
} from "../../lib/vars";
import { embedSrc, YOUTUBE_ALLOW } from "../../lib/embed";
import {
  fieldInitialValue,
  fieldVarName,
  truthy,
  RANGED_INPUTS,
  TEXT_INPUTS,
} from "../../lib/fields";
import { compileScripts, keepTokens } from "../../lib/script";
import type { DocNode, SiteDoc } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { storageKey } from "../../lib/storage-keys";
import { canvasHtml } from "../../lib/canvas-html";
import { mediaSrc } from "../../lib/assets";

/* ---------- 変数コンテキスト ---------- */

export interface CanvasVars {
  /** ページ変数（slug / フォーム値） */
  pageVars: Record<string, unknown>;
  fieldValues: Record<string, string>;
  setFieldValue: (name: string, v: string) => void;
  /** 送信ボタン: ページのJSONを取り直す */
  refresh: () => void;
  preview: boolean;
  /** プレビュー時のリンク移動（サイト内パスならページ切替に解決する） */
  navigate: (url: string) => void;
  /** 画面上（ブラウザ）で値が決まる変数・配列の名前 */
  clientVars: Set<string>;
  /** 配列の名前 → ページを開いたときのスクリプトで決まる絞り込み・並べ替え */
  listOps: Map<string, ListOp[]>;
}

/** リストに適用する絞り込み・並べ替え（値の {変数} をページの変数で解決する） */
export function resolvedListOps(
  listOps: Map<string, ListOp[]>,
  from: string,
  vars: Record<string, unknown>
): ListOp[] {
  return (listOps.get(from) ?? []).map((o) =>
    o.kind === "filter"
      ? {
          ...o,
          conds: o.conds.map((c) =>
            hasVars(c.value) ? { ...c, value: interpolate(c.value, vars) } : c
          ),
        }
      : o
  );
}

export const VarsCtx = createContext<CanvasVars>({
  pageVars: {},
  fieldValues: {},
  setFieldValue: () => {},
  refresh: () => {},
  preview: false,
  navigate: () => {},
  clientVars: new Set(),
  listOps: new Map(),
});

/**
 * 描画中のインスタンスがたどってきたコンポーネント（外側から順）。
 * コンポーネントが自分自身を含んでいると無限に描画し続けて画面が固まるため、2度目は描かない
 */
export const InstanceChainCtx = createContext<string[]>([]);

/** 自分自身を含むコンポーネントの代わりに出す表示 */
export function recursiveInstance(common: Record<string, unknown>): ReactNode {
  return createElement("div", {
    ...common,
    style: { padding: 12, color: "#a1a1aa", fontSize: 13 },
    children: tr("（コンポーネントが自分自身を含んでいるため表示できません）"),
  });
}

/** テンプレートを表示用に解決する（プレビューだけ値を差し込む） */
export function renderTpl(
  tpl: string,
  vars: Record<string, unknown>,
  preview: boolean
): ReactNode {
  if (preview) return interpolate(tpl, vars);
  // デザイン画面では {名前} を普通の文字と同じに見せ（リストでもそのまま複製する）、値はプレビューで出す
  return tpl;
}

/** ページごとのキャンバスのスクロール位置（ページID → [上, 左]） */
export const SCROLL_KEY = storageKey("scroll-v1");

/** 「変数を探す」を開いている間、テキスト編集の blur で確定・終了しない */
export const holdEditing = { current: false };

/* ---------- スクリプト（プレビュー） ---------- */

/** プレビュー時: 実行用に変換したスクリプトを data-scripts として props に載せる */
export function applyScriptsAttr(
  node: Pick<DocNode, "scripts">,
  common: Record<string, unknown>,
  doc: SiteDoc,
  vars: Record<string, unknown>,
  clientVars: Set<string>,
  skip?: Set<string>
) {
  if (!node.scripts?.length) return;
  const compiled = compileScripts(
    node,
    (pageId) => {
      const p = doc.pages[pageId];
      return p ? pageHrefOf(p) : "/";
    },
    (str, kind) => {
      if (!hasVars(str)) return str;
      // 画面上の変数は {名前} のまま、文字としての「{」は「\{」のまま渡し、ランタイムが置き換える
      const v = { ...vars, ...keepTokens(str, clientVars), [KEEP_ESCAPES]: true };
      return kind === "url" ? interpolateUrl(str, v) : interpolate(str, v);
    },
    true,
    skip,
    (name) => (clientVars.has(name.split(".")[0]) ? undefined : (lookupVar(vars, name) ?? null))
  );
  if (compiled.length) common["data-scripts"] = JSON.stringify(compiled);
}

/* ---------- ノード描画 ---------- */

/**
 * <button> の要素。フォームの中で押すと送信する（プレビューではページのデータを取り直す）。
 * 「クリックしたとき」のスクリプトがあるボタンは送信しない（書き出しと同じ）
 */
export function applyButton(
  node: Pick<DocNode, "scripts">,
  common: Record<string, unknown>,
  preview: boolean,
  refresh: () => void
) {
  common.type = "button";
  if (!preview || node.scripts?.some((s) => s.trigger === "click")) return;
  const prev = common.onClick as ((e: React.MouseEvent) => void) | undefined;
  common.onClick = (e: React.MouseEvent) => {
    prev?.(e);
    if ((e.currentTarget as HTMLElement).closest("form")) refresh();
  };
}

interface LeafOpts {
  /** 動画・音声のアセットを引く編集データ */
  doc?: SiteDoc;
  /** プレビュー時: フォーム部品を操作可能にする */
  interactive?: boolean;
  /** プレビュー時: 案内文・初期値などの {変数} を置き換える値 */
  vars?: Record<string, unknown>;
  fieldValues?: Record<string, string>;
  onField?: (name: string, v: string) => void;
  onSubmit?: () => void;
}

/** icon / field / media / embed の実DOM描画（NodeView / GhostView 共用） */
export function renderLeafNode(
  node: DocNode,
  common: Record<string, unknown>,
  opts: LeafOpts = {}
): ReactNode | null {
  if (node.type === "icon" && node.icon) {
    return createElement("span", {
      ...common,
      dangerouslySetInnerHTML: { __html: canvasHtml(node.icon.svg) },
    });
  }

  if (node.type === "field" && node.field) {
    const f = node.field;
    // ID属性（ラジオはグループ名）がフォームの項目名（= {変数} 名）を兼ねる
    const name = fieldVarName(node);
    const live = opts.interactive && name;
    const disabled = f.disabled || undefined;
    // デザイン画面では {名前} をそのまま見せ、プレビューで値を差し込む（テキストと同じ）
    const fill = (v: string | undefined) => (v && opts.vars && hasVars(v) ? interpolate(v, opts.vars) : (v ?? ""));
    const value = opts.fieldValues?.[name] ?? fieldInitialValue(f, opts.vars);
    const required = f.required || undefined;
    if (f.kind === "textarea") {
      return createElement("textarea", {
        ...common,
        placeholder: fill(f.placeholder),
        rows: f.rows || undefined,
        maxLength: f.maxLength || undefined,
        required,
        disabled,
        ...(live
          ? {
              value,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
                opts.onField?.(name, e.target.value),
            }
          : { readOnly: true, value: fill(f.defaultValue) }),
      });
    }
    if (f.kind === "select") {
      const options = (f.options ?? []).map(fill);
      return createElement(
        "select",
        {
          ...common,
          required,
          disabled,
          ...(live
            ? {
                value: value || (options[0] ?? ""),
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                  opts.onField?.(name, e.target.value),
              }
            : { value: fill(f.defaultValue) || options[0] || "", onChange: () => {} }),
        },
        options.map((o, i) => createElement("option", { key: i, value: o }, o))
      );
    }
    if (f.kind === "checkbox" || f.kind === "radio") {
      const label = fill(f.label);
      return createElement("label", common, [
        createElement("input", {
          key: "input",
          type: f.kind,
          // ラジオは表示テキストが値（書き出しと揃える）
          ...(f.kind === "radio" ? { value: label, name: name || undefined } : { value: "true" }),
          required,
          disabled,
          ...(live
            ? {
                checked: f.kind === "checkbox" ? truthy(value) : value === label,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  opts.onField?.(name, f.kind === "checkbox" ? String(e.target.checked) : label),
              }
            : { readOnly: true, checked: !!f.checked, onChange: () => {} }),
        }),
        label,
      ]);
    }
    if (f.kind === "submit") {
      // 表示切替などで既にonClickが付いていれば合成する
      const prev = common.onClick as ((e: React.MouseEvent) => void) | undefined;
      return createElement(
        "button",
        {
          ...common,
          type: "button",
          ...(opts.interactive
            ? {
                onClick: (e: React.MouseEvent) => {
                  prev?.(e);
                  opts.onSubmit?.();
                },
              }
            : {}),
        },
        f.label !== undefined ? fill(f.label) : tr("送信")
      );
    }
    if (f.kind === "file") {
      return createElement("input", {
        ...common,
        type: "file",
        accept: f.accept || undefined,
        multiple: f.multiple || undefined,
        required,
        disabled,
        // デザイン画面では、クリックでファイル選択が開かないようにする
        ...(live ? {} : { tabIndex: -1, onClick: (e: React.MouseEvent) => e.preventDefault() }),
      });
    }
    const type = f.inputType ?? "text";
    const ranged = RANGED_INPUTS.has(type);
    return createElement("input", {
      ...common,
      type,
      placeholder: type === "color" || type === "range" ? undefined : fill(f.placeholder),
      required,
      disabled,
      ...(ranged ? { min: fill(f.min) || undefined, max: fill(f.max) || undefined, step: fill(f.step) || undefined } : {}),
      ...(TEXT_INPUTS.has(type) && f.maxLength ? { maxLength: f.maxLength } : {}),
      ...(live
        ? {
            value,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              opts.onField?.(name, e.target.value),
          }
        : // 色・範囲は空の値を持てないため、初期値が無ければ値を渡さない
          { readOnly: true, value: fill(f.defaultValue) || (type === "color" || type === "range" ? undefined : ""), onChange: () => {} }),
    });
  }

  if (node.type === "media" && node.media) {
    const src = opts.doc ? mediaSrc(opts.doc, node.media) : node.media.src;
    if (!src.trim()) {
      return createElement(
        "div",
        { ...common, className: "cv-placeholder" },
        node.media.kind === "video"
          ? tr("動画のURLを設定パネルで指定してください")
          : tr("音声のURLを設定パネルで指定してください")
      );
    }
    return createElement(node.media.kind, {
      ...common,
      src,
      controls: true,
      loop: node.media.loop,
      muted: node.media.muted,
      playsInline: true,
      preload: "metadata",
    });
  }

  if (node.type === "embed" && node.embed) {
    const src = embedSrc(node.embed);
    if (!src) {
      const hint = {
        youtube: tr("YouTubeのURLを設定パネルで指定してください"),
        map: tr("住所またはマップのURLを設定パネルで指定してください"),
        url: tr("埋め込むURLを設定パネルで指定してください"),
      }[node.embed.kind];
      return createElement(
        "div",
        { ...common, className: "cv-placeholder" },
        hint
      );
    }
    return createElement(
      "div",
      common,
      createElement("iframe", {
        src,
        loading: "lazy",
        allow: node.embed.kind === "youtube" ? YOUTUBE_ALLOW : undefined,
        allowFullScreen: node.embed.kind !== "map",
        referrerPolicy: "strict-origin-when-cross-origin",
        style: {
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
        },
      })
    );
  }

  return null;
}
