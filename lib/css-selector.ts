/** 任意の識別子を、CSS の属性セレクター用に引用符で囲む。 */
/* JavaScript の文字列のエスケープではなく、CSS の16進数のエスケープを使う。
 * JSON.stringify と違い、改行や </style> も安全に扱える。
 * \`[data-node=\${cssQuotedAttributeValue(id)}]\` は、外部から渡された ID でも、
 * querySelector とスタイルシートの本文のどちらでも安全に使える。
 */
export function cssQuotedAttributeValue(value: string): string {
  return '"' + value.replace(/[^\w-]/gu, (char) =>
    "\\" + char.codePointAt(0)!.toString(16) + " "
  ) + '"';
}
