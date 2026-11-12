/**
 * Detect SVG effects that benefit from rendering at a higher resolution on iOS Safari.
 * Only effects on painted elements count: merely defining an unused <filter> is not enough.
 * Parse as markup rather than searching the raw source, so comments and embedded data
 * cannot trigger a false positive. This module also runs in Node (without DOMParser).
 */
import { parseFragment, type DefaultTreeAdapterTypes as Html } from "parse5";

const SVG_NS = "http://www.w3.org/2000/svg";
const NOT_PAINTED = new Set([
  "defs", "symbol", "filter", "style", "clippath", "mask", "pattern",
  "lineargradient", "radialgradient", "marker",
]);

function isSvgElement(node: Html.Node): node is Html.Element {
  return "tagName" in node && node.namespaceURI === SVG_NS;
}

function attribute(element: Html.Element, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
}

function fragmentId(value: string | undefined): string | undefined {
  const match = /^#([^\s"'()]+)$/.exec(value?.trim() ?? "");
  return match?.[1];
}

function filterDeclarations(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/(?:^|;)\s*(?:-webkit-)?filter\s*:\s*([^;}]+)/gi)]
    .map((match) => match[1].replace(/\s*!important\s*$/i, "").trim());
}

function matchesCompoundSelector(selector: string, element: Html.Element): boolean {
  // Match the common SVG stylesheet selectors: rect, .class, #id, g.class.
  // Do not guess when selectors use unsupported syntax.
  const simple = selector.replace(/::?[\w-]+(?:\([^()]*\))?/g, "");
  if (!simple || !/^(?:\*|[a-z][\w-]*)?(?:[.#][\w-]+)*$/i.test(simple)) return false;
  const tag = /^[a-z][\w-]*/i.exec(simple)?.[0];
  if (tag && tag.toLowerCase() !== element.tagName.toLowerCase()) return false;
  const classes = (attribute(element, "class") ?? "").split(/\s+/);
  for (const match of simple.matchAll(/([.#])([\w-]+)/g)) {
    if (match[1] === "#" && attribute(element, "id") !== match[2]) return false;
    if (match[1] === "." && !classes.includes(match[2])) return false;
  }
  return true;
}

function matchesSelector(selector: string, element: Html.Element): boolean {
  const parts = selector.trim().split(/\s*(?:>|\s)\s*/).filter(Boolean);
  if (!parts.length || !matchesCompoundSelector(parts[parts.length - 1], element)) return false;
  let ancestor: Html.Node | null = element.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (ancestor && (!isSvgElement(ancestor) || !matchesCompoundSelector(parts[i], ancestor))) {
      ancestor = "parentNode" in ancestor ? ancestor.parentNode : null;
    }
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

function containsBlurPrimitive(filter: Html.Element): boolean {
  const visit = (node: Html.Node): boolean => {
    if (isSvgElement(node)) {
      const tag = node.tagName.toLowerCase();
      if (tag === "fedropshadow") return true;
      if (tag === "fegaussianblur") {
        const deviation = attribute(node, "stdDeviation");
        if (deviation?.trim().split(/[\s,]+/).some((value) =>
          !Number.isFinite(Number(value)) || Number(value) > 0)) return true;
      }
    }
    return "childNodes" in node && node.childNodes.some(visit);
  };
  return filter.childNodes.some(visit);
}

export function svgUsesBlurOrShadow(source: string): boolean {
  if (!source || !/<svg(?:\s|>)/i.test(source)) return false;
  const fragment = parseFragment(source);
  const elements: Html.Element[] = [];
  const walk = (node: Html.Node): void => {
    if (isSvgElement(node)) elements.push(node);
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(fragment);
  const root = elements.find((element) => element.tagName.toLowerCase() === "svg");
  if (!root) return false;

  const byId = new Map<string, Html.Element>();
  const filters = new Map<string, Html.Element>();
  const rules: { selector: string; value: string }[] = [];
  for (const element of elements) {
    const id = attribute(element, "id");
    if (id) {
      byId.set(id, element);
      if (element.tagName.toLowerCase() === "filter") filters.set(id, element);
    }
    if (element.tagName.toLowerCase() !== "style") continue;
    const css = element.childNodes.map((child) =>
      child.nodeName === "#text" && "value" in child ? String(child.value) : "").join("")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith("@")) continue;
      for (const value of filterDeclarations(match[2])) {
        for (const item of selector.split(",")) rules.push({ selector: item.trim(), value });
      }
    }
  }

  const filtered = (id: string, visited = new Set<string>()): boolean => {
    if (visited.has(id)) return false;
    visited.add(id);
    const filter = filters.get(id);
    if (!filter) return false;
    if (containsBlurPrimitive(filter)) return true;
    const inherited = fragmentId(attribute(filter, "href"));
    return !!inherited && filtered(inherited, visited);
  };

  const needsCrisp = (value: string): boolean => {
    if (/\bdrop-shadow\s*\(/i.test(value)) return true;
    for (const match of value.matchAll(/\bblur\s*\(\s*([^)]*)\)/gi)) {
      const amount = Number.parseFloat(match[1]);
      if (!Number.isFinite(amount) || amount > 0) return true;
    }
    for (const match of value.matchAll(/url\(\s*(["']?)#([^\s"')]+)\1\s*\)/gi)) {
      if (filtered(match[2])) return true;
    }
    return false;
  };

  const seen = new Set<Html.Element>();
  const painted = (element: Html.Element): boolean => {
    if (seen.has(element)) return false;
    seen.add(element);
    const inline = filterDeclarations(attribute(element, "style") ?? "").at(-1);
    const stylesheet = rules.filter((rule) => matchesSelector(rule.selector, element)).at(-1)?.value;
    const value = inline ?? stylesheet ?? attribute(element, "filter");
    if (value && needsCrisp(value)) return true;

    // Shapes referenced from <defs>/<symbol> are painted through <use>.
    if (element.tagName.toLowerCase() === "use") {
      const ref = fragmentId(attribute(element, "href"));
      if (ref) {
        const target = byId.get(ref);
        if (target && painted(target)) return true;
      }
    }
    return element.childNodes.some((child) =>
      isSvgElement(child) && !NOT_PAINTED.has(child.tagName.toLowerCase()) && painted(child));
  };
  return painted(root);
}
