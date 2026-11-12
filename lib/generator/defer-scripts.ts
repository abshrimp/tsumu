/**
 * Make author-provided executable scripts inert in generated Next.js SSR markup.
 *
 * Imported HTML may mutate React-owned nodes (for example marquee text) while
 * the browser parses the server response, before React hydrates those nodes.
 * Keep the original script content and attributes in place, but change its
 * type so PageHtml can activate it after hydration.
 */
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const INERT_SCRIPT_TYPE = "application/x-tsumu-deferred";
const JS_TYPES = new Set([
  "application/ecmascript", "application/javascript",
  "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0",
  "text/javascript1.1", "text/javascript1.2", "text/javascript1.3",
  "text/javascript1.4", "text/javascript1.5", "text/jscript",
  "text/livescript", "text/x-ecmascript", "text/x-javascript",
]);

function isExecutable(attrs: Html.Element["attrs"]): boolean {
  const type = attrs.find((a) => a.name === "type")?.value.trim().toLowerCase() ?? "";
  // Preserve import maps, JSON-LD, speculation rules and unknown data types.
  return !type || type === "module" || JS_TYPES.has(type);
}

const escapeAttribute = (value: string) => value
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Parse HTML, not a script-tag regex: JavaScript can contain escaped closing
 * tags, comments, quotes and newlines. Only edit the start-tag source range,
 * preserving script bodies byte-for-byte for later execution.
 */
export function deferRunnableScripts(html: string): string {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const patches: { start: number; end: number; replacement: string }[] = [];
  const walk = (nodes: Html.ChildNode[]) => {
    for (const node of nodes) {
      if (!("tagName" in node) || node.namespaceURI !== HTML_NAMESPACE) continue;
      if (node.tagName === "script" && isExecutable(node.attrs)) {
        const location = node.sourceCodeLocation;
        const tag = location?.startTag;
        if (!tag) continue;
        let replacement = html.slice(tag.startOffset, tag.endOffset);
        const originalType = node.attrs.find((a) => a.name === "type")?.value;
        if (originalType !== undefined) {
          const typeLocation = location?.attrs?.type;
          if (!typeLocation) continue;
          replacement =
            replacement.slice(0, typeLocation.startOffset - tag.startOffset) +
            'type="' + INERT_SCRIPT_TYPE + '"' +
            replacement.slice(typeLocation.endOffset - tag.startOffset);
        } else {
          replacement = replacement.replace(/^<script\b/i,
            (name) => name + ' type="' + INERT_SCRIPT_TYPE + '"');
        }
        replacement = replacement.replace(/^<script\b/i, (name) =>
          name + ' data-tsumu-deferred=""' +
          (originalType === undefined ? "" :
            ' data-tsumu-original-type="' + escapeAttribute(originalType) + '"'));
        patches.push({
          start: tag.startOffset, end: tag.endOffset, replacement,
        });
      } else if (node.tagName !== "template" && node.tagName !== "noscript") {
        walk(node.childNodes);
      }
    }
  };
  walk(fragment.childNodes);
  let result = html;
  for (const patch of patches.reverse()) {
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end);
  }
  return result;
}
