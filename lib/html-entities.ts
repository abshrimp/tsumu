import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";

const ENTITY_CANDIDATE_RE = /&(?:#[xX][\da-fA-F]+;?|#\d+;?|[A-Za-z][A-Za-z0-9]*(?:;|=?))/g;
const MAX_CACHE_ENTRIES = 512;
const textCache = new Map<string, string>();
const attrCache = new Map<string, string>();

function decodeCandidate(candidate: string, attribute: boolean): string {
  const cache = attribute ? attrCache : textCache;
  const cached = cache.get(candidate);
  if (cached !== undefined) return cached;

  let decoded = candidate;
  if (attribute) {
    const el = parseFragment(`<a b="${candidate}">`).childNodes[0] as Html.Element | undefined;
    decoded = el?.attrs[0]?.value ?? candidate;
  } else {
    const node = parseFragment(candidate).childNodes[0] as Html.TextNode | undefined;
    decoded = node && "value" in node ? node.value : candidate;
  }

  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(candidate, decoded);
  return decoded;
}

/** Decode HTML5 named and numeric character references using data-state rules. */
export function decodeHtmlText(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(ENTITY_CANDIDATE_RE, (match) => decodeCandidate(match, false));
}

/** Decode HTML5 named and numeric character references using attribute-value rules. */
export function decodeHtmlAttribute(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(ENTITY_CANDIDATE_RE, (match) => decodeCandidate(match, true));
}
