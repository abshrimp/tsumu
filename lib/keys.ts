export interface KeyLikeEvent {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

export function isComposingKey(e: Omit<KeyLikeEvent, "key">): boolean {
  return Boolean(
    e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229 || e.nativeEvent?.keyCode === 229
  );
}

/**
 * Enter が押されたか（日本語入力の変換を確定する Enter は除く）。
 * 変換を確定する Enter で blur などをすると、確定した文字が二重に入ることがある
 */
export function isEnterKey(e: KeyLikeEvent): boolean {
  return e.key === "Enter" && !isComposingKey(e);
}

/** Esc が押されたか（日本語入力の未確定文字列を取り消す Esc は除く）。 */
export function isEscapeKey(e: KeyLikeEvent): boolean {
  return e.key === "Escape" && !isComposingKey(e);
}
