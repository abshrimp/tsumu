/**
 * 生成する JS / TSX のソースに入れる値を直列化する。
 * JSON.stringify だけでは、インラインの <script> の中では守れない。文字どおりの
 * </script> が、JavaScript が実行される前に HTML の script 要素を終わらせてしまう。
 * JavaScript としての値は変えずに、HTML で意味を持つ字句だけを取り除く。
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
