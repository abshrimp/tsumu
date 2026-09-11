import { tokenizer, tokTypes } from "acorn";
import { htmlZipElements } from "./html-zip-source";
import type { Asset, HtmlZipPage } from "./types";
import { archiveBaseUrl, archiveResolver } from "./zip-references";

type Literal = { value: string; start: number; end: number; template: boolean };

export function executableScriptType(type: string) {
  return !type || /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/i.test(type);
}

export function scriptLiterals(body: string, type: string): Literal[] {
  const tick = String.fromCharCode(96);
  const literals: Literal[] = [];
  try {
    for (const token of tokenizer(body, {
      ecmaVersion: "latest", sourceType: type.toLowerCase() === "module" ? "module" : "script",
      allowHashBang: true,
    })) {
      if (!("value" in token) || typeof token.value !== "string") continue;
      if (token.type === tokTypes.string) {
        literals.push({ value: token.value, start: token.start, end: token.end, template: false });
      } else if (token.type === tokTypes.template &&
          body[token.start - 1] === tick && body[token.end] === tick &&
          body.slice(token.start, token.end) === token.value) {
        literals.push({ value: token.value, start: token.start, end: token.end, template: true });
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // No partial edits to a script with invalid JavaScript.
    literals.length = 0;
  }

  return literals;
}

export function quotedScriptUrl(literal: Literal, resolved: string) {
  const tick = String.fromCharCode(96);
  return literal.template
    ? resolved.replaceAll("\\", "\\\\").replaceAll("<", "\\u003c").replaceAll(tick, "\\" + tick).replaceAll("$" + "{", "\\" + "$" + "{")
    : JSON.stringify(resolved).replaceAll("<", "\\u003c");
}

// Only executable inline scripts: preserve comments, regex, interpolated
// templates, scripts with src, and data scripts such as JSON-LD.
function eachScriptLiteral(source: string, path: string, urls: Map<string, string>,
    visit: (literal: Literal, resolved: string) => void): void {
  const { elements, baseElement } = htmlZipElements(source);
  const base = archiveBaseUrl(path, baseElement?.attrs.find(attr => attr.name === "href")?.value);
  // Relative fetches and module imports with an external base stay on that origin.
  if (base && base.protocol !== "file:") return;
  const resolve = archiveResolver(path, base, urls);
  for (const node of elements) {
    if (node.tagName === "script") {
      const type = node.attrs.find(attr => attr.name === "type")?.value.trim() ?? "";
      const loc = node.sourceCodeLocation;
      if (executableScriptType(type) && !node.attrs.some(attr => attr.name === "src") && loc?.startTag && loc.endTag) {
        const offset = loc.startTag.endOffset;
        const body = source.slice(offset, loc.endTag.startOffset);
        for (const literal of scriptLiterals(body, type)) {
          if (literal.value.trim() !== literal.value) continue;
          visit({ ...literal, start: offset + literal.start, end: offset + literal.end }, resolve(literal.value));
        }
      }
    }
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
  eachScriptLiteral(source, zip.path, urls, (literal, resolved) => {
    if (resolved === literal.value) return;
    const text = quotedScriptUrl(literal, resolved);
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
  if (!zip || !/<script[\s>]/i.test(source)) return [];
  const urls = archiveUrls(zip, assets, asset => asset.id);
  const missing = new Set<string>();
  eachScriptLiteral(source, zip.path, urls, (literal, resolved) => {
    const value = literal.value;
    if (value.length > 600 || !mediaName.test(value) || external.test(value)) return;
    if (resolved === value) missing.add(value);
  });
  return [...missing];
}
