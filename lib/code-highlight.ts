/**
 * Lightweight, dependency-free HTML, CSS and JavaScript highlighting.
 * Escape every source character before inserting colored markup into the DOM.
 */
const MAX_COLORED_CHARS = 160_000;

const ENTITIES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ENTITIES[char]);

type Color = "comment" | "tag" | "attribute" | "string" | "keyword" |
  "number" | "selector" | "property" | "punctuation";

const span = (kind: Color, text: string) =>
  '<span class="code-token-' + kind + '">' + escapeHtml(text) + "</span>";

function colorize(
  source: string,
  pattern: RegExp,
  classify: (match: RegExpExecArray) => Color | null
): string {
  let cursor = 0;
  const output: string[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const at = match.index;
    if (at > cursor) output.push(escapeHtml(source.slice(cursor, at)));
    const kind = classify(match);
    output.push(kind ? span(kind, match[0]) : escapeHtml(match[0]));
    cursor = at + match[0].length;
  }
  output.push(escapeHtml(source.slice(cursor)));
  return output.join("");
}

function javascript(source: string): string {
  return colorize(
    source,
    /(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)|("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60)|(\b(?:async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield)\b)|(\b(?:true|false|null|undefined|NaN|Infinity)\b)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([{}()[\].,:;=+\-*/!?<>|&%]+)/g,
    (m) => m[1] ? "comment" : m[2] ? "string" : m[3] ? "keyword"
      : m[4] || m[5] ? "number" : "punctuation"
  );
}

function css(source: string): string {
  return colorize(
    source,
    /(\/\*[\s\S]*?\*\/)|("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|(@[\w-]+)|(#[a-fA-F0-9]{3,8}\b)|([.#][a-zA-Z_-][\w-]*)|([a-zA-Z_-][\w-]*)(?=\s*:)|(\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|vmin|vmax|%|ms|s|deg)?)(?![\w-])|([{}:;(),])/g,
    (m) => m[1] ? "comment" : m[2] ? "string" : m[3] ? "keyword"
      : m[4] || m[7] ? "number" : m[5] ? "selector" : m[6] ? "property" : "punctuation"
  );
}

function tagAttributes(source: string): string {
  return colorize(
    source,
    /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|([^\s=/>]+)|(=|\/)/g,
    (m) => m[1] ? "string" : m[2] ? "attribute" : "punctuation"
  );
}

/** The first '>' outside an HTML attribute value ends the tag. */
function tagEnd(source: string, from: number): number {
  let quote: "'" | '"' | null = null;
  for (let i = from + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

function markup(source: string): string {
  const output: string[] = [];
  const lower = source.toLowerCase();
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    output.push(escapeHtml(source.slice(cursor, start)));
    if (source.startsWith("<!--", start)) {
      const end = source.indexOf("-->", start + 4);
      const stop = end < 0 ? source.length : end + 3;
      output.push(span("comment", source.slice(start, stop)));
      cursor = stop;
      continue;
    }
    if (!/[a-zA-Z!?/]/.test(source[start + 1] ?? "")) {
      output.push("&lt;");
      cursor = start + 1;
      continue;
    }
    const end = tagEnd(source, start);
    if (end < 0) {
      output.push(escapeHtml(source.slice(start)));
      return output.join("");
    }
    const raw = source.slice(start, end + 1);
    const tag = /^<(\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(raw);
    if (!tag) {
      output.push(span("punctuation", raw));
      cursor = end + 1;
      continue;
    }
    output.push(
      span("punctuation", "<" + tag[1]),
      span("tag", tag[2]),
      tagAttributes(tag[3]),
      span("punctuation", tag[4] + ">")
    );
    cursor = end + 1;
    const tagName = tag[2].toLowerCase();
    if (tag[1] || tag[4] || (tagName !== "script" && tagName !== "style")) continue;
    const closing = lower.indexOf("</" + tagName, cursor);
    if (closing < 0) {
      output.push(tagName === "script" ? javascript(source.slice(cursor)) : css(source.slice(cursor)));
      return output.join("");
    }
    output.push(tagName === "script"
      ? javascript(source.slice(cursor, closing))
      : css(source.slice(cursor, closing)));
    cursor = closing;
  }
  output.push(escapeHtml(source.slice(cursor)));
  return output.join("");
}

/** HTML snippets highlight embedded CSS and JS without executing any input. */
export function highlightCustomCode(source: string): string {
  return markup(source.slice(0, MAX_COLORED_CHARS)) + escapeHtml(source.slice(MAX_COLORED_CHARS));
}
