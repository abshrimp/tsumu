/**
 * 開閉ボタンなどを素早く2回押したときに、ブラウザが単語の選択（ダブルクリック選択）を
 * 始めないようにする。1回目で畳んだ・閉じた結果、2回目が下から出てきた文字に当たって
 * 選択されてしまうため、押した場所ではなく2回目以降の押下そのものを止める。
 * 文字を選ぶ意味がある場所（入力欄・編集中の文字・キャンバス・ヘルプ本文）は除く
 */
const SELECTABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .canvas-frame, .help-body';

export function installNoDblClickSelect(): () => void {
  const onDown = (e: MouseEvent) => {
    if (e.detail < 2 || e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(SELECTABLE)) return;
    e.preventDefault();
  };
  document.addEventListener("mousedown", onDown, true);
  return () => document.removeEventListener("mousedown", onDown, true);
}
