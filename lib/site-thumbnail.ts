import type { ImageRef, SiteDoc } from "./types";

export interface SiteThumbnailImage {
  kind: "ogp" | "favicon";
  src: string;
}

/** A site's card previews the top page, then its default share image and favicon. */
export function siteThumbnailImages(doc: SiteDoc, siteId: string): SiteThumbnailImage[] {
  const home = Object.values(doc.pages).find(page => page.slug === "" && !page.query && !page.unpublished);
  const candidates: { kind: SiteThumbnailImage["kind"]; ref: ImageRef | null | undefined }[] = [
    { kind: "ogp", ref: home?.ogImage },
    { kind: "ogp", ref: doc.ogImage },
    { kind: "favicon", ref: doc.favicon },
  ];
  const images: SiteThumbnailImage[] = [];
  for (const { kind, ref } of candidates) {
    if (!ref) continue;
    const asset = ref.assetId ? doc.assets[ref.assetId] : undefined;
    const src = asset?.path
      ? `/api/assets/file?path=${encodeURIComponent(asset.path)}&site=${encodeURIComponent(siteId)}`
      : asset?.dataUrl?.startsWith("data:image/")
        ? asset.dataUrl
        : ref.url?.trim() ?? "";
    if (src && !images.some(image => image.src === src)) images.push({ kind, src });
  }
  return images;
}
