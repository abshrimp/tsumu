import DOMPurify from "dompurify";
import type { SiteDoc } from "./types";
import { parseFragment, serialize, type DefaultTreeAdapterTypes as Html } from "parse5";

// Imports normally run in the browser. Keep the same trust boundary when
// restoreImportAssets is invoked by a non-DOM caller (e.g. a server or test).
// The Node path intentionally uses a smaller SVG vocabulary than DOMPurify;
// unknown elements and attributes are removed rather than trusted.
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
      // XML namespace declarations are trusted fixed URIs, not fetchable
      // resources. Rejecting their "http:" spelling would remove xmlns from
      // every normal icon, invalidating otherwise safe imported SiteDocs.
      if (key === "xmlns") return attr.value === SVG_NS;
      if (key === "xmlns:xlink") return attr.value === "http://www.w3.org/1999/xlink";
      // External resource loading is not part of an editable icon.
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


/** Validate server-received icon markup without relying on browser globals.
 * The browser import may sanitize an unsafe source first; a direct API request
 * must not bypass that import boundary.
 */
export function isSafeImportedSvg(svg: string): boolean {
  if (typeof svg !== "string") return false;
  return serialize(parseFragment(svg)) === sanitizeSvgWithoutDom(svg);
}

/** Inline icons are rendered as HTML in generated sites, so sanitise them at the import boundary. */
let purifier: ReturnType<typeof DOMPurify> | undefined;

export function sanitizeImportedSvg(svg: string): string {
  if (typeof window === "undefined") return sanitizeSvgWithoutDom(svg);
  purifier ??= DOMPurify(window);
  const cleaned = purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script"],
  });
  // A safe editable doc.json must round-trip byte-for-byte. DOMPurify may
  // reserialize harmless SVG (e.g. self-closing tags) without changing its DOM.
  // Keep authored bytes only when both parsed SVG trees are identical.
  const normalised = (input: string): string | null => {
    const parsed = new DOMParser().parseFromString(input, "image/svg+xml");
    return parsed.querySelector("parsererror") ? null : parsed.documentElement.outerHTML;
  };
  const originalTree = normalised(svg);
  return originalTree !== null && originalTree === normalised(cleaned) ? svg : cleaned;
}

/** Sanitize untrusted inline icon SVG, whether imported from a file or restored from GitHub. */
export function sanitizeImportedInlineIcons(doc: SiteDoc): SiteDoc {
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "icon" && node.icon?.svg) node.icon.svg = sanitizeImportedSvg(node.icon.svg);
  }
  return doc;
}
