/** 候補選択の用途。見本の型を、実行時の型宣言としては扱わない。 */
export type ValueContext = "value" | "text" | "number";

export function canPickVariable(sample: unknown, context: ValueContext): boolean {
  // 見本なし・nullでは型を断定せず、実行時に決まる値も選べるようにする。
  if (context === "value" || sample == null) return true;
  if (context === "number") {
    return (typeof sample === "number" && Number.isFinite(sample)) ||
      (typeof sample === "string" && sample.trim() !== "" && Number.isFinite(Number(sample.replace(/,/g, ""))));
  }
  if (Array.isArray(sample)) return sample.every((v) => v == null || typeof v !== "object");
  return typeof sample !== "object";
}

/** 既存の単独参照と同じ規則で、値を変更せずに入力表示を選ぶ。 */
export function singleValueReference(value: string): string | null {
  return /^\{([^{}\s"\'<>`]+)\}$/.exec(value.trim())?.[1] ?? null;
}

/** 葉の候補だけが分かる場合も、同じローカル値の親を選択・遮蔽できるようにする。 */
export function localVariableNames(names: readonly string[]): string[] {
  return [...new Set(names.flatMap((name) => {
    const parts = name.split(".");
    return parts.map((_, i) => parts.slice(0, i + 1).join("."));
  }))];
}

/** 近いスコープが名前のルート全体を優先する。別スコープの見本を混ぜない。 */
export function variableChoiceSamples(
  groups: readonly { vars: Record<string, unknown> }[], localNames: readonly string[] = [],
): Record<string, unknown> {
  const local = localVariableNames(localNames);
  const claimed = new Set(local.map((name) => name.split(".")[0]));
  const entries: [string, unknown][] = local.map((name) => [name, undefined]);
  for (const group of groups) {
    const own = Object.entries(group.vars).filter(([name]) => !claimed.has(name.split(".")[0]));
    entries.push(...own);
    for (const [name] of own) claimed.add(name.split(".")[0]);
  }
  return Object.fromEntries(entries);
}
