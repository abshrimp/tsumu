/**
 * カスタムコード（<head> に入れる HTML）を JSX に変換する
 */

import { parse, parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { jsxString } from "./render-helpers";
import { codeLiteral } from "./code-literal";

/** 元のマークアップを再直列化せず、実際の head に差し込む。省略時も doctype の後に置く。 */
export function insertIntoHtmlHead(html: string, markup: string): string {
  const { childNodes } = parse(html, { sourceCodeLocationInfo: true });
  const root = childNodes.find((node): node is Html.Element => "tagName" in node && node.tagName === "html");
  const head = root?.childNodes.find((node): node is Html.Element => "tagName" in node && node.tagName === "head");
  const location = head?.sourceCodeLocation;
  const offset = location?.endTag?.startOffset ?? location?.startTag?.endOffset ??
    root?.sourceCodeLocation?.startTag?.endOffset ??
    childNodes.find((node) => node.nodeName === "#documentType")?.sourceCodeLocation?.endOffset ?? 0;
  return html.slice(0, offset) + markup + "\n" + html.slice(offset);
}

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

// HTML の真偽属性は、値が空でも "false" でも、存在すれば有効になる。
// React には文字列ではなく boolean を渡す（data-* / aria-* は含めない）。
const HEAD_BOOLEAN_ATTRS = new Set(["async", "defer", "disabled", "nomodule", "itemscope"]);

/**
 * サイト設定の「head に追加する HTML」を、<head> の子に置く JSX にする。
 * script / style / noscript / title は中身を dangerouslySetInnerHTML で、meta / link / base は属性だけを出力する
 * （コメントや、他の要素・文字は head に置けないため落とす）
 */
export function headHtmlToJsx(html: string, indent: string): string {
  const attrsJsx = (attrs: Html.Element["attrs"]) => {
    const out: string[] = [];
    // 属性の値は HTML の規則（すべての名前付き参照、不正な数値参照、重複した属性）で解析し、
    // コンパイラが二度デコードしないよう、文字どおりの JSX の文字列として出力する。
    for (const { name, value } of attrs) {
      // HTML の children 属性は内容ではない。React に渡すと本文になり、
      // void 要素や dangerouslySetInnerHTML と一緒に使うと描画に失敗する。
      if (name === "children") continue;
      // style は React では文字列にできない（head の中は表示されないため落とす）。
      // 属性名は JSX にそのまま書くため、名前の形でないもの（{ や ( を含むなど）も落とす
      if (name.startsWith("on") || name === "style" || !/^[a-z][a-z0-9._:-]*$/.test(name)) continue;
      const mapped = Object.hasOwn(HEAD_ATTR_NAMES, name);
      const prop = mapped ? HEAD_ATTR_NAMES[name] : name;
      if (HEAD_BOOLEAN_ATTRS.has(name)) {
        // disabled は link の HTML 属性だが、React の link の型には含まれていない。
        out.push(name === "disabled" ? ` {...{ disabled: true }}` : ` ${prop}`);
      } else if (name === "hidden" && value === "") {
        // hidden には until-found などの文字列の値もあるため、値の付いた属性は変えない。
        out.push(" hidden");
      } else if (mapped || HEAD_PLAIN_ATTRS.has(name) || name.includes("-")) {
        out.push(` ${prop}=${jsxString(value)}`);
      } else {
        // React の型に無い属性（language・scheme など）をそのまま書くと、型チェックで公開のビルドが止まる。
        // スプレッドで渡せば型の検査を受けず、HTML の属性としてそのまま出力される
        out.push(` {...{ ${codeLiteral(name)}: ${codeLiteral(value)} }}`);
      }
    }
    return out.join("");
  };
  const out: string[] = [];
  // raw text や RCDATA の境界にも HTML のトークナイザーを使う。二重にエスケープした状態の
  // script は、最初の </script> の並びでは終わらない。
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  for (const node of fragment.childNodes) {
    if (!("tagName" in node)) continue;
    const tag = node.tagName;
    if (["script", "style", "noscript", "title"].includes(tag)) {
      const location = node.sourceCodeLocation;
      if (!location?.startTag) continue;
      // デコードした文字ではなく、元のソースを残す。title の文字参照を二度デコードしてはいけない。
      // script・style・noscript の中身も変えてはいけない。
      // ファイルの終わりでは、parse5 が要素の終わりを開始タグの位置に残すことがあるが、
      // その子のテキストには、ソース全体の範囲が記録されている。
      const bodyEnd = location.endTag?.startOffset ?? node.childNodes.reduce(
        (end, child) => Math.max(end, child.sourceCodeLocation?.endOffset ?? 0), location.endOffset,
      );
      const body = html.slice(location.startTag.endOffset, bodyEnd);
      out.push(
        body.trim()
          ? `${indent}<${tag}${attrsJsx(node.attrs)}\n${indent}  dangerouslySetInnerHTML={{ __html: ${codeLiteral(body)} }}\n${indent}/>`
          : `${indent}<${tag}${attrsJsx(node.attrs)} />`
      );
    } else if (["meta", "link", "base"].includes(tag)) {
      out.push(`${indent}<${tag}${attrsJsx(node.attrs)} />`);
    }
  }
  return out.length ? "\n" + out.join("\n") : "";
}
