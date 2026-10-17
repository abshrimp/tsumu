/**
 * カスタムコード（<head> に入れるHTML）を JSX に変換する
 */

import { jsxHtmlString } from "./render-helpers";

/** HTML の属性名 → React の属性名（head に書かれるもの） */
const HEAD_ATTR_NAMES: Record<string, string> = {
  class: "className",
  charset: "charSet",
  "http-equiv": "httpEquiv",
  crossorigin: "crossOrigin",
  referrerpolicy: "referrerPolicy",
  nomodule: "noModule",
  fetchpriority: "fetchPriority",
  hreflang: "hrefLang",
  itemprop: "itemProp",
  itemscope: "itemScope",
  itemtype: "itemType",
  imagesrcset: "imageSrcSet",
  imagesizes: "imageSizes",
};

/** head の要素（meta / link / script / style / base / title）で React の型が知っている、名前を変えない属性 */
const HEAD_PLAIN_ATTRS = new Set([
  "about", "as", "async", "blocking", "color", "content", "datatype", "defer", "dir", "disabled",
  "hidden", "href", "id", "integrity", "lang", "media", "name", "nonce", "precedence", "prefix",
  "property", "rel", "resource", "sizes", "src", "target", "title", "translate", "type", "typeof", "vocab",
]);

/** 属性の値の文字参照（&amp; &#39; など）を文字に戻す */
function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return named[name.toLowerCase()] ?? m;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/**
 * サイト設定の「head に追加する HTML」を、<head> の子に置く JSX にする。
 * script / style / noscript / title は中身を dangerouslySetInnerHTML で、meta / link / base は属性だけ出す
 * （コメントや、ほかの要素・文字は head に置けないので落とす）
 */
export function headHtmlToJsx(html: string, indent: string): string {
  const attrsJsx = (raw: string) => {
    const out: string[] = [];
    for (const m of raw.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
      const name = m[1].toLowerCase();
      // style は React では文字列にできない（head の中は表示されないので落とす）。
      // 属性名は JSX にそのまま書くので、名前の形でないもの（{ や ( を含むなど）も落とす
      if (name.startsWith("on") || name === "style" || !/^[a-z][a-z0-9._:-]*$/.test(name)) continue;
      const value = m[2] ?? m[3] ?? m[4];
      const prop = HEAD_ATTR_NAMES[name] ?? name;
      if (name in HEAD_ATTR_NAMES || HEAD_PLAIN_ATTRS.has(name) || name.includes("-")) {
        out.push(value === undefined ? ` ${prop}` : ` ${prop}=${jsxHtmlString(value)}`);
      } else {
        // React の型に無い属性（language・scheme など）は、そのまま書くと型チェックで公開のビルドが止まる。
        // 展開で渡せば型の検査を受けず、HTML の属性としてそのまま出る
        out.push(` {...{ ${JSON.stringify(name)}: ${value === undefined ? '""' : JSON.stringify(decodeEntities(value))} }}`);
      }
    }
    return out.join("");
  };
  const out: string[] = [];
  const re =
    /<!--[\s\S]*?-->|<(script|style|noscript|title)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(meta|link|base)\b([^>]*?)\/?>/gi;
  for (const m of html.matchAll(re)) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const body = m[3];
      out.push(
        body.trim()
          ? `${indent}<${tag}${attrsJsx(m[2])}\n${indent}  dangerouslySetInnerHTML={{ __html: ${JSON.stringify(body)} }}\n${indent}/>`
          : `${indent}<${tag}${attrsJsx(m[2])} />`
      );
    } else {
      out.push(`${indent}<${m[4].toLowerCase()}${attrsJsx(m[5])} />`);
    }
  }
  return out.length ? "\n" + out.join("\n") : "";
}
