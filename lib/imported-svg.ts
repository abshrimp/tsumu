import type { SiteDoc } from "./types";
import { parseFragment, serialize, type DefaultTreeAdapterTypes as Html } from "parse5";

// ブラウザでの取り込み・履歴の復元・サーバーでの保存で、すべて同じ SVG の語彙だけを許可する。
// 知らない要素や属性、スタイル要素、外部リソースの参照は、信頼せずに取り除く。
const SVG_NS = "http://www.w3.org/2000/svg";
const SAFE_SVG_CACHE_LIMIT = 1024;
const verifiedSafeSvgs = new Set<string>();

function rememberSafeSvg(svg: string): void {
  if (verifiedSafeSvgs.size >= SAFE_SVG_CACHE_LIMIT) verifiedSafeSvgs.clear();
  verifiedSafeSvgs.add(svg);
}
const staticTags = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "symbol", "use", "title", "desc", "clippath", "mask",
  "pattern", "lineargradient", "radialgradient", "stop", "filter", "feblend",
  "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix",
  "fediffuselighting", "fedisplacementmap", "fedistantlight", "fedropshadow",
  "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr", "fegaussianblur",
  "feimage", "femerge", "femergenode", "femorphology", "feoffset",
  "fepointlight", "fespecularlighting", "fespotlight", "fetile", "feturbulence",
]);
const staticAttrs = new Set([
  "xmlns", "xmlns:xlink", "viewbox", "width", "height", "x", "y", "x1", "x2",
  "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-miterlimit", "stroke-opacity", "opacity", "color", "offset",
  "stop-color", "stop-opacity", "clip-path", "clip-rule", "mask", "filter",
  "id", "class", "role", "aria-hidden", "aria-label", "preserveaspectratio",
  "vector-effect", "font-size", "font-family", "font-weight", "text-anchor",
  "dominant-baseline", "href", "xlink:href", "gradientunits", "gradienttransform",
  "patternunits", "patterntransform", "spreadmethod", "filterunits",
  "result", "in", "in2", "stddeviation", "dx", "dy", "values", "type",
  "mode", "operator", "k1", "k2", "k3", "k4", "basefrequency", "numoctaves",
  "seed", "stitchtiles",
]);

function sanitizeSvgWithoutDom(input: string): string {
  const fragment = parseFragment(input);
  let seenRoot = false;
  const safeNode = (node: Html.Node, parentIsSvg: boolean): boolean => {
    if (!("tagName" in node)) return parentIsSvg && node.nodeName === "#text";
    if (node.namespaceURI !== SVG_NS || !staticTags.has(node.tagName.toLowerCase()) ||
        (!parentIsSvg && (seenRoot || node.tagName.toLowerCase() !== "svg"))) return false;
    if (!parentIsSvg) seenRoot = true;
    node.attrs = node.attrs.filter((attr) => {
      const key = (attr.prefix ? attr.prefix + ":" : "") + attr.name.toLowerCase();
      if (!staticAttrs.has(key) || /^on/i.test(key)) return false;
      // XML の名前空間の宣言は、固定の信頼できる URI で、取得するリソースではない。
      // その「http:」の綴りを拒否すると、通常のすべてのアイコンから xmlns が消え、
      // 本来は安全な取り込んだ SiteDoc が無効になってしまう。
      if (key === "xmlns") return attr.value === SVG_NS;
      if (key === "xmlns:xlink") return attr.value === "http://www.w3.org/1999/xlink";
      // 外部のリソースの読み込みは、編集可能なアイコンには含めない。
      if (key === "href" || key === "xlink:href") return /^#[\w.-]+$/.test(attr.value);
      if (/\burl\s*\(/i.test(attr.value)) {
        return /^\s*url\(\s*["']?#[\w.-]+["']?\s*\)\s*$/i.test(attr.value);
      }
      return !/(?:javascript|vbscript|data|https?|file)\s*:/i.test(attr.value);
    });
    if ("childNodes" in node) node.childNodes = node.childNodes.filter((child) => safeNode(child, true));
    return true;
  };
  fragment.childNodes = fragment.childNodes.filter((node) => safeNode(node, false));
  return serialize(fragment);
}


/** 受け取ったアイコンのマークアップを、環境によらない単一の許可リストで検証する。 */
export function isSafeImportedSvg(svg: string): boolean {
  if (typeof svg !== "string") return false;
  if (verifiedSafeSvgs.has(svg)) return true;
  const safe = serialize(parseFragment(svg)) === sanitizeSvgWithoutDom(svg);
  if (safe) rememberSafeSvg(svg);
  return safe;
}

/**
 * インラインのアイコンは生成したサイトで HTML として描画されるため、取り込みの境界で無害化する。
 * 安全な編集可能な doc.json が1バイトも変わらず往復できるよう、構文木が変わらないときは元の文字列を残す。
 */
export function sanitizeImportedSvg(svg: string): string {
  if (verifiedSafeSvgs.has(svg)) return svg;
  const cleaned = sanitizeSvgWithoutDom(svg);
  const out = serialize(parseFragment(svg)) === cleaned ? svg : cleaned;
  rememberSafeSvg(out);
  return out;
}

/** ファイルから取り込んだものも、GitHub から復元したものも、信頼できないインラインのアイコンの SVG を無害化する。 */
export function sanitizeImportedInlineIcons<T>(doc: T): T {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return doc;
  const nodes = (doc as Partial<SiteDoc>).nodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return doc;
  for (const node of Object.values(nodes)) {
    if (node && typeof node === "object" && !Array.isArray(node) &&
        node.type === "icon" && node.icon && typeof node.icon === "object" &&
        !Array.isArray(node.icon) && typeof node.icon.svg === "string" && node.icon.svg) {
      node.icon.svg = sanitizeImportedSvg(node.icon.svg);
    }
  }
  return doc;
}
