import { assetSrc } from "../../lib/assets";
import { makeBox } from "../../lib/presets";
import type { Asset, SiteDoc } from "../../lib/types";

export const picture: Asset = { id: "asset_picture_123", name: "hero.png", path: "assets/hero.png", width: 10, height: 10, mimeType: "image/png" };
export const sparePicture: Asset = { ...picture, id: "asset_spare_456", name: "spare.png", path: "assets/spare.png" };
export const escapedPictureUrl = `\\2f ${assetSrc(picture).slice(1)}`;
export const escapedPictureCss = `url("${escapedPictureUrl}")`;
export type CssLocation = "node.styles" | "node.customCss" | "page.bodyStyles";

export function setAssetCss(doc: SiteDoc, location: CssLocation, css: string) {
  if (location === "node.styles") doc.nodes.box.styles = { sm: { hover: { backgroundImage: css } } };
  if (location === "node.customCss") doc.nodes.box.customCss = `background-image: ${css};`;
  if (location === "page.bodyStyles") doc.pages.p.bodyStyles = { sm: { default: { backgroundImage: css } } };
}

export function encodedCssAssetDoc(location: CssLocation, nested = false): SiteDoc {
  const doc: SiteDoc = {
    siteName: "CSS asset dependencies", pageOrder: ["p"],
    pages: { p: { id: "p", name: "Source", slug: "source", title: "", description: "", children: ["box"] } },
    nodes: { box: { ...makeBox(), id: "box", name: "Picture", styles: {} } },
    assets: { [picture.id]: { ...picture }, [sparePicture.id]: { ...sparePicture } },
  };
  setAssetCss(doc, location, escapedPictureCss);
  if (nested) {
    doc.components = {
      outer: { id: "outer", name: "Outer", rootId: "outerRoot" },
      inner: { id: "inner", name: "Inner", rootId: "innerRoot" },
    };
    doc.nodes.outerRoot = { ...makeBox(), id: "outerRoot", children: ["innerInstance"], styles: {} };
    doc.nodes.innerInstance = { ...makeBox(), id: "innerInstance", type: "instance", componentId: "inner", styles: {} };
    doc.nodes.innerRoot = { ...makeBox(), id: "innerRoot", children: ["box"], styles: {} };
    doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "outer", styles: {} };
    doc.pages.p.children = ["instance"];
  }
  return doc;
}

export function emptyAssetDestination(): SiteDoc {
  return { siteName: "Destination", pages: { dest: { id: "dest", name: "Destination", slug: "", title: "", description: "", children: [] } }, pageOrder: ["dest"], nodes: {}, assets: {} };
}
