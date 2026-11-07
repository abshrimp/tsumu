"use client";

/**
 * 動作ブロックの中身（種類ごとの入力欄）
 */

import { useContext } from "react";
import { readableValue } from "../DataView";
import { sharedCookieDomain } from "../../lib/script-runtime";
import { dataVarNames, setVarSource, uniqueVarName } from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { type ScriptStep } from "../../lib/types";
import { defaultTransform, type ValueRecipe, type ValueTransformKind } from "../../lib/script-model/compose";
import { evaluateValueRecipe } from "../../lib/script-model/recipe-runtime";
import { tr } from "../../lib/i18n";
import {
  AnyArraySelect,
  ArrayFieldBody,
  ArrayFindBody,
  ArraySelect,
  FilterArrayBody,
  JoinBody,
  SortArrayBody,
  UnfilterSelect,
  VarSelect,
} from "./arrays";
import { Ctx } from "./context";
import { FetchBody, PathMenu, VarNameIn, isNested, nameFromPath } from "./fetch";
import { FieldValueIn, NewTabCheck, Phrase, TextIn, ValueIn, regexError } from "./inputs";
import { ValueComposerPreview, ValueTransformSettings, VALUE_TRANSFORM_GROUPS, VALUE_TRANSFORM_LABELS } from "./ValueComposerPreview";
import { TargetSelect } from "./targets";

export function StepBody({ step }: { step: ScriptStep }) {
  const { doc, pageId, updateStep, renameVar } = useContext(Ctx);
  const set = (fn: (s: ScriptStep) => ScriptStep) => updateStep(step.id, fn);
  switch (step.kind) {
    case "show":
    case "hide":
    case "toggle":
      return (
        <Phrase
          text="{target}{action}"
          parts={{
            target: (
              <TargetSelect
                value={step.target}
                onChange={(v) => set((s) => ({ ...s, target: v }) as ScriptStep)}
              />
            ),
            action: (
              <select
                className="se-in"
                value={step.kind}
                onChange={(e) =>
                  set(
                    (s) =>
                      ({
                        ...s,
                        kind: e.target.value as "show" | "hide" | "toggle",
                      }) as ScriptStep
                  )
                }
              >
                <option value="show">{tr("を表示する")}</option>
                <option value="hide">{tr("を隠す")}</option>
                <option value="toggle">{tr("の表示を切り替える")}</option>
              </select>
            ),
          }}
        />
      );
    case "open-page":
      return (
        <>
          <Phrase
            text="{kind}{page}を開く"
            parts={{
              kind: <OpenKindSelect step={step} />,
              page: (
              <select
                className={`se-in${step.pageId ? "" : " is-empty"}`}
                value={step.pageId}
                onChange={(e) =>
                  set((s) => ({ ...s, pageId: e.target.value }) as ScriptStep)
                }
              >
                <option value="" disabled>
                  {tr("ページを選択")}
                </option>
                {doc.pageOrder.map((pid) => (
                  <option key={pid} value={pid}>
                    {tr("{name}（/{slug}）", { name: doc.pages[pid].name, slug: doc.pages[pid].slug })}
                  </option>
                ))}
                {step.pageId && !doc.pages[step.pageId] && (
                  <option value={step.pageId}>{tr("（削除されたページ）")}</option>
                )}
              </select>
              ),
            }}
          />
          <NewTabCheck
            checked={!!step.newTab}
            onChange={(v) =>
              set((s) => ({ ...s, newTab: v || undefined }) as ScriptStep)
            }
          />
        </>
      );
    case "open-url":
      return (
        <>
          <Phrase
            text="{kind}{url}を開く"
            parts={{
              kind: <OpenKindSelect step={step} />,
              url: (
                <TextIn
                  value={step.url}
                  placeholder={tr("https://~ / #ID / {変数}")}
                  vars
                  width={180}
                  onCommit={(v) => set((s) => ({ ...s, url: v.trim() }) as ScriptStep)}
                />
              ),
            }}
          />
          <NewTabCheck
            checked={!!step.newTab}
            onChange={(v) =>
              set((s) => ({ ...s, newTab: v || undefined }) as ScriptStep)
            }
          />
        </>
      );
    case "scroll-to":
      return (
        <Phrase
          text="{target}までスクロールする"
          parts={{
            target: (
              <TargetSelect
                value={step.target}
                onChange={(v) => set((s) => ({ ...s, target: v }) as ScriptStep)}
              />
            ),
          }}
        />
      );
    case "set-enabled":
      return (
        <Phrase
          text="{target}を{op}"
          parts={{
            target: (
              <TargetSelect
                only="control"
                value={step.target}
                onChange={(v) => set((s) => ({ ...s, target: v }) as ScriptStep)}
              />
            ),
            op: (
              <select
                className="se-in"
                value={step.op}
                onChange={(e) => set((s) => ({ ...s, op: e.target.value }) as ScriptStep)}
              >
                <option value="enable">{tr("有効にする")}</option>
                <option value="disable">{tr("無効にする")}</option>
                <option value="toggle">{tr("有効・無効を切り替える")}</option>
              </select>
            ),
          }}
        />
      );
    case "set-value":
      return (
        <Phrase
          text="{target}に{value}を入れる"
          parts={{
            target: (
              <TargetSelect
                only="field"
                value={step.target}
                onChange={(v) => set((s) => ({ ...s, target: v }) as ScriptStep)}
              />
            ),
            value: (
              <FieldValueIn
                target={step.target}
                value={step.value}
                onCommit={(v) => set((s) => ({ ...s, value: v }) as ScriptStep)}
              />
            ),
          }}
        />
      );
    case "fetch":
      return <FetchBody step={step} />;
    case "split":
      return (
        <Phrase
          text="文字列{source}を{sep}で分解してリスト{into}とする"
          parts={{
            source: (
              <TextIn
                value={step.source}
                placeholder={tr("{変数}")}
                vars
                width={110}
                onCommit={(v) => set((s) => ({ ...s, source: v }) as ScriptStep)}
              />
            ),
            sep: (
              <TextIn
                value={step.sep}
                placeholder=","
                width={40}
                onCommit={(v) => set((s) => ({ ...s, sep: v }) as ScriptStep)}
              />
            ),
            into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("名前（例: 商品）")} />,
          }}
        />
      );
    case "array-find":
      return <ArrayFindBody step={step} />;
    case "array-field":
      return <ArrayFieldBody step={step} />;
    case "join":
      return <JoinBody step={step} />;
    case "filter-array":
      return <><ListDisplayMode step={step} /><FilterArrayBody step={step} /></>;
    case "sort-array":
      return <><ListDisplayMode step={step} /><SortArrayBody step={step} /></>;
    case "unfilter-array":
      return (
        <>
          <ListDisplayMode step={step} />
        <Phrase
          text="リスト{array}の{which}を解除する"
          parts={{
            array: (
              <ArraySelect
                value={step.array}
                onChange={(v) => set((s) => ({ ...s, array: v, no: undefined }) as ScriptStep)}
              />
            ),
            which: <UnfilterSelect step={step} />,
          }}
        />
        </>
      );
    case "store-save":
      return (
        <>
          <Phrase
            text="ストレージの{key}に{value}を保存する"
            parts={{
              key: (
                <TextIn
                  value={step.key}
                  placeholder={tr("キー")}
                  width={96}
                  onCommit={(v) => set((s) => ({ ...s, key: v.trim() }) as ScriptStep)}
                />
              ),
              value: (
                <TextIn
                  value={step.value}
                  placeholder={tr("値 / {変数}")}
                  vars
                  width={110}
                  onCommit={(v) => set((s) => ({ ...s, value: v }) as ScriptStep)}
                />
              ),
            }}
          />
          <SharedCheck step={step} />
        </>
      );
    case "store-load":
      return (
        <>
          <Phrase
            text="ストレージの{key}を読み込んで変数{into}とする"
            parts={{
              key: (
                <TextIn
                  value={step.key}
                  placeholder={tr("キー")}
                  width={96}
                  onCommit={(v) => {
                    const key = v.trim();
                    set((s) => ({ ...s, key }) as ScriptStep);
                    // 変数の名前が空なら、キーから付ける
                    if (key && !step.into) {
                      renameVar(step.id, "", uniqueVarName(doc, pageId, key, step.id));
                    }
                  }}
                />
              ),
              into: <VarNameIn stepId={step.id} value={step.into} />,
            }}
          />
          <SharedCheck step={step} />
        </>
      );
    case "wait":
      return (
        <Phrase
          text="{seconds}秒待つ"
          parts={{
            seconds: (
              <TextIn
                type="number"
                value={String(step.seconds)}
                width={56}
                onCommit={(v) =>
                  set((s) => ({ ...s, seconds: Math.max(0, Number(v) || 0) }) as ScriptStep)
                }
              />
            ),
          }}
        />
      );
    case "count":
      return (
        <Phrase
          text="リスト{array}の件数を変数{into}とする"
          parts={{
            array: (
              <AnyArraySelect
                value={step.array}
                onChange={(array) =>
                  set(
                    (s) =>
                      ({
                        ...s,
                        array,
                        ...(!step.into
                          ? { into: uniqueVarName(doc, pageId, tr("{p1}の件数", { p1: nameFromPath(array) }), step.id) }
                          : {}),
                      }) as ScriptStep
                  )
                }
              />
            ),
            into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("名前（例: 件数）")} />,
          }}
        />
      );
    case "set-var":
      return <SetVarBody step={step} />;
    case "transform":
      return <TransformBody step={step} />;
    case "calc":
      return (
        <Phrase
          text="{expr}を計算して変数{into}とする"
          parts={{
            expr: (
              <TextIn
                value={step.expr}
                valueContext="number"
                placeholder={tr("{数} + 1")}
                vars
                width={130}
                onCommit={(v) => set((s) => ({ ...s, expr: v }) as ScriptStep)}
              />
            ),
            into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("名前（例: 合計）")} />,
          }}
        />
      );
    case "replace":
      return (
        <>
          <Phrase
            text="{source}の{find}を{to}に置き換えて変数{into}とする"
            parts={{
              source: (
                <TextIn
                  value={step.source}
                  placeholder={tr("{文字列}")}
                  vars
                  width={110}
                  onCommit={(v) => set((s) => ({ ...s, source: v }) as ScriptStep)}
                />
              ),
              find: (
                <TextIn
                  value={step.find}
                  placeholder={step.regex ? "\\d+" : tr("探す文字列")}
                  vars
                  width={100}
                  onCommit={(v) => set((s) => ({ ...s, find: v }) as ScriptStep)}
                />
              ),
              to: (
                <TextIn
                  value={step.to}
                  placeholder={step.regex ? tr("空なら取り除く / $1") : tr("空なら取り除く")}
                  vars
                  width={100}
                  onCommit={(v) => set((s) => ({ ...s, to: v }) as ScriptStep)}
                />
              ),
              into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("名前（例: 整形後）")} />,
            }}
          />
          <label className="se-check">
            <input
              type="checkbox"
              checked={!!step.regex}
              onChange={(e) =>
                set((s) => ({ ...s, regex: e.target.checked || undefined }) as ScriptStep)
              }
            />
            {tr("正規表現")}
          </label>
          {step.regex && regexError(step.find) && (
            <span className="se-blk-note">{tr("正規表現の書き方が正しくないため、置き換えません")}</span>
          )}
        </>
      );
    case "list-edit":
      return (
        <Phrase
          text="変数{into}の{sep}区切りに{value}を{op}"
          parts={{
            into: (
              <VarSelect
                stepId={step.id}
                value={step.into}
                onChange={(v) => set((s) => ({ ...s, into: v }) as ScriptStep)}
              />
            ),
            sep: (
              <TextIn
                value={step.sep}
                placeholder=","
                width={36}
                onCommit={(v) => set((s) => ({ ...s, sep: v }) as ScriptStep)}
              />
            ),
            value: (
              <TextIn
                value={step.value}
                placeholder={tr("値 / {変数}")}
                vars
                width={96}
                onCommit={(v) => set((s) => ({ ...s, value: v }) as ScriptStep)}
              />
            ),
            op: (
              <select
                className="se-in"
                value={step.op}
                onChange={(e) =>
                  set((s) => ({ ...s, op: e.target.value as "add" | "remove" | "toggle" }) as ScriptStep)
                }
              >
                <option value="toggle">{tr("切り替える")}</option>
                <option value="add">{tr("足す")}</option>
                <option value="remove">{tr("取り除く")}</option>
              </select>
            ),
          }}
        />
      );
    case "copy":
      return (
        <Phrase
          text="{value}をコピーする"
          parts={{
            value: (
              <TextIn
                value={step.value}
                placeholder={tr("文字列 / {変数}")}
                vars
                width={150}
                onCommit={(v) => set((s) => ({ ...s, value: v }) as ScriptStep)}
              />
            ),
          }}
        />
      );
    case "if":
    case "repeat":
    case "for-each":
      return null;
  }
}

/** Three display-state actions share one palette entry; saved kinds remain compatible. */
function ListDisplayMode({ step }: {
  step: Extract<ScriptStep, { kind: "filter-array" | "sort-array" | "unfilter-array" }>;
}) {
  const { updateStep } = useContext(Ctx);
  return (
    <select
      className="se-in se-display-mode"
      aria-label={tr("リスト表示の操作")}
      value={step.kind}
      onChange={(event) => updateStep(step.id, () => {
        const kind = event.target.value;
        if (kind === "sort-array") {
          return { id: step.id, kind, array: step.array,
            field: "field" in step ? step.field : "", dir: "asc" };
        }
        if (kind === "unfilter-array") {
          return { id: step.id, kind, array: step.array };
        }
        return { id: step.id, kind: "filter-array", array: step.array,
          field: "field" in step ? step.field : "", op: "eq", value: "" };
      })}
    >
      <option value="filter-array">{tr("絞り込む")}</option>
      <option value="sort-array">{tr("並べ替える")}</option>
      <option value="unfilter-array">{tr("絞り込みを解除")}</option>
    </select>
  );
}

/** 「ページ / URL」を開く（ブロックの種類を切り替える） */
function OpenKindSelect({ step }: { step: Extract<ScriptStep, { kind: "open-page" | "open-url" }> }) {
  const { updateStep } = useContext(Ctx);
  return (
    <select
      className="se-in"
      value={step.kind}
      onChange={(e) => {
        const newTab = step.newTab ? { newTab: true } : {};
        updateStep(step.id, () =>
          e.target.value === "open-url"
            ? { id: step.id, kind: "open-url", url: "", ...newTab }
            : { id: step.id, kind: "open-page", pageId: "", ...newTab }
        );
      }}
    >
      <option value="open-page">{tr("ページ")}</option>
      <option value="open-url">URL</option>
    </select>
  );
}

/** 「［値］を変数［］とする」（従来の文字入力または組み立てた値） */
function SetVarBody({ step }: { step: Extract<ScriptStep, { kind: "set-var" }> }) {
  const { doc, pageId, updateStep, samples, renameVar, readOnly } = useContext(Ctx);
  const src = setVarSource(step);
  const value = src ? lookupVar(samples, src) : undefined;
  const saveRecipe = (recipe: ValueRecipe) => {
    const next = "{" + recipe.source + "}";
    updateStep(step.id, (s) => ({
      ...s, value: next, recipe: recipe.steps.length ? recipe : undefined,
    }) as ScriptStep);
    if (!step.into) renameVar(step.id, "", uniqueVarName(doc, pageId, nameFromPath(recipe.source), step.id));
  };
  return (
    <>
      <Phrase
        text="{value}を変数{into}とする"
        parts={{
          value: step.recipe ? (
            <span className="se-in se-in-fake se-composer-inline-summary">
              {"{" + step.recipe.source + "}"} · {tr("{count}件の加工", { count: step.recipe.steps.length })}
            </span>
          ) : (
            <ValueIn
              value={step.value}
              width={150}
              onCommit={(v) => {
                updateStep(step.id, (s) => ({ ...s, value: v, recipe: undefined }) as ScriptStep);
                const m = /^\{([^{}]+)\}$/.exec(v.trim());
                if (m && !step.into) {
                  renameVar(step.id, "", uniqueVarName(doc, pageId, nameFromPath(m[1].trim()), step.id));
                }
              }}
            />
          ),
          into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("名前（例: 合計）")} />,
        }}
      />
      {!readOnly && step.recipe && <ValueComposerPreview currentValue={step.value} samples={samples}
        excludedName={step.into} recipe={step.recipe} onApply={saveRecipe} />}
      {step.recipe && !readOnly && (
        <button type="button" className="se-mini se-mini-text" onClick={() =>
          updateStep(step.id, (s) => ({ ...s, recipe: undefined }) as ScriptStep)
        }>{tr("通常の値に戻す")}</button>
      )}
      {step.into && value !== undefined && value !== null && (
        <span className="se-blk-note">
          {Array.isArray(value)
            ? tr("リスト・{length}件（リスト表示で並べられます）", { length: value.length })
            : isNested(value)
              ? tr("要素では {{into}.項目名} のように使えます", { into: step.into })
              : tr("見本: {p1}", { p1: readableValue(value) })}
        </span>
      )}
    </>
  );
}


/** One native block applies one pure operation. Stacking blocks composes them. */
function TransformBody({ step }: { step: Extract<ScriptStep, { kind: "transform" }> }) {
  const { doc, pageId, updateStep, samples } = useContext(Ctx);
  const set = (patch: Partial<typeof step>) => updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  const available = new Set([...dataVarNames(doc, pageId, step.id), ...Object.keys(samples).filter((key) => !key.startsWith("#"))]);
  const sourceValues = Object.fromEntries([
    ...Object.entries(samples).filter(([name]) => !name.startsWith("#")),
    ...[...available].filter((name) => !Object.hasOwn(samples, name)).map((name) => [name, undefined]),
  ]);
  const sample = step.source ? lookupVar(samples, step.source) : undefined;
  const first = Array.isArray(sample)
    ? sample.find((item) => item !== null && typeof item === "object" && !Array.isArray(item))
    : undefined;
  const candidate = step.transform.kind === "field" || step.transform.kind === "has" ? sample : first;
  const options = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? Object.keys(candidate) : [];
  const preview = sample === undefined ? null : evaluateValueRecipe(sample, [step.transform]);

  return (
    <>
      <Phrase
        text="変数{source}に{operation}を行い、変数{into}に入れる"
        parts={{
          source: <PathMenu root={sourceValues} path={step.source}
            ariaLabel={tr("加工する元の変数")} placeholder={tr("変数を選択")}
            mode="any" allowRoot={false} portalZIndex={550}
            onChange={(source) => updateStep(step.id, (s) => {
              if (s.kind !== "transform") return s;
              // Reuse the source variable by default; blocks can share one name.
              return { ...s, source,
                into: !s.into || s.into === s.source ? source : s.into };
            })} />,
          operation: <select className="se-in" aria-label={tr("加工の種類")}
            value={step.transform.kind}
            onChange={(e) => set({ transform: defaultTransform(e.target.value as ValueTransformKind) })}>
            {VALUE_TRANSFORM_GROUPS.map((group) =>
              <optgroup key={group.label} label={tr(group.label)}>
                {group.kinds.map((kind) =>
                  <option key={kind} value={kind}>{tr(VALUE_TRANSFORM_LABELS[kind])}</option>)}
              </optgroup>)}
          </select>,
          into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("変数名")} />,
        }}
      />
      <div className="se-transform-settings">
        <ValueTransformSettings transform={step.transform} options={options}
          onChange={(transform) => set({ transform })} />
      </div>
      {preview?.kind === "value" && (
        <span className="se-blk-note">
          {tr("見本: {p1}", { p1: typeof preview.value === "object"
            ? JSON.stringify(preview.value).slice(0, 90) : String(preview.value) })}
        </span>
      )}
      {preview?.kind === "error" && <span className="se-blk-note">{tr("見本を加工できません（{code}）", { code: preview.code })}</span>}
    </>
  );
}

/** 「サブドメインと共有」（公開URLのドメインの全サブドメインで同じ値を読み書きする） */
function SharedCheck({ step }: { step: Extract<ScriptStep, { kind: "store-save" | "store-load" }> }) {
  const { doc, updateStep } = useContext(Ctx);
  const domain = sharedCookieDomain(doc);
  return (
    <>
      <label className="se-check">
        <input
          type="checkbox"
          checked={!!step.shared}
          onChange={(e) =>
            updateStep(step.id, (s) => ({ ...s, shared: e.target.checked || undefined }) as ScriptStep)
          }
        />
        {domain ? tr("{domain} の全サブドメインと共有", { domain }) : tr("サブドメインと共有")}
      </label>
      {step.shared && !domain && (
        <span className="se-badge is-warn">{tr("サイト設定の公開URLを入れると共有されます")}</span>
      )}
    </>
  );
}
