"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Globe, History, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { docFingerprint, useEditor } from "../lib/store";
import { exportLimitations } from "../lib/export-formats";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { buildStaticPublishZip } from "../lib/static-publish-zip";
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { tr } from "../lib/i18n";
import { userMessage } from "../lib/errors";
import { showConfirm } from "../lib/dialog";
import type { PublishTarget } from "../lib/generator";
import type { StaticPublishProvider } from "../lib/publish-provider";
import { Seg } from "./controls";
import { CheckList, docWithSvgFilters } from "./PublishShared";

interface Target {
  project: string;
  url: string | null;
  error: string | null;
}

export interface StaticPublishModalConfig {
  provider: StaticPublishProvider;
  site: string;
  configured: boolean;
  test: Target;
  production: Target;
}

interface PublishResult {
  id: string;
  state: string;
  deploymentUrl: string;
  siteUrl: string;
  provider: StaticPublishProvider;
}

interface Deployment {
  id: string;
  date: string;
  url: string;
  state: string;
  canRestore: boolean;
}

function providerLabel(provider: StaticPublishProvider): string {
  return provider === "netlify" ? "Netlify" : "Cloudflare Pages";
}

export default function StaticPublishModal({
  conf,
  onClose,
}: {
  conf: StaticPublishModalConfig;
  onClose: () => void;
}) {
  const doc = useEditor((state) => state.doc);
  const markPublished = useEditor((state) => state.markPublished);
  const [phase, setPhase] = useState<"check" | "busy" | "done" | "error">("check");
  const [target, setTarget] = useState<PublishTarget>("production");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<PublishTarget>("production");
  const [history, setHistory] = useState<Deployment[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const historyRequestRef = useRef(0);

  useEscapeToClose(onClose, phase !== "busy" && !restoring);
  const checks = useMemo<CheckResult[]>(() => [
    ...runChecks(doc),
    ...exportLimitations(doc, {
      framework: "html", language: "javascript", style: "css", scope: "project",
    }).map((message): CheckResult => ({ level: "error", message })),
  ], [doc]);
  const blocked = !conf.configured || checks.some((item) => item.level === "error");
  const providerName = providerLabel(conf.provider);

  const loadHistory = useCallback(async (nextTarget: PublishTarget) => {
    const requestId = ++historyRequestRef.current;
    setHistory(null);
    setHistoryError(null);
    const params = new URLSearchParams({
      site: conf.site,
      target: nextTarget,
      provider: conf.provider,
    });
    try {
      const response = await fetch("/api/publish/static/history?" + params);
      const data = await response.json().catch(() => null);
      if (historyRequestRef.current !== requestId) return;
      if (!response.ok) throw new Error(data?.error ?? tr("Couldn't load publish history"));
      if (data.provider !== conf.provider) throw new Error(tr("The publishing provider changed. Reopen this dialog."));
      setHistory(data.deployments as Deployment[]);
    } catch (cause) {
      if (historyRequestRef.current !== requestId) return;
      setHistoryError(userMessage(cause, tr("Couldn't load publish history")));
    }
  }, [conf.site, conf.provider]);

  useEffect(() => {
    if (!historyOpen) {
      historyRequestRef.current++;
      return;
    }
    void loadHistory(historyTarget);
  }, [historyOpen, historyTarget, loadHistory]);

  const publish = async (nextTarget: PublishTarget) => {
    if (blocked) return;
    setTarget(nextTarget);
    setPhase("busy");
    setError(null);
    setProgress(tr("Generating static site files…"));
    if (typeof window.requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
    }
    try {
      // Use one snapshot even when someone edits the document during an upload.
      const snapshot = await docWithSvgFilters(doc);
      const archive = await buildStaticPublishZip(snapshot, nextTarget);
      setProgress(tr("Uploading site files to {provider}…", { provider: providerName }));
      const params = new URLSearchParams({
        site: conf.site,
        target: nextTarget,
        provider: conf.provider,
        project: conf[nextTarget].project,
      });
      const response = await fetch("/api/publish/static?" + params, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: archive,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? tr("Couldn't publish"));
      if (data.provider !== conf.provider) throw new Error(tr("The publishing provider changed. Reopen this dialog."));
      if (nextTarget === "production") markPublished(docFingerprint(snapshot));
      setResult(data as PublishResult);
      setPhase("done");
    } catch (cause) {
      setError(userMessage(cause, tr("Couldn't publish")));
      setPhase("error");
    }
  };

  const restore = async (item: Deployment) => {
    if (!item.canRestore || restoring) return;
    const accepted = await showConfirm(
      tr("Restore this deployment to the selected site? The live content will change."),
      { title: tr("Restore deployment"), okLabel: tr("Restore this version"), danger: true }
    );
    if (!accepted) return;
    setRestoring(item.id);
    try {
      const response = await fetch("/api/publish/static/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: conf.site, target: historyTarget, provider: conf.provider,
          deploymentId: item.id,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? tr("Couldn't roll back"));
      await loadHistory(historyTarget);
    } catch (cause) {
      setHistoryError(userMessage(cause, tr("Couldn't roll back")));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={phase === "busy" || restoring ? undefined : onClose}>
      <div className="modal pub-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{historyOpen ? tr("Deployment history") : tr("Publish site")}</h2>
        {historyOpen ? (
          <>
            <p className="modal-desc">
              {tr("Deployment history is stored by {provider}. Static hosting does not publish the editor document.", { provider: providerName })}
            </p>
            <Seg
              value={historyTarget}
              options={[
                { value: "production", label: tr("Live site") },
                { value: "test", label: tr("Test site") },
              ]}
              onChange={(next) => setHistoryTarget(next as PublishTarget)}
            />
            {history === null && !historyError && (
              <div className="pub-loading"><LoaderCircle className="spin" size={14} />{tr("Loading…")}</div>
            )}
            {historyError && <p className="pub-card-error" role="alert">{historyError}</p>}
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
                        <button className="btn btn-sm" onClick={() => void restore(item)}
                          disabled={!!restoring}>
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
              <button className="btn" onClick={() => setHistoryOpen(false)} disabled={!!restoring}>{tr("Back")}</button>
              <button className="btn" onClick={onClose} disabled={!!restoring}>{tr("Close")}</button>
            </div>
          </>
        ) : (
          <>
            {phase === "check" && (
              <>
                <p className="modal-desc">
                  {tr("Publish generated HTML, CSS, JavaScript and assets directly to {provider}. Editable project data is not uploaded.", { provider: providerName })}
                </p>
                <p className="hint export-note">
                  {tr("The hosting provider is chosen by the server administrator. Configure custom domains in the hosting service.")}
                </p>
                {!conf.configured && (
                  <>
                    <p className="pub-card-error" role="alert">
                      {conf.production.error ?? tr("Static publishing isn't configured on the server.")}
                    </p>
                  </>
                )}
                <CheckList checks={checks} onClose={onClose} />
                <div className="pub-cards">
                  {(["test", "production"] as const).map((item) => (
                    <section key={item} className={"pub-card" + (item === "production" ? " is-prod" : "")}>
                      <header>
                        <span className="pub-card-icon"><Globe size={15} /></span>
                        <div>
                          <strong>{item === "production" ? tr("Live site") : tr("Test site")}</strong>
                          <p>{providerName}</p>
                        </div>
                      </header>
                      <div className="pub-card-meta">
                        <span className="pub-meta-row mono"><span className="pub-meta-text">{conf[item].project}</span></span>
                        {conf[item].url && (
                          <a href={conf[item].url!} className="pub-meta-row" target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={12} /><span className="pub-meta-text">{conf[item].url}</span>
                          </a>
                        )}
                      </div>
                      <button className={item === "production" ? "btn btn-primary" : "btn"}
                        disabled={blocked || !!conf[item].error}
                        onClick={() => void publish(item)}>
                        {item === "production" ? tr("Publish to live") : tr("Publish to test")}
                      </button>
                    </section>
                  ))}
                </div>
                <div className="modal-actions pub-actions">
                  <button className="btn btn-ghost" onClick={() => setHistoryOpen(true)}
                    disabled={!conf.configured}>
                    <History size={13} />{tr("Deployment history")}
                  </button>
                  <button className="btn" onClick={onClose}>{tr("Close")}</button>
                </div>
              </>
            )}
            {phase === "busy" && (
              <div className="pub-loading is-large">
                <LoaderCircle size={16} className="spin" />{progress}
              </div>
            )}
            {phase === "done" && result && (
              <>
                <div className="check-ok"><Check size={14} />{tr("Deployment submitted to {provider}.", { provider: providerName })}</div>
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
            )}
            {phase === "error" && (
              <>
                <ul className="check-list"><li className="is-error">
                  <TriangleAlert size={14}/>{error}
                </li></ul>
                <div className="modal-actions">
                  <button className="btn" onClick={() => setPhase("check")}>{tr("Back")}</button>
                  <button className="btn btn-primary" onClick={() => void publish(target)}>{tr("Retry")}</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}


