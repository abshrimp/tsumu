"use client";

import { useMemo } from "react";
import { Check, ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import { exportLimitations } from "../lib/export-formats";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import type { PublishTarget } from "../lib/generator";
import type { SiteDoc } from "../lib/types";
import { showConfirm } from "../lib/dialog";
import { userMessage } from "../lib/errors";
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

export function staticPublishError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "The site ZIP is too large (25 MiB maximum)." || message === "The site ZIP is too large." ||
      message === "The site contains files that exceed the upload size limit.") {
    return tr("The site files exceed the static hosting size limit.");
  }
  if (message === "The site has too many files.") {
    return tr("The site has too many files to publish.");
  }
  if (message === "The site ZIP could not be read." || message === "A static-site ZIP is required.") {
    return tr("Could not prepare the static site archive.");
  }
  if (message === "The exported site has no index.html.") {
    return tr("The exported site has no index.html.");
  }
  if (message === "Pages Functions and custom Workers cannot be deployed as static HTML." ||
      message === "Symbolic links cannot be published." ||
      message === "Unsafe generated file path.") {
    return tr("The publish includes a file path that isn't allowed");
  }
  if (message === "Editable project data and secret files must not be published.") {
    return tr("Editable project data and secret files must not be published.");
  }
  if (message === "The publishing destination changed. Reopen the publish dialog.") {
    return tr("The publishing destination changed. Reopen the publish dialog.");
  }
  if (message === "CLOUDFLARE_API_TOKEN is not configured." ||
      message === "CLOUDFLARE_ACCOUNT_ID must be a valid account ID.") {
    return tr("Static publishing isn't configured on the server.");
  }
  if (message === "This deployment cannot be restored." ||
      message === "The deployment is not available for restoration." ||
      message === "Invalid deployment ID.") {
    return tr("This deployment cannot be restored.");
  }
  if (message.includes("Cloudflare") && (message.includes("failed (HTTP ") || message.includes("rejected by Cloudflare") || message.includes("redirected") || message.includes("did not return"))) {
    return tr("Cloudflare Pages could not complete the request. Try again later.");
  }
  if (cause instanceof TypeError) {
    return tr("Could not reach the publishing service. Check your network and retry.");
  }
  return userMessage(cause, fallback);
}

export function useStaticPublishChecks(doc: SiteDoc): CheckResult[] {
  return useMemo<CheckResult[]>(() => [
    ...runChecks(doc, { requireHomePage: "if-defined" }),
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
  visibilitySettingsUrl,
}: {
  providerName: string;
  result: StaticPublishSubmitted;
  onClose: () => void;
  visibilitySettingsUrl?: string;
}) {
  return (
    <>
      <div className="check-ok">
        <Check size={14} />
        {tr("Deployment submitted to {provider}.", { provider: providerName })}
      </div>
      <p className="hint">{tr("Deployment status: {state}", { state: result.state })}</p>
      {visibilitySettingsUrl && (
        <a className="pub-visibility-link" href={visibilitySettingsUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} />
          {tr("Manage public or private access in Netlify")}
        </a>
      )}
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
    <div className="pub-deployment-history">
      <p className="modal-desc">{description}</p>
      <Seg
        value={target}
        options={[
          { value: "test", label: tr("Test site") },
          { value: "production", label: tr("Live site") },
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
    </div>
  );
}
