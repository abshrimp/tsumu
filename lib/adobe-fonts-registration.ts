import type { AdobeFont, NodeStyles, SiteDoc } from "./types";

/** A Web Project uses one loader; dynamic takes precedence for CJK subsets. */
export function registerAdobeFont(doc: SiteDoc, font: AdobeFont): void {
  const existing = (doc.adobeFonts ?? []).filter(current => current.family !== font.family);
  const loading: AdobeFont["loading"] = font.loading === "dynamic" ||
    existing.some(current => current.kitId === font.kitId && current.loading === "dynamic")
    ? "dynamic" : "css";
  doc.adobeFonts = [
    ...existing.map(current => current.kitId === font.kitId ? { ...current, loading } : current),
    { ...font, loading },
  ];
}


/**
 * Remove a Web Project from the current site, not from the user's Adobe account.
 * Also drop font-family declarations that would otherwise keep referencing an
 * unregistered Adobe family. Caller commits this as one undoable document edit.
 */
export function removeAdobeWebProject(doc: SiteDoc, kitId: string): number {
  const removed = (doc.adobeFonts ?? []).filter(font => font.kitId === kitId);
  if (!removed.length) return 0;

  const families = new Set(removed.map(font => font.family));
  const remaining = (doc.adobeFonts ?? []).filter(font => font.kitId !== kitId);
  if (remaining.length) doc.adobeFonts = remaining;
  else delete doc.adobeFonts;

  const clearStyles = (styles: NodeStyles | undefined) => {
    if (!styles) return;
    for (const states of Object.values(styles)) {
      for (const style of Object.values(states)) {
        if (style && families.has(style.fontFamily)) delete style.fontFamily;
      }
    }
  };
  for (const node of Object.values(doc.nodes)) {
    clearStyles(node.styles);
    clearStyles(node.darkStyles);
  }
  for (const page of Object.values(doc.pages)) {
    clearStyles(page.bodyStyles);
    clearStyles(page.bodyDarkStyles);
  }
  return removed.length;
}
