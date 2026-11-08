"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, History, LoaderCircle, TriangleAlert } from "lucide-react";
import { docFingerprint, useEditor } from "../lib/store";
import { buildStaticPublishZip } from "../lib/static-publish-zip";
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { tr } from "../lib/i18n";
import { userMessage } from "../lib/errors";
import type { PublishTarget } from "../lib/generator";
import type { StaticPublishProvider } from "../lib/publish-provider";
import { CheckList, docWithSvgFilters } from "./PublishShared";
import {
  confirmStaticRestore,
  StaticDeploymentHistoryView,
  StaticPublishDoneView,
  useStaticPublishChecks,
  yieldBeforeStaticBuild,
  type StaticDeploymentItem,
  type StaticPublishSubmitted,
} from "./StaticPublishShared";

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

interface PublishResult extends StaticPublishSubmitted {
  provider: StaticPublishProvider;
}

const PROVIDER_NAME = "Cloudflare Pages";

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
  const [history, setHistory] = useState<StaticDeploymentItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const historyRequestRef = useRef(0);

  useEscapeToClose(onClose, phase !== "busy" && !restoring);
  const checks = useStaticPublishChecks(doc);
  const blocked = !conf.configured || checks.some((item) => item.level === "error");
  const providerName = PROVIDER_NAME;

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
      setHistory(data.deployments as StaticDeploymentItem[]);
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
    await yieldBeforeStaticBuild();
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

  const restore = async (item: StaticDeploymentItem) => {
    if (!item.canRestore || restoring) return;
    if (!await confirmStaticRestore()) return;
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
      <div
        className="modal pub-modal"
        role="dialog"
        aria-modal="true"
        aria-label={historyOpen ? tr("Deployment history") : tr("Publish site")}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{historyOpen ? tr("Deployment history") : tr("Publish site")}</h2>
        {historyOpen ? (
          <StaticDeploymentHistoryView
            description={tr("Deployment history is stored by {provider}. Static hosting does not publish the editor document.", { provider: providerName })}
            target={historyTarget}
            onTargetChange={setHistoryTarget}
            history={history}
            error={historyError}
            restoring={restoring}
            onRestore={(item) => void restore(item)}
            onBack={() => setHistoryOpen(false)}
            onClose={onClose}
          />
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
                  <p className="pub-card-error" role="alert">
                    {conf.production.error ?? tr("Static publishing isn't configured on the server.")}
                  </p>
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
              <StaticPublishDoneView providerName={providerName} result={result} onClose={onClose} />
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


