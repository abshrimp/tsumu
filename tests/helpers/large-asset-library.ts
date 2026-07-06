import { makeBox } from "../../lib/presets";
import { assetSrc } from "../../lib/assets";
import type { SiteDoc } from "../../lib/types";

/** 実画像や個人データを使わず、大きいアセット一覧と通常のページスタイルを作る。 */
export function largeAssetLibrary(count = 2_000, nodeCount = 100): SiteDoc {
  const assets = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `library_asset_${String(index).padStart(6, "0")}`;
    return [id, { id, name: `Photo ${String(index).padStart(6, "0")}.png`, path: `assets/library-${index}.png`, width: 1200, height: 900, bytes: 250_000, mimeType: "image/png" }];
  }));
  const sources = Object.values(assets).map(assetSrc);
  const nodes = Object.fromEntries(Array.from({ length: nodeCount }, (_, index) => {
    const id = `node_${index}`;
    const backgroundImage = `linear-gradient(transparent, black), url("${sources[index % sources.length]}")`;
    return [id, { ...makeBox(), id, name: `Box ${index}`, styles: {
      base: { default: { display: "flex", flexDirection: "column", gap: "12px", padding: "24px", color: "#123456", backgroundImage }, hover: { opacity: "0.9" } },
      mobile: { default: { padding: "12px", gap: "8px", width: "100%" } },
    } }];
  }));
  return { siteName: "Synthetic large asset library", assets, nodes, pageOrder: ["p"], pages: {
    p: { id: "p", name: "Page", slug: "", title: "", description: "", children: Object.keys(nodes) },
  } };
}
