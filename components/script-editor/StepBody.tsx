"use client";

/**
 * 動作ブロックの中身（種類ごとの入力欄）
 */

import { useContext } from "react";
import { readableValue } from "../DataView";
import { sharedCookieDomain } from "../../lib/script-runtime";
import { setVarSource, uniqueVarName } from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { type ScriptStep } from "../../lib/types";
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
import { FetchBody, VarNameIn, isNested, nameFromPath } from "./fetch";
import { FieldValueIn, NewTabCheck, Phrase, TextIn, regexError } from "./inputs";
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
          text="文字列{source}を{sep}で分解して配列{into}とする"
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
            into: <VarNameIn stepId={step.id} value={step.into} placeholder={tr("名前（例: 一覧）")} />,
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
      return <FilterArrayBody step={step} />;
    case "sort-array":
      return <SortArrayBody step={step} />;
    case "unfilter-array":
      return (
        <Phrase
          text="配列{array}の{which}を解除する"
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
          text="配列{array}の件数を変数{into}とする"
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
    case "calc":
      return (
        <Phrase
          text="{expr}を計算して変数{into}とする"
          parts={{
            expr: (
              <TextIn
                value={step.expr}
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
                  placeholder={tr("{文字}")}
                  vars
                  width={110}
                  onCommit={(v) => set((s) => ({ ...s, source: v }) as ScriptStep)}
                />
              ),
              find: (
                <TextIn
                  value={step.find}
                  placeholder={step.regex ? "\\d+" : tr("置き換える文字")}
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
                placeholder={tr("文字 / {変数}")}
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

/** 「［値］を変数［］とする」（{名前} 1つだけなら配列・まとまりもそのまま入る） */
function SetVarBody({ step }: { step: Extract<ScriptStep, { kind: "set-var" }> }) {
  const { doc, pageId, updateStep, samples, renameVar } = useContext(Ctx);
  const src = setVarSource(step);
  const value = src ? lookupVar(samples, src) : undefined;
  return (
    <>
      <Phrase
        text="{value}を変数{into}とする"
        parts={{
          value: (
            <TextIn
              value={step.value}
              placeholder={tr("値 / {データ.位置}")}
              vars
              width={150}
              onCommit={(v) => {
                updateStep(step.id, (s) => ({ ...s, value: v }) as ScriptStep);
                // 名前が空なら、入れる位置の最後の項目名から付ける
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
      {step.into && value !== undefined && value !== null && (
        <span className="se-blk-note">
          {Array.isArray(value)
            ? tr("{length}件の一覧（リスト要素で並べられます）", { length: value.length })
            : isNested(value)
              ? tr("要素では {{into}.項目名} のように使えます", { into: step.into })
              : tr("見本: {p1}", { p1: readableValue(value) })}
        </span>
      )}
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
