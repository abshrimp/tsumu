/**
 * カスタムコード（<head> に入れるHTML）を JSX に変換する
 */

import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";
import { jsxString } from "./render-helpers";
import { codeLiteral } from "./code-literal";

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

// HTML の真偽属性は値が空でも "false" でも、存在すれば有効になる。
// React には文字列ではなく boolean を渡す（data-* / aria-* は含めない）。
const HEAD_BOOLEAN_ATTRS = new Set(["async", "defer", "disabled", "nomodule", "itemscope"]);

/**
 * サイト設定の「head に追加する HTML」を、<head> の子に置く JSX にする。
 * script / style / noscript / title は中身を dangerouslySetInnerHTML で、meta / link / base は属性だけ出す
 * （コメントや、ほかの要素・文字は head に置けないので落とす）
 */
export function headHtmlToJsx(html: string, indent: string): string {
  const attrsJsx = (attrs: Html.Element["attrs"]) => {
    const out: string[] = [];
    // Parse attribute values with HTML semantics (full named references,
    // invalid numeric references and duplicate attributes), then emit them
    // as literal JSX strings so the compiler cannot decode them a second time.
    for (const { name, value } of attrs) {
      // style は React では文字列にできない（head の中は表示されないので落とす）。
      // 属性名は JSX にそのまま書くので、名前の形でないもの（{ や ( を含むなど）も落とす
      if (name.startsWith("on") || name === "style" || !/^[a-z][a-z0-9._:-]*$/.test(name)) continue;
      const mapped = Object.hasOwn(HEAD_ATTR_NAMES, name);
      const prop = mapped ? HEAD_ATTR_NAMES[name] : name;
      if (HEAD_BOOLEAN_ATTRS.has(name)) {
        // disabled は link の HTML 属性だが、React の link 型には含まれていない。
        out.push(name === "disabled" ? ` {...{ disabled: true }}` : ` ${prop}`);
      } else if (name === "hidden" && value === "") {
        // hidden は until-found などの文字列値もあるため、値付きの属性は変えない。
        out.push(" hidden");
      } else if (mapped || HEAD_PLAIN_ATTRS.has(name) || name.includes("-")) {
        out.push(` ${prop}=${jsxString(value)}`);
      } else {
        // React の型に無い属性（language・scheme など）は、そのまま書くと型チェックで公開のビルドが止まる。
        // 展開で渡せば型の検査を受けず、HTML の属性としてそのまま出る
        out.push(` {...{ ${codeLiteral(name)}: ${codeLiteral(value)} }}`);
      }
    }
    return out.join("");
  };
  const out: string[] = [];
  // Use the HTML tokenizer for raw-text/RCDATA boundaries too: a script in
  // double-escaped state does not end at its first </script> sequence.
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  for (const node of fragment.childNodes) {
    if (!("tagName" in node)) continue;
    const tag = node.tagName;
    if (["script", "style", "noscript", "title"].includes(tag)) {
      const location = node.sourceCodeLocation;
      if (!location?.startTag) continue;
      // Keep raw source, not decoded text: title entities must not be decoded
      // twice, and scripts/styles/noscript content must remain unchanged.
      // At EOF parse5 can leave the element end at its start tag while its
      // text child still records the complete source span.
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
