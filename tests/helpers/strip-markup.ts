/**
 * Text-only extraction for server-rendered HTML test fixtures.
 * This is intentionally a scanner, not an incomplete tag-removal regex:
 * quoted ">" inside attributes must not terminate a tag.
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
