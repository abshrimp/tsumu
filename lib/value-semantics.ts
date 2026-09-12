/**
 * エディタ、描画前の評価、公開したスクリプトで共有する条件の判定の規則。
 * この関数は自己完結させる。ブラウザのランタイムが、このソースをそのまま埋め込む。
 * リストは、自身の列挙可能なキーと値の組を示すが、JSON の形は保つ。
 */
export function matchesValueCondition(left: unknown, operator: string, right: unknown): boolean {
  const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object";
  const numeric = (value: unknown): number | undefined => {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim())) return undefined;
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  };
  const same = (a: unknown, b: unknown, depth = 0): boolean => {
    // 有限でない数値は、JSON の値として正しくない。JS で等しいとされるからといって、
    // 無限大を、等しい値や含まれる値として扱うことは決してしない。
    if (typeof a === "number" && !Number.isFinite(a) ||
        typeof b === "number" && !Number.isFinite(b)) return false;
    if (a === b) return true;
    // 数値と真偽値は、JS の == を使わず、正確な文字の形で比べる。
    // null、値が無いこと、単一の値の種類の違い、数値の書き方は区別したまま保つ。
    if (typeof a === "string" && (typeof b === "boolean" ||
        (typeof b === "number" && Number.isFinite(b)))) return a === String(b);
    if (typeof b === "string" && (typeof a === "boolean" ||
        (typeof a === "number" && Number.isFinite(a)))) return String(a) === b;
    if (!record(a) || !record(b) || depth >= 16) return false;
    const aa = Object.keys(a), bb = Object.keys(b);
    if (aa.length !== bb.length || aa.length > 10000) return false;
    return aa.every((key) => owns(b, key) && same(
      (a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1));
  };
  if (operator === "has-key") {
    if (!record(left) || record(right) || right === undefined || right === null) return false;
    return Object.prototype.propertyIsEnumerable.call(left, String(right));
  }
  if (operator === "empty") {
    if (left === undefined || left === null || left === "") return true;
    if (record(left)) return Object.keys(left).length === 0;
    return false;
  }
  if (operator === "contains") {
    if (record(left)) return Object.keys(left).some((key) =>
      same((left as Record<string, unknown>)[key], right));
    return left !== undefined && left !== null && !record(right) &&
      String(left).includes(String(right));
  }
  if (operator === "eq" || operator === undefined) return same(left, right);
  if (operator === "in") {
    if (record(right)) return Object.keys(right).some((key) =>
      same((right as Record<string, unknown>)[key], left));
    if (typeof right !== "string") return false;
    return right.split(",").some((part) => same(left, part.trim()));
  }
  if (operator === "starts-with" || operator === "ends-with") {
    if (left === undefined || left === null || record(left) || record(right)) return false;
    const a = String(left), b = String(right);
    return operator === "starts-with" ? a.startsWith(b) : a.endsWith(b);
  }
  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    const a = numeric(left), b = numeric(right);
    if (a === undefined || b === undefined) return false;
    return operator === "gt" ? a > b : operator === "gte" ? a >= b :
      operator === "lt" ? a < b : a <= b;
  }
  return false;
}

/**
 * 入力を書き換えずに、リストの項目を取り除く。配列では、位置で削除した後の隙間を詰め、
 * 辞書（オブジェクト）では元のキーを保つ。
 * 操作でリストが変わらない場合は undefined を返す。
 *
 * この関数は自己完結させる。ブラウザ用とサーバー用の書き出しが、このソースをそのまま埋め込む。
 */
export function removeListItem(
  source: unknown,
  mode: "value" | "key",
  selection: unknown,
  matches: (left: unknown, operator: string, right: unknown) => boolean,
): unknown | undefined {
  if (!source || typeof source !== "object" || selection === undefined) return undefined;
  if (Array.isArray(source) && source.length > 10000) return undefined;
  const keys = Object.keys(source);
  if (keys.length > 10000) return undefined;

  if (mode === "key") {
    if (typeof selection !== "string" && typeof selection !== "number") return undefined;
    const key = String(selection);
    if (Array.isArray(source)) {
      // 受け付けるのは、0 から数える正しいインデックスだけ。負の位置や、まばらな位置は決して受け付けない。
      if (!/^(0|[1-9][0-9]*)$/.test(key)) return undefined;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= source.length) return undefined;
      const result = source.slice();
      result.splice(index, 1);
      return result;
    }
    if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
    const result = Object.assign(Object.create(null), source) as Record<string, unknown>;
    delete result[key];
    return result;
  }
  if (mode !== "value") return undefined;

  if (Array.isArray(source)) {
    const result = source.filter((item) => !matches(item, "eq", selection));
    return result.length === source.length ? undefined : result;
  }
  const result = Object.assign(Object.create(null), source) as Record<string, unknown>;
  let removed = false;
  for (const key of keys) {
    if (matches(result[key], "eq", selection)) {
      delete result[key];
      removed = true;
    }
  }
  return removed ? result : undefined;
}

/** あいまいさの無い JSON のリテラルだけを推定する。それ以外の文字は、文字のまま残す。 */
export function parseValueLiteral(text: string): unknown {
  const source = text.trim();
  if (source === "true" || source === "false" || source === "null" ||
      source.startsWith("[") || source.startsWith("{") ||
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source) ||
      (source.length >= 2 && source.startsWith('"') && source.endsWith('"'))) {
    try { return JSON.parse(source); } catch { /* Ordinary text. */ }
  }
  return text;
}

/** 共有している部分木を直列化せずに、展開した JSON の形の大きさを見積もって制限する。 */
export function withinScriptValueLimit(value: unknown): boolean {
  // 取得の処理も、JSON の応答を 5 MiB までに制限している。ここでは、文字列のコード単位と
  // 入れ物の分の大きさを数え、直列化する前に展開の大きさを抑える。
  const limit = 5 * 1024 * 1024;
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.length <= limit;
    return typeof value === "boolean";
  }
  const sizes = new WeakMap<object, { cost: number; height: number }>();
  const measure = (item: unknown, depth: number): { cost: number; height: number } => {
    if (depth > 64) return { cost: Infinity, height: 0 };
    if (item === null || item === undefined) return { cost: 8, height: 0 };
    if (typeof item !== "object") {
      if (typeof item === "number" && !Number.isFinite(item) ||
          typeof item !== "number" && typeof item !== "string" &&
          typeof item !== "boolean") return { cost: Infinity, height: 0 };
      return { cost: typeof item === "string" ? item.length + 2 : 8, height: 0 };
    }
    const cached = sizes.get(item);
    if (cached) return depth + cached.height <= 64 ? cached : { cost: Infinity, height: 0 };
    // たどっている途中の祖先への参照は、循環になる。
    sizes.set(item, { cost: Infinity, height: 0 });
    if (Array.isArray(item) && item.length > limit) return { cost: Infinity, height: 0 };
    let cost = Array.isArray(item) ? 2 + item.length : 2;
    let height = 0;
    for (const key of Object.keys(item)) {
      const child = measure((item as Record<string, unknown>)[key], depth + 1);
      cost += key.length + 4 + child.cost;
      height = Math.max(height, child.height + 1);
      if (cost > limit) return { cost: Infinity, height: 0 };
    }
    const measured = { cost, height };
    sizes.set(item, measured);
    return measured;
  };
  return measure(value, 0).cost <= limit;
}

/** 変数に値を入れる（"記事.tags" のような入れ子は、元の値を変えずに、途中を複製して入れる） */
export function setVarPath(vars: Record<string, unknown>, name: string, value: unknown,
  accept?: (candidate: unknown) => boolean, editingList = false): string | undefined {
  if (typeof name !== "string" || !name) return undefined;
  const owns = (obj: object, key: string | number) =>
    Object.prototype.hasOwnProperty.call(obj, key);
  // Object.defineProperty は、__proto__ をプロトタイプの変更ではなく、通常の自身のキーとして書く。
  // 位置を覆えるのは、自身のキーだけ。
  const write = (key: string, next: unknown) => {
    if (accept && !accept(next)) return undefined;
    Object.defineProperty(vars, key, { value: next, writable: true, enumerable: true, configurable: true });
    return key;
  };
  if (owns(vars, name) || !name.includes(".")) {
    return write(name, value);
  }
  let invalidPath = false;
  const put = (cur: unknown, keys: string[]): unknown => {
    if (!keys.length) return value;
    const [k, ...rest] = keys;
    if (Array.isArray(cur)) {
      // 入れ子の配列の位置への書き込みでは、既存の枠を更新するか、1件を末尾に加える。
      // リストを辞書に変えたり、誤ったインデックスから百万の枠を持つまばらなリストを
      // 作ったりは決してしない（set-list-item も同じ規則に従う）。
      // リストの編集では、最後の項目を指す別名で読んだ同じリストに書き戻す。
      const lastItem = editingList && k === "-1";
      if (!lastItem && !/^(0|[1-9][0-9]*)$/.test(k)) { invalidPath = true; return cur; }
      const index = lastItem ? cur.length - 1 : Number(k);
      if (!Number.isSafeInteger(index) || index < 0 || index > cur.length ||
          (index === cur.length && cur.length >= 10000)) {
        invalidPath = true;
        return cur;
      }
      const copy = cur.slice();
      copy[index] = put(owns(cur, index) ? cur[index] : undefined, rest);
      return copy;
    }
    const obj = cur && typeof cur === "object" ? cur as Record<string, unknown> : {};
    return { ...obj, [k]: put(owns(obj, k) ? obj[k] : undefined, rest) };
  };
  const [root, ...rest] = name.split(".");
  if (rest.length > 64) return undefined;
  const candidate = put(owns(vars, root) ? vars[root] : undefined, rest);
  return invalidPath ? undefined : write(root, candidate);
}
