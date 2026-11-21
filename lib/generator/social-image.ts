import type { Page, SiteDoc } from "../types";
import { imageRefSrc } from "./render-helpers";

/** Use an accessible public URL for bundled images when the author configured a deployment URL. */
export function socialImageSrc(doc: SiteDoc, page: Page | undefined, assets: Map<string, string>): string | null {
  const src = imageRefSrc(assets, page?.ogImage) ?? imageRefSrc(assets, doc.ogImage);
  if (src?.startsWith("/") && doc.siteUrl) {
    try {
      const base = new URL(doc.siteUrl);
      // A deployment URL must not publish its userinfo in og:image or Twitter metadata.
      // These attributes are visible to every visitor and are committed to public exports.
      if ((base.protocol === "https:" || base.protocol === "http:") &&
          !base.username && !base.password) {
        return new URL(src, base).href;
      }
    } catch { /* Keep the exported path when the deployment URL is incomplete. */ }
  }
  return src;
}

/** Only tags generated for a route are replaced; custom head markup belongs to the author. */
export const UPDATE_SOCIAL_IMAGE = `for (const [attribute, name, content] of [
    ["property", "og:image", image], ["name", "twitter:card", image ? "summary_large_image" : ""],
  ]) {
    const selector = 'meta[data-route-social][' + attribute + '="' + name + '"]';
    const existing = document.head.querySelector(selector);
    if (!content) { existing?.remove(); continue; }
    const meta = existing || document.createElement("meta");
    meta.setAttribute(attribute, name);
    meta.setAttribute("content", content);
    if (!existing) { meta.setAttribute("data-route-social", ""); document.head.appendChild(meta); }
  }`;
