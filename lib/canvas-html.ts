"use client";

import DOMPurify from "dompurify";

/**
 * キャンバスに表示するカスタムコード・アイコンの HTML を無害にする。
 * キャンバスはエディタと同じオリジンなので、そのまま差し込むと、編集データ（取り込んだデータ・
 * 公開履歴から戻した版・AI の提案）に書かれた onerror などがログイン中の人の権限で動いてしまう。
 * 書き出したサイトでは、書いたとおりに動く（ここで消すのは表示だけ）
 */

/** 埋め込みの iframe は残すが、エディタの画面を移動させたりはさせない */
const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-forms allow-presentation";

let purify: ReturnType<typeof DOMPurify> | null = null;

function sanitizer(): ReturnType<typeof DOMPurify> {
  if (purify) return purify;
  purify = DOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "IFRAME") node.setAttribute("sandbox", IFRAME_SANDBOX);
    // 新しいタブで開くリンクから、エディタの画面（window.opener）を書き換えさせない
    if (node.nodeName === "A" && node.getAttribute("target")) node.setAttribute("rel", "noopener noreferrer");
  });
  return purify;
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 500;

export function canvasHtml(html: string): string {
  // ブラウザの外（サーバーでの描画）では何も出さない（無害にできないものを出さない）
  if (typeof window === "undefined") return "";
  let out = cache.get(html);
  if (out === undefined) {
    out = sanitizer().sanitize(html, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading", "referrerpolicy", "target"],
      FORBID_TAGS: ["base", "link", "meta"],
    });
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(html, out);
  }
  return out;
}
