"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useEditor } from "../lib/store";
import { detectSvgFilters } from "../lib/assets";
import { tr } from "../lib/i18n";
import type { SiteDoc } from "../lib/types";
import type { CheckResult } from "../lib/generator/checks";
import { HelpLink } from "./HelpCenter";

/** チェックした文書に SVG の判定を反映する。処理中の共同編集は今回の出力に含めない。 */
export async function docWithSvgFilters(doc: SiteDoc): Promise<SiteDoc> {
  const found = await detectSvgFilters(doc.assets);
  let assets = doc.assets;
  for (const [id, analysis] of Object.entries(found)) {
    const asset = doc.assets[id];
    if (!asset || (asset.svgFilter === analysis.svgFilter &&
        (analysis.width === undefined || asset.width === analysis.width) &&
        (analysis.height === undefined || asset.height === analysis.height))) continue;
    if (assets === doc.assets) assets = { ...assets };
    assets[id] = { ...asset, ...analysis };
  }
  if (assets === doc.assets) return doc;
  // 同じ ID の画像が差し替えられていても、古い内容から判定した値を書き戻さない。
  if (useEditor.getState().doc === doc) {
    useEditor.getState().updateDoc(draft => { draft.assets = assets; }, { history: false });
  }
  return { ...doc, assets };
}

/** 公開前チェックの結果 */
export function CheckList({ checks, onClose }: { checks: CheckResult[]; onClose: () => void }) {
  if (!checks.length) {
    return (
      <div className="check-ok">
        <Check size={14} />
        {tr("All pre-publish checks passed.")}
      </div>
    );
  }
  return (
    <ul className="check-list">
      {checks.toSorted((a, b) => Number(b.level === "warn") - Number(a.level === "warn")).map((c, i) => (
        <li key={i} className={c.level === "error" ? "is-error" : ""}>
          <TriangleAlert size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>{c.message}</span>
          {c.help && <HelpLink topicId={c.help} onBefore={onClose} />}
        </li>
      ))}
    </ul>
  );
}

