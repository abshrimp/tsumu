/** Quote an arbitrary identifier for a CSS attribute selector. */
/* Use CSS hex escapes instead of JavaScript string escaping:
 * unlike JSON.stringify, these also handle newlines and </style> safely.
 * \`[data-node=\${cssQuotedAttributeValue(id)}]\` is safe in both
 * querySelector and stylesheet text, even for externally supplied IDs.
 */
export function cssQuotedAttributeValue(value: string): string {
  return '"' + value.replace(/[^\w-]/gu, (char) =>
    "\\" + char.codePointAt(0)!.toString(16) + " "
  ) + '"';
}
