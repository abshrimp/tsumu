/** HTML の srcset の URL の部分だけを書き換え、記述子と区切りはそのまま残す。
 * URL の部分は、途中のコンマではなく ASCII の空白で終わる（data: の URL を含む）。
 * 候補の境界は、HTML の srcset 属性の解析の手順に従う。
 */
export function rewriteSrcsetUrls(value: string, resolve: (url: string) => string, maxLength = Infinity): string {
  const space = (ch: string) => /[\t\n\f\r ]/.test(ch);
  let position = 0;
  let copied = 0;
  let output = "";
  while (position < value.length) {
    while (position < value.length && (space(value[position]) || value[position] === ",")) position++;
    const start = position;
    while (position < value.length && !space(value[position])) position++;
    let end = position;
    // 記述子が無い場合、末尾のコンマは URL の一部ではなく、候補の終わりを表す。
    while (end > start && value[end - 1] === ",") end--;
    if (end > start) {
      const url = resolve(value.slice(start, end));
      if (output.length + start - copied + url.length > maxLength) throw new Error("Embedded srcset exceeds the size limit.");
      output += value.slice(copied, start) + url;
      copied = end;
    }
    if (end < position) continue;
    // 丸かっこの中の記述子にあるコンマは、候補の区切りではない。
    // 対応していない記述子もそのまま残す。検証はブラウザに任せる。
    let parentheses = false;
    while (position < value.length) {
      const ch = value[position++];
      if (parentheses) {
        if (ch === ")") parentheses = false;
      } else if (ch === "(") parentheses = true;
      else if (ch === ",") break;
    }
  }
  if (output.length + value.length - copied > maxLength) throw new Error("Embedded srcset exceeds the size limit.");
  return output + value.slice(copied);
}
