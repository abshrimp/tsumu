/**
 * キャンバス上のテキスト編集（contentEditable）。
 * {変数} をチップとして表示しながら、中身はプレーンテキストとして読み書きする。
 * DOM は常に「テキスト + 変数チップ(span.cv-tok) + 末尾の改行用 br」だけに保つ。
 */

import { splitVarTokens } from "./vars";

const TOK_CLASS = "cv-tok";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 要素の中身をプレーンテキストとして読む（br・ブロック要素は改行） */
export function editableText(el: Node): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n as Text).data;
      return;
    }
    if (n instanceof HTMLBRElement) {
      if (!n.dataset.end) out += "\n";
      return;
    }
    if (
      n !== el &&
      n instanceof HTMLElement &&
      (n.tagName === "DIV" || n.tagName === "P") &&
      out &&
      !out.endsWith("\n")
    ) {
      out += "\n";
    }
    n.childNodes.forEach(walk);
  };
  walk(el);
  return out;
}

/** 選択範囲の先頭・末尾を、プレーンテキスト上の位置で返す */
export function selectionOffsets(el: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const at = (node: Node, offset: number) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    const box = document.createElement("div");
    box.appendChild(r.cloneContents());
    return editableText(box).length;
  };
  const start = at(range.startContainer, range.startOffset);
  return [start, range.collapsed ? start : at(range.endContainer, range.endOffset)];
}

/** プレーンテキスト上の位置にカーソルを置く（チップの直後なら外側に置く） */
function setCaret(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  let acc = 0;
  let placed = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (offset <= acc + len) {
      const chip = n.parentElement?.classList.contains(TOK_CLASS) ? n.parentElement : null;
      if (chip && offset === acc + len) r.setStartAfter(chip);
      else if (chip && offset === acc) r.setStartBefore(chip);
      else r.setStart(n, offset - acc);
      placed = true;
      break;
    }
    acc += len;
  }
  if (!placed) {
    const end = el.querySelector("br[data-end]");
    if (end) r.setStartBefore(end);
    else {
      r.selectNodeContents(el);
      r.collapse(false);
    }
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** テキストを描き直す（変数はチップに） */
function paint(el: HTMLElement, text: string) {
  el.innerHTML =
    splitVarTokens(text)
      .map((p) =>
        p.name !== undefined
          ? `<span class="${TOK_CLASS}">${esc(p.text)}</span>`
          : esc(p.text)
      )
      .join("") +
    // 末尾の改行・空のときも1行分の高さとカーソル位置を保つ
    (!text || text.endsWith("\n") ? '<br data-end="1">' : "");
}

/* ---- 取り消し履歴（innerHTML を書き換えるためブラウザの履歴は使えない） ---- */

interface History {
  stack: { text: string; caret: number }[];
  index: number;
}
const histories = new WeakMap<HTMLElement, History>();

function record(el: HTMLElement, text: string, caret: number) {
  const h = histories.get(el) ?? { stack: [], index: -1 };
  if (h.stack[h.index]?.text === text) {
    h.stack[h.index].caret = caret;
  } else {
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push({ text, caret });
    if (h.stack.length > 200) h.stack.shift();
    h.index = h.stack.length - 1;
  }
  histories.set(el, h);
}

/** 内容を置き換えてカーソルを置く */
export function setEditable(el: HTMLElement, text: string, caret: number) {
  paint(el, text);
  setCaret(el, caret);
  record(el, text, caret);
}

/** 編集開始: 内容を描いて全選択する */
export function startEditable(el: HTMLElement, text: string) {
  histories.delete(el);
  paint(el, text);
  record(el, text, text.length);
  const r = document.createRange();
  r.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * 全部消したときなどにブラウザが行の高さを保つために入れる末尾の <br> を取り除く
 * （改行はすべて文字として入れるので、後ろに文字の無い <br> は改行ではない）
 */
function dropPlaceholderBr(el: HTMLElement) {
  const brs = el.querySelectorAll("br:not([data-end])");
  const last = brs[brs.length - 1];
  if (!last) return;
  const after = document.createRange();
  after.setStartAfter(last);
  after.setEnd(el, el.childNodes.length);
  if (after.toString() === "") last.remove();
}

/** 入力後: DOM から読み直してチップを付け直す */
export function normalizeEditable(el: HTMLElement) {
  dropPlaceholderBr(el);
  const text = editableText(el);
  const caret = selectionOffsets(el)?.[0] ?? text.length;
  setEditable(el, text, caret);
}

/** 選択範囲を文字で置き換える（改行・貼り付け用） */
export function insertEditable(el: HTMLElement, str: string) {
  const text = editableText(el);
  const [s, e] = selectionOffsets(el) ?? [text.length, text.length];
  setEditable(el, text.slice(0, s) + str + text.slice(e), s + str.length);
}

/** 取り消し（dir = -1）/ やり直し（dir = 1） */
export function undoEditable(el: HTMLElement, dir: -1 | 1) {
  const h = histories.get(el);
  if (!h) return;
  const next = h.stack[h.index + dir];
  if (!next) return;
  h.index += dir;
  paint(el, next.text);
  setCaret(el, next.caret);
}
