import type { AdobeFont, SiteDoc } from "../types";
import { usedAdobeFonts } from "./css";

/** フォントファイルには触れず、Adobeが発行するWebプロジェクトのみ読み込む。 */
export function adobeFontProjects(fonts: readonly AdobeFont[]) {
  const projects = new Map<string, AdobeFont["loading"]>();
  for (const font of fonts) {
    if (/^[a-z0-9]{7}$/.test(font.kitId) && !projects.has(font.kitId)) {
      projects.set(font.kitId, font.loading);
    }
  }
  return [...projects].map(([kitId, loading]) => ({ kitId, loading }));
}

/** 東アジアフォントの動的サブセット用（AdobeのWebプロジェクトのJSを読み込む）。 */
export function adobeFontLoader(kitId: string): string {
  return `(function(d){var script=d.createElement("script");script.async=true;script.src="https://use.typekit.net/${kitId}.js";script.onload=function(){try{Typekit.load({async:true})}catch(e){}};d.head.appendChild(script)})(document);`;
}

export function adobeFontHead(doc: SiteDoc): string {
  return adobeFontProjects(usedAdobeFonts(doc)).map(({ kitId, loading }) =>
    loading === "css"
      ? `<link rel="stylesheet" href="https://use.typekit.net/${kitId}.css">`
      : `<script>${adobeFontLoader(kitId)}</script>`
  ).join("\n");
}
