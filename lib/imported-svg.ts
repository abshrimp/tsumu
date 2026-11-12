import DOMPurify from "dompurify";
import type { SiteDoc } from "./types";
import { parseFragment, serialize, type DefaultTreeAdapterTypes as Html } from "parse5";

// 取り込みは通常ブラウザで行う。DOM の無い呼び出し元（サーバーやテストなど）から
// restoreImportAssets を呼んだ場合も、同じ信頼の境界を保つ。
// Node.js の経路では、意図的に DOMPurify より少ない SVG の語彙を使う。
// 知らない要素や属性は、信頼せずに取り除く。
const SVG_NS = "http://www.w3.org/2000/svg";
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


/** サーバーが受け取ったアイコンのマークアップを、ブラウザのグローバルに頼らずに検証する。
 * ブラウザでの取り込みでは、先に安全でないソースを無害化していることがあるが、
 * API への直接のリクエストで、その取り込みの境界をすり抜けてはいけない。
 */
export function isSafeImportedSvg(svg: string): boolean {
  if (typeof svg !== "string") return false;
  return serialize(parseFragment(svg)) === sanitizeSvgWithoutDom(svg);
}

/** インラインのアイコンは生成したサイトで HTML として描画されるため、取り込みの境界で無害化する。 */
let purifier: ReturnType<typeof DOMPurify> | undefined;

export function sanitizeImportedSvg(svg: string): string {
  if (typeof window === "undefined") return sanitizeSvgWithoutDom(svg);
  purifier ??= DOMPurify(window);
  const cleaned = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script"],
  });
  // 安全な編集可能な doc.json は、1バイトも変わらずに往復できなければならない。DOMPurify は、
  // DOM を変えずに、無害な SVG を直列化し直すことがある（自己終了タグなど）。
  // 解析した2つの SVG のツリーがまったく同じ場合だけ、書かれたバイト列を残す。
  const normalised = (input: string): string | null => {
    const parsed = new DOMParser().parseFromString(input, "image/svg+xml");
    return parsed.querySelector("parsererror") ? null : parsed.documentElement.outerHTML;
  };
  const originalTree = normalised(svg);
  return originalTree !== null && originalTree === normalised(cleaned) ? svg : cleaned;
}

/** ファイルから取り込んだものも、GitHub から復元したものも、信頼できないインラインのアイコンの SVG を無害化する。 */
export function sanitizeImportedInlineIcons(doc: SiteDoc): SiteDoc {
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "icon" && node.icon?.svg) node.icon.svg = sanitizeImportedSvg(node.icon.svg);
  }
  return doc;
}
