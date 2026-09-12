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
  type FieldValues,
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
import { safeResourceUrl } from "../../lib/url-policy";

/* ---------- 変数コンテキスト ---------- */

export interface CanvasVars {
  /** ページの変数（slug・フォームの値） */
  pageVars: Record<string, unknown>;
  fieldValues: FieldValues;
  setFieldValue: (name: string, v: string) => void;
  /** 送信ボタン: ページの JSON を取得し直す */
  refresh: () => void;
  preview: boolean;
  /** プレビューでのリンクの移動（サイト内のパスなら、ページの切り替えとして扱う） */
  navigate: (url: string) => void;
  /** 画面上（ブラウザ）で値が決まる変数・配列の名前 */
  clientVars: Set<string>;
  /** 配列の名前 → ページを開いたときのスクリプトで決まる、絞り込みと並べ替え */
  listOps: Map<string, ListOp[]>;
}

/** リストに適用する絞り込みと並べ替え（値の {変数} をページの変数で解決する） */
export function resolvedListOps(
  listOps: Map<string, ListOp[]>,
  from: string,
  vars: Record<string, unknown>
): ListOp[] {
  return (listOps.get(from) ?? []).map((o) =>
    o.kind === "filter"
      ? {
          ...o,
          conds: o.conds.map((c) => {
            const reference = /^(?:\{([^{}\s"'<>`]+)\}|(\[slug\]))$/.exec(c.value.trim());
            if (reference) return { ...c, resolvedValue: { value: lookupVar(vars, reference[1] ?? "slug") } };
            return hasVars(c.value) ? { ...c, value: interpolate(c.value, vars) } : c;
          }),
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
 * コンポーネントが自分自身を含んでいると、無限に描画し続けて画面が固まるため、2度目は描かない
 */
export const InstanceChainCtx = createContext<string[]>([]);

/** 自分自身を含むコンポーネントの代わりに表示するもの */
export function recursiveInstance(common: Record<string, unknown>): ReactNode {
  return createElement("div", {
    ...common,
    style: { padding: 12, color: "#a1a1aa", fontSize: 13 },
    children: tr("(Can't display: the component contains itself)"),
  });
}

/** テンプレートを表示用に解決する（値を差し込むのはプレビューのときだけ） */
export function renderTpl(
  tpl: string,
  vars: Record<string, unknown>,
  preview: boolean
): ReactNode {
  if (preview) return interpolate(tpl, vars);
  // デザイン画面では {名前} を普通の文字と同じように表示し（リストでもそのまま複製する）、値はプレビューで表示する
  return tpl;
}

/** ページごとのキャンバスのスクロール位置（ページ ID → [上, 左]） */
export const SCROLL_KEY = storageKey("scroll-v1");

/** 「変数を探す」を開いている間は、テキスト編集の blur で確定・終了しない */
export const holdEditing = { current: false };

/* ---------- スクリプト（プレビュー） ---------- */

/** プレビュー時: 実行用に変換したスクリプトを、data-scripts として props に載せる */
export function applyScriptsAttr(
  node: Pick<DocNode, "scripts">,
  common: Record<string, unknown>,
  doc: SiteDoc,
  vars: Record<string, unknown>,
  clientVars: Set<string>,
  skip?: Set<string>,
  itemVars?: Record<string, unknown>
) {
  if (!node.scripts?.length) return;
  const compiled = compileScripts(
    node,
    (pageId) => {
      const p = doc.pages[pageId];
      return p ? pageHrefOf(p) : "/";
    },
    (str, kind, item) => {
      if (item) return str;
      if (!hasVars(str)) return str;
      // 画面上の変数は {名前} のまま、文字としての「{」は「\{」のまま渡し、ランタイムが置き換える
      const v = { ...vars, ...keepTokens(str, (name) => clientVars.has(name.split(".")[0])), [KEEP_ESCAPES]: true };
      return kind === "url" ? interpolateUrl(str, v) : interpolate(str, v);
    },
    true,
    skip,
    (name, item) => (item || clientVars.has(name.split(".")[0]) ? undefined : (lookupVar(vars, name) ?? null))
  );
  if (compiled.length) common["data-scripts"] = JSON.stringify(compiled);
}

/* ---------- ノード描画 ---------- */

/**
 * <button> の要素。フォームの中で押すと送信する（プレビューではページのデータを取得し直す）。
 * 「クリックしたとき」のスクリプトがあるボタンは送信しない（書き出したサイトと同じ）
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
  /** 動画・音声のアセットを探す編集データ */
  doc?: SiteDoc;
  /** プレビュー時: フォーム部品を操作できるようにする */
  interactive?: boolean;
  /** プレビュー時: 案内文や初期値などの {変数} を置き換える値 */
  vars?: Record<string, unknown>;
  fieldValues?: FieldValues;
  onField?: (name: string, v: string) => void;
  onSubmit?: () => void;
}

/** icon / field / media / embed を実際の DOM で描画する（NodeView と GhostView で共用） */
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
    // ID 属性（ラジオではグループ名）が、フォームの項目名（= {変数} の名前）を兼ねる
    const name = fieldVarName(node);
    const live = opts.interactive && name;
    const disabled = f.disabled || undefined;
    // デザイン画面では {名前} をそのまま表示し、プレビューで値を差し込む（テキストと同じ）
    const fill = (v: string | undefined) => (v && opts.vars && hasVars(v) ? interpolate(v, opts.vars) : (v ?? ""));
    const stored = opts.fieldValues?.[name];
    const value = stored === undefined ? fieldInitialValue(f, opts.vars) : (stored ?? "");
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
              // 標準の変更スクリプトが描画し直す前に、入力した値を React に渡す。
              onInputCapture: (e: React.FormEvent<HTMLTextAreaElement>) =>
                opts.onField?.(name, e.currentTarget.value),
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
                opts.onField?.(name, e.target.value),
            }
          : { readOnly: true, value: fill(f.defaultValue) }),
      });
    }
    if (f.kind === "select") {
      const options = (f.options ?? []).map((option) => ({
        label: fill(option.label), value: fill(option.value),
      }));
      const unselected = live && stored === null;
      return createElement(
        "select",
        {
          ...common,
          required,
          disabled,
          ...(live
            ? {
                value: unselected ? "" : value,
                // React は一致しない値を先頭の選択肢に戻すため、選択の解除をコミットの後にも保つ。
                ref: (el: HTMLSelectElement | null) => {
                  if (el && unselected) el.selectedIndex = -1;
                },
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                  opts.onField?.(name, e.target.value),
              }
            : { value: fieldInitialValue(f, opts.vars), onChange: () => {} }),
        },
        options.map((o, i) => createElement("option", { key: i, value: o.value }, o.label))
      );
    }
    if (f.kind === "checkbox" || f.kind === "radio") {
      const label = fill(f.label);
      return createElement("label", common, [
        createElement("input", {
          key: "input",
          type: f.kind,
          // ラジオは表示テキストを値にする（書き出したサイトとそろえる）
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
      // 表示の切り替えなどですでに onClick が付いていれば、合成する
      const prev = common.onClick as ((e: React.MouseEvent) => void) | undefined;
      return createElement(
        "button",
        {
          ...common,
          type: "button",
          disabled,
          ...(opts.interactive
            ? {
                onClick: (e: React.MouseEvent) => {
                  prev?.(e);
                  opts.onSubmit?.();
                },
              }
            : {}),
        },
        f.label !== undefined ? fill(f.label) : tr("Submit")
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
        // デザイン画面では、クリックでファイルの選択画面が開かないようにする
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
            // キャンバスの標準の input リスナーより先に記録し、古い値に戻ってしまうのを防ぐ。
            onInputCapture: (e: React.FormEvent<HTMLInputElement>) =>
              opts.onField?.(name, e.currentTarget.value),
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              opts.onField?.(name, e.target.value),
          }
        : // 色と範囲は空の値を持てないため、初期値が無ければ値を渡さない
          { readOnly: true, value: fill(f.defaultValue) || (type === "color" || type === "range" ? undefined : ""), onChange: () => {} }),
    });
  }

  if (node.type === "media" && node.media) {
    const src = opts.doc ? mediaSrc(opts.doc, node.media) : node.media.src;
    const sources = (node.media.sources ?? []).map((source, index) => {
      const url = opts.doc ? mediaSrc(opts.doc, source) : source.src;
      return url.trim() ? createElement("source", {
        key: index, src: safeResourceUrl(url), type: source.type, media: source.media,
      }) : null;
    }).filter(Boolean);
    if (!src.trim() && !sources.length) {
      return createElement(
        "div",
        { ...common, className: "cv-placeholder" },
        node.media.kind === "video"
          ? tr("Set the video URL in the Settings panel")
          : tr("Set the audio URL in the Settings panel")
      );
    }
    return createElement(node.media.kind, {
      ...common,
      src: src.trim() ? src : undefined,
      controls: true,
      loop: node.media.loop,
      muted: node.media.muted,
      playsInline: true,
      preload: "metadata",
    }, ...sources);
  }

  if (node.type === "embed" && node.embed) {
    const src = embedSrc(node.embed);
    if (!src) {
      const hint = {
        youtube: tr("Set the YouTube URL in the Settings panel"),
        map: tr("Set an address or map URL in the Settings panel"),
        url: tr("Set the URL to embed in the Settings panel"),
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
