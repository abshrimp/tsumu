"use client";

import { lazy, Suspense } from "react";
import { FileStack, Globe, Images, Layers, SquarePlus } from "lucide-react";
import { useEditor } from "../lib/store";
import SitePanel from "./SitePanel";
import { tr } from "../lib/i18n";
import { AddTab } from "./left-panel/AddTab";
import { LayersTab } from "./left-panel/LayersTab";
import { PagesTab } from "./left-panel/PagesTab";

const AssetsTab = lazy(() => import("./left-panel/AssetsTab").then((mod) => ({ default: mod.AssetsTab })));

/* ============ パネル本体 ============ */

export default function LeftPanel() {
  const leftTab = useEditor((s) => s.leftTab);
  const setLeftTab = useEditor((s) => s.setLeftTab);

  return (
    <aside className="panel-l" data-tutorial="left-panel">
      <div className="tabs" data-tutorial="left-tabs">
        {(
          [
            ["pages", tr("Pages"), FileStack],
            ["layers", tr("Layers"), Layers],
            ["add", tr("Add"), SquarePlus],
            ["assets", tr("Assets"), Images],
            ["site", tr("Site"), Globe],
          ] as const
        ).map(([key, label, TabIcon]) => (
          <button
            key={key}
            className={`tab${leftTab === key ? " is-on" : ""}`}
            data-tutorial={`left-tab-${key}`}
            aria-label={label}
            data-tip={label}
            onClick={() => setLeftTab(key)}
          >
            {/* パネルが狭いときは文字が重ならないようアイコンだけにする（CSS のコンテナクエリ） */}
            <TabIcon size={15} className="tab-icon" />
            <span className="tab-label">{label}</span>
          </button>
        ))}
      </div>
      {leftTab === "layers" && <LayersTab />}
      {leftTab === "add" && <AddTab />}
      {leftTab === "pages" && <PagesTab />}
      {leftTab === "assets" && (
        <Suspense fallback={null}>
          <AssetsTab />
        </Suspense>
      )}
      {leftTab === "site" && <SitePanel />}
    </aside>
  );
}
