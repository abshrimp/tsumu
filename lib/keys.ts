/**
 * Enter が押されたか（日本語入力の変換を確定する Enter は除く）。
 * 変換確定の Enter で blur などをすると、確定した文字が二重に入ることがある
 */
export function isEnterKey(e: {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  if (e.key !== "Enter") return false;
  const composing =
    e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229 || e.nativeEvent?.keyCode === 229;
  return !composing;
}
