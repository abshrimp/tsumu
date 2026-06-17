/** ブラウザ保存のキーは Tsumu の名前空間にまとめる。 */
export function storageKey(name: string): string {
  return `tsumu-${name}`;
}
