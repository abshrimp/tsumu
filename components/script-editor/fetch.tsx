"use client";

/**
 * データの取得ブロックと、取得したデータの項目・変数名の選び方
 */

import { isEnterKey } from "../../lib/keys";
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Play, Plus, SlidersHorizontal, Table2, X } from "lucide-react";
import { readableValue } from "../DataView";
import { anchoredMenuPos } from "../controls";
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
import { type FetchHeader, type FetchMethod, type ScriptStep } from "../../lib/types";
import { userMessage } from "../../lib/errors";
import { getLang, tr, trc } from "../../lib/i18n";
import { Ctx, LoopCtx, ScriptNodeCtx, type FetchPreviewScope } from "./context";
import { Phrase, TextIn } from "./inputs";

/** テスト実行で明示的に送る。未解決の値を空文字や仮の slug に置き換えない。 */
export async function fetchWhole(url: string, options: FetchOptions = {}, vars: Vars = {}): Promise<unknown> {
  if (fetchPreviewInputs(url, options, vars).some((input) => input.missing)) {
    throw new Error(tr("テスト用の値を入力してください"));
  }
  const resolved = interpolateUrl(url, vars);
  const res = await fetch("/api/fetch-json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: resolved, ...fetchRequestOf(options, vars) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? tr("読み込めませんでした（{status}）", { status: res.status }));
  return data.json;
}

/** 「データを見る」で取得した全件（取得ブロックの設定ごと。エディタを開いている間だけ覚えておく） */
export const wholeCache = new Map<string, unknown>();
export const wholeKey = (st: FetchStep) => JSON.stringify([st.id, st.url, st.method, st.headers, st.body, st.fetchedAt]);

/** 見本を取得したリクエストと、保存先の現在の設定を比べる（見本の更新時刻は除く） */
const requestKey = (url: string, options: FetchOptions) =>
  JSON.stringify([url.trim(), options.method ?? "GET", options.headers ?? [], options.body ?? ""]);
export const fetchTestKey = (step: FetchStep, scope: FetchPreviewScope) =>
  JSON.stringify([requestKey(step.url, step), scope]);

/** 葉のパスだけでなく、空のまとまり・一覧を含むローカルな名前全体を保つ。 */
export function fetchPreviewScope(nodeId: string, loops: readonly { fields: string[]; roots?: string[] }[]): FetchPreviewScope {
  return { nodeId, localNames: localVariableNames(loops.flatMap((loop) => [...(loop.roots ?? []), ...loop.fields])) };
}

/** 画面を閉じても、送信済みの同じ要求を重ねて送らない。別設定の応答は最新だけを採用する。 */
const activeRefetches = new Map<string, symbol>();
const pendingRefetches = new Map<string, Map<string, symbol>>();
const requestListeners = new Set<() => void>();
const subscribeRequests = (listener: () => void) => {
  requestListeners.add(listener);
  return () => { requestListeners.delete(listener); };
};
const notifyRequests = () => requestListeners.forEach((listener) => listener());

/** 「取得する」ブロックの見本を取り直す（成功するとブロックに保存する） */
export function useRefetch(step: FetchStep, cancelOnUnmount = false) {
  const { updateStep } = useContext(Ctx);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const request = useRef<symbol | null>(null);
  useEffect(() => {
    if (cancelOnUnmount) return () => {
      if (activeRefetches.get(step.id) === request.current) activeRefetches.delete(step.id);
      request.current = null;
      // 送信は取り消せない。応答が返るまで pending は残し、開き直した画面でも重複を防ぐ。
    };
  }, [cancelOnUnmount, step.id]);
  const currentKey = requestKey(step.url, step);
  const busy = useSyncExternalStore(subscribeRequests,
    () => pendingRefetches.get(step.id)?.has(currentKey) ?? false, () => false);
  const run = async (url = step.url, options: FetchOptions = step, vars: Vars = {}) => {
    const key = requestKey(url, options);
    if (!url.trim() || pendingRefetches.get(step.id)?.has(key)) return false;
    const token = Symbol();
    request.current = token;
    activeRefetches.set(step.id, token);
    const pending = pendingRefetches.get(step.id) ?? new Map<string, symbol>();
    pending.set(key, token);
    pendingRefetches.set(step.id, pending);
    notifyRequests();
    const isCurrent = () => request.current === token && activeRefetches.get(step.id) === token;
    setError(null);
    try {
      const whole = await fetchWhole(url.trim(), options, vars);
      const { sample, totals } = makeSample(whole);
      // 後から始めた取得の結果・エラーを、古い応答で戻さない。
      if (!isCurrent()) return false;
      updateStep(step.id, (s) => {
        // Undo や別の場所での設定変更にも、取得元の違う見本を保存しない。
        if (s.kind !== "fetch" || requestKey(s.url, s) !== key) return s;
        const next = { ...s, sample, sampleTotals: totals, fetchedAt: Math.max(Date.now(), (s.fetchedAt ?? 0) + 1) };
        wholeCache.set(wholeKey(next), whole);
        return next;
      });
      return true;
    } catch (e) {
      if (!isCurrent()) return false;
      const msg = userMessage(e, tr("読み込めませんでした"));
      setError({ key, message: msg.includes(tr("JSONとして読み取れませんでした"))
        ? tr("データを読み取れませんでした。WebページではなくJSONを返すURLか確認してください") : msg });
      return false;
    } finally {
      if (pending.get(key) === token) pending.delete(key);
      if (!pending.size) pendingRefetches.delete(step.id);
      if (activeRefetches.get(step.id) === token) activeRefetches.delete(step.id);
      notifyRequests();
    }
  };
  return { busy, error: error?.key === currentKey ? error.message : null, run };
}

/** 設定と送信を分けたテスト画面。入力値は文書に保存しない。 */
export function FetchTest({ step, scope, onClose }: { step: FetchStep; scope: FetchPreviewScope; onClose: () => void }) {
  const { doc, pageId } = useContext(Ctx);
  const { busy, error, run } = useRefetch(step, true);
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [samples] = useState<Vars>(() => {
    // ローカルな親の名前も覆い、同名のページのまとまりや dotted key を送らない。
    return variableChoiceSamples(varGroupsAt(doc, pageId, scope.nodeId), scope.localNames);
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const inputs = fetchPreviewInputs(step.url, step, samples);
  const vars = { ...samples, ...testValues };
  const missing = fetchPreviewInputs(step.url, step, vars).some((input) => input.missing);
  const invalid = sendsBody(step.method) && bodyJsonError(step.body);
  const method = step.method ?? "GET";
  return createPortal(
    <div className="modal-backdrop" data-se-popover=""
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
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
      <div ref={dialogRef} className="modal se-fetch-test" role="dialog" aria-modal="true" aria-label={tr("取得のテスト")}>
        <div className="se-modal-head">
          <h3>{tr("取得のテスト")}</h3>
          <button type="button" className="se-close" onClick={onClose} aria-label={tr("閉じる")}><X size={16} /></button>
        </div>
        <div className="se-fetch-destination"><b>{method}</b><span>{missing ? step.url : interpolateUrl(step.url, vars)}</span></div>
        {inputs.map((input) => <label key={input.name} className="se-fetch-test-value">
          <code>{`{${input.name}}`}</code>
          {input.missing ? <input className="se-in" aria-label={tr("{name} のテスト用の値", { name: input.name })}
            placeholder={tr("テスト用の値")} disabled={busy} value={testValues[input.name] ?? ""}
            onChange={(e) => { setTestValues((v) => ({ ...v, [input.name]: e.target.value })); setDone(false); }} />
            : <span>{readableValue(input.value)}</span>}
          {input.missing && !Object.hasOwn(testValues, input.name) && <button type="button" className="se-mini se-mini-text"
            onClick={() => setTestValues((v) => ({ ...v, [input.name]: "" }))}>{tr("空の値を使う")}</button>}
        </label>)}
        {inputs.some((input) => input.missing) && <p className="hint">{tr("テスト用の値は保存されません")}</p>}
        {!missing && (step.headers?.length || sendsBody(step.method) && step.body) ? <details className="se-fetch-payload">
          <summary>{tr("送る内容")}</summary><pre>{JSON.stringify(fetchRequestOf(step, vars), null, 2)}</pre>
        </details> : null}
        {method !== "GET" && <p className="se-badge is-warn">{tr("この送信は接続先のデータを変更する場合があります")}</p>}
        {invalid && <p className="se-badge is-warn">{tr("JSONとして読み取れません")}</p>}
        {error && <p className="se-badge is-warn" role="alert">{error}</p>}
        {done && <p role="status">{tr("取得しました")}</p>}
        <div className="se-fetch-test-actions">
          <button type="button" className="btn" onClick={onClose}>{tr("閉じる")}</button>
          <button type="button" className="btn btn-primary" disabled={busy || missing || invalid || !step.url.trim()}
            onClick={async () => { setDone(false); if (await run(step.url, step, vars)) setDone(true); }}>
            {busy ? tr("送信中…") : tr("{method}で送信", { method })}
          </button>
        </div>
      </div>
    </div>, document.body);
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
        <span className="se-fetch-label">{tr("メソッド")}</span>
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
        <span className="se-fetch-label">{tr("ヘッダー")}</span>
        <div className="se-fetch-list">
          {headers.map((h, i) => (
            <div key={i} className="se-fetch-header">
              <TextIn
                value={h.name}
                placeholder={tr("名前（例: Authorization）")}
                width={130}
                onCommit={(v) => setHeader(i, { name: v.trim() })}
              />
              <TextIn
                value={h.value}
                placeholder={tr("値 / {変数}")}
                vars
                width={150}
                onCommit={(v) => setHeader(i, { value: v })}
              />
              <button
                type="button"
                className="se-mini"
                data-tip={tr("このヘッダーを削除")}
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
            {tr("ヘッダーを追加")}
          </button>
        </div>
      </div>
      {sendsBody(method) && (
        <div className="se-fetch-row is-top">
          <span className="se-fetch-label">{tr("送るJSON")}</span>
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
            {bodyError && <span className="se-badge is-warn">{tr("JSONとして読み取れません")}</span>}
          </div>
        </div>
      )}
      <p className="se-fetch-hint">
        {tr("ヘッダーと本文は、公開したサイトのサーバーで送ります。値は公開するプロジェクトのコードに含まれるため、秘密のキーを入れるときはリポジトリを非公開にしてください。")}
      </p>
    </div>
  );
}

/** 「［URL］のデータを取得して［名前］とする」 */
export function FetchBody({ step }: { step: FetchStep }) {
  const { doc, pageId, updateStep, renameVar, openPeek } = useContext(Ctx);
  const scope = fetchPreviewScope(useContext(ScriptNodeCtx), useContext(LoopCtx));
  const { busy } = useRefetch(step);
  const [testOpen, setTestOpen] = useState(false);
  const customized = !!(step.method && step.method !== "GET") || !!step.headers?.length;
  const [open, setOpen] = useState(false);
  const setOptions = (patch: FetchOptions) => {
    const next = { ...step, ...patch } as FetchStep;
    updateStep(step.id, () => next);
  };
  return (
    <>
      <Phrase
        text="{url}のデータを取得して{as}とする"
        parts={{
          url: (
            <TextIn
              value={step.url}
              placeholder={tr("https://~（{slug} などの変数も使えます）")}
              vars
              width={240}
              onCommit={(v) => {
                const url = v.trim();
                updateStep(step.id, (s) => ({ ...s, url }) as ScriptStep);
                // 名前が空なら付けておく
                if (url && !step.as) renameVar(step.id, "", uniqueVarName(doc, pageId, trc("変数名", "データ"), step.id));
              }}
            />
          ),
          as: <VarNameIn stepId={step.id} value={step.as ?? ""} placeholder={tr("名前（例: 商品データ）")} />,
        }}
      />
      <button type="button" className="se-mini se-mini-text" onClick={() => setTestOpen(true)} disabled={!step.url.trim()}>
        <Play size={12} />{busy ? tr("送信中…") : tr("テスト実行…")}
      </button>
      {step.sample !== undefined ? (
        <button
          type="button"
          className="se-mini se-mini-text"
          onClick={() => openPeek(step.id, scope)}
        >
          <Table2 size={12} />
          {tr("データを見る")}
        </button>
      ) : null}
      <button
        type="button"
        className={`se-mini se-mini-text${open ? " is-on" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={12} />
        {customized ? tr("リクエストの設定（{method}）", { method: step.method ?? "GET" }) : tr("リクエストの設定")}
      </button>
      {testOpen && <FetchTest key={fetchTestKey(step, scope)} step={step} scope={scope} onClose={() => setTestOpen(false)} />}
      {open && (
        <>
          <span className="se-br" />
          <FetchOptionsPanel step={step} onChange={setOptions} />
        </>
      )}
    </>
  );
}

interface PathOption {
  key: string;
  label: string;
  value: unknown;
}

/** 位置の1段分の選択肢（オブジェクトは項目名、配列は「〇番目」と「最後」） */
function childOptions(value: unknown): PathOption[] {
  if (Array.isArray(value)) {
    const out: PathOption[] = value
      .slice(0, 20)
      .map((v, i) => ({ key: String(i), label: tr("{p1}番目", { p1: i + 1 }), value: v }));
    if (value.length > 1) {
      out.push({ key: "-1", label: tr("最後"), value: value[value.length - 1] });
    }
    return out;
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([k, v]) => ({ key: k, label: k, value: v }));
  }
  return [];
}

/** 中身の分からない配列（画面を開いてから値が決まるもの）の位置の選択肢 */
const UNKNOWN_ITEMS: PathOption[] = [
  ...[0, 1, 2, 3, 4].map((i) => ({ key: String(i), label: tr("{p1}番目", { p1: i + 1 }), value: undefined })),
  { key: "-1", label: tr("最後"), value: undefined },
];

export const isNested = (v: unknown) => v != null && typeof v === "object";

/**
 * 「取得したデータの［…］」「配列の［…］」の位置を選ぶメニュー。
 * 項目を選ぶと決まり、「›」で中の項目へ進む。
 * mode: any = どこでも / list = 一覧（配列）だけ / item = 配列の何番目か（とその中）/
 *       field = 1件の中の項目（入れ子も可。比べられる値＝文字・数値と、文字や数値の一覧だけ選べる）
 */
export function PathMenu({
  root,
  path,
  onChange,
  mode,
}: {
  /** 選べる値の見本（undefined = 見本が無い） */
  root: unknown;
  path: string;
  onChange: (path: string) => void;
  mode: "any" | "list" | "item" | "field";
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
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // 見本が無ければ位置を文字で入力する（配列の何番目かは選べる）
  if (root === undefined && mode !== "item") {
    return (
      <TextIn
        value={path}
        placeholder={
          mode === "list"
            ? tr("一覧の位置（例: products）")
            : mode === "field"
              ? tr("項目（例: name）")
              : tr("位置（例: data.title）")
        }
        width={120}
        onCommit={(v) => onChange(v.trim())}
      />
    );
  }

  const known = root !== undefined;
  const levelValue = at ? digPath(root, at) : root;
  const rows = !known ? (at ? [] : UNKNOWN_ITEMS) : childOptions(levelValue);
  const join = (key: string) => (at ? `${at}.${key}` : key);
  /** 文字・数値だけの一覧（比べるときは「,」でつないだ文字になる） */
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
    : mode === "list"
      ? tr("一覧を選択")
      : mode === "item"
        ? tr("位置を選択")
        : mode === "field"
          ? tr("項目を選択")
          : tr("全体");

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
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{label}</span>
        <ChevronRight size={11} className="se-pm-chev" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="dd-menu se-pm"
            style={pos}
            data-se-popover=""
            onPointerDown={(e) => e.stopPropagation()}
          >
            {at && (
              <div className="se-pm-head">
                <button
                  type="button"
                  className="se-pm-back"
                  aria-label={tr("ひとつ上へ")}
                  onClick={() => setAt(at.split(".").slice(0, -1).join("."))}
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="se-pm-crumb">{fieldLabel(at)}</span>
              </div>
            )}
            {/* 今の階層そのものを選ぶ */}
            {known && (at ? canPick(levelValue) : mode === "any") && (
              <button
                type="button"
                className={`dd-item${path === at ? " is-sel" : ""}`}
                onClick={() => pick(at)}
              >
                <span className="se-pm-key">{at ? tr("ここ全体") : tr("全体")}</span>
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
                      aria-label={tr("{label} の中を見る", { label: o.label })}
                      onClick={() => setAt(full)}
                    >
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              );
            })}
            {known && !rows.length && <div className="se-pm-none">{tr("中に項目がありません")}</div>}
            {mode === "list" && known && !at && !findsList(root) && (
              <div className="se-pm-none">{tr("一覧（配列）が見つかりません")}</div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** 中に一覧（配列）があるか */
function findsList(value: unknown, depth = 0): boolean {
  if (Array.isArray(value)) return true;
  if (!isNested(value) || depth > 4) return false;
  return Object.values(value as object).some((v) => findsList(v, depth + 1));
}

/** 上書きできない変数名（ページのURLの slug、配列の各要素の 値） */
export const RESERVED_VARS = new Set(["slug", ITEM_VALUE]);

/** 変数名の入力（同じ名前ならその変数を上書きする。名前を変えると、使っている箇所も書き換える） */
export function VarNameIn({
  stepId,
  value,
  placeholder = tr("名前（例: 商品）"),
}: {
  stepId: string;
  value: string;
  placeholder?: string;
}) {
  const { doc, pageId, renameVar, readOnly } = useContext(Ctx);
  // ほかのブロックが作る変数と同じ名前なら、その変数を上書きする（後から動いた方の値になる）
  const others = dataVarNames(doc, pageId, stepId);
  const overwrite = !!value && others.has(value) && !RESERVED_VARS.has(value);
  /** 予測の候補: ページのスクリプトで作るほかの変数（同じ変数に入れ直すとき） */
  const names = [...others].filter((n) => !RESERVED_VARS.has(n)).sort((a, b) => a.localeCompare(b, getLang()));
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLInputElement>(null);
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
    renameVar(stepId, others.has(value) ? "" : value, next);
  };
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(anchoredMenuPos(r, 220, 260));
  };

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
          <div className="dd-menu var-comp" style={pos} data-se-popover="" onMouseDown={(e) => e.preventDefault()}>
            <div className="var-comp-head">{tr("ほかのブロックで作る変数")}</div>
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
          data-tip={tr("同じ名前の変数がほかのブロックにもあります。後から動いたブロックの値で上書きされます")}
        >
          {tr("上書き")}
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
  return seg ?? tr("データ");
}
