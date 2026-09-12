/**
 * サーバーで描画した HTML のテスト用の準備から、文字だけを取り出す。
 * 不完全なタグ除去の正規表現ではなく、意図的に走査して読む:
 * 属性の中で引用符に囲まれた ">" で、タグを終わらせてはならない。
 */
export function stripMarkup(markup: string): string {
  let text = "";
  for (let index = 0; index < markup.length;) {
    if (markup[index] !== "<") { text += markup[index++]; continue; }
    let quote = "";
    let end = index + 1;
    for (; end < markup.length; end++) {
      const char = markup[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === ">") break;
    }
    if (end === markup.length) { text += markup[index++]; continue; }
    index = end + 1;
  }
  return text;
}
