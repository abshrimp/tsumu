"use client";

import { useMemo } from "react";
import { Check, ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import { exportLimitations } from "../lib/export-formats";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import type { PublishTarget } from "../lib/generator";
import type { SiteDoc } from "../lib/types";
import { showConfirm } from "../lib/dialog";
import { tr } from "../lib/i18n";
import { Seg } from "./controls";

export interface StaticDeploymentItem {
  id: string;
  date: string;
  url: string;
  state: string;
  canRestore: boolean;
}

export interface StaticPublishSubmitted {
  id: string;
  state: string;
  deploymentUrl: string;
  siteUrl: string;
}

export function useStaticPublishChecks(doc: SiteDoc): CheckResult[] {
  return useMemo<CheckResult[]>(() => [
    ...runChecks(doc),
    ...exportLimitations(doc, {
      framework: "html", language: "javascript", style: "css", scope: "project",
    }).map((message): CheckResult => ({ level: "error", message })),
  ], [doc]);
}

export async function yieldBeforeStaticBuild(): Promise<void> {
  if (typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
  }
}

export function confirmStaticRestore(): Promise<boolean> {
  return showConfirm(
    tr("Restore this deployment to the selected site? The live content will change."),
    { title: tr("Restore deployment"), okLabel: tr("Restore this version"), danger: true },
  );
}

export function StaticPublishDoneView({
  providerName,
  result,
  onClose,
}: {
  providerName: string;
  result: StaticPublishSubmitted;
  onClose: () => void;
}) {
  return (
    <>
      <div className="check-ok">
        <Check size={14} />
        {tr("Deployment submitted to {provider}.", { provider: providerName })}
      </div>
      <p className="hint">{tr("Deployment status: {state}", { state: result.state })}</p>
      <div className="modal-actions">
        <a className="btn" href={result.deploymentUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} />{tr("View deployment")}
        </a>
        <a className="btn" href={result.siteUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} />{tr("Open site")}
        </a>
        <button className="btn btn-primary" onClick={onClose}>{tr("Close")}</button>
      </div>
    </>
  );
}

export function StaticDeploymentHistoryView({
  description,
  target,
  onTargetChange,
  history,
  error,
  restoring,
  onRestore,
  onBack,
  onClose,
}: {
  description: string;
  target: PublishTarget;
  onTargetChange: (next: PublishTarget) => void;
  history: StaticDeploymentItem[] | null;
  error: string | null;
  restoring: string | null;
  onRestore: (item: StaticDeploymentItem) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <p className="modal-desc">{description}</p>
      <Seg
        value={target}
        options={[
          { value: "production", label: tr("Live site") },
          { value: "test", label: tr("Test site") },
        ]}
        onChange={(next) => onTargetChange(next as PublishTarget)}
      />
      {history === null && !error && (
        <div className="pub-loading"><LoaderCircle className="spin" size={14} />{tr("Loading…")}</div>
      )}
      {error && <p className="pub-card-error" role="alert">{error}</p>}
      {history?.length === 0 && <p className="hint">{tr("Not published yet.")}</p>}
      {history && history.length > 0 && (
        <ol className="hist-list">
          {history.map((item) => (
            <li key={item.id}>
              <div className="hist-main">
                <a className="hist-msg" href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.date ? new Date(item.date).toLocaleString() : item.id}
                </a>
                <span className="hist-date">{item.state}</span>
              </div>
              {item.canRestore && (
                <div className="hist-acts">
                  <button className="btn btn-sm" disabled={!!restoring} onClick={() => onRestore(item)}>
                    <RotateCcw size={13} />
                    {restoring === item.id ? tr("Restoring…") : tr("Restore this version")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="modal-actions">
        <button className="btn" disabled={!!restoring} onClick={onBack}>{tr("Back")}</button>
        <button className="btn" disabled={!!restoring} onClick={onClose}>{tr("Close")}</button>
      </div>
    </>
  );
}
