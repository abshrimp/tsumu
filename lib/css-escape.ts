/** Decode CSS escapes without parsing or loading the editor UI. */
export function decodeCssEscapes(css: string): string {
  return css.replace(/\\([0-9a-f]{1,6}(?:\r\n|[\t\n\f\r ])?|\r\n|[\s\S])/gi, (_, value: string) => {
    if (/^[0-9a-f]/i.test(value)) {
      const point = parseInt(value, 16);
      return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? "\uFFFD" : String.fromCodePoint(point);
    }
    return /[\n\r\f]/.test(value) ? "" : value;
  });
}
