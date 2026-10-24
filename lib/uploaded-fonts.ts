import type { NodeStyles, SiteDoc } from "./types";

/** Unregister a local font and restore inherited font family wherever it was applied. */
export function removeUploadedFont(doc: SiteDoc, assetId: string): number {
  const removed = (doc.uploadedFonts ?? []).filter(font => font.assetId === assetId);
  if (!removed.length) return 0;
  const families = new Set(removed.map(font => font.family));
  const remaining = (doc.uploadedFonts ?? []).filter(font => font.assetId !== assetId);
  if (remaining.length) doc.uploadedFonts = remaining;
  else delete doc.uploadedFonts;
  const clearStyles = (styles: NodeStyles | undefined) => {
    for (const states of Object.values(styles ?? {})) {
      for (const style of Object.values(states)) {
        if (style?.fontFamily && families.has(style.fontFamily)) delete style.fontFamily;
      }
    }
  };
  for (const node of Object.values(doc.nodes)) clearStyles(node.styles);
  for (const page of Object.values(doc.pages)) clearStyles(page.bodyStyles);
  return removed.length;
}
