/** 実際のクリップボードには触れずに、貼り付けのハンドラーへ渡る文字列を確かめる。 */
export function dispatchTextPaste(el: HTMLElement, text: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
  // Firefox はコンストラクターに渡したデータを空にするため、他の貼り付けのテストと同じく、明示的に設定する。
  // https://bugzilla.mozilla.org/show_bug.cgi?id=2027025
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  let receivedText: string | null = null;
  el.addEventListener("paste", (received) => {
    receivedText = received.clipboardData?.getData("text/plain") ?? null;
  }, { once: true });
  const eventText = event.clipboardData?.getData("text/plain") ?? null;
  if (eventText !== text) throw new Error("Synthetic paste event lost its text before dispatch");
  const canceled = !el.dispatchEvent(event);
  return { eventText, receivedText, canceled };
}
