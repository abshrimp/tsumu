import { tokenizer, tokTypes } from "acorn";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import type { Asset, HtmlZipPage } from "./types";
import { resolveZipReference } from "./zip-references";

type Literal = { value: string; start: number; end: number; template: boolean };

// Only executable inline scripts: preserve comments, regex, interpolated
// templates, scripts with src, and data scripts such as JSON-LD.
function eachScriptLiteral(source: string, visit: (literal: Literal) => void): void {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const pending: Html.Node[] = [doc];
  const tick = String.fromCharCode(96);
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node && node.tagName === "script") {
      const type = node.attrs.find(attr => attr.name === "type")?.value.trim() ?? "";
      const executable = !type || /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i.test(type);
      const loc = node.sourceCodeLocation;
      if (executable && !node.attrs.some(attr => attr.name === "src") && loc?.startTag && loc.endTag) {
        const offset = loc.startTag.endOffset;
        const body = source.slice(offset, loc.endTag.startOffset);
        const literals: Literal[] = [];
        try {
          for (const token of tokenizer(body, {
            ecmaVersion: "latest", sourceType: type.toLowerCase() === "module" ? "module" : "script",
            allowHashBang: true,
          })) {
            if (!("value" in token) || typeof token.value !== "string") continue;
            if (token.type === tokTypes.string) {
              literals.push({ value: token.value, start: offset + token.start, end: offset + token.end, template: false });
            } else if (token.type === tokTypes.template &&
                body[token.start - 1] === tick && body[token.end] === tick &&
                body.slice(token.start, token.end) === token.value) {
              literals.push({ value: token.value, start: offset + token.start, end: offset + token.end, template: true });
            }
          }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          // No partial edits to a script with invalid JavaScript.
          literals.length = 0;
        }
        for (const literal of literals) visit(literal);
      }
    }
    if ("content" in node) pending.push((node as Html.Template).content);
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
}

function archiveUrls(zip: HtmlZipPage, assets: Record<string, Asset>, url: (asset: Asset) => string): Map<string, string> {
  const result = new Map<string, string>();
  for (const id of zip.assetIds) {
    const asset = assets[id];
    if (!asset?.zip?.path) continue;
    const target = url(asset);
    if (target) result.set(asset.zip.path, target);
  }
  return result;
}

/** Map file URL literals in a derived HTML preview/export, never the editable source. */
export function rewriteHtmlZipScriptUrls(
  source: string, zip: HtmlZipPage | undefined, assets: Record<string, Asset>,
  resourceUrl: (asset: Asset) => string,
): string {
  if (!zip?.assetIds.length || !/<script[\s>]/i.test(source)) return source;
  const urls = archiveUrls(zip, assets, resourceUrl);
  if (!urls.size) return source;
  const edits: { start: number; end: number; text: string }[] = [];
  const tick = String.fromCharCode(96);
  eachScriptLiteral(source, literal => {
    const resolved = resolveZipReference(literal.value, zip.path, urls);
    if (resolved === literal.value) return;
    const text = literal.template
      ? resolved.replaceAll("\\", "\\\\").replaceAll(tick, "\\" + tick).replaceAll("$" + "{", "\\" + "$" + "{")
      : JSON.stringify(resolved).replaceAll("<", "\\u003c");
    edits.push({ start: literal.start, end: literal.end, text });
  });
  if (!edits.length) return source;
  let output = "", from = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    output += source.slice(from, edit.start) + edit.text;
    from = edit.end;
  }
  return output + source.slice(from);
}

const mediaName = /(?:^|\/)[^/?#\s<>]+\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp3|wav|ogg|m4a|aac|flac|mp4|webm|mov|woff2?|ttf|otf)(?:[?#]|$)/i;
const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/assets\/|\/api\/)/i;

/** Find media file names used in inline JavaScript but absent from its ZIP. */
export function missingHtmlZipScriptAssets(source: string, zip: HtmlZipPage | undefined, assets: Record<string, Asset>): string[] {
  if (!zip?.assetIds.length || !/<script[\s>]/i.test(source)) return [];
  const urls = archiveUrls(zip, assets, asset => asset.id);
  const missing = new Set<string>();
  eachScriptLiteral(source, literal => {
    const value = literal.value;
    if (value.length > 600 || !mediaName.test(value) || external.test(value)) return;
    if (resolveZipReference(value, zip.path, urls) === value) missing.add(value);
  });
  return [...missing];
}
