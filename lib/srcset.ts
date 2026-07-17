/** Rewrite only URL tokens in an HTML srcset, retaining descriptors and separators.
 * URL tokens end at ASCII whitespace, not internal commas (including data: URLs).
 * Candidate boundaries follow HTML's parsing-a-srcset-attribute tokenizer.
 */
export function rewriteSrcsetUrls(value: string, resolve: (url: string) => string): string {
  const space = (ch: string) => /[\t\n\f\r ]/.test(ch);
  let position = 0;
  let copied = 0;
  let output = "";
  while (position < value.length) {
    while (position < value.length && (space(value[position]) || value[position] === ",")) position++;
    const start = position;
    while (position < value.length && !space(value[position])) position++;
    let end = position;
    // With no descriptors, trailing commas terminate the candidate, not its URL.
    while (end > start && value[end - 1] === ",") end--;
    if (end > start) {
      output += value.slice(copied, start) + resolve(value.slice(start, end));
      copied = end;
    }
    if (end < position) continue;
    // A comma in parenthesized descriptor text is not a candidate separator.
    // We preserve even unsupported descriptors; validation belongs to the browser.
    let parentheses = false;
    while (position < value.length) {
      const ch = value[position++];
      if (parentheses) {
        if (ch === ")") parentheses = false;
      } else if (ch === "(") parentheses = true;
      else if (ch === ",") break;
    }
  }
  return output + value.slice(copied);
}
