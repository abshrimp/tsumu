/** ブラウザの設定で保存領域を使えない場合も、エディタは起動できるようにする。 */
export function readLocalStorage(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
