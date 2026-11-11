"use client";

/**
 * データの取得ブロックと、取得したデータの項目・変数名の選び方
 */

import { isEnterKey } from "../../lib/keys";
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Play, Plus, RefreshCw, SlidersHorizontal, Table2, X } from "lucide-react";
import { JsonPeek, readableValue } from "../DataView";
import { anchoredMenuPos, varSuggestionAnchorVisible } from "../controls";
import {
  cleanVarName,
  dataVarNames,
  digPath,
  fieldLabel,
  ITEM_VALUE,
  makeSample,
  uniqueVarName,
  varGroupsAt,
  type FetchStep,
} from "../../lib/data";
import { interpolateUrl, type Vars } from "../../lib/vars";
import { fetchPreviewInputs } from "../../lib/fetch-preview";
import { localVariableNames, variableChoiceSamples } from "../../lib/variable-choice";
import {
  bodyJsonError,
  FETCH_METHODS,
  fetchRequestOf,
  sendsBody,
  type FetchOptions,
} from "../../lib/fetch-request";
import { type FetchHeader, type FetchMethod, type SiteDoc, PAGE_TARGET } from "../../lib/types";
import { useEditor } from "../../lib/store";
import { pageNodeIds, walkSteps } from "../../lib/script";
import { userMessage } from "../../lib/errors";
import { getLang, tr, trc } from "../../lib/i18n";
import { Ctx, LoopCtx, ScriptNodeCtx, ScriptOwnerCtx, type FetchPreviewScope } from "./context";
import { Phrase, TextIn } from "./inputs";

/** テスト実行で明示的に送る。未解決の値を空文字や仮の slug に置き換えない。 */
export async function fetchWhole(url: string, options: FetchOptions = {}, vars: Vars = {}): Promise<unknown> {
  if (fetchPreviewInputs(url, options, vars).some((input) => input.missing)) {
    throw new Error(tr("Enter test values to continue"));
  }
  const resolved = interpolateUrl(url, vars);
  const res = await fetch("/api/fetch-json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: resolved, ...fetchRequestOf(options, vars) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? tr("Couldn't load ({status})", { status: res.status }));
  return data.json;
}

/** 「データを見る」で取得した全件（取得ブロックの設定ごと。エディタを開いている間だけ覚えておく） */
export const wholeCache = new Map<string, unknown>();
const sourceKey = (scope?: FetchPreviewScope) => scope?.owner ?? { nodeId: scope?.nodeId ?? "" };
export const wholeKey = (st: FetchStep, pageId = useEditor.getState().activePageId, session = useEditor.getState().documentSession, scope?: FetchPreviewScope) =>
  JSON.stringify([session, pageId, sourceKey(scope), st.id, st.url, st.method, st.headers, st.body, st.preview?.fetchedAt]);
const ownerKey = (stepId: string, pageId: string, scope?: FetchPreviewScope) => JSON.stringify([useEditor.getState().documentSession, pageId, sourceKey(scope), stepId]);

/** 見本を取得したリクエストと、保存先の現在の設定を比べる（見本の更新時刻は除く） */
export const requestKey = (url: string, options: FetchOptions) =>
  JSON.stringify([url.trim(), options.method ?? "GET", options.headers ?? [], options.body ?? ""]);
export const fetchTestKey = (step: FetchStep, scope: FetchPreviewScope) =>
  JSON.stringify([requestKey(step.url, step), scope.nodeId, scope.localNames]);

/** 時刻のある見本だけが現在の設定で確認済み。未確認の見本もフォールバックには残す。 */
export const hasCurrentSample = (step: FetchStep) => step.preview?.sample !== undefined &&
  typeof step.preview?.fetchedAt === "number" && Number.isFinite(step.preview.fetchedAt) && step.preview.fetchedAt > 0;

/** 設定変更は取得済みの印だけを外し、見本のフォールバックは保持する。 */
export function changeFetchRequest(step: FetchStep, patch: FetchOptions & { url?: string }, pageId = useEditor.getState().activePageId, scope?: FetchPreviewScope): FetchStep {
  const next = { ...step, ...patch };
  if (requestKey(step.url, step) !== requestKey(next.url, next)) {
    if (next.preview) {
      const { fetchedAt: _at, ...preview } = next.preview;
      next.preview = preview;
    }
    const owner = ownerKey(step.id, pageId, scope);
    attemptedRequests.delete(owner); requestErrors.delete(owner); submittedRequests.delete(owner); temporaryValues.delete(owner);
  }
  return next;
}

/** 子項目がないリストも含め、参照可能な名前を保持する。 */
export function fetchPreviewScope(nodeId: string, loops: readonly { fields: string[]; roots?: string[] }[]): FetchPreviewScope {
  return { nodeId, localNames: localVariableNames(loops.flatMap((loop) => [...(loop.roots ?? []), ...loop.fields])) };
}

/** 画面を閉じても、送信済みの同じ要求を重ねて送らない。別設定の応答は最新だけを採用する。 */
const activeRefetches = new Map<string, symbol>();
const pendingRefetches = new Map<string, Map<string, symbol>>();
const attemptedRequests = new Map<string, string>();
const requestErrors = new Map<string, { key: string; message: string }>();
const submittedRequests = new Map<string, { key: string; method: string; url: string }>();
const resultRequests = new Map<string, { method: string; url: string; fetchedAt: number }>();
interface TemporaryValues { key: string; values: Record<string, string> }
const temporaryValues = new Map<string, TemporaryValues>();
const EMPTY_VALUES: Record<string, string> = {};
const requestListeners = new Set<() => void>();
const subscribeRequests = (listener: () => void) => {
  requestListeners.add(listener);
  return () => { requestListeners.delete(listener); };
};
const notifyRequests = () => requestListeners.forEach((listener) => listener());

/** 実文書から探す。ドラッグ表示の一時的な除外は含まれない。 */
function currentFetch(doc: SiteDoc, pageId: string, id: string, scope: FetchPreviewScope, roots: string[]): FetchStep | undefined {
  const page = doc.pages[pageId];
  if (!page) return undefined;
  const nodeId = scope.owner?.nodeId ?? (scope.owner ? null : scope.nodeId);
  const eligible = pageNodeIds(doc, pageId, roots);
  const scripts = nodeId && nodeId !== PAGE_TARGET
    ? eligible.includes(nodeId) ? doc.nodes[nodeId]?.scripts ?? [] : []
    : scope.owner ? nodeId === PAGE_TARGET ? page.pageScripts ?? [] : page.scripts ?? []
      : [...(page.pageScripts ?? []), ...(page.scripts ?? [])];
  const matches: FetchStep[] = [];
  for (const script of scripts) {
    if (scope.owner && script.id !== scope.owner.scriptId) continue;
    walkSteps(script.steps, (step) => { if (step.id === id && step.kind === "fetch") matches.push(step); });
  }
  // 同じ所有範囲にも壊れた重複IDがあれば、別ブロックを推測で更新しない。
  return matches.length === 1 ? matches[0] : undefined;
}

/** 送信の所有者は文書セッション。ブロック・小窓のmount状態には依存しない。 */
export function useRefetch(step: FetchStep, suppliedScope?: FetchPreviewScope) {
  const { pageId, scriptRootIds = [] } = useContext(Ctx);
  const nodeId = useContext(ScriptNodeCtx);
  const scriptOwner = useContext(ScriptOwnerCtx);
  const scope = suppliedScope ?? { nodeId, localNames: [], ...(scriptOwner ? { owner: scriptOwner } : {}) };
  const session = useEditor.getState().documentSession;
  const owner = ownerKey(step.id, pageId, scope);
  const error = useSyncExternalStore(subscribeRequests, () => requestErrors.get(owner), () => undefined);
  const submitted = useSyncExternalStore(subscribeRequests, () => submittedRequests.get(owner), () => undefined);
  const resultSource = useSyncExternalStore(subscribeRequests, () => resultRequests.get(owner), () => undefined);
  const currentKey = requestKey(step.url, step);
  const attempted = useSyncExternalStore(subscribeRequests,
    () => attemptedRequests.get(owner) === currentKey, () => false);
  const busy = useSyncExternalStore(subscribeRequests,
    () => pendingRefetches.get(owner)?.has(currentKey) ?? false, () => false);
  const run = async (url = step.url, options: FetchOptions = step, vars: Vars = {}) => {
    const key = requestKey(url, options);
    const source = currentFetch(useEditor.getState().doc, pageId, step.id, scope, scriptRootIds);
    if (!url.trim() || pendingRefetches.get(owner)?.has(key) || useEditor.getState().documentSession !== session ||
      !source || requestKey(source.url, source) !== key) return false;
    const token = Symbol();
    activeRefetches.set(owner, token);
    const pending = pendingRefetches.get(owner) ?? new Map<string, symbol>();
    pending.set(key, token);
    pendingRefetches.set(owner, pending);
    attemptedRequests.set(owner, key);
    submittedRequests.set(owner, { key, method: options.method ?? "GET", url: interpolateUrl(url, vars) });
    requestErrors.delete(owner);
    notifyRequests();
    let valid = !!currentFetch(useEditor.getState().doc, pageId, step.id, scope, scriptRootIds);
    const unsubscribe = useEditor.subscribe((state) => {
      if (state.documentSession !== session || !currentFetch(state.doc, pageId, step.id, scope, scriptRootIds)) valid = false;
    });
    const isCurrent = () => valid && useEditor.getState().documentSession === session && activeRefetches.get(owner) === token;
    try {
      const whole = await fetchWhole(url.trim(), options, vars);
      const { sample, totals } = makeSample(whole);
      if (!isCurrent()) return false;
      let saved = false;
      useEditor.getState().updateDoc((doc) => {
        const current = currentFetch(doc, pageId, step.id, scope, scriptRootIds);
        if (!isCurrent() || !current || requestKey(current.url, current) !== key) return;
        current.preview = {
          sample, totals, fetchedAt: Math.max(Date.now(), (current.preview?.fetchedAt ?? 0) + 1),
        };
        wholeCache.set(wholeKey(current, pageId, session, scope), whole);
        resultRequests.set(owner, { method: options.method ?? "GET", url: interpolateUrl(url, vars), fetchedAt: current.preview.fetchedAt! });
        saved = true;
      });
      return saved;
    } catch (e) {
      if (!isCurrent()) return false;
      const msg = userMessage(e, tr("Couldn't load"));
      requestErrors.set(owner, { key, message: msg.includes(tr("Couldn't parse it as JSON"))
        ? tr("Couldn't read the data. Make sure the URL returns JSON, not a web page") : msg });
      return false;
    } finally {
      unsubscribe();
      if (!valid && useEditor.getState().documentSession === session && activeRefetches.get(owner) === token) {
        requestErrors.set(owner, { key, message: tr("The request was sent, but its result was not applied because the document changed") });
      }
      if (pending.get(key) === token) pending.delete(key);
      if (!pending.size) pendingRefetches.delete(owner);
      if (activeRefetches.get(owner) === token) activeRefetches.delete(owner);
      notifyRequests();
    }
  };
  return { busy, attempted, resultSource: resultSource?.fetchedAt === step.preview?.fetchedAt ? resultSource : undefined, submitted: submitted?.key === currentKey ? submitted : undefined,
    error: error?.key === currentKey ? error.message : null, run };
}

/** 一時入力と送信に使う見本を、文書・ブロック・リクエスト・文脈ごとに共有する。 */
function useFetchValues(step: FetchStep, scope: FetchPreviewScope) {
  const { doc, pageId, readOnly } = useContext(Ctx);
  const owner = ownerKey(step.id, pageId, scope);
  const key = fetchTestKey(step, scope);
  const snapshot = useSyncExternalStore(subscribeRequests,
    () => temporaryValues.get(owner)?.key === key ? temporaryValues.get(owner) : undefined, () => undefined);
  useEffect(() => {
    if (!readOnly && temporaryValues.has(owner) && temporaryValues.get(owner)?.key !== key) {
      temporaryValues.delete(owner); notifyRequests();
    }
  }, [owner, key, readOnly]);
  const values = snapshot?.values ?? EMPTY_VALUES;
  const samples = variableChoiceSamples(varGroupsAt(doc, pageId, scope.nodeId), scope.localNames);
  const inputs = fetchPreviewInputs(step.url, step, samples);
  const vars: Vars = { ...samples };
  // 一時入力は今も未解決の項目だけに使う。入力欄が消えた値は最新の見本に従う。
  for (const input of inputs) {
    if (input.missing && Object.hasOwn(values, input.name)) vars[input.name] = values[input.name];
  }
  const missing = fetchPreviewInputs(step.url, step, vars).some((input) => input.missing);
  const invalid = sendsBody(step.method) && bodyJsonError(step.body);
  return { inputs, values, samples, vars, missing, invalid,
    prepare: () => vars,
    setValue: (name: string, value: string) => {
      if (readOnly) return;
      temporaryValues.set(owner, { key, values: { ...values, [name]: value } }); notifyRequests();
    } };
}

function FetchValues({ state, busy }: { state: ReturnType<typeof useFetchValues>; busy: boolean }) {
  const { inputs, values, setValue } = state;
  return <>
    {inputs.filter((input) => input.missing).map((input) => <label key={input.name} className="se-fetch-test-value">
      <code>{`{${input.name}}`}</code>
      <input className="se-in" aria-label={tr("Test value for {name}", { name: input.name })}
        placeholder={tr("Test value")} disabled={busy} value={values[input.name] ?? ""}
        onChange={(e) => setValue(input.name, e.target.value)} />
      {!Object.hasOwn(values, input.name) && <button type="button" className="se-mini se-mini-text"
        onClick={() => setValue(input.name, "")}>{tr("Use an empty value")}</button>}
    </label>)}
    {inputs.some((input) => input.missing) && <p className="hint">{tr("Test values are not saved")}</p>}
    {state.invalid && <p className="se-badge is-warn">{tr("Not valid JSON")}</p>}
  </>;
}

/** 開くだけでは送らない。右上の更新ボタンだけが明示的な送信操作。 */
export function FetchResult({ step, scope, onClose }: { step: FetchStep; scope: FetchPreviewScope; onClose: () => void }) {
  const { busy, error, submitted, resultSource, run } = useRefetch(step, scope);
  const state = useFetchValues(step, scope);
  const composing = useRef(false);
  const blockedClick = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input, button:not(:disabled)")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const key = wholeKey(step, useContext(Ctx).pageId, undefined, scope);
  const full = wholeCache.has(key);
  const truncatedSample = Object.keys(step.preview?.totals ?? {}).length > 0;
  const method = step.method ?? "GET";
  const destination = state.missing ? step.url : interpolateUrl(step.url, state.vars);
  return <div ref={dialogRef} className="se-modal se-fetch-test" role="dialog" aria-modal="true"
    aria-label={tr("Fetched data")} data-se-popover=""
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), summary") ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="se-modal-head">
      <h3>{tr("Fetched data")}</h3>
      <button type="button" className="se-close" aria-label={tr("Fetch again")}
        title={`${method} ${destination}`} disabled={busy || state.missing || state.invalid || !step.url.trim()}
        onPointerDown={(e) => {
          blockedClick.current = composing.current;
          if (blockedClick.current) e.preventDefault();
        }}
        onClick={() => {
          if (composing.current || blockedClick.current) { blockedClick.current = false; return; }
          void run(step.url, step, state.prepare());
        }}><RefreshCw size={15} /></button>
      <button type="button" className="se-close" onClick={onClose} aria-label={tr("Close")}><X size={16} /></button>
    </div>
    <div className="se-fetch-destination"><b>{method}</b><span>{destination}</span><small>{tr("Destination for current settings")}</small></div>
    {submitted && (submitted.url !== destination || submitted.method !== method) && (!resultSource || submitted.url !== resultSource.url || submitted.method !== resultSource.method) && <p className="hint se-fetch-submitted">{tr("Last request")}: {submitted.method} {submitted.url}</p>}
    <FetchValues state={state} busy={busy} />
    {!state.missing && (step.headers?.length || sendsBody(step.method) && step.body) ? <details className="se-fetch-payload">
      <summary>{tr("Request contents")}</summary><pre>{JSON.stringify(fetchRequestOf(step, state.vars), null, 2)}</pre>
    </details> : null}
    {method !== "GET" && <p className="se-badge is-warn">{tr("This request may change data at the destination")}</p>}
    {busy && <p role="status">{tr("Sending…")}</p>}
    {error && <p className="se-badge is-warn" role="alert">{error}</p>}
    {step.preview?.sample !== undefined && <>
      {resultSource && (resultSource.url !== destination || resultSource.method !== method) && <p className="hint se-fetch-result-source">{tr("Result request destination")}: {resultSource.method} {resultSource.url}</p>}
      {!hasCurrentSample(step) && <p className="se-badge is-warn">{tr("This sample has not been verified with the current settings.")}</p>}
      {!full && <p className="hint">{truncatedSample
        ? tr("Only the first 20 items of each list are saved in the sample. To view all items, use Fetch again in the top-right corner.")
        : tr("Showing the saved sample.")}</p>}
      <JsonPeek value={full ? wholeCache.get(key) : step.preview?.sample} />
    </>}
  </div>;
}

/** 取得ブロックの「リクエストの設定」（メソッド・ヘッダー・送る本文） */
function FetchOptionsPanel({ step, onChange }: { step: FetchStep; onChange: (patch: FetchOptions) => void }) {
  const headers = step.headers ?? [];
  const method = step.method ?? "GET";
  const setHeader = (i: number, patch: Partial<FetchHeader>) =>
    onChange({ headers: headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const bodyError = sendsBody(method) && bodyJsonError(step.body);
  return (
    <div className="se-fetch-opts">
      <div className="se-fetch-row">
        <span className="se-fetch-label">{tr("Method")}</span>
        <select
          className="se-in"
          value={method}
          onChange={(e) => onChange({ method: e.target.value === "GET" ? undefined : (e.target.value as FetchMethod) })}
        >
          {FETCH_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="se-fetch-row is-top">
        <span className="se-fetch-label">{tr("Header")}</span>
        <div className="se-fetch-list">
          {headers.map((h, i) => (
            <div key={i} className="se-fetch-header">
              <TextIn
                value={h.name}
                placeholder={tr("Name")}
                width={130}
                onCommit={(v) => setHeader(i, { name: v.trim() })}
              />
              <TextIn
                value={h.value}
                placeholder={tr("value / {variable}")}
                vars
                width={150}
                onCommit={(v) => setHeader(i, { value: v })}
              />
              <button
                type="button"
                className="se-mini"
                data-tip={tr("Remove this header")}
                onClick={() => onChange({ headers: headers.filter((_, j) => j !== i) })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="se-mini se-mini-text"
            onClick={() => onChange({ headers: [...headers, { name: "", value: "" }] })}
          >
            <Plus size={12} />
            {tr("Add header")}
          </button>
        </div>
      </div>
      {sendsBody(method) && (
        <div className="se-fetch-row is-top">
          <span className="se-fetch-label">{tr("JSON body")}</span>
          <div className="se-fetch-list">
            <textarea
              key={step.body ?? ""}
              className={`se-in se-fetch-body${bodyError ? " is-error" : ""}`}
              defaultValue={step.body ?? ""}
              placeholder={'{\n  "keyword": "{q}"\n}'}
              rows={4}
              spellCheck={false}
              onBlur={(e) => {
                if (e.target.value !== (step.body ?? "")) onChange({ body: e.target.value || undefined });
              }}
            />
            {bodyError && <span className="se-badge is-warn">{tr("Not valid JSON")}</span>}
          </div>
        </div>
      )}
      <p className="se-fetch-hint">
        {tr("Headers and the body are sent from the published site's server. The values are included in the published project's code, so keep the repository private if you put secret keys here.")}
      </p>
    </div>
  );
}

/** 「［URL］のデータを取得して［名前］とする」 */
export function FetchBody({ step }: { step: FetchStep }) {
  const { doc, pageId, updateStep, renameVar, openPeek } = useContext(Ctx);
  const scriptOwner = useContext(ScriptOwnerCtx);
  const scope = { ...fetchPreviewScope(useContext(ScriptNodeCtx), useContext(LoopCtx)), ...(scriptOwner ? { owner: scriptOwner } : {}) };
  const { busy, attempted, run } = useRefetch(step, scope);
  const hasResult = hasCurrentSample(step) || attempted;
  const values = useFetchValues(step, scope);
  const composing = useRef(false);
  const blockedClick = useRef(false);
  const customized = !!(step.method && step.method !== "GET") || !!step.headers?.length;
  const [open, setOpen] = useState(false);
  const setOptions = (patch: FetchOptions) => {
    updateStep(step.id, (s) => s.kind === "fetch" ? changeFetchRequest(s, patch, pageId, scope) : s);
  };
  return (
    <span className="se-fetch-controls" style={{ display: "contents" }}
      onCompositionStartCapture={() => { composing.current = true; }}
      onCompositionEndCapture={() => { composing.current = false; }}>
      <Phrase
        text="{url}のデータを取得して{as}とする"
        parts={{
          url: (
            <TextIn
              value={step.url}
              placeholder={tr("https://~ (variables like {slug} work too)")}
              vars
              width={240}
              onCommit={(v) => {
                const url = v.trim();
                updateStep(step.id, (s) => s.kind === "fetch" ? changeFetchRequest(s, { url }, pageId, scope) : s);
                // 名前が空なら付けておく
                if (url && !step.as) renameVar(step.id, "", uniqueVarName(doc, pageId, trc("variable_name", "data"), step.id));
              }}
            />
          ),
          as: <VarNameIn stepId={step.id} value={step.as ?? ""} placeholder={tr("Name")} />,
        }}
      />
      <button type="button" className="se-mini se-mini-text"
        title={`${step.method ?? "GET"} ${values.missing ? step.url : interpolateUrl(step.url, values.vars)}`}
        disabled={!step.url.trim() || (!hasResult && !busy && (values.missing || values.invalid))}
        onPointerDown={(e) => {
          blockedClick.current = composing.current;
          // blur で設定が変わっても、「見る」を押し始めた操作を無効化・送信に変えない。
          if (blockedClick.current || ((hasResult || busy) && e.button === 0)) e.preventDefault();
        }}
        onClick={() => {
          if (composing.current || blockedClick.current) { blockedClick.current = false; return; }
          if (hasResult || busy) (document.activeElement as HTMLElement | null)?.blur?.();
          openPeek(step.id, scope);
          if (!hasResult && !busy) void run(step.url, step, values.prepare());
        }}>
        {hasResult ? <Table2 size={12} /> : <Play size={12} />}
        {busy ? tr("Sending…") : hasResult ? tr("View data") : tr("Fetch data")}
      </button>
      <button
        type="button"
        className={`se-mini se-mini-text${open ? " is-on" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={12} />
        {customized ? tr("Request settings ({method})", { method: step.method ?? "GET" }) : tr("Request settings")}
      </button>
      {!hasResult && <FetchValues state={values} busy={busy} />}
      {step.method && step.method !== "GET" && <span className="se-badge is-warn">{tr("This request may change data at the destination")}</span>}
      {open && (
        <>
          <span className="se-br" />
          <FetchOptionsPanel step={step} onChange={setOptions} />
        </>
      )}
    </span>
  );
}

interface PathOption {
  key: string;
  label: string;
  value: unknown;
}

/** 位置の1段分の選択肢（オブジェクトは項目名、リストは「〇番目」と「最後」） */
function childOptions(value: unknown): PathOption[] {
  if (Array.isArray(value)) {
    const out: PathOption[] = value
      .slice(0, 20)
      .map((v, i) => ({ key: String(i), label: tr("#{p1}", { p1: i + 1 }), value: v }));
    if (value.length > 1) {
      out.push({ key: "-1", label: tr("Last"), value: value[value.length - 1] });
    }
    return out;
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([k, v]) => ({ key: k, label: k, value: v }));
  }
  return [];
}

/** 中身の分からないリスト（画面を開いてから値が決まるもの）の位置の選択肢 */
const UNKNOWN_ITEMS: PathOption[] = [
  ...[0, 1, 2, 3, 4].map((i) => ({ key: String(i), label: tr("#{p1}", { p1: i + 1 }), value: undefined })),
  { key: "-1", label: tr("Last"), value: undefined },
];

export const isNested = (v: unknown) => v != null && typeof v === "object";

/**
 * 「取得したデータの［…］」「リストの［…］」の位置を選ぶメニュー。
 * 項目を選ぶと決まり、「›」で中の項目へ進む。
 * mode: any = どこでも / list = リスト（リスト）だけ / item = リストの何番目か（とその中）/
 *       field = 1件の中の項目（入れ子も可。比べられる値＝文字・数値と、文字や数値のリストだけ選べる）
 */
export function PathMenu({
  root,
  path,
  onChange,
  mode,
  placeholder,
  ariaLabel,
  allowRoot = true,
  portalZIndex,
  excludeRootKey,
}: {
  /** 選べる値の見本（undefined = 見本が無い） */
  root: unknown;
  path: string;
  onChange: (path: string) => void;
  mode: "any" | "list" | "item" | "field";
  /** Optional source-picker customization; existing callers retain prior behavior. */
  placeholder?: string;
  ariaLabel?: string;
  allowRoot?: boolean;
  portalZIndex?: number;
  /** Hide the current transform block\'s unpublished output at the root. */
  excludeRootKey?: string;
}) {
  const [open, setOpen] = useState(false);
  /** 開いている階層の位置 */
  const [at, setAt] = useState("");
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A click can trigger programmatic scrolling of the canvas or focused
    // block. Only close for user scrolling outside the menu, not scroll
    // events emitted while a picker is opening.
    const onUserScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", onUserScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onUserScroll, true);
      window.removeEventListener("touchmove", onUserScroll, true);
    };
  }, [open]);

  // 見本が無ければ位置を文字で入力する（リストの何番目かは選べる）
  if (root === undefined && mode !== "item") {
    return (
      <TextIn
        value={path}
        placeholder={
          mode === "list"
            ? tr("List path")
            : mode === "field"
              ? tr("Field name")
              : tr("Position")
        }
        width={120}
        onCommit={(v) => onChange(v.trim())}
      />
    );
  }

  const known = root !== undefined;
  // Building child options (often thousands of script variables) is only
  // necessary for an open menu, not every closed dropdown on initial render.
  const levelValue = open ? (at ? digPath(root, at) : root) : undefined;
  const rows = !open ? [] : (!known ? (at ? [] : UNKNOWN_ITEMS) : childOptions(levelValue))
    .filter((option) => at || option.key !== excludeRootKey);
  const join = (key: string) => (at ? `${at}.${key}` : key);
  /** 文字・数値だけのリスト（比べるときは「,」でつないだ文字になる） */
  const primitiveList = (v: unknown) =>
    Array.isArray(v) && v.every((x) => x == null || typeof x !== "object");
  const canPick = (v: unknown) =>
    mode === "list" ? Array.isArray(v) : mode === "field" ? !isNested(v) || primitiveList(v) : true;
  const canEnter = (v: unknown) =>
    isNested(v) &&
    !(mode === "list" && Array.isArray(v)) &&
    !(mode === "field" && primitiveList(v));
  const empty = !path && mode !== "any";
  const label = path
    ? fieldLabel(path)
    : placeholder ?? (mode === "list"
      ? tr("Select a list", "select_a_list_variant_1")
      : mode === "item"
        ? tr("Select a path")
        : mode === "field"
          ? tr("Select a field")
          : tr("Everything"));

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos(anchoredMenuPos(r, 260, 320));
    // 選んである位置の階層から開く
    const segs = path ? path.split(".") : [];
    setAt(known ? segs.slice(0, -1).join(".") : "");
    setOpen(true);
  };
  const pick = (p: string) => {
    setOpen(false);
    if (p !== path) onChange(p);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`se-in se-pm-btn${empty ? " is-empty" : ""}${open ? " is-open" : ""}`}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{label}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="dd-menu se-pm"
            style={portalZIndex === undefined ? pos : { ...pos, zIndex: portalZIndex }}
            data-se-popover=""
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
            }}
          >
            {at && (
              <div className="se-pm-head">
                <button
                  type="button"
                  className="se-pm-back"
                  aria-label={tr("Up one level")}
                  onClick={() => setAt(at.split(".").slice(0, -1).join("."))}
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="se-pm-crumb">{fieldLabel(at)}</span>
              </div>
            )}
            {/* 今の階層そのものを選ぶ */}
            {known && (at ? canPick(levelValue) : mode === "any" && allowRoot) && (
              <button
                type="button"
                className={`dd-item${path === at ? " is-sel" : ""}`}
                onClick={() => pick(at)}
              >
                <span className="se-pm-key">{at ? tr("All of this") : tr("Everything")}</span>
                <span className="se-pm-val">{readableValue(levelValue)}</span>
              </button>
            )}
            {rows.map((o) => {
              const full = join(o.key);
              const pickable = !known || canPick(o.value);
              const enter = known && canEnter(o.value);
              return (
                <div key={o.key} className="se-pm-row">
                  <button
                    type="button"
                    className={`dd-item${path === full ? " is-sel" : ""}`}
                    disabled={!pickable}
                    onClick={() => (pickable ? pick(full) : enter && setAt(full))}
                  >
                    <span className="se-pm-key">{o.label}</span>
                    {known && <span className="se-pm-val">{readableValue(o.value)}</span>}
                  </button>
                  {enter && (
                    <button
                      type="button"
                      className="se-pm-enter"
                      aria-label={tr("Look inside {label}", { label: o.label })}
                      onClick={() => setAt(full)}
                    >
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            {known && !rows.length && <div className="se-pm-none">{tr("No fields inside")}</div>}
            {mode === "list" && known && !at && !findsList(root) && (
              <div className="se-pm-none">{tr("No list found")}</div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** 中にリスト（リスト）があるか */
function findsList(value: unknown, depth = 0): boolean {
  if (Array.isArray(value)) return true;
  if (!isNested(value) || depth > 4) return false;
  return Object.values(value as object).some((v) => findsList(v, depth + 1));
}

/** 上書きできない変数名（ページのURLの slug、リストの各要素の 値） */
export const RESERVED_VARS = new Set(["slug", ITEM_VALUE, "ループ"]);

/** 変数名の入力（同じ名前ならその変数を上書きする。名前を変えると、使っている箇所も書き換える） */
export function VarNameIn({
  stepId,
  value,
  placeholder = tr("Name"),
}: {
  stepId: string;
  value: string;
  placeholder?: string;
}) {
  const { doc, pageId, renameVar, readOnly, variableIndex } = useContext(Ctx);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // The workspace supplies one shared producer index for every variable name
  // block. In independent previews or tests, retain the usual scan fallback.
  const others = variableIndex || readOnly ? null : dataVarNames(doc, pageId, stepId);
  const hasOther = (name: string) =>
    variableIndex ? variableIndex.hasOther(name, stepId) : (others?.has(name) ?? false);
  const overwrite = !!value && hasOther(value) && !RESERVED_VARS.has(value);
  // Sorting thousands of choices in every closed input made opening a large
  // script workspace quadratic. Compute suggestions only while editing.
  const names = open ? (variableIndex ? variableIndex.names : [...(others ?? [])])
    .filter((name) => !RESERVED_VARS.has(name) && hasOther(name))
    .sort((a, b) => a.localeCompare(b, getLang())) : [];
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setText(value), [value]);
  const q = text.trim().toLowerCase();
  const matches = names.filter((n) => n !== text.trim() && (!q || n.toLowerCase().includes(q))).slice(0, 8);

  const commit = (v: string) => {
    const name = cleanVarName(v.trim());
    if (!name || name === value) {
      setText(value);
      return;
    }
    // slug・値 は特別な意味があるため上書きしない
    const next = RESERVED_VARS.has(name) ? uniqueVarName(doc, pageId, name, stepId) : name;
    // 元の名前をほかのブロックも作っているなら、使っている箇所は書き換えない
    renameVar(stepId, hasOther(value) ? "" : value, next);
  };
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(anchoredMenuPos(r, 220, 260));
  };

  useEffect(() => {
    if (!open || !matches.length) return;
    const dismissOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const reposition = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      const input = ref.current;
      if (!input || document.activeElement !== input || !varSuggestionAnchorVisible(input)) {
        setOpen(false);
        return;
      }
      setPos(anchoredMenuPos(input.getBoundingClientRect(), 220, 260));
    };
    const loseWindowFocus = () => setOpen(false);
    window.addEventListener("pointerdown", dismissOutside, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("blur", loseWindowFocus);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("blur", loseWindowFocus);
    };
  }, [open, matches.length]);

  if (readOnly) {
    return (
      <span className={`se-in se-in-fake${value ? "" : " is-empty"}`} style={{ width: 96 }}>
        {value || placeholder}
      </span>
    );
  }
  return (
    <>
      <input
        ref={ref}
        className={`se-in${value ? "" : " is-empty"}`}
        style={{ width: 96 }}
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          place();
          setIndex(0);
          setOpen(true);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setIndex(0);
          place();
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          if (text !== value) commit(text);
        }}
        onKeyDown={(e) => {
          if (open && matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const n = matches.length;
            setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
          } else if (isEnterKey(e)) {
            e.preventDefault();
            if (open && matches[index]) {
              setText(matches[index]);
              setOpen(false);
              commit(matches[index]);
            } else (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open &&
        matches.length > 0 &&
        createPortal(
          <div ref={menuRef} className="dd-menu var-comp" style={pos} data-se-popover="" onMouseDown={(e) => e.preventDefault()}>
            <div className="var-comp-head">{tr("Overwrite an existing variable")}</div>
            <div className="var-comp-list">
              {matches.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={`dd-item${i === index ? " is-sel-key" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    setText(name);
                    setOpen(false);
                    commit(name);
                  }}
                >
                  <span className="dd-col">{name}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
      {overwrite && (
        <span
          className="se-badge"
          data-tip={tr("Another block uses the same variable name. Whichever block runs last wins")}
        >
          {tr("Overwrites")}
        </span>
      )}
    </>
  );
}

/** 位置から変数名の候補を作る（最後の項目名。番号だけなら「データ」） */
export function nameFromPath(path: string): string {
  const seg = path
    .split(".")
    .reverse()
    .find((x) => x && !/^-?\d+$/.test(x));
  return seg ?? tr("Data");
}
