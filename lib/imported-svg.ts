import { decodeCssEscapes } from "./css-escape";
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

function hasClosedTags(node: Html.Node, input: string): boolean {
  if (!("tagName" in node)) return true;
  const loc = node.sourceCodeLocation;
  if (!loc) return false;
  const selfClosing = !!loc.startTag && /\/>\s*$/.test(input.slice(loc.startTag.startOffset, loc.startTag.endOffset));
  if (!loc.endTag && !selfClosing) return false;
  return !("childNodes" in node) || node.childNodes.every((child) => hasClosedTags(child, input));
}

function sanitizeSvgWithoutDom(input: string): { original: string; cleaned: string; wellFormed: boolean } {
  let hasParseError = false;
  const fragment = parseFragment(input, {
    sourceCodeLocationInfo: true,
    onParseError: () => { hasParseError = true; },
  });
  const trimStart = input.length - input.trimStart().length;
  const trimEnd = input.trimEnd().length;
  const roots = fragment.childNodes.filter((node) => !(node.nodeName === "#text" && !("value" in node && node.value.trim())));
  const root = roots.length === 1 ? roots[0] : undefined;
  const rootLoc = root && "tagName" in root ? root.sourceCodeLocation : undefined;
  const wellFormed = !hasParseError &&
    trimEnd > trimStart &&
    !!root &&
    "tagName" in root &&
    root.tagName.toLowerCase() === "svg" &&
    !!rootLoc?.endTag &&
    rootLoc.startOffset === trimStart &&
    rootLoc.endOffset === trimEnd &&
    hasClosedTags(root, input);
  const original = serialize(fragment);
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
      const decoded = decodeCssEscapes(attr.value).replace(/\/\*[\s\S]*?\*\//g, "");
      if (/\burl\s*\(/i.test(decoded)) {
        return /^\s*url\(\s*["']?#[\w.-]+["']?\s*\)\s*$/i.test(attr.value);
      }
      return !/(?:javascript|vbscript|data|https?|file)\s*:/i.test(decoded);
    });
    if ("childNodes" in node) node.childNodes = node.childNodes.filter((child) => safeNode(child, true));
    return true;
  };
  fragment.childNodes = fragment.childNodes.filter((node) => safeNode(node, false));
  return { original, cleaned: serialize(fragment), wellFormed };
}

/** 受け取ったアイコンのマークアップを、環境によらない単一の許可リストで検証する。 */
export function isSafeImportedSvg(svg: string): boolean {
  if (typeof svg !== "string") return false;
  if (verifiedSafeSvgs.has(svg)) return true;
  const { original, cleaned, wellFormed } = sanitizeSvgWithoutDom(svg);
  const safe = wellFormed && original === cleaned;
  if (safe) rememberSafeSvg(svg);
  return safe;
}

/**
 * インラインのアイコンは生成したサイトで HTML として描画されるため、取り込みの境界で無害化する。
 * 安全な編集可能な doc.json が1バイトも変わらず往復できるよう、構文木が変わらないときは元の文字列を残す。
 */
export function sanitizeImportedSvg(svg: string): string {
  if (verifiedSafeSvgs.has(svg)) return svg;
  const { original, cleaned, wellFormed } = sanitizeSvgWithoutDom(svg);
  const out = wellFormed && original === cleaned ? svg : cleaned;
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
        node.icon && typeof node.icon === "object" &&
        !Array.isArray(node.icon) && typeof node.icon.svg === "string" && node.icon.svg) {
      node.icon.svg = sanitizeImportedSvg(node.icon.svg);
    }
  }
  return doc;
}

export function hasSafeNodeIcon(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const icon = (node as { icon?: unknown }).icon;
  if (icon == null) return true;
  if (typeof icon !== "object" || Array.isArray(icon)) return false;
  return isSafeImportedSvg((icon as { svg?: unknown }).svg as string);
}

export function hasSafeInlineIcons(doc: unknown): boolean {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  const nodes = (doc as { nodes?: unknown }).nodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return false;
  return Object.values(nodes).every(hasSafeNodeIcon);
}

const UPLOADED_SVG_TAGS = new Set([
  ...staticTags,
  "style", "image", "switch", "marker", "textpath", "view", "metadata",
]);
const TEXT_ONLY_SVG_TAGS = new Set(["style", "title", "desc", "metadata"]);
const SAFE_RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i;

function isSafeUploadedSvgCss(css: string): boolean {
  const decoded = decodeCssEscapes(css).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b|\bexpression\s*\(|-moz-binding\s*:|\bbehavior\s*:/i.test(decoded)) return false;
  for (const match of decoded.matchAll(/\burl\s*\(([^)]*)\)/gi)) {
    const target = match[1].trim().replace(/^['"]|['"]$/g, "").trim();
    if (!/^#[A-Za-z0-9_.:-]+$/.test(target) && !SAFE_RASTER_DATA_URL.test(target)) return false;
  }
  const stripped = decoded.replace(/\burl\s*\([^)]*\)/gi, "");
  return !/(?:javascript|vbscript|data|https?|file)\s*:/i.test(stripped);
}

/** Validate uploaded image/svg+xml assets so active scripts, DTDs, and external resources cannot be stored. */
export function isSafeUploadedSvg(bytes: ArrayBuffer | Uint8Array): boolean {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  const body = raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^(?:<\?xml(?:\s+(?:version|encoding|standalone)\s*=\s*(?:"[^"<>&]*"|'[^'<>&]*'))+\s*\?>\s*)?/i, "");
  if (!body || /<\?|<!\s*(?:doctype|entity|element|attlist|notation)\b/i.test(body)) return false;

  let hasParseError = false;
  const fragment = parseFragment(body, {
    sourceCodeLocationInfo: true,
    onParseError: () => { hasParseError = true; },
  });
  if (hasParseError) return false;

  const isGenuineComment = (node: Html.Node): boolean => {
    const loc = "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
    if (!loc) return false;
    const slice = body.slice(loc.startOffset, loc.endOffset);
    return slice.startsWith("<!--") && slice.endsWith("-->");
  };

  let svgRoot: Html.Element | null = null;
  for (const child of fragment.childNodes) {
    if (child.nodeName === "#text") {
      if ("value" in child && child.value.trim()) return false;
      continue;
    }
    if (child.nodeName === "#comment") {
      if (!isGenuineComment(child)) return false;
      continue;
    }
    if (!("tagName" in child) || svgRoot) return false;
    svgRoot = child;
  }
  const hasSvgXmlns = svgRoot?.attrs.some((a) => !a.prefix && a.name.toLowerCase() === "xmlns" && a.value.trim() === SVG_NS);
  if (!svgRoot || !hasSvgXmlns || svgRoot.namespaceURI !== SVG_NS || svgRoot.tagName.toLowerCase() !== "svg" ||
      !hasClosedTags(svgRoot, body)) {
    return false;
  }

  const checkElement = (el: Html.Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (el.namespaceURI !== SVG_NS || !UPLOADED_SVG_TAGS.has(tag)) return false;
    for (const attr of el.attrs) {
      const name = attr.name.toLowerCase();
      const key = (attr.prefix ? attr.prefix.toLowerCase() + ":" : "") + name;
      const value = attr.value.trim();
      if (name.startsWith("on") || key.startsWith("on") || key === "xml:base") return false;
      if (key === "xmlns") {
        if (value !== SVG_NS) return false;
        continue;
      }
      if (key.startsWith("xmlns:")) {
        if (key !== "xmlns:xlink" || value !== "http://www.w3.org/1999/xlink") return false;
        continue;
      }
      if (attr.prefix && attr.prefix !== "xlink" && attr.prefix !== "xml") return false;
      if (key === "href" || key === "xlink:href" || key === "src") {
        const allowRaster = (tag === "image" || tag === "feimage") && key !== "src";
        if (!/^#[A-Za-z0-9_.:-]+$/.test(value) && !(allowRaster && SAFE_RASTER_DATA_URL.test(value))) {
          return false;
        }
        continue;
      }
      if (key === "style") {
        if (!isSafeUploadedSvgCss(value)) return false;
        continue;
      }
      if (!isSafeUploadedSvgCss(value)) return false;
    }
    const textOnly = TEXT_ONLY_SVG_TAGS.has(tag);
    for (const child of el.childNodes) {
      if (child.nodeName === "#text") {
        if (tag === "style" && "value" in child && !isSafeUploadedSvgCss(child.value)) return false;
        continue;
      }
      if (child.nodeName === "#comment") {
        if (!isGenuineComment(child)) return false;
        continue;
      }
      if (textOnly || !("tagName" in child) || !checkElement(child)) return false;
    }
    return true;
  };

  return checkElement(svgRoot);
}
