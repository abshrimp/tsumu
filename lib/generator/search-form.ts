/** Next.js と React に共通の検索フォーム送信。明示した送信先やメソッドはブラウザーに任せる。 */
export const SEARCH_FORM_QUERY = `function searchQuery(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (form.matches("[action],[target]") || submitter?.matches("[formaction],[formmethod],[formtarget]")) return null;
  const qs = new URLSearchParams(window.location.search);
  for (const name of fieldNames(form)) qs.delete(name);
  for (const [name, value] of new FormData(form, submitter).entries()) {
    if (typeof value === "string") qs.append(name, value);
  }
  return qs;
}`;

/** 通常の GET の送信やフレームワークのルーターに、フォームの外のクエリを引き継ぐ。 */
export const NATIVE_SEARCH_FORM_QUERY = `(function () {
  const pending = new WeakMap();
  document.addEventListener("submit", function (event) {
    const form = event.target;
    pending.delete(form);
    if (!form.matches('form[data-search-form][method="get" i]:not([action],[target])') ||
        event.submitter?.matches("[formaction],[formmethod],[formtarget]")) return;
    const names = new Set(Array.from(form.elements, el => el.name).filter(Boolean));
    const extra = Array.from(new URLSearchParams(location.search)).filter(([name]) => !names.has(name));
    if (!extra.length) return;
    const submission = { event, extra };
    pending.set(form, submission);
    setTimeout(() => { if (pending.get(form) === submission) pending.delete(form); }, 0);
  }, true);
  document.addEventListener("formdata", function (event) {
    const submission = pending.get(event.target);
    // ルーターは submit の処理中にデータを組み立てる。キャンセル済みのイベントが
    // 終わった後にアプリが単独で読む FormData には、以前のクエリを足さない。
    if (!submission || (submission.event.defaultPrevented && submission.event.eventPhase === Event.NONE)) return;
    const present = new Set(event.formData.keys());
    for (const [name, value] of submission.extra) if (!present.has(name)) event.formData.append(name, value);
  }, true);
})();`;
