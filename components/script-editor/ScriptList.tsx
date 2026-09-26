"use client";

/**
 * 左の一覧。ページのスクリプトを、きっかけの要素ごとにまとめて並べる。
 */

import { useMemo } from "react";
import { FileText, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";
import { glyphs } from "../Glyph";
import { isLinkScriptId, type PageScript } from "../../lib/script";
import { stepText } from "../../lib/script-text";
import { PAGE_TARGET, type SiteDoc } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { Ico, TRIGGER_ICON, TRIGGER_LABELS } from "./catalog";
import { scriptStatus } from "./issues";
import { ELEMENT_KIND, type TreeRow } from "./targets";

export function ScriptList({ doc, scripts, tree, openId, focusNodeId, creating, onOpen, onNew, onMenu }: {
  doc: SiteDoc;
  scripts: PageScript[];
  tree: TreeRow[];
  openId: string | null;
  /** 要素の設定から開いたときの要素（そのまとまりを目立たせる） */
  focusNodeId: string | null;
  creating: boolean;
  onOpen: (scriptId: string) => void;
  onNew: () => void;
  onMenu: (anchor: HTMLElement, scriptId: string) => void;
}) {
  const rows = useMemo(() => new Map(tree.map((row) => [row.id, row])), [tree]);
  const groups = useMemo(() => {
    const out: { nodeId: string; scripts: PageScript[] }[] = [];
    for (const script of scripts) {
      const last = out[out.length - 1];
      if (last?.nodeId === script.nodeId) last.scripts.push(script);
      else out.push({ nodeId: script.nodeId, scripts: [script] });
    }
    return out;
  }, [scripts]);

  return (
    <nav className="se-side" aria-label={tr("Scripts on this page")}>
      <button type="button" className={`se-new${creating ? " is-on" : ""}`}
        data-tutorial="se-new" aria-pressed={creating} onClick={onNew}>
        <Plus size={15} aria-hidden="true" />{tr("New script")}
      </button>
      <div className="se-side-list">
        {groups.map((group) => {
          const row = rows.get(group.nodeId);
          const KindIcon = group.nodeId === PAGE_TARGET ? FileText : row ? ELEMENT_KIND[row.kind].icon : null;
          return (
            <section key={group.nodeId}
              className={`se-side-group${focusNodeId === group.nodeId ? " is-focus" : ""}`}
              data-script-node={group.nodeId}>
              <h3 className="se-side-owner">
                {KindIcon && <KindIcon size={12} aria-hidden="true" />}
                <span>{group.nodeId === PAGE_TARGET ? tr("This page") : row?.name ?? tr("Element")}</span>
              </h3>
              <ul>
                {group.scripts.map((script) => {
                  const status = scriptStatus(script);
                  const first = script.steps[0];
                  const summary = first
                    ? script.steps.length > 1
                      ? tr("{first}, and {n} more", { first: stepText(first, doc), n: script.steps.length - 1 })
                      : stepText(first, doc)
                    : tr("No actions yet");
                  return (
                    <li key={script.id} className={`se-side-item${script.id === openId ? " is-open" : ""}`}>
                      <button type="button" className="se-side-open" data-script-id={script.id}
                        aria-current={script.id === openId ? "true" : undefined}
                        onClick={() => onOpen(script.id)}>
                        <Ico icon={TRIGGER_ICON[script.trigger]} cat="event" />
                        <span className="se-side-text">
                          <span className="se-side-name">
                            {script.trigger === "change" && script.changeVariable
                              ? tr("When {name} changes", { name: script.changeVariable })
                              : TRIGGER_LABELS[script.trigger]}
                            {isLinkScriptId(script.id) && <span className="se-badge">{tr("Link")}</span>}
                          </span>
                          <span className="se-side-sum">{glyphs(summary)}</span>
                        </span>
                        {!status.ready && (
                          <span className="se-side-warn" data-tip={status.message}>
                            <TriangleAlert size={13} aria-label={status.message} />
                          </span>
                        )}
                      </button>
                      <button type="button" className="se-icon-btn se-side-more"
                        aria-label={tr("More options for this script")} aria-haspopup="dialog"
                        onClick={(event) => onMenu(event.currentTarget, script.id)}>
                        <MoreHorizontal size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!scripts.length && (
          <p className="se-side-empty">{tr("Scripts you create appear here.")}</p>
        )}
      </div>
    </nav>
  );
}
