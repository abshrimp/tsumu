/**
 * Serialize values inserted into generated JS/TSX source.
 * JSON.stringify alone does not protect inline <script> contexts: a literal
 * </script> can terminate the HTML script element before JavaScript executes.
 * Keep the JavaScript value unchanged while removing HTML-significant tokens.
 */
export function codeLiteral(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Cannot generate a code literal for undefined");
  return json.replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "&": return "\\u0026";
      case "\u2028": return "\\u2028";
      case "\u2029": return "\\u2029";
      default: return char;
    }
  });
}
