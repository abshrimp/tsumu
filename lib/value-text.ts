/**
 * JSON の文字としての表示と、比較用の文字列化。配列の深さによらず、呼び出しスタックを使わない。
 * 生成するコードにも関数をそのまま埋め込むため、外の値や関数を参照しない。
 */
export function formatValueText(value: unknown, comparison = false): string {
  if (value == null) return "";
  if (!Array.isArray(value)) return typeof value === "object"
    ? comparison ? "[object Object]" : "" : String(value);

  const parts: string[] = [];
  const frames = [{ value, index: 0 }];
  const active = new WeakSet<unknown[]>([value]);
  // HTTP の JSON と同じ 5 MiB を基準に、共有している部分木の展開や、巨大でまばらな配列も制限する。
  const limit = 5 * 1024 * 1024;
  let visits = 0, size = 0;
  while (frames.length) {
    if (++visits > limit) return "";
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.value.length) {
      active.delete(frame.value);
      frames.pop();
      continue;
    }
    if (comparison && frame.index > 0) { parts.push(","); size++; }
    const item: unknown = frame.value[frame.index++];
    if (Array.isArray(item)) {
      // 循環参照だけを空にし、同じ配列が別の場所に現れた場合は、もう一度表示する。
      if (!active.has(item)) {
        active.add(item);
        frames.push({ value: item, index: 0 });
      }
    } else {
      const text = item == null ? "" : typeof item === "object"
        ? comparison ? "[object Object]" : "" : String(item);
      if (text) {
        if (!comparison && parts.length) { parts.push(", "); size += 2; }
        parts.push(text);
        size += text.length;
      }
    }
    if (size > limit) return "";
  }
  return parts.join("");
}
